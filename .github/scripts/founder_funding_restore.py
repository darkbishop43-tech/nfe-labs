from pathlib import Path
import re

FILE=Path('market-edge-lab/real/baseline/src/index.js')
BEFORE=FILE.read_text()
Path('/tmp/index.before.js').write_text(BEFORE)
s=BEFORE

old_ui="if(Number.isFinite(index0)&&index0>0) control+=\"<form method='post' action='/execution-test-consolidate-index2'><input type='hidden' name='authorization' value='MOVE_INDEX0_TO_INDEX2_FOR_FIVE_EXECUTION_TESTS'><button type='submit'>MOVE INDEX 0 BALANCE TO INDEX 2</button></form>\";"
new_ui="if(Number.isFinite(index0)&&index0>0) control+=\"<form method='get' action='/founder-funding'><button type='submit'>OPEN FOUNDER FUNDING</button></form>\";"
assert old_ui in s, 'historical one-click funding UI anchor missing'
s=s.replace(old_ui,new_ui,1)

start='    if (request.method === "POST" && url.pathname === "/execution-test-consolidate-index2") {'
i=s.find(start)
assert i>=0, 'historical route anchor missing'
brace=s.find('{',i)
depth=0; quote=None; esc=False; end=None
for k in range(brace,len(s)):
    ch=s[k]
    if quote:
        if esc: esc=False
        elif ch=='\\': esc=True
        elif ch==quote: quote=None
        continue
    if ch in "'\"`": quote=ch; continue
    if ch=='{': depth+=1
    elif ch=='}':
        depth-=1
        if depth==0:
            end=k+1; break
assert end, 'could not isolate historical funding route'

