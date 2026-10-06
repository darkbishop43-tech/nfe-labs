import {
  KALSHI_EXECUTION_ORDER_PATH,
  kalshiExecutionOrderPost,
} from '../../shared/kalshi-execution-write.js';

const ALLOWED_METHOD='POST';
const PAYNE_OWNER='PAYNE_KALSHI_REAL';
const REQUIRED_EXCHANGE_INDEX=2;

function assertPayneGovernance(kind,payload,scope){
  if(!['ENTRY','EXIT'].includes(kind))throw new Error('PAYNE_WRITE_KIND_REJECTED');
  if(scope?.owner!==PAYNE_OWNER)throw new Error('PAYNE_WRITE_OWNER_REJECTED');
  if(Number(scope?.exchangeIndex)!==REQUIRED_EXCHANGE_INDEX)throw new Error('PAYNE_WRITE_INDEX2_REQUIRED');
  if(scope?.authorized!==true)throw new Error('PAYNE_WRITE_AUTHORIZATION_REQUIRED');

  // Provider-mechanical payload validation is owned by the shared primitive.

  if(kind==='ENTRY'){
    if(scope?.armed!==true)throw new Error('PAYNE_ENTRY_ARM_REQUIRED');
    const target=Number(scope?.attemptTarget),before=Number(scope?.attemptsBefore);
    const cap=Number(scope?.maxEntryDebitUsd),entryDebitUsd=Number(scope?.entryDebitUsd);
    if(scope?.seriesConfigFrozen!==true)throw new Error('PAYNE_ENTRY_SERIES_CONFIG_NOT_FROZEN');
    if(!Number.isInteger(target)||target<1||!Number.isInteger(before)||before<0||before>=target)throw new Error('PAYNE_ENTRY_SERIES_ATTEMPT_NOT_AUTHORIZED');
    if(scope?.priorAttemptClean!==true)throw new Error('PAYNE_ENTRY_PRIOR_ATTEMPT_NOT_CLEAN');
    if(!Number.isFinite(cap)||!(cap>0))throw new Error('PAYNE_ENTRY_SERIES_STAKE_CAP_INVALID');
    if(!Number.isFinite(entryDebitUsd)||!(entryDebitUsd>0))throw new Error('PAYNE_ENTRY_DEBIT_EVIDENCE_REQUIRED');
    if(entryDebitUsd>cap+1e-9)throw new Error('PAYNE_ENTRY_EXCEEDS_SERIES_STAKE_CAP');
    if(payload.reduce_only!==false)throw new Error('PAYNE_ENTRY_REDUCE_ONLY_FALSE_REQUIRED');
  }else{
    if(scope?.ownedByPayne!==true)throw new Error('PAYNE_EXIT_OWNERSHIP_REQUIRED');
    if(String(scope?.ownedTicker||'')!==String(payload.ticker))throw new Error('PAYNE_EXIT_TICKER_SCOPE_REJECTED');
    if(payload.reduce_only!==true)throw new Error('PAYNE_EXIT_REDUCE_ONLY_REQUIRED');
  }
}

export function payneOrderWriteProof(kind,payload,scope){
  assertPayneGovernance(kind,payload,scope);
  return {
    owner:PAYNE_OWNER,
    kind,
    method:ALLOWED_METHOD,
    path:KALSHI_EXECUTION_ORDER_PATH,
    exchangeIndex:REQUIRED_EXCHANGE_INDEX,
    ticker:String(payload.ticker),
    clientOrderId:String(payload.client_order_id),
    count:Number(payload.count),
    price:Number(payload.price),
    entryDebitUsd:kind==='ENTRY'?Number(scope?.entryDebitUsd):null,
    timeInForce:payload.time_in_force,
    postOnly:payload.post_only,
    reduceOnly:payload.reduce_only,
    mechanicalWriter:'SHARED_KALSHI_EXECUTION_ORDER_POST',
  };
}

export async function kalshiPayneOrderPost(env,kind,payload,scope,{fetchImpl=fetch}={}){
  let writerInvoked=false,providerPostStarted=false;
  try{
    const proof=payneOrderWriteProof(kind,payload,scope);
    writerInvoked=true;
    const response=await kalshiExecutionOrderPost(env,payload,{fetchImpl,onProviderPostStart:()=>{providerPostStarted=true;}});
    return {response,proof,writerInvoked,providerPostStarted};
  }catch(error){
    if(error&&typeof error==='object'){
      error.payneWriterInvoked=writerInvoked;
      error.payneProviderPostStarted=providerPostStarted;
    }
    throw error;
  }
}

export const PAYNE_WRITE_CONTRACT=Object.freeze({
  owner:PAYNE_OWNER,
  requiredExchangeIndex:REQUIRED_EXCHANGE_INDEX,
  method:ALLOWED_METHOD,
  orderPath:KALSHI_EXECUTION_ORDER_PATH,
  operations:Object.freeze(['ENTRY','EXIT']),
  mechanicalWriter:'SHARED_KALSHI_EXECUTION_ORDER_POST',
});
