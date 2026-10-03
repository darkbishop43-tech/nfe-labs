const KALSHI_ORIGIN = 'https://external-api.kalshi.com';
const ORDER_PATH = '/trade-api/v2/portfolio/events/orders';
const ALLOWED_METHOD = 'POST';
const PAYNE_OWNER = 'PAYNE_KALSHI_REAL';
const REQUIRED_EXCHANGE_INDEX = 2;

function derLength(n) {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>>= 8; }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}
function derWrap(tag, content) {
  const len = derLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag; out.set(len, 1); out.set(content, 1 + len.length); return out;
}
function pkcs1ToPkcs8(pkcs1) {
  const version = new Uint8Array([0x02,0x01,0x00]);
  const rsaAlgId = new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00]);
  const octet = derWrap(0x04, pkcs1);
  const inner = new Uint8Array(version.length + rsaAlgId.length + octet.length);
  inner.set(version,0); inner.set(rsaAlgId,version.length); inner.set(octet,version.length+rsaAlgId.length);
  return derWrap(0x30,inner);
}
function decodePem(pem) {
  const text=String(pem||'').trim();
  const isPkcs1=/-----BEGIN RSA PRIVATE KEY-----/.test(text);
  const body=text.replace(/-----BEGIN [^-]+-----/g,'').replace(/-----END [^-]+-----/g,'').replace(/\s+/g,'');
  if(!body) throw new Error('KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED');
  const raw=atob(body),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  return isPkcs1?pkcs1ToPkcs8(bytes).buffer:bytes.buffer;
}

function assertPayload(kind,payload,scope) {
  if(!['ENTRY','EXIT'].includes(kind)) throw new Error('PAYNE_WRITE_KIND_REJECTED');
  if(scope?.owner!==PAYNE_OWNER) throw new Error('PAYNE_WRITE_OWNER_REJECTED');
  if(Number(scope?.exchangeIndex)!==REQUIRED_EXCHANGE_INDEX) throw new Error('PAYNE_WRITE_INDEX2_REQUIRED');
  if(scope?.authorized!==true) throw new Error('PAYNE_WRITE_AUTHORIZATION_REQUIRED');
  if(!payload || typeof payload!=='object') throw new Error('PAYNE_WRITE_PAYLOAD_REQUIRED');
  if(!payload.ticker || !payload.client_order_id) throw new Error('PAYNE_WRITE_IDENTITY_REQUIRED');
  if(String(payload.time_in_force)!=='immediate_or_cancel') throw new Error('PAYNE_WRITE_IOC_REQUIRED');
  if(payload.post_only!==false) throw new Error('PAYNE_WRITE_POST_ONLY_FALSE_REQUIRED');
  if(payload.cancel_order_on_pause!==true) throw new Error('PAYNE_WRITE_CANCEL_ON_PAUSE_REQUIRED');
  if(!['bid','ask'].includes(String(payload.side))) throw new Error('PAYNE_WRITE_SIDE_REJECTED');
  const count=Number(payload.count),price=Number(payload.price);
  if(!(count>0)||!(price>0&&price<1)) throw new Error('PAYNE_WRITE_SIZE_OR_PRICE_REJECTED');

  if(kind==='ENTRY'){
    if(scope?.armed!==true) throw new Error('PAYNE_ENTRY_ARM_REQUIRED');
    if(Number(scope?.attemptTarget)!==1 || Number(scope?.attemptsBefore)!==0) throw new Error('PAYNE_ENTRY_1X1_SCOPE_REQUIRED');
    if(Number(scope?.maxEntryDebitUsd)!==1) throw new Error('PAYNE_ENTRY_ONE_DOLLAR_CAP_REQUIRED');
    if(payload.reduce_only!==false) throw new Error('PAYNE_ENTRY_REDUCE_ONLY_FALSE_REQUIRED');
  } else {
    if(scope?.ownedByPayne!==true) throw new Error('PAYNE_EXIT_OWNERSHIP_REQUIRED');
    if(String(scope?.ownedTicker||'')!==String(payload.ticker)) throw new Error('PAYNE_EXIT_TICKER_SCOPE_REJECTED');
    if(payload.reduce_only!==true) throw new Error('PAYNE_EXIT_REDUCE_ONLY_REQUIRED');
  }
}

async function signedHeaders(env,method,path){
  if(method!==ALLOWED_METHOD || path!==ORDER_PATH) throw new Error('PAYNE_WRITE_FIXED_ORDER_PATH_REQUIRED');
  if(!env?.KALSHI_EXECUTION_KEY_ID || !env?.KALSHI_EXECUTION_PRIVATE_KEY) throw new Error('KALSHI_EXECUTION_CREDENTIALS_NOT_INSTALLED');
  const key=await crypto.subtle.importKey('pkcs8',decodePem(env.KALSHI_EXECUTION_PRIVATE_KEY),{name:'RSA-PSS',hash:'SHA-256'},false,['sign']);
  const ts=String(Date.now());
  const bytes=new TextEncoder().encode(ts+method+path);
  const signature=await crypto.subtle.sign({name:'RSA-PSS',saltLength:32},key,bytes);
  let binary=''; for(const b of new Uint8Array(signature)) binary+=String.fromCharCode(b);
  return {
    accept:'application/json',
    'content-type':'application/json',
    'KALSHI-ACCESS-KEY':String(env.KALSHI_EXECUTION_KEY_ID).trim(),
    'KALSHI-ACCESS-TIMESTAMP':ts,
    'KALSHI-ACCESS-SIGNATURE':btoa(binary),
  };
}

export function payneOrderWriteProof(kind,payload,scope){
  assertPayload(kind,payload,scope);
  return {
    owner:PAYNE_OWNER,
    kind,
    method:ALLOWED_METHOD,
    path:ORDER_PATH,
    exchangeIndex:REQUIRED_EXCHANGE_INDEX,
    ticker:String(payload.ticker),
    clientOrderId:String(payload.client_order_id),
    count:Number(payload.count),
    price:Number(payload.price),
    timeInForce:payload.time_in_force,
    postOnly:payload.post_only,
    reduceOnly:payload.reduce_only,
  };
}

export async function kalshiPayneOrderPost(env,kind,payload,scope,{fetchImpl=fetch}={}){
  const proof=payneOrderWriteProof(kind,payload,scope);
  const headers=await signedHeaders(env,ALLOWED_METHOD,ORDER_PATH);
  const response=await fetchImpl(KALSHI_ORIGIN+ORDER_PATH,{method:ALLOWED_METHOD,headers,body:JSON.stringify(payload)});
  if(!response || typeof response.ok!=='boolean') throw new Error('PAYNE_WRITE_INVALID_PROVIDER_RESPONSE');
  return {response,proof};
}

export const PAYNE_WRITE_CONTRACT = Object.freeze({
  owner:PAYNE_OWNER,
  requiredExchangeIndex:REQUIRED_EXCHANGE_INDEX,
  method:ALLOWED_METHOD,
  orderPath:ORDER_PATH,
  operations:Object.freeze(['ENTRY','EXIT']),
});
