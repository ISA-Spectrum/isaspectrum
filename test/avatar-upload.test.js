import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as upload } from '../functions/api/uploads.js';
import { onRequestPut as saveProfile } from '../functions/api/profile.js';

test('avatar uploads use distinct objects and a failed profile update preserves the old object', async t => {
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);jwk.kid='test-key';
  const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const env={AUTH_ISSUER:'https://auth.example.com',AUTH_CLIENT_ID:'client',AUTH_REDIRECT_URI:'https://site.example/auth/callback',BUSINESS_SUPABASE_URL:'https://db.example',BUSINESS_SUPABASE_PUBLISHABLE_KEY:'public',BUSINESS_SUPABASE_SIGNING_JWK:JSON.stringify(jwk),AUTH_DB:{prepare(){return {bind(){return {first:async()=>({user_id:uid,identity_provider:'https://auth.example.com',identity_subject:'user',last_seen_at:new Date().toISOString(),absolute_expires_at:new Date(Date.now()+3600000).toISOString()})}}}}}};
  const objects=new Map([['business/'+uid+'.webp','old-avatar']]);let storedProfile='https://db.example/storage/v1/object/public/avatars/business/'+uid+'.webp';
  const original=globalThis.fetch;
  globalThis.fetch=async (url,init)=>{
    const u=new URL(url);
    if(u.pathname.startsWith('/storage/v1/object/avatars/')){
      const key=u.pathname.split('/avatars/')[1]; assert.equal(init.headers['x-upsert'],'false');
      if(objects.has(key))return new Response('',{status:409}); objects.set(key,await init.body.text());return new Response('',{status:200});
    }
    if(u.pathname==='/rest/v1/business_users') return new Response('unavailable',{status:503});
    throw Error('unexpected request');
  };t.after(()=>{globalThis.fetch=original;});
  const headers={Origin:'https://site.example',Cookie:'__Host-business_session=mock-session'};
  async function newUpload(){const form=new FormData();form.append('kind','avatar');form.append('files',new File(['new-avatar'],'avatar.webp',{type:'image/webp'}));const res=await upload({request:new Request('https://site.example/api/uploads',{method:'POST',headers,body:form}),env});assert.equal(res.status,201);return (await res.json()).urls[0];}
  const first=await newUpload(),second=await newUpload();assert.notEqual(first,second);
  const saved=await saveProfile({request:new Request('https://site.example/api/profile',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({avatarUrl:first})}),env});
  assert.equal(saved.status,503);assert.equal(storedProfile,'https://db.example/storage/v1/object/public/avatars/business/'+uid+'.webp');assert.equal(objects.get('business/'+uid+'.webp'),'old-avatar');
  assert.equal(objects.size,3);
});
