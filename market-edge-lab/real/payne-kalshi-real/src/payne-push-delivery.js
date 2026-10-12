// PAYNE-only Web Push adapter. Not imported by trading code.
// Caller injects KV, sendPushNotification/topicFromString and clock; no provider-order capability.
import {classifyPayneRealAlert} from './payne-push-alerts.js';
export const PAYNE_PUSH_PREFIX='payne-real:mobile-push:v1:';
const SUB=PAYNE_PUSH_PREFIX+'subscription';
const delivered=id=>PAYNE_PUSH_PREFIX+'delivered:'+encodeURIComponent(id);
const attempt=id=>PAYNE_PUSH_PREFIX+'attempt:'+encodeURIComponent(id);
const clean=str=>String(str??'').slice(0,256);
export function validPayneSubscription(sub){
  if(!sub||typeof sub.endpoint!=='string'||typeof sub.keys?.p256dh!=='string'||typeof sub.keys?.auth!=='string')return false;
  try{return new URL(sub.endpoint).protocol==='https:';}catch{return false;}
}
export async function enrollPaynePhone(kv,sub){
  if(!validPayneSubscription(sub))return {ok:false,reason:'INVALID_SUBSCRIPTION'};
  await kv.put(SUB,JSON.stringify({endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}}));
  return {ok:true};
}
export function payneServiceWorkerSource(){
  return 'self.addEventListener("push",event=>{let p={};try{p=event.data.json()}catch{};event.waitUntil(self.registration.showNotification(p.title||"NFE-OS PAYNE REAL",{body:p.body||"",tag:p.tag||undefined,data:{url:p.url||"/"}}))});self.addEventListener("notificationclick",event=>{event.notification.close();event.waitUntil(self.clients.openWindow((event.notification.data&&event.notification.data.url)||"/"))});';
}
export async function sendPaynePersistedAlert({kv,event,send,topic,publicKey,privateKey,subject,now=()=>new Date().toISOString(),maxRetries=2}){
  const alert=classifyPayneRealAlert(event);
  if(!alert)return {ok:false,reason:'NO_AUTHORITATIVE_ALERT'};
  if(await kv.get(delivered(alert.id)))return {ok:true,duplicateSuppressed:true};
  const raw=await kv.get(SUB);
  let subscription;try{subscription=JSON.parse(raw);}catch{return {ok:false,reason:'NOT_ENROLLED'};}
  if(!validPayneSubscription(subscription))return {ok:false,reason:'NOT_ENROLLED'};
  if(!publicKey||!privateKey)return {ok:false,reason:'VAPID_NOT_CONFIGURED'};
  let last='SEND_FAILED';
  for(let i=0;i<=maxRetries;i++){
    try{
      const ack=await send(subscription,{title:alert.title,body:alert.body,url:'/',tag:alert.id},
        {publicKey,privateKey,subject},{ttl:300,urgency:'high',topic:await topic(alert.id),timeoutMs:8000});
      if(ack){
        await kv.put(delivered(alert.id),JSON.stringify({at:now(),category:alert.category}));
        await kv.put(attempt(alert.id),JSON.stringify({attempts:i+1,delivered:true,at:now()}));
        return {ok:true,delivered:true,attempts:i+1};
      }
      last='PUSH_ENDPOINT_REJECTED';break;
    }catch(e){last=clean(e?.message||'SEND_FAILED');}
  }
  await kv.put(attempt(alert.id),JSON.stringify({attempts:maxRetries+1,delivered:false,reason:last,at:now()}));
  return {ok:false,reason:last};
}
export const paynePushKeys=Object.freeze({subscription:SUB,delivered,attempt});
