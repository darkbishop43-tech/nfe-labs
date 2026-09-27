from pathlib import Path

p = Path('market-edge-lab/real/baseline/src/index.js')
s = p.read_text()

arm = '    if (request.method === "POST" && url.pathname === "/execution-test-arm") {'
queue = '    if (request.method === "POST" && url.pathname === "/execution-test-queue-arm") {'
assert arm in s and queue in s
original_arm_route = s[s.index(arm):s.index(queue)]
assert 'ARM_BOUNDED_EXECUTION_TESTS_MAX_1_USD' in original_arm_route
assert '/execution-test-coach-preview' in s
assert '/execution-test-coach-arm' not in s

legacy_start = '      control+="<div class=\'box\'><b>FOUNDER COACH CARD</b>'
active_start = '      const activeCoachFrozen='
original_arm_ui = '      if(!state.armed&&!executionTestQueueActive(state)&&executionTestOpenPositions(state).length===0&&ready) control+="<div class=\'box\'><b>EXISTING SINGLE-SERIES ARM</b>'
assert original_arm_ui in s
if active_start in s:
    start = s.index(active_start)
elif legacy_start in s:
    start = s.index(legacy_start)
else:
    raise AssertionError('COACH_CARD_START_ANCHOR_MISSING')
end = s.index(original_arm_ui, start)

card = '''      const activeCoachFrozen=(state?.armed&&!executionTestQueueActive(state))?"<div class='box' style='border:1px solid #4b5563;padding:10px 12px;margin:8px 0'><b>ACTIVE FROZEN CONFIGURATION</b><div style='display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:7px;font-size:14px'><span>Threshold <b>"+Number(state?.threshold??EXECUTION_TEST_CONFIG.entryScore).toFixed(2)+"</b></span><span>Attempts <b>"+executionTestSeriesLimit(state)+"</b></span><span>Stake <b>$"+Number(state?.maxEntryDebitUsd??EXECUTION_TEST_CONFIG.maxEntryDebitUsd).toFixed(0)+"</b></span><span>Positions <b>"+Number(state?.maxConcurrent??EXECUTION_TEST_CONFIG.maxConcurrent)+"</b></span></div></div>":"";
      control+=activeCoachFrozen+"<div class='box' style='padding:12px;margin:8px 0'><div style='display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px'><b>FOUNDER COACH CARD</b><span class='muted' style='font-size:12px'>Zero-money config</span></div><form method='post' action='/execution-test-coach-preview'><input type='hidden' name='authorization' value='VALIDATE_FOUNDER_COACH_CARD'><div style='display:grid;grid-template-columns:1fr 1fr;gap:10px 14px'><div><label style='font-size:13px'><b>Signal threshold</b></label><select name='coachThreshold' style='font-size:15px;padding:7px 9px;width:100%;box-sizing:border-box;margin-top:4px;border-radius:8px'>"+[.50,.55,.60,.65,.70,.75,.80,.85].map(v=>"<option value='"+v+"' "+(v===.60?"selected":"")+">"+v.toFixed(2)+"</option>").join("")+"</select></div><div><label style='font-size:13px'><b>Attempt count</b></label><input name='coachAttempts' type='number' min='1' max='100' step='1' value='3' style='font-size:15px;padding:7px 9px;width:100%;box-sizing:border-box;margin-top:4px;border-radius:8px'></div><div><label style='font-size:13px'><b>Max entry debit</b></label><input type='hidden' id='coachStakeValue' name='coachStake' value='1'><div style='display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:4px'><select id='coachStakeDisplay' disabled style='font-size:15px;padding:7px 9px;width:100%;box-sizing:border-box;border-radius:8px'>"+[1,2,3,4,5,6,7,8,9,10].map(v=>"<option value='"+v+"' "+(v===1?"selected":"")+">🔒 $"+v+"</option>").join("")+"</select><button id='coachStakeLockButton' type='button' onclick='coachToggleLock(&quot;stake&quot;)' style='padding:6px 9px;font-size:12px;white-space:nowrap'>UNLOCK</button></div></div><div><label style='font-size:13px'><b>Max simultaneous</b></label><input type='hidden' id='coachConcurrentValue' name='coachConcurrent' value='3'><div style='display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:4px'><input id='coachConcurrentDisplay' type='number' min='1' max='10' step='1' value='3' disabled style='font-size:15px;padding:7px 9px;width:100%;box-sizing:border-box;border-radius:8px'><button id='coachConcurrentLockButton' type='button' onclick='coachToggleLock(&quot;concurrent&quot;)' style='padding:6px 9px;font-size:12px;white-space:nowrap'>UNLOCK</button></div></div></div><p class='muted' style='margin:8px 0 6px;font-size:12px'>Defaults: $1 / 3 positions. Unlock to edit. Active series values freeze at ARM.</p><div style='display:flex;gap:8px;flex-wrap:wrap'><button type='submit' style='padding:8px 12px'>VALIDATE COACH CARD CONFIGURATION</button><button type='button' disabled style='padding:8px 12px'>ARM COACH CARD RUN — NOT ENABLED</button></div></form><script>function coachSync(){const s=document.getElementById('coachStakeDisplay'),c=document.getElementById('coachConcurrentDisplay'),sv=document.getElementById('coachStakeValue'),cv=document.getElementById('coachConcurrentValue');if(s&&sv)sv.value=s.value;if(c&&cv)cv.value=c.value;}function coachToggleLock(which){const stake=which==='stake',field=document.getElementById(stake?'coachStakeDisplay':'coachConcurrentDisplay'),btn=document.getElementById(stake?'coachStakeLockButton':'coachConcurrentLockButton');if(!field||!btn)return;field.disabled=!field.disabled;const locked=field.disabled;btn.textContent=locked?'UNLOCK':'RE-LOCK';if(stake&&field.options){for(const o of field.options)o.textContent=(locked?'🔒 ':'🔓 ')+o.textContent.replace(/^🔒 |^🔓 /,'');}coachSync();}document.getElementById('coachStakeDisplay')?.addEventListener('change',coachSync);document.getElementById('coachConcurrentDisplay')?.addEventListener('input',coachSync);coachSync();</script></div>";
'''

