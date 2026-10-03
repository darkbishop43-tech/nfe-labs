import fs from 'node:fs';
const files=['index.html','app.js','styles.css','data/snapshot.json'];
const text=files.map(f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8')).join('\n');
const forbidden=[
  'place_equity_order','place_crypto_order','place_option_order','cancel_equity_order','cancel_crypto_order','cancel_option_order',
  'review_equity_order','review_option_order','preview_crypto_order','exercise_option','cancel_option_exercise',
  'create_watchlist','update_watchlist','add_to_watchlist','remove_from_watchlist','create_alert','update_alert','delete_alert','create_scan','update_scan_filters','update_scan_config'
];
for(const x of forbidden){if(text.includes(x))throw new Error(`Forbidden executable/tool token found: ${x}`)}
if(/account_number|rhs_account_number|rhc_account_number/i.test(text))throw new Error('Raw account-number field found');
for(const raw of ['616512430','979132115','683386064','631563756','311153622394','311264326026','311267414142']){if(text.includes(raw))throw new Error('Known unmasked account identifier found')}
const data=JSON.parse(fs.readFileSync(new URL('../data/snapshot.json',import.meta.url),'utf8'));
if(data.meta.mode!=='SNAPSHOT'||data.meta.readOnly!==true)throw new Error('Snapshot/read-only labeling failed');
for(const a of data.existingOptions.accountsChecked){if(!/^••••\d{4}$/.test(a))throw new Error('Unsafe account mask')}
if(data.account.maskedId!=='••••3756')throw new Error('Agentic mask mismatch');
console.log('PASS read-only firewall');
console.log('PASS no order/preview/cancel/transfer/exercise mutation tokens');
console.log('PASS safe account masking');
console.log('PASS snapshot labeling');
