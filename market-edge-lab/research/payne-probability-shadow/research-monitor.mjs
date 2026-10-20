// Isolated browser research monitor; external GET only, no secrets or writes.
import {fromVerifiedDisplayFeed} from './existing-feed-bridge.mjs';
const ASSETS=['BTC','ETH','SOL','XRP','HYPE','ZEC','DOGE','BNB','NEAR'];
const esc=s=>String(s??'UNKNOWN').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const MONITOR_ASSETS=Object.freeze(ASSETS);
export function viewModel(feed,{now=Date.now(),maximumAgeMs=60000}={}){
 const output=fromVerifiedDisplayFeed(feed);
 const byAsset=ASSETS.map(asset=>{
  const entries=output.records.filter(r=>r.ticker.startsWith('KX'+asset+'15M-'));
  const rows=entries.map(r=>{
   const ms=Date.parse(r.observedAt||'');
   const age=Number.isFinite(ms)?now-ms:null;
   const fresh=r.status==='PARTIAL_VERIFIED_PROVIDER_QUOTE'&&age!==null&&age>=0&&age<=maximumAgeMs;
   const missing=[...new Set(r.probability.missing.concat(r.depth===null?['orderBookDepth']:[],r.rules===null?['officialSettlementRules']:[]))];
   return {...r,bid:fresh?r.bid:null,ask:fresh?r.ask:null,displayStatus:fresh?'FRESH_PARTIAL':'UNKNOWN_STALE_OR_MISSING',ageMs:age,pWin:fresh?r.probability.pWin:null,expectedNetValue:fresh?r.probability.expectedNetValue:null,missing};
  });
  return {asset,rows,observed:rows.length>0};
 });
 return {assets:byAsset,coverage:output.coverage,feedGets:feed.providerGets??null,providerWrites:output.providerWrites,asOf:new Date(now).toISOString()};
}
export function renderMonitor(vm){
 const cards=vm.assets.map(a=>'<section class="asset"><h2>'+esc(a.asset)+'</h2>'+
 (a.rows.length?a.rows.map(r=>'<article class="contract"><div class="ticker">'+esc(r.ticker)+'</div><div class="side">'+esc(r.side)+' · '+esc(r.displayStatus)+'</div>'+
 '<dl><dt>Bid</dt><dd>'+esc(r.bid)+'</dd><dt>Ask</dt><dd>'+esc(r.ask)+'</dd><dt>Provider updated</dt><dd>'+esc(r.providerUpdatedAt)+'</dd><dt>Observed at</dt><dd>'+esc(r.observedAt)+'</dd>'+
 '<dt>Book depth</dt><dd>UNKNOWN</dd><dt>P_WIN</dt><dd>'+esc(r.pWin)+'</dd><dt>Expected net value</dt><dd>'+esc(r.expectedNetValue)+'</dd></dl>'+
 '<details><summary>Missing inputs ('+r.missing.length+')</summary><p>'+esc(r.missing.join(', ')||'None')+'</p></details></article>').join(''):'<p class="unknown">No eligible observed contract · UNKNOWN</p>')+'</section>').join('');
 return '<header><h1>PAYNE Probability Shadow</h1><p>Isolated read-only research · no trade controls</p><p>Coverage: '+vm.coverage.complete+'/'+vm.coverage.totalObservations+' complete · Provider writes: '+vm.providerWrites+'</p><p>Updated: '+esc(vm.asOf)+'</p></header><main>'+cards+'</main>';
}
export async function refreshMonitor({getJson,now=()=>Date.now()}={}){
 if(typeof getJson!=='function')throw Error('READ_ONLY_FEED_GET_REQUIRED');
 const feed=await getJson('/display-market-feed');
 return viewModel(feed,{now:now()});
}
