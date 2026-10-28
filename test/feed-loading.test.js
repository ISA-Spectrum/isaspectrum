import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../messages.html', import.meta.url), 'utf8');
const loader = page.slice(page.indexOf('        async function loadMainMessages('), page.indexOf('        function showNoMoreTip()'));

function setup() {
  const calls = [];
  const container = {
    innerHTML: '',
    insertAdjacentHTML(_where, html) { this.innerHTML += html; }
  };
  const document = {
    getElementById(id) { return id === 'messageContainer' ? container : null; },
    querySelector(selector) {
      if (selector === '.list-loading-tip' && container.innerHTML.includes('list-loading-tip')) {
        return { remove() { container.innerHTML = container.innerHTML.replace('<div class="loading list-loading-tip">加载更多...</div>', ''); } };
      }
      return null;
    }
  };
  const ISAPublicData = { listMessages() { return new Promise((resolve, reject) => calls.push({ resolve, reject })); } };
  const context = vm.createContext({
    document, AbortController, window: { ISAPublicData }, ISAPublicData,
    parseMessageContent: () => ({ zone: '校园生活', text: '留言' }),
    escapeHtml: value => value || '', renderMessageAvatars() {}, showNoMoreTip() {}
  });
  vm.runInContext(`let currentPage=0, PAGE_SIZE=20, hasMore=true, isLoadingMore=false, abortController=null, activeSearch='', activeSort='newest', activeZone='all', userMap={};\n${loader}\nglobalThis.load=loadMainMessages;`, context);
  return { calls, container, load: context.load };
}
const item = { id: '1', username: '测试', content: '留言', created_at: '2026-01-01', pic_url: [] };

test('a scroll cannot replace an in-flight first page', async () => {
  const h = setup();
  const first = h.load();
  await h.load(true);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve({ messages: [item], hasMore: true });
  await first;
  assert.doesNotMatch(h.container.innerHTML, /加载留言中/);
  assert.match(h.container.innerHTML, /message-1/);
});

test('an aborted old request cannot unlock the current request', async () => {
  const h = setup();
  const old = h.load();
  const current = h.load();
  h.calls[0].resolve({ messages: [item], hasMore: true });
  await old;
  await h.load(true);
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ messages: [item], hasMore: true });
  await current;
  assert.doesNotMatch(h.container.innerHTML, /加载留言中/);
});

test('a failed load-more request clears its loading indicator', async () => {
  const h = setup();
  const first = h.load();
  h.calls[0].resolve({ messages: [item], hasMore: true });
  await first;
  const more = h.load(true);
  h.calls[1].reject(new Error('offline'));
  await more;
  assert.doesNotMatch(h.container.innerHTML, /加载更多/);
});
