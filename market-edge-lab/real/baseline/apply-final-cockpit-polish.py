from pathlib import Path
import re

html_path=Path('market-edge-lab/real/baseline/founder-terminal.html')
prog_path=Path('market-edge-lab/real/baseline/progress-analytics.js')
s=html_path.read_text()
p=prog_path.read_text()

css='''
/* FINAL_COCKPIT_POLISH_V1 — presentation only */
.upperProgressSummary{border-bottom:1px solid var(--line);background:#060d14;padding:7px 8px}
.upperProgressHead{display:flex;align-items:center;gap:8px;margin-bottom:6px}.upperProgressHead strong{font-size:9px;letter-spacing:.1em;color:var(--gold)}.upperProgressHead span{font-size:8px;color:var(--muted)}
.upperProgressBlocks{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:7px}.upperProgressCard{border:1px solid var(--line2);background:#08111a;padding:7px}.upperProgressTitle{font-size:9px;font-weight:900;letter-spacing:.07em;color:#fff;margin-bottom:5px}.upperProgressGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line)}.upperProgressGrid>div{background:#071019;padding:5px}.upperProgressK{font-size:7px;color:#65798e;letter-spacing:.06em}.upperProgressV{font-size:11px;font-weight:900;color:#e9f2fb;margin-top:2px}.upperProgressV.wait{color:var(--amber)}
#tabPanel .progressBlocks{display:none!important}
.persistentThesis{padding:7px 9px 8px;border-top:1px solid #152536;background:#071019}.persistentThesis .thesisLights{margin-top:0}.persistentThesis .thesisReason{font-weight:900}
@media(max-width:900px){.upperProgressBlocks{grid-template-columns:1fr}.upperProgressGrid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:520px){.upperProgressSummary{padding:6px}.upperProgressGrid{grid-template-columns:repeat(2,1fr)}.persistentThesis .thesisLights{display:grid;grid-template-columns:1fr}.persistentThesis .thesisLamp{width:100%}}
'''
if 'FINAL_COCKPIT_POLISH_V1' not in s:
    s=s.replace('</style>',css+'\n</style>',1)

old='''<section class="holdObs" id="holdObsPanel" aria-live="polite">
  <div class="holdObsHead"><div class="holdObsTitle">LIVE POSITION / THESIS STATUS</div><div id="holdObsStatus" class="holdObsStatus warn">CHECKING…</div><div id="holdObsUpdated" class="holdObsNote">OBSERVATION ONLY · UPDATED —</div><div class="holdQuickNav"><button id="holdJumpPositions" type="button">POSITIONS</button><button id="holdJumpOrders" type="button">ORDERS</button></div></div>
  <div id="holdCards" class="holdCards"><div class="holdEmpty">Checking authenticated provider ownership…</div></div>
</section>'''
new='''<section class="holdObs" id="holdObsPanel" aria-live="polite">
  <div class="holdObsHead"><div class="holdObsTitle">LIVE POSITION / THESIS STATUS</div><div id="holdObsStatus" class="holdObsStatus warn">CHECKING…</div><div id="holdObsUpdated" class="holdObsNote">OBSERVATION ONLY · UPDATED —</div><div class="holdQuickNav"><button id="holdJumpPositions" type="button">POSITIONS</button><button id="holdJumpOrders" type="button">ORDERS</button></div></div>
  <div id="persistentThesis" class="persistentThesis">
    <div class="thesisLights"><div id="thesisLampGreen" class="thesisLamp green"><span class="dot">●</span><span>THESIS INTACT</span></div><div id="thesisLampYellow" class="thesisLamp yellow"><span class="dot">●</span><span>THESIS WEAKENING</span></div><div id="thesisLampRed" class="thesisLamp red"><span class="dot">●</span><span>OPPOSITE SIDE STRONGER</span></div></div>
    <div class="thesisTop"><span id="thesisReasonPersistent" class="thesisReason">NO LIVE THESIS TO EVALUATE</span><span class="thesisExact">EXACT TICKER ONLY</span></div>
    <div class="thesisMetrics4"><div><div class="holdK">ENTRY SCORE</div><div id="thesisEntryPersistent" class="holdV">—</div></div><div><div class="holdK">CURRENT OWNED-SIDE SCORE</div><div id="thesisSamePersistent" class="holdV">—</div></div><div><div class="holdK">CURRENT OPPOSITE-SIDE SCORE</div><div id="thesisOppPersistent" class="holdV">—</div></div><div><div class="holdK">CHANGE SINCE ENTRY</div><div id="thesisDeltaPersistent" class="holdV">—</div></div></div>
    <div class="thesisNote">FOUNDER HEADS-UP ONLY · NO AUTO ACTION · NO EXIT / ENTRY / HOLD AUTHORITY</div>
  </div>
  <div id="holdCards" class="holdCards"><div class="holdEmpty">Checking authenticated provider ownership…</div></div>
</section>'''
if old not in s: raise SystemExit('hold panel anchor missing')
s=s.replace(old,new,1)

summary='''<section id="upperProgressSummary" class="upperProgressSummary" aria-live="polite">
  <div class="upperProgressHead"><strong>SYSTEM PROGRESS</strong><span>READ ONLY · VALUES UPDATE IN PLACE</span></div>
  <div class="upperProgressBlocks">
    <div class="upperProgressCard"><div class="upperProgressTitle">1 · SIGNAL QUALITY</div><div class="upperProgressGrid"><div><div class="upperProgressK">DIRECTIONAL ACCURACY</div><div id="upSignalAccuracy" class="upperProgressV wait">WAITING FOR DATA</div></div><div><div class="upperProgressK">CORRECT / WRONG</div><div id="upSignalCW" class="upperProgressV">—</div></div><div><div class="upperProgressK">FILLED SAMPLE</div><div id="upSignalSample" class="upperProgressV">—</div></div></div></div>
    <div class="upperProgressCard"><div class="upperProgressTitle">2 · CAPTURE QUALITY</div><div class="upperProgressGrid"><div><div class="upperProgressK">FILL RATE</div><div id="upCaptureRate" class="upperProgressV wait">WAITING FOR DATA</div></div><div><div class="upperProgressK">FILLS / NO_FILL</div><div id="upCaptureFN" class="upperProgressV">—</div></div><div><div class="upperProgressK">ATTEMPTS</div><div id="upCaptureAttempts" class="upperProgressV">—</div></div></div></div>
    <div class="upperProgressCard"><div class="upperProgressTitle">3 · MANAGEMENT QUALITY</div><div class="upperProgressGrid"><div><div class="upperProgressK">CORRECT MGMT WIN / LOSS</div><div id="upMgmtWL" class="upperProgressV wait">WAITING FOR DATA</div></div><div><div class="upperProgressK">NET REALIZED</div><div id="upMgmtNet" class="upperProgressV">—</div></div><div><div class="upperProgressK">AVG WIN / LOSS</div><div id="upMgmtAvg" class="upperProgressV">—</div></div></div></div>
  </div>
</section>
'''
anchor='</section>\n\n\n<main class="workspace">'
if 'id="upperProgressSummary"' not in s:
    if anchor not in s: raise SystemExit('workspace anchor missing')
    s=s.replace(anchor,'</section>\n\n'+summary+'\n<main class="workspace">',1)

# No-position card no longer owns/rebuilds thesis lights; persistent panel above owns them.
s=re.sub(r"else cards\.innerHTML='<div class=\\\"holdEmpty\\\"><div class=\\\"thesisLights\\\">.*?</div>';const panel=\$\('holdObsPanel'\);", "else cards.innerHTML='<div class=\\\"holdEmpty\\\">NO LIVE OWNED POSITION</div>';const panel=$('holdObsPanel');", s, count=1, flags=re.S)

# Replace presentation-only painter while leaving thesis() byte-identical.
new_paint="""function paintThesis(){const ps=A(obs.hold?.positions),lamps={green:q('thesisLampGreen'),yellow:q('thesisLampYellow'),red:q('thesisLampRed')},reason=q('thesisReasonPersistent'),entry=q('thesisEntryPersistent'),same=q('thesisSamePersistent'),opp=q('thesisOppPersistent'),delta=q('thesisDeltaPersistent');if(!reason)return;Object.values(lamps).forEach(x=>x?.classList.remove('active'));const p=ps[0];if(!p){reason.textContent='NO LIVE THESIS TO EVALUATE';if(entry)entry.textContent='—';if(same)same.textContent='—';if(opp)opp.textContent='—';if(delta)delta.textContent='—';return}const t=thesis(p),lc=t.light.toLowerCase();lamps[lc]?.classList.add('active');reason.textContent=t.reason;if(entry)entry.textContent=t.entry===null?'—':t.entry.toFixed(3);if(same)same.textContent=t.same===null?'—':t.same.toFixed(3);if(opp)opp.textContent=t.opp===null?'—':t.opp.toFixed(3);if(delta)delta.textContent=t.sameDelta===null?'—':(t.sameDelta>=0?'+':'')+t.sameDelta.toFixed(3)}"""
pat=r"function paintThesis\(\)\{.*?\}\n async function refresh"
m=re.search(pat,s,re.S)
if not m: raise SystemExit('paintThesis anchor missing')
s=s[:m.start()]+new_paint+'\n async function refresh'+s[m.end():]

