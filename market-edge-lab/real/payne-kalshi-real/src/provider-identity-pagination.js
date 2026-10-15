// Read-only Kalshi order/fill pagination. Caller owns reconciliation decisions.
// Every response must have an expected array schema and a terminating cursor.
const TYPES=Object.freeze({
 activeOrders:{path:'/trade-api/v2/portfolio/orders',field:'orders'},
 historicalOrders:{path:'/trade-api/v2/historical/orders',field:'orders'},
 fills:{path:'/trade-api/v2/portfolio/fills',field:'fills'},
 historicalFills:{path:'/trade-api/v2/historical/fills',field:'fills'}
});
export async function readPagedKalshiIdentities(read,kind,{ticker,subaccount=0,pageLimit=200,maxPages=100}={}){
 const spec=TYPES[kind];
 if(!spec)throw Error('IDENTITY_KIND_UNSUPPORTED');
 if(typeof read!=='function')throw Error('IDENTITY_PROVIDER_READ_REQUIRED');
 if(!ticker||typeof ticker!=='string')throw Error('IDENTITY_EXACT_TICKER_REQUIRED');
 const out=[],seen=new Set();let cursor='',pages=0,httpStatus=null;
 const incomplete=(reason)=>({ok:false,complete:false,kind,ticker,rows:out,pages,httpStatus,reason});
 while(pages<maxPages){
  const params=new URLSearchParams({limit:String(pageLimit),subaccount:String(subaccount),ticker});
  if(cursor)params.set('cursor',cursor);
  let result;
  try{result=await read(spec.path+'?'+params.toString());}catch{return incomplete('PROVIDER_READ_EXCEPTION');}
  httpStatus=result?.status??null;
  if(result?.ok!==true)return incomplete('PROVIDER_HTTP_FAILURE');
  let body;
  try{body=await result.json();}catch{return incomplete('PROVIDER_JSON_INVALID');}
  if(!body||!Array.isArray(body[spec.field]))return incomplete('PROVIDER_SCHEMA_UNKNOWN');
  if(body.cursor!==undefined&&body.cursor!==null&&typeof body.cursor!=='string')return incomplete('PROVIDER_CURSOR_SCHEMA_UNKNOWN');
  const rows=body[spec.field];
  if(rows.some(x=>!x||typeof x!=='object'||Array.isArray(x)))return incomplete('PROVIDER_ROW_SCHEMA_UNKNOWN');
  // Filter on exact ticker, retain all raw fields/IDs without fabricating ownership.
  out.push(...rows.filter(x=>String(x.ticker??x.market_ticker??'')===ticker));
  pages++;
  const next=body.cursor||'';
  if(!next)return {ok:true,complete:true,kind,ticker,rows:out,pages,httpStatus,reason:null};
  if(next===cursor||seen.has(next))return incomplete('PROVIDER_CURSOR_REPEATED');
  seen.add(next);cursor=next;
 }
 return incomplete('PROVIDER_PAGE_LIMIT_REACHED');
}
export async function readKalshiIdentityBundle(read,opts){
 const names=Object.keys(TYPES),responses=await Promise.all(names.map(n=>readPagedKalshiIdentities(read,n,opts)));
 const kinds=Object.fromEntries(names.map((n,i)=>[n,responses[i]]));
 return {ok:responses.every(x=>x.ok&&x.complete),complete:responses.every(x=>x.complete),kinds,
   rawOrderCount:kinds.activeOrders.rows.length+kinds.historicalOrders.rows.length,
   rawFillCount:kinds.fills.rows.length+kinds.historicalFills.rows.length};
}
