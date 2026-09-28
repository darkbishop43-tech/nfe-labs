from pathlib import Path

src=Path('market-edge-lab/real/baseline/src/index.js')
s=src.read_text(encoding='utf-8')
marker='NFE_PROVIDER_HISTORY_READ_V1'
if marker not in s:
    anchor='    if (request.method === "GET" && url.pathname === "/forensic-historical-orders") {'
    if anchor not in s:
        raise SystemExit('FORENSIC_HISTORICAL_ORDERS_ANCHOR_NOT_FOUND')
    block=r'''
    // NFE_PROVIDER_HISTORY_READ_V1 — authenticated provider history, GET only.
    if (request.method === "GET" && url.pathname === "/forensic-provider-history") {
      const requestedLimit=Number(url.searchParams.get("limit"));
      const limit=Number.isFinite(requestedLimit)?Math.min(200,Math.max(1,Math.trunc(requestedLimit))):200;
      const minTs=url.searchParams.get("min_ts");
      const maxTs=url.searchParams.get("max_ts");
      const q=(extra={})=>{
        const p=new URLSearchParams({limit:String(limit),...extra});
        if(minTs)p.set("min_ts",minTs);
        if(maxTs)p.set("max_ts",maxTs);
        return p.toString();
      };
      const specs=[
        ["fills","/trade-api/v2/portfolio/fills?"+q({subaccount:"0"})],
        ["settlements","/trade-api/v2/portfolio/settlements?"+q({subaccount:"0"})],
        ["positions","/trade-api/v2/portfolio/positions?"+q({subaccount:"0",count_filter:"position,total_traded"})],
        ["historicalFills","/trade-api/v2/historical/fills?"+q({subaccount:"0"})]
      ];
      const readOne=async ([name,path])=>{
        try{
          const r=await kalshiExecutionGet(env,path);
          let body=null; try{body=await r.json();}catch{}
          return {name,path,httpStatus:r.status,ok:r.ok,body};
        }catch{return {name,path,httpStatus:null,ok:false,body:null};}
      };
      const results=await Promise.all(specs.map(readOne));
      const byName=Object.fromEntries(results.map(x=>[x.name,x]));
      const safeFill=f=>({
        recordType:"FILL",fillId:f?.fill_id??f?.fillId??null,orderId:f?.order_id??f?.orderId??null,tradeId:f?.trade_id??f?.tradeId??null,
        ticker:f?.ticker??null,marketTicker:f?.market_ticker??f?.ticker??null,side:f?.side??null,action:f?.action??null,count:f?.count??null,
        yesPrice:f?.yes_price??f?.yes_price_dollars??null,noPrice:f?.no_price??f?.no_price_dollars??null,feeCost:f?.fee_cost??f?.fee??null,
        createdAt:f?.created_time??f?.created_at??f?.ts??null
      });
      const safeSettlement=x=>({
        recordType:"SETTLEMENT",ticker:x?.ticker??null,eventTicker:x?.event_ticker??null,marketResult:x?.market_result??null,
        yesCount:x?.yes_count??null,noCount:x?.no_count??null,yesTotalCost:x?.yes_total_cost??null,noTotalCost:x?.no_total_cost??null,
        revenue:x?.revenue??null,feeCost:x?.fee_cost??null,value:x?.value??null,settledTime:x?.settled_time??null
      });
      const safePosition=x=>({
        recordType:"POSITION",ticker:x?.ticker??x?.market_ticker??null,position:x?.position??null,totalTraded:x?.total_traded??null,
        marketExposure:x?.market_exposure??null,realizedPnl:x?.realized_pnl??null,feesPaid:x?.fees_paid??null
      });
      const fills=Array.isArray(byName.fills?.body?.fills)?byName.fills.body.fills.map(safeFill):[];
      const historicalFills=Array.isArray(byName.historicalFills?.body?.fills)?byName.historicalFills.body.fills.map(safeFill):[];
      const settlements=Array.isArray(byName.settlements?.body?.settlements)?byName.settlements.body.settlements.map(safeSettlement):[];
      const positions=Array.isArray(byName.positions?.body?.market_positions)?byName.positions.body.market_positions.map(safePosition):Array.isArray(byName.positions?.body?.positions)?byName.positions.body.positions.map(safePosition):[];
      const providerRows=[...fills,...historicalFills,...settlements];
      return json({
        ok:true,readOnly:true,provider:"KALSHI",generatedAt:new Date().toISOString(),
        endpointFamilies:{
          fills:{path:"GET /trade-api/v2/portfolio/fills",ok:byName.fills?.ok===true,httpStatus:byName.fills?.httpStatus??null,rowCount:fills.length},
          historicalFills:{path:"GET /trade-api/v2/historical/fills",ok:byName.historicalFills?.ok===true,httpStatus:byName.historicalFills?.httpStatus??null,rowCount:historicalFills.length},
          settlements:{path:"GET /trade-api/v2/portfolio/settlements",ok:byName.settlements?.ok===true,httpStatus:byName.settlements?.httpStatus??null,rowCount:settlements.length},
          positions:{path:"GET /trade-api/v2/portfolio/positions",ok:byName.positions?.ok===true,httpStatus:byName.positions?.httpStatus??null,rowCount:positions.length}
        },
        fills,historicalFills,settlements,positions,providerRows,
        safety:{providerTradingWrites:0,executionStateWrites:0,capitalMovedUsd:0,ordersSubmitted:0,credentialsExposed:false}
      });
    }

'''
    s=s.replace(anchor,block+anchor,1)
    src.write_text(s,encoding='utf-8')
    print('PROVIDER_HISTORY_ROUTE_PATCHED=YES')
