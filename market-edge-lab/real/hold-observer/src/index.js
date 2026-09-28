const DEFAULT_HOLD_MS=5*60*1000;
const CHECKPOINTS=[['5:00',300000],['5:30',330000],['6:00',360000]];
const CURRENT_KEY='hold-observer:v1:current';
const LAST_CLOSED_KEY='hold-observer:v1:last-closed';
const PREFIX='hold-observer:v1:evidence:';
const CORS={'access-control-allow-origin':'https://raw.githack.com','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type','cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'};
const j=(x,s=200)=>new Response(JSON.stringify(x,null,2),{status:s,headers:CORS});
const ms=v=>{const n=typeof v==='number'?v:Date.parse(String(v||''));return Number.isFinite(n)?n:null};
const arr=v=>Array.isArray(v)?v:[];
const safe=v=>Number.isFinite(Number(v))?Number(v):null;
const tickerOf=x=>String(x?.ticker||x?.marketTicker||x?.market_ticker||'');
const sideOf=x=>String(x?.outcomeSide||x?.side||'').toUpperCase();
function assetOf(t){const m=String(t||'').match(/^KX([A-Z]+)15M-/);return m?m[1]:null}
async function readBridge(env,path){
  const r=await env.READ.fetch(new Request('https://market-edge-founder-read.internal'+path,{method:'GET',headers:{accept:'application/json'}}));
  if(!r.ok)throw new Error('READ_'+path+'_'+r.status);
  return await r.json();
}
function providerPositions(h){return arr(h?.positions||h?.marketPositions||h?.market_positions)}
function providerFills(h){return [...arr(h?.fills),...arr(h?.historicalFills)]}
function providerSettlements(h){return arr(h?.settlements)}
function openLocalPositions(state){return arr(state?.positions).filter(p=>String(p?.status||'').toUpperCase()!=='CLOSED'&&Number(p?.filledCount||0)>0)}
function providerOwns(history,p){const t=tickerOf(p);return providerPositions(history).some(r=>tickerOf(r)===t)}
function entryFill(history,p){const oid=String(p?.entryOrderId||'');if(!oid)return null;return providerFills(history).find(f=>tickerOf(f)===tickerOf(p)&&String(f?.orderId||f?.order_id||'')===oid)||null}
function quoteFor(shadow,p){const t=tickerOf(p),s=sideOf(p);const o=arr(shadow?.opportunities).find(x=>tickerOf(x)===t&&(!s||sideOf(x)===s))||null;return o?{score:safe(o.score),yesBid:safe(o.yesBid??o.bid),yesAsk:safe(o.yesAsk??o.yes),noBid:safe(o.noBid),noAsk:safe(o.noAsk),closeTime:o.closeTime||null}:null}
function publicPosition(state,history,shadow,p,now=Date.now()){
  const owned=providerOwns(history,p);if(!owned)return null;
  const ef=entryFill(history,p);const entryAt=ms(ef?.createdAt||ef?.created_time)||null;
  const q=quoteFor(shadow,p);const deadline=entryAt!==null?entryAt+DEFAULT_HOLD_MS:null;
  return {positionId:p.id||p.positionId||null,entryOrderId:p.entryOrderId||null,exitOrderId:p.exitOrderId||null,ticker:tickerOf(p),asset:p.asset||assetOf(tickerOf(p)),side:p.outcomeSide||p.side||null,seriesId:state?.seriesId||null,attempt:p.attemptNo??null,entryScore:safe(p.entryScore??p.liveScore??p.score),entryPrice:safe(p.entryAverageFillPrice??ef?.yesPrice??ef?.yes_price_dollars),quantity:safe(p.filledCount),entryTimestamp:entryAt!==null?new Date(entryAt).toISOString():null,providerCloseTime:p.closeTime||q?.closeTime||null,timeOwnedMs:entryAt!==null?Math.max(0,now-entryAt):null,currentMaxHoldDeadline:deadline!==null?new Date(deadline).toISOString():null,timeRemainingMs:deadline!==null?deadline-now:null,currentScore:q?.score??null,positionStatus:p.status||'OPEN',providerConfirmedOwnership:true,exitThreshold:0.20,defaultHoldMs:DEFAULT_HOLD_MS,holdExtensionActive:false,holdExtensionMutationEnabled:false};
}
async function currentSnapshot(env){
  const [state,history,shadow,lastRaw]=await Promise.all([readBridge(env,'/execution-test-state'),readBridge(env,'/forensic-provider-history?limit=200'),readBridge(env,'/shadow-state'),env.HOLD_EVIDENCE.get(LAST_CLOSED_KEY)]);
  const now=Date.now();const positions=openLocalPositions(state).map(p=>publicPosition(state,history,shadow,p,now)).filter(Boolean);
  let recentClosed=null;if(lastRaw){try{const x=JSON.parse(lastRaw);const at=ms(x?.observation?.actualExitTimestamp||x?.recordedAt);if(at!==null&&now-at<=30*60*1000)recentClosed=x}catch{}}
  return {ok:true,mode:'OBSERVATION_ONLY',updatedAt:new Date(now).toISOString(),positions,recentClosed,safety:{realDeadlineMutation:0,providerTradingWrites:0,executionStateWrites:0,capitalMovedUsd:0,ordersSubmitted:0,defaultHoldMs:DEFAULT_HOLD_MS,exitScore:0.20,armDisarm:'UNCHANGED'}};
}
async function record(env,position,label,observation){
  const key=PREFIX+encodeURIComponent(position.positionId||position.entryOrderId||position.ticker)+':'+label.replace(':','_');
  if(await env.HOLD_EVIDENCE.get(key))return false;
  const payload={schema:'HOLD_OBSERVATION_V1',eventType:label==='ACTUAL_EXIT'?'ACTUAL_EXIT':label==='PROVIDER_SETTLEMENT'?'PROVIDER_SETTLEMENT':observation?.positionStatus==='CLOSED'?'POST_EXIT_OBSERVATION':'HOLD_CHECKPOINT',checkpoint:label,recordedAt:new Date().toISOString(),position:{positionId:position.positionId,entryOrderId:position.entryOrderId,exitOrderId:position.exitOrderId,ticker:position.ticker,asset:position.asset,side:position.side,seriesId:position.seriesId,attempt:position.attempt,entryScore:position.entryScore??null,entryPrice:position.entryPrice??null,quantity:position.quantity??null,entryTimestamp:position.entryTimestamp,providerCloseTime:position.providerCloseTime,realMaxHoldDeadline:position.currentMaxHoldDeadline,defaultHoldMs:position.defaultHoldMs??DEFAULT_HOLD_MS,exitThreshold:position.exitThreshold??0.20},observation,safety:{providerTradingWrites:0,executionStateWrites:0,deadlineMutation:0}};
  await env.HOLD_EVIDENCE.put(key,JSON.stringify(payload));if(label==='ACTUAL_EXIT')await env.HOLD_EVIDENCE.put(LAST_CLOSED_KEY,JSON.stringify(payload));return true;
}
async function observePosition(env,ctx,label){
  const [state,history,shadow]=await Promise.all([readBridge(env,'/execution-test-state'),readBridge(env,'/forensic-provider-history?limit=200'),readBridge(env,'/shadow-state')]);
  const local=arr(state?.positions).find(p=>String(p?.id||p?.positionId||'')===String(ctx.positionId||''))||arr(state?.positions).find(p=>tickerOf(p)===ctx.ticker)||null;
  const q=local?quoteFor(shadow,local):arr(shadow?.opportunities).find(x=>tickerOf(x)===ctx.ticker)||null;
  const entry=ms(ctx.entryTimestamp);const now=Date.now();const providerStillOpen=providerPositions(history).some(r=>tickerOf(r)===ctx.ticker);const status=local?.status||(providerStillOpen?'OPEN':'CLOSED');
  const obs={timestamp:new Date(now).toISOString(),ticker:ctx.ticker,side:ctx.side,seriesId:ctx.seriesId,attempt:ctx.attempt,score:safe(q?.score),yesBid:safe(q?.yesBid??q?.bid),yesAsk:safe(q?.yesAsk??q?.yes),noBid:safe(q?.noBid),noAsk:safe(q?.noAsk),positionStatus:status,timeSinceEntryMs:entry!==null?now-entry:null,realCurrentMaxHoldDeadline:ctx.currentMaxHoldDeadline,providerCloseTime:ctx.providerCloseTime,actualExitTimestamp:local?.closedAt?new Date(Number(local.closedAt)).toISOString():null,settlementResult:null,targetCheckpoint:label};
  const settlement=providerSettlements(history).find(s=>tickerOf(s)===ctx.ticker);if(settlement)obs.settlementResult=settlement.marketResult??settlement.market_result??null;return {obs,state,history,local,settlement};
}
async function sync(env){
  const snap=await currentSnapshot(env);await env.HOLD_EVIDENCE.put(CURRENT_KEY,JSON.stringify(snap));for(const p of snap.positions){const id=env.HOLD_TIMER.idFromName(String(p.positionId||p.entryOrderId||p.ticker));await env.HOLD_TIMER.get(id).fetch('https://timer/sync',{method:'POST',body:JSON.stringify(p)});}return snap;
}
export class HoldTimer{
  constructor(state,env){this.state=state;this.env=env}
  async fetch(req){if(req.method!=='POST')return new Response('READ_ONLY_TIMER',{status:405});const ctx=await req.json();await this.state.storage.put('ctx',ctx);const existing=await this.state.storage.get('recorded')||{};if(!existing.ENTRY){const o=await observePosition(this.env,ctx,'ENTRY');await record(this.env,ctx,'ENTRY',o.obs);existing.ENTRY=true;await this.state.storage.put('recorded',existing)}await this.schedule(ctx,existing);return new Response('OK')}
  async schedule(ctx,recorded){const entry=ms(ctx.entryTimestamp);if(entry===null)return;const now=Date.now();for(const [label,off] of CHECKPOINTS){if(!recorded[label]){await this.state.storage.setAlarm(Math.max(now+1000,entry+off));return}}await this.state.storage.setAlarm(now+30000)}
  async alarm(){const ctx=await this.state.storage.get('ctx');if(!ctx)return;const recorded=await this.state.storage.get('recorded')||{};const entry=ms(ctx.entryTimestamp);const now=Date.now();for(const [label,off] of CHECKPOINTS){if(!recorded[label]&&entry!==null&&now>=entry+off){const o=await observePosition(this.env,ctx,label);await record(this.env,ctx,label,o.obs);recorded[label]=true}}
    const o=await observePosition(this.env,ctx,'POLL');if(String(o.obs.positionStatus).toUpperCase()==='CLOSED'&&!recorded.ACTUAL_EXIT){await record(this.env,ctx,'ACTUAL_EXIT',o.obs);recorded.ACTUAL_EXIT=true}if(o.settlement&&!recorded.PROVIDER_SETTLEMENT){await record(this.env,ctx,'PROVIDER_SETTLEMENT',{...o.obs,settlementResult:o.obs.settlementResult});recorded.PROVIDER_SETTLEMENT=true}await this.state.storage.put('recorded',recorded);const close=ms(ctx.providerCloseTime);if(recorded.PROVIDER_SETTLEMENT||(close!==null&&now>close+10*60*1000)){await this.state.storage.deleteAlarm();return}await this.schedule(ctx,recorded)
  }
}
export default{async scheduled(_event,env,ctx){ctx.waitUntil(sync(env))},async fetch(request,env){const u=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});if(request.method!=='GET')return j({ok:false,error:'READ_ONLY'},405);if(u.pathname==='/health')return j({ok:true,mode:'HOLD_OBSERVABILITY_ONLY',defaultHoldMs:DEFAULT_HOLD_MS,exitScore:0.20,realDeadlineMutation:0,providerTradingWrites:0,executionStateWrites:0});if(u.pathname==='/current'){const raw=await env.HOLD_EVIDENCE.get(CURRENT_KEY);return j(raw?JSON.parse(raw):{ok:true,mode:'OBSERVATION_ONLY',updatedAt:null,positions:[],recentClosed:null,state:'UNAVAILABLE',safety:{realDeadlineMutation:0,providerTradingWrites:0,executionStateWrites:0}})}if(u.pathname==='/evidence'){const pos=u.searchParams.get('position');if(!pos)return j({ok:false,error:'POSITION_REQUIRED'},400);const list=await env.HOLD_EVIDENCE.list({prefix:PREFIX+encodeURIComponent(pos)+':'});const rows=[];for(const k of list.keys){const raw=await env.HOLD_EVIDENCE.get(k.name);if(raw)rows.push(JSON.parse(raw))}return j({ok:true,position:pos,rows})}return j({ok:false,error:'NOT_FOUND'},404)}};
