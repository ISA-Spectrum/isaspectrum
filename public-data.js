(function () {
  'use strict';

  const SUPABASE_URL = 'https://bbcnrsktqarvceekrswb.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_f3Kav8ipJco_f9tw5zO50A_w7KigE5D';
  const ZONES = new Set(['校园生活', '学习互助', '活动社团', '失物招领']);

  async function select(view, params, signal) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${params}`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' },
      cache: 'no-store',
      signal
    });
    if (!response.ok) throw new Error('public_data_unavailable');
    return response.json();
  }

  async function listMessages({ page = 0, limit = 20, sort = 'newest', search = '', zone = 'all', signal } = {}) {
    const safePage = Math.max(0, Number(page) || 0);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const params = new URLSearchParams({
      select: 'id,username,content,zone,pic_url,created_at,reply_to',
      reply_to: 'is.null',
      order: `created_at.${sort === 'oldest' ? 'asc' : 'desc'}`,
      offset: String(safePage * safeLimit),
      limit: String(safeLimit + 1)
    });
    if (ZONES.has(zone)) params.set('zone', `eq.${zone}`);
    const safeSearch = String(search || '').trim().slice(0, 100).replace(/[,*()]/g, ' ');
    if (safeSearch) params.set('content', `ilike.*${safeSearch}*`);
    const rows = await select('approved_messages_public', params, signal);
    return { messages: rows.slice(0, safeLimit), hasMore: rows.length > safeLimit, page: safePage };
  }

  async function getThread(id, signal) {
    const value = String(id || '');
    if (!/^\d+$/.test(value) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error('invalid_message_id');
    }
    const params = new URLSearchParams({
      select: 'id,username,content,zone,pic_url,created_at,reply_to',
      order: 'created_at.asc',
      limit: '1000'
    });
    const rows = await select('approved_messages_public', params, signal);
    const byParent = new Map();
    rows.forEach(message => {
      const key = message.reply_to == null ? null : String(message.reply_to);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(message);
    });
    const root = rows.find(message => String(message.id) === String(id) && message.reply_to == null);
    if (!root) return [];
    const thread = [root];
    const visit = parentId => {
      for (const child of byParent.get(String(parentId)) || []) {
        thread.push(child);
        visit(child.id);
      }
    };
    visit(root.id);
    return thread;
  }

  window.ISAPublicData = { listMessages, getThread };
})();
