from pathlib import Path

html=Path('market-edge-lab/real/baseline/founder-terminal.html')
prog=Path('market-edge-lab/real/baseline/progress-analytics.js')
s=html.read_text()
p=prog.read_text()

old_card='''    <div class="upperProgressCard"><div class="upperProgressTitle">3 · MANAGEMENT QUALITY</div><div class="upperProgressGrid"><div><div class="upperProgressK">CORRECT MGMT WIN / LOSS</div><div id="upMgmtWL" class="upperProgressV wait">WAITING FOR DATA</div></div><div><div class="upperProgressK">NET REALIZED</div><div id="upMgmtNet" class="upperProgressV">—</div></div><div><div class="upperProgressK">AVG WIN / LOSS</div><div id="upMgmtAvg" class="upperProgressV">—</div></div></div></div>'''
new_card='''    <div class="upperProgressCard"><div class="upperProgressTitle">3 · MANAGEMENT QUALITY</div><div class="upperProgressGrid"><div><div class="upperProgressK">PRED CORRECT + MGMT WIN</div><div id="upMgmtCorrectWin" class="upperProgressV wait">WAITING FOR DATA</div></div><div><div class="upperProgressK">PRED CORRECT + MGMT LOSS</div><div id="upMgmtCorrectLoss" class="upperProgressV">—</div></div><div><div class="upperProgressK">PREDICTION WRONG</div><div id="upMgmtPredWrong" class="upperProgressV">—</div></div><div><div class="upperProgressK">MANAGEMENT UNKNOWN</div><div id="upMgmtUnknown" class="upperProgressV">—</div></div><div><div class="upperProgressK">NET REALIZED P/L</div><div id="upMgmtNet" class="upperProgressV">—</div></div><div><div class="upperProgressK">AVG REALIZED WIN</div><div id="upMgmtAvgWin" class="upperProgressV">—</div></div><div><div class="upperProgressK">AVG REALIZED LOSS</div><div id="upMgmtAvgLoss" class="upperProgressV">—</div></div><div><div class="upperProgressK">MANAGEMENT SAMPLE</div><div id="upMgmtSample" class="upperProgressV">—</div></div></div></div>'''
if old_card not in s: raise SystemExit('management upper card anchor missing')
s=s.replace(old_card,new_card,1)

old_real="function realizedForPosition(p){const ids=new Set([String(p?.entryOrderId||''),String(p?.exitOrderId||'')].filter(Boolean));if(!ids.size)return null;const vals=rows(S.history).filter(x=>ids.has(String(x?.order_id??x?.orderId??x?.id??''))).map(pnl).filter(x=>x!==null);return vals.length?vals[vals.length-1]:null}"
new_real="function realizedForPosition(p){const direct=N(p?.realizedPnlUsd??p?.pnlUsd);if(direct!==null)return direct;const ids=new Set([String(p?.entryOrderId||''),String(p?.exitOrderId||'')].filter(Boolean));if(!ids.size)return null;const vals=rows(S.history).filter(x=>ids.has(String(x?.order_id??x?.orderId??x?.id??''))).map(pnl).filter(x=>x!==null);return vals.length?vals[vals.length-1]:null}"
if old_real not in p: raise SystemExit('realizedForPosition anchor missing')
p=p.replace(old_real,new_real,1)

old_decl="const ps=A(r.positions),attempts=A(r.attempts);let fills=0,nofill=0,correct=0,wrong=0,flat=0,unknown=0,nfw=0,nfl=0,nfu=0,mgw=0,mgl=0,pwrong=0;"
new_decl="const ps=A(r.positions),attempts=A(r.attempts);let fills=0,nofill=0,correct=0,wrong=0,flat=0,unknown=0,nfw=0,nfl=0,nfu=0,mgw=0,mgl=0,pwrong=0,mgUnknown=0,mgFlat=0;const realized=[];"
if old_decl not in p: raise SystemExit('classify declaration anchor missing')
p=p.replace(old_decl,new_decl,1)

old_filled="if(filled){if(pc==='CORRECT')correct++;else if(pc==='WRONG'){wrong++;pwrong++}else if(pc==='FLAT')flat++;else unknown++;if(pc==='CORRECT'){const z=p?realizedForPosition(p):null;if(z!==null){if(z>0)mgw++;else if(z<0)mgl++;}}}"
new_filled="if(filled){if(pc==='CORRECT')correct++;else if(pc==='WRONG'){wrong++;pwrong++}else if(pc==='FLAT')flat++;else unknown++;const z=p?realizedForPosition(p):null;if(z!==null)realized.push(z);if(pc==='CORRECT'){if(z===null)mgUnknown++;else if(z>0)mgw++;else if(z<0)mgl++;else mgFlat++;}else if(pc==='UNKNOWN'||pc==='FLAT'){mgUnknown++;}}"
if old_filled not in p: raise SystemExit('filled classification anchor missing')
p=p.replace(old_filled,new_filled,1)