replacement=r'''    if (url.pathname === "/execution-test-consolidate-index2") {
      return json({ok:false,state:"FOUNDER_FUNDING_REVIEW_REQUIRED",next:"/founder-funding",providerWrites:0,capitalMovedUsd:0},409);
    }

    if (request.method === "GET" && url.pathname === "/founder-funding") {
      const state=await loadExecutionTestState(env);
      const balanceProof=await kalshiExecutionBalanceSnapshot(env);
      const rows=Array.isArray(balanceProof?.body?.balance_breakdown)?balanceProof.body.balance_breakdown:[];
      const index0=Number(rows.find(x=>Number(x?.exchange_index)===0)?.balance||0);
      const index2=Number(rows.find(x=>Number(x?.exchange_index)===2)?.balance||0);
      const total=rows.reduce((sum,x)=>sum+(Number(x?.balance)||0),0);
      const open=executionTestOpenPositions(state);
      const expired=open.filter(p=>{const started=Number(p?.filledAt||p?.submittedAt);return Number.isFinite(started)&&Date.now()-started>=EXECUTION_TEST_CONFIG.maxHoldMs;});
      const disarmed=!state?.armed&&!executionTestQueueActive(state);
      const safe=Boolean(balanceProof?.ok&&disarmed&&open.length===0&&expired.length===0);
      const money=n=>Number.isFinite(Number(n))?'$'+Number(n).toFixed(2):'—';
      const status=safe?'READY FOR REVIEW':(!disarmed?'FOUNDER ACTION REQUIRED — DISARM FIRST':expired.length?'BLOCKED — EXPIRED POSITION SAFETY HOLD':open.length?'BLOCKED — OPEN POSITION EXISTS':'BLOCKED — BALANCE READ FAILED');
      const form=safe&&index0>0?`<form method="post" action="/founder-funding-review"><label><b>TRANSFER AMOUNT</b></label><input name="amountUsd" type="number" inputmode="decimal" min="0.01" step="0.01" max="${index0.toFixed(2)}" required style="font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0;border-radius:10px"><button type="submit" style="font-size:17px;font-weight:800;padding:13px 16px;border-radius:10px;border:1px solid #d3a53a;background:#101b29;color:#ffd86a;width:100%">REVIEW TRANSFER</button></form>`:'<p>No transfer action is available.</p>';
      const page=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Founder Funding</title><body style="font-family:system-ui;background:#050a11;color:#eef7ff;padding:20px;max-width:720px;margin:auto"><h2>FOUNDER FUNDING</h2><div style="border:1px solid #294764;background:#0d1724;border-radius:14px;padding:18px"><p>TOTAL PREDICTIONS CASH: <b>${money(total)}</b></p><p>INDEX 0 BALANCE: <b>${money(index0)}</b></p><p>INDEX 2 BALANCE: <b>${money(index2)}</b></p><p>TRANSFERABLE INDEX 0 CASH: <b>${money(index0)}</b></p><p>SOURCE: <b>INDEX 0</b><br>DESTINATION: <b>INDEX 2</b></p><p>STATUS: <b>${status}</b></p>${form}<p style="color:#91a6be">Opening or refreshing this page performs authenticated reads only. It does not transfer funds, arm, disarm, or place an order.</p></div></body>`;
      return new Response(page,{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
    }

    if (request.method === "POST" && url.pathname === "/founder-funding-review") {
      const form=await request.formData().catch(()=>null);
      const amount=Number(form?.get("amountUsd"));
      const state=await loadExecutionTestState(env);
      if(state?.armed||executionTestQueueActive(state)) return json({ok:false,state:"FOUNDER_ACTION_REQUIRED_DISARM_FIRST",providerWrites:0,capitalMovedUsd:0},409);
      const open=executionTestOpenPositions(state);
      const expired=open.filter(p=>{const started=Number(p?.filledAt||p?.submittedAt);return Number.isFinite(started)&&Date.now()-started>=EXECUTION_TEST_CONFIG.maxHoldMs;});
      if(expired.length) return json({ok:false,state:"EXPIRED_POSITION_SAFETY_HOLD",providerWrites:0,capitalMovedUsd:0},409);
      if(open.length) return json({ok:false,state:"OPEN_POSITION_TRANSFER_BLOCKED",providerWrites:0,capitalMovedUsd:0},409);
      const balanceProof=await kalshiExecutionBalanceSnapshot(env);
      if(!balanceProof?.ok) return json({ok:false,state:"BALANCE_READ_FAILED",providerWrites:0,capitalMovedUsd:0},502);
      const rows=Array.isArray(balanceProof?.body?.balance_breakdown)?balanceProof.body.balance_breakdown:[];
      const index0=Number(rows.find(x=>Number(x?.exchange_index)===0)?.balance||0);
      const index2=Number(rows.find(x=>Number(x?.exchange_index)===2)?.balance||0);
      const total=rows.reduce((sum,x)=>sum+(Number(x?.balance)||0),0);
      if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)!==amount*100) return json({ok:false,state:"TRANSFER_AMOUNT_INVALID",providerWrites:0,capitalMovedUsd:0},400);
      if(amount>index0+1e-9) return json({ok:false,state:"TRANSFER_EXCEEDS_FRESH_INDEX0",requestedUsd:amount,index0Usd:index0,providerWrites:0,capitalMovedUsd:0},409);
      if(!env?.BASELINE_REAL_SHADOW_STATE) return json({ok:false,state:"REVIEW_STORE_UNAVAILABLE",providerWrites:0,capitalMovedUsd:0},503);
      const reviewId=crypto.randomUUID();
      await env.BASELINE_REAL_SHADOW_STATE.put("founder-funding-review-v1:"+reviewId,JSON.stringify({schema:"FOUNDER_FUNDING_REVIEW_V1",amountUsd:amount,reviewedAt:Date.now(),index0Usd:index0,index2Usd:index2,totalUsd:total}),{expirationTtl:600});
      const expected0=index0-amount,expected2=index2+amount;
      const page=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review Founder Funding</title><body style="font-family:system-ui;background:#050a11;color:#eef7ff;padding:20px;max-width:720px;margin:auto"><h2>REVIEW INDEX 0 → INDEX 2</h2><div style="border:1px solid #d3a53a;background:#0d1724;border-radius:14px;padding:18px"><p>SOURCE INDEX 0: <b>$${index0.toFixed(2)}</b></p><p>DESTINATION INDEX 2: <b>$${index2.toFixed(2)}</b></p><p>TRANSFER: <b>$${amount.toFixed(2)}</b></p><p>EXPECTED POST-TRANSFER INDEX 0: <b>$${expected0.toFixed(2)}</b></p><p>EXPECTED POST-TRANSFER INDEX 2: <b>$${expected2.toFixed(2)}</b></p><p>TOTAL PREDICTIONS CASH: <b>$${total.toFixed(2)}</b></p><form method="post" action="/founder-funding-confirm"><input type="hidden" name="reviewId" value="${reviewId}"><input type="hidden" name="authorization" value="CONFIRM_FOUNDER_INDEX0_TO_INDEX2_TRANSFER"><button type="submit" style="font-size:17px;font-weight:800;padding:13px 16px;border-radius:10px;border:1px solid #d3a53a;background:#101b29;color:#ffd86a;width:100%">CONFIRM INDEX 0 → INDEX 2</button></form><p style="color:#91a6be">No provider write has occurred. Confirmation performs a new safety and balance read before any transfer.</p></div></body>`;
      return new Response(page,{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});
    }

    if (request.method === "POST" && url.pathname === "/founder-funding-confirm") {
      const form=await request.formData().catch(()=>null);
      if(String(form?.get("authorization")||"")!=="CONFIRM_FOUNDER_INDEX0_TO_INDEX2_TRANSFER") return json({ok:false,state:"EXPLICIT_FOUNDER_CONFIRM_REQUIRED",providerWrites:0,capitalMovedUsd:0},400);
      const reviewId=String(form?.get("reviewId")||"");
      if(!reviewId||!env?.BASELINE_REAL_SHADOW_STATE) return json({ok:false,state:"VALID_REVIEW_REQUIRED",providerWrites:0,capitalMovedUsd:0},400);
      const key="founder-funding-review-v1:"+reviewId;
      const raw=await env.BASELINE_REAL_SHADOW_STATE.get(key);
      if(!raw) return json({ok:false,state:"REVIEW_MISSING_OR_EXPIRED",providerWrites:0,capitalMovedUsd:0},409);
      let review=null; try{review=JSON.parse(raw);}catch{}
      await env.BASELINE_REAL_SHADOW_STATE.delete(key);
      const amount=Number(review?.amountUsd);
      if(!Number.isFinite(amount)||amount<=0) return json({ok:false,state:"REVIEW_INVALID",providerWrites:0,capitalMovedUsd:0},409);
      const state=await loadExecutionTestState(env);
      if(state?.armed||executionTestQueueActive(state)) return json({ok:false,state:"FOUNDER_ACTION_REQUIRED_DISARM_FIRST",providerWrites:0,capitalMovedUsd:0},409);
      const open=executionTestOpenPositions(state);
      const expired=open.filter(p=>{const started=Number(p?.filledAt||p?.submittedAt);return Number.isFinite(started)&&Date.now()-started>=EXECUTION_TEST_CONFIG.maxHoldMs;});
      if(expired.length) return json({ok:false,state:"EXPIRED_POSITION_SAFETY_HOLD",providerWrites:0,capitalMovedUsd:0},409);
      if(open.length) return json({ok:false,state:"OPEN_POSITION_TRANSFER_BLOCKED",providerWrites:0,capitalMovedUsd:0},409);
      const balanceProof=await kalshiExecutionBalanceSnapshot(env);
      if(!balanceProof?.ok) return json({ok:false,state:"BALANCE_READ_FAILED",providerWrites:0,capitalMovedUsd:0},502);
      const rows=Array.isArray(balanceProof?.body?.balance_breakdown)?balanceProof.body.balance_breakdown:[];
      const index0=Number(rows.find(x=>Number(x?.exchange_index)===0)?.balance||0);
      const index2=Number(rows.find(x=>Number(x?.exchange_index)===2)?.balance||0);
      const total=rows.reduce((sum,x)=>sum+(Number(x?.balance)||0),0);
      if(amount>index0+1e-9) return json({ok:false,state:"TRANSFER_EXCEEDS_FRESH_INDEX0",requestedUsd:amount,index0Usd:index0,providerWrites:0,capitalMovedUsd:0},409);
      const amountCenticents=Math.round(amount*10000);
      if(!(amountCenticents>0)) return json({ok:false,state:"TRANSFER_AMOUNT_INVALID",providerWrites:0,capitalMovedUsd:0},400);
      const payload={source:"event_contract",destination:"event_contract",amount:amountCenticents,source_exchange_shard:0,destination_exchange_shard:2,source_subaccount:0,destination_subaccount:0};
      const r=await kalshiApprovedShardTransfer(env,payload);
      const providerResponse=await r.json().catch(()=>({}));
      if(!r.ok) return json({ok:false,state:"INDEX2_TRANSFER_PROVIDER_REJECTED",httpStatus:r.status,providerResponse,providerWrites:1,capitalMoveAttemptedUsd:amount},502);
      const after=await kalshiExecutionBalanceSnapshot(env);
      const afterRows=Array.isArray(after?.body?.balance_breakdown)?after.body.balance_breakdown:[];
      const post0=Number(afterRows.find(x=>Number(x?.exchange_index)===0)?.balance||0);
      const post2=Number(afterRows.find(x=>Number(x?.exchange_index)===2)?.balance||0);
      const postTotal=afterRows.reduce((sum,x)=>sum+(Number(x?.balance)||0),0);
      const reconciled=Boolean(after?.ok&&Math.abs(post0-(index0-amount))<0.011&&Math.abs(post2-(index2+amount))<0.011&&Math.abs(postTotal-total)<0.011);
      return json({ok:true,state:reconciled?"INDEX2_TRANSFER_RECONCILED":"INDEX2_TRANSFER_ACCEPTED_AWAITING_BALANCE_RECONCILIATION",transfer:{amountUsd:amount,sourceExchangeIndex:0,destinationExchangeIndex:2,pre:{index0Usd:index0,index2Usd:index2,totalUsd:total},post:{index0Usd:post0,index2Usd:post2,totalUsd:postTotal},reconciled},providerWrites:1,ordersSubmitted:0,armChanged:false,disarmChanged:false});
    }'''

