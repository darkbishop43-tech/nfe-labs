from pathlib import Path
p=Path('market-edge-lab/real/baseline/founder-terminal.html')
s=p.read_text()
css='''\n/* PROMOTED_LIVE_POSITION_V1 — presentation only */\n.holdObs{margin:8px 0 6px;border:1px solid #35506a;box-shadow:0 0 0 1px rgba(100,168,255,.05) inset}.holdObsHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.holdQuickNav{margin-left:auto;display:flex;gap:6px}.holdQuickNav button{background:#0b1824;border:1px solid #38526c;color:#cbd9e6;padding:5px 9px;font-size:9px;font-weight:900;letter-spacing:.05em;cursor:pointer}.holdQuickNav button:hover{border-color:#64a8ff;color:#fff}.holdCards:has(.holdEmpty){display:block}.holdCards .holdEmpty{padding:8px 10px;min-height:0}.holdObs.compactNoPos{padding-bottom:6px}.holdObs.compactNoPos .holdObsUpdated{display:none}@media(max-width:700px){.holdQuickNav{width:100%;margin-left:0}.holdQuickNav button{flex:1}.holdObsHead{align-items:flex-start}}\n'''
if 'PROMOTED_LIVE_POSITION_V1' not in s:
    s=s.replace('</style>',css+'\n</style>',1)
old='<div class="holdObsHead"><div class="holdObsTitle">LIVE OWNED POSITION</div><div id="holdObsStatus" class="holdObsStatus warn">CHECKING…</div><div id="holdObsUpdated" class="holdObsNote">OBSERVATION ONLY · UPDATED —</div></div>'
new='<div class="holdObsHead"><div class="holdObsTitle">LIVE POSITION / THESIS STATUS</div><div id="holdObsStatus" class="holdObsStatus warn">CHECKING…</div><div id="holdObsUpdated" class="holdObsNote">OBSERVATION ONLY · UPDATED —</div><div class="holdQuickNav"><button id="holdJumpPositions" type="button">POSITIONS</button><button id="holdJumpOrders" type="button">ORDERS</button></div></div>'
if old not in s: raise SystemExit('hold header anchor missing')
s=s.replace(old,new,1)
old="else cards.innerHTML='<div class=\"holdEmpty\">NO AUTHENTICATED PROVIDER-CONFIRMED OPEN POSITION · DEFAULT HOLD REMAINS 5:00 · .20 EXIT ACTIVE</div>'}"
new="else cards.innerHTML='<div class=\"holdEmpty\">NO LIVE OWNED POSITION</div>';const panel=$('holdObsPanel');if(panel)panel.classList.toggle('compactNoPos',!ps.length&&!state?.recentClosed)}"
if old not in s: raise SystemExit('no-position anchor missing')
s=s.replace(old,new,1)
nav='''\n<script>\n/* PROMOTED_LIVE_POSITION_NAV_V1 — navigation only */\n(()=>{function jump(tab){const b=document.querySelector('.tabs button[data-tab="'+tab+'"]');if(b)b.click();document.getElementById('evidenceWorkspace')?.scrollIntoView({behavior:'smooth',block:'start'})}document.getElementById('holdJumpPositions')?.addEventListener('click',()=>jump('positions'));document.getElementById('holdJumpOrders')?.addEventListener('click',()=>jump('orders'));})();\n</script>\n'''
if 'PROMOTED_LIVE_POSITION_NAV_V1' not in s:
    s=s.replace('</body>',nav+'\n</body>',1)
p.write_text(s)
print('PROMOTED_LIVE_POSITION_PATCHED=YES')
