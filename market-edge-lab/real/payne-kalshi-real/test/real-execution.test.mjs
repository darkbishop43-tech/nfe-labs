import worker from '../src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  defaultControlState,
  updateFounderControl,
  loadControl,
  defaultRealSeriesState,
  saveRealSeriesState,
  loadRealSeriesState,
  listRealLedger,
  runPayneRealExecutionCycle,
  interpretPayneOrderResponse,
  runReadOnlyScan,
  summarizeRealExecutionState,
  reconcileUnresolvedEntryFromProvider,
  buildHistoricalSeriesReport,
  listRealAttemptsForSeries,
} from '../src/index.js';
import { kalshiPayneOrderPost, payneOrderWriteProof } from '../src/kalshi-real-write.js';

if (!globalThis.crypto) globalThis.crypto=webcrypto;

class MemoryKV {
  constructor(){this.store=new Map([['payne-kalshi:control:v1',JSON.stringify(defaultControlState())]]);}
  async get(key){return this.store.has(key)?this.store.get(key):null;}
  async put(key,value){this.store.set(key,String(value));}
  async delete(key){this.store.delete(key);}
  async list({prefix=''}={}){return {keys:[...this.store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true};}
}

function jsonResponse(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});}

function baselineShadow({score=.86,move=.005,edge=.09,close='2026-10-02T06:15:00Z'}={}){
  return {
    ok:true,mode:'REAL_KALSHI_SHADOW',status:'LIVE_KALSHI_SHADOW',startedAt:'2026-10-02T06:00:00Z',lastRunAt:'2026-10-02T06:04:30Z',
    priceSources:{BTC:'COINBASE'},
    opportunities:[
      {marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',asset:'BTC',move,fair:.59,edge,score,openTime:'2026-10-02T06:00:00Z',closeTime:close,durationMs:Date.parse(close)-Date.parse('2026-10-02T06:00:00Z'),horizon:'15m'},
      {marketTicker:'KXBTC15M-REALTEST',outcomeSide:'NO',direction:'DOWN',asset:'BTC',move,fair:.41,edge:-Math.abs(edge),score:.14,openTime:'2026-10-02T06:00:00Z',closeTime:close,durationMs:Date.parse(close)-Date.parse('2026-10-02T06:00:00Z'),horizon:'15m'},
    ],
  };
}

function moveForScore(score){
  return (Number(score)-0.5)/72;
}
async function seedPaynePriorSpot(e,shadow=baselineShadow()){
  const yes=(shadow?.opportunities||[]).find(x=>x?.asset==='BTC'&&x?.outcomeSide==='YES');
  const move=Number.isFinite(Number(yes?.score))?moveForScore(yes.score):Number(yes?.move||0);
  const prior=100/(1+move);
  await e.PAYNE_KALSHI_STATE.put('payne-kalshi:feature-shadow:v2-paper-brain',JSON.stringify({
    schema:'PAYNE_PAPER_BRAIN_KALSHI_FEATURE_STATE_V1',
    savedAt:'2026-10-02T06:04:00Z',
    prices:{BTC:prior},
    referencePrices:{BTC:prior},
    priceSources:{BTC:'COINBASE'}
  }));
}

function baselineService(shadow=baselineShadow(),autoPositions=[]){
  return {async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/shadow-state') return jsonResponse(shadow);
    if(url.pathname==='/execution-test-state') return jsonResponse({ok:true,readOnly:true,state:{status:'COMPLETE',positions:autoPositions,attempts:[]}});
    if(url.pathname==='/execution-test-nofill-forensic') return jsonResponse({ok:true,audited:[]});
    if(url.pathname==='/forensic-provider-history') return jsonResponse({ok:true,fills:[],settlements:[],positions:[]});
    return jsonResponse({ok:false,error:'NOT_FOUND'},404);
  }};
}

async function credentials(){
  const pair=await crypto.subtle.generateKey({name:'RSA-PSS',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const der=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  let binary=''; for(const b of der) binary+=String.fromCharCode(b);
  const base64=btoa(binary).match(/.{1,64}/g).join('\n');
  return {KALSHI_EXECUTION_KEY_ID:'TEST_KEY',KALSHI_EXECUTION_PRIVATE_KEY:`-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`};
}

async function env({shadow=baselineShadow(),autoPositions=[]}={}){
  const claims=new Map();
  const coordinator={
    idFromName:name=>name,
    get:name=>({
      fetch:async(_url,opts)=>{
        const claim=JSON.parse(opts.body);
        const key=name+':'+claim.attemptNo;
        if(claim.action==='RESOLVE_ENTRY'){
          const prior=claims.get(key);
          if(!prior)return jsonResponse({granted:false,reason:'CLAIM_NOT_FOUND'});
          claims.set(key,{...prior,claimState:claim.resolution});
          return jsonResponse({granted:true,reason:'ENTRY_RESOLUTION_PERSISTED'});
        }
        if(claim.action==='RELEASE_PROVEN_NO_POST'){
          const prior=claims.get(key);
          if(prior?.specimenId===claim.specimenId && prior?.clientOrderId===claim.clientOrderId && claim.provenNoProviderPost===true){
            claims.delete(key); return jsonResponse({granted:true,reason:'PROVEN_NO_POST_RELEASED'});
          }
          return jsonResponse({granted:false,reason:'CLAIM_NOT_OWNED'});
        }
        if(claims.has(key)) return jsonResponse({granted:false,reason:'ATTEMPT_ALREADY_CLAIMED'});
        claims.set(key,structuredClone(claim));
        return jsonResponse({granted:true,reason:'ATOMIC_CLAIM_PERSISTED'});
      }
    })
  };
  const e={PAYNE_KALSHI_STATE:new MemoryKV(),PAYNE_EXECUTION_COORDINATOR:coordinator,BASELINE_REAL_READ:baselineService(shadow,autoPositions),...(await credentials())};
  await seedPaynePriorSpot(e,shadow);
  return e;
}

function providerMarket({status='open',close='2026-10-02T06:15:00Z',exchangeIndex=2,yesBid=.48,yesAsk=.50,ticker='KXBTC15M-REALTEST'}={}){
  return {
    ticker,series_ticker:ticker.split('-')[0],exchange_index:exchangeIndex,title:'Synthetic 15 minute market',status,
    open_time:'2026-10-02T06:00:00Z',close_time:close,
    yes_bid_dollars:String(yesBid),yes_ask_dollars:String(yesAsk),
    no_bid_dollars:String(1-yesAsk),no_ask_dollars:String(1-yesBid),
  };
}

function installProvider({index3=0,index2=15.91,position='ABSENT',exactSequence=[],settled=false,orders=[],fills=[],historicalFills=[],settlements=null,entryResult=null,discoveryDelayMs=0,syntheticPostThrows=false,onSyntheticPost=null,multiPositions=[],multiPositionStatus='OPEN',multiMarkets=[]}={}){
  const original=globalThis.fetch,calls=[]; let exactNo=0;
  globalThis.fetch=async (url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET',body:options.body||null});
    const u=String(url);
    if(u.includes('/trade-api/v2/portfolio/events/orders') && options.method==='POST'){
      if(typeof onSyntheticPost==='function')onSyntheticPost();
      if(syntheticPostThrows)throw new Error('SYNTHETIC_POST_RESULT_UNCERTAIN');
      if(entryResult!==null)return jsonResponse(entryResult);
    }
    if((multiPositions.length||multiMarkets.length) && /api.exchange.coinbase.com\/products\/(BTC|ETH|SOL|XRP)-USD\/ticker/.test(u))
      return jsonResponse({price:'100'});
    if(u.includes('api.exchange.coinbase.com/products/BTC-USD/ticker')) return jsonResponse({price:'100'});
    if(u.includes('/portfolio/balance')) return jsonResponse({balance_breakdown:[{exchange_index:0,balance:0},{exchange_index:2,balance:index2},{exchange_index:3,balance:index3}]});
    if(multiMarkets.length && u.includes('/trade-api/v2/markets?series_ticker=')){
      const series=decodeURIComponent(u.split('series_ticker=')[1]?.split('&')[0]||'');
      const matched=multiMarkets.filter(t=>t.split('-')[0]===series);
      return jsonResponse({markets:matched.map(ticker=>providerMarket({ticker}))});
    }
    if(u.includes('series_ticker=KXBTC15M')){
      if(discoveryDelayMs>0) await new Promise(resolve=>setTimeout(resolve,discoveryDelayMs));
      return jsonResponse({markets:[providerMarket()]});
    }
    if(u.includes('/trade-api/v2/markets?series_ticker=')) return jsonResponse({markets:[]});
    if(u.includes('/portfolio/orders?')) return jsonResponse({orders});
    if(u.includes('/portfolio/fills?')) return jsonResponse({fills});
    if(u.includes('/historical/fills?')) return jsonResponse({fills:historicalFills});
    if(u.includes('/portfolio/positions?')&&multiPositions.length)
      return jsonResponse({market_positions:multiPositions.map(ticker=>({ticker,position_fp:multiPositionStatus==='FLAT'?'0':'1'})),cursor:''});
    if(u.includes('/portfolio/positions?')){
      if(position==='HTTP_FAIL') return jsonResponse({error:'x'},500);
      if(position==='OPEN') return jsonResponse({market_positions:[{ticker:'KXBTC15M-REALTEST',position_fp:'1'}],cursor:''});
      if(position==='FLAT') return jsonResponse({market_positions:[{ticker:'KXBTC15M-REALTEST',position_fp:'0'}],cursor:''});
      return jsonResponse({market_positions:[],cursor:''});
    }
    if(u.includes('/portfolio/settlements?')) return jsonResponse({settlements:Array.isArray(settlements)?settlements:(settled?[{ticker:'KXBTC15M-REALTEST',market_result:'yes',settled_time:'2026-10-02T06:16:00Z'}]:[])});
    if((multiPositions.length||multiMarkets.length) && u.includes('/markets/')){
      const ticker=decodeURIComponent(u.split('/markets/')[1]?.split('?')[0]||'');
      if(multiPositions.includes(ticker)||multiMarkets.includes(ticker))return jsonResponse(providerMarket({ticker,yesBid:.49,yesAsk:.50}));
    }
    if(u.includes('/markets/KXBTC15M-REALTEST')){
      const x=exactSequence.length?exactSequence[Math.min(exactNo++,exactSequence.length-1)]:{status:200,market:providerMarket({yesBid:.49,yesAsk:.50})};
      return jsonResponse(x.market||{},x.status??200);
    }
    throw new Error('unexpected provider URL '+u);
  };
  return {calls,restore:()=>{globalThis.fetch=original;}};
}

function postFixture(resultBody,status=200){
  const calls=[];
  const fn=async (env,kind,payload,scope)=>{
    calls.push({kind,payload:structuredClone(payload),scope:structuredClone(scope)});
    return {response:jsonResponse(resultBody,status),proof:payneOrderWriteProof(kind,payload,scope),writerInvoked:true,providerPostStarted:true};
  };
  return {calls,fn};
}

async function arm(e){
  const c=await updateFounderControl(e,'ARM');
  assert.equal(c.armed,true);
  return c;
}

async function scanThenExecute(e,post,ms=Date.parse('2026-10-02T06:05:00Z')){
  await runReadOnlyScan(e,'ZERO_MONEY_EXECUTION_TEST',ms);
  return runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:ms});
}