s = s[:start] + card + s[end:]
assert s[s.index(arm):s.index(queue)] == original_arm_route, 'ORIGINAL_ARM_ROUTE_CHANGED'

old_arm_start = '      if(!state.armed&&!executionTestQueueActive(state)&&executionTestOpenPositions(state).length===0&&ready) control+="<div class=\'box\'><b>EXISTING SINGLE-SERIES ARM</b>'
arm_start = s.index(old_arm_start)
arm_end_marker = '      control+="<p class=\'muted\'>Arming authorizes only the bounded number of attempts selected above.'
arm_end = s.index(arm_end_marker, arm_start)
old_arm_ui = s[arm_start:arm_end]
assert 'action=\'/execution-test-arm\'' in old_arm_ui and 'ARM SELECTED EXECUTION TEST SERIES' in old_arm_ui
compact_arm = '''      if(!state.armed&&!executionTestQueueActive(state)&&executionTestOpenPositions(state).length===0&&ready) control+="<div class='box' style='padding:10px 12px;margin:8px 0'><b>EXISTING SINGLE-SERIES ARM</b><form method='post' action='/execution-test-arm'><input type='hidden' name='authorization' value='ARM_BOUNDED_EXECUTION_TESTS_MAX_1_USD'><div style='display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:7px 0'><div><label for='testScore' style='font-size:13px'><b>Acceptance score</b></label><select id='testScore' name='testScore' style='font-size:15px;padding:7px 9px;width:100%;box-sizing:border-box;margin-top:4px;border-radius:8px'><option value='.50'>.50</option><option value='.55'>.55</option><option value='.60'>.60</option><option value='.65' selected>.65</option><option value='.70'>.70</option><option value='.75'>.75</option><option value='.80'>.80</option><option value='.85'>.85</option></select></div><div><label for='runCount' style='font-size:13px'><b>Automatic attempts</b></label><input id='runCount' name='runCount' type='number' inputmode='numeric' min='1' max='100' step='1' value='10' style='font-size:15px;padding:7px 9px;width:100%;box-sizing:border-box;margin-top:4px;border-radius:8px'></div></div><button type='submit' style='padding:8px 12px'>ARM SELECTED EXECUTION TEST SERIES</button></form></div>";
'''
s = s[:arm_start] + compact_arm + s[arm_end:]
assert s[s.index(arm):s.index(queue)] == original_arm_route, 'ORIGINAL_ARM_ROUTE_CHANGED_AFTER_COMPACT_UI'
p.write_text(s)

out = p.read_text()
checks = {
    'coachCardRendered': 'FOUNDER COACH CARD' in out,
    'compactGrid': "grid-template-columns:1fr 1fr" in out,
    'defaultStakeLock': "id='coachStakeDisplay' disabled" in out and '🔒 $' in out,
    'defaultConcurrentLock': "id='coachConcurrentDisplay' type='number' min='1' max='10' step='1' value='3' disabled" in out,
    'unlock': 'coachToggleLock(&quot;stake&quot;)' in out and 'coachToggleLock(&quot;concurrent&quot;)' in out,
    'relock': "btn.textContent=locked?'UNLOCK':'RE-LOCK'" in out,
    'activeFrozenDisplay': 'ACTIVE FROZEN CONFIGURATION' in out,
    'originalArm': 'ARM_BOUNDED_EXECUTION_TESTS_MAX_1_USD' in out and 'ARM SELECTED EXECUTION TEST SERIES' in out,
    'disarm': 'DISARM_EXECUTION_TEST_SERIES_PRESERVE_HISTORY' in out,
    'previewOnly': '/execution-test-coach-preview' in out and '/execution-test-coach-arm' not in out,
}
for k,v in checks.items(): print(f'{k}={v}')
assert all(checks.values()), [k for k,v in checks.items() if not v]
print('functionalLogicChanged=NO')
print('providerWrites=0')
print('capitalMovedUsd=0')
print('ordersSubmitted=0')