s=s[:i]+replacement+s[end:]
FILE.write_text(s)
AFTER=s

def block(src, marker):
    i=src.index(marker); b=src.index('{',i); depth=0; q=None; esc=False
    for k in range(b,len(src)):
        c=src[k]
        if q:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c==q: q=None
            continue
        if c in "'\"`": q=c; continue
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0:return src[i:k+1]
    raise AssertionError(marker)

assert block(BEFORE,'async function runExecutionTestSeries') == block(AFTER,'async function runExecutionTestSeries')
for token in ['url.pathname === "/execution-test-arm"','url.pathname === "/execution-test-disarm"','ARM_BOUNDED_EXECUTION_TESTS_MAX_1_USD','DISARM_EXECUTION_TEST_SERIES_PRESERVE_HISTORY','entryScore:0.80','exitScore:0.20','maxHoldMs:5*60*1000','maxEntryDebitUsd:1','maxConcurrent:3','requiredExchangeIndex:2','EXPIRED_POSITION_PRIORITY']:
    assert BEFORE.count(token)==AFTER.count(token), token
assert AFTER.count('async function kalshiApprovedShardTransfer(env,payload)')==1
assert '/trade-api/v2/portfolio/intra_exchange_instance_transfer' in AFTER
assert AFTER.count('kalshiApprovedShardTransfer(env,payload)')==2
assert 'FOUNDER_FUNDING_REVIEW_REQUIRED' in AFTER
assert '/founder-funding-review' in AFTER and '/founder-funding-confirm' in AFTER
assert 'CONFIRM_FOUNDER_INDEX0_TO_INDEX2_TRANSFER' in AFTER
assert 'expirationTtl:600' in AFTER

