import test from 'node:test';import assert from 'node:assert/strict';import {cockpitHtml} from '../src/cockpit-html.js';
const html=cockpitHtml();
test('top three graphs near controls before exports and audit',()=>{const p=html.indexOf('id="payneStaircaseShadow"');assert.ok(p>html.indexOf('FOUNDER CONTROLS'));assert.ok(p<html.indexOf('DATA EXPORT'));});
test('three responsive small graph slots and truthful insufficient state',()=>{assert.match(html,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);assert.match(html,/height:88px/);assert.match(html,/INSUFFICIENT OBSERVATIONS/);});
test('browser requests only new research route every ten seconds',()=>{assert.match(html,/fetch\('\/shadow-staircase\/top3-v2'/);assert.match(html,/setInterval\(poll,10000\)/);});
test('research read response cannot invoke trading',()=>{assert.doesNotMatch(html.slice(html.indexOf('id="payneStaircaseShadow"'),html.indexOf('DATA EXPORT')),/fetch\('\/control|\/order|\/fire/);});
