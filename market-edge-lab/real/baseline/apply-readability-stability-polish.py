from pathlib import Path
import re

html_path=Path('market-edge-lab/real/baseline/founder-terminal.html')
prog_path=Path('market-edge-lab/real/baseline/progress-analytics.js')
s=html_path.read_text()
p=prog_path.read_text()

css=r'''
/* READABILITY_STABILITY_POLISH_V1 — cockpit presentation only */
html,body{font-size:14px;line-height:1.45}
.top{min-height:56px;height:auto;padding:8px 14px;gap:16px}.brand{font-size:15px;letter-spacing:.14em}.brand::after{content:'  ·  MARKET EDGE  ·  FOUNDER COCKPIT';font-size:10px;color:var(--muted);letter-spacing:.08em;font-weight:800}.nav a,.nav span{font-size:11px;padding:0 11px}.mini{font-size:11px}
.strip.account,.strip.auto,.strip.sleeves{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.metric{padding:10px 12px;min-height:62px}.lab{font-size:9.5px;white-space:normal}.val{font-size:15px;line-height:1.25;margin-top:4px;white-space:normal;overflow:visible}
.advisorPanel{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}.advisorCell{padding:11px 12px;min-height:72px}.advisorTitle{font-size:10px}.advisorBig{font-size:13px;margin-top:4px;white-space:normal;overflow:visible}.advisorSub{font-size:10px;line-height:1.35;white-space:normal;overflow:visible}
.holdObsHead{padding:10px 12px;min-height:48px}.holdObsTitle{font-size:13px}.holdObsStatus,.holdObsNote{font-size:10px}.holdK{font-size:9px}.holdV{font-size:13px}.holdAsset{font-size:14px}.holdTicker{font-size:10px}.holdControls button,.holdQuickNav button{font-size:10px;padding:6px 9px}.thesisLamp{font-size:11px;padding:7px 9px}.thesisReason{font-size:12px}.thesisNote{font-size:9px}
.upperProgressSummary{padding:10px 12px}.upperProgressHead strong{font-size:11px}.upperProgressHead span{font-size:9px}.upperProgressBlocks{gap:10px}.upperProgressCard{padding:10px}.upperProgressTitle{font-size:11px}.upperProgressGrid>div{padding:8px}.upperProgressK{font-size:9px}.upperProgressV{font-size:15px}
.workspace{min-height:560px}.ph{height:auto;min-height:42px;font-size:12px;padding:8px 10px}.badge{font-size:10px;padding:3px 6px}.tbl th{font-size:10px;padding:8px}.tbl td{font-size:12px;padding:8px}.asset{font-size:12px}.charttop{padding:9px 10px}.sym,.price{font-size:16px}.tf button,.chartModes button,.tool{font-size:10px;padding:6px 9px}.chartLabel,.legendItem,.visualOnly{font-size:9px}.inspector{padding:12px}.title{font-size:14px}.kv .k{font-size:9px}.kv .v{font-size:12px}.tickethead{font-size:12px}.fields label{font-size:9px}.fields input{font-size:12px;padding:8px}
.lower{min-height:260px;height:390px}.evidence-head{min-height:44px}.tabs{height:43px}.tabs button{font-size:10.5px;padding:0 15px}.layout-controls button{font-size:9px;padding:6px 8px}.tabpanel{font-size:12px}.empty{font-size:12px;padding:20px}.compareTitle,.threeTitle{font-size:13px}.compareSub,.threeSub{font-size:10px}.compareTbl th,.progressTbl th,.triTbl th{font-size:9px;padding:8px}.compareTbl td,.progressTbl td,.triTbl td{font-size:11px;padding:8px}.progressHead strong{font-size:11px}.progressHead span{font-size:9px}.progressMetricBtns button{font-size:9px;padding:6px 8px}
@media(max-width:900px){html,body{font-size:13px}.top{padding:8px}.brand::after{display:block;margin-top:2px}.account,.auto,.sleeves,.advisorPanel{grid-template-columns:repeat(2,minmax(0,1fr))}.account .metric:nth-child(n+5){display:block}.workspace{min-height:0}.center{height:420px}.lower{min-height:360px}.upperProgressBlocks{grid-template-columns:1fr}.thesisMetrics4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.brand{font-size:13px}.brand::after{font-size:8px}.account,.auto,.sleeves,.advisorPanel{grid-template-columns:1fr 1fr}.metric{min-height:58px;padding:9px}.val{font-size:14px}.advisorCell{min-height:64px}.upperProgressGrid{grid-template-columns:1fr 1fr}.upperProgressV{font-size:14px}.thesisLights{display:grid!important;grid-template-columns:1fr}.thesisLamp{width:100%;font-size:11px}.tbl th:nth-child(n+6),.tbl td:nth-child(n+6){display:table-cell}.tablewrap,.tabpanel{overflow-x:auto}.tabs button{font-size:10px;padding:0 12px}.center{height:380px}}
'''
if 'READABILITY_STABILITY_POLISH_V1' not in s:
    s=s.replace('</style>',css+'\n</style>',1)

