from pathlib import Path
import re

path=Path('market-edge-lab/real/baseline/founder-terminal.html')
s=path.read_text()

css=r'''
/* FINAL_TOP_CLEANUP_V1 — presentation only */
.topLegacySource{display:none!important}
.topSummaryBand{border-bottom:1px solid var(--line);background:#071019;padding:10px 12px}
.topBandHead{font-size:10px;font-weight:900;letter-spacing:.14em;color:var(--gold);margin-bottom:7px}
.topBandGrid{display:grid;gap:8px}.topBandGrid.accountBandGrid{grid-template-columns:repeat(4,minmax(180px,1fr))}.topBandGrid.runBandGrid{grid-template-columns:repeat(4,minmax(190px,1fr))}.topBandGrid.systemBandGrid{grid-template-columns:repeat(5,minmax(140px,1fr))}
.topBandCard{border:1px solid var(--line2);background:#09121b;padding:10px 12px;min-width:0;border-radius:4px}.topBandCard.compact{padding:8px 10px}.topBandLabel{font-size:9px;font-weight:900;letter-spacing:.09em;color:#73889d}.topBandValue{font-size:17px;line-height:1.2;font-weight:900;color:#edf5fd;margin-top:4px;overflow-wrap:anywhere}.topBandValue.green{color:var(--green)}.topBandValue.red{color:var(--red)}.topBandValue.gold{color:var(--gold)}.topBandValue.amber{color:var(--amber)}.topBandSub{font-size:10px;color:var(--muted);margin-top:5px;line-height:1.35}.topBandPair{display:flex;gap:12px;flex-wrap:wrap}.topBandPair span{white-space:nowrap}.topBandPair b{color:#cfe0ef}
@media(max-width:1050px){.topBandGrid.accountBandGrid,.topBandGrid.runBandGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.topBandGrid.systemBandGrid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:620px){.topSummaryBand{padding:9px 8px}.topBandGrid.accountBandGrid,.topBandGrid.runBandGrid,.topBandGrid.systemBandGrid{grid-template-columns:1fr 1fr}.topBandCard{padding:9px}.topBandValue{font-size:15px}.topBandSub{font-size:9px}}
@media(max-width:390px){.topBandGrid.accountBandGrid,.topBandGrid.runBandGrid,.topBandGrid.systemBandGrid{grid-template-columns:1fr}}
'''
if 'FINAL_TOP_CLEANUP_V1' not in s:
    s=s.replace('</style>',css+'\n</style>',1)

# Keep legacy source DOM and its existing refresh logic intact, but remove it from visual flow.
s=s.replace('<section class="strip account">','<section class="strip account topLegacySource" aria-hidden="true">',1)
s=s.replace('<section class="strip sleeves">','<section class="strip sleeves topLegacySource" aria-hidden="true">',1)
s=s.replace('<section class="strip auto">','<section class="strip auto topLegacySource" aria-hidden="true">',1)
s=s.replace('<section class="kalshiSummary" id="kalshiAccountSummary"','<section class="kalshiSummary topLegacySource" id="kalshiAccountSummary" aria-hidden="true"',1)
s=s.replace('<section class="advisorPanel" id="advisorPanel">','<section class="advisorPanel topLegacySource" id="advisorPanel" aria-hidden="true">',1)

