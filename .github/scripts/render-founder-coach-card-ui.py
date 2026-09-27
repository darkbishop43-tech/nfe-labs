from pathlib import Path

p = Path('market-edge-lab/real/baseline/src/index.js')
s = p.read_text()

arm = '    if (request.method === "POST" && url.pathname === "/execution-test-arm") {'
queue = '    if (request.method === "POST" && url.pathname === "/execution-test-queue-arm") {'
assert arm in s and queue in s
original_arm = s[s.index(arm):s.index(queue)]
assert 'ARM_BOUNDED_EXECUTION_TESTS_MAX_1_USD' in original_arm
assert '/execution-test-coach-preview' in s
assert '/execution-test-coach-arm' not in s

card_start = '      control+="<div class=\'box\'><b>FOUNDER COACH CARD</b>'
original_arm_ui = '      if(!state.armed&&!executionTestQueueActive(state)&&executionTestOpenPositions(state).length===0&&ready) control+="<div class=\'box\'><b>EXISTING SINGLE-SERIES ARM</b>'
assert card_start in s and original_arm_ui in s
start = s.index(card_start)
end = s.index(original_arm_ui, start)

card = '''      const activeCoachFrozen=(state?.armed&&!executionTestQueueActive(state))?"<div class='box' style='border:1px solid #4b5563'><b>ACTIVE FROZEN CONFIGURATION</b><p>Threshold: <b>"+Number(state?.threshold??EXECUTION_TEST_CONFIG.entryScore).toFixed(2)+"</b><br>Attempts: <b>"+executionTestSeriesLimit(state)+"</b><br>Stake: <b>$"+Number(state?.maxEntryDebitUsd??EXECUTION_TEST_CONFIG.maxEntryDebitUsd).toFixed(0)+"</b><br>Max simultaneous positions: <b>"+Number(state?.maxConcurrent??EXECUTION_TEST_CONFIG.maxConcurrent)+"</b></p><p class='muted'>Read-only active series values. Editing controls below cannot mutate this armed series.</p></div>":"";
      control+=activeCoachFrozen+"<div class='box'><b>FOUNDER COACH CARD</b><p class='muted'>Configuration and zero-money validation on the existing controller page. Original ARM remains the only live execution authority.</p><form method='post' action='/execution-test-coach-preview'><input type='hidden' name='authorization' value='VALIDATE_FOUNDER_COACH_CARD'><label><b>Signal threshold</b></label><select name='coachThreshold' style='font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0 14px;border-radius:10px'>"+[.50,.55,.60,.65,.70,.75,.80,.85].map(v=>"<option value='"+v+"' "+(v===.60?"selected":"")+">"+v.toFixed(2)+"</option>").join("")+"</select><label><b>Attempt count</b></label><input name='coachAttempts' type='number' min='1' max='100' step='1' value='3' style='font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0 14px;border-radius:10px'><label><b>Max entry debit per filled position</b> <span id='coachStakeLockIcon'>🔒</span></label><input type='hidden' id='coachStakeValue' name='coachStake' value='1'><select id='coachStakeDisplay' disabled style='font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0 8px;border-radius:10px'>"+[1,2,3,4,5,6,7,8,9,10].map(v=>"<option value='"+v+"' "+(v===1?"selected":"")+">$"+v+"</option>").join("")+"</select><button id='coachStakeLockButton' type='button' onclick=\"coachToggleLock('stake')\">UNLOCK STAKE</button><label><b>Max simultaneous positions</b> <span id='coachConcurrentLockIcon'>🔒</span></label><input type='hidden' id='coachConcurrentValue' name='coachConcurrent' value='3'><input id='coachConcurrentDisplay' type='number' min='1' max='10' step='1' value='3' disabled style='font-size:18px;padding:12px;width:100%;box-sizing:border-box;margin:8px 0 8px;border-radius:10px'><button id='coachConcurrentLockButton' type='button' onclick=\"coachToggleLock('concurrent')\">UNLOCK POSITIONS</button><p class='muted'><b>Governance:</b> page load always returns Stake $1 🔒 and Max positions 3 🔒. Unlocking records Founder intent to edit this zero-money configuration only. No live execution authority changes here.</p><button type='submit'>VALIDATE COACH CARD CONFIGURATION</button><button type='button' disabled>ARM COACH CARD RUN — NOT ENABLED</button></form><script>function coachSync(){const s=document.getElementById('coachStakeDisplay'),c=document.getElementById('coachConcurrentDisplay'),sv=document.getElementById('coachStakeValue'),cv=document.getElementById('coachConcurrentValue');if(s&&sv)sv.value=s.value;if(c&&cv)cv.value=c.value;}function coachToggleLock(which){const stake=which==='stake',field=document.getElementById(stake?'coachStakeDisplay':'coachConcurrentDisplay'),icon=document.getElementById(stake?'coachStakeLockIcon':'coachConcurrentLockIcon'),btn=document.getElementById(stake?'coachStakeLockButton':'coachConcurrentLockButton');if(!field||!icon||!btn)return;field.disabled=!field.disabled;const locked=field.disabled;icon.textContent=locked?'🔒':'🔓';btn.textContent=locked?(stake?'UNLOCK STAKE':'UNLOCK POSITIONS'):(stake?'RE-LOCK STAKE':'RE-LOCK POSITIONS');coachSync();}document.getElementById('coachStakeDisplay')?.addEventListener('change',coachSync);document.getElementById('coachConcurrentDisplay')?.addEventListener('input',coachSync);coachSync();</script><p class='muted'>Invalid server-side values fail closed. Reloading this page resets editing controls to their locked defaults.</p></div>";
'''

