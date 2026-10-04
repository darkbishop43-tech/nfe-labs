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

const si=data.siCryptoV0;
if(!si)throw new Error('SI Crypto V0 state missing');
const expected={M:0.30,T:0.20,V:0.15,Q:0.10,F:0.15,N:0.10};
for(const [k,v] of Object.entries(expected)){if(si.weights[k]!==v)throw new Error('SI weight mismatch '+k)}
if(si.composite.score!==null)throw new Error('Composite score must remain null while component inputs/rules are incomplete');
if(si.qualificationThreshold!==null)throw new Error('Unapproved SI qualification threshold found');
if(si.firstTest.proposedEntry.dollarAmount!=='FOUNDER SELECTS')throw new Error('Unapproved fixed stake found');
if(si.live.state!=='DISARMED / FIRE BLOCKED')throw new Error('Live lane unexpectedly executable');
console.log('PASS SI Crypto V0 authorized weights');
console.log('PASS no unapproved stake or qualification threshold');
console.log('PASS incomplete SI score blocks FIRE');

const v0a=data.siCryptoV0A;
if(!v0a)throw new Error('SI Crypto V0-A state missing');
if(v0a.scores.SI_CORE_V0A!==null)throw new Error('V0-A core score must remain null without required historical inputs');
if(v0a.scores.fullSI!==null)throw new Error('V0-A full score must remain null while N is invalid');
if(v0a.robinhoodOfficialApi.historicalOHLCV!==false)throw new Error('Official API OHLCV proof mismatch');
if(v0a.robinhoodOfficialApi.secretCreated!==false)throw new Error('Unexpected Robinhood API secret creation');
const binance=v0a.thirdPartyCandidates.find(x=>x.name.startsWith('Binance.US'));
if(!binance||!/APPROVED \+ CONNECTED/.test(binance.status))throw new Error('Approved Binance.US public source not represented');
if(v0a.binanceUsPublicData?.credential!=='NONE')throw new Error('Unexpected Binance.US credential');
if(v0a.binanceUsPublicData?.executionAuthority!=='NONE')throw new Error('Unexpected Binance.US execution authority');
if(v0a.binanceUsPublicData?.sample?.Q!==null)throw new Error('Q must remain null before historical spread collection');
console.log('PASS SI Crypto V0-A governed hold');
console.log('PASS official Robinhood API data gap truth');
console.log('PASS Binance.US public research source only');
