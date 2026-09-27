import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TZ='America/New_York';
const READ_BASE='https://market-edge-founder-read.darkbishop43.workers.dev';
const BASELINE='https://market-edge-baseline-real.darkbishop43.workers.dev';
const JSON_H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const HTML_H={'content-type':'text/html; charset=utf-8','cache-control':'no-store'};
const text=v=>v==null?'UNKNOWN':String(v);
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const money=v=>num(v)==null?'UNKNOWN':`${Number(v)>=0?'+':''}$${Number(v).toFixed(4)}`;

async function jget(url){
  try{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'NFE-Market-Edge-Reporting/1.0'}});if(!r.ok)return{__error:`HTTP_${r.status}`,__url:url};return await r.json();}
  catch(e){return{__error:e?.message||'FETCH_FAILED',__url:url};}
}
function localParts(ms=Date.now()){
  const p={};for(const x of new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms))) if(x.type!=='literal')p[x.type]=x.value;
  return p;
}
function ymd(p){return `${p.year}-${p.month}-${p.day}`}
function prevYmd(local){const d=new Date(Date.UTC(+local.year,+local.month-1,+local.day));d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
function arr(v){return Array.isArray(v)?v:[]}
function flattenAttempts(state){
  const out=[]; const push=x=>{if(x&&typeof x==='object')out.push(x)};
  arr(state?.attempts).forEach(push);arr(state?.history).forEach(h=>arr(h?.attempts).forEach(push));arr(state?.seriesHistory).forEach(h=>arr(h?.attempts).forEach(push));
  const seen=new Set();return out.filter(a=>{const k=String(a?.id||a?.attemptId||a?.orderId||`${a?.createdAt}|${a?.marketTicker}`);if(seen.has(k))return false;seen.add(k);return true});
}
function flattenPositions(state){
  const out=[];arr(state?.positions).forEach(x=>out.push(x));arr(state?.history).forEach(h=>arr(h?.positions).forEach(x=>out.push(x)));arr(state?.seriesHistory).forEach(h=>arr(h?.positions).forEach(x=>out.push(x)));return out;
}
async function gatherEvidence(reportingDate=null){
  const [exec,capital,real,nofill]=await Promise.all([
    jget(`${READ_BASE}/execution-test-state`),jget(`${READ_BASE}/founder-capital-ledger`),jget(`${READ_BASE}/real-trade-state`),jget(`${BASELINE}/execution-test-nofill-forensic`)
  ]);
  const s=exec?.state||{};const attempts=flattenAttempts(s);const positions=flattenPositions(s);
  const submitted=attempts.filter(a=>a?.providerOrderId||a?.entryOrderId||a?.orderId||a?.providerHttpStatus);
  const fills=attempts.filter(a=>Number(a?.fillCount??a?.filledCount??a?.filledQuantity??0)>0);
  const nofills=attempts.filter(a=>String(a?.status||'').toUpperCase()==='NO_FILL');
  const holds=attempts.filter(a=>String(a?.status||'').toUpperCase().includes('HOLD'));
  const errs=attempts.filter(a=>/ERROR|UNKNOWN|FAILED/.test(String(a?.status||'').toUpperCase()));
  const closed=positions.filter(p=>String(p?.status||'').toUpperCase()==='CLOSED');
  const open=positions.filter(p=>['OPEN','EXIT_RETRY','PARTIAL'].includes(String(p?.status||'').toUpperCase()));
  const winners=closed.filter(p=>num(p?.realizedPnlUsd??p?.realizedPnl)>0);const losers=closed.filter(p=>num(p?.realizedPnlUsd??p?.realizedPnl)<0);
  const pnlKnown=closed.map(p=>num(p?.realizedPnlUsd??p?.realizedPnl)).filter(v=>v!=null);
  const realized=pnlKnown.length?pnlKnown.reduce((a,b)=>a+b,0):num(capital?.sleeves?.AUTO_BASELINE?.realizedPnlUsd);
  const fees=num(capital?.sleeves?.AUTO_BASELINE?.feesUsd);
  const provider=capital?.provider||{};
  const currentSeries={seriesId:s?.seriesId??null,status:s?.status??null,armed:Boolean(s?.armed),threshold:num(s?.threshold??exec?.config?.entryScore),attemptsStarted:num(s?.attemptsStarted),maxAttempts:num(s?.maxAttempts),openPositions:num(s?.openPositions)};
  const dataStatus=[exec,capital].some(x=>x?.__error)?'PARTIAL':'COMPLETE';
  return {
    schema:'NFE_MARKET_EDGE_DAILY_LEDGER_V1',source:'LIVE_READ_ONLY_MARKET_EDGE_DATA',tradingAuthority:false,providerWrites:0,reportingTimezone:TZ,reportingDate:reportingDate||ymd(localParts()),generatedAt:new Date().toISOString(),dataStatus,
    sourceStatus:{execution:exec?.__error||'OK',capital:capital?.__error||'OK',realTrade:real?.__error||'OK',noFillForensic:nofill?.__error||'OK'},
    currentSeries,
    execution:{qualifiedAttempts:attempts.length,providerSubmissions:submitted.length,fills:fills.length,noFill:nofills.length,preSubmitHold:holds.length,errorUnknown:errs.length,fillCaptureRate:submitted.length?fills.length/submitted.length:null},
    trades:{filledPositions:fills.length,closedPositions:closed.length,openPositions:open.length,winners:winners.length,losers:losers.length,realizedPnlUsd:realized,feesUsd:fees,netRealResultUsd:realized,winRate:closed.length?winners.length/closed.length:null},
    capital:{providerCashUsd:num(provider?.cashUsd),accountValueUsd:num(provider?.accountValueUsd),openExposureUsd:num(provider?.openExposureUsd),reconciliationStatus:capital?.state||'UNKNOWN',unexplainedDifferenceUsd:null},
    attempts:attempts.slice(-100),positions:positions.slice(-100),noFillForensic:nofill?.attempts||nofill?.records||nofill,
    phase1:{status:'PARTIAL_WHERE_RECORDED',note:'Older records may PREDATE FEATURE. Pre-outcome decisions must not be retrofitted.',records:positions.filter(p=>p?.phase1A||p?.phase1B||p?.phase1a||p?.phase1b).map(p=>({id:p?.id||p?.positionId||null,ticker:p?.marketTicker||null,phase1A:p?.phase1A||p?.phase1a||null,phase1B:p?.phase1B||p?.phase1b||null}))},
    evidenceQuality:{providerOrdersReconciled:submitted.filter(a=>a?.providerOrderId||a?.entryOrderId||a?.orderId).length,providerOrdersExpected:submitted.length,filledPositionsReconciled:closed.length+open.length,filledPositionsExpected:fills.length,unknownRecords:errs.length},
    raw:{executionTest:exec,capitalLedger:capital,realTrade:real}
  };
}
function esc(s){return String(s??'UNKNOWN').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function pct(v){return num(v)==null?'UNKNOWN':`${(Number(v)*100).toFixed(1)}%`}
function html(snapshot, latestDate){
 const e=snapshot.execution,t=snapshot.trades,c=snapshot.capital,q=snapshot.evidenceQuality,cs=snapshot.currentSeries;
 const cards=[['Qualified attempts',e.qualifiedAttempts],['Provider submissions',e.providerSubmissions],['Fills',e.fills],['NO_FILL',e.noFill],['PRE_SUBMIT_HOLD',e.preSubmitHold],['Error / unknown',e.errorUnknown],['Fill capture',pct(e.fillCaptureRate)],['Closed positions',t.closedPositions],['Open positions',t.openPositions],['Winners / losers',`${t.winners} / ${t.losers}`],['Realized P/L',money(t.realizedPnlUsd)],['Fees',money(t.feesUsd)],['Provider cash',money(c.providerCashUsd)],['Account value',money(c.accountValueUsd)],['Open exposure',money(c.openExposureUsd)],['Reconciliation',c.reconciliationStatus]];
 return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>NFE-OS Market Edge Daily Ledger</title><style>body{margin:0;background:#080c10;color:#eef3f7;font:14px system-ui}.w{max-width:950px;margin:auto;padding:14px}.hero,.card,details{background:#12181f;border:1px solid #2b3742;border-radius:15px}.hero{padding:18px}.ey{color:#43d17d;font-weight:900;letter-spacing:.12em;font-size:11px}h1{margin:8px 0;font-size:27px}.warn{background:#10261a;border:1px solid #2d6845;color:#9af2bc;padding:10px;border-radius:10px;font-weight:800}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:14px}.card{padding:12px}.l{color:#95a4b2;font-size:10px;text-transform:uppercase}.v{font-size:22px;font-weight:900;margin-top:4px}.row{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #2b3742;padding:9px 0}.row:first-child{border:0}.sec{margin-top:16px}details{padding:0 12px;margin:8px 0}summary{padding:12px 0;font-weight:850}.muted{color:#9cabb7}.y{color:#f2c860}.g{color:#43d17d}a{color:#83c5ff}@media(min-width:720px){.grid{grid-template-columns:repeat(4,1fr)}}</style><main class=w><div class=hero><div class=ey>NFE-OS · MARKET EDGE</div><h1>DAILY EVIDENCE LEDGER</h1><div class=warn>LIVE READ-ONLY MARKET EDGE DATA · NO TRADING AUTHORITY · REPORTING ONLY</div><p>Reporting timezone: <b>${TZ}</b> · Current reporting date: <b>${esc(snapshot.reportingDate)}</b> · Data: <b>${esc(snapshot.dataStatus)}</b></p><p class=muted>Generated ${esc(snapshot.generatedAt)} · Current series ${esc(cs.seriesId)} · ${esc(cs.status)} · threshold ${esc(cs.threshold)} · attempts ${esc(cs.attemptsStarted)}/${esc(cs.maxAttempts)}</p></div><div class=grid>${cards.map(x=>`<div class=card><div class=l>${esc(x[0])}</div><div class=v>${esc(x[1])}</div></div>`).join('')}</div><section class=sec><h2>Execution evidence</h2><div class=card><div class=row><span>Provider orders reconciled</span><b>${q.providerOrdersReconciled}/${q.providerOrdersExpected}</b></div><div class=row><span>Filled positions reconciled</span><b>${q.filledPositionsReconciled}/${q.filledPositionsExpected}</b></div><div class=row><span>Unknown records</span><b>${q.unknownRecords}</b></div></div></section><section class=sec><h2>NO_FILL / attempts</h2>${snapshot.attempts.slice(-20).reverse().map(a=>`<details><summary>${esc(a?.asset)} · ${esc(a?.direction||a?.outcomeSide)} · ${esc(a?.status)}</summary><div class=row><span>Ticker</span><b>${esc(a?.marketTicker||a?.ticker)}</b></div><div class=row><span>Score</span><b>${esc(a?.score)}</b></div><div class=row><span>Provider order</span><b>${esc(a?.providerOrderId||a?.entryOrderId||a?.orderId||'NONE')}</b></div><div class=row><span>Fill count</span><b>${esc(a?.fillCount??a?.filledCount??0)}</b></div></details>`).join('')||'<div class=card>UNKNOWN / UNRECOVERED</div>'}</section><section class=sec><h2>Real trade ledger / Phase 1</h2>${snapshot.positions.slice(-20).reverse().map(p=>`<details><summary>${esc(p?.asset)} · ${esc(p?.direction||p?.outcomeSide)} · ${esc(p?.status)}</summary><div class=row><span>Ticker</span><b>${esc(p?.marketTicker)}</b></div><div class=row><span>Realized P/L</span><b>${esc(money(p?.realizedPnlUsd??p?.realizedPnl))}</b></div><div class=row><span>Exit reason</span><b>${esc(p?.exitReason||'UNKNOWN')}</b></div><div class=row><span>Phase 1</span><b>${p?.phase1A||p?.phase1B||p?.phase1a||p?.phase1b?'RECORDED':'NOT AVAILABLE — PREDATES FEATURE / UNRECORDED'}</b></div></details>`).join('')||'<div class=card>UNKNOWN / UNRECOVERED</div>'}</section><section class=sec><h2>Daily reports</h2><div class=card>${latestDate?`Latest finalized report: <a href="/reports/${latestDate}.pdf">market-edge-daily-${latestDate}.pdf</a> · <a href="/api/reports/${latestDate}.json">snapshot JSON</a>`:'No finalized daily report yet.'}</div></section></main>`;
}
async function buildPdf(s){
 const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);const bold=await doc.embedFont(StandardFonts.HelveticaBold);const lines=[];const add=(a,b='')=>lines.push([a,b]);
 add('NFE-OS MARKET EDGE','DAILY EVIDENCE LEDGER');add('Reporting date',s.reportingDate);add('Timezone',TZ);add('Snapshot',s.generatedAt);add('Data status',s.dataStatus);add('Reconciliation',s.capital.reconciliationStatus);add('Provider cash',money(s.capital.providerCashUsd));add('Account value',money(s.capital.accountValueUsd));add('Open exposure',money(s.capital.openExposureUsd));add('Qualified attempts',s.execution.qualifiedAttempts);add('Provider submissions',s.execution.providerSubmissions);add('Fills',s.execution.fills);add('NO_FILL',s.execution.noFill);add('PRE_SUBMIT_HOLD',s.execution.preSubmitHold);add('Fill capture',pct(s.execution.fillCaptureRate));add('Closed / open',`${s.trades.closedPositions} / ${s.trades.openPositions}`);add('Winners / losers',`${s.trades.winners} / ${s.trades.losers}`);add('Realized P/L',money(s.trades.realizedPnlUsd));add('Fees',money(s.trades.feesUsd));add('','');add('SOURCE','LIVE READ-ONLY MARKET EDGE DATA');add('TRADING AUTHORITY','NONE');add('Provider writes caused by reporting','0');add('Historical metadata','UNKNOWN / PREDATES FEATURE where unrecovered');
 let page=doc.addPage([612,792]),y=752;const draw=(a,b)=>{if(y<55){page=doc.addPage([612,792]);y=752}page.drawText(String(a),{x:40,y,size:10,font:a&&a===a.toUpperCase()?bold:font,color:rgb(.12,.15,.18)});page.drawText(String(b),{x:260,y,size:10,font:bold,color:rgb(.05,.25,.15)});y-=18};lines.forEach(x=>draw(...x));
 return await doc.save();
}
async function finalize(env,date){
 const s=await gatherEvidence(date);s.finalized=true;s.sourceEvidenceCutoff=s.generatedAt;s.snapshotId=`ME-${date}-${Date.parse(s.generatedAt)}`;s.reportVersion='ORIGINAL';
 const pdf=await buildPdf(s);await env.REPORTING.put(`snapshot:${date}`,JSON.stringify(s));await env.REPORTING.put(`pdf:${date}`,pdf.buffer.slice(pdf.byteOffset,pdf.byteOffset+pdf.byteLength));await env.REPORTING.put('latestDate',date);return s;
}
export default {
 async fetch(req,env){const u=new URL(req.url);
   if(u.pathname==='/health')return new Response(JSON.stringify({ok:true,mode:'MARKET_EDGE_REPORTING_ONLY',tradingAuthority:false,providerWrites:0,timezone:TZ}),{headers:JSON_H});
   if(u.pathname==='/api/live'){return new Response(JSON.stringify(await gatherEvidence(),null,2),{headers:JSON_H});}
   if(u.pathname==='/admin/finalize'&&req.method==='POST'){if(req.headers.get('x-report-token')!==env.REPORTING_ADMIN_TOKEN)return new Response('forbidden',{status:403});const d=u.searchParams.get('date')||prevYmd(localParts());return new Response(JSON.stringify(await finalize(env,d),null,2),{headers:JSON_H});}
   const m=u.pathname.match(/^\/api\/reports\/(\d{4}-\d{2}-\d{2})\.json$/);if(m){const v=await env.REPORTING.get(`snapshot:${m[1]}`);return new Response(v||JSON.stringify({ok:false,state:'REPORT_NOT_FOUND'}),{status:v?200:404,headers:JSON_H});}
   const p=u.pathname.match(/^\/reports\/(\d{4}-\d{2}-\d{2})\.pdf$/);if(p){const v=await env.REPORTING.get(`pdf:${p[1]}`,'arrayBuffer');return v?new Response(v,{headers:{'content-type':'application/pdf','content-disposition':`inline; filename="market-edge-daily-${p[1]}.pdf"`,'cache-control':'public, max-age=3600'}}):new Response('not found',{status:404});}
   const live=await gatherEvidence();const latest=await env.REPORTING.get('latestDate');return new Response(html(live,latest),{headers:HTML_H});
 },
 async scheduled(controller,env,ctx){const lp=localParts(controller.scheduledTime);if(lp.hour!=='00')return;const date=prevYmd(lp);ctx.waitUntil(finalize(env,date).catch(e=>console.error('REPORT_FINALIZE_FAILED',e?.stack||e)));}
};
