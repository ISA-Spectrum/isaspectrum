(function () {
  'use strict';
  const status = document.body.dataset.status;
  const action = document.body.dataset.action;
  const list = document.getElementById('list');
  let selectedId = null;

  function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = value || '';
    return node.innerHTML;
  }

  function login() {
    const returnTo = location.pathname + location.search;
    location.replace(`/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (response.status === 401) {
      login();
      throw new Error('authentication_required');
    }
    if (response.status === 403) {
      location.replace('/login-messageschecker.html?error=forbidden');
      throw new Error('forbidden');
    }
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'request_failed');
    return response.json();
  }

  function imageMarkup(values) {
    if (!Array.isArray(values) || !values.length) return '';
    return `<div class="message-images">${values.map(url => `<img src="${escapeHtml(url)}" class="message-image" alt="留言图片" loading="lazy">`).join('')}</div>`;
  }

  function actionMarkup(id) {
    if (status === 'pending') return `<button class="btn btn-approve" data-action="approve" data-id="${id}">通过</button><button class="btn btn-danger" data-action="reject" data-id="${id}">拒绝</button>`;
    if (status === 'approved') return `<button class="btn btn-danger" data-action="delete" data-id="${id}">删除</button>`;
    return `<button class="btn btn-approve" data-action="restore" data-id="${id}">恢复</button>`;
  }

  async function load() {
    list.innerHTML = '<div class="empty">加载中…</div>';
    try {
      const data = await api(`/api/checker/messages?status=${encodeURIComponent(status)}`);
      if (!data.messages.length) return list.innerHTML = '<div class="empty">当前没有留言</div>';
      list.innerHTML = data.messages.map(message => `
        <article class="item">
          <div class="item-header"><strong>${escapeHtml(message.username)}</strong><time>${new Date(message.created_at).toLocaleString('zh-CN')}</time></div>
          <div class="zone">${escapeHtml(message.zone || '校园生活')}</div>
          <div class="item-content">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div>
          ${imageMarkup(message.pic_url)}
          <div class="meta">账号邮箱：${escapeHtml(message.contact_email || '未提供')}</div>
          ${status === 'deleted' ? `<div class="reason">原因：${escapeHtml(message.reject_reason || '未填写')}</div>` : ''}
          <div class="item-actions">${actionMarkup(message.id)}</div>
        </article>`).join('');
    } catch (error) {
      if (!['authentication_required', 'forbidden'].includes(error.message)) list.innerHTML = '<div class="empty">审核服务暂时不可用</div>';
    }
  }

  async function moderate(id, nextAction, reason = '') {
    await api('/api/checker/messages', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: nextAction, reason })
    });
    await load();
  }

  list.addEventListener('click', async event => {
    const image = event.target.closest('.message-image');
    if (image) return window.open(image.src, '_blank', 'noopener');
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const nextAction = button.dataset.action;
    if (nextAction === 'reject' || nextAction === 'delete') {
      selectedId = button.dataset.id;
      document.getElementById('reasonModal').style.display = 'flex';
      document.getElementById('reasonInput').focus();
      return;
    }
    button.disabled = true;
    try { await moderate(button.dataset.id, nextAction); } catch (error) { if (!['authentication_required', 'forbidden'].includes(error.message)) alert('操作失败，请刷新后重试'); }
  });

  document.getElementById('cancelReason')?.addEventListener('click', () => {
    selectedId = null;
    document.getElementById('reasonModal').style.display = 'none';
  });
  document.getElementById('confirmReason')?.addEventListener('click', async event => {
    const reason = document.getElementById('reasonInput').value.trim();
    if (!reason || !selectedId) return alert('请填写原因');
    event.target.disabled = true;
    try {
      await moderate(selectedId, action, reason);
      selectedId = null;
      document.getElementById('reasonInput').value = '';
      document.getElementById('reasonModal').style.display = 'none';
    } catch (error) {
      if (!['authentication_required', 'forbidden'].includes(error.message)) alert('操作失败，请刷新后重试');
    } finally { event.target.disabled = false; }
  });
  document.getElementById('logoutBtn').addEventListener('click', () => ISAAuth.logout('/main.html'));

  (async () => {
    const session = await ISAAuth.getSession().catch(() => null);
    if (!session?.authenticated) return login();
    if (!session.user?.checker) return location.replace('/login-messageschecker.html?error=forbidden');
    await load();
  })();
})();
