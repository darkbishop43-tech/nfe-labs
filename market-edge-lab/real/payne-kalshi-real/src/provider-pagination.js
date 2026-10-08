// Read-only provider pagination. This module does not change control, ledger or order state.
// A single failed/ambiguous page fails the entire collection closed.
export async function readKalshiPages(getOnly, env, endpoint, {
  collection, query={}, limit=200, maxPages=100
}={}) {
  if(typeof getOnly!=='function' || !/^\/trade-api\/v2\//.test(endpoint) ||
     !/^[a-z_]+$/.test(String(collection||'')) ||
     !Number.isInteger(limit) || limit<1 || limit>1000 ||
     !Number.isInteger(maxPages) || maxPages<1 || maxPages>100) {
    return {ok:false,reason:'INVALID_PAGINATION_CONFIGURATION',paginationComplete:false,rows:[]};
  }
  const rows=[], seen=new Set();
  let cursor='', pages=0;
  while(pages<maxPages) {
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(query)) {
      if(key==='cursor' || key==='limit' || value===undefined || value===null) continue;
      params.set(key,String(value));
    }
    params.set('limit',String(limit));
    if(cursor) params.set('cursor',cursor);
    let response,body;
    try {
      response=await getOnly(env,endpoint+'?'+params.toString());
      if(!response?.ok) return {ok:false,reason:'PROVIDER_HTTP_FAILURE',httpStatus:response?.status??null,paginationComplete:false,pages,rows:[]};
      body=await response.json();
    } catch {
      return {ok:false,reason:'PROVIDER_READ_OR_JSON_FAILURE',paginationComplete:false,pages,rows:[]};
    }
    if(!body || !Array.isArray(body[collection]) ||
       (body.cursor!==undefined && body.cursor!==null && typeof body.cursor!=='string')) {
      return {ok:false,reason:'PROVIDER_SCHEMA_AMBIGUOUS',paginationComplete:false,pages,rows:[]};
    }
    rows.push(...body[collection]);
    pages++;
    const next=body.cursor||'';
    if(!next) return {ok:true,reason:'CURSOR_EXHAUSTED',paginationComplete:true,pages,rows};
    if(next===cursor || seen.has(next)) return {ok:false,reason:'CURSOR_REPEATED',paginationComplete:false,pages,rows:[]};
    seen.add(next);
    cursor=next;
  }
  return {ok:false,reason:'PAGINATION_SAFETY_LIMIT',paginationComplete:false,pages,rows:[]};
}