# Lower evidence becomes snapshot-on-open: initial paint once, then tab clicks own repaint.
old="setText('sRecon',sleeves?.ok?'RECONCILED':'HOLD');$('sRecon').className='val '+(sleeves?.ok?'green':'red');setText('sMechanism',sleeves?.capitalMechanism?.selected||'—');$('connDot').className='dot live';setText('conn','LIVE');renderTop();renderWatch();renderTab();if(!state._chart&&state.selected){state._chart=true;loadChart(state.selected.asset)}setText('lastUpdate','LAST UPDATE '+new Date().toLocaleTimeString())}"
new="setText('sRecon',sleeves?.ok?'RECONCILED':'HOLD');$('sRecon').className='val '+(sleeves?.ok?'green':'red');setText('sMechanism',sleeves?.capitalMechanism?.selected||'—');$('connDot').className='dot live';setText('conn','LIVE');renderTop();renderWatch();if(!state._tabRendered){renderTab();state._tabRendered=true}if(!state._chart&&state.selected){state._chart=true;loadChart(state.selected.asset)}setText('lastUpdate','LAST UPDATE '+new Date().toLocaleTimeString())}"
if old not in s: raise SystemExit('main refresh anchor missing')
s=s.replace(old,new,1)

# Ensure base renderer knows PROGRESS when user returns to it.
anchor="if(state.tab==='triage'&&typeof window.renderThreeLayer==='function'){window.renderThreeLayer();return}\n if(state.tab==='compare'&&typeof window.renderLedgerCompare==='function'){window.renderLedgerCompare();return}"
repl="if(state.tab==='triage'&&typeof window.renderThreeLayer==='function'){window.renderThreeLayer();return}\n if(state.tab==='progress'&&typeof window.renderProgress==='function'){window.renderProgress();return}\n if(state.tab==='compare'&&typeof window.renderLedgerCompare==='function'){window.renderLedgerCompare();return}"
if anchor not in s: raise SystemExit('renderTab specialized anchor missing')
s=s.replace(anchor,repl,1)

# THREE-LAYER directional accuracy: only publish when every filled specimen is authoritatively CORRECT/WRONG.
old_sum="const fills=x.filter(r=>r.cap==='FILLED'),nf=x.filter(r=>r.cap==='NO_FILL'),correct=fills.filter(r=>r.pc==='CORRECT').length,wrong=fills.filter(r=>r.pc==='WRONG').length,flat=fills.filter(r=>r.pc==='FLAT').length,den=correct+wrong;return {series,attempts:x.length,fills:fills.length,nofill:nf.length,fillRate:x.length?fills.length/x.length:null,correct,wrong,flat,accuracy:den?correct/den:null"
new_sum="const fills=x.filter(r=>r.cap==='FILLED'),nf=x.filter(r=>r.cap==='NO_FILL'),correct=fills.filter(r=>r.pc==='CORRECT').length,wrong=fills.filter(r=>r.pc==='WRONG').length,flat=fills.filter(r=>r.pc==='FLAT').length,den=correct+wrong,accuracy=fills.length>0&&fills.length===den?correct/den:null;return {series,attempts:x.length,fills:fills.length,nofill:nf.length,fillRate:x.length?fills.length/x.length:null,correct,wrong,flat,accuracy"
if old_sum not in s: raise SystemExit('three-layer summary anchor missing')
s=s.replace(old_sum,new_sum,1)