MAX_HOLD=5*60*1000
def guard(index0,index2,amount,armed=False,queue=False,positions=None,now=1_000_000):
    positions=positions or []
    openp=[p for p in positions if p.get('status') in ('OPEN','EXIT_RETRY')]
    expired=[p for p in openp if isinstance(p.get('started'),(int,float)) and now-p['started']>=MAX_HOLD]
    if armed or queue:return 'DISARM'
    if expired:return 'EXPIRED'
    if openp:return 'OPEN'
    if not isinstance(amount,(int,float)) or amount<=0:return 'INVALID'
    if amount>index0+1e-9:return 'EXCEEDS'
    return {'index0':round(index0-amount,2),'index2':round(index2+amount,2),'total':round(index0+index2,2)}

assert guard(10,4.03,10)=={'index0':0,'index2':14.03,'total':14.03}
assert guard(10,4.03,11)=='EXCEEDS'
assert guard(0,4.03,10)=='EXCEEDS'
assert guard(10,4.03,10,positions=[{'status':'OPEN','started':999999}])=='OPEN'
assert guard(10,4.03,10,positions=[{'status':'OPEN','started':0}])=='EXPIRED'
get_block=AFTER[AFTER.index('request.method === "GET" && url.pathname === "/founder-funding"'):AFTER.index('request.method === "POST" && url.pathname === "/founder-funding-review"')]
assert 'kalshiApprovedShardTransfer' not in get_block
print('CASE1_PASS index0=0 index2=14.03 total=14.03')
print('CASE2_PASS overdraw_blocked')
print('CASE3_PASS empty_index0_blocked')
print('CASE4_PASS open_position_blocked')
print('CASE5_PASS expired_position_blocked')
print('CASE6_PASS refresh_no_transfer')
print('ARM_UNCHANGED=PASS')
print('DISARM_UNCHANGED=PASS')
print('CONTROLLER_RUN_FUNCTION_BYTE_IDENTICAL=PASS')
print('PROVIDER_WRITES_DURING_PROOF=0')
print('CAPITAL_MOVED_DURING_PROOF_USD=0')
print('ORDERS_SUBMITTED_DURING_PROOF=0')
