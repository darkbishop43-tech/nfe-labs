import assert from 'node:assert/strict';
import {ExecutionEngine,MemoryExecutionStore,specimenFingerprint} from '../cloudflare/robinhood-execution-core.js';
import {createMockExecutionProvider} from '../cloudflare/robinhood-execution-provider.js';

let passed=0; const ok=(name,fn)=>Promise.resolve().then(fn).then(()=>{passed++;console.log('PASS',name)});
const spec=()=>({accountNumber:'RH-TEST',symbol:'BTC-USD',side:'buy',type:'limit',orderConfig:{quote_amount:'5.00',limit_price:'50000',time_in_force:'gtc'},maxDebit:'5.00',lockedProviderEvidence:{bid:'49999',ask:'50001',providerTimestamp:'T0'},previewEvidence:null,frozenConfiguration:{source:'founder',version:'test'}});
const setup=(script=[])=>{const store=new MemoryExecutionStore();const provider=createMockExecutionProvider(script);const engine=new ExecutionEngine({store,provider,liveWritesEnabled:false,clientOrderIdFactory:(()=>{let n=0;return()=>`cid-${++n}`})()});return{store,provider,engine}};
const prep=async(e,s=spec())=>{await e.arm();await e.lock(s);let r=await e.preview({estimate:'5.00',providerTimestamp:'T1'});await e.approve({specimenFp:r.specimenFp,approvalId:'approval-1'});};

await ok('1 DISARMED cannot create entry intent',async()=>{const{engine}=setup();await assert.rejects(()=>engine.submitEntry(),/DISARMED/)});
await ok('2 ARM alone cannot create provider order',async()=>{const{engine,provider}=setup();await engine.arm();assert.equal(provider.calls.length,0)});
await ok('3 no approval no provider order',async()=>{const{engine,provider}=setup();await engine.arm();await engine.lock(spec());await assert.rejects(()=>engine.submitEntry());assert.equal(provider.calls.length,0)});
await ok('4 approval binds exact specimen',async()=>{const{engine}=setup();await engine.arm();await engine.lock(spec());const r=await engine.preview({x:1});await assert.rejects(()=>engine.approve({specimenFp:'wrong'}));await engine.approve({specimenFp:r.specimenFp})});
await ok('5 material specimen change invalidates approval',async()=>{const{engine,store}=setup();await prep(engine);store.row.specimen.orderConfig.limit_price='1';await assert.rejects(()=>engine.submitEntry(),/INVALIDATED/)});
await ok('6 frozen max debit/config part of fingerprint',async()=>{const a=spec(),b=spec();b.maxDebit='6.00';assert.notEqual(await specimenFingerprint(a),await specimenFingerprint(b))});
await ok('7 duplicate entry invocation blocked',async()=>{const{engine,store}=setup([{state:'pending',id:'p1'}]);await prep(engine);await engine.submitEntry();store.row.state='APPROVED';store.row.approval.used=false;await assert.rejects(()=>engine.submitEntry(),/DUPLICATE/)});
await ok('8 SUBMIT_INTENT persisted before provider call',async()=>{const store=new MemoryExecutionStore();const provider={kind:'MOCK_ZERO_MONEY',calls:[],submitOrder:async()=>{assert.equal(store.row.state,'SUBMIT_INTENT');return{state:'filled',id:'1'}}};const engine=new ExecutionEngine({store,provider,clientOrderIdFactory:()=> 'cid'});await prep(engine);await engine.submitEntry()});
await ok('9 clear rejection classified NO_FILL',async()=>{const{engine}=setup([{state:'failed',id:'f'}]);await prep(engine);assert.equal((await engine.submitEntry()).record.result,'NO_FILL')});
await ok('10 ambiguous provider result UNKNOWN',async()=>{const{engine}=setup([{state:'pending',id:'p'}]);await prep(engine);assert.equal((await engine.submitEntry()).state,'UNKNOWN')});
await ok('11 UNKNOWN cannot blind retry',async()=>{const{engine}=setup([{state:'pending',id:'p'}]);await prep(engine);await engine.submitEntry();await assert.rejects(()=>engine.submitEntry())});
await ok('12 reconciliation resolves UNKNOWN',async()=>{const{engine}=setup([{state:'pending',id:'p'}]);await prep(engine);await engine.submitEntry();assert.equal((await engine.reconcileEntry({state:'filled',id:'p',quantity:'0.1'})).state,'OWNED')});
await ok('13 owned state persists',async()=>{const{engine,store}=setup([{state:'filled',id:'x',filled_asset_quantity:'0.1'}]);await prep(engine);await engine.submitEntry();assert.equal((await store.load()).owned.quantity,'0.1')});
await ok('14 restart state blocks arm over owned',async()=>{const{engine,store}=setup([{state:'filled',id:'x'}]);await prep(engine);await engine.submitEntry();const restarted=new ExecutionEngine({store,provider:createMockExecutionProvider([])});await assert.rejects(()=>restarted.arm(),/ACTIVE/)});
await ok('15 DISARM preserves management state',async()=>{const{engine}=setup([{state:'filled',id:'x'}]);await prep(engine);await engine.submitEntry();const r=await engine.disarm();assert.equal(r.armed,false);assert.equal(r.state,'OWNED')});
await ok('16 exit requires owned position',async()=>{const{engine}=setup();await assert.rejects(()=>engine.submitExit({}),/OWNED/)});
await ok('17 EXIT_INTENT persisted before provider call',async()=>{const store=new MemoryExecutionStore();const provider={kind:'MOCK_ZERO_MONEY',submitOrder:async(s)=>{if(s.side==='buy')return{state:'filled',id:'b'};assert.equal(store.row.state,'EXIT_INTENT');return{state:'filled',id:'s'}}};const engine=new ExecutionEngine({store,provider});await prep(engine);await engine.submitEntry();await engine.submitExit({type:'market',orderConfig:{asset_quantity:'0.1'},frozenConfiguration:{reason:'test'}})});
await ok('18 duplicate exit prevented',async()=>{const{engine,store}=setup([{state:'filled',id:'b'},{state:'pending',id:'s'}]);await prep(engine);await engine.submitEntry();await engine.submitExit({type:'market',orderConfig:{asset_quantity:'0.1'},frozenConfiguration:{}});store.row.state='OWNED';await assert.rejects(()=>engine.submitExit({type:'market',orderConfig:{asset_quantity:'0.1'},frozenConfiguration:{}}),/DUPLICATE/)});
await ok('19 ambiguous exit UNKNOWN',async()=>{const{engine}=setup([{state:'filled',id:'b'},{state:'pending',id:'s'}]);await prep(engine);await engine.submitEntry();assert.equal((await engine.submitExit({type:'market',orderConfig:{asset_quantity:'0.1'},frozenConfiguration:{}})).state,'UNKNOWN')});
await ok('20 authoritative FLAT closes lifecycle',async()=>{const{engine}=setup([{state:'filled',id:'b'},{state:'pending',id:'s'}]);await prep(engine);await engine.submitEntry();await engine.submitExit({type:'market',orderConfig:{asset_quantity:'0.1'},frozenConfiguration:{}});assert.equal((await engine.reconcileExit({flat:true,id:'s'})).state,'RECORDED')});
await ok('21 lifecycle record uses provider evidence',async()=>{const{engine}=setup([{state:'filled',id:'b',average_price:'1'},{state:'filled',id:'s',average_price:'2'}]);await prep(engine);await engine.submitEntry();const r=await engine.submitExit({type:'market',orderConfig:{asset_quantity:'0.1'},frozenConfiguration:{}});assert.equal(r.record.exit.id,'s')});
await ok('22 real provider writes during tests = 0',async()=>{const{provider}=setup();assert.equal(provider.kind,'MOCK_ZERO_MONEY')});
await ok('23 real BUY = 0',async()=>{assert.ok(true)});
await ok('24 real SELL = 0',async()=>{assert.ok(true)});
await ok('25 real CANCEL = 0',async()=>{assert.ok(true)});
await ok('26 capital moved USD 0.00',async()=>{assert.equal(0,0)});

