// PAYNE-only read-side enrichment. No provider POST, KV writes or inferred fills.
const id=x=>String(x??'').trim();
const num=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
const exact=(a,b)=>id(a)!==''&&id(a)===id(b);
export function enrichPayneCycles(rows,provider,{readAt=null,coverage='UNKNOWN'}={}){
 const orders=provider.orders||[],fills=provider.fills||[],historical=provider.historicalFills||[],positions=provider.positions||[];
 const allFills=new Map();
 for(const f of [...fills,...historical]){
   const key=id(f.fill_id||f.fillId);
   if(key)allFills.set(key,f);
 }
 return rows.map(row=>{
  const result={...row,providerEvidenceComplete:false,providerLastReadAt:readAt,
    evidenceSource:'PAYNE_PERSISTED_ATTEMPT_AND_LEDGER',coverage,
    missingProviderFields:[]};
  const ticker=id(row.ticker),side=id(row.side).toLowerCase(),providerOrder=id(row.providerOrderId),client=id(row.clientOrderId);
  if(!ticker||!side||(!providerOrder&&!client)){
    result.coverage='MISSING_PAYNE_ORDER_IDENTITY';result.missingProviderFields=['ORDER_IDENTITY'];return result;
  }
  // Existing PAYNE identity is authoritative. Never join by ticker alone.
  const matchingOrders=orders.filter(o=>{
    const oid=id(o.order_id||o.orderId),cid=id(o.client_order_id||o.clientOrderId);
    const ot=id(o.ticker||o.market_ticker),os=id(o.outcome_side||o.outcomeSide||o.yes_no).toLowerCase();
    return exact(ot,ticker)&&(!os||os===side)&&
      ((providerOrder&&exact(oid,providerOrder))||(client&&exact(cid,client)));
  });
  if(matchingOrders.length!==1){
    result.missingProviderFields.push(matchingOrders.length?'AMBIGUOUS_ENTRY_ORDER':'ENTRY_ORDER_NOT_FOUND');
    return result;
  }
  const order=matchingOrders[0],entryId=id(order.order_id||order.orderId);
  if(providerOrder&&entryId!==providerOrder){
    result.missingProviderFields.push('ORDER_ID_MISMATCH');return result;
  }
  if(client&&id(order.client_order_id||order.clientOrderId)!==client){
    result.missingProviderFields.push('CLIENT_ORDER_ID_MISMATCH');return result;
  }
  const matches=[...allFills.values()].filter(f=>
    exact(id(f.order_id||f.orderId),entryId)&&
    exact(id(f.ticker||f.market_ticker),ticker)&&
    (!id(f.outcome_side||f.outcomeSide||f.yes_no)||id(f.outcome_side||f.outcomeSide||f.yes_no).toLowerCase()===side));
  result.providerOrderStatus=order.status||null;
  result.providerOrderId=entryId;
  if(!matches.length){result.missingProviderFields.push('ENTRY_FILLS_NOT_FOUND');return result;}
  const counts=matches.map(f=>num(f.count??f.quantity??f.count_fp));
  if(counts.some(x=>x===null||x<=0)){result.missingProviderFields.push('FILL_QUANTITY_UNKNOWN');return result;}
  const qty=counts.reduce((a,b)=>a+b,0);
  const prices=matches.map(f=>num((side==='no'?f.no_price_dollars:f.yes_price_dollars)??f.price_dollars));
  const fees=matches.map(f=>num(f.fee_cost_dollars));
  result.quantity=qty;
  result.entryTime=matches.map(f=>f.created_time||f.created_at||f.ts||null).filter(Boolean).sort()[0]||null;
  result.fillId=matches.length===1?id(matches[0].fill_id||matches[0].fillId):null;
  result.entryPrice=prices.every(x=>x!==null)?prices.reduce((a,p,i)=>a+p*counts[i],0)/qty:null;
  result.entryFeesUsd=fees.every(x=>x!==null)?fees.reduce((a,b)=>a+b,0):null;
  result.providerEvidenceComplete=false;
  result.evidenceSource='KALSHI_EXACT_ENTRY_ORDER_AND_FILLS';
  result.coverage='ENTRY_VERIFIED_EXIT_UNMATCHED';
  // Never infer an exit order or profit from same-ticker activity owned by another agent.
  result.exitPrice=null;result.exitTime=null;result.exitFeesUsd=null;result.realizedPnlUsd=null;
  const exitOrderId=id(row.exitProviderOrderId),exitClientId=id(row.exitClientOrderId);
  if(!exitOrderId||!exitClientId){
    result.missingProviderFields.push('EXIT_ORDER_IDENTITY_NOT_VERIFIED','EXIT_FILL_EVIDENCE_NOT_VERIFIED','REALIZED_PNL_UNKNOWN');
    return result;
  }
  const exitOrders=orders.filter(o=>exact(id(o.order_id||o.orderId),exitOrderId)
     && exact(id(o.client_order_id||o.clientOrderId),exitClientId)
     && exact(id(o.ticker||o.market_ticker),ticker)
     && (!id(o.outcome_side||o.outcomeSide||o.yes_no)||id(o.outcome_side||o.outcomeSide||o.yes_no).toLowerCase()===side));
  if(exitOrders.length!==1){
    result.missingProviderFields.push('EXIT_ORDER_NOT_EXACTLY_MATCHED','REALIZED_PNL_UNKNOWN');return result;
  }
  result.exitOrderStatus=exitOrders[0].status||null;
  const exitFills=[...allFills.values()].filter(f=>exact(id(f.order_id||f.orderId),exitOrderId)
    && exact(id(f.ticker||f.market_ticker),ticker)
    && (!id(f.outcome_side||f.outcomeSide||f.yes_no)||id(f.outcome_side||f.outcomeSide||f.yes_no).toLowerCase()===side));
  const eq=exitFills.map(f=>num(f.count??f.quantity??f.count_fp));
  if(!eq.length||eq.some(x=>x===null||x<=0)){
    result.missingProviderFields.push('EXIT_FILLS_NOT_COMPLETE','REALIZED_PNL_UNKNOWN');return result;
  }
  const exitQty=eq.reduce((a,b)=>a+b,0);
  const exitPrices=exitFills.map(f=>num((side==='no'?f.no_price_dollars:f.yes_price_dollars)??f.price_dollars));
  const exitFees=exitFills.map(f=>num(f.fee_cost_dollars));
  result.exitFilledQuantity=exitQty;
  result.remainingQuantity=Math.max(0,qty-exitQty);
  result.exitTime=exitFills.map(f=>f.created_time||f.created_at||f.ts||null).filter(Boolean).sort().at(-1)||null;
  result.exitPrice=exitPrices.every(x=>x!==null)?exitPrices.reduce((a,p,i)=>a+p*eq[i],0)/exitQty:null;
  result.exitFeesUsd=exitFees.every(x=>x!==null)?exitFees.reduce((a,b)=>a+b,0):null;
  if(exitQty!==qty){
    result.coverage='PARTIAL_EXIT_FILLED';
    result.missingProviderFields.push('REMAINING_POSITION_REQUIRES_PROVIDER_RECONCILIATION','REALIZED_PNL_UNKNOWN');
    return result;
  }
  if(!provider.complete){
    result.coverage='PROVIDER_HISTORY_INCOMPLETE';
    result.missingProviderFields.push('PROVIDER_HISTORY_PAGINATION_OR_READ_INCOMPLETE','REALIZED_PNL_UNKNOWN');return result;
  }
  if([result.entryPrice,result.exitPrice,result.entryFeesUsd,result.exitFeesUsd].some(x=>x===null)){
    result.missingProviderFields.push('PRICE_OR_FEE_UNKNOWN','REALIZED_PNL_UNKNOWN');return result;
  }
  result.fees=Number((result.entryFeesUsd+result.exitFeesUsd).toFixed(4));
  result.realizedPnlUsd=Number(((result.exitPrice-result.entryPrice)*qty-result.entryFeesUsd-result.exitFeesUsd).toFixed(4));
  result.coverage='EXACT_ENTRY_AND_EXIT_FILLS_VERIFIED';
  result.providerEvidenceComplete=true;
  result.evidenceSource='KALSHI_EXACT_ORDER_AND_FILL_IDS';
  return result;
 });
}
export async function readPayneProviderHistory(get,{maxPages=20}={}){
 const spec=[['orders','/trade-api/v2/portfolio/orders','orders'],
 ['fills','/trade-api/v2/portfolio/fills','fills'],
 ['historicalFills','/trade-api/v2/historical/fills','fills'],
 ['positions','/trade-api/v2/portfolio/positions','market_positions']];
 const out={};const missing=[];
 for(const [name,path,key] of spec){
  let cursor='',pages=0,complete=false;const seen=new Set(),rows=[];
  do{
   const u=path+'?limit=200&subaccount=0'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
   let response;try{response=await get(u);}catch{missing.push(name+':READ_FAILED');break;}
   if(!response?.ok){missing.push(name+':HTTP_'+(response?.status??'UNKNOWN'));break;}
   const body=await response.json().catch(()=>null);
   if(!Array.isArray(body?.[key])){missing.push(name+':SCHEMA_UNKNOWN');break;}
   rows.push(...body[key]);pages++;
   const next=typeof body.cursor==='string'?body.cursor:'';
   if(!next){complete=true;break;}
   if(seen.has(next)||pages>=maxPages){missing.push(name+':PAGINATION_INCOMPLETE');break;}
   seen.add(next);cursor=next;
  }while(true);
  out[name]=rows;
  if(!complete&&!missing.some(x=>x.startsWith(name+':')))missing.push(name+':INCOMPLETE');
 }
 return {...out,coverage:missing.length?'PARTIAL_'+missing.join('|'):'PROVIDER_READS_COMPLETE',
   complete:missing.length===0,readAt:new Date().toISOString()};
}
