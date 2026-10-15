import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../founder-terminal.html',import.meta.url),'utf8');
const marker='<div id="nfeExchangeMaintenance"';
const at=html.indexOf(marker);
if(at<0)throw Error('MAINTENANCE_NOTICE_MISSING');
const start=html.indexOf('<script>',at),end=html.indexOf('</script>',start);
if(start<0||end<0)throw Error('MAINTENANCE_SCRIPT_MISSING');
const code=html.slice(start+8,end);
function display(instant){
 const el={textContent:''};
 class ClockDate extends Date {static now(){return Date.parse(instant);}}
 vm.runInNewContext(code,{document:{getElementById:()=>el},Intl,Date:ClockDate,Math,setInterval:()=>0});
 return el.textContent;
}
for(const [name,stamp,expected] of [
 ['EDT 2:59','2026-10-15T06:59:00Z','NEXT EXCHANGE MAINTENANCE'],
 ['EDT 3:00','2026-10-15T07:00:00Z','SCHEDULED EXCHANGE MAINTENANCE'],
 ['EDT 4:59','2026-10-15T08:59:00Z','SCHEDULED EXCHANGE MAINTENANCE'],
 ['EDT 5:00','2026-10-15T09:00:00Z','NEXT EXCHANGE MAINTENANCE'],
 ['EST 2:59','2026-01-08T07:59:00Z','NEXT EXCHANGE MAINTENANCE'],
 ['EST 3:00','2026-01-08T08:00:00Z','SCHEDULED EXCHANGE MAINTENANCE'],
 ['EST 4:59','2026-01-08T09:59:00Z','SCHEDULED EXCHANGE MAINTENANCE'],
 ['EST 5:00','2026-01-08T10:00:00Z','NEXT EXCHANGE MAINTENANCE'],
 ['summer EDT 3:00','2026-07-09T07:00:00Z','SCHEDULED EXCHANGE MAINTENANCE']
]){
 test(name,()=>{const v=display(stamp);assert.ok(v.startsWith(expected),v);assert.match(v,/5:00 AM ET|3:00–5:00 AM ET/);});
}
test('no trading controls or provider claims in schedule script',()=>{
 assert.doesNotMatch(code,/fetch\(|POST|armed\s*=|disarm\(|orderSubmit|providerWrites/i);
});
