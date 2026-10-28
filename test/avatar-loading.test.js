import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../messages.html', import.meta.url), 'utf8');
const loader = page.slice(page.indexOf('            let avatarAssetsPromise;'), page.indexOf("            const changeAvatar = document.getElementById('changeAvatar');"));

function harness() {
  const elements = [];
  const window = {};
  const document = {
    createElement(tag) { return { tag, remove() { this.removed = true; } }; },
    head: { append(element) { elements.push(element); } }
  };
  const context = vm.createContext({ document, window, setTimeout, clearTimeout });
  vm.runInContext(`${loader}\nglobalThis.load = loadAvatarAssets;`, context);
  return { elements, window, load: context.load };
}

function finish(h, fail) {
  h.window.Cropper = function () {};
  h.window.ISAAvatarEditor = {};
  h.elements.filter(e => !e.finished).forEach((element, i) => {
    element.finished = true;
    if (i === fail) element.onerror(); else element.onload();
  });
}

test('avatar resources are absent initially and load once on demand', async () => {
  assert.doesNotMatch(page.slice(0, page.indexOf('</head>')), /(?:cropper\.min\.(?:js|css)|avatar-editor\.(?:js|css))/);
  const h = harness();
  assert.equal(h.elements.length, 0);
  const first = h.load(), second = h.load();
  assert.equal(first, second);
  assert.equal(h.elements.length, 4);
  finish(h);
  await first;
  await h.load();
  assert.equal(h.elements.length, 4);
});

test('failed asset load cleans up and can be retried', async () => {
  const h = harness();
  const first = h.load();
  h.elements[1].onerror();
  h.elements.forEach(element => { element.finished = true; });
  await assert.rejects(first, /头像组件加载失败/);
  assert.ok(h.elements.every(e => e.removed));
  const retry = h.load();
  assert.equal(h.elements.length, 8);
  finish(h);
  await retry;
});

test('stalled resources time out and allow a retry', async () => {
  const elements = [], timers = [];
  const document = {
    createElement() { return { remove() { this.removed = true; } }; },
    head: { append(element) { elements.push(element); } }
  };
  const context = vm.createContext({ document, window: {}, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} });
  vm.runInContext(`${loader}\nglobalThis.load = loadAvatarAssets;`, context);
  const first = context.load();
  timers.forEach(fn => fn());
  await assert.rejects(first, /头像组件加载失败/);
  assert.ok(elements.every(element => element.removed));
  context.load().catch(() => {});
  assert.equal(elements.length, 8);
});
