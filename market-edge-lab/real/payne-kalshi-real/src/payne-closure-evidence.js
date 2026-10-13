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
      const settlements=await pages('/trade-api/v2/portfolio/settlements?limit=200&subaccount=0&ticker='+encodeURIComponent(p.marketTicker),'settlements');
      if(!settlements.some(x=>x?.ticker===p.marketTicker))return reject('NO_EXACT_TICKER_SETTLEMENT');
    }
    const orders=await pages('/trade-api/v2/portfolio/orders?limit=200&subaccount=0','orders');
    const exactEntry=orders.filter(o=>(o?.order_id??o?.orderId??o?.id)===p.entryOrderId);
    const matchesOrder=o=>
      o?.client_order_id===p.entryClientOrderId &&
      (o?.ticker??o?.market_ticker)===p.marketTicker &&
      String(o?.side??o?.outcome_side??'').toLowerCase()===p.outcomeSide.toLowerCase();
    let entryVerified=exactEntry.length===1 && matchesOrder(exactEntry[0]);
    if(!entryVerified){
      // Published historical fills do not guarantee a client_order_id.
      // Establish exact client identity from an authenticated order or fill that has it,
      // and corroborate the same provider order with authenticated fill records.
      const ticker=encodeURIComponent(p.marketTicker);
      const historicalOrders=await pages('/trade-api/v2/historical/orders?limit=200&ticker='+ticker,'orders');
      const liveFills=await pages('/trade-api/v2/portfolio/fills?limit=200&subaccount=0&ticker='+ticker,'fills');
      const historicalFills=await pages('/trade-api/v2/historical/fills?limit=200&ticker='+ticker,'fills');
      const sameOrders=[...exactEntry,...historicalOrders.filter(o=>(o?.order_id??o?.orderId??o?.id)===p.entryOrderId)];
      const sameFills=[...liveFills,...historicalFills].filter(f=>(f?.order_id??f?.orderId)===p.entryOrderId);
      const orderIdentity=sameOrders.length>0 && sameOrders.every(matchesOrder);
      const fillIdentity=sameFills.length>0 && sameFills.every(f=>
        (f?.ticker??f?.market_ticker)===p.marketTicker &&
        String(f?.side??f?.outcome_side??'').toLowerCase()===p.outcomeSide.toLowerCase() &&
        ((f?.client_order_id??f?.clientOrderId)==null ||
         (f?.client_order_id??f?.clientOrderId)===p.entryClientOrderId));
      const clientIdFromFill=sameFills.some(f=>(f?.client_order_id??f?.clientOrderId)===p.entryClientOrderId);
      if(!fillIdentity || (sameOrders.length>0 && !orderIdentity) ||
         !(orderIdentity||clientIdFromFill))
        return reject('PROVIDER_ENTRY_ORDER_IDENTITY_NOT_VERIFIED');
      entryVerified=true;
    }
    const terminal=new Set(['executed','canceled','cancelled','expired','rejected']);
    if(orders.some(o=>!o?.ticker||!o?.status ||
      (o.ticker===p.marketTicker&&!terminal.has(String(o.status).toLowerCase()))))
      return reject('OPEN_OR_UNKNOWN_OWNED_ORDER');
    const collection=Array.isArray(series.positions)?series.positions:[];
    if(collection.filter(x=>x&&x.status!=='CLOSED').length!==1)
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
