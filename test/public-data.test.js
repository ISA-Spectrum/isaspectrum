import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { onRequestGet as listMessagesApi } from '../functions/api/messages.js';

const source = await readFile(new URL('../public-data.js', import.meta.url), 'utf8');

function loadClient(fetch) {
  const window = {};
  vm.runInNewContext(source, { window, fetch, URLSearchParams });
  return window.ISAPublicData;
}

test('public messages fall back to the same-origin API when direct Supabase access fails', async () => {
  const requests = [];
  const client = loadClient(async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).startsWith('https://')) return { ok: false };
    return {
      ok: true,
      async json() {
        return { messages: [{ id: 'message-1' }], hasMore: false, page: 2 };
      }
    };
  });

  const result = await client.listMessages({ page: 2, limit: 10, sort: 'oldest', zone: '学习互助', search: '数学' });

  assert.deepEqual(result, { messages: [{ id: 'message-1' }], hasMore: false, page: 2 });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /approved_messages_public/);
  assert.match(requests[1].url, /^\/api\/messages\?/);
  const fallback = new URL(`https://business.example${requests[1].url}`);
  assert.equal(fallback.searchParams.get('page'), '2');
  assert.equal(fallback.searchParams.get('limit'), '10');
  assert.equal(fallback.searchParams.get('sort'), 'oldest');
  assert.equal(fallback.searchParams.get('zone'), '学习互助');
  assert.equal(fallback.searchParams.get('search'), '数学');
  assert.equal(requests[1].init.credentials, 'same-origin');
});

test('thread reads also fall back to the safe same-origin API', async () => {
  const id = '5726b173-8f21-4aaf-b828-410635bfe6b8';
  const requests = [];
  const client = loadClient(async url => {
    requests.push(String(url));
    if (String(url).startsWith('https://')) throw new TypeError('blocked by network');
    return { ok: true, async json() { return { messages: [{ id }] }; } };
  });

  assert.deepEqual(Array.from(await client.getThread(id)), [{ id }]);
  assert.equal(requests.length, 2);
  assert.equal(new URL(`https://business.example${requests[1]}`).searchParams.get('thread'), id);
});


test('front end and API paginate a deep thread through the public recursive query', async t => {
  const id='5726b173-8f21-4aaf-b828-410635bfe6b8';
  const rows=Array.from({length:301},(_,i)=>({id:i===0?id:String(i),reply_to:i===0?null:String(i-1),created_at:'2026-01-01T00:00:00Z'}));
  const calls=[];
  const respond=input=>{
    const url=new URL(String(input));assert.equal(url.pathname,'/rest/v1/rpc/approved_message_thread');
    const p=url.searchParams;assert.equal(p.get('p_root_id'),id);assert.equal(p.get('order'),'created_at.asc,id.asc');
    const offset=Number(p.get('offset'));calls.push(offset);return rows.slice(offset,offset+Number(p.get('limit')));
  };
  const client=loadClient(async url=>({ok:true,json:async()=>respond(url)}));
  const direct=await client.getThread(id);assert.equal(direct.length,301);assert.deepEqual(calls,[0,100,200,300]);
  calls.length=0;const original=globalThis.fetch;globalThis.fetch=async url=>Response.json(respond(url));t.after(()=>{globalThis.fetch=original;});
  for (let page=0;page<4;page++) {
    const res=await listMessagesApi({request:new Request(`https://business.example/api/messages?thread=${id}&thread_page=${page}`),env:{BUSINESS_SUPABASE_URL:'https://business.supabase.co',BUSINESS_SUPABASE_PUBLISHABLE_KEY:'test'}});
    assert.equal(res.status,200);const result=await res.json();assert.equal(result.messages.length,page===3?1:100);assert.equal(result.hasMore,page<3);
  }
  assert.deepEqual(calls,[0,100,200,300]);
});

