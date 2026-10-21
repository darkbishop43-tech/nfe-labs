import {kalshiGetOnly} from './kalshi-get-only.js';

// Provider reads are exhaustive or UNKNOWN. No network writes or claim mutations.
export async function readRecoveryPages(env,path,field,{get=kalshiGetOnly,maxPages=100}={}){
 const rows=[],seen=new Set();let cursor='';
 for(let page=0;page<maxPages;page++){
  const suffix=cursor?(path.includes('?')?'&':'?')+'cursor='+encodeURIComponent(cursor):'';
  let response,body;
  try{response=await get(env,path+suffix);if(!response?.ok)return {ok:false,reason:'PROVIDER_HTTP_UNAVAILABLE'};
   body=await response.json();}catch{return {ok:false,reason:'PROVIDER_READ_FAILED'};}
  if(!Array.isArray(body?.[field])||typeof body.cursor!=='string')return {ok:false,reason:'PROVIDER_PAGINATION_UNKNOWN'};
  rows.push(...body[field]);cursor=body.cursor;
  if(!cursor)return {ok:true,rows};
  if(seen.has(cursor))return {ok:false,reason:'PROVIDER_CURSOR_REPEATED'};
  seen.add(cursor);
 }
 return {ok:false,reason:'PROVIDER_PAGE_LIMIT'};
}

const unknown=(reason)=>({ok:false,complete:false,status:'UNKNOWN',reason,providerWrites:0});
const terminal=new Set(['executed','canceled','cancelled','expired','rejected']);
export async function verifyProviderTerminalExit(env,{claim,position,get=kalshiGetOnly}={}){
 if(!claim||!position||claim.seriesId!==position.seriesId||
  claim.kind&&claim.kind!=='EXIT'||claim.clientOrderId!==position.exitClientOrderId||
  claim.attemptNo!==position.attemptNo||claim.ticker!==position.marketTicker||
  claim.side!==position.outcomeSide||!claim.specimenId)
  return unknown('EXIT_CLAIM_POSITION_IDENTITY_MISMATCH');
 const ticker=claim.ticker,clientId=claim.clientOrderId;
 const encoded=encodeURIComponent(ticker);
 const feeds=[
  ['/trade-api/v2/portfolio/orders?limit=200&subaccount=0&ticker='+encoded,'orders'],
  ['/trade-api/v2/historical/orders?limit=200&ticker='+encoded,'orders'],
  ['/trade-api/v2/portfolio/fills?limit=200&subaccount=0&ticker='+encoded,'fills'],
  ['/trade-api/v2/historical/fills?limit=200&ticker='+encoded,'fills'],
  ['/trade-api/v2/portfolio/positions?limit=1000&subaccount=0','market_positions'],
  ['/trade-api/v2/portfolio/settlements?limit=200&subaccount=0&ticker='+encoded,'settlements']
 ];
 const reads=await Promise.all(feeds.map(([path,field])=>readRecoveryPages(env,path,field,{get})));
 if(reads.some(x=>!x.ok))return unknown('PROVIDER_READS_OR_PAGINATION_INCOMPLETE');
 const [liveOrders,historicalOrders,liveFills,historicalFills,positions,settlements]=reads.map(x=>x.rows);
 if(liveOrders.some(o=>o.ticker===ticker&&!terminal.has(String(o.status||'').toLowerCase())))
  return unknown('OPEN_OR_UNKNOWN_SAME_CONTRACT_ORDER');
 const matched=[...liveOrders,...historicalOrders].filter(o=>o.client_order_id===clientId&&
  o.ticker===ticker&&String(o.side||'').toUpperCase()===claim.side);
 const ids=[...new Set(matched.map(o=>o.order_id))];
 if(ids.length!==1||!ids[0]||matched.some(o=>o.action&&o.action!=='sell'))
  return unknown('EXACT_EXIT_ORDER_NOT_ESTABLISHED');
 const providerOrderId=ids[0];
 if(matched.some(o=>!terminal.has(String(o.status||'').toLowerCase())))
  return unknown('EXIT_ORDER_NOT_PROVIDER_TERMINAL');
 const allFills=[...liveFills,...historicalFills].filter(f=>f.order_id===providerOrderId);
 if(allFills.some(f=>f.ticker!==ticker||String(f.side||'').toUpperCase()!==claim.side||
    (f.client_order_id&&f.client_order_id!==clientId)))
  return unknown('EXIT_FILL_IDENTITY_MISMATCH');
 const fills=new Map();
 for(const f of allFills){
  const id=f.fill_id??f.trade_id;
  if(!id)return unknown('FILL_UNIQUE_ID_MISSING');
  if(fills.has(id)&&JSON.stringify(fills.get(id))!==JSON.stringify(f))
   return unknown('FILL_DUPLICATE_ID_CONFLICT');
  fills.set(id,f);
 }
 const units=[...fills.values()].map(f=>Number(f.count_fp??f.count));
 if(units.some(n=>!Number.isFinite(n)||n<0))return unknown('FILLS_QUANTITY_UNKNOWN');
 const executedFills=units.reduce((x,y)=>x+y,0);
 const orderCounts=[...new Set(matched.map(o=>Number(o.fill_count_fp??o.fill_count)).filter(Number.isFinite))];
 if(orderCounts.length!==1||Math.abs(orderCounts[0]-executedFills)>1e-9)
  return unknown('ORDER_FILL_COUNTS_NOT_RECONCILED');
 const exactPositions=positions.filter(p=>String(p.ticker??p.market_ticker??'')===ticker);
 if(exactPositions.length>1)return unknown('EXACT_TICKER_POSITION_AMBIGUOUS');
 if(exactPositions.length===1){
  const qty=Number(exactPositions[0].position_fp??exactPositions[0].position??exactPositions[0].quantity);
  if(!Number.isFinite(qty)||Math.abs(qty)>1e-9)return unknown('PROVIDER_POSITION_NOT_FLAT');
 }else if(!settlements.some(s=>String(s.ticker??s.market_ticker??'')===ticker)){
  return unknown('ABSENT_POSITION_WITHOUT_SETTLEMENT');
 }
 const resolution=executedFills>0?'CLOSED':'NO_PROVIDER_EXECUTION';
 const evidenceId=[claim.seriesId,claim.attemptNo,clientId,providerOrderId,ticker,claim.side,
  resolution,String(executedFills)].join('|');
 return {ok:true,complete:true,status:'PROVIDER_VERIFIED_TERMINAL',resolution,
  providerOrderId,clientOrderId:clientId,seriesId:claim.seriesId,attemptNo:claim.attemptNo,
  ticker,side:claim.side,executedFills,positionQuantity:0,
  settlementMatched:settlements.some(s=>String(s.ticker??s.market_ticker??'')===ticker),
  evidenceId,providerTerminalProven:true,providerExposureFlatProven:true,
  providerFillsVerified:true,providerWrites:0};
}

