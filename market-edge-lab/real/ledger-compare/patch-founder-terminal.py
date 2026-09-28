from pathlib import Path

path=Path('market-edge-lab/real/baseline/founder-terminal.html')
s=path.read_text(encoding='utf-8')
marker='NFE_LEDGER_COMPARE_V1'
if marker in s:
    print('LEDGER_COMPARE_ALREADY_PRESENT=YES')
    raise SystemExit(0)

css=r'''
/* NFE_LEDGER_COMPARE_V1 */
.kalshiSummary{display:grid;grid-template-columns:1.3fr repeat(6,1fr);border-bottom:1px solid var(--line);background:#071019}.kalshiSummary .metric:first-child{border-left:2px solid var(--gold)}
.summarySource{font-size:8px;letter-spacing:.12em;color:var(--gold);font-weight:900}.syncGood{color:var(--green)!important}.syncWarn{color:var(--amber)!important}.syncBad{color:var(--red)!important}
.compareWrap{padding:8px;overflow:auto}.compareHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}.compareTitle{font-weight:900;letter-spacing:.08em;color:#fff}.compareSub{font-size:9px;color:var(--muted)}
.compareBadge{display:inline-block;padding:2px 5px;border:1px solid var(--line2);font-size:8px;font-weight:900;white-space:nowrap}.compareBadge.MATCH{color:var(--green);border-color:#276a49}.compareBadge.PROVIDER_ONLY,.compareBadge.INTERNAL_ONLY,.compareBadge.UNKNOWN{color:var(--amber);border-color:#735f30}.compareBadge.P\/L_MISMATCH,.compareBadge.METADATA_MISMATCH{color:var(--red);border-color:#6d3038}
.compareTbl{width:100%;border-collapse:collapse;white-space:nowrap}.compareTbl th{position:sticky;top:0;background:#0a1119;color:#60768d;text-align:right;font-size:8px;letter-spacing:.07em;padding:6px;border-bottom:1px solid var(--line);z-index:2}.compareTbl th:first-child,.compareTbl td:first-child{text-align:left}.compareTbl td{text-align:right;padding:6px;border-bottom:1px solid #101b26;font-size:9px}.compareTbl tr:hover{background:#0e1924}
@media(max-width:900px){.kalshiSummary{grid-template-columns:repeat(3,1fr)}.kalshiSummary .metric:first-child{grid-column:1/-1}.compareWrap{padding:5px}}
'''
s=s.replace('</style>',css+'\n</style>',1)

summary=r'''
<section class="kalshiSummary" id="kalshiAccountSummary" aria-live="polite">
  <div class="metric"><div class="summarySource">KALSHI ACCOUNT SUMMARY</div><div class="val gold">SOURCE: KALSHI · READ ONLY</div><div class="mini" id="kalshiSummaryTruth">PROVIDER VALUES ARE NOT REWRITTEN</div></div>
  <div class="metric"><div class="lab">KALSHI CASH</div><div class="val" id="ksCash">UNAVAILABLE</div></div>
  <div class="metric"><div class="lab">ACCOUNT VALUE</div><div class="val" id="ksAccountValue">UNAVAILABLE</div></div>
  <div class="metric"><div class="lab">OPEN EXPOSURE</div><div class="val" id="ksExposure">UNAVAILABLE</div></div>
  <div class="metric"><div class="lab">24H / DAILY P&L</div><div class="val" id="ksDailyPnl">UNAVAILABLE</div></div>
  <div class="metric"><div class="lab">OPEN POSITIONS</div><div class="val" id="ksOpenPositions">UNAVAILABLE</div></div>
  <div class="metric"><div class="lab">PROVIDER SYNC</div><div class="val" id="ksSync">CHECKING</div><div class="mini" id="ksRefresh">LAST REFRESH —</div></div>
</section>
'''
anchor='<section class="advisorPanel" id="advisorPanel" aria-live="polite">'
if anchor not in s: raise SystemExit('ADVISOR_PANEL_ANCHOR_NOT_FOUND')
s=s.replace(anchor,summary+'\n'+anchor,1)

old='<button data-tab="nofill">NO_FILL</button><button data-tab="log">SYSTEM / EVENT LOG</button>'
new='<button data-tab="nofill">NO_FILL</button><button data-tab="compare">LEDGER COMPARE</button><button data-tab="log">SYSTEM / EVENT LOG</button>'
if old not in s: raise SystemExit('TAB_ANCHOR_NOT_FOUND')
s=s.replace(old,new,1)

old_render='function renderTab(){\n const ex='
new_render="function renderTab(){\n if(state.tab==='compare'&&typeof window.renderLedgerCompare==='function'){window.renderLedgerCompare();return}\n const ex="
if old_render not in s: raise SystemExit('RENDER_TAB_ANCHOR_NOT_FOUND')
s=s.replace(old_render,new_render,1)

