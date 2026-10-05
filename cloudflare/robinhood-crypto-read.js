const BASE_URL="https://trading.robinhood.com";

function b64ToBytes(s){
  const bin=atob(String(s||"").trim());
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes){
  let s="";
  for(const b of new Uint8Array(bytes)) s+=String.fromCharCode(b);
  return btoa(s);
}
function seedToPkcs8(seed){
  if(seed.length!==32) throw new Error("ROBINHOOD_CRYPTO_PRIVATE_KEY must decode to a 32-byte Ed25519 seed");
  const prefix=new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
  const out=new Uint8Array(prefix.length+seed.length);
  out.set(prefix,0); out.set(seed,prefix.length);
  return out;
}
async function importSigningKey(privateKeyBase64){
  const seed=b64ToBytes(privateKeyBase64);
  return crypto.subtle.importKey("pkcs8",seedToPkcs8(seed),{name:"Ed25519"},false,["sign"]);
}
function requireReadSecrets(env){
  if(!env.ROBINHOOD_CRYPTO_API_KEY||!env.ROBINHOOD_CRYPTO_PRIVATE_KEY){
    const e=new Error("ROBINHOOD_READ_SECRETS_MISSING");
    e.code="ROBINHOOD_READ_SECRETS_MISSING";
    throw e;
  }
}
function buildPath(path,params={}){
  const q=new URLSearchParams();
  for(const [k,v] of Object.entries(params)){
    if(v===undefined||v===null||v==="") continue;
    if(Array.isArray(v)) for(const item of v) q.append(k,String(item));
    else q.append(k,String(v));
  }
  const qs=q.toString();
  return qs?path+"?"+qs:path;
}
async function signedGet(env,path,params={}){
  requireReadSecrets(env);
  const signedPath=buildPath(path,params);
  const timestamp=String(Math.floor(Date.now()/1000));
  const message=env.ROBINHOOD_CRYPTO_API_KEY+timestamp+signedPath+"GET";
  const key=await importSigningKey(env.ROBINHOOD_CRYPTO_PRIVATE_KEY);
  const signature=await crypto.subtle.sign("Ed25519",key,new TextEncoder().encode(message));
  const r=await fetch(BASE_URL+signedPath,{
    method:"GET",
    headers:{
      "x-api-key":env.ROBINHOOD_CRYPTO_API_KEY,
      "x-signature":bytesToB64(signature),
      "x-timestamp":timestamp,
      "accept":"application/json"
    }
  });
  const text=await r.text();
  let body;
  try{body=JSON.parse(text)}catch{body={raw:text}};
  if(!r.ok){
    const e=new Error("ROBINHOOD_API_HTTP_"+r.status);
    e.status=r.status;
    e.providerBody=body;
    throw e;
  }
  return body;
}
function maskAccount(v){
  const s=String(v||"");
  return s?("••••"+s.slice(-4)):null;
}
function sanitizeAccount(x={}){
  return {
    account_number_masked:maskAccount(x.account_number),
    status:x.status??null,
    buying_power:x.buying_power??null,
    buying_power_currency:x.buying_power_currency??null,
    account_type:x.account_type??null,
    is_api_tradable:x.is_api_tradable??null,
    fee_tier_status:x.fee_tier_status??null
  };
}
function sanitizeOrder(x={}){
  return {
    id:x.id??null,
    account_number_masked:maskAccount(x.account_number),
    symbol:x.symbol??null,
    side:x.side??null,
    type:x.type??null,
    state:x.state??null,
    average_price:x.average_price??null,
    filled_asset_quantity:x.filled_asset_quantity??null,
    created_at:x.created_at??null,
    updated_at:x.updated_at??null,
    fee_charged:x.fee_charged??null,
    estimated_fee_remaining:x.estimated_fee_remaining??null,
    executions:x.executions??[]
  };
}
export async function readConnectorStatus(env){
  return {
    provider:"Robinhood Crypto Trading API v2",
    baseUrl:BASE_URL,
    credentialStorage:"Cloudflare Worker secrets only",
    apiKeyPresent:Boolean(env.ROBINHOOD_CRYPTO_API_KEY),
    privateKeyPresent:Boolean(env.ROBINHOOD_CRYPTO_PRIVATE_KEY),
    readOnlyConnector:true,
    writeRoutesPresent:false,
    execution:"DISARMED",
    fireAuthority:"ZERO"
  };
}
export async function readAccounts(env){
  const data=await signedGet(env,"/api/v2/crypto/trading/accounts/");
  return {...data,results:(data.results||[]).map(sanitizeAccount)};
}
export async function readPairs(env,symbols=[]){
  return signedGet(env,"/api/v2/crypto/trading/trading_pairs/",symbols.length?{symbol:symbols}:{});
}
export async function readBestBidAsk(env,symbols){
  if(!symbols?.length) throw new Error("symbol required");
  return signedGet(env,"/api/v2/crypto/marketdata/best_bid_ask/",{symbol:symbols});
}
export async function readEstimatedPrice(env,{symbol,side,quantity}){
  if(!symbol||!["bid","ask","both"].includes(side)||!quantity) throw new Error("symbol, side=bid|ask|both, and quantity are required");
  return signedGet(env,"/api/v2/crypto/trading/estimated_price/",{symbol,side,quantity});
}
export async function readHoldings(env,accountNumber,assetCodes=[]){
  if(!accountNumber) throw new Error("account_number required");
  const data=await signedGet(env,"/api/v2/crypto/trading/holdings/",{account_number:accountNumber,asset_code:assetCodes});
  return {...data,results:(data.results||[]).map(x=>({...x,account_number:undefined,account_number_masked:maskAccount(x.account_number)}))};
}
export async function readOrders(env,accountNumber,params={}){
  if(!accountNumber) throw new Error("account_number required");
  const data=await signedGet(env,"/api/v2/crypto/trading/orders/",{account_number:accountNumber,...params});
  return {...data,results:(data.results||[]).map(sanitizeOrder)};
}
export async function resolveSingleAccount(env){
  requireReadSecrets(env);
  const raw=await signedGet(env,"/api/v2/crypto/trading/accounts/");
  const rows=raw.results||[];
  if(rows.length!==1){
    const e=new Error("ROBINHOOD_ACCOUNT_BINDING_AMBIGUOUS");
    e.accountCount=rows.length;
    throw e;
  }
  return rows[0];
}
export async function readBoundHoldings(env,assetCodes=[]){
  const a=await resolveSingleAccount(env);
  const data=await readHoldings(env,a.account_number,assetCodes);
  return {account:sanitizeAccount(a),...data};
}
export async function readBoundOrders(env,params={}){
  const a=await resolveSingleAccount(env);
  const data=await readOrders(env,a.account_number,params);
  return {account:sanitizeAccount(a),...data};
}