# Specialized lower read-only tabs keep data fresh in memory without remounting visible DOM every refresh.
old_tri="obs.error=null;obs.updatedAt=new Date().toISOString();if(document.querySelector('.tabs button[data-tab=\"triage\"]')?.classList.contains('on'))window.renderThreeLayer();paintThesis()}catch(e){obs.error=String(e?.message||e);if(document.querySelector('.tabs button[data-tab=\"triage\"]')?.classList.contains('on'))window.renderThreeLayer()}}"
new_tri="obs.error=null;obs.updatedAt=new Date().toISOString();paintThesis()}catch(e){obs.error=String(e?.message||e)}}"
if old_tri not in s: raise SystemExit('triage refresh anchor missing')
s=s.replace(old_tri,new_tri,1)

old_cmp="ledger.capital=capital;ledger.exec=exec;ledger.history=history;ledger.correlation=correlation;ledger.error=null;ledger.lastReadAt=new Date().toISOString();paintAccount();\n   if(document.querySelector('.tabs button[data-tab=\"compare\"]')?.classList.contains('on'))window.renderLedgerCompare();\n  }catch(e){ledger.error=String(e?.message||e);ledger.lastReadAt=new Date().toISOString();paintAccount();if(document.querySelector('.tabs button[data-tab=\"compare\"]')?.classList.contains('on'))window.renderLedgerCompare()}"
new_cmp="ledger.capital=capital;ledger.exec=exec;ledger.history=history;ledger.correlation=correlation;ledger.error=null;ledger.lastReadAt=new Date().toISOString();paintAccount();\n  }catch(e){ledger.error=String(e?.message||e);ledger.lastReadAt=new Date().toISOString();paintAccount()}"
if old_cmp not in s: raise SystemExit('compare refresh anchor missing')
s=s.replace(old_cmp,new_cmp,1)

# PROGRESS: strict directional accuracy and stable lower snapshot.
old_acc="return {...r,total,fills,nofill,fillRate:total>0?fills/total:null,correct,wrong,flat,unknown,accuracy:den?correct/den:null,nfw,nfl,nfu,mgw,mgl,pwrong};"
new_acc="return {...r,total,fills,nofill,fillRate:total>0?fills/total:null,correct,wrong,flat,unknown,accuracy:fills>0&&fills===den?correct/den:null,nfw,nfl,nfu,mgw,mgl,pwrong};"
if old_acc not in p: raise SystemExit('progress classify accuracy anchor missing')
p=p.replace(old_acc,new_acc,1)