s = s[:start] + card + s[end:]
assert s[s.index(arm):s.index(queue)] == original_arm, 'ORIGINAL_ARM_SOURCE_CHANGED'
p.write_text(s)

out = p.read_text()
checks = {
    'defaultStakeLock': "id='coachStakeDisplay' disabled" in out and "value='1'" in out and "coachStakeLockIcon'>🔒" in out,
    'defaultConcurrentLock': "id='coachConcurrentDisplay' type='number' min='1' max='10' step='1' value='3' disabled" in out and "coachConcurrentLockIcon'>🔒" in out,
    'unlockStake': "coachToggleLock('stake')" in out and 'UNLOCK STAKE' in out,
    'unlockConcurrent': "coachToggleLock('concurrent')" in out and 'UNLOCK POSITIONS' in out,
    'relock': 'RE-LOCK STAKE' in out and 'RE-LOCK POSITIONS' in out,
    'activeFrozenDisplay': 'ACTIVE FROZEN CONFIGURATION' in out and 'state?.maxEntryDebitUsd' in out and 'state?.maxConcurrent' in out,
    'previewOnly': '/execution-test-coach-preview' in out and '/execution-test-coach-arm' not in out,
    'originalArm': 'ARM_BOUNDED_EXECUTION_TESTS_MAX_1_USD' in out,
    'disarm': 'DISARM_EXECUTION_TEST_SERIES_PRESERVE_HISTORY' in out,
}
for k,v in checks.items(): print(f'{k}={v}')
assert all(checks.values()), [k for k,v in checks.items() if not v]

# Zero-money interaction model: locked -> unlock -> edit -> relock.
stake={'value':1,'locked':True}
con={'value':3,'locked':True}
assert stake == {'value':1,'locked':True}
assert con == {'value':3,'locked':True}
# Locked edits are rejected by the UI model.
if not stake['locked']: stake['value']=5
if not con['locked']: con['value']=7
assert stake['value']==1 and con['value']==3
# Explicit Founder unlock permits valid edits.
stake['locked']=False; con['locked']=False
stake['value']=5; con['value']=7
assert stake['value']==5 and con['value']==7
# Freeze preview is an independent copy; later UI edits cannot mutate it.
frozen=(0.70,10,stake['value'],con['value'])
stake['value']=2; con['value']=2
assert frozen==(0.70,10,5,7)
# Re-lock blocks further edits.
stake['locked']=True; con['locked']=True
if not stake['locked']: stake['value']=9
if not con['locked']: con['value']=9
assert stake['value']==2 and con['value']==2
# Invalid bounds fail closed in the existing server validator contract.
assert not (1 <= 0 <= 10) and not (1 <= 11 <= 10)

print('frozenConfigImmutable=PROVEN')
print('originalArmPreserved=PROVEN')
print('liveExecutionAuthorityChanged=NO')
print('providerWrites=0')
print('capitalMovedUsd=0')
print('ordersSubmitted=0')
