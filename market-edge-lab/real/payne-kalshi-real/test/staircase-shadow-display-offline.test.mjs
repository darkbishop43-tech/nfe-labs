import test from 'node:test';import assert from 'node:assert/strict';import {cockpitHtml} from '../src/cockpit-html.js';
const html=cockpitHtml();
test('phone-friendly staircase exists with all required fields',()=>{
 for(const term of ['DYNAMIC STAIRCASE','Entry price','Highest verified exit bid','Proposed protected level','Market phase','Original PAYNE decision','Shadow HOLD / EXIT','Last observation']) assert.ok(html.includes(term),term);
});
test('scorecard uses only GET and persists no mutable stop or authority',()=>{
 const code=html.slice(html.indexOf('<section class="card" id="payneStaircaseShadow"'),html.indexOf('</script>',html.indexOf('id="payneStaircaseShadow"'))+9);
 assert.match(code,/fetch\('\/real-state'/);
 assert.match(code,/setInterval\(draw,10000\)/);
 assert.doesNotMatch(code,/fetch\([^\n]+method:\s*['"]POST|ARM|DISARM|orderSubmit|kv\.put/);
});
test('unknown when evidence not verified and bid cannot be fabricated',()=>{
 assert.ok(html.includes('verifiedExitBidObservations'));
 assert.ok(html.includes("x?.source==='KALSHI_PROVIDER_GET'"));
 assert.ok(html.includes('shadowProtectedLevelVerified===true'));
 assert.ok(html.includes('shadowEvidenceFresh===true'));
});
