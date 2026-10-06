const TERMINAL = new Set(['RECORDED']);
const UNRESOLVED = new Set(['UNKNOWN','UNRESOLVED']);
const ACTIVE_POSITION = new Set(['OWNED','MANAGING','EXIT_INTENT','EXIT_SUBMITTED']);

export function canonicalSpecimen(input){
  const s={
    accountNumber:String(input.accountNumber||''), symbol:String(input.symbol||''), side:String(input.side||''),
    type:String(input.type||''), orderConfig:input.orderConfig??null, maxDebit:input.maxDebit??null,
    lockedProviderEvidence:input.lockedProviderEvidence??null, previewEvidence:input.previewEvidence??null,
    frozenConfiguration:input.frozenConfiguration??null
  };
  if(!s.accountNumber||!s.symbol||!['buy','sell'].includes(s.side)||!s.type||!s.orderConfig||!s.frozenConfiguration) throw new Error('SPECIMEN_INCOMPLETE');
  return s;
}
function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export async function specimenFingerprint(specimen){
  const data=new TextEncoder().encode(stable(canonicalSpecimen(specimen)));
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function classifyProviderOutcome(result, error){
  if(error) return error.ambiguous ? 'UNKNOWN' : 'NO_FILL';
  const state=String(result?.state||'').toLowerCase();
  if(state==='filled') return 'FILLED';
  if(['failed','canceled','rejected'].includes(state)) return 'NO_FILL';
  if(['open','pending','partially_filled'].includes(state)) return 'UNKNOWN';
  return 'UNKNOWN';
}
export class MemoryExecutionStore{
  constructor(){ this.row={armed:false,state:'DISARMED',specimen:null,specimenFp:null,approval:null,entryIntent:null,provider:null,owned:null,exitIntent:null,reconciliation:'FLAT',record:null}; this.events=[]; }
  async load(){ return structuredClone(this.row); }
  async save(row){ this.row=structuredClone(row); }
  async event(type,payload={}){ this.events.push({type,payload:structuredClone(payload)}); }
}
export class D1ExecutionStore{
  constructor(db){ if(!db) throw new Error('EXECUTION_DB_BINDING_MISSING'); this.db=db; }
  async load(){
    const r=await this.db.prepare('SELECT state_json FROM robinhood_execution_control WHERE singleton_id=1').first();
    if(!r) return {armed:false,state:'DISARMED',specimen:null,specimenFp:null,approval:null,entryIntent:null,provider:null,owned:null,exitIntent:null,reconciliation:'FLAT',record:null};
    return JSON.parse(r.state_json);
  }
  async save(row){
    const now=new Date().toISOString();
    await this.db.prepare(`INSERT INTO robinhood_execution_control(singleton_id,state_json,updated_at) VALUES(1,?,?) ON CONFLICT(singleton_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).bind(JSON.stringify(row),now).run();
  }
  async event(type,payload={}){
    await this.db.prepare('INSERT INTO robinhood_execution_events(observed_at,event_type,payload_json) VALUES(?,?,?)').bind(new Date().toISOString(),type,JSON.stringify(payload)).run();
  }
}
export class ExecutionEngine{
  constructor({store,provider,liveWritesEnabled=false,clientOrderIdFactory=()=>crypto.randomUUID()}){ this.store=store; this.provider=provider; this.liveWritesEnabled=liveWritesEnabled; this.clientOrderIdFactory=clientOrderIdFactory; }
  async state(){ return this.store.load(); }
  async arm(){ const r=await this.store.load(); if(UNRESOLVED.has(r.state)||ACTIVE_POSITION.has(r.state)) throw new Error('ARM_BLOCKED_ACTIVE_OR_UNRESOLVED'); r.armed=true; r.state='ARMED'; await this.store.save(r); await this.store.event('ARMED'); return r; }
  async disarm(){ const r=await this.store.load(); r.armed=false; if(!ACTIVE_POSITION.has(r.state)&&!UNRESOLVED.has(r.state)) r.state='DISARMED'; await this.store.save(r); await this.store.event('DISARMED',{preservedState:r.state}); return r; }
  async lock(specimen){
    const r=await this.store.load(); if(!r.armed) throw new Error('DISARMED'); if(ACTIVE_POSITION.has(r.state)||UNRESOLVED.has(r.state)) throw new Error('ACTIVE_OR_UNRESOLVED');
    const normalized=canonicalSpecimen(specimen); r.specimen=normalized; r.specimenFp=await specimenFingerprint(normalized); r.approval=null; r.state='LOCKED'; await this.store.save(r); await this.store.event('LOCKED',{specimenFp:r.specimenFp}); return r;
  }
  async preview(previewEvidence){ const r=await this.store.load(); if(r.state!=='LOCKED') throw new Error('LOCK_REQUIRED'); r.specimen.previewEvidence=previewEvidence; r.specimenFp=await specimenFingerprint(r.specimen); r.state='AWAITING_FOUNDER_APPROVAL'; await this.store.save(r); await this.store.event('PREVIEWED',{specimenFp:r.specimenFp}); return r; }
  async approve({specimenFp,approvalId}){ const r=await this.store.load(); if(r.state!=='AWAITING_FOUNDER_APPROVAL') throw new Error('PREVIEW_REQUIRED'); if(specimenFp!==r.specimenFp) throw new Error('APPROVAL_SPECIMEN_MISMATCH'); r.approval={approvalId:approvalId||crypto.randomUUID(),specimenFp,used:false,approvedAt:new Date().toISOString()}; r.state='APPROVED'; await this.store.save(r); await this.store.event('APPROVED',{approvalId:r.approval.approvalId,specimenFp}); return r; }
  async submitEntry(){
    const r=await this.store.load(); if(!r.armed) throw new Error('DISARMED'); if(r.state!=='APPROVED'||!r.approval||r.approval.used) throw new Error('VALID_SINGLE_USE_APPROVAL_REQUIRED');
    const nowFp=await specimenFingerprint(r.specimen); if(nowFp!==r.approval.specimenFp) throw new Error('APPROVAL_INVALIDATED_BY_SPECIMEN_CHANGE');
    if(r.entryIntent) throw new Error('DUPLICATE_ENTRY_BLOCKED');
    if(!this.liveWritesEnabled && this.provider.kind!=='MOCK_ZERO_MONEY') throw new Error('LIVE_WRITES_DISABLED');
    const clientOrderId=this.clientOrderIdFactory(); r.entryIntent={clientOrderId,createdAt:new Date().toISOString(),specimenFp:nowFp}; r.approval.used=true; r.state='SUBMIT_INTENT'; await this.store.save(r); await this.store.event('SUBMIT_INTENT',{clientOrderId});
    let result=null,error=null; try{ result=await this.provider.submitOrder({...r.specimen,clientOrderId}); }catch(e){error=e;}
    const outcome=classifyProviderOutcome(result,error); r.provider=result?{id:result.id??null,state:result.state??null,raw:result}:null;
    if(outcome==='FILLED') { r.owned={symbol:r.specimen.symbol,accountNumber:r.specimen.accountNumber,entryProviderId:r.provider?.id??null,quantity:result?.filled_asset_quantity??result?.quantity??r.specimen.orderConfig?.asset_quantity??null}; r.reconciliation='OWNED'; r.state='OWNED'; }
    else if(outcome==='NO_FILL'){ r.reconciliation='FLAT'; r.state='RECORDED'; r.record={result:'NO_FILL',provider:r.provider,error:error?.message||null}; }
    else { r.reconciliation='UNRESOLVED'; r.state='UNKNOWN'; r.record={result:'UNKNOWN',provider:r.provider,error:error?.message||null}; }
    await this.store.save(r); await this.store.event('ENTRY_OUTCOME',{outcome,providerId:r.provider?.id??null}); return r;
  }
  async reconcileEntry(authoritative){
    const r=await this.store.load(); if(!UNRESOLVED.has(r.state)) throw new Error('NO_UNRESOLVED_ENTRY');
    const state=String(authoritative?.state||'').toLowerCase();
    if(state==='filled'){ r.owned={symbol:r.specimen.symbol,accountNumber:r.specimen.accountNumber,entryProviderId:authoritative.id??r.provider?.id??null,quantity:authoritative.filled_asset_quantity??authoritative.quantity??null}; r.reconciliation='OWNED'; r.state='OWNED'; }
    else if(['failed','canceled','rejected','not_found'].includes(state)){ r.reconciliation='FLAT'; r.state='RECORDED'; r.record={result:'NO_FILL_RECONCILED',provider:authoritative}; }
    else throw new Error('RECONCILIATION_STILL_UNRESOLVED');
    await this.store.save(r); await this.store.event('ENTRY_RECONCILED',{state:r.state}); return r;
  }
  async submitExit(exitSpecimen){
    const r=await this.store.load(); if(!r.owned||!ACTIVE_POSITION.has(r.state)) throw new Error('AUTHORITATIVE_OWNED_POSITION_REQUIRED'); if(r.exitIntent) throw new Error('DUPLICATE_EXIT_BLOCKED');
    if(!exitSpecimen?.orderConfig) throw new Error('EXIT_CONFIG_REQUIRED'); if(!this.liveWritesEnabled && this.provider.kind!=='MOCK_ZERO_MONEY') throw new Error('LIVE_WRITES_DISABLED');
    const specimen={accountNumber:r.owned.accountNumber,symbol:r.owned.symbol,side:'sell',type:exitSpecimen.type,orderConfig:exitSpecimen.orderConfig,maxDebit:null,lockedProviderEvidence:exitSpecimen.positionEvidence??null,previewEvidence:exitSpecimen.previewEvidence??null,frozenConfiguration:exitSpecimen.frozenConfiguration};
    const clientOrderId=this.clientOrderIdFactory(); r.exitIntent={clientOrderId,createdAt:new Date().toISOString(),specimen}; r.state='EXIT_INTENT'; await this.store.save(r); await this.store.event('EXIT_INTENT',{clientOrderId});
    let result=null,error=null; try{result=await this.provider.submitOrder({...specimen,clientOrderId});}catch(e){error=e;}
    const outcome=classifyProviderOutcome(result,error); r.providerExit=result?{id:result.id??null,state:result.state??null,raw:result}:null;
    if(outcome==='FILLED'){ r.owned=null; r.reconciliation='FLAT'; r.state='RECORDED'; r.record={result:'FLAT',entry:r.provider,exit:r.providerExit}; }
    else if(outcome==='NO_FILL'){ r.reconciliation='OWNED'; r.state='OWNED'; r.exitIntent=null; }
    else { r.reconciliation='UNRESOLVED'; r.state='UNKNOWN'; }
    await this.store.save(r); await this.store.event('EXIT_OUTCOME',{outcome,providerId:r.providerExit?.id??null}); return r;
  }
  async reconcileExit(authoritative){
    const r=await this.store.load(); if(r.state!=='UNKNOWN'||!r.exitIntent) throw new Error('NO_UNRESOLVED_EXIT');
    const flat=authoritative?.flat===true||String(authoritative?.state||'').toLowerCase()==='filled';
    if(flat){ r.owned=null; r.reconciliation='FLAT'; r.state='RECORDED'; r.record={result:'FLAT_RECONCILED',entry:r.provider,exit:authoritative}; }
    else if(authoritative?.owned===true){ r.reconciliation='OWNED'; r.state='OWNED'; r.exitIntent=null; }
    else throw new Error('RECONCILIATION_STILL_UNRESOLVED');
    await this.store.save(r); await this.store.event('EXIT_RECONCILED',{state:r.state}); return r;
  }
}