export async function verifyProviderTerminalEntry(env,{attempt,latch,get=kalshiGetOnly}={}){
 const fail=reason=>({ok:false,complete:false,status:'UNKNOWN',reason,providerWrites:0});
 if(!attempt||!latch||latch.state!=='LATCHED'||!latch.specimenId||
  attempt.fireSpecimenId!==latch.specimenId||
  (latch.outcomeSide&&latch.outcomeSide!==attempt.outcomeSide)||
  attempt.marketTicker!==latch.ticker||!attempt.attemptId||
  !attempt.clientOrderId||!attempt.providerOrderId||
  !['YES','NO'].includes(attempt.outcomeSide)||
  attempt.marketCloseTime!==latch.marketCloseTime)
  return fail('FIRE_SPECIMEN_ATTEMPT_IDENTITY_MISMATCH');
 const ticker=attempt.marketTicker,cid=attempt.clientOrderId,oid=attempt.providerOrderId;
 const e=encodeURIComponent(ticker);
 const reads=await Promise.all([
  readRecoveryPages(env,'/trade-api/v2/portfolio/orders?limit=200&subaccount=0&ticker='+e,'orders',{get}),
  readRecoveryPages(env,'/trade-api/v2/historical/orders?limit=200&ticker='+e,'orders',{get}),
  readRecoveryPages(env,'/trade-api/v2/portfolio/fills?limit=200&subaccount=0&ticker='+e,'fills',{get}),
  readRecoveryPages(env,'/trade-api/v2/historical/fills?limit=200&ticker='+e,'fills',{get}),
  readRecoveryPages(env,'/trade-api/v2/portfolio/positions?limit=1000&subaccount=0','market_positions',{get}),
  readRecoveryPages(env,'/trade-api/v2/portfolio/settlements?limit=200&subaccount=0&ticker='+e,'settlements',{get})
 ]);
 if(reads.some(x=>!x.ok))return fail('ENTRY_PROVIDER_READ_OR_PAGINATION_INCOMPLETE');
 const [orders,historicalOrders,fills,historicalFills,positions,settlements]=reads.map(x=>x.rows);
 const allOrders=[...orders,...historicalOrders];
 if(orders.some(o=>o.ticker===ticker&&!terminal.has(String(o.status||'').toLowerCase())))
  return fail('ENTRY_OPEN_OR_UNKNOWN_SAME_CONTRACT_ORDER');
 const matched=allOrders.filter(o=>o.order_id===oid&&o.client_order_id===cid&&o.ticker===ticker&&
  String(o.side||'').toUpperCase()===attempt.outcomeSide&&(!o.action||o.action==='buy'));
 if(matched.length<1||allOrders.some(o=>o.order_id===oid&&!matched.includes(o)))
  return fail('ENTRY_PROVIDER_ORDER_IDENTITY_UNVERIFIED');
 if(matched.some(o=>!terminal.has(String(o.status||'').toLowerCase())))
  return fail('ENTRY_PROVIDER_ORDER_NOT_TERMINAL');
 const exactFills=[...fills,...historicalFills].filter(f=>f.order_id===oid);
 if(exactFills.some(f=>f.ticker!==ticker||String(f.side||'').toUpperCase()!==attempt.outcomeSide||
   (f.client_order_id&&f.client_order_id!==cid)))
  return fail('ENTRY_PROVIDER_FILL_IDENTITY_MISMATCH');
 const ids=new Map();
 for(const f of exactFills){
  const id=f.fill_id??f.trade_id;if(!id)return fail('ENTRY_FILL_ID_MISSING');
  if(ids.has(id)&&JSON.stringify(ids.get(id))!==JSON.stringify(f))return fail('ENTRY_FILL_ID_CONFLICT');
  ids.set(id,f);
 }
 const counts=[...ids.values()].map(f=>Number(f.count_fp??f.count));
 if(counts.some(n=>!Number.isFinite(n)||n<0))return fail('ENTRY_FILL_COUNT_UNKNOWN');
 const executed=counts.reduce((a,n)=>a+n,0);
 const expected=[...new Set(matched.map(o=>Number(o.fill_count_fp??o.fill_count)).filter(Number.isFinite))];
 if(expected.length!==1||Math.abs(expected[0]-executed)>1e-9)
  return fail('ENTRY_ORDER_FILLS_UNRECONCILED');
 const exactPositions=positions.filter(p=>String(p.ticker??p.market_ticker??'')===ticker);
 if(exactPositions.length>1)return fail('ENTRY_POSITION_AMBIGUOUS');
 if(exactPositions.length===1){
  const qty=Number(exactPositions[0].position_fp??exactPositions[0].position??exactPositions[0].quantity);
  if(!Number.isFinite(qty)||Math.abs(qty)>1e-9)return fail('ENTRY_POSITION_NOT_FLAT');
 }
 const settled=settlements.some(x=>String(x.ticker??x.market_ticker??'')===ticker);
 if(executed>0&&!settled)return fail('ENTRY_FILLED_BUT_SETTLEMENT_UNKNOWN');
 // A terminal zero-fill order, exhaustive fills and flat position together prove
 // no exposure from this exact order; NO_FILL as a label alone does not.
 const resolution=executed>0?'CLOSED':'NO_PROVIDER_EXECUTION';
 return {ok:true,complete:true,status:'PROVIDER_VERIFIED_TERMINAL',resolution,
  ticker,side:attempt.outcomeSide,providerOrderId:oid,clientOrderId:cid,
  fireSpecimenId:latch.specimenId,executedFills:executed,positionQuantity:0,
  settlementMatched:settled,providerTerminalProven:true,providerExposureFlatProven:true,
  providerFillsVerified:true,
  evidenceId:[latch.specimenId,cid,oid,ticker,attempt.outcomeSide,resolution,String(executed)].join('|'),
  providerWrites:0};
}
