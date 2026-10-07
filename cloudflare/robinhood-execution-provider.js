const BASE_URL = 'https://trading.robinhood.com';

function b64ToBytes(s){
  const bin = atob(String(s || '').trim());
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes){
  let s=''; for(const b of new Uint8Array(bytes)) s+=String.fromCharCode(b); return btoa(s);
}
function seedToPkcs8(seed){
  if(seed.length!==32) throw new Error('ROBINHOOD_CRYPTO_PRIVATE_KEY must decode to a 32-byte Ed25519 seed');
  const prefix=new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
  const out=new Uint8Array(prefix.length+seed.length); out.set(prefix,0); out.set(seed,prefix.length); return out;
}
async function importSigningKey(privateKeyBase64){
  return crypto.subtle.importKey('pkcs8',seedToPkcs8(b64ToBytes(privateKeyBase64)),{name:'Ed25519'},false,['sign']);
}
function requireSecrets(env){
  if(!env.ROBINHOOD_CRYPTO_API_KEY||!env.ROBINHOOD_CRYPTO_PRIVATE_KEY) throw new Error('ROBINHOOD_EXECUTION_SECRETS_MISSING');
}
async function signedRequest(env, method, path, body=null){
  requireSecrets(env);
  const timestamp=String(Math.floor(Date.now()/1000));
  const bodyText=body==null?'':JSON.stringify(body);
  const message=env.ROBINHOOD_CRYPTO_API_KEY+timestamp+path+method+bodyText;
  const key=await importSigningKey(env.ROBINHOOD_CRYPTO_PRIVATE_KEY);
  const signature=await crypto.subtle.sign('Ed25519',key,new TextEncoder().encode(message));
  const headers={
    'x-api-key':env.ROBINHOOD_CRYPTO_API_KEY,
    'x-signature':bytesToB64(signature),
    'x-timestamp':timestamp,
    'accept':'application/json'
  };
  if(body!=null) headers['content-type']='application/json';
  // A write whose outcome we cannot see (network error, timeout, 5xx, 408) is AMBIGUOUS: the order may exist.
  // Only a definite 4xx rejection is a clean no-fill. Ambiguity routes to UNKNOWN + reconciliation, never a retry.
  let r;
  try{ r=await fetch(BASE_URL+path,{method,headers,body:body==null?undefined:bodyText}); }
  catch(err){ const e=new Error('ROBINHOOD_NETWORK_ERROR:'+String(err?.message||err)); e.ambiguous=method!=='GET'; throw e; }
  let text; try{ text=await r.text(); }catch(err){ const e=new Error('ROBINHOOD_RESPONSE_READ_ERROR'); e.status=r.status; e.ambiguous=method!=='GET'; throw e; }
  let parsed; try{parsed=JSON.parse(text)}catch{parsed={raw:text}};
  if(!r.ok){ const e=new Error('ROBINHOOD_API_HTTP_'+r.status); e.status=r.status; e.providerBody=parsed; e.ambiguous=method!=='GET'&&(r.status>=500||r.status===408); throw e; }
  return parsed;
}

export function buildV2OrderBody(specimen){
  const {clientOrderId,side,type,symbol,orderConfig}=specimen;
  if(!clientOrderId||!['buy','sell'].includes(side)||!symbol||!type||!orderConfig) throw new Error('INVALID_ORDER_SPECIMEN');
  return {client_order_id:clientOrderId,side,type,symbol,[`${type}_order_config`]:orderConfig};
}

export function createRobinhoodExecutionProvider(env){
  return {
    kind:'REAL_ROBINHOOD_V2',
    async submitOrder(specimen){
      const path=`/api/v2/crypto/trading/orders/?account_number=${encodeURIComponent(specimen.accountNumber)}`;
      return signedRequest(env,'POST',path,buildV2OrderBody(specimen));
    },
    async getOrder({accountNumber,orderId}){
      const path=`/api/v2/crypto/trading/orders/${encodeURIComponent(orderId)}/?account_number=${encodeURIComponent(accountNumber)}`;
      return signedRequest(env,'GET',path);
    }
  };
}

export function createMockExecutionProvider(script=[]){
  let index=0; const calls=[];
  return {
    kind:'MOCK_ZERO_MONEY',
    calls,
    async submitOrder(specimen){
      calls.push({kind:'submitOrder',specimen:structuredClone(specimen)});
      const step=script[index++] ?? {state:'filled',id:`mock-${index}`};
      if(step.throw){ const e=new Error(step.throw); if(step.ambiguous) e.ambiguous=true; throw e; }
      return structuredClone(step);
    },
    async getOrder(input){
      calls.push({kind:'getOrder',input:structuredClone(input)});
      const step=script[index++] ?? {state:'filled',id:input.orderId};
      if(step.throw){ const e=new Error(step.throw); if(step.ambiguous) e.ambiguous=true; throw e; }
      return structuredClone(step);
    }
  };
}