test('UNKNOWN entry self-reconciliation: authenticated provider proves FLAT/no execution and clears unresolvedEntry',async()=>{
  const e=await env(),io=installProvider({position:'ABSENT',orders:[],fills:[],historicalFills:[],settlements:[]});
  try{
    const series={
      ...defaultRealSeriesState(),
      seriesId:'RECON-FLAT',status:'ENTRY_RECONCILIATION_REQUIRED',attemptsStarted:1,attemptTarget:1,
      configFrozen:true,unresolvedEntry:true,
      currentAttempt:{
        schema:'PAYNE_REAL_ATTEMPT_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'RECON-FLAT',
        attemptId:'RECON-FLAT-1',attemptNo:1,status:'WRITE_ERROR_UNKNOWN',
        asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',
        clientOrderId:'payne-real-reconflat-1-entry',payload:{client_order_id:'payne-real-reconflat-1-entry'},
      },
    };
    await saveRealSeriesState(e,series);
    const out=await reconcileUnresolvedEntryFromProvider(e,Date.parse('2026-10-02T06:16:00Z'));
    assert.equal(out.ok,true);
    assert.equal(out.classification,'FLAT');
    assert.equal(out.reason,'PROVIDER_RECONCILED_NO_EXECUTION');
    assert.equal(out.terminalClassification,'NO_PROVIDER_EXECUTION');
    assert.equal(out.exactOrderCount,0);
    assert.equal(out.exactFillCount,0);
    assert.equal(out.exactSettlementCount,0);
    assert.equal(out.series.unresolvedEntry,false);
    assert.equal(out.series.position,null);
    assert.equal(out.series.status,'COMPLETE_ENTRY_AUTHORITY');
    assert.equal(out.series.currentAttempt.status,'NO_PROVIDER_EXECUTION');
    assert.equal(out.control.armed,false);
    const ledger=await listRealLedger(e,100);
    assert.ok(ledger.some(x=>x.type==='ENTRY_RECONCILED_NO_EXECUTION'&&x.attemptId==='RECON-FLAT-1'));
  }finally{io.restore();}
});

test('UNKNOWN entry self-reconciliation: exact PAYNE order/fill plus OPEN provider position restores owned management state',async()=>{
  const client='payne-real-owned-1-entry', order='ORDER-OWNED';
  const e=await env(),io=installProvider({
    position:'OPEN',
    orders:[{ticker:'KXBTC15M-REALTEST',client_order_id:client,order_id:order,fill_count:1,average_fill_price:.50,average_fee_paid:.02}],
    fills:[{ticker:'KXBTC15M-REALTEST',client_order_id:client,order_id:order,count:1}],
  });
  try{
    await saveRealSeriesState(e,{
      ...defaultRealSeriesState(),seriesId:'RECON-OWNED',status:'ENTRY_RECONCILIATION_REQUIRED',
      attemptsStarted:1,attemptTarget:1,configFrozen:true,unresolvedEntry:true,
      currentAttempt:{
        schema:'PAYNE_REAL_ATTEMPT_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'RECON-OWNED',
        attemptId:'RECON-OWNED-1',attemptNo:1,status:'UNKNOWN',asset:'BTC',
        marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',
        score:.72,move:.003,edge:.05,preSubmitAt:'2026-10-02T06:05:00Z',
        clientOrderId:client,payload:{client_order_id:client},
      }
    });
    const out=await reconcileUnresolvedEntryFromProvider(e,Date.parse('2026-10-02T06:05:30Z'));
    assert.equal(out.ok,true);
    assert.equal(out.classification,'OWNED');
    assert.equal(out.series.unresolvedEntry,false);
    assert.equal(out.series.position.status,'OPEN');
    assert.equal(out.series.position.owner,'PAYNE_KALSHI_REAL');
    assert.equal(out.series.position.entryOrderId,order);
    assert.equal(out.series.position.entryClientOrderId,client);
    assert.equal(out.series.position.filledCount,1);
    const ledger=await listRealLedger(e,100);
    assert.ok(ledger.some(x=>x.type==='ENTRY_RECONCILED_OWNED'));
  }finally{io.restore();}
});

test('UNKNOWN entry remains fail-closed when provider ownership is OPEN but PAYNE order/fill identity is absent',async()=>{
  const e=await env(),io=installProvider({position:'OPEN',orders:[],fills:[],historicalFills:[],settlements:[]});
  try{
    await saveRealSeriesState(e,{
      ...defaultRealSeriesState(),seriesId:'RECON-UNKNOWN',status:'ENTRY_RECONCILIATION_REQUIRED',
      attemptsStarted:1,attemptTarget:5,configFrozen:true,unresolvedEntry:true,
      currentAttempt:{schema:'PAYNE_REAL_ATTEMPT_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'RECON-UNKNOWN',
        attemptId:'RECON-UNKNOWN-1',attemptNo:1,status:'UNKNOWN',asset:'BTC',
        marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',
        clientOrderId:'payne-real-unknown-1-entry',payload:{client_order_id:'payne-real-unknown-1-entry'}},
    });
    const out=await reconcileUnresolvedEntryFromProvider(e,Date.parse('2026-10-02T06:05:30Z'));
    assert.equal(out.ok,false);
    assert.equal(out.classification,'UNKNOWN');
    assert.equal(out.series.unresolvedEntry,true);
    assert.equal(out.series.position,null);
  }finally{io.restore();}
});