js=r'''
<script>
(()=>{
 const READ_BASE='https://market-edge-founder-read.darkbishop43.workers.dev';
 const ledger={capital:null,exec:null,history:null,lastReadAt:null,error:null};
 const $l=id=>document.getElementById(id);
 const text=(id,v)=>{const e=$l(id);if(e)e.textContent=v};
 const moneyOrUnavailable=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'UNAVAILABLE';
 const n=v=>Number.isFinite(Number(v))?Number(v):null;
 const getRO=async path=>{const r=await fetch(READ_BASE+path,{cache:'no-store',method:'GET',headers:{accept:'application/json'}});if(!r.ok)throw new Error(path+' HTTP '+r.status);return r.json()};
 const arr=x=>Array.isArray(x)?x:[];
 const ordersFrom=x=>arr(x?.orders).length?arr(x.orders):arr(x?.historical_orders).length?arr(x.historical_orders):arr(x?.data?.orders).length?arr(x.data.orders):arr(x?.data?.historical_orders).length?arr(x.data.historical_orders):[];
 const orderId=o=>String(o?.order_id??o?.orderId??o?.id??'').trim();
 const ticker=o=>String(o?.ticker??o?.market_ticker??o?.marketTicker??'').trim();
 const side=o=>String(o?.side??o?.outcome??o?.yes_no??'').toUpperCase();
 const timeOf=o=>o?.created_time??o?.created_at??o?.updated_time??o?.ts??o?.timestamp??null;
 const toMs=v=>{if(v==null)return null;if(typeof v==='number')return v>1e12?v:v*1000;const t=Date.parse(v);return Number.isFinite(t)?t:null};
 const timeMs=o=>toMs(timeOf(o));
 const providerCost=o=>n(o?.cost??o?.total_cost??o?.cost_dollars??o?.filled_cost??o?.filledCost);
 const providerFees=o=>n(o?.fees??o?.fee??o?.taker_fees??o?.maker_fees??o?.fees_dollars);
 const providerPayout=o=>n(o?.payout??o?.return??o?.settlement_value??o?.settlementValue);
 const providerPnl=o=>n(o?.realized_pnl??o?.realizedPnl??o?.profit_loss??o?.pnl);
 const filledCount=o=>n(o?.fill_count??o?.filled_count??o?.filledCount??o?.count_filled??o?.count)??0;
 const esc2=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function paintAccount(){
  const p=ledger.capital?.provider||{};
  text('ksCash',moneyOrUnavailable(p.cashUsd));
  text('ksAccountValue',moneyOrUnavailable(p.accountValueUsd));
  text('ksExposure',moneyOrUnavailable(p.openExposureUsd));
  text('ksDailyPnl',Number.isFinite(Number(p.todayPnlUsd))?moneyOrUnavailable(p.todayPnlUsd):'UNAVAILABLE');
  text('ksOpenPositions',Number.isFinite(Number(p.openPositionsCount))?String(Number(p.openPositionsCount)):'UNAVAILABLE');
  const ok=ledger.capital?.ok===true&&!ledger.error,el=$l('ksSync');
  if(el){el.textContent=ok?'SYNCED':'UNAVAILABLE';el.className='val '+(ok?'syncGood':'syncBad')}
  text('ksRefresh',ledger.lastReadAt?'LAST REFRESH '+new Date(ledger.lastReadAt).toLocaleTimeString():'LAST REFRESH —');
 }
 function internalRows(){
  const st=ledger.exec?.state||{},series=st.seriesId||'—',threshold=st.threshold??'—';
  const pos=arr(st.positions).map(p=>({kind:'POSITION',series,threshold,attempt:p.attemptNo,asset:p.asset,ticker:p.ticker,side:String(p.side||p.direction||'').toUpperCase(),entryOrderId:String(p.entryOrderId||''),exitOrderId:String(p.exitOrderId||''),score:p.entryScore,entry:p.entryAverageFillPrice,exit:p.exitAverageFillPrice,time:p.filledAt??p.closedAt??null,hold:Number.isFinite(Date.parse(p.closedAt))&&Number.isFinite(Date.parse(p.filledAt))?Date.parse(p.closedAt)-Date.parse(p.filledAt):null,exitReason:p.exitReason,status:p.status,internalPnl:n(p.realizedPnlUsd??p.pnlUsd)}));
  const attempts=arr(st.attempts).map(a=>({kind:'ATTEMPT',series,threshold,attempt:a.attemptNo,asset:a.asset,ticker:a.ticker,side:String(a.side||'').toUpperCase(),entryOrderId:String(a.orderId||''),exitOrderId:'',score:a.liveScore??a.observedScore,entry:a.liveAsk,exit:null,time:a.startedAt??a.createdAt??a.submittedAt??null,hold:null,exitReason:null,status:a.status,internalPnl:null}));
  const byAttempt=new Map(pos.map(x=>[String(x.attempt),x]));
  for(const a of attempts)if(!byAttempt.has(String(a.attempt)))pos.push(a);
  return pos;
 }
 function strictFallback(provider,internals,used){
  const pt=ticker(provider),ps=side(provider),tm=timeMs(provider);if(!pt||!ps||!Number.isFinite(tm))return null;
  const candidates=internals.map((x,i)=>({x,i})).filter(q=>{const im=toMs(q.x.time);return !used.has(q.i)&&q.x.ticker===pt&&q.x.side===ps&&Number.isFinite(im)&&Math.abs(im-tm)<=300000});
  return candidates.length===1?candidates[0]:null;
 }
 function compareRows(){
  const providers=ordersFrom(ledger.history).filter(o=>filledCount(o)>0), internals=internalRows(), used=new Set(), rows=[];
  for(const p of providers){
   const pid=orderId(p);let hit=null;
   if(pid){const exact=internals.map((x,i)=>({x,i})).filter(q=>!used.has(q.i)&&(q.x.entryOrderId===pid||q.x.exitOrderId===pid));if(exact.length===1)hit=exact[0]}
   if(!hit)hit=strictFallback(p,internals,used);
   let status='PROVIDER_ONLY';
   if(hit){used.add(hit.i);status='MATCH';const pt=ticker(p),ps=side(p);if((pt&&hit.x.ticker&&pt!==hit.x.ticker)||(ps&&hit.x.side&&ps!==hit.x.side))status='METADATA_MISMATCH';const pp=providerPnl(p),ip=hit.x.internalPnl;if(Number.isFinite(pp)&&Number.isFinite(ip)&&Math.abs(pp-ip)>.01)status='P/L_MISMATCH'}
   rows.push({provider:p,internal:hit?.x||null,status});
  }
  internals.forEach((x,i)=>{if(!used.has(i)&&x.entryOrderId)rows.push({provider:null,internal:x,status:'INTERNAL_ONLY'})});
  return rows;
 }
 window.renderLedgerCompare=()=>{
  const el=$l('tabPanel');if(!el)return;
  if(ledger.error){el.innerHTML='<div class="empty">LEDGER COMPARE READ UNAVAILABLE · '+esc2(ledger.error)+'</div>';return}
  const rows=compareRows();
  const heads=['TIME','ASSET','TICKER / CONTRACT','SIDE','KALSHI COST','KALSHI FEES','KALSHI PAYOUT','KALSHI REALIZED P/L','NFE SCORE','THRESHOLD','SERIES','ATTEMPT','ENTRY','EXIT','HOLD','EXIT REASON','BASELINE STATE','STATUS'];
  const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(4):'UNAVAILABLE';
  const body=rows.map(r=>{const p=r.provider||{},i=r.internal||{};const tm=timeMs(p);const vals=[tm?new Date(tm).toLocaleString():'UNAVAILABLE',i.asset||String(ticker(p)).split('-')[0]||'—',ticker(p)||i.ticker||'—',side(p)||i.side||'—',fmt(providerCost(p)),fmt(providerFees(p)),fmt(providerPayout(p)),fmt(providerPnl(p)),fmt(i.score),i.threshold??'—',i.series||'—',i.attempt??'—',fmt(i.entry),fmt(i.exit),Number.isFinite(i.hold)?Math.round(i.hold/1000)+'s':'UNAVAILABLE',i.exitReason||'—',i.status||'PROVIDER',r.status];return '<tr>'+vals.map((v,k)=>'<td>'+(k===17?'<span class="compareBadge '+esc2(r.status)+'">'+esc2(r.status)+'</span>':esc2(v))+'</td>').join('')+'</tr>'}).join('');
  const providerCount=ordersFrom(ledger.history).filter(o=>filledCount(o)>0).length;
  el.innerHTML='<div class="compareWrap"><div class="compareHead"><div><div class="compareTitle">LEDGER COMPARE</div><div class="compareSub">KALSHI PROVIDER TRUTH ↔ MARKET EDGE ↔ BASELINE REAL · '+providerCount+' FILLED PROVIDER ORDERS READ · NO VALUES REWRITTEN</div></div><span class="badge live">READ ONLY</span></div>'+(rows.length?'<table class="compareTbl"><thead><tr>'+heads.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>':'<div class="empty">No provider-filled orders or correlated internal records available.</div>')+'</div>';
 };
 async function refreshLedger(){
  try{
   const [capital,exec,history]=await Promise.all([getRO('/founder-capital-ledger'),getRO('/execution-test-state'),getRO('/forensic-historical-orders?limit=200')]);
   ledger.capital=capital;ledger.exec=exec;ledger.history=history;ledger.error=null;ledger.lastReadAt=new Date().toISOString();paintAccount();
   if(document.querySelector('.tabs button[data-tab="compare"]')?.classList.contains('on'))window.renderLedgerCompare();
  }catch(e){ledger.error=String(e?.message||e);ledger.lastReadAt=new Date().toISOString();paintAccount();if(document.querySelector('.tabs button[data-tab="compare"]')?.classList.contains('on'))window.renderLedgerCompare()}
 }
 refreshLedger();setInterval(refreshLedger,15000);
})();
</script>
'''
if '</body>' not in s: raise SystemExit('BODY_END_NOT_FOUND')
s=s.replace('</body>',js+'\n</body>',1)
path.write_text(s,encoding='utf-8')
print('LEDGER_COMPARE_PATCHED=YES')
