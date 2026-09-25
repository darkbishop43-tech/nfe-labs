// Market Edge sibling cloud executor — PAPER ONLY.
// Deploy as a NEW Cloudflare Worker. Do not replace the frozen baseline Worker.
// Required KV binding: SIBLING_STATE (a new namespace, separate from baseline KV).
// Reads baseline /api/state as a READ-ONLY shared market snapshot.

const FEED='https://market-edge-lab.darkbishop43.workers.dev/api/state';
const MAX_STAKE=5, MAX_OPEN=6, MAX_HOLD_MS=5*60*1000, COOLDOWN_MS=5*60*1000;
const labs=['nfe_reasoning','payne_method','adaptive_market_lab'];
const PAPER_THRESHOLD_ALLOWED=['payne_method','adaptive_market_lab'];
const PAPER_THRESHOLD_VALUES=[.50,.55,.60,.65,.70,.75,.80,.85,.90];
const PAPER_THRESHOLD_PREFIX='control:paper_threshold:';
const paperThresholdValid=v=>PAPER_THRESHOLD_VALUES.some(x=>Math.abs(Number(v)-x)<1e-9);
const paperThresholdKey=lab=>PAPER_THRESHOLD_PREFIX+lab;
async function loadPaperThreshold(env,lab){
  if(!PAPER_THRESHOLD_ALLOWED.includes(lab))return{supported:false,lab,activeThreshold:null,status:'UNSUPPORTED'};
  const saved=await env.SIBLING_STATE.get(paperThresholdKey(lab),'json');
  const active=paperThresholdValid(saved?.activeThreshold)?Number(saved.activeThreshold):.80;
  return{supported:true,lab,activeThreshold:active,status:'VERIFIED',updatedAt:saved?.updatedAt||null};
}
async function setPaperThreshold(env,lab,requested){
  if(!PAPER_THRESHOLD_ALLOWED.includes(lab))return{ok:false,lab,status:'UNSUPPORTED_TARGET',requestedThreshold:Number(requested)};
  if(!paperThresholdValid(requested))return{ok:false,lab,status:'INVALID_THRESHOLD',requestedThreshold:Number(requested)};
  const previous=await loadPaperThreshold(env,lab),record={schema:'PAPER_THRESHOLD_V1',lab,activeThreshold:Number(requested),updatedAt:now(),scope:'PAPER_ONLY_NEW_ENTRIES'};
  await env.SIBLING_STATE.put(paperThresholdKey(lab),JSON.stringify(record));
  const verified=await loadPaperThreshold(env,lab);
  return{ok:verified.activeThreshold===Number(requested),lab,requestedThreshold:Number(requested),previousThreshold:previous.activeThreshold,activeThreshold:verified.activeThreshold,status:verified.activeThreshold===Number(requested)?'VERIFIED':'NOT_VERIFIED'};
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=v=>Number(v||0);
const q=o=>o.question||o.title||o.marketQuestion||o.slug||'Unknown market';
const asset=o=>o.asset||(/ethereum|\beth\b/i.test(q(o))?'ETH':'BTC');
const side=o=>o.side||(o.bear===true?'BELOW':(/\b(below|lower|under|down|fall|drop|decrease)\b/i.test(q(o))?'BELOW':'ABOVE'));
const price=o=>num(o.positionPrice??o.yesPrice??o.yes??o.price);
const score=o=>num(o.score??o.signalScore);
const edge=o=>num(o.edge);
const move=o=>num(o.move??o.assetMove??o.btcMove??o.ethMove);
const marketId=o=>String(o.id??o.marketId??o.conditionId??o.slug??q(o));
const key=o=>`${marketId(o)}:${o.positionOutcome||'YES'}:${side(o)}`;
const now=()=>new Date().toISOString();
function fresh(lab){return{mode:'PAPER_ONLY',lab,balance:100,realizedPnl:0,positions:[],ledger:[],trades:0,createdAt:now(),lastRunAt:null}}
function analyzePayne(o,entryThreshold=.80){const sc=score(o),ed=edge(o),mv=Math.abs(move(o));const radar=sc>=.50,lock=radar&&sc>=.65&&ed>0,trigger=lock&&sc>=entryThreshold&&mv>=.002;return{label:trigger?'PULL TRIGGER':lock?'LOCK IN':radar?'RADAR':'PASS',confidence:Math.round(sc*100),entryThreshold}}
function analyzeNfe(o,os){const a=asset(o),sd=side(o),sc=score(o),ed=edge(o);const peers=os.filter(x=>asset(x)===a&&side(x)===sd).sort((x,y)=>score(y)-score(x));const rank=Math.max(1,peers.findIndex(x=>key(x)===key(o))+1);const opposite=os.filter(x=>asset(x)===a&&side(x)!==sd).sort((x,y)=>score(y)-score(x))[0];const oppScore=opposite?score(opposite):null;let label='REJECT';if(sc>=.80&&ed>0&&rank===1&&(oppScore==null||sc>=oppScore+.05))label='ENTER';else if(sc>=.65||rank===1)label='WATCH';return{label,confidence:clamp(Math.round(sc*100),35,95),rank,oppositeScore:oppScore}}
function decision(lab,o,os,entryThreshold=.80){return (lab==='payne_method'||lab==='adaptive_market_lab')?analyzePayne(o,entryThreshold):analyzeNfe(o,os)}
function action(lab){return (lab==='payne_method'||lab==='adaptive_market_lab')?'PULL TRIGGER':'ENTER'}
function opps(s){const a=s?.opportunities||s?.eligible||s?.candidates||[];return Array.isArray(a)?a:[]}
function lastExit(st,k){return(st.ledger||[]).slice().reverse().find(x=>x.type==='PAPER_EXIT'&&x.oppKey===k)}
function close(st,p,o,reason){const exit=o?price(o):p.entry;if(!(exit>0)||!(p.entry>0))return false;const heldMs=Date.now()-Date.parse(p.entryTs),shares=p.stake/p.entry,exitValue=shares*exit,pnl=exitValue-p.stake;st.balance+=exitValue;st.realizedPnl+=pnl;st.trades=(st.trades||0)+1;st.ledger.push({type:'PAPER_EXIT',lab:st.lab,ts:now(),entryTs:p.entryTs,oppKey:p.oppKey,marketId:p.marketId,question:p.question,asset:p.asset,side:p.side,positionOutcome:p.positionOutcome,stake:p.stake,entry:p.entry,exit,score:p.score,edge:p.edge,heldMs,reason,pnl});st.positions=st.positions.filter(x=>x.oppKey!==p.oppKey);return true}
function open(st,o,d){const entry=price(o),stake=Math.min(MAX_STAKE,st.balance);if(!(entry>0&&entry<1)||stake<=0)return false;const p={oppKey:key(o),marketId:marketId(o),question:q(o),asset:asset(o),side:side(o),positionOutcome:o.positionOutcome||'YES',stake,entry,score:score(o),edge:edge(o),decision:d.label,decisionEvidence:d,entryTs:now()};st.balance-=stake;st.positions.push(p);st.ledger.push({type:'PAPER_ENTRY',lab:st.lab,ts:p.entryTs,...p});return true}
async function load(env,lab){const x=await env.SIBLING_STATE.get(`state:${lab}`,'json');return x||fresh(lab)}
async function save(env,lab,st){await env.SIBLING_STATE.put(`state:${lab}`,JSON.stringify(st))}
async function runLab(env,lab,s){const st=await load(env,lab),os=opps(s),thresholdState=await loadPaperThreshold(env,lab),entryThreshold=thresholdState.supported?thresholdState.activeThreshold:.80;for(const p of [...st.positions]){const o=os.find(x=>key(x)===p.oppKey),held=Date.now()-Date.parse(p.entryTs);if(held>=MAX_HOLD_MS)close(st,p,o,'max_hold');else if(!o)close(st,p,null,'market_missing');else{const originalEntryThreshold=paperThresholdValid(p.entryThreshold)?Number(p.entryThreshold):.80;const d=decision(lab,o,os,originalEntryThreshold);if(d.label!==action(lab))close(st,p,o,'decision_exit')}}
const openKeys=new Set(st.positions.map(p=>p.oppKey));for(const o of os.slice().sort((a,b)=>score(b)-score(a)||edge(b)-edge(a))){if(st.positions.length>=MAX_OPEN)break;const k=key(o);if(openKeys.has(k))continue;const d=decision(lab,o,os,entryThreshold);if(d.label!==action(lab))continue;const le=lastExit(st,k);if(le&&Date.now()-Date.parse(le.ts)<COOLDOWN_MS)continue;const before=st.positions.length;if(open(st,o,d)){openKeys.add(k);const p=st.positions[st.positions.length-1];if(st.positions.length>before&&p){p.entryThreshold=entryThreshold;const le=st.ledger[st.ledger.length-1];if(le?.type==='PAPER_ENTRY')le.entryThreshold=entryThreshold;}}}st.activeEntryThreshold=entryThreshold;st.thresholdRuntimeVerified=true;st.lastRunAt=now();st.sharedSnapshotAt=s.lastRunAt||s.updatedAt||null;await save(env,lab,st);return st}
async function run(env){const r=await fetch(FEED,{headers:{accept:'application/json'},cf:{cacheTtl:0}});if(!r.ok)throw Error(`shared feed ${r.status}`);const s=await r.json();const result={};for(const lab of labs)result[lab]=await runLab(env,lab,s);return result}

const CALIBRATION_KEY='state:adaptive_market_lab:execution_calibration:v1';
const CALIBRATION_MIN_SCORE=.50;
const CALIBRATION_MAX_ROWS=250;
const KALSHI_PUBLIC='https://api.elections.kalshi.com/trade-api/v2';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const prob=v=>{const n=Number(v);if(!Number.isFinite(n))return null;if(n>1&&n<=100)return n/100;return n>=0&&n<=1?n:null};
function calFresh(){return{mode:'PAPER_EXECUTION_CALIBRATION',paperOnly:true,provider:'KALSHI_READ_ONLY',minScore:CALIBRATION_MIN_SCORE,observations:[],count:0,exactAskCaptureProxy:0,plusOneCaptureProxy:0,lastRunAt:null,status:'WAITING_FOR_QUALIFYING_OPPORTUNITY'}}
async function calLoad(env){return await env.SIBLING_STATE.get(CALIBRATION_KEY,'json')||calFresh()}
async function calSave(env,st){await env.SIBLING_STATE.put(CALIBRATION_KEY,JSON.stringify(st))}
function calSelected(m,outcome){
  const yesBid=prob(m?.yes_bid_dollars??m?.yes_bid),yesAsk=prob(m?.yes_ask_dollars??m?.yes_ask);
  const noBid=prob(m?.no_bid_dollars??m?.no_bid),noAsk=prob(m?.no_ask_dollars??m?.no_ask);
  const side=String(outcome||'YES').toUpperCase();
  return {yesBid,yesAsk,noBid,noAsk,bid:side==='NO'?noBid:yesBid,ask:side==='NO'?noAsk:yesAsk}
}
async function calMarket(ticker){
  const requestedAtMs=Date.now();
  const r=await fetch(KALSHI_PUBLIC+'/markets/'+encodeURIComponent(ticker),{method:'GET',headers:{accept:'application/json'}});
  const receivedAtMs=Date.now();
  if(!r.ok)return{ok:false,httpStatus:r.status,requestedAtMs,receivedAtMs,error:'MARKET_READ_'+r.status};
  const body=await r.json(),m=body?.market||body;
  return{ok:true,httpStatus:r.status,requestedAtMs,receivedAtMs,market:m}
}
function calFee(price,count=1){const p=Number(price),c=Number(count);if(!(p>0&&p<1&&c>0))return null;return Math.ceil((.07*c*p*(1-p)-1e-12)*100)/100}
function calSize(price,cap=1){const p=Number(price);if(!(p>0&&p<1))return{count:0,premium:null,fee:null,debit:null};for(let c=Math.floor(cap/p);c>=1;c--){const premium=Number((c*p).toFixed(4)),fee=calFee(p,c),debit=Number((premium+fee).toFixed(4));if(fee!==null&&debit<=cap)return{count:c,premium,fee,debit}}return{count:0,premium:null,fee:null,debit:null}}
function calClass(limit,updatedAsk){return Number.isFinite(limit)&&Number.isFinite(updatedAsk)?(limit+1e-12>=updatedAsk?'REACHES OBSERVED ASK':'MISSES UPDATED ASK'):'UNKNOWN'}
async function runCalibration(env){
  const st=await calLoad(env);
  st.paperOnly=true;st.mode='PAPER_EXECUTION_CALIBRATION';st.provider='KALSHI_READ_ONLY';
  st.lastRunAt=now();
  let shadow;
  try{
    const r=await fetch('https://market-edge-baseline-real.darkbishop43.workers.dev/shadow-state',{method:'GET',headers:{accept:'application/json'}});
    if(!r.ok)throw Error('SHADOW_READ_'+r.status);
    shadow=await r.json();
  }catch(e){st.status='WAITING_SHADOW_READ';st.lastError=String(e?.message||e);await calSave(env,st);return st}
  const candidates=(Array.isArray(shadow?.opportunities)?shadow.opportunities:[])
    .filter(o=>Number(o?.score)>=CALIBRATION_MIN_SCORE&&o?.marketTicker&&(String(o?.outcomeSide).toUpperCase()==='YES'||String(o?.outcomeSide).toUpperCase()==='NO'))
    .sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
  const o=candidates[0];
  if(!o){st.status='WAITING_FOR_QUALIFYING_OPPORTUNITY';st.lastError=null;await calSave(env,st);return st}
  const ticker=String(o.marketTicker),outcome=String(o.outcomeSide).toUpperCase();
  const t0=await calMarket(ticker);
  if(!t0.ok){st.status='T0_QUOTE_FAILED';st.lastError=t0.error;await calSave(env,st);return st}
  const q0=calSelected(t0.market,outcome),ask0=Number(q0.ask),bid0=Number(q0.bid);
  if(!(ask0>0&&ask0<1)){st.status='T0_SELECTED_ASK_UNAVAILABLE';st.lastError=null;await calSave(env,st);return st}
  const fireAtMs=Date.now();
  const controlLimit=Number(ask0.toFixed(4));
  const plusOneLimit=Number(Math.min(.99,ask0+.01).toFixed(4));
  const controlYesLeg=outcome==='YES'?controlLimit:Number((1-controlLimit).toFixed(4));
  const plusOneYesLeg=outcome==='YES'?plusOneLimit:Number((1-plusOneLimit).toFixed(4));
  const sizing=calSize(controlLimit,1);
  await sleep(75);
  const t2=await calMarket(ticker);
  const q2=t2.ok?calSelected(t2.market,outcome):{bid:null,ask:null};
  const ask2=Number(q2.ask),bid2=Number(q2.bid);
  const spread0=Number.isFinite(ask0)&&Number.isFinite(bid0)?Number((ask0-bid0).toFixed(4)):null;
  const spread2=Number.isFinite(ask2)&&Number.isFinite(bid2)?Number((ask2-bid2).toFixed(4)):null;
  const row={
    observationNo:Number(st.count||0)+1,
    dataset:'PAPER_EXECUTION_CALIBRATION',
    paperOnly:true,
    createdAt:new Date(fireAtMs).toISOString(),
    asset:o?.asset||null,ticker,direction:outcome,score:Number(o?.score),
    t0:{quoteRequestedAtMs:t0.requestedAtMs,quoteReceivedAtMs:t0.receivedAtMs,bid:Number.isFinite(bid0)?bid0:null,ask:ask0,spread:spread0,quoteReadLatencyMs:t0.receivedAtMs-t0.requestedAtMs},
    hypothetical:{fireAtMs,elapsedFromT0ReceivedMs:fireAtMs-t0.receivedAtMs,count:sizing.count,debitUsd:sizing.debit,feeEstimateUsd:sizing.fee,
      control:{selectedSideLimit:controlLimit,kalshiYesLegPrice:controlYesLeg},
      plusOne:{selectedSideLimit:plusOneLimit,kalshiYesLegPrice:plusOneYesLeg}},
    t2:{quoteRequestedAtMs:t2.requestedAtMs,quoteReceivedAtMs:t2.receivedAtMs,bid:Number.isFinite(bid2)?bid2:null,ask:Number.isFinite(ask2)?ask2:null,spread:spread2,elapsedFromT0ReceivedMs:t2.receivedAtMs-t0.receivedAtMs,httpStatus:t2.httpStatus??null},
    controlClassification:calClass(controlLimit,ask2),
    plusOneClassification:calClass(plusOneLimit,ask2),
    priceMovement:Number.isFinite(ask2)?Number((ask2-ask0).toFixed(4)):null,
    spreadChange:Number.isFinite(spread0)&&Number.isFinite(spread2)?Number((spread2-spread0).toFixed(4)):null,
    note:'PAPER CAPTURE PROXY ONLY — no order submitted; quote reach is not a fill.'
  };
  st.observations=Array.isArray(st.observations)?st.observations:[];
  st.observations.push(row);if(st.observations.length>CALIBRATION_MAX_ROWS)st.observations=st.observations.slice(-CALIBRATION_MAX_ROWS);
  st.count=Number(st.count||0)+1;
  st.exactAskCaptureProxy=Number(st.exactAskCaptureProxy||0)+(row.controlClassification==='REACHES OBSERVED ASK'?1:0);
  st.plusOneCaptureProxy=Number(st.plusOneCaptureProxy||0)+(row.plusOneClassification==='REACHES OBSERVED ASK'?1:0);
  st.latest=row;st.status='LIVE';st.lastError=null;
  await calSave(env,st);return st
}

const json=x=>new Response(JSON.stringify(x,null,2),{headers:{'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'}});
export default {async scheduled(e,env,ctx){ctx.waitUntil(run(env));ctx.waitUntil(runCalibration(env))},async fetch(req,env){const u=new URL(req.url);try{
if(u.pathname==='/api/paper-thresholds'&&req.method==='GET')return json({mode:'PAPER_ONLY',allowlist:PAPER_THRESHOLD_ALLOWED,realTargetsAccepted:false,thresholds:{payne_method:await loadPaperThreshold(env,'payne_method'),adaptive_market_lab:await loadPaperThreshold(env,'adaptive_market_lab')}});
if(u.pathname==='/api/paper-threshold'&&req.method==='POST'){const b=await req.json().catch(()=>({}));if(!PAPER_THRESHOLD_ALLOWED.includes(String(b?.lab||'')))return new Response(JSON.stringify({ok:false,status:'UNSUPPORTED_TARGET',realTargetsAccepted:false}),{status:400,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});if(!paperThresholdValid(b?.threshold))return new Response(JSON.stringify({ok:false,lab:String(b.lab),status:'INVALID_THRESHOLD',requestedThreshold:Number(b?.threshold),realTargetsAccepted:false}),{status:400,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});return json(await setPaperThreshold(env,String(b.lab),Number(b.threshold)));}
if(u.pathname==='/api/paper-thresholds/apply-all'&&req.method==='POST'){const b=await req.json().catch(()=>({}));if(!paperThresholdValid(b?.threshold))return new Response(JSON.stringify({ok:false,status:'INVALID_THRESHOLD',realTargetsAccepted:false}),{status:400,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});const results=[];for(const lab of PAPER_THRESHOLD_ALLOWED)results.push(await setPaperThreshold(env,lab,Number(b.threshold)));return json({ok:results.every(x=>x.ok),scope:'SUPPORTED_PAPER_LABS_ONLY',realTargetsAccepted:false,requestedThreshold:Number(b.threshold),results});}
if(u.pathname==='/api/calibration/run')return json(await runCalibration(env));if(u.pathname==='/api/calibration/state')return json(await calLoad(env));if(u.pathname==='/api/run')return json(await run(env));if(u.pathname==='/api/state/nfe')return json(await load(env,'nfe_reasoning'));if(u.pathname==='/api/state/payne')return json(await load(env,'payne_method'));if(u.pathname==='/api/state/adaptive')return json(await load(env,'adaptive_market_lab'));if(u.pathname==='/api/state')return json({nfe:await load(env,'nfe_reasoning'),payne:await load(env,'payne_method'),adaptive:await load(env,'adaptive_market_lab')});return json({name:'NFE-OS Market Edge Sibling Cloud Executor',mode:'PAPER_ONLY',baseline:'UNTOUCHED',routes:['/api/run','/api/state','/api/state/nfe','/api/state/payne','/api/state/adaptive','/api/paper-thresholds','/api/paper-threshold','/api/paper-thresholds/apply-all','/api/calibration/run','/api/calibration/state']})}catch(e){return new Response(JSON.stringify({ok:false,error:String(e?.message||e)}),{status:500,headers:{'content-type':'application/json','access-control-allow-origin':'*'}})}}};
