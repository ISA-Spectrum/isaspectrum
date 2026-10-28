import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../details.html', import.meta.url), 'utf8');
const renderer = html.slice(html.indexOf('function renderCommentTree() {'), html.indexOf('// ==================== 评论框'));

function render(messages) {
    const container = { innerHTML: '' };
    const context = {
        allMessages: messages,
        mainMsgId: 'root',
        userMap: Object.fromEntries(messages.map(m => [m.id, m.username])),
        document: { getElementById: () => container },
        escapeHtml: value => String(value),
        renderMessageAvatars() {},
    };
    vm.runInNewContext(renderer + '\nrenderCommentTree();', context);
    return container.innerHTML;
}

const message = (id, reply_to) => ({ id, reply_to, username: id, content: id, created_at: '2026-01-01T00:00:00Z' });

test('renders replies in depth-first order and preserves levels', () => {
    const result = render([message('a', 'root'), message('b', 'root'), message('c', 'a'), message('d', 'c')]);
    assert.deepEqual([...result.matchAll(/id="msg-([^"]+)"/g)].map(match => match[1]), ['a', 'c', 'd', 'b']);
    assert.equal((result.match(/message-item level-1/g) || []).length, 2);
    assert.equal((result.match(/message-item level-2/g) || []).length, 2);
    assert.match(result, /回复 @c/);
});

test('renders a deep reply chain without overflowing the call stack', () => {
    const messages = Array.from({ length: 5000 }, (_, i) => message(String(i), i ? String(i - 1) : 'root'));
    const result = render(messages);
    assert.equal((result.match(/class="message-item /g) || []).length, 5000);
    assert.match(result, /id="msg-4999"/);
});