old_return="return {...r,total,fills,nofill,fillRate:total>0?fills/total:null,correct,wrong,flat,unknown,accuracy:fills>0&&fills===den?correct/den:null,nfw,nfl,nfu,mgw,mgl,pwrong};"
new_return="return {...r,total,fills,nofill,fillRate:total>0?fills/total:null,correct,wrong,flat,unknown,accuracy:fills>0&&fills===den?correct/den:null,nfw,nfl,nfu,mgw,mgl,pwrong,mgUnknown,mgFlat,realized};"
if old_return not in p: raise SystemExit('classify return anchor missing')
p=p.replace(old_return,new_return,1)

old_wait="function upperWaiting(label='WAITING FOR DATA'){for(const id of ['upSignalAccuracy','upCaptureRate','upMgmtWL'])setUpper(id,label,true);for(const id of ['upSignalCW','upSignalSample','upCaptureFN','upCaptureAttempts','upMgmtNet','upMgmtAvg'])setUpper(id,'—')}"
new_wait="function upperWaiting(label='WAITING FOR DATA'){for(const id of ['upSignalAccuracy','upCaptureRate','upMgmtCorrectWin'])setUpper(id,label,true);for(const id of ['upSignalCW','upSignalSample','upCaptureFN','upCaptureAttempts','upMgmtCorrectLoss','upMgmtPredWrong','upMgmtUnknown','upMgmtNet','upMgmtAvgWin','upMgmtAvgLoss','upMgmtSample'])setUpper(id,'—')}"
if old_wait not in p: raise SystemExit('upperWaiting anchor missing')
p=p.replace(old_wait,new_wait,1)

old_update="const rs=runSnapshots().map(classifyRun),allAtt=rs.reduce((a,r)=>a+r.total,0),fills=rs.reduce((a,r)=>a+r.fills,0),nf=rs.reduce((a,r)=>a+r.nofill,0),correct=rs.reduce((a,r)=>a+r.correct,0),wrong=rs.reduce((a,r)=>a+r.wrong,0),den=correct+wrong,accuracy=fills>0&&fills===den?correct/den:null,mgw=rs.reduce((a,r)=>a+r.mgw,0),mgl=rs.reduce((a,r)=>a+r.mgl,0),life=lifecycleRows(),pv=life.map(pnl).filter(x=>x!==null),wins=pv.filter(x=>x>0),losses=pv.filter(x=>x<0),net=pv.length?pv.reduce((a,b)=>a+b,0):null;\n setUpper('upSignalAccuracy',fPct(accuracy),accuracy===null);setUpper('upSignalCW',correct+' / '+wrong);setUpper('upSignalSample',String(fills));\n setUpper('upCaptureRate',allAtt?fPct(fills/allAtt):'UNKNOWN',!allAtt);setUpper('upCaptureFN',fills+' / '+nf);setUpper('upCaptureAttempts',String(allAtt));\n setUpper('upMgmtWL',mgw+' / '+mgl);setUpper('upMgmtNet',fMoney(net),net===null);setUpper('upMgmtAvg',(wins.length?fMoney(wins.reduce((a,b)=>a+b,0)/wins.length):'UNKNOWN')+' / '+(losses.length?fMoney(losses.reduce((a,b)=>a+b,0)/losses.length):'UNKNOWN'));"
new_update="const rs=runSnapshots().map(classifyRun),allAtt=rs.reduce((a,r)=>a+r.total,0),fills=rs.reduce((a,r)=>a+r.fills,0),nf=rs.reduce((a,r)=>a+r.nofill,0),correct=rs.reduce((a,r)=>a+r.correct,0),wrong=rs.reduce((a,r)=>a+r.wrong,0),den=correct+wrong,accuracy=fills>0&&fills===den?correct/den:null,mgw=rs.reduce((a,r)=>a+r.mgw,0),mgl=rs.reduce((a,r)=>a+r.mgl,0),pwrong=rs.reduce((a,r)=>a+r.pwrong,0),mgUnknown=rs.reduce((a,r)=>a+r.mgUnknown,0),mgFlat=rs.reduce((a,r)=>a+r.mgFlat,0),rv=rs.flatMap(r=>r.realized),wins=rv.filter(x=>x>0),losses=rv.filter(x=>x<0),net=rv.length?rv.reduce((a,b)=>a+b,0):null,mgSample=mgw+mgl+mgFlat+mgUnknown;\n setUpper('upSignalAccuracy',fPct(accuracy),accuracy===null);setUpper('upSignalCW',correct+' / '+wrong);setUpper('upSignalSample',String(fills));\n setUpper('upCaptureRate',allAtt?fPct(fills/allAtt):'UNKNOWN',!allAtt);setUpper('upCaptureFN',fills+' / '+nf);setUpper('upCaptureAttempts',String(allAtt));\n setUpper('upMgmtCorrectWin',mgw||mgSample?String(mgw):'UNKNOWN',!mgSample);setUpper('upMgmtCorrectLoss',mgl||mgSample?String(mgl):'UNKNOWN');setUpper('upMgmtPredWrong',pwrong||fills?String(pwrong):'UNKNOWN');setUpper('upMgmtUnknown',mgUnknown||mgSample?String(mgUnknown):'UNKNOWN');setUpper('upMgmtNet',fMoney(net),net===null);setUpper('upMgmtAvgWin',wins.length?fMoney(wins.reduce((a,b)=>a+b,0)/wins.length):'UNKNOWN');setUpper('upMgmtAvgLoss',losses.length?fMoney(losses.reduce((a,b)=>a+b,0)/losses.length):'UNKNOWN');setUpper('upMgmtSample',mgSample?String(mgSample):'UNKNOWN');"
if old_update not in p: raise SystemExit('upper summary management anchor missing')
p=p.replace(old_update,new_update,1)