test('scheduled tick self-reconciles a disarmed unresolved entry before any new entry authority',async()=>{
  const e=await env(),io=installProvider({position:'ABSENT',orders:[],fills:[],historicalFills:[],settlements:[]});
  try{
    await saveRealSeriesState(e,{
      ...defaultRealSeriesState(),seriesId:'SCHEDULED-RECON',status:'ENTRY_RECONCILIATION_REQUIRED',
      attemptsStarted:1,attemptTarget:1,configFrozen:true,unresolvedEntry:true,
      currentAttempt:{
        schema:'PAYNE_REAL_ATTEMPT_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'SCHEDULED-RECON',
        attemptId:'SCHEDULED-RECON-1',attemptNo:1,status:'WRITE_ERROR_UNKNOWN',
        asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',
        clientOrderId:'payne-real-sched-1-entry',payload:{client_order_id:'payne-real-sched-1-entry'},
      },
    });
    assert.equal((await loadControl(e)).armed,false);
    await worker.scheduled({},e);
    const after=await loadRealSeriesState(e);
    assert.equal(after.unresolvedEntry,false);
    assert.equal(after.position,null);
    assert.equal(after.currentAttempt.status,'NO_PROVIDER_EXECUTION');
    assert.equal(after.status,'COMPLETE_ENTRY_AUTHORITY');
    assert.equal((await loadControl(e)).armed,false);
    assert.equal(io.calls.filter(c=>c.method==='POST').length,0);
  }finally{io.restore();}
});

test('historical UNKNOWN is removed when a later authoritative no-execution event resolves the attempt',()=>{
  const ledger=[
    {at:'2026-10-04T00:00:00Z',seriesId:'HIST-1',attemptId:'HIST-1-1',type:'ENTRY_PRE_SUBMIT_LATCHED'},
    {at:'2026-10-04T00:00:01Z',seriesId:'HIST-1',attemptId:'HIST-1-1',type:'ENTRY_RESULT_UNKNOWN'},
    {at:'2026-10-04T00:00:02Z',seriesId:'HIST-1',attemptId:'HIST-1-1',type:'ENTRY_RECONCILED_NO_EXECUTION'},
  ];
  const out=summarizeRealExecutionState({
    control:{armed:false,attempts:1,attemptTarget:1},
    series:{seriesId:'HIST-1',attemptsStarted:1,attemptTarget:1,status:'COMPLETE_NO_FILL_RECONCILED',unresolvedEntry:false,position:null,currentAttempt:{status:'NO_FILL',providerResult:{state:'NO_FILL'}}},
    ledger,
  });
  assert.equal(out.attempted,1);
  assert.equal(out.filled,0);
  assert.equal(out.noFill,0);
  assert.equal(out.providerReconciledNoExecution,1);
  assert.equal(out.unknown,0);
  assert.equal(out.lastAttempt.result,'NO_PROVIDER_EXECUTION');
});

test('read-only historical series report returns current terminal truth and P&L without provider writes',async()=>{
  const e=await env();
  const seriesId='HIST-PNL',attemptId='HIST-PNL-1';
  await e.PAYNE_KALSHI_STATE.put('payne-kalshi:run:'+seriesId,JSON.stringify({
    runId:seriesId,threshold:.70,maxEntryDebitUsd:1,attemptTarget:1,requiredExchangeIndex:2,frozenAt:'2026-10-04T00:00:00Z'
  }));
  await e.PAYNE_KALSHI_STATE.put('payne-kalshi:attempt:'+seriesId+':1',JSON.stringify({
    runId:seriesId,seriesId,attemptId,attemptNo:1,asset:'BTC',marketTicker:'KXBTC15M-HIST',direction:'UP',outcomeSide:'YES',
    score:.72,threshold:.70,maxEntryDebitUsd:1,freshLockPrice:.50,preSubmitPrice:.50,estimatedEntryDebitUsd:.52,
    clientOrderId:'payne-real-hist-1-entry',payload:{side:'bid',price:'0.5000'},
    providerResult:{state:'FILLED',orderId:'ORDER-HIST',clientOrderId:'payne-real-hist-1-entry',fillCount:1,remainingCount:0,averageFillPrice:.50,averageFeePaid:.02},
  }));
  await e.PAYNE_KALSHI_STATE.put('payne-kalshi:position:'+attemptId,JSON.stringify({
    positionId:attemptId,attemptId,asset:'BTC',marketTicker:'KXBTC15M-HIST',direction:'UP',outcomeSide:'YES',
    entryOrderId:'ORDER-HIST',entryAverageFillPrice:.50,entryAverageFeePaid:.02,exitAverageFillPrice:.70,exitAverageFeePaid:.03,filledCount:1,
  }));
  const ledgerRows=[
    {schema:'PAYNE_REAL_LEDGER_V1',recordId:'1',at:'2026-10-04T00:00:00Z',owner:'PAYNE_KALSHI_REAL',type:'ENTRY_PRE_SUBMIT_LATCHED',seriesId,attemptId,attemptNo:1,asset:'BTC',marketTicker:'KXBTC15M-HIST',direction:'UP',outcomeSide:'YES',score:.72,threshold:.70,maxEntryDebitUsd:1,freshLockPrice:.50,preSubmitPrice:.50,estimatedEntryDebitUsd:.52,clientOrderId:'payne-real-hist-1-entry',payload:{side:'bid',price:'0.5000'}},
    {schema:'PAYNE_REAL_LEDGER_V1',recordId:'2',at:'2026-10-04T00:00:01Z',owner:'PAYNE_KALSHI_REAL',type:'POSITION_OWNERSHIP_ESTABLISHED',seriesId,attemptId,attemptNo:1,ticker:'KXBTC15M-HIST',entryOrderId:'ORDER-HIST',filledCount:1},
    {schema:'PAYNE_REAL_LEDGER_V1',recordId:'3',at:'2026-10-04T00:01:00Z',owner:'PAYNE_KALSHI_REAL',type:'EXIT_PROVIDER_RESULT',seriesId,attemptId,ticker:'KXBTC15M-HIST',result:{state:'FILLED',averageFillPrice:.70,averageFeePaid:.03}},
    {schema:'PAYNE_REAL_LEDGER_V1',recordId:'4',at:'2026-10-04T00:01:01Z',owner:'PAYNE_KALSHI_REAL',type:'PROVIDER_RECONCILED_FLAT',seriesId,attemptId,ticker:'KXBTC15M-HIST',realizedPnlUsd:.15},
  ];
  for(const row of ledgerRows) await e.PAYNE_KALSHI_STATE.put('payne-kalshi:real-ledger:'+row.at+':'+row.recordId,JSON.stringify(row));
  const report=await buildHistoricalSeriesReport(e,seriesId);
  assert.equal(report.readOnly,true);
  assert.equal(report.attempted,1);
  assert.equal(report.filled,1);
  assert.equal(report.noFill,0);
  assert.equal(report.unknownUnresolved,0);
  assert.equal(report.netRealizedPnlUsd,.15);
  assert.equal(report.entryFeesUsd,.02);
  assert.equal(report.exitFeesUsd,.03);
  assert.equal(report.totalFeesUsd,.05);
  assert.equal(report.grossRealizedPnlUsd,.20);
  assert.equal(report.attempts[0].finalResult,'FILLED');
  assert.equal(report.attempts[0].providerOrderId,'ORDER-HIST');

  const response=await worker.fetch(new Request('https://payne.test/real-history?seriesId='+seriesId,{method:'GET'}),e);
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.readOnly,true);
  assert.equal(body.providerWrites,0);
  assert.equal(body.ordersSubmittedByThisRead,0);
  assert.equal(body.capitalMovedUsd,0);
});

test('historical NO_FILL reports zero P&L when no actual provider fee is recorded',async()=>{
  const e=await env();
  const seriesId='HIST-NF',attemptId='HIST-NF-1';
  await e.PAYNE_KALSHI_STATE.put('payne-kalshi:run:'+seriesId,JSON.stringify({runId:seriesId,threshold:.70,maxEntryDebitUsd:1,attemptTarget:1}));
  await e.PAYNE_KALSHI_STATE.put('payne-kalshi:attempt:'+seriesId+':1',JSON.stringify({
    runId:seriesId,seriesId,attemptId,attemptNo:1,asset:'ZEC',marketTicker:'KXZEC15M-HIST',direction:'DOWN',outcomeSide:'NO',
    maxEntryDebitUsd:1,providerResult:{state:'NO_FILL',fillCount:0,remainingCount:2}
  }));
  const row={schema:'PAYNE_REAL_LEDGER_V1',recordId:'nf',at:'2026-10-04T00:02:00Z',owner:'PAYNE_KALSHI_REAL',type:'ENTRY_RECONCILED_NO_EXECUTION',seriesId,attemptId,attemptNo:1,ticker:'KXZEC15M-HIST',reconciliation:'PROVIDER_RECONCILED_NO_EXECUTION'};
  await e.PAYNE_KALSHI_STATE.put('payne-kalshi:real-ledger:'+row.at+':'+row.recordId,JSON.stringify(row));
  const report=await buildHistoricalSeriesReport(e,seriesId);
  assert.equal(report.noFill,0);
  assert.equal(report.unknownUnresolved,0);
  assert.equal(report.attempts[0].finalResult,'NO_PROVIDER_EXECUTION');
  assert.equal(report.netRealizedPnlUsd,0);
  assert.equal(report.totalFeesUsd,0);
  assert.equal(report.attempts[0].netRealizedPnlUsd,0);
});

