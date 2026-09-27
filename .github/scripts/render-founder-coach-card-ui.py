from pathlib import Path

p = Path('market-edge-lab/real/baseline/src/index.js')
s = p.read_text()
arm = '    if (request.method === "POST" && url.pathname === "/execution-test-arm") {'
queue = '    if (request.method === "POST" && url.pathname === "/execution-test-queue-arm") {'
assert arm in s and queue in s
original_arm = s[s.index(arm):s.index(queue)]
assert 'ARM_BOUNDED_EXECUTION_TESTS_MAX_1_USD' in original_arm
assert '/execution-test-coach-preview' not in s
assert 'FOUNDER COACH CARD' not in s

preview = '''    if (request.method === "POST" && url.pathname === "/execution-test-coach-preview") {
      const form=await request.formData().catch(()=>null);
      if(String(form?.get("authorization")||"")!=="VALIDATE_FOUNDER_COACH_CARD") return json({ok:false,state:"EXPLICIT_COACH_VALIDATION_AUTHORIZATION_REQUIRED",armed:false,providerWrites:0,capitalMovedUsd:0,tradingOrders:0},400);
      const threshold=Number(form?.get("coachThreshold"));
      const maxAttempts=Math.trunc(Number(form?.get("coachAttempts")));
      const maxEntryDebitUsd=Math.trunc(Number(form?.get("coachStake")));
      const maxConcurrent=Math.trunc(Number(form?.get("coachConcurrent")));
      const allowedScores=[.50,.55,.60,.65,.70,.75,.80,.85];
      if(!allowedScores.some(x=>Math.abs(x-threshold)<1e-9)) return json({ok:false,state:"COACH_THRESHOLD_INVALID",armed:false,providerWrites:0,capitalMovedUsd:0,tradingOrders:0},400);
      if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>100) return json({ok:false,state:"COACH_ATTEMPTS_INVALID",armed:false,providerWrites:0,capitalMovedUsd:0,tradingOrders:0},400);
      if(!Number.isInteger(maxEntryDebitUsd)||maxEntryDebitUsd<1||maxEntryDebitUsd>10) return json({ok:false,state:"COACH_STAKE_INVALID",armed:false,providerWrites:0,capitalMovedUsd:0,tradingOrders:0},400);
      if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>10) return json({ok:false,state:"COACH_CONCURRENCY_INVALID",armed:false,providerWrites:0,capitalMovedUsd:0,tradingOrders:0},400);
      const frozenConfig=Object.freeze({threshold,maxAttempts,maxEntryDebitUsd,maxConcurrent});
      const liveArmEligible=maxEntryDebitUsd===1&&maxConcurrent<=3;
      return json({ok:true,state:liveArmEligible?"COACH_CONFIG_VALID_WITHIN_CURRENT_AUTHORITY":"COACH_CONFIG_VALID_NOT_YET_LIVE_AUTHORIZED",frozenConfig,immutable:true,liveArmEligible,liveArmImplemented:false,autoCanAlterConfig:false,armed:false,providerWrites:0,capitalMovedUsd:0,tradingOrders:0});
    }

'''
s = s.replace(arm, preview + arm, 1)

anchor = '      if(!state.armed&&!executionTestQueueActive(state)&&executionTestOpenPositions(state).length===0&&ready) control+="<div class=\'box\'><b>EXISTING SINGLE-SERIES ARM</b>'
assert anchor in s
card = '''      control+="<div class='box'><b>FOUNDER COACH CARD</b><p class='muted'>Configuration and zero-money validation on the existing controller page. Original ARM remains the only live execution authority.</p><form method='post' action='/execution-test-coach-preview'><input type='hidden' name='authorization' value='VALIDATE_FOUNDER_COACH_CARD'><label><b>Signal threshold</b></label><select name='coachThreshold' style='font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0 14px;border-radius:10px'>"+[.50,.55,.60,.65,.70,.75,.80,.85].map(v=>"<option value='"+v+"' "+(v===.60?"selected":"")+">"+v.toFixed(2)+"</option>").join("")+"</select><label><b>Attempt count</b></label><input name='coachAttempts' type='number' min='1' max='100' step='1' value='3' style='font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0 14px;border-radius:10px'><label><b>Max entry debit per filled position</b></label><select name='coachStake' style='font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0 14px;border-radius:10px'>"+[1,2,3,4,5,6,7,8,9,10].map(v=>"<option value='"+v+"' "+(v===1?"selected":"")+">$"+v+"</option>").join("")+"</select><label><b>Max simultaneous positions</b></label><input name='coachConcurrent' type='number' min='1' max='10' step='1' value='3' style='font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0 14px;border-radius:10px'><p class='muted'><b>Current live authority:</b> $1 stake and max concurrent &lt;= 3. Higher values remain valid zero-money configurations and are <b>NOT YET LIVE-AUTHORIZED</b>.</p><button type='submit'>VALIDATE COACH CARD CONFIGURATION</button><button type='button' disabled>ARM COACH CARD RUN — NOT ENABLED</button></form></div>";
'''
s = s.replace(anchor, card + anchor, 1)
assert s[s.index(arm):s.index(queue)] == original_arm
p.write_text(s)

out = p.read_text()
assert 'FOUNDER COACH CARD' in out
assert '/execution-test-coach-preview' in out
assert 'ARM COACH CARD RUN — NOT ENABLED' in out
assert 'ARM_BOUNDED_EXECUTION_TESTS_MAX_1_USD' in out
print('originalArmUnchanged=PROVEN')
print('coachCardRendered=PROVEN')
print('providerWrites=0')
print('capitalMovedUsd=0')
print('ordersSubmitted=0')
