export const N_VERSION = "N_V0";
export const SI_VERSION = "SI_V0";

export const N_TRUST_SCALE = Object.freeze({
  DIRECT_PROVIDER_OFFICIAL: 1.00,
  REGULATORY_OR_COMPANY_FILING: 0.90,
  HIGH_QUALITY_VERIFIED_REPORTING: 0.75,
  NAMED_ANALYST_RESEARCH: 0.60,
  BROAD_NEWS_NARRATIVE: 0.40,
  SOCIAL_RETAIL_CHATTER: 0.20,
  UNKNOWN_UNSOURCED: 0.00,
});

const clamp01=x=>Math.max(0,Math.min(1,Number(x)));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const fail=(component,reason,provenance={})=>({component,value:null,status:"INCOMPLETE",reason,provenance});
const pass=(component,value,reason,provenance={})=>({component,value:clamp01(value),status:"VALID",reason,provenance});

function requiredEvidence(bundle){
  return Array.isArray(bundle?.evidence)?bundle.evidence.filter(x=>x?.required!==false):null;
}

export function calculateNE(bundle){
  const evidence=requiredEvidence(bundle);
  if(!evidence) return fail("N_E","NFE/UMEO evidence bundle missing",{version:N_VERSION});
  const supporting=evidence.filter(x=>x?.stance==="SUPPORT");
  if(!supporting.length) return pass("N_E",0,"Valid evidence bundle contains zero supporting evidence items",{supportingItems:0,independentSupportingGroups:0});
  if(supporting.some(x=>!String(x?.independentGroup||"").trim())) return fail("N_E","Supporting evidence item missing independentGroup",{supportingItems:supporting.length});
  const groups=new Set(supporting.map(x=>String(x.independentGroup).trim()));
  const independentGroups=groups.size;
  const value=Math.min(1,independentGroups/3);
  return pass("N_E",value,"V0 evidence score = min(1, independent supporting evidence groups / 3)",{supportingItems:supporting.length,independentSupportingGroups:independentGroups,saturationGroups:3});
}

export function calculateNFr(bundle,nowMs=Date.now()){
  const evidence=requiredEvidence(bundle);
  if(!evidence) return fail("N_Fr","NFE/UMEO evidence bundle missing",{version:N_VERSION});
  if(!evidence.length) return fail("N_Fr","No required evidence items available for freshness calculation");
  const vals=[];
  const rows=[];
  for(const e of evidence){
    const observed=Date.parse(e?.observedAt||"");
    const halfLife=Number(e?.freshnessHalfLifeMs);
    if(!Number.isFinite(observed)||!(halfLife>0)) return fail("N_Fr","Required evidence item missing valid observedAt or freshnessHalfLifeMs",{evidenceId:e?.id||null});
    const age=Math.max(0,Number(nowMs)-observed);
    const freshness=Math.exp(-Math.LN2*age/halfLife);
    vals.push(freshness);
    rows.push({id:e?.id||null,ageMs:age,freshnessHalfLifeMs:halfLife,freshness});
  }
  return pass("N_Fr",mean(vals),"V0 freshness = arithmetic mean of exp(-ln(2) * age / evidence-specific half-life)",{items:rows});
}

export function calculateNTr(bundle){
  const evidence=requiredEvidence(bundle);
  if(!evidence) return fail("N_Tr","NFE/UMEO evidence bundle missing",{version:N_VERSION});
  if(!evidence.length) return fail("N_Tr","No required evidence items available for trust calculation");
  const vals=[];
  const rows=[];
  for(const e of evidence){
    const klass=String(e?.sourceClass||"");
    if(!(klass in N_TRUST_SCALE)) return fail("N_Tr","Required evidence item missing recognized sourceClass",{evidenceId:e?.id||null,sourceClass:klass||null});
    vals.push(N_TRUST_SCALE[klass]);
    rows.push({id:e?.id||null,sourceClass:klass,trust:N_TRUST_SCALE[klass]});
  }
  return pass("N_Tr",mean(vals),"V0 trust = arithmetic mean of fixed versioned source-class trust scores",{items:rows,trustScale:N_TRUST_SCALE});
}

function ratioChecks(component,checks,successPredicate,missingReason,label){
  if(!Array.isArray(checks)) return fail(component,missingReason);
  if(!checks.length) return fail(component,missingReason);
  let passCount=0;
  const rows=[];
  for(const x of checks){
    const valid=successPredicate.valid(x);
    if(!valid) return fail(component,successPredicate.invalidReason,{checkId:x?.id||null});
    const ok=successPredicate.pass(x);
    if(ok) passCount++;
    rows.push({id:x?.id||null,result:ok?"PASS":"FAIL"});
  }
  return pass(component,passCount/checks.length,`V0 ${label} = passed required checks / total required checks`,{passed:passCount,total:checks.length,checks:rows});
}

export function calculateNTx(bundle){
  return ratioChecks("N_Tx",bundle?.crossChecks,{
    valid:x=>["PASS","FAIL"].includes(x?.result),
    pass:x=>x.result==="PASS",
    invalidReason:"Cross-check missing deterministic PASS/FAIL result"
  },"No independent cross-source/cross-signal checks available","cross-check agreement");
}