test('authenticated Payne write transport is fixed to one order POST and zero-money intercepts ENTRY',async()=>{
  const e=await env();
  const payload={ticker:'KXBTC15M-REALTEST',client_order_id:'payne-real-test-1-entry',side:'bid',count:'1.00',price:'0.5000',time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false,cancel_order_on_pause:true,reduce_only:false};
  let intercepted=null;
  const out=await kalshiPayneOrderPost(e,'ENTRY',payload,{owner:'PAYNE_KALSHI_REAL',exchangeIndex:2,authorized:true,armed:true,attemptTarget:1,attemptsBefore:0,maxEntryDebitUsd:1,seriesConfigFrozen:true,priorAttemptClean:true,entryDebitUsd:.5},{fetchImpl:async(url,options)=>{intercepted={url,options};return jsonResponse({order_id:'O1',client_order_id:payload.client_order_id,fill_count:0,remaining_count:1});}});
  assert.equal(intercepted.url,'https://external-api.kalshi.com/trade-api/v2/portfolio/events/orders');
  assert.equal(intercepted.options.method,'POST');
  assert.equal(JSON.parse(intercepted.options.body).time_in_force,'immediate_or_cancel');
  assert.equal(out.proof.exchangeIndex,2);
  assert.equal(out.writerInvoked,true);
  assert.equal(out.providerPostStarted,true);
});


test('provider-attempt semantics A: local pre-provider rejection records intent but does not consume provider attempt',async()=>{
  const e=await env(),io=installProvider();
  const localReject={calls:[],fn:async()=>{
    localReject.calls.push(1);
    const error=new Error('ZERO_MONEY_LOCAL_PRE_PROVIDER_REJECT');
    error.payneWriterInvoked=false;
    error.payneProviderPostStarted=false;
    throw error;
  }};
  try{
    await arm(e);
    const out=await scanThenExecute(e,localReject);
    assert.equal(localReject.calls.length,1);
    assert.equal(out.executionIntentsStarted,1);
    assert.equal(out.attemptsStarted,0);
    assert.equal(out.unresolvedEntry,false);
    assert.equal(out.currentAttempt.writerInvoked,false);
    assert.equal(out.currentAttempt.providerPostStarted,false);
    assert.equal(out.currentAttempt.providerOrderId,null);
    assert.equal(out.currentAttempt.status,'INVALIDATED_BEFORE_POST');
    assert.notEqual(out.currentAttempt.providerResult.state,'NO_FILL');
    const obs=summarizeRealExecutionState({control:await loadControl(e),series:out,ledger:await listRealLedger(e,100)});
    assert.equal(obs.executionIntents,1);
    assert.equal(obs.providerOrderAttempts,0);
    assert.equal(obs.noFill,0);
  }finally{io.restore();}
});

test('provider-attempt semantics B: accepted IOC zero fill counts exactly one provider attempt and retains order identity',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'ORDER-ZERO',client_order_id:'CID-ZERO',fill_count:0,remaining_count:1,average_fill_price:null,average_fee_paid:0});
  try{
    await arm(e);
    const out=await scanThenExecute(e,post);
    assert.equal(out.executionIntentsStarted,1);
    assert.equal(out.attemptsStarted,1);
    assert.equal(out.currentAttempt.writerInvoked,true);
    assert.equal(out.currentAttempt.providerPostStarted,true);
    assert.equal(out.currentAttempt.providerOrderId,'ORDER-ZERO');
    assert.equal(out.currentAttempt.providerResponseState,'NO_FILL');
    assert.equal(out.currentAttempt.providerResult.fillCount,0);
    assert.equal(out.currentAttempt.terminalClassification,'NO_FILL');
  }finally{io.restore();}
});

test('provider-attempt semantics C: accepted fill counts provider attempt and retains filled quantity',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'ORDER-FILL-BOUNDARY',client_order_id:'CID-FILL',fill_count:1,remaining_count:0,average_fill_price:.50,average_fee_paid:.01});
  try{
    await arm(e);
    const out=await scanThenExecute(e,post);
    assert.equal(out.attemptsStarted,1);
    assert.equal(out.currentAttempt.providerPostStarted,true);
    assert.equal(out.currentAttempt.providerOrderId,'ORDER-FILL-BOUNDARY');
    assert.equal(out.currentAttempt.providerResponseState,'FILLED');
    assert.equal(out.position.filledCount,1);
    assert.equal(out.currentAttempt.terminalClassification,'FILLED');
  }finally{io.restore();}
});

test('provider-attempt semantics D: ambiguous provider response counts boundary once and requires reconciliation without retry',async()=>{
  const e=await env(),io=installProvider({position:'ABSENT',orders:[],fills:[],historicalFills:[],settlements:[]});
  let calls=0;
  const ambiguous=async()=>{
    calls++;
    const error=new Error('ZERO_MONEY_TRANSPORT_AMBIGUOUS');
    error.payneWriterInvoked=true;
    error.payneProviderPostStarted=true;
    throw error;
  };
  try{
    await arm(e);
    await runReadOnlyScan(e,'ZERO_MONEY_AMBIGUOUS',Date.parse('2026-10-02T06:05:00Z'));
    const first=await runPayneRealExecutionCycle(e,{postImpl:ambiguous,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(calls,1);
    assert.equal(first.attemptsStarted,1);
    assert.equal(first.currentAttempt.providerPostStarted,true);
    assert.equal(first.currentAttempt.providerResponseState,'UNKNOWN');
    assert.equal(first.unresolvedEntry,true);
    assert.equal(first.status,'ENTRY_RECONCILIATION_REQUIRED');
    const second=await runPayneRealExecutionCycle(e,{postImpl:ambiguous,nowMs:Date.parse('2026-10-02T06:05:30Z')});
    assert.equal(calls,1);
    assert.equal(second.attemptsStarted,1);
    assert.equal(second.unresolvedEntry,false);
    assert.equal(second.currentAttempt.status,'NO_PROVIDER_EXECUTION');
    assert.equal(second.currentAttempt.terminalClassification,'NO_PROVIDER_EXECUTION');
  }finally{io.restore();}
});

test('provider-attempt semantics E: multiple execution intents remain independently durable while only real provider boundary advances target',async()=>{
  const e=await env(),io=installProvider();
  let localCalls=0;
  const localReject=async()=>{
    localCalls++;
    const error=new Error('ZERO_MONEY_LOCAL_REJECT');
    error.payneWriterInvoked=false;
    error.payneProviderPostStarted=false;
    throw error;
  };
  const zero=postFixture({order_id:'ORDER-AFTER-LOCAL',client_order_id:'CID-AFTER-LOCAL',fill_count:0,remaining_count:1,average_fee_paid:0});
  try{
    await updateFounderControl(e,'SET_ATTEMPT_TARGET',5);
    await arm(e);
    await runReadOnlyScan(e,'ZERO_MONEY_RETENTION_1',Date.parse('2026-10-02T06:05:00Z'));
    const first=await runPayneRealExecutionCycle(e,{postImpl:localReject,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(first.executionIntentsStarted,1);
    assert.equal(first.attemptsStarted,0);

    await runReadOnlyScan(e,'ZERO_MONEY_RETENTION_2',Date.parse('2026-10-02T06:05:10Z'));
    const second=await runPayneRealExecutionCycle(e,{postImpl:zero.fn,nowMs:Date.parse('2026-10-02T06:05:10Z')});
    assert.equal(second.executionIntentsStarted,2);
    assert.equal(second.attemptsStarted,1);

    const attempts=await listRealAttemptsForSeries(e,second.seriesId);
    assert.equal(attempts.length,2);
    assert.equal(attempts[0].intentNo,1);
    assert.equal(attempts[0].providerAttemptCounted,false);
    assert.equal(attempts[0].status,'INVALIDATED_BEFORE_POST');
    assert.equal(attempts[1].intentNo,2);
    assert.equal(attempts[1].providerAttemptCounted,true);
    assert.equal(attempts[1].providerAttemptNo,1);
    assert.equal(attempts[1].providerOrderId,'ORDER-AFTER-LOCAL');
  }finally{io.restore();}
});

test('authenticated Payne write transport permits only PAYNE-owned reduce-only EXIT',async()=>{
  const e=await env();
  const payload={ticker:'KXBTC15M-REALTEST',client_order_id:'payne-real-test-1-exit',side:'ask',count:'1.00',price:'0.4900',time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',post_only:false,cancel_order_on_pause:true,reduce_only:true};
  let count=0;
  await kalshiPayneOrderPost(e,'EXIT',payload,{owner:'PAYNE_KALSHI_REAL',exchangeIndex:2,authorized:true,ownedByPayne:true,ownedTicker:'KXBTC15M-REALTEST'},{fetchImpl:async()=>{count++;return jsonResponse({order_id:'X1',client_order_id:payload.client_order_id,fill_count:1,remaining_count:0});}});
  assert.equal(count,1);
  await assert.rejects(kalshiPayneOrderPost(e,'EXIT',{...payload,reduce_only:false},{owner:'PAYNE_KALSHI_REAL',exchangeIndex:2,authorized:true,ownedByPayne:true,ownedTicker:'KXBTC15M-REALTEST'},{fetchImpl:async()=>jsonResponse({})}),/PAYNE_EXIT_REDUCE_ONLY_REQUIRED/);
});

test('DISARMED makes provider POST impossible',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'O',fill_count:0,remaining_count:1});
  try{
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.status,'READY_DISARMED');
    assert.equal(post.calls.length,0);
  }finally{io.restore();}
});

test('ARMED qualifying opportunity constructs exactly one Index 2 $1 IOC ENTRY and NO_FILL completes 1/1',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'ENTRY-1',client_order_id:'payne-real-fixture-1-entry',fill_count:0,remaining_count:1,average_fill_price:null,average_fee_paid:0});
  try{
    await arm(e);
    const out=await scanThenExecute(e,post);
    assert.equal(post.calls.length,1);
    assert.equal(post.calls[0].kind,'ENTRY');
    assert.equal(post.calls[0].scope.exchangeIndex,2);
    assert.equal(post.calls[0].scope.maxEntryDebitUsd,1);
    assert.equal(post.calls[0].payload.time_in_force,'immediate_or_cancel');
    assert.equal(post.calls[0].payload.post_only,false);
    assert.equal(out.attemptsStarted,1);
    assert.equal(out.status,'COMPLETE_NO_FILL');
    assert.ok(Number(out.currentAttempt.estimatedEntryDebitUsd)<=1);
    const c=await loadControl(e);
    assert.equal(c.armed,false);
    assert.equal(c.attempts,1);
  }finally{io.restore();}
});