else:
    print('PROVIDER_HISTORY_ROUTE_ALREADY_PRESENT=YES')

cockpit=Path('market-edge-lab/real/baseline/founder-terminal.html')
c=cockpit.read_text(encoding='utf-8')
old="getRO('/forensic-historical-orders?limit=200')"
new="getRO('/forensic-provider-history?limit=200')"
if old in c:
    c=c.replace(old,new,1)
# Keep the existing compare UI; only teach its row extractor about normalized providerRows.
old2="const ordersFrom=x=>arr(x?.orders).length?arr(x.orders):arr(x?.historical_orders).length?arr(x.historical_orders):arr(x?.data?.orders).length?arr(x.data.orders):arr(x?.data?.historical_orders).length?arr(x.data.historical_orders):[];"
new2="const ordersFrom=x=>arr(x?.providerRows).length?arr(x.providerRows):arr(x?.fills).length?arr(x.fills):arr(x?.orders).length?arr(x.orders):arr(x?.historical_orders).length?arr(x.historical_orders):arr(x?.data?.orders).length?arr(x.data.orders):arr(x?.data?.historical_orders).length?arr(x.data.historical_orders):[];"
if old2 in c:
    c=c.replace(old2,new2,1)
# normalized fields
c=c.replace("const orderId=o=>String(o?.order_id??o?.orderId??o?.id??'').trim();","const orderId=o=>String(o?.order_id??o?.orderId??o?.fillId??o?.tradeId??o?.id??'').trim();",1)
c=c.replace("const ticker=o=>String(o?.ticker??o?.market_ticker??o?.marketTicker??'').trim();","const ticker=o=>String(o?.ticker??o?.market_ticker??o?.marketTicker??'').trim();",1)
c=c.replace("const timeOf=o=>o?.created_time??o?.created_at??o?.updated_time??o?.ts??o?.timestamp??null;","const timeOf=o=>o?.created_time??o?.created_at??o?.createdAt??o?.settledTime??o?.updated_time??o?.ts??o?.timestamp??null;",1)
c=c.replace("const providerFees=o=>n(o?.fees??o?.fee??o?.taker_fees??o?.maker_fees??o?.fees_dollars);","const providerFees=o=>n(o?.fees??o?.fee??o?.feeCost??o?.taker_fees??o?.maker_fees??o?.fees_dollars);",1)
c=c.replace("const filledCount=o=>n(o?.fill_count??o?.filled_count??o?.filledCount??o?.count_filled??o?.count)??0;","const filledCount=o=>o?.recordType==='SETTLEMENT'?1:(n(o?.fill_count??o?.filled_count??o?.filledCount??o?.count_filled??o?.count)??0);",1)
cockpit.write_text(c,encoding='utf-8')
print('COCKPIT_PROVIDER_SOURCE_UPDATED=YES')