test('missing thread is empty for direct view and 404 in fallback API', async t => {
  const client=loadClient(async()=>({ok:true,json:async()=>[]}));assert.equal((await client.getThread('9999')).length,0);
  const old=globalThis.fetch;globalThis.fetch=async()=>Response.json([]);t.after(()=>{globalThis.fetch=old;});
  const res=await listMessagesApi({request:new Request('https://business.example/api/messages?thread=9999'),env:{BUSINESS_SUPABASE_URL:'https://business.supabase.co',BUSINESS_SUPABASE_PUBLISHABLE_KEY:'test'}});assert.equal(res.status,404);
});

test('a direct query failure retries the complete thread through the API', async () => {
  const calls=[];const client=loadClient(async url=>{calls.push(String(url));if(String(url).startsWith('/api/'))return {ok:true,json:async()=>({messages:[{id:'5'},{id:'6',reply_to:'5'}]})};throw Error('offline');});
  assert.deepEqual(Array.from(await client.getThread('5'), x=>x.id),['5','6']);assert.equal(calls.length,2);
});

test('fallback distinguishes a missing thread from an unavailable endpoint', async () => {
  const missing=loadClient(async url=>String(url).startsWith('https://') ? {ok:false} : {ok:false,status:404,json:async()=>({error:'not_found'})});
  assert.equal((await missing.getThread('5')).length,0);
  const offline=loadClient(async url=>String(url).startsWith('https://') ? {ok:false} : {ok:false,status:404,json:async()=>({error:'other'})});
  await assert.rejects(offline.getThread('5'),/public_data_unavailable/);
});

test('UUID input is normalized before both public and fallback queries', async t => {
  const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const row={id,reply_to:null};
  const client=loadClient(async url=>{assert.equal(new URL(String(url)).searchParams.get('p_root_id'),id);return {ok:true,json:async()=>[row]};});
  assert.equal((await client.getThread(id.toUpperCase()))[0].id,id);
  const old=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(new URL(String(url)).searchParams.get('p_root_id'),id);return Response.json([row]);};t.after(()=>{globalThis.fetch=old;});
  const res=await listMessagesApi({request:new Request(`https://business.example/api/messages?thread=${id.toUpperCase()}`),env:{BUSINESS_SUPABASE_URL:'https://business.supabase.co',BUSINESS_SUPABASE_PUBLISHABLE_KEY:'test'}});assert.equal(res.status,200);
});


test('fallback loads a long thread with one database request per API call', async t => {
  const id = '5726b173-8f21-4aaf-b828-410635bfe6b8';
  const rows = Array.from({ length: 5001 }, (_, i) => ({ id: i ? String(i) : id, reply_to: i ? 'parent' : null }));
  const old = globalThis.fetch;
  let databaseCalls = 0, apiCalls = 0;
  globalThis.fetch = async input => {
    databaseCalls++;
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get('offset'));
    return Response.json(rows.slice(offset, offset + Number(url.searchParams.get('limit'))));
  };
  t.after(() => { globalThis.fetch = old; });
  const client = loadClient(async input => {
    if (String(input).startsWith('https://')) throw new Error('direct access blocked');
    apiCalls++;
    const before = databaseCalls;
    const response = await listMessagesApi({ request: new Request(`https://business.example${input}`), env: {
      BUSINESS_SUPABASE_URL: 'https://business.supabase.co', BUSINESS_SUPABASE_PUBLISHABLE_KEY: 'test'
    } });
    assert.equal(databaseCalls - before, 1);
    return response;
  });
  assert.equal((await client.getThread(id)).length, rows.length);
  assert.equal(apiCalls, 51);
  assert.equal(databaseCalls, 51);
});

test('a failed later fallback page reports an error instead of returning partial replies', async () => {
  const client = loadClient(async input => {
    if (String(input).startsWith('https://')) throw new Error('direct blocked');
    const page = new URL(`https://business.example${input}`).searchParams.get('thread_page');
    if (page === '0') return { ok: true, json: async () => ({ messages: [{ id: '5' }], hasMore: true }) };
    return { ok: false, status: 503 };
  });
  await assert.rejects(client.getThread('5'), /public_data_unavailable/);
});