test('terminal 1/1 series and Worker restart cannot produce a second entry',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'ENTRY-1',fill_count:0,remaining_count:1});
  try{
    await arm(e);
    await scanThenExecute(e,post);
    const afterFirst=post.calls.length;
    await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:06:00Z')});
    assert.equal(afterFirst,1);
    assert.equal(post.calls.length,1);
    // Series is terminal: no second entry from restart/cycle. A founder re-ARM begins a NEW governed series (new seriesId, count 0).
    const terminal=await loadRealSeriesState(e);
    assert.equal(terminal.attemptsStarted,1);
    await updateFounderControl(e,'ARM');
    const next=await loadRealSeriesState(e);
    assert.notEqual(next.seriesId,terminal.seriesId);
    assert.equal(next.attemptsStarted,0);
  }finally{io.restore();}
});

test('FILLED establishes durable PAYNE ownership and disarms new entry authority',async()=>{
  const e=await env(),io=installProvider(),post=postFixture({order_id:'ENTRY-FILL',client_order_id:'CID',fill_count:1,remaining_count:0,average_fill_price:.50,average_fee_paid:.02});
  try{
    await arm(e);
    const out=await scanThenExecute(e,post);
    assert.equal(out.position.owner,'PAYNE_KALSHI_REAL');
    assert.equal(out.position.exchangeIndex,2);
    assert.equal(out.position.entryOrderId,'ENTRY-FILL');
    assert.equal(out.position.filledCount,1);
    assert.equal(out.attemptsStarted,1);
    assert.equal((await loadControl(e)).armed,false);
    const ledger=await listRealLedger(e,100);
    assert.ok(ledger.some(x=>x.type==='POSITION_OWNERSHIP_ESTABLISHED'));
  }finally{io.restore();}
});

test('FILLED + DISARM still manages and constructs MAX_HOLD reduce-only EXIT',async()=>{
  const e=await env(),io=installProvider({position:'OPEN'}),post=postFixture({order_id:'EXIT-1',client_order_id:'XCID',fill_count:1,remaining_count:0,average_fill_price:.60,average_fee_paid:.02});
  try{
    await saveRealSeriesState(e,{...defaultRealSeriesState(),seriesId:'SERIES-M',attemptsStarted:1,status:'ATTEMPT_LIMIT_REACHED_MANAGING_POSITION',position:{schema:'PAYNE_REAL_POSITION_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'SERIES-M',attemptId:'SERIES-M-1',status:'OPEN',asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',exchangeIndex:2,entryOrderId:'ENTRY-1',entryClientOrderId:'CID',filledCount:1,entryAverageFillPrice:.50,entryAverageFeePaid:.01,entryTime:'2026-10-02T05:59:00Z',exitFilledTotal:0}});
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(post.calls.length,1);
    assert.equal(post.calls[0].kind,'EXIT');
    assert.equal(post.calls[0].payload.reduce_only,true);
    assert.equal(post.calls[0].scope.ownedByPayne,true);
    assert.equal(out.position.exitReason,'max_hold');
  }finally{io.restore();}
});