old_agg="nfu=rs.reduce((a,r)=>a+r.nfu,0),mgw=rs.reduce((a,r)=>a+r.mgw,0),mgl=rs.reduce((a,r)=>a+r.mgl,0),pwrong=rs.reduce((a,r)=>a+r.pwrong,0),life=lifecycleRows(),pv=life.map(pnl).filter(x=>x!==null),wins=pv.filter(x=>x>0),losses=pv.filter(x=>x<0),net=pv.length?pv.reduce((a,b)=>a+b,0):null;"
new_agg="nfu=rs.reduce((a,r)=>a+r.nfu,0),mgw=rs.reduce((a,r)=>a+r.mgw,0),mgl=rs.reduce((a,r)=>a+r.mgl,0),pwrong=rs.reduce((a,r)=>a+r.pwrong,0),mgUnknown=rs.reduce((a,r)=>a+r.mgUnknown,0),mgFlat=rs.reduce((a,r)=>a+r.mgFlat,0),rv=rs.flatMap(r=>r.realized),wins=rv.filter(x=>x>0),losses=rv.filter(x=>x<0),net=rv.length?rv.reduce((a,b)=>a+b,0):null,mgSample=mgw+mgl+mgFlat+mgUnknown;"
if old_agg not in p: raise SystemExit('render management aggregate anchor missing')
p=p.replace(old_agg,new_agg,1)

old_block="block('3 · MANAGEMENT QUALITY','PREDICTION VS REALIZED MANAGEMENT',[['CORRECT / MGMT WIN',mgw],['CORRECT / MGMT LOSS',mgl],['PREDICTION WRONG',pwrong],['AVG REALIZED WIN',wins.length?fMoney(wins.reduce((a,b)=>a+b,0)/wins.length):'UNKNOWN'],['AVG REALIZED LOSS',losses.length?fMoney(losses.reduce((a,b)=>a+b,0)/losses.length):'UNKNOWN'],['NET REALIZED',fMoney(net)]])"
new_block="block('3 · MANAGEMENT QUALITY','PREDICTION AND MANAGEMENT REMAIN SEPARATE · POSITION REALIZED P/L FIRST, EXACT ORDER-ID PROVIDER FALLBACK',[['PRED CORRECT + MGMT WIN',mgSample?mgw:'UNKNOWN'],['PRED CORRECT + MGMT LOSS',mgSample?mgl:'UNKNOWN'],['PREDICTION WRONG',fills?pwrong:'UNKNOWN'],['MANAGEMENT UNKNOWN',mgSample?mgUnknown:'UNKNOWN'],['MANAGEMENT FLAT',mgSample?mgFlat:'UNKNOWN'],['NET REALIZED P/L',fMoney(net)],['AVG REALIZED WIN',wins.length?fMoney(wins.reduce((a,b)=>a+b,0)/wins.length):'UNKNOWN'],['AVG REALIZED LOSS',losses.length?fMoney(losses.reduce((a,b)=>a+b,0)/losses.length):'UNKNOWN'],['MANAGEMENT SAMPLE',mgSample?mgSample:'UNKNOWN']])"
if old_block not in p: raise SystemExit('management block anchor missing')
p=p.replace(old_block,new_block,1)

html.write_text(s)
prog.write_text(p)
print('MANAGEMENT_QUALITY_FIX_PATCHED=YES')