old_upper="const rs=runSnapshots().map(classifyRun),allAtt=rs.reduce((a,r)=>a+r.total,0),fills=rs.reduce((a,r)=>a+r.fills,0),nf=rs.reduce((a,r)=>a+r.nofill,0),correct=rs.reduce((a,r)=>a+r.correct,0),wrong=rs.reduce((a,r)=>a+r.wrong,0),den=correct+wrong,mgw=rs.reduce((a,r)=>a+r.mgw,0),mgl=rs.reduce((a,r)=>a+r.mgl,0),life=lifecycleRows(),pv=life.map(pnl).filter(x=>x!==null),wins=pv.filter(x=>x>0),losses=pv.filter(x=>x<0),net=pv.length?pv.reduce((a,b)=>a+b,0):null;\n setUpper('upSignalAccuracy',den?fPct(correct/den):'UNKNOWN',!den);"
new_upper="const rs=runSnapshots().map(classifyRun),allAtt=rs.reduce((a,r)=>a+r.total,0),fills=rs.reduce((a,r)=>a+r.fills,0),nf=rs.reduce((a,r)=>a+r.nofill,0),correct=rs.reduce((a,r)=>a+r.correct,0),wrong=rs.reduce((a,r)=>a+r.wrong,0),den=correct+wrong,accuracy=fills>0&&fills===den?correct/den:null,mgw=rs.reduce((a,r)=>a+r.mgw,0),mgl=rs.reduce((a,r)=>a+r.mgl,0),life=lifecycleRows(),pv=life.map(pnl).filter(x=>x!==null),wins=pv.filter(x=>x>0),losses=pv.filter(x=>x<0),net=pv.length?pv.reduce((a,b)=>a+b,0):null;\n setUpper('upSignalAccuracy',fPct(accuracy),accuracy===null);"
if old_upper not in p: raise SystemExit('upper accuracy anchor missing')
p=p.replace(old_upper,new_upper,1)

old_render="const rs=runSnapshots().map(classifyRun),days=dailyProvider(),allAtt=rs.reduce((a,r)=>a+r.total,0),fills=rs.reduce((a,r)=>a+r.fills,0),nf=rs.reduce((a,r)=>a+r.nofill,0),correct=rs.reduce((a,r)=>a+r.correct,0),wrong=rs.reduce((a,r)=>a+r.wrong,0),flatUnknown=rs.reduce((a,r)=>a+r.flat+r.unknown,0),den=correct+wrong,nfw="
new_render="const rs=runSnapshots().map(classifyRun),days=dailyProvider(),allAtt=rs.reduce((a,r)=>a+r.total,0),fills=rs.reduce((a,r)=>a+r.fills,0),nf=rs.reduce((a,r)=>a+r.nofill,0),correct=rs.reduce((a,r)=>a+r.correct,0),wrong=rs.reduce((a,r)=>a+r.wrong,0),flatUnknown=rs.reduce((a,r)=>a+r.flat+r.unknown,0),den=correct+wrong,overallAccuracy=fills>0&&fills===den?correct/den:null,nfw="
if old_render not in p: raise SystemExit('progress render aggregate anchor missing')
p=p.replace(old_render,new_render,1)
p=p.replace("['DIRECTIONAL ACCURACY',den?fPct(correct/den):'UNKNOWN']","['DIRECTIONAL ACCURACY',fPct(overallAccuracy)]",1)
p=p.replace("<span>READ ONLY · MISSING POINTS OMITTED</span>","<span>SNAPSHOT VIEW · REOPEN TAB TO REFRESH · MISSING POINTS OMITTED</span>",1)

old_refresh="async function refresh(){try{const [exec,history]=await Promise.all([get('/execution-test-state'),get('/forensic-provider-history?limit=200')]);S.exec=exec;S.history=history;S.error=null;updateUpperSummary();if(document.querySelector('#progressTabBtn.on'))render()}catch(e){S.error=String(e?.message||e);upperWaiting('UNKNOWN');if(document.querySelector('#progressTabBtn.on'))render()}}"
new_refresh="async function refresh(){try{const [exec,history]=await Promise.all([get('/execution-test-state'),get('/forensic-provider-history?limit=200')]);S.exec=exec;S.history=history;S.error=null;updateUpperSummary()}catch(e){S.error=String(e?.message||e);upperWaiting('UNKNOWN')}}"
if old_refresh not in p: raise SystemExit('progress refresh stability anchor missing')
p=p.replace(old_refresh,new_refresh,1)

html_path.write_text(s)
prog_path.write_text(p)
print('READABILITY_STABILITY_POLISH_PATCHED=YES')
