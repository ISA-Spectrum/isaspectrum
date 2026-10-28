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

  function wasAborted(error, signal) {
    return signal?.aborted || error?.name === 'AbortError';
  }

  async function requestMessagesApi(params, signal) {
    const response = await fetch(`/api/messages?${params}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal
    });
    if (!response.ok) {
      if (params.has('thread') && response.status === 404) {
        const body = await response.json().catch(() => null);
        if (body?.error === 'not_found') return { messages: [] };
      }
      throw new Error('public_data_unavailable');
    }
    return response.json();
  }

  async function listMessages({ page = 0, limit = 20, sort = 'newest', search = '', zone = 'all', signal } = {}) {
    const safePage = Math.max(0, Number(page) || 0);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const params = new URLSearchParams({
      select: 'id,username,content,zone,pic_url,created_at,reply_to,avatar_url',
      reply_to: 'is.null',
      order: `created_at.${sort === 'oldest' ? 'asc' : 'desc'}`,
      offset: String(safePage * safeLimit),
      limit: String(safeLimit + 1)
    });
    if (ZONES.has(zone)) params.set('zone', `eq.${zone}`);
    const safeSearch = String(search || '').trim().slice(0, 100).replace(/[,*()]/g, ' ');
    if (safeSearch) params.set('content', `ilike.*${safeSearch}*`);
    try {
      const rows = await select('approved_messages_public', params, signal);
      return { messages: rows.slice(0, safeLimit), hasMore: rows.length > safeLimit, page: safePage };
    } catch (error) {
      if (wasAborted(error, signal)) throw error;
      const fallback = new URLSearchParams({
        page: String(safePage),
        limit: String(safeLimit),
        sort: sort === 'oldest' ? 'oldest' : 'newest'
      });
      if (ZONES.has(zone)) fallback.set('zone', zone);
      if (safeSearch) fallback.set('search', safeSearch);
      return requestMessagesApi(fallback, signal);
    }
  }

  async function getThread(id, signal) {
    const value = String(id || '').toLowerCase();
    if (!/^\d+$/.test(value) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error('invalid_message_id');
    }
    const fields = 'id,username,content,zone,pic_url,created_at,reply_to,avatar_url';
    try {
      const thread = [];
      let offset = 0;
      while (true) {
        const params = new URLSearchParams({ p_root_id: value, select: fields,
          order: 'created_at.asc,id.asc', limit: '100', offset: String(offset) });
        const rows = await select('rpc/approved_message_thread', params, signal);
        thread.push(...rows);
        if (rows.length < 100) break;
        offset += rows.length;
      }
      return thread;
    } catch (error) {
      if (wasAborted(error, signal)) throw error;
      const thread = [];
      let page = 0;
      while (true) {
        const result = await requestMessagesApi(new URLSearchParams({ thread: value, thread_page: String(page) }), signal);
        thread.push(...(result.messages || []));
        if (!result.hasMore) return thread;
        page++;
      }
    }
  }

  window.ISAPublicData = { listMessages, getThread };
})();
