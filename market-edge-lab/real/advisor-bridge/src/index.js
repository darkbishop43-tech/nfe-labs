const JSON_HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET, OPTIONS",
  "access-control-allow-headers":"content-type",
};

const STALE_AFTER_SECONDS=12*60;
const ALLOWED_METHODS=new Set(["GET","OPTIONS"]);

function response(body,status=200){return new Response(JSON.stringify(body,null,2),{status,headers:JSON_HEADERS});}
function safeArray(value,limit=9){return Array.isArray(value)?value.slice(0,limit):[];}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}

function sanitizeAssessment(a){
  return {
    asset:String(a?.asset||""),
    dataStatus:String(a?.dataStatus||"UNAVAILABLE"),
    advisoryBias:String(a?.advisoryBias||"NEUTRAL"),
    advisoryConfidence:String(a?.advisoryConfidence||"LOW"),
    setupPhase:String(a?.setupPhase||"NO_CLEAR_SETUP"),
    trendState:String(a?.trendState||"UNKNOWN"),
    momentumState:String(a?.momentumState||"UNKNOWN"),
    rsi14:finite(a?.rsi?.rsi14),
    emaStructure:String(a?.ema?.structure||"UNAVAILABLE"),
    ma200Relation:a?.ma200?.status==="AVAILABLE"?(a.ma200.priceAboveMa200?"ABOVE":"BELOW"):"UNAVAILABLE",
    momentum15m:finite(a?.momentum?.momentum15m),
    nearestSupport:finite(a?.levels?.nearestSupport),
    nearestResistance:finite(a?.levels?.nearestResistance),
    reasoningSummary:String(a?.reasoningSummary||"").slice(0,320),
    riskFlags:safeArray(a?.riskFlags,6).map(String),
  };
}

function displaySafe(state,nowMs=Date.now()){
  const generatedAt=state?.generatedAt||state?.updatedAt||null;
  const generatedMs=generatedAt?Date.parse(generatedAt):NaN;
  const ageSeconds=Number.isFinite(generatedMs)?Math.max(0,Math.floor((nowMs-generatedMs)/1000)):null;
  const status=ageSeconds===null?"UNAVAILABLE":ageSeconds<=STALE_AFTER_SECONDS?"ACTIVE":"STALE";
  const assessments=safeArray(state?.assetAssessments,9).map(sanitizeAssessment);
  return {
    ok:status!=="UNAVAILABLE",
    status,
    generatedAt,
    updatedAt:generatedAt,
    ageSeconds,
    cycleId:state?.cycleId||null,
    marketRegime:state?.marketRegime||"UNKNOWN",
    marketBreadth:state?.marketBreadth||null,
    strongestBullishContext:safeArray(state?.strongestBullishContext,3),
    strongestBearishContext:safeArray(state?.strongestBearishContext,3),
    highestConfluenceAssets:safeArray(state?.highestConfluenceAssets,3),
    largestDivergences:safeArray(state?.largestDivergences,3),
    marketRiskFlags:safeArray(state?.marketRiskFlags,6),
    assetAssessments:assessments,
    authority:{
      canReadAdvisorState:true,
      canWriteAdvisorState:false,
      canWriteExecutionState:false,
      canModifyScore:false,
      canModifyExecution:false,
      canSubmitOrders:false,
      canCancelOrders:false,
      canMoveCapital:false,
      canArm:false,
      canDisarm:false,
    },
  };
}

export {displaySafe,STALE_AFTER_SECONDS};

export default {
  async fetch(request,env){
    if(!ALLOWED_METHODS.has(request.method)) return response({ok:false,status:"METHOD_NOT_ALLOWED"},405);
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:JSON_HEADERS});
    const url=new URL(request.url);
    if(url.pathname==="/health") return response({ok:true,status:"READ_ONLY_ADVISOR_BRIDGE",writesEnabled:false,executionAuthority:false});
    if(url.pathname!=="/advisor-current") return response({ok:false,status:"NOT_FOUND"},404);
    try{
      const raw=await env.ADVISOR_STATE.get("advisor:current:v1",{type:"json"});
      if(!raw) return response({ok:false,status:"UNAVAILABLE",generatedAt:null,ageSeconds:null,marketRegime:"UNKNOWN",marketBreadth:null,strongestBullishContext:[],strongestBearishContext:[],marketRiskFlags:[],assetAssessments:[],authority:{canReadAdvisorState:true,canWriteAdvisorState:false,canWriteExecutionState:false,canModifyExecution:false,canSubmitOrders:false,canMoveCapital:false,canArm:false,canDisarm:false}},503);
      return response(displaySafe(raw));
    }catch{
      return response({ok:false,status:"UNAVAILABLE",generatedAt:null,ageSeconds:null,marketRegime:"UNKNOWN",marketBreadth:null,strongestBullishContext:[],strongestBearishContext:[],marketRiskFlags:[],assetAssessments:[]},503);
    }
  }
};