test('Paper decision_exit governs management while wrong ownership produces no exit',async()=>{
  const shadow=baselineShadow({score:.70,move:.001,edge:.02});
  const e=await env({shadow}),io=installProvider({position:'OPEN'}),post=postFixture({order_id:'EXIT-S',fill_count:1,remaining_count:0,average_fill_price:.55,average_fee_paid:.01});
  try{
    await saveRealSeriesState(e,{...defaultRealSeriesState(),seriesId:'DECISION',attemptsStarted:1,position:{owner:'PAYNE_KALSHI_REAL',seriesId:'DECISION',attemptId:'DECISION-1',status:'OPEN',asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',direction:'UP',exchangeIndex:2,entryOrderId:'E',entryClientOrderId:'CID',filledCount:1,entryAverageFillPrice:.5,entryTime:'2026-10-02T06:04:30Z',exitFilledTotal:0}});
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(post.calls[0].payload.reduce_only,true);
    assert.equal(out.position.exitReason,'decision_exit');

    const e2=await env({shadow});
    await saveRealSeriesState(e2,{...defaultRealSeriesState(),seriesId:'WRONG',attemptsStarted:1,position:{owner:'AUTO_BASELINE_REAL',status:'OPEN',marketTicker:'KXBTC15M-REALTEST',exchangeIndex:2,entryOrderId:'A',entryClientOrderId:'A',filledCount:1}});
    const out2=await runPayneRealExecutionCycle(e2,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out2.status,'HOLD_WRONG_OR_UNKNOWN_OWNERSHIP');
    assert.equal(post.calls.length,1);
  }finally{io.restore();}
});

test('insufficient Index 2 funding blocks a latched FIRE even if Index 3 has cash',async()=>{
  const e=await env(),post=postFixture({order_id:'BAD',fill_count:1,remaining_count:0});
  let io=installProvider({index2:15.91,index3:0});
  try{
    await arm(e);
    await runReadOnlyScan(e,'FUNDING_LATCH_TEST',Date.parse('2026-10-02T06:05:00Z'));
    assert.equal((await loadRealSeriesState(e)).fireLatch.state,'LATCHED');
    io.restore(); io=installProvider({index2:0,index3:99});
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.status,'HOLD_INDEX2_FUNDING_INSUFFICIENT');
    assert.equal(out.fireLatch.finalResult,'INVALIDATED_BEFORE_POST');
    assert.equal(post.calls.length,0);
  }finally{io.restore();}
});

test('unknown provider reconciliation and AUTO exact-ticker ownership both block a latched FIRE',async()=>{
  const e=await env(),post=postFixture({order_id:'BAD',fill_count:1,remaining_count:0});
  let io=installProvider();
  try{
    await arm(e); await runReadOnlyScan(e,'OWNERSHIP_LATCH_TEST',Date.parse('2026-10-02T06:05:00Z'));
    io.restore(); io=installProvider({position:'HTTP_FAIL'});
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out.status,'HOLD_PROVIDER_POSITION_UNKNOWN');
    assert.equal(post.calls.length,0);
  }finally{io.restore();}

  const e2=await env({autoPositions:[{status:'OPEN',marketTicker:'KXBTC15M-REALTEST'}]}),io2=installProvider(),post2=postFixture({order_id:'BAD',fill_count:1,remaining_count:0});
  try{
    await arm(e2); await runReadOnlyScan(e2,'AUTO_CONFLICT_LATCH_TEST',Date.parse('2026-10-02T06:05:00Z'));
    const out2=await runPayneRealExecutionCycle(e2,{postImpl:post2.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(out2.status,'HOLD_AUTO_TICKER_CONFLICT');
    assert.equal(post2.calls.length,0);
  }finally{io2.restore();}
});

test('Fresh LOCK invalidation, pre-submit invalidation, and window change all invalidate the latched specimen before POST',async()=>{
  const scenarios=[
    ['fresh',{exactSequence:[{status:500,market:{error:'x'}}]},'HOLD_FRESH_LOCK_INVALIDATED'],
    ['presubmit',{exactSequence:[{status:200,market:providerMarket()},{status:500,market:{error:'x'}}]},'HOLD_PRE_SUBMIT_INVALIDATED'],
    ['window',{exactSequence:[{status:200,market:providerMarket({close:'2026-10-02T06:30:00Z'})}]},'HOLD_FRESH_LOCK_INVALIDATED'],
  ];
  for(const [name,execOptions,expected] of scenarios){
    const e=await env(),post=postFixture({order_id:'BAD',fill_count:1,remaining_count:0});
    let io=installProvider();
    try{
      await arm(e); await runReadOnlyScan(e,'INVALIDATION_LATCH_TEST',Date.parse('2026-10-02T06:05:00Z'));
      assert.equal((await loadRealSeriesState(e)).fireLatch.state,'LATCHED',name);
      io.restore(); io=installProvider(execOptions);
      const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
      assert.equal(out.status,expected,name);
      assert.equal(out.fireLatch.finalResult,'INVALIDATED_BEFORE_POST',name);
      assert.equal(post.calls.length,0,name);
    }finally{io.restore();}
  }
});

test('order result interpretation is authoritative for FILLED, NO_FILL, PARTIAL, UNKNOWN',()=>{
  assert.equal(interpretPayneOrderResponse({order_id:'1',fill_count:1,remaining_count:0}).state,'FILLED');
  assert.equal(interpretPayneOrderResponse({order_id:'2',fill_count:0,remaining_count:1}).state,'NO_FILL');
  assert.equal(interpretPayneOrderResponse({order_id:'3',fill_count:1,remaining_count:1}).state,'PARTIAL');
  assert.equal(interpretPayneOrderResponse({fill_count:1,remaining_count:0}).state,'UNKNOWN');
});

test('restart with OPEN PAYNE position resumes management while zero-money history remains intact',async()=>{
  const e=await env(),observer=installProvider();
  try{
    await runReadOnlyScan(e,'SCHEDULED_CRON',Date.parse('2026-10-02T06:05:00Z'));
  }finally{observer.restore();}
  const before=[...e.PAYNE_KALSHI_STATE.store.keys()].filter(k=>k.startsWith('payne-kalshi:scan-history:')).length;

  await saveRealSeriesState(e,{...defaultRealSeriesState(),seriesId:'RESTART',attemptsStarted:1,position:{owner:'PAYNE_KALSHI_REAL',seriesId:'RESTART',attemptId:'RESTART-1',status:'OPEN',asset:'BTC',marketTicker:'KXBTC15M-REALTEST',outcomeSide:'YES',exchangeIndex:2,entryOrderId:'E',entryClientOrderId:'CID',filledCount:1,entryAverageFillPrice:.5,entryTime:'2026-10-02T05:59:00Z',exitFilledTotal:0}});
  const io=installProvider({position:'OPEN'}),post=postFixture({order_id:'X',fill_count:0,remaining_count:1});
  try{
    const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
    assert.equal(post.calls.length,1);
    assert.equal(post.calls[0].kind,'EXIT');
    assert.ok(['EXIT_RETRY_REQUIRED','EXIT_RECONCILIATION_REQUIRED'].includes(out.status));
    const after=[...e.PAYNE_KALSHI_STATE.store.keys()].filter(k=>k.startsWith('payne-kalshi:scan-history:')).length;
    assert.equal(after,before);
  }finally{io.restore();}
});


test('observability fixture: untouched fishing 0/1 is not NO_FILL',()=>{
  const x=summarizeRealExecutionState({control:{armed:true,attempts:0,attemptTarget:1},series:{seriesId:'FISH',status:'ARMED_FISHING',attemptsStarted:0,attemptTarget:1,unresolvedEntry:false,position:null},ledger:[],asOf:'2026-10-03T01:00:00Z'});
  assert.equal(x.attempted,0); assert.equal(x.target,1); assert.equal(x.remaining,1); assert.equal(x.filled,0); assert.equal(x.noFill,0); assert.equal(x.unknown,0); assert.equal(x.status,'FISHING'); assert.equal(x.lastAttempt.result,'NO_PROVIDER_ATTEMPT');
});

test('observability fixture: consumed 1/1 NO_FILL is complete and cannot appear 0/1',()=>{
  const x=summarizeRealExecutionState({control:{armed:false,attempts:1,attemptTarget:1},series:{seriesId:'NF',status:'COMPLETE_NO_FILL',attemptsStarted:1,attemptTarget:1,unresolvedEntry:false,currentAttempt:{status:'NO_FILL',asset:'NEAR',marketTicker:'T1',outcomeSide:'NO',preSubmitPrice:.61,providerResult:{state:'NO_FILL',orderId:'O-NF'}},position:null},ledger:[{type:'ENTRY_PRE_SUBMIT_LATCHED',seriesId:'NF',attemptId:'NF-1',at:'2026-10-03T01:01:00Z',ticker:'T1'},{type:'ENTRY_NO_FILL',seriesId:'NF',attemptId:'NF-1',at:'2026-10-03T01:01:01Z',ticker:'T1',result:{state:'NO_FILL',orderId:'O-NF'}}]});
  assert.equal(x.attempted,1); assert.equal(x.remaining,0); assert.equal(x.noFill,1); assert.equal(x.filled,0); assert.equal(x.lastAttempt.result,'NO_FILL'); assert.equal(x.lastAttempt.providerOrderId,'O-NF'); assert.equal(x.status,'COMPLETE_NO_FILL');
});

test('observability fixture: 1/1 FILLED with open position renders MANAGING',()=>{
  const x=summarizeRealExecutionState({control:{armed:false,attempts:1,attemptTarget:1},series:{seriesId:'FILL',status:'ATTEMPT_LIMIT_REACHED_MANAGING_POSITION',attemptsStarted:1,attemptTarget:1,unresolvedEntry:false,currentAttempt:{status:'FILLED',marketTicker:'T2',outcomeSide:'YES',providerResult:{state:'FILLED',orderId:'O-FILL'}},position:{status:'OPEN',asset:'BTC',marketTicker:'T2',outcomeSide:'YES',entryOrderId:'O-FILL'}},ledger:[{type:'POSITION_OWNERSHIP_ESTABLISHED',seriesId:'FILL',attemptId:'FILL-1',at:'2026-10-03T01:02:00Z',ticker:'T2',entryOrderId:'O-FILL'}]});
  assert.equal(x.attempted,1); assert.equal(x.filled,1); assert.equal(x.remaining,0); assert.equal(x.ownedPositions,1); assert.equal(x.status,'MANAGING'); assert.equal(x.lastAttempt.result,'FILLED');
});

test('observability fixture: ambiguous entry remains UNKNOWN and consumed',()=>{
  const x=summarizeRealExecutionState({control:{armed:false,attempts:1,attemptTarget:1},series:{seriesId:'UNK',status:'ENTRY_RECONCILIATION_REQUIRED',attemptsStarted:1,attemptTarget:1,unresolvedEntry:true,currentAttempt:{status:'UNKNOWN',marketTicker:'T3',providerResult:{state:'UNKNOWN'}}},ledger:[{type:'ENTRY_RESULT_UNKNOWN',seriesId:'UNK',attemptId:'UNK-1',at:'2026-10-03T01:03:00Z',ticker:'T3'}]});
  assert.equal(x.attempted,1); assert.equal(x.remaining,0); assert.equal(x.unknown,1); assert.equal(x.lastAttempt.result,'UNKNOWN');
});

test('observability fixture: governed HOLD before POST stays NO_PROVIDER_ATTEMPT',()=>{
  const x=summarizeRealExecutionState({control:{armed:true,attempts:0,attemptTarget:1},series:{seriesId:'HOLD',status:'HOLD_AUTO_TICKER_CONFLICT',attemptsStarted:0,attemptTarget:1,unresolvedEntry:false},ledger:[]});
  assert.equal(x.attempted,0); assert.equal(x.noFill,0); assert.equal(x.status,'BLOCKED'); assert.equal(x.lastAttempt.result,'NO_PROVIDER_ATTEMPT'); assert.equal(x.lastAttempt.holdReason,'HOLD_AUTO_TICKER_CONFLICT');
});

test('observability fixture: generic mixed 5/10 run has correct remaining and outcome counts',()=>{
  const ledger=[]; for(let i=1;i<=3;i++) ledger.push({type:'POSITION_OWNERSHIP_ESTABLISHED',seriesId:'MIX',attemptId:'M-'+i,at:'2026-10-03T01:0'+i+':00Z',ticker:'T'+i}); for(let i=4;i<=5;i++) ledger.push({type:'ENTRY_NO_FILL',seriesId:'MIX',attemptId:'M-'+i,at:'2026-10-03T01:0'+i+':00Z',ticker:'T'+i});
  const x=summarizeRealExecutionState({control:{armed:true,attempts:5,attemptTarget:10},series:{seriesId:'MIX',status:'ARMED_FISHING',attemptsStarted:5,attemptTarget:10,unresolvedEntry:false},ledger});
  assert.equal(x.attempted,5); assert.equal(x.target,10); assert.equal(x.remaining,5); assert.equal(x.filled,3); assert.equal(x.noFill,2); assert.equal(x.unknown,0); assert.equal(x.status,'FISHING');
});

test('observability invariant: NO_FILL ledger evidence forces consumed attempt count',()=>{
  const x=summarizeRealExecutionState({control:{armed:true,attempts:0,attemptTarget:1},series:{seriesId:'INVARIANT',status:'ARMED_FISHING',accountingSemantics:'PROVIDER_POST_BOUNDARY_V1',attemptsStarted:0,attemptTarget:1,unresolvedEntry:false},ledger:[{type:'ENTRY_NO_FILL',seriesId:'INVARIANT',attemptId:'INVARIANT-1',at:'2026-10-03T01:10:00Z',ticker:'T4'}]});
  assert.equal(x.attempted,1); assert.equal(x.remaining,0); assert.equal(x.noFill,1); assert.equal(x.lastAttempt.result,'NO_FILL');
});


test('observability current-series scope excludes historical ledger outcomes',()=>{
  const x=summarizeRealExecutionState({control:{armed:true,attempts:0,attemptTarget:1},series:{seriesId:'CURRENT',status:'ARMED_FISHING',attemptsStarted:0,attemptTarget:1,unresolvedEntry:false},ledger:[{type:'ENTRY_NO_FILL',seriesId:'OLD',attemptId:'OLD-1',at:'2026-10-03T00:00:00Z'}]});
  assert.equal(x.attempted,0); assert.equal(x.noFill,0); assert.equal(x.remaining,1); assert.equal(x.latestLedgerEvent,null);
});

test('SCHEDULER SYNTHETIC: qualifying PULL persists FIRE, POSTs one IOC and accounts NO_FILL',async()=>{
 const e=await env(), clock=Date.now, now=Date.parse('2026-10-02T06:05:00Z');
 const io=installProvider({entryResult:{order_id:'SCHEDULER-NOFILL-1',fill_count:0,remaining_count:1}});
 try{
   Date.now=()=>now;
   await arm(e);
   await worker.scheduled({},e);
   const entries=io.calls.filter(c=>c.method==='POST'&&c.url.includes('/portfolio/events/orders'));
   const ledger=await listRealLedger(e,200);
   const state=await loadRealSeriesState(e);
   assert.equal(entries.length,1,'exactly one intercepted synthetic Kalshi POST');
   assert.ok(ledger.some(x=>x.type==='FIRE_SPECIMEN_LATCHED'),'qualifying PULL created persisted FIRE latch');
   assert.ok(ledger.some(x=>x.type==='ENTRY_PRE_SUBMIT_LATCHED'),'fresh execution gates passed');
   assert.equal(state.attemptsStarted,1);
   assert.equal(state.status,'COMPLETE_NO_FILL');
   assert.equal(state.unresolvedEntry,false);
   assert.equal((await loadControl(e)).armed,false);
   const payload=JSON.parse(entries[0].body);
   assert.equal(payload.ticker,'KXBTC15M-REALTEST');
   assert.equal(payload.time_in_force,'immediate_or_cancel');
   assert.equal(payload.post_only,false);
   console.log('SYNTHETIC_SCHEDULER_NOFILL_POST_COUNT='+entries.length);
 } finally {Date.now=clock;io.restore();}
});

test('OVERLAPPING SCHEDULER: same persisted FIRE cannot authorize two provider POSTs',async()=>{
 const e=await env(),clock=Date.now,now=Date.parse('2026-10-02T06:05:00Z');
 const io=installProvider({entryResult:{order_id:'CONCURRENT-NOFILL',fill_count:0,remaining_count:1},discoveryDelayMs:40});
 try{
   Date.now=()=>now;
   await arm(e);
   await runReadOnlyScan(e,'ZERO_MONEY_EXECUTION_TEST',now);
   const before=await loadRealSeriesState(e);
   assert.equal(before.fireLatch?.state,'LATCHED');
   await Promise.all([worker.scheduled({},e),worker.scheduled({},e)]);
   const entries=io.calls.filter(c=>c.method==='POST'&&c.url.includes('/portfolio/events/orders'));
   assert.equal(entries.length,1);
   const after=await loadRealSeriesState(e);
   assert.equal(after.attemptsStarted,1);
   assert.equal(after.unresolvedEntry,false);
   await worker.scheduled({},e);
   assert.equal(io.calls.filter(c=>c.method==='POST'&&c.url.includes('/portfolio/events/orders')).length,1);
   console.log('SYNTHETIC_OVERLAP_POST_COUNT='+entries.length);
 }finally{Date.now=clock;io.restore();}
});

test('SCHEDULER SYNTHETIC: FILLED preserves owned position and prevents duplicate entry',async()=>{
 const e=await env(),clock=Date.now,now=Date.parse('2026-10-02T06:05:00Z');
 const io=installProvider({entryResult:{order_id:'SCHEDULER-FILL',fill_count:1,remaining_count:0,average_fill_price:.50,average_fee_paid:.01},position:'ABSENT'});
 try{
   Date.now=()=>now;await arm(e);
   await worker.scheduled({},e);
   const after=await loadRealSeriesState(e);
   assert.equal(io.calls.filter(c=>c.method==='POST'&&c.url.includes('/portfolio/events/orders')).length,1);
   assert.equal(after.attemptsStarted,1);
   assert.equal(after.position?.owner,'PAYNE_KALSHI_REAL');
   assert.equal(after.position?.status,'OPEN');
   await worker.scheduled({},e);
   assert.equal(io.calls.filter(c=>c.method==='POST'&&c.url.includes('/portfolio/events/orders')&&c.body?.includes('"reduce_only":false')).length,1);
   console.log('SYNTHETIC_SCHEDULER_FILLED_OWNERSHIP='+after.position.status);
 }finally{Date.now=clock;io.restore();}
});

test('SCHEDULER SYNTHETIC: uncertain POST is never repeated without provider reconciliation',async()=>{
 const e=await env(),clock=Date.now,now=Date.parse('2026-10-02T06:05:00Z');
 const io=installProvider({syntheticPostThrows:true});
 try{
   Date.now=()=>now; await arm(e);
   await worker.scheduled({},e);
   const state=await loadRealSeriesState(e);
   assert.equal(state.attemptsStarted,1);
   assert.equal(state.unresolvedEntry,true);
   assert.equal(state.currentAttempt?.status,'WRITE_ERROR_UNKNOWN');
   const prior=io.calls.filter(c=>c.method==='POST'&&c.url.includes('/portfolio/events/orders'));
   assert.equal(prior.length,1);
   await worker.scheduled({},e);
   const after=io.calls.filter(c=>c.method==='POST'&&c.url.includes('/portfolio/events/orders'));
   assert.equal(after.length,1,'UNKNOWN may not authorize second entry');
   console.log('SYNTHETIC_UNKNOWN_RETRY_POST_COUNT='+after.length);
 }finally{Date.now=clock;io.restore();}
});

test('MEASURED: qualifying PULL to intercepted provider POST uses real monotonic test-clock',async()=>{
 const e=await env(),clock=Date.now,originalLog=console.log,now=Date.parse('2026-10-02T06:05:00Z');
 let pullMs=null,postMs=null;
 const io=installProvider({entryResult:{order_id:'LATENCY-NOFILL',fill_count:0,remaining_count:1},
   onSyntheticPost:()=>{postMs=performance.now();}});
 try{
   Date.now=()=>now;
   console.log=(...args)=>{
     if(pullMs===null&&String(args[0]||'').includes('"stage":"PULL_QUALIFIED"')) pullMs=performance.now();
     originalLog(...args);
   };
   await arm(e);await worker.scheduled({},e);
   assert.ok(Number.isFinite(pullMs),'PULL must qualify');
   assert.ok(Number.isFinite(postMs),'synthetic provider POST must occur');
   const elapsed=postMs-pullMs;
   assert.ok(elapsed>=0,'measured PULL-to-provider boundary nonnegative');
   console.log('MEASURED_SYNTHETIC_PULL_TO_POST_MS='+elapsed.toFixed(3));
 }finally{Date.now=clock;console.log=originalLog;io.restore();}
});

test('MEASURED: persisted FIRE fast path avoids deliberate slow full scan before provider POST',async()=>{
 const clock=Date.now,now=Date.parse('2026-10-02T06:05:00Z');
 const measure=async oldOrder=>{
   const e=await env();let postMs=null;
   const io=installProvider({entryResult:{order_id:oldOrder?'OLD-NOFILL':'NEW-NOFILL',fill_count:0,remaining_count:1},
     discoveryDelayMs:110,onSyntheticPost:()=>{postMs=performance.now();}});
   try{
     Date.now=()=>now;await arm(e);
     await runReadOnlyScan(e,'ZERO_MONEY_EXECUTION_TEST',now);
     assert.equal((await loadRealSeriesState(e)).fireLatch?.state,'LATCHED');
     const started=performance.now();
     if(oldOrder) {
       await runReadOnlyScan(e,'SCHEDULED_CRON',now);
       await runPayneRealExecutionCycle(e,{nowMs:now});
     } else await worker.scheduled({},e);
     assert.ok(Number.isFinite(postMs),'synthetic provider POST reached');
     return postMs-started;
   }finally{io.restore();}
 };
 try {
   const oldMs=await measure(true);
   const repairedMs=await measure(false);
   assert.ok(oldMs>repairedMs,'priority execution starts earlier than deliberately delayed scan-first');
   console.log('MEASURED_SYNTHETIC_OLD_SCAN_FIRST_POST_MS='+oldMs.toFixed(3));
   console.log('MEASURED_SYNTHETIC_REPAIRED_POST_MS='+repairedMs.toFixed(3));
   console.log('MEASURED_SYNTHETIC_IMPROVEMENT_MS='+(oldMs-repairedMs).toFixed(3));
 }finally{Date.now=clock;}
});

test('THREE POSITION SYNTHETIC: DISARM manages and exits each owned BTC/ETH/SOL record independently',async()=>{
 const e=await env();
 const names=['BTC','ETH','SOL'];
 const tickers=names.map(asset=>'KX'+asset+'15M-REALTEST');
 const positions=names.map((asset,i)=>({
   schema:'PAYNE_REAL_POSITION_V1',owner:'PAYNE_KALSHI_REAL',seriesId:'THREE-POSITIONS',
   attemptId:'THREE-POSITIONS-'+(i+1),attemptNo:i+1,
   status:'OPEN',asset,marketTicker:tickers[i],outcomeSide:'YES',direction:'UP',
   exchangeIndex:2,entryOrderId:'ENTRY-'+(i+1),entryClientOrderId:'CID-'+(i+1),
   filledCount:1,entryAverageFillPrice:.50,entryAverageFeePaid:.01,
   entryTime:'2026-10-02T05:58:00Z',exitFilledTotal:0
 }));
 await saveRealSeriesState(e,{...defaultRealSeriesState(),seriesId:'THREE-POSITIONS',
   attemptsStarted:3,attemptTarget:5,position:positions[0],positions,
   status:'MANAGING_POSITION_SERIES_CONTINUES'});
 assert.equal((await loadControl(e)).armed,false);
 const post=postFixture({order_id:'SYNTHETIC-EXIT',fill_count:1,remaining_count:0,average_fill_price:.60,average_fee_paid:.01});
 const io=installProvider({multiPositions:tickers});
 try{
   const out=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:05:00Z')});
   assert.equal(post.calls.length,3,'all PAYNE positions need their own exit path');
   assert.equal(new Set(post.calls.map(x=>x.payload.ticker)).size,3);
   assert.ok(post.calls.every(x=>x.kind==='EXIT'&&x.payload.reduce_only===true));
   assert.equal(out.positions.length,3);
   assert.ok(out.positions.every(p=>p.status==='EXIT_RECONCILIATION_REQUIRED'));
   assert.equal((await loadControl(e)).armed,false);
   assert.equal(io.calls.filter(x=>x.method==='POST').length,0,'only injected zero-money exit writer used');
 }finally{io.restore();}
 const flat=installProvider({multiPositions:tickers,multiPositionStatus:'FLAT'});
 try{
   const done=await runPayneRealExecutionCycle(e,{postImpl:post.fn,nowMs:Date.parse('2026-10-02T06:06:00Z')});
   assert.equal(done.positions.length,3);
   assert.ok(done.positions.every(p=>p.status==='CLOSED'&&p.reconciliationState==='FLAT'));
   assert.equal(post.calls.length,3,'provider-flat reconciliation must not submit further EXIT orders');
   assert.equal((await loadControl(e)).armed,false);
 }finally{flat.restore();}
});

test('THREE ENTRY SYNTHETIC: distinct PAYNE PULLs fill three owned slots; fourth capacity rejects',async()=>{
 const now=Date.parse('2026-10-02T06:05:00Z');
 const assets=['BTC','ETH','SOL','XRP'];
 const tickers=assets.map(a=>'KX'+a+'15M-REALTEST');
 const opened=[];
 const e=await env(),io=installProvider({multiMarkets:tickers,multiPositions:opened});
 const posts=[];
 const fn=async(_env,kind,payload,scope)=>{
   posts.push({kind,payload:structuredClone(payload),scope:structuredClone(scope)});
   return {response:jsonResponse({order_id:'SYNTHETIC-'+payload.ticker,fill_count:1,remaining_count:0,average_fill_price:.50,average_fee_paid:.01}),
     proof:payneOrderWriteProof(kind,payload,scope),writerInvoked:true,providerPostStarted:true};
 };
 const resetFeature=async()=>{
   const prior=100/(1+(.86-.50)/72);
   const prices=Object.fromEntries(assets.map(asset=>[asset,prior]));
   const priceSources=Object.fromEntries(assets.map(asset=>[asset,'COINBASE']));
   await e.PAYNE_KALSHI_STATE.put('payne-kalshi:feature-shadow:v2-paper-brain',JSON.stringify({
     schema:'PAYNE_PAPER_BRAIN_KALSHI_FEATURE_STATE_V1',
     savedAt:'2026-10-02T06:04:00Z',prices,referencePrices:prices,priceSources
   }));
 };
 try{
   await updateFounderControl(e,'SET_ATTEMPT_TARGET',5);
   await arm(e);
   for(let i=0;i<3;i++){
     await resetFeature();
     const scan=await runReadOnlyScan(e,'THREE_POSITION_TEST',now);
     const before=await loadRealSeriesState(e);
     assert.equal(before.fireLatch?.state,'LATCHED','iteration='+i+
       ' selected='+scan.snapshot?.selected?.ticker+
       ' preview='+scan.snapshot?.zeroMoneyPreview?.status+
       ' reason='+before.status+
       ' failure='+JSON.stringify(before.fireRefreshEvidence?.failureReasons||[]));
     const result=await runPayneRealExecutionCycle(e,{postImpl:fn,nowMs:now});
     assert.equal(result.attemptsStarted,i+1,'one provider attempt per distinct candidate');
     assert.equal(result.positions.length,i+1,'prior position ownership preserved');
     assert.ok(result.positions.every(p=>p.status==='OPEN'),'prior positions remain managed');
     const newest=result.position;
     assert.ok(!opened.includes(newest.marketTicker),'new candidate must be distinct');
     opened.push(newest.marketTicker);
   }
   assert.equal(new Set(opened).size,3);
   assert.equal(posts.filter(p=>p.kind==='ENTRY').length,3);
   await resetFeature();
   await runReadOnlyScan(e,'THREE_POSITION_FOURTH_REJECT',now);
   await runPayneRealExecutionCycle(e,{postImpl:fn,nowMs:now});
   const after=await loadRealSeriesState(e);
   assert.equal(after.attemptsStarted,3,'fourth entry cannot consume an attempt while full');
   assert.equal(posts.filter(p=>p.kind==='ENTRY').length,3,'no fourth provider POST');
   assert.equal(after.positions.filter(p=>p.status==='OPEN').length,3);
   assert.equal(io.calls.filter(p=>p.method==='POST').length,0);
 } finally {io.restore();}
});