export function calculateNA(bundle){
  return ratioChecks("N_A",bundle?.anomalyChecks,{
    valid:x=>["PASS","FAIL"].includes(x?.result),
    pass:x=>x.result==="PASS",
    invalidReason:"Anomaly check missing deterministic PASS/FAIL result"
  },"No anomaly checks available","anomaly survival");
}

export function calculateNC(bundle){
  return ratioChecks("N_C",bundle?.collisionTests,{
    valid:x=>typeof x?.candidateSurvives==="boolean",
    pass:x=>x.candidateSurvives===true,
    invalidReason:"Collision test missing boolean candidateSurvives result"
  },"No collision tests available","collision survival");
}

export function calculateNV0(bundle,nowMs=Date.now()){
  const components={
    N_E:calculateNE(bundle),
    N_Fr:calculateNFr(bundle,nowMs),
    N_Tr:calculateNTr(bundle),
    N_Tx:calculateNTx(bundle),
    N_A:calculateNA(bundle),
    N_C:calculateNC(bundle),
  };
  const missing=Object.entries(components).filter(([,x])=>x.value===null).map(([k,x])=>({component:k,reason:x.reason}));
  const values=Object.values(components).map(x=>x.value);
  const value=missing.length?null:mean(values);
  return {
    version:N_VERSION,
    status:value===null?"INCOMPLETE":"VALID",
    value:value===null?null:clamp01(value),
    formula:"(N_E + N_Fr + N_Tr + N_Tx + N_A + N_C) / 6",
    components,
    missing,
    provenance:{
      layer:"NFE_UMEO_EVIDENCE",
      marketDataDoubleCountPrevented:true,
      excludedFromN:["momentum","trend","volatility","spread","volume"],
      evaluatedAt:new Date(Number(nowMs)).toISOString(),
    }
  };
}

export function calculateFullSIV0({M,T,V,Q,F,N}={}){
  const vals={M,T,V,Q,F,N};
  const missing=Object.entries(vals).filter(([,v])=>v===null||v===undefined||v===""||!Number.isFinite(Number(v))).map(([k])=>k);
  if(missing.length) return {version:SI_VERSION,status:"INCOMPLETE",value:null,missing,invalid:[],formula:"100*(0.30M+0.20T+0.15V+0.10Q+0.15F+0.10N)"};
  const invalid=Object.entries(vals).filter(([,v])=>Number(v)<0||Number(v)>1).map(([k,v])=>({component:k,value:Number(v),reason:"OUTSIDE_0_1"}));
  if(invalid.length) return {version:SI_VERSION,status:"INCOMPLETE",value:null,missing:[],invalid,formula:"100*(0.30M+0.20T+0.15V+0.10Q+0.15F+0.10N)"};
  const value=100*(0.30*Number(M)+0.20*Number(T)+0.15*Number(V)+0.10*Number(Q)+0.15*Number(F)+0.10*Number(N));
  return {
    version:SI_VERSION,status:"VALID",value,missing:[],invalid:[],
    contributions:{
      M:0.30*Number(M),T:0.20*Number(T),V:0.15*Number(V),Q:0.10*Number(Q),F:0.15*Number(F),N:0.10*Number(N)
    },
    weightedSum:value/100,
    formula:"100*(0.30M+0.20T+0.15V+0.10Q+0.15F+0.10N)"
  };
}


export function calculateSICoreV0A({M,T,V,Q,F}={}){
  const vals={M,T,V,Q,F};
  const missing=Object.entries(vals).filter(([,v])=>v===null||v===undefined||v===""||!Number.isFinite(Number(v))).map(([k])=>k);
  if(missing.length) return {
    version:"SI_CORE_V0A",
    status:"INCOMPLETE",
    value:null,
    missing,
    invalid:[],
    contributions:null,
    weightedSum:null,
    formula:"100*(0.30M+0.20T+0.15V+0.10Q+0.15F)/0.90"
  };
  const invalid=Object.entries(vals).filter(([,v])=>Number(v)<0||Number(v)>1).map(([k,v])=>({component:k,value:Number(v),reason:"OUTSIDE_0_1"}));
  if(invalid.length) return {
    version:"SI_CORE_V0A",
    status:"INCOMPLETE",
    value:null,
    missing:[],
    invalid,
    contributions:null,
    weightedSum:null,
    formula:"100*(0.30M+0.20T+0.15V+0.10Q+0.15F)/0.90"
  };
  const contributions={
    M:0.30*Number(M),
    T:0.20*Number(T),
    V:0.15*Number(V),
    Q:0.10*Number(Q),
    F:0.15*Number(F)
  };
  const weightedSum=Object.values(contributions).reduce((a,b)=>a+b,0);
  return {
    version:"SI_CORE_V0A",
    status:"VALID",
    value:100*weightedSum/0.90,
    missing:[],
    invalid:[],
    contributions,
    weightedSum,
    denominator:0.90,
    formula:"100*(0.30M+0.20T+0.15V+0.10Q+0.15F)/0.90"
  };
}
