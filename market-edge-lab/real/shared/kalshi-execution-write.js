export const KALSHI_EXECUTION_ORIGIN='https://external-api.kalshi.com';
export const KALSHI_EXECUTION_ORDER_PATH='/trade-api/v2/portfolio/events/orders';

function derLength(n){
  if(n<0x80)return new Uint8Array([n]);
  const bytes=[];while(n>0){bytes.unshift(n&0xff);n>>>=8;}
  return new Uint8Array([0x80|bytes.length,...bytes]);
}
function derWrap(tag,content){
  const len=derLength(content.length),out=new Uint8Array(1+len.length+content.length);
  out[0]=tag;out.set(len,1);out.set(content,1+len.length);return out;
}
function rsaPkcs1ToPkcs8(pkcs1){
  const version=new Uint8Array([0x02,0x01,0x00]);
  const rsaAlgId=new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  const octet=derWrap(0x04,pkcs1),inner=new Uint8Array(version.length+rsaAlgId.length+octet.length);
  inner.set(version,0);inner.set(rsaAlgId,version.length);inner.set(octet,version.length+rsaAlgId.length);
  return derWrap(0x30,inner);
}
export async function kalshiExecutionHeaders(env,method,path){
  if(!env?.KALSHI_EXECUTION_KEY_ID||!env?.KALSHI_EXECUTION_PRIVATE_KEY)throw new Error('KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED');
  const pem=String(env.KALSHI_EXECUTION_PRIVATE_KEY).trim();
  const isPkcs1=/-----BEGIN RSA PRIVATE KEY-----/.test(pem);
  const body=pem.replace(/-----BEGIN [^-]+-----/g,'').replace(/-----END [^-]+-----/g,'').replace(/\s+/g,'');
  const raw=atob(body);let bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  if(isPkcs1)bytes=rsaPkcs1ToPkcs8(bytes);
  const key=await crypto.subtle.importKey('pkcs8',bytes.buffer,{name:'RSA-PSS',hash:'SHA-256'},false,['sign']);
  const ts=String(Date.now()),signPath=String(path).split('?')[0],verb=String(method).toUpperCase();
  const sig=await crypto.subtle.sign({name:'RSA-PSS',saltLength:32},key,new TextEncoder().encode(ts+verb+signPath));
  let binary='';for(const x of new Uint8Array(sig))binary+=String.fromCharCode(x);
  return {accept:'application/json','KALSHI-ACCESS-KEY':String(env.KALSHI_EXECUTION_KEY_ID).trim(),'KALSHI-ACCESS-TIMESTAMP':ts,'KALSHI-ACCESS-SIGNATURE':btoa(binary)};
}
export function assertKalshiMechanicalOrderPayload(payload){
  if(!payload||typeof payload!=='object')throw new Error('KALSHI_ORDER_PAYLOAD_REQUIRED');
  if(!payload.ticker||!payload.client_order_id)throw new Error('KALSHI_ORDER_IDENTITY_REQUIRED');
  if(!['bid','ask'].includes(String(payload.side)))throw new Error('KALSHI_ORDER_SIDE_INVALID');
  const count=Number(payload.count),price=Number(payload.price);
  if(!(count>0)||!(price>0&&price<1))throw new Error('KALSHI_ORDER_SIZE_OR_PRICE_INVALID');
  if(String(payload.time_in_force)!=='immediate_or_cancel')throw new Error('KALSHI_ORDER_IOC_REQUIRED');
  if(payload.post_only!==false)throw new Error('KALSHI_ORDER_POST_ONLY_FALSE_REQUIRED');
  if(payload.cancel_order_on_pause!==true)throw new Error('KALSHI_ORDER_CANCEL_ON_PAUSE_REQUIRED');
  if(typeof payload.reduce_only!=='boolean')throw new Error('KALSHI_ORDER_REDUCE_ONLY_REQUIRED');
  return true;
}
export async function kalshiExecutionOrderPost(env,payload,{fetchImpl=fetch}={}){
  assertKalshiMechanicalOrderPayload(payload);
  const headers=await kalshiExecutionHeaders(env,'POST',KALSHI_EXECUTION_ORDER_PATH);
  headers['content-type']='application/json';
  const response=await fetchImpl(KALSHI_EXECUTION_ORIGIN+KALSHI_EXECUTION_ORDER_PATH,{method:'POST',headers,body:JSON.stringify(payload)});
  if(!response||typeof response.ok!=='boolean')throw new Error('KALSHI_EXECUTION_INVALID_PROVIDER_RESPONSE');
  return response;
}
