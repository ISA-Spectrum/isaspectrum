import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { onRequestPut as saveProfile } from '../functions/api/profile.js';
const source = await readFile(new URL('../messages.html', import.meta.url), 'utf8');
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const good=`https://db.example/storage/v1/object/public/avatars/business/${uid}.${'a'.repeat(64)}.png`;
test('profile refuses untrusted, decorated or non-content-addressed avatar URLs', async () => {
  const env={AUTH_ISSUER:'https://auth.example',AUTH_CLIENT_ID:'client',AUTH_REDIRECT_URI:'https://site.example/auth/callback',BUSINESS_SUPABASE_URL:'https://db.example',BUSINESS_SUPABASE_PUBLISHABLE_KEY:'public',AUTH_DB:{prepare(){return {bind(){return {first:async()=>({user_id:uid,last_seen_at:new Date().toISOString()})}}}}}};
  for (const avatarUrl of [good+'?v=1',good+'#fragment',good.replace('https://','https://user:password@'),good.replace('db.example','evil.example'),good.replace(uid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),good.replace('a'.repeat(64),'fake')]) {
    const response=await saveProfile({request:new Request('https://site.example/api/profile',{method:'PUT',headers:{Origin:'https://site.example',Cookie:'__Secure-business_session=test'},body:JSON.stringify({avatarUrl})}),env});
    assert.equal(response.status,400);
  }
});
test('the page uploads the editor File unchanged and only retries profile persistence', async () => {
  const start=source.indexOf('        const pendingAvatarUploads =');
  const code=source.slice(start,source.indexOf('        async function renderMessageAvatars',start));
  const file=new File(['encoded-output'],'isa-avatar-256.png',{type:'image/png'}), calls=[];
  const avatarImg={style:{}},avatarPlaceholder={style:{}};
  const context=vm.createContext({
    WeakMap,FormData,avatarImg,avatarPlaceholder,Error,
    request:async(path,options)=>{
      calls.push({path,options});
      if(path==='/api/uploads'){
        const sent=options.body.get('files');assert.equal(await sent.text(),await file.text());assert.equal(sent.name,file.name);assert.equal(sent.type,file.type);
        return Response.json({urls:[good]},{status:201});
      }
      return calls.length===2 ? new Response('',{status:503}) : Response.json({avatarUrl:good});
    }
  });
  vm.runInContext(code+'\nglobalThis.save=uploadAvatar;',context);
  await assert.rejects(context.save(file),/保存失败/);
  await context.save(file);
  assert.deepEqual(calls.map(call=>call.path),['/api/uploads','/api/profile','/api/profile']);
  assert.equal(avatarImg.src,good);
});
