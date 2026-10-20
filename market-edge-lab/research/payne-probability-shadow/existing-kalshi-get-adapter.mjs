// Research-only adapter to the EXISTING PAYNE authenticated GET-only utility.
// Uses existing env secret names; adds no credentials, services or auth logic.
// No imports from PAYNE trading controllers, order writers or AUTO.
import {kalshiGetOnly} from '../../real/payne-kalshi-real/src/kalshi-get-only.js';
import {collectReadOnly} from './read-only-observation-collector.mjs';
const ALLOWED=/^\/trade-api\/v2\/markets(?:\?(?:[^#]*))?$|^\/trade-api\/v2\/markets\/[A-Z0-9_-]{4,160}(?:\/orderbook)?$/;
export function existingAuthenticatedMarketGet(env,{fetchImpl=fetch}={}){
  return async function get(path){
    if(!ALLOWED.test(path))throw Error('RESEARCH_GET_PATH_REJECTED');
    const response=await kalshiGetOnly(env,path,fetchImpl);
    if(!response.ok)throw Error('KALSHI_READ_FAILED_HTTP_'+response.status);
    return response.json();
  };
}
export function collectUsingExistingKalshiGet({env,fetchImpl,seriesTickers,underlyingAt,volatilityAt,now}={}){
  return collectReadOnly({
    get:existingAuthenticatedMarketGet(env,{fetchImpl}),
    seriesTickers,underlyingAt,volatilityAt,now
  });
}