bands=r'''
<section class="topSummaryBand" id="accountSummaryBand">
  <div class="topBandHead">ACCOUNT</div>
  <div class="topBandGrid accountBandGrid">
    <div class="topBandCard"><div class="topBandLabel">ACCOUNT VALUE</div><div id="topAccountValue" class="topBandValue">—</div><div class="topBandSub">BUYING POWER <b id="topBuyingPower">—</b></div></div>
    <div class="topBandCard"><div class="topBandLabel">CASH</div><div id="topCash" class="topBandValue">—</div><div class="topBandSub">TODAY P/L <b id="topTodayPnl">—</b></div></div>
    <div class="topBandCard"><div class="topBandLabel">OPEN EXPOSURE</div><div id="topExposure" class="topBandValue">—</div><div class="topBandSub">CURRENT PROVIDER RISK</div></div>
    <div class="topBandCard"><div class="topBandLabel">LIFETIME REAL P/L</div><div id="topLifePnl" class="topBandValue">—</div><div class="topBandSub">REALIZED ACCOUNT HISTORY</div></div>
  </div>
</section>
<section class="topSummaryBand" id="runSummaryBand">
  <div class="topBandHead">ACTIVE RUN</div>
  <div class="topBandGrid runBandGrid">
    <div class="topBandCard"><div class="topBandLabel">AUTO / ARM STATUS</div><div class="topBandPair"><span>AUTO <b id="topAutoStatus">—</b></span><span>ARM <b id="topArmStatus">—</b></span></div><div class="topBandSub">RUN STATE</div></div>
    <div class="topBandCard"><div class="topBandLabel">CURRENT RUN</div><div id="topCurrentRun" class="topBandValue">—</div><div class="topBandSub">STAGE <b id="topStage">—</b> · ATTEMPTS <b id="topAttempts">—</b></div></div>
    <div class="topBandCard"><div class="topBandLabel">OPEN POSITIONS / NEXT SCAN</div><div class="topBandPair"><span>OPEN <b id="topOpenPositions">—</b></span><span>SCAN <b id="topNextScan">—</b></span></div><div class="topBandSub">LIVE RUN PROGRESS</div></div>
    <div class="topBandCard"><div class="topBandLabel">ENTRY / EXIT THRESHOLD</div><div class="topBandPair"><span>ENTRY <b id="topEntryThreshold">—</b></span><span>EXIT <b id="topExitThreshold">—</b></span></div><div class="topBandSub">DISPLAY OF CURRENT CONTROLLER STATE</div></div>
  </div>
</section>
<section class="topSummaryBand" id="systemSummaryBand">
  <div class="topBandHead">SYSTEM / PROVIDER</div>
  <div class="topBandGrid systemBandGrid">
    <div class="topBandCard compact"><div class="topBandLabel">SOURCE</div><div class="topBandValue gold">KALSHI</div></div>
    <div class="topBandCard compact"><div class="topBandLabel">RECONCILIATION</div><div id="topRecon" class="topBandValue">—</div></div>
    <div class="topBandCard compact"><div class="topBandLabel">PROVIDER SYNC</div><div id="topProviderSync" class="topBandValue">—</div></div>
    <div class="topBandCard compact"><div class="topBandLabel">ADVISOR STATUS</div><div id="topAdvisorStatus" class="topBandValue">—</div></div>
    <div class="topBandCard compact"><div class="topBandLabel">AUTHORITY</div><div class="topBandValue green">READ ONLY</div></div>
  </div>
</section>
'''
anchor='<section class="strip account topLegacySource" aria-hidden="true">'
if 'id="accountSummaryBand"' not in s:
    if anchor not in s: raise SystemExit('account anchor missing')
    s=s.replace(anchor,bands+'\n'+anchor,1)

mirror=r'''
<script>
/* FINAL_TOP_CLEANUP_MIRROR_V1 — presentation mirror only */
(()=>{
  const pairs={accountValue:'topAccountValue',buyPower:'topBuyingPower',cash:'topCash',todayPnl:'topTodayPnl',exposure:'topExposure',lifePnl:'topLifePnl',autoStatus:'topAutoStatus',arm:'topArmStatus',run:'topCurrentRun',stage:'topStage',attempts:'topAttempts',openPos:'topOpenPositions',nextScan:'topNextScan',entry:'topEntryThreshold',exit:'topExitThreshold',sRecon:'topRecon',ksSync:'topProviderSync',advisorStatus:'topAdvisorStatus'};
  const tone=(src,dst)=>{if(!src||!dst)return;dst.classList.remove('green','red','gold','amber');if(src.classList.contains('green')||src.classList.contains('syncGood')||src.classList.contains('advisorGood'))dst.classList.add('green');else if(src.classList.contains('red')||src.classList.contains('syncBad')||src.classList.contains('advisorBad'))dst.classList.add('red');else if(src.classList.contains('gold'))dst.classList.add('gold');else if(src.classList.contains('syncWarn')||src.classList.contains('advisorWarn'))dst.classList.add('amber')};
  const copy=(srcId,dstId)=>{const src=document.getElementById(srcId),dst=document.getElementById(dstId);if(!src||!dst)return;const paint=()=>{dst.textContent=src.textContent||'—';tone(src,dst)};paint();new MutationObserver(paint).observe(src,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']})};
  for(const [src,dst] of Object.entries(pairs))copy(src,dst);
})();
</script>
'''
if 'FINAL_TOP_CLEANUP_MIRROR_V1' not in s:
    s=s.replace('</body>',mirror+'\n</body>',1)

path.write_text(s)
print('FINAL_TOP_CLEANUP_PATCHED=YES')