# Persistent upper summary update helpers in progress analytics.
helper=r'''
function setUpper(id,value,waiting=false){const el=document.getElementById(id);if(!el)return;el.textContent=value;el.classList.toggle('wait',waiting)}
function upperWaiting(label='WAITING FOR DATA'){for(const id of ['upSignalAccuracy','upCaptureRate','upMgmtWL'])setUpper(id,label,true);for(const id of ['upSignalCW','upSignalSample','upCaptureFN','upCaptureAttempts','upMgmtNet','upMgmtAvg'])setUpper(id,'—')}
function updateUpperSummary(){
 const rs=runSnapshots().map(classifyRun),allAtt=rs.reduce((a,r)=>a+r.total,0),fills=rs.reduce((a,r)=>a+r.fills,0),nf=rs.reduce((a,r)=>a+r.nofill,0),correct=rs.reduce((a,r)=>a+r.correct,0),wrong=rs.reduce((a,r)=>a+r.wrong,0),den=correct+wrong,mgw=rs.reduce((a,r)=>a+r.mgw,0),mgl=rs.reduce((a,r)=>a+r.mgl,0),life=lifecycleRows(),pv=life.map(pnl).filter(x=>x!==null),wins=pv.filter(x=>x>0),losses=pv.filter(x=>x<0),net=pv.length?pv.reduce((a,b)=>a+b,0):null;
 setUpper('upSignalAccuracy',den?fPct(correct/den):'UNKNOWN',!den);setUpper('upSignalCW',correct+' / '+wrong);setUpper('upSignalSample',String(fills));
 setUpper('upCaptureRate',allAtt?fPct(fills/allAtt):'UNKNOWN',!allAtt);setUpper('upCaptureFN',fills+' / '+nf);setUpper('upCaptureAttempts',String(allAtt));
 setUpper('upMgmtWL',mgw+' / '+mgl);setUpper('upMgmtNet',fMoney(net),net===null);setUpper('upMgmtAvg',(wins.length?fMoney(wins.reduce((a,b)=>a+b,0)/wins.length):'UNKNOWN')+' / '+(losses.length?fMoney(losses.reduce((a,b)=>a+b,0)/losses.length):'UNKNOWN'));
}
'''
if 'function updateUpperSummary()' not in p:
    p=p.replace('function render(){',helper+'\nfunction render(){',1)
old_refresh="async function refresh(){try{const [exec,history]=await Promise.all([get('/execution-test-state'),get('/forensic-provider-history?limit=200')]);S.exec=exec;S.history=history;S.error=null;if(document.querySelector('#progressTabBtn.on'))render()}catch(e){S.error=String(e?.message||e);if(document.querySelector('#progressTabBtn.on'))render()}}"
new_refresh="async function refresh(){try{const [exec,history]=await Promise.all([get('/execution-test-state'),get('/forensic-provider-history?limit=200')]);S.exec=exec;S.history=history;S.error=null;updateUpperSummary();if(document.querySelector('#progressTabBtn.on'))render()}catch(e){S.error=String(e?.message||e);upperWaiting('UNKNOWN');if(document.querySelector('#progressTabBtn.on'))render()}}"
if old_refresh not in p: raise SystemExit('progress refresh anchor missing')
p=p.replace(old_refresh,new_refresh,1)
if "injectUi();upperWaiting();refresh();" not in p:
    p=p.replace('injectUi();refresh();setInterval(refresh,15000);','injectUi();upperWaiting();refresh();setInterval(refresh,15000);',1)

html_path.write_text(s)
prog_path.write_text(p)
print('FINAL_COCKPIT_POLISH_PATCHED=YES')
