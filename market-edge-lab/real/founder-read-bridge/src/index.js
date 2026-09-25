const UPSTREAM="https://market-edge-baseline-real.darkbishop43.workers.dev";
const ALLOWED=new Set(["/shadow-state","/wide-radar-state","/execution-test-state","/real-trade-state"]);
const CORS={"access-control-allow-origin":"https://raw.githack.com","access-control-allow-methods":"GET,OPTIONS","access-control-allow-headers":"content-type","cache-control":"no-store","x-content-type-options":"nosniff"};
export default{async fetch(request,env){
  const u=new URL(request.url);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(request.method!=="GET")return new Response(JSON.stringify({ok:false,error:"READ_ONLY"}),{status:405,headers:{...CORS,"content-type":"application/json"}});
  if(u.pathname==="/health")return new Response(JSON.stringify({ok:true,mode:"FOUNDER_COCKPIT_READ_BRIDGE",writes:0,credentials:0}),{headers:{...CORS,"content-type":"application/json"}});
  if(!ALLOWED.has(u.pathname))return new Response(JSON.stringify({ok:false,error:"ROUTE_NOT_ALLOWLISTED"}),{status:404,headers:{...CORS,"content-type":"application/json"}});
  const r=await env.BASELINE.fetch(new Request(UPSTREAM+u.pathname,{method:"GET",headers:{"accept":"application/json"}}));
  const body=await r.text();
  return new Response(body,{status:r.status,headers:{...CORS,"content-type":"application/json; charset=utf-8","x-nfe-source":"BASELINE_PUBLIC_READ"}});
}}