import {sendPushNotification,topicFromString} from '@mmmike/web-push/send';
import {classifyPayneRealAlert} from '../../src/payne-push-alerts.js';

// This standalone worker has no PAYNE trading binding or credentials.
// Subscription + deduplication state lives exclusively in this Durable Object.
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const endpoint=env=>env.PUSH_STATE.get(env.PUSH_STATE.idFromName('payne-real-phone'));
export function validateLedger(doc){
  return doc?.ok===true && doc?.schema==='PAYNE_REAL_LEDGER_EXPORT_V1' &&
    doc?.readOnly===true && doc?.providerWrites===0 &&
    doc?.ordersSubmittedByThisRead===0 && doc?.capitalMovedUsd===0 &&
    Array.isArray(doc.rows);
}
export function buildAlerts(doc){
  if(!validateLedger(doc))throw new Error('PAYNE_LEDGER_NOT_AUTHORITATIVE');
  return doc.rows.map(classifyPayneRealAlert).filter(Boolean);
}
export class PaynePushState {
  constructor(state,env){this.state=state;this.env=env;this.sender=env?.__testSender||sendPushNotification;}
  async fetch(req){
    const u=new URL(req.url);
    if(u.pathname==='/status')return json({ok:true,enrolled:Boolean(await this.state.storage.get('subscription'))});
    if(u.pathname==='/enroll' && req.method==='POST'){
      const s=await req.json().catch(()=>null);
      if(!s||typeof s.endpoint!=='string'||typeof s.keys?.p256dh!=='string'||typeof s.keys?.auth!=='string')return json({ok:false,error:'INVALID_SUBSCRIPTION'},400);
      try{if(new URL(s.endpoint).protocol!=='https:')throw Error();}catch{return json({ok:false,error:'INVALID_ENDPOINT'},400);}
      await this.state.storage.put('subscription',{endpoint:s.endpoint,keys:{auth:s.keys.auth,p256dh:s.keys.p256dh}});
      return json({ok:true});
    }
    if(u.pathname==='/dispatch' && req.method==='POST'){
      const alerts=await req.json().catch(()=>null);
      if(!Array.isArray(alerts))return json({ok:false,error:'INVALID_ALERTS'},400);
      const sub=await this.state.storage.get('subscription');
      if(!sub)return json({ok:false,reason:'NO_PHONE_ENROLLED'});
      if(!this.env.NFE_PUSH_VAPID_PUBLIC_KEY||!this.env.NFE_PUSH_VAPID_PRIVATE_KEY)return json({ok:false,reason:'VAPID_NOT_CONFIGURED'},503);
      let delivered=0,skipped=0,failed=0;
      for(const alert of alerts){
        if(!alert?.id||alert?.source!=='PAYNE_REAL_PERSISTED_LEDGER')continue;
        const key='event:'+alert.id;
        // Durable Objects serialize storage transactions for competing cron requests.
        // Claim before sending: an uncertain sender result is quarantined rather than
        // resent automatically, preventing duplicate trade alerts.
        const claimed=await this.state.storage.transaction(async txn=>{
          if(await txn.get(key))return false;
          await txn.put(key,{state:'CLAIMED',at:new Date().toISOString()});
          return true;
        });
        if(!claimed){skipped++;continue;}
        try{
          const accepted=await this.sender(sub,{
            title:alert.title,body:alert.body,url:this.env.PAYNE_COCKPIT_URL,tag:alert.id
          },{
            publicKey:this.env.NFE_PUSH_VAPID_PUBLIC_KEY,
            privateKey:this.env.NFE_PUSH_VAPID_PRIVATE_KEY,
            subject:'https://github.com/darkbishop43-tech/nfe-labs'
          },{ttl:300,urgency:'high',topic:await topicFromString(alert.id),timeoutMs:8000});
          await this.state.storage.put(key,{state:accepted?'PUSH_SERVICE_ACCEPTED':'REJECTED',at:new Date().toISOString()});
          if(accepted)delivered++;else failed++;
        }catch(error){
          failed++;
          await this.state.storage.put(key,{state:'DELIVERY_UNKNOWN_NO_AUTO_RETRY',at:new Date().toISOString(),reason:String(error?.message||error).slice(0,120)});
        }
      }
      return json({ok:true,pushServiceAccepted:delivered,duplicateSuppressed:skipped,failed,phoneDisplayConfirmed:false});
    }
    return json({ok:false,error:'NOT_FOUND'},404);
  }
}
const sw=`self.addEventListener('push',event=>{let p={};try{p=event.data.json()}catch{};event.waitUntil(self.registration.showNotification(p.title||'NFE-OS PAYNE REAL',{body:p.body||'',tag:p.tag||undefined,data:{url:p.url||'/'}}))});self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.openWindow(event.notification.data?.url||'/'))});`;
const page=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>PAYNE REAL mobile alerts</title><h2>PAYNE REAL · MOBILE FISH ALERTS</h2><p>Notification-only. Your trading controls are unchanged.</p><button id="enroll">ENABLE NFE-OS NOTIFICATIONS</button><p id="status">NOT ENROLLED</p><script>
const keyBytes=k=>Uint8Array.from(atob(k.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
document.querySelector('#enroll').onclick=async()=>{
 try{
  const cfg=await(await fetch('/push-config')).json();
  if(!cfg.publicKey)throw Error('Push public key not configured');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw Error('Permission not granted');
  const reg=await navigator.serviceWorker.register('/push-sw.js');
  let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(cfg.publicKey)});
  const r=await fetch('/push-enroll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sub)});
  if(!r.ok)throw Error('Enrollment failed');
  document.querySelector('#status').textContent='PAYNE PHONE ENROLLED';
 }catch(e){document.querySelector('#status').textContent=String(e.message||e)}
};
</script>`;
export default {
  async fetch(req,env){
    const u=new URL(req.url);
    if(req.method==='GET'&&u.pathname==='/')return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    if(req.method==='GET'&&u.pathname==='/push-sw.js')return new Response(sw,{headers:{'content-type':'application/javascript','service-worker-allowed':'/'}});
    if(req.method==='GET'&&u.pathname==='/push-config')return json({publicKey:env.NFE_PUSH_VAPID_PUBLIC_KEY||null});
    if(req.method==='GET'&&u.pathname==='/push-status')return endpoint(env).fetch('https://internal/status');
    if(req.method==='POST'&&u.pathname==='/push-enroll')return endpoint(env).fetch(new Request('https://internal/enroll',{method:'POST',body:req.body,headers:{'content-type':'application/json'}}));
    return json({ok:false,error:'NOT_FOUND'},404);
  },
  async scheduled(controller,env){
    try{
      const response=await fetch(env.PAYNE_EVIDENCE_URL,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
      if(!response.ok)return;
      const doc=await response.json();
      const alerts=buildAlerts(doc);
      if(alerts.length)await endpoint(env).fetch(new Request('https://internal/dispatch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(alerts)}));
    }catch{ /* isolated notification failures never affect PAYNE trading */ }
  }
};
