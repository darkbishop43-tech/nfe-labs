// Market Edge sibling cloud executor — PAPER ONLY.
// Deploy as a NEW Cloudflare Worker. Do not replace the frozen baseline Worker.
// Required KV binding: SIBLING_STATE (a new namespace, separate from baseline KV).
// Reads baseline /api/state as a READ-ONLY shared market snapshot.

const FEED='https://market-edge-lab.darkbishop43.workers.dev/api/state';
const MAX_STAKE=5, MAX_OPEN=6, MAX_HOLD_MS=5*60*1000, COOLDOWN_MS=5*60*1000;
const labs=['nfe_reasoning','payne_method'];
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
function analyzePayne(o){const sc=score(o),ed=edge(o),mv=Math.abs(move(o));const radar=sc>=.50,lock=radar&&sc>=.65&&ed>0,trigger=lock&&sc>=.80&&mv>=.002;return{label:trigger?'PULL TRIGGER':lock?'LOCK IN':radar?'RADAR':'PASS',confidence:Math.round(sc*100)}}
function analyzeNfe(o,os){const a=asset(o),sd=side(o),sc=score(o),ed=edge(o);const peers=os.filter(x=>asset(x)===a&&side(x)===sd).sort((x,y)=>score(y)-score(x));const rank=Math.max(1,peers.findIndex(x=>key(x)===key(o))+1);const opposite=os.filter(x=>asset(x)===a&&side(x)!==sd).sort((x,y)=>score(y)-score(x))[0];const oppScore=opposite?score(opposite):null;let label='REJECT';if(sc>=.80&&ed>0&&rank===1&&(oppScore==null||sc>=oppScore+.05))label='ENTER';else if(sc>=.65||rank===1)label='WATCH';return{label,confidence:clamp(Math.round(sc*100),35,95),rank,oppositeScore:oppScore}}
function decision(lab,o,os){return lab==='payne_method'?analyzePayne(o):analyzeNfe(o,os)}
function action(lab){return lab==='payne_method'?'PULL TRIGGER':'ENTER'}
function opps(s){const a=s?.opportunities||s?.eligible||s?.candidates||[];return Array.isArray(a)?a:[]}
function lastExit(st,k){return(st.ledger||[]).slice().reverse().find(x=>x.type==='PAPER_EXIT'&&x.oppKey===k)}
function close(st,p,o,reason){const exit=o?price(o):p.entry;if(!(exit>0)||!(p.entry>0))return false;const heldMs=Date.now()-Date.parse(p.entryTs),shares=p.stake/p.entry,exitValue=shares*exit,pnl=exitValue-p.stake;st.balance+=exitValue;st.realizedPnl+=pnl;st.trades=(st.trades||0)+1;st.ledger.push({type:'PAPER_EXIT',lab:st.lab,ts:now(),entryTs:p.entryTs,oppKey:p.oppKey,marketId:p.marketId,question:p.question,asset:p.asset,side:p.side,positionOutcome:p.positionOutcome,stake:p.stake,entry:p.entry,exit,score:p.score,edge:p.edge,heldMs,reason,pnl});st.positions=st.positions.filter(x=>x.oppKey!==p.oppKey);return true}
function open(st,o,d){const entry=price(o),stake=Math.min(MAX_STAKE,st.balance);if(!(entry>0&&entry<1)||stake<=0)return false;const p={oppKey:key(o),marketId:marketId(o),question:q(o),asset:asset(o),side:side(o),positionOutcome:o.positionOutcome||'YES',stake,entry,score:score(o),edge:edge(o),decision:d.label,decisionEvidence:d,entryTs:now()};st.balance-=stake;st.positions.push(p);st.ledger.push({type:'PAPER_ENTRY',lab:st.lab,ts:p.entryTs,...p});return true}
async function load(env,lab){const x=await env.SIBLING_STATE.get(`state:${lab}`,'json');return x||fresh(lab)}
async function save(env,lab,st){await env.SIBLING_STATE.put(`state:${lab}`,JSON.stringify(st))}
async function runLab(env,lab,s){const st=await load(env,lab),os=opps(s);for(const p of [...st.positions]){const o=os.find(x=>key(x)===p.oppKey),held=Date.now()-Date.parse(p.entryTs),d=o?decision(lab,o,os):{label:'MISSING'};if(held>=MAX_HOLD_MS)close(st,p,o,'max_hold');else if(!o)close(st,p,null,'market_missing');else if(d.label!==action(lab))close(st,p,o,'decision_exit')}
const openKeys=new Set(st.positions.map(p=>p.oppKey));for(const o of os.slice().sort((a,b)=>score(b)-score(a)||edge(b)-edge(a))){if(st.positions.length>=MAX_OPEN)break;const k=key(o);if(openKeys.has(k))continue;const d=decision(lab,o,os);if(d.label!==action(lab))continue;const le=lastExit(st,k);if(le&&Date.now()-Date.parse(le.ts)<COOLDOWN_MS)continue;if(open(st,o,d))openKeys.add(k)}st.lastRunAt=now();st.sharedSnapshotAt=s.lastRunAt||s.updatedAt||null;await save(env,lab,st);return st}
async function run(env){const r=await fetch(FEED,{headers:{accept:'application/json'},cf:{cacheTtl:0}});if(!r.ok)throw Error(`shared feed ${r.status}`);const s=await r.json();const result={};for(const lab of labs)result[lab]=await runLab(env,lab,s);return result}
const json=x=>new Response(JSON.stringify(x,null,2),{headers:{'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'}});
export default {async scheduled(e,env,ctx){ctx.waitUntil(run(env))},async fetch(req,env){const u=new URL(req.url);try{if(u.pathname==='/api/run')return json(await run(env));if(u.pathname==='/api/state/nfe')return json(await load(env,'nfe_reasoning'));if(u.pathname==='/api/state/payne')return json(await load(env,'payne_method'));if(u.pathname==='/api/state')return json({nfe:await load(env,'nfe_reasoning'),payne:await load(env,'payne_method')});return json({name:'NFE-OS Market Edge Sibling Cloud Executor',mode:'PAPER_ONLY',baseline:'UNTOUCHED',routes:['/api/run','/api/state','/api/state/nfe','/api/state/payne']})}catch(e){return new Response(JSON.stringify({ok:false,error:String(e?.message||e)}),{status:500,headers:{'content-type':'application/json','access-control-allow-origin':'*'}})}}};