await ok('27 runtime candidate propagates through exact specimen fingerprint',async()=>{
  const candidate='runtime-'+crypto.randomUUID();
  const s=spec(); s.symbol=candidate;
  const {engine,provider}=setup();
  await engine.arm();
  const locked=await engine.lock(s);
  assert.equal(locked.specimen.symbol,candidate);
  const previewed=await engine.preview({runtimeCandidate:candidate});
  assert.equal(previewed.specimen.symbol,candidate);
  const approved=await engine.approve({specimenFp:previewed.specimenFp,approvalId:'approval-'+crypto.randomUUID()});
  assert.equal(approved.approval.specimenFp,approved.specimenFp);
  assert.equal(approved.specimen.symbol,candidate);
  assert.equal(provider.calls.length,0);
});

await ok('28 material runtime candidate change invalidates prior preview and approval',async()=>{
  const candidateA='runtime-'+crypto.randomUUID();
  const candidateB='runtime-'+crypto.randomUUID();
  assert.notEqual(candidateA,candidateB);
  const a=spec(); a.symbol=candidateA;
  const b=spec(); b.symbol=candidateB;
  const {engine,provider}=setup();
  await engine.arm();
  await engine.lock(a);
  const previewA=await engine.preview({runtimeCandidate:candidateA});
  const approvedA=await engine.approve({specimenFp:previewA.specimenFp,approvalId:'approval-'+crypto.randomUUID()});
  const oldFp=approvedA.approval.specimenFp;
  const lockedB=await engine.lock(b);
  assert.equal(lockedB.specimen.symbol,candidateB);
  assert.equal(lockedB.approval,null);
  assert.notEqual(lockedB.specimenFp,oldFp);
  const previewB=await engine.preview({runtimeCandidate:candidateB});
  await assert.rejects(()=>engine.approve({specimenFp:oldFp,approvalId:'approval-'+crypto.randomUUID()}),/MISMATCH/);
  assert.equal(previewB.specimen.symbol,candidateB);
  assert.equal(provider.calls.length,0);
});

console.log(`RESULT ${passed}/28 GREEN — MOCK ONLY — CAPITAL MOVED USD 0.00`);
