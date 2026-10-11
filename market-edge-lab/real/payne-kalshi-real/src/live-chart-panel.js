// PAYNE cockpit display-only extension. No trading or state writes.
export function injectPayneChart(html) {
  const panel = String.raw`
<section class="payneChartPanel card" id="payneChartPanel" aria-label="PAYNE live crypto chart">
 <div class="payneChartHead"><strong>LIVE KALSHI CRYPTO CHART</strong><span class="muted">Observed prices only · display-only · 10-second existing feed</span></div>
 <div id="payneChartTabs" class="payneChartTabs" role="tablist" aria-label="Cryptocurrency"></div>
 <div class="payneChartTools">
  <label>View <select id="pcType"><option value="line">LINE</option><option value="candle">CANDLESTICK</option></select></label>
  <label>Timeframe <select id="pcFrame"><option value="60000">1m</option><option value="300000">5m</option><option value="900000">15m</option><option value="3600000">1h</option></select></label>
  <label>Price <input type="color" id="pcPriceColor" value="#47c4f4"></label>
  <label>Bull <input type="color" id="pcBull" value="#64e7a4"></label>
  <label>Bear <input type="color" id="pcBear" value="#f38787"></label>
 </div>
 <div id="payneChartContract" class="payneChartContract">Awaiting authenticated Kalshi observations…</div>
 <canvas id="payneChartCanvas" aria-label="Observed Kalshi contract ask price chart"></canvas>
 <div id="payneChartLegend" class="payneChartLegend"></div>
 <div id="payneChartInfo" class="muted" role="status">History unavailable until the cockpit observes actual prices.</div>
 <div class="payneChartEma"><strong>EMA overlays (observations)</strong><div id="payneChartEmaInputs" class="payneChartEmaInputs"></div></div>
 <div class="muted">Each ticker/side is isolated. Candles show OHLC of timestamped observed asks only, not provider historical OHLC or unseen intraperiod extremes. No synthetic backfill. EMA requires enough consecutive observations.</div>
</section>`;
  const css = String.raw`
.payneChartPanel{margin:7px 0 9px;padding:12px;background:#091923;border:1px solid #37566c;max-width:100%;overflow:hidden}
.payneChartHead{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:13px}
.payneChartTabs{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0}
.payneChartTabs button{padding:7px 11px;border:1px solid #36566f;border-radius:6px}
.payneChartTabs button[aria-selected=true]{background:#27607c;border-color:#73d8f5;color:white}
.payneChartTools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.payneChartTools label{display:flex;align-items:center;gap:5px}
.payneChartTools input[type=color],.payneChartEma input[type=color]{padding:1px;width:35px;height:27px;cursor:pointer}
.payneChartContract{font-weight:600;margin:10px 0 4px;overflow-wrap:anywhere}
#payneChartCanvas{display:block;width:100%;height:255px;background:#07121b;border:1px solid #2a4052;border-radius:6px}
.payneChartLegend,.payneChartEmaInputs{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:7px 0}
.payneChartEmaInputs label{display:flex;align-items:center;gap:4px}
.payneChartEmaInputs input[type=number]{width:64px}
.payneChartEma{margin-top:10px}
@media(max-width:500px){#payneChartCanvas{height:210px}.payneChartTabs button{padding:6px 8px}}
`;
  const js = String.raw`
(function(){
'use strict';
const assets=['BTC','ETH','SOL','XRP','HYPE','ZEC','DOGE','BNB','NEAR'];
const $=id=>document.getElementById(id);
const tabs=$('payneChartTabs'), canvas=$('payneChartCanvas'), ctx=canvas.getContext('2d');
const samples=new Map(),latest=new Map();
let asset='BTC',mode='line',frame=60000;
const emaSettings=[9,12,26,200].map((period,i)=>({period,enabled:i<2,color:['#facc63','#b28cff','#fb80b9','#92e4dd'][i]}));
function label(text,cls){const el=document.createElement('span');el.className=cls||'';el.textContent=text;return el}
for(const name of assets){
 const b=document.createElement('button');b.type='button';b.textContent=name;b.dataset.asset=name;
 b.setAttribute('role','tab');b.addEventListener('click',()=>{asset=name;render()});tabs.append(b);
}
const emaInputs=$('payneChartEmaInputs');
function buildEmaInputs(){
 emaInputs.replaceChildren();
 emaSettings.forEach((e,i)=>{
   const group=document.createElement('label'),toggle=document.createElement('input');
   toggle.type='checkbox';toggle.checked=e.enabled;toggle.setAttribute('aria-label','EMA '+(i+1)+' enabled');
   toggle.addEventListener('change',()=>{e.enabled=toggle.checked;render()});
   const period=document.createElement('input');period.type='number';period.min='1';period.max='10000';
   period.step='1';period.value=String(e.period);period.setAttribute('aria-label','EMA '+(i+1)+' period');
   period.addEventListener('change',()=>{const n=Number(period.value);if(Number.isSafeInteger(n)&&n>=1&&n<=10000)e.period=n;else period.value=String(e.period);render()});
   const color=document.createElement('input');color.type='color';color.value=e.color;
   color.setAttribute('aria-label','EMA '+(i+1)+' color');
   color.addEventListener('input',()=>{e.color=color.value;render()});
   group.append(toggle,label('EMA'),period,color);emaInputs.append(group);
 });
}
buildEmaInputs();
$('pcType').addEventListener('change',e=>{mode=e.target.value;render()});
$('pcFrame').addEventListener('change',e=>{frame=Number(e.target.value);render()});
for(const id of ['pcPriceColor','pcBull','pcBear'])$(id).addEventListener('input',render);
function chooseQuote(){
 const all=[...latest.values()].filter(q=>q.asset===asset&&q.status==='LIVE'&&q.ticker&&q.outcomeSide);
 all.sort((a,b)=>(Date.parse(b.observedAt)||0)-(Date.parse(a.observedAt)||0));
 return all[0]||null;
}
function ingest(feed){
 if(!feed||feed.ok!==true||feed.source!=='PAYNE_AUTHENTICATED_KALSHI_GET_ONLY')return;
 for(const q of feed.quotes||[]){
  if(!assets.includes(q.asset)||q.status!=='LIVE'||!q.ticker||!['YES','NO'].includes(q.outcomeSide))continue;
  const t=Date.parse(q.observedAt),end=Date.parse(q.closeTime),p=Number(q.selectedAsk);
  if(!Number.isFinite(t)||!Number.isFinite(end)||t>=end||t>Date.now()+3000||q.selectedAsk==null||!Number.isFinite(p)||p<0||p>1)continue;
  const key=q.ticker+'|'+q.outcomeSide, rows=samples.get(key)||[];
  if(!rows.length||t>rows[rows.length-1].t){
   rows.push({t,p});
   if(rows.length>1500)rows.shift();
   samples.set(key,rows);
  }
  latest.set(key,q);
 }
 render();
}
window.payneChartAcceptFeed=ingest;
function ema(points,n){
 let output=[],values=[],previous=null;
 const alpha=2/(n+1);
 for(let i=0;i<points.length;i++){
  if(i&&points[i].t-points[i-1].t>30000){output=[];values=[];previous=null;}
  values.push(points[i].p);
  if(values.length<n)continue;
  if(previous===null)previous=values.slice(0,n).reduce((a,b)=>a+b,0)/n;
  else previous=points[i].p*alpha+previous*(1-alpha);
  output.push({t:points[i].t,p:previous});
 }
 return output;
}
function render(){
 for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.asset===asset));
 const q=chooseQuote(), info=$('payneChartInfo'), contract=$('payneChartContract');
 const fresh=q&&Date.now()-Date.parse(q.observedAt)<=20000&&Date.now()<Date.parse(q.closeTime);
 contract.textContent=q?asset+' · '+q.ticker+' · '+q.outcomeSide+' / '+q.direction+
   ' · BID '+(q.selectedBid==null?'N/A':Number(q.selectedBid).toFixed(3))+
   ' · ASK '+(q.selectedAsk==null?'N/A':Number(q.selectedAsk).toFixed(3))+
   ' · PROVIDER '+(q.providerUpdatedAt||'timestamp unavailable')+
   ' · OBSERVED '+q.observedAt+
   ' · REMAINING '+Math.max(0,Math.ceil((Date.parse(q.closeTime)-Date.now())/1000))+'s'+
   ' · '+(fresh?'LIVE':'STALE') :
   asset+' · NO CURRENT AUTHENTICATED CONTRACT IN FEED';
 const dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(300,canvas.clientWidth||700),h=canvas.clientHeight||255;
 canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 ctx.fillStyle='#07121b';ctx.fillRect(0,0,w,h);
 $('payneChartLegend').replaceChildren();
 if(!q){info.textContent='No live Kalshi contract for '+asset+'. Historical contracts are not concatenated.';return;}
 const key=q.ticker+'|'+q.outcomeSide,all=samples.get(key)||[];
 const span=frame*12,now=Date.now();
 const visible=all.filter(x=>x.t>=now-span&&x.t<=now);
 if(visible.length<2){info.textContent='History unavailable: fewer than two authentic observations in this '+Math.round(frame/60000)+'m candle timeframe (12 buckets). Chart collection begins when the cockpit is open.';return;}
 const candles=[];
 if(mode==='candle'){
  const grouped=new Map();
  for(const pt of visible){const bucket=Math.floor(pt.t/frame)*frame;let c=grouped.get(bucket);
   if(!c){c={t:bucket,o:pt.p,h:pt.p,l:pt.p,c:pt.p,n:0};grouped.set(bucket,c)}
   c.h=Math.max(c.h,pt.p);c.l=Math.min(c.l,pt.p);c.c=pt.p;c.n++;
  }
  candles.push(...grouped.values());
  if(candles.every(c=>c.n<2)){info.textContent='Insufficient intraperiod observations to display authentic candles. No OHLC backfill.';return;}
 }
 const overlays=emaSettings.filter(e=>e.enabled).map(e=>({...e,points:ema(all,e.period).filter(p=>p.t>=now-span)}));
 const prices=visible.map(p=>p.p).concat(overlays.flatMap(e=>e.points.map(p=>p.p)));
 const low=Math.max(0,Math.min(...prices)-0.02),high=Math.min(1,Math.max(...prices)+0.02);
 const left=46,right=w-12,top=15,bottom=h-25;
 const X=t=>left+(t-(now-span))/span*(right-left);
 const Y=p=>bottom-(p-low)/Math.max(.0001,high-low)*(bottom-top);
 ctx.lineWidth=1;ctx.strokeStyle='#243848';ctx.fillStyle='#99adbd';ctx.font='11px system-ui';
 for(let i=0;i<=4;i++){const y=top+i*(bottom-top)/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillText((high-(high-low)*i/4).toFixed(2),6,y+3);}
 if(mode==='line'){
  ctx.beginPath();visible.forEach((p,i)=>{if(i===0||p.t-visible[i-1].t>30000)ctx.moveTo(X(p.t),Y(p.p));else ctx.lineTo(X(p.t),Y(p.p)});
  ctx.strokeStyle=$('pcPriceColor').value;ctx.lineWidth=2;ctx.stroke();
  $('payneChartLegend').append(label('Observed ask · '+visible.length+' samples'));
 }else{
  const width=Math.max(4,Math.min(18,(right-left)/Math.max(8,candles.length*2)));
  for(const c of candles){
   if(c.n<2)continue;
   const x=X(c.t+frame/2),up=c.c>=c.o;
   ctx.strokeStyle=ctx.fillStyle=up?$('pcBull').value:$('pcBear').value;
   ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(x,Y(c.h));ctx.lineTo(x,Y(c.l));ctx.stroke();
   ctx.fillRect(x-width/2,Math.min(Y(c.o),Y(c.c)),width,Math.max(2,Math.abs(Y(c.o)-Y(c.c))));
  }
  $('payneChartLegend').append(label('Observed OHLC · '+candles.filter(c=>c.n>=2).length+' populated buckets'));
 }
 for(const e of overlays){
  const legend=label('EMA '+e.period+(e.points.length?'':' (unavailable)'));legend.style.color=e.color;$('payneChartLegend').append(legend);
  if(e.points.length<2)continue;
  ctx.beginPath();e.points.forEach((p,i)=>{if(i===0)ctx.moveTo(X(p.t),Y(p.p));else ctx.lineTo(X(p.t),Y(p.p))});
  ctx.strokeStyle=e.color;ctx.lineWidth=1.6;ctx.stroke();
 }
 info.textContent=visible.length+' actual timestamped observations · '+Math.round(frame/60000)+'m OHLC buckets · 12-bucket window · '+(fresh?'Fresh':'Stale')+
   (mode==='candle'?' · Candle buckets with fewer than 2 observations omitted':'')+
   ' · Provider historical OHLC unavailable.';
}
const observer=new ResizeObserver(render);observer.observe(canvas);
setInterval(()=>{if(latest.size)render()},10000);
render();
})();
`;
  return html.replace('</style>',css+'</style>')
    .replace('<div id="status"',panel+'<div id="status"')
    .replace('</body>','<script>'+js+'</script></body>');
}
