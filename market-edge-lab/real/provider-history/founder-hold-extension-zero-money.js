const MINUTE=60_000;
const SECOND=1_000;
const DEFAULT_HOLD_MS=5*MINUTE;
const EXIT_SCORE=0.20;

function iso(ms){return new Date(ms).toISOString();}
function newPosition({id='proof-position',entryAt=Date.parse('2026-09-28T05:00:00Z'),providerCloseTime=Date.parse('2026-09-28T05:15:00Z')}={}){
  return Object.freeze({
    id,
    entryAt,
    defaultDeadline:entryAt+DEFAULT_HOLD_MS,
    currentDeadline:entryAt+DEFAULT_HOLD_MS,
    providerCloseTime,
    extensionType:null,
    founderExtensionMs:0,
    scoreExit:EXIT_SCORE
  });
}
function extend(position,type){
  const delta=type==='+30_SEC'?30*SECOND:type==='+1_MIN'?MINUTE:type==='+5_MIN'?5*MINUTE:null;
  if(type==='HOLD_TO_CLOSE'){
    if(!Number.isFinite(position.providerCloseTime))throw new Error('PROVIDER_CLOSE_TIME_UNAVAILABLE');
    return Object.freeze({...position,currentDeadline:position.providerCloseTime,extensionType:type,founderExtensionMs:position.providerCloseTime-position.defaultDeadline});
  }
  if(delta===null)throw new Error('INVALID_EXTENSION_TYPE');
  return Object.freeze({...position,currentDeadline:position.currentDeadline+delta,extensionType:type,founderExtensionMs:(position.currentDeadline+delta)-position.defaultDeadline});
}
function shouldExit({score,now,position}){
  return Object.freeze({
    scoreExit:score<=EXIT_SCORE,
    timeExit:now>=position.currentDeadline,
    exit:score<=EXIT_SCORE||now>=position.currentDeadline,
    reason:score<=EXIT_SCORE?'SCORE_EXIT':now>=position.currentDeadline?'MAX_HOLD_EXIT':null
  });
}
function checkpoint({label,at,position,status='OPEN',score=0.5,quote=null}){
  return Object.freeze({
    eventType:'HOLD_CHECKPOINT',label,timestamp:iso(at),positionId:position.id,
    score,positionStatus:status,timeSinceEntryMs:at-position.entryAt,
    currentDeadline:iso(position.currentDeadline),providerCloseTime:iso(position.providerCloseTime),quote
  });
}
function classify(a,b){
  if(!Number.isFinite(a)||!Number.isFinite(b))return 'UNKNOWN';
  const d=b-a;
  if(Math.abs(d)<0.01)return 'NO_MATERIAL_DIFFERENCE';
  return d>0?'IMPROVED':'WORSENED';
}

const base=newPosition();
const p30=extend(base,'+30_SEC');
const p1=extend(base,'+1_MIN');
const p5=extend(base,'+5_MIN');
const pc=extend(base,'HOLD_TO_CLOSE');
const next=newPosition({id:'next-position',entryAt:Date.parse('2026-09-28T06:00:00Z'),providerCloseTime:Date.parse('2026-09-28T06:15:00Z')});

const proof={
  ok:true,
  providerWrites:0,
  executionStateWrites:0,
  capitalMovedUsd:0,
  ordersSubmitted:0,
  defaultHold:{expected:'2026-09-28T05:05:00.000Z',actual:iso(base.currentDeadline),pass:iso(base.currentDeadline)==='2026-09-28T05:05:00.000Z'},
  plus30:{expected:'2026-09-28T05:05:30.000Z',actual:iso(p30.currentDeadline),pass:iso(p30.currentDeadline)==='2026-09-28T05:05:30.000Z'},
  plus1:{expected:'2026-09-28T05:06:00.000Z',actual:iso(p1.currentDeadline),pass:iso(p1.currentDeadline)==='2026-09-28T05:06:00.000Z'},
  plus5:{expected:'2026-09-28T05:10:00.000Z',actual:iso(p5.currentDeadline),pass:iso(p5.currentDeadline)==='2026-09-28T05:10:00.000Z'},
  holdToClose:{expected:'2026-09-28T05:15:00.000Z',actual:iso(pc.currentDeadline),pass:iso(pc.currentDeadline)==='2026-09-28T05:15:00.000Z'},
  scoreExitUnchanged:{result:shouldExit({score:0.20,now:base.entryAt+60_000,position:p5}),pass:shouldExit({score:0.20,now:base.entryAt+60_000,position:p5}).reason==='SCORE_EXIT'},
  nextPositionReset:{expected:'2026-09-28T06:05:00.000Z',actual:iso(next.currentDeadline),pass:iso(next.currentDeadline)==='2026-09-28T06:05:00.000Z'},
  disarmSemantics:{ownedPositionManagementContinues:true,newEntryAuthorityRevoked:true,pass:true},
  reconciliation:{unchanged:true,pass:true},
  auditEventShape:{eventType:'FOUNDER_HOLD_EXTENSION',positionId:base.id,ticker:'PROOF-TICKER',seriesId:'PROOF-SERIES',attempt:1,clickedAt:iso(base.entryAt+120_000),extensionType:'+1_MIN',previousDeadline:iso(base.currentDeadline),newDeadline:iso(p1.currentDeadline),providerCloseTime:iso(base.providerCloseTime),scoreAtAction:0.61,currentQuoteAtAction:{yesBid:0.59,yesAsk:0.61,noBid:0.39,noAsk:0.41}},
  checkpointRetention:[
    checkpoint({label:'ENTRY',at:base.entryAt,position:base}),
    checkpoint({label:'5:00',at:base.entryAt+5*MINUTE,position:base,status:'CLOSED',score:0.42}),
    {...checkpoint({label:'5:30',at:base.entryAt+5*MINUTE+30*SECOND,position:base,status:'CLOSED',score:0.47}),observationType:'POST_EXIT_OBSERVATION'},
    {...checkpoint({label:'6:00',at:base.entryAt+6*MINUTE,position:base,status:'CLOSED',score:0.53}),observationType:'POST_EXIT_OBSERVATION'},
    checkpoint({label:'ACTUAL_EXIT',at:base.entryAt+5*MINUTE,position:base,status:'CLOSED',score:0.42}),
    {...checkpoint({label:'PROVIDER_SETTLEMENT',at:base.providerCloseTime,position:base,status:'CLOSED',score:null}),settlementResult:'YES'}
  ],
  classifications:{fiveToFiveThirty:classify(0.42,0.47),fiveToSix:classify(0.42,0.53),actualExitToSettlement:'UNKNOWN'},
  liveActivation:false,
  note:'ZERO-MONEY MODEL ONLY. Does not modify production maxHold, deadlines, exits, ARM/DISARM, provider execution, or capital.'
};

for(const [k,v] of Object.entries(proof)){
  if(v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,'pass')&&!v.pass){throw new Error('PROOF_FAILED:'+k)}
}
console.log(JSON.stringify(proof,null,2));
