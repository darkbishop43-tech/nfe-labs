import {kalshiGetOnly} from './kalshi-get-only.js';

// Only provider GETs; no order/control/KV writes. Caller authenticates first.
export async function payneClosureEvidence(env,control,series,{get=kalshiGetOnly}={}){
  const reject=reason=>({ok:false,complete:false,reason,providerWrites:0});
  const p=series?.position,a=series?.currentAttempt;
  if(control?.armed!==false||control?.openPositions!==1)return reject('CONTROL_NOT_MAINTENANCE_DISARMED');
  if(!p||p.seriesId!==series?.seriesId||p.owner!=='PAYNE_KALSHI_REAL'||!['OPEN','RECONCILIATION_UNKNOWN'].includes(p.status)||!p.attemptId||
    !p.entryOrderId||!p.entryClientOrderId||!p.marketTicker||!['YES','NO'].includes(p.outcomeSide))
    return reject('POSITION_IDENTITY_INCOMPLETE');
  if(a?.executionHandoff!=='DIRECT_KALSHI_WRITER_V1'||a.attemptId!==p.attemptId||
    Number(a.attemptNo)!==Number(p.attemptNo)||a.providerOrderId!==p.entryOrderId||
    (a.clientOrderId||a.entryClientOrderId)!==p.entryClientOrderId)
    return reject('DIRECT_ATTEMPT_MISMATCH');
  const read=async path=>{
    const response=await get(env,path);
    if(!response?.ok)throw new Error('PROVIDER_GET_NOT_OK');
    const body=await response.json();
    if(!body||typeof body!=='object')throw new Error('PROVIDER_SCHEMA_UNKNOWN');
    return body;
  };
  const pages=async(path,field)=>{
    let cursor='',count=0,rows=[];const seen=new Set();
    do{
      if(count++>=100)throw new Error('PROVIDER_PAGINATION_LIMIT');
      const body=await read(path+(cursor?'&cursor='+encodeURIComponent(cursor):''));
      if(!Array.isArray(body[field])||typeof body.cursor!=='string')throw new Error('PROVIDER_PAGINATION_INCOMPLETE');
      rows.push(...body[field]);
      cursor=body.cursor;
      if(cursor){if(seen.has(cursor))throw new Error('PROVIDER_CURSOR_REPEATED');seen.add(cursor);}
    }while(cursor);
    return rows;
  };
  try{
    const allPositions=await pages('/trade-api/v2/portfolio/positions?limit=1000&subaccount=0','market_positions');
    if(allPositions.some(x=>{
      const raw=x?.position_fp??x?.position??x?.quantity;
      return !Number.isFinite(Number(raw)) || Number(raw)!==0;
    }))return reject('OTHER_OR_UNKNOWN_PROVIDER_EXPOSURE');
    const matching=allPositions.filter(x=>String(x?.ticker||x?.market_ticker||'')===p.marketTicker);
    if(matching.length>1)return reject('PROVIDER_POSITION_AMBIGUOUS');
    const raw=matching[0]?.position_fp??matching[0]?.position??matching[0]?.quantity;
    const quantity=matching.length===1?Number(raw):null;
    if(matching.length===1&&(!Number.isFinite(quantity)||quantity!==0))return reject('PROVIDER_POSITION_NOT_ZERO');
    if(matching.length===0){
      const body=await read('/trade-api/v2/portfolio/settlements?limit=200&subaccount=0&ticker='+encodeURIComponent(p.marketTicker));
      if(!Array.isArray(body.settlements)||!body.settlements.some(x=>x?.ticker===p.marketTicker))return reject('NO_EXACT_TICKER_SETTLEMENT');
    }
    const orders=await pages('/trade-api/v2/portfolio/orders?limit=200&subaccount=0','orders');
    const exactEntry=orders.filter(o=>(o?.order_id||o?.id)===p.entryOrderId);
    if(exactEntry.length!==1 || exactEntry[0]?.client_order_id!==p.entryClientOrderId ||
       exactEntry[0]?.ticker!==p.marketTicker ||
       String(exactEntry[0]?.side||'').toLowerCase()!==p.outcomeSide.toLowerCase())
      return reject('PROVIDER_ENTRY_ORDER_IDENTITY_NOT_VERIFIED');
    const terminal=new Set(['executed','canceled','cancelled','expired','rejected']);
    if(orders.some(o=>!o?.ticker||!o?.status ||
      (o.ticker===p.marketTicker&&!terminal.has(String(o.status).toLowerCase()))))
      return reject('OPEN_OR_UNKNOWN_OWNED_ORDER');
    const collection=Array.isArray(series.positions)?series.positions:[];
    if(collection.filter(x=>x&&x.status!=='CLOSED'&&x.reconciliationState!=='FLAT').length!==1)
      return reject('OTHER_UNRESOLVED_PAYNE_POSITION');
    return {ok:true,complete:true,reason:'EXACT_PROVIDER_FLAT_VERIFIED',
      provider:{authenticated:true,complete:true,ticker:p.marketTicker,side:p.outcomeSide,
      entryOrderId:p.entryOrderId,entryClientOrderId:p.entryClientOrderId,
      positionReadOk:true,positionQuantity:0,ordersReadOk:true,ordersComplete:true,
      orders:orders.map(o=>({ticker:o.ticker,status:o.status})),otherUnresolvedExposure:false},
      positionIdentity:{seriesId:p.seriesId,attemptId:p.attemptId,providerOrderId:p.entryOrderId,
      clientOrderId:p.entryClientOrderId,ticker:p.marketTicker,side:p.outcomeSide},providerWrites:0};
  }catch(error){return reject('PROVIDER_EVIDENCE_INCOMPLETE');}
}
