(function () {
  const SUPABASE_URL = 'https://bbcnrsktqarvceekrswb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_f3Kav8ipJco_f9tw5zO50A_w7KigE5D';
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const zones = [
    { key: 'life', label: '校园生活', icon: '日', description: '日常、食堂与校园见闻', keywords: ['校园', '食堂', '宿舍', '老师', '同学', '日常', '生活', '周末'] },
    { key: 'study', label: '学习互助', icon: '学', description: '课程、考试与经验分享', keywords: ['学习', '作业', '考试', '课程', '笔记', '竞赛', '选课', '大学'] },
    { key: 'clubs', label: '活动社团', icon: '动', description: '活动、比赛与社团招新', keywords: ['活动', '社团', '比赛', '演出', '运动', '招新', '音乐', '篮球', '足球'] },
    { key: 'lost', label: '失物招领', icon: '寻', description: '寻找物品与归还线索', keywords: ['失物', '招领', '丢了', '捡到', '寻找', '遗失', '找到'] }
  ];

  const escapeHtml = (value) => {
    const node = document.createElement('div');
    node.textContent = value || '';
    return node.innerHTML;
  };
  const relativeTime = (value) => {
    const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
    if (seconds < 60) return formatter.format(-seconds, 'second');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return formatter.format(-minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return formatter.format(-hours, 'hour');
    const days = Math.floor(hours / 24);
    return days < 30 ? formatter.format(-days, 'day') : new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };
  const parseContent = (content = '') => {
    const marker = content.match(/^【([^】]+)】\s*/);
    const label = zones.some((zone) => zone.label === marker?.[1]) ? marker[1] : '';
    return { marker: label, text: label ? content.replace(/^【[^】]+】\s*/, '') : content };
  };
  const classify = (item) => {
    const parsed = parseContent(item.content);
    const stored = zones.find((zone) => zone.label === item.zone);
    if (stored) return stored.key;
    const marked = zones.find((zone) => zone.label === parsed.marker);
    if (marked) return marked.key;
    return zones.find((zone) => zone.key !== 'life' && zone.keywords.some((word) => parsed.text.includes(word)))?.key || 'life';
  };

  function renderZones(host, items = [], locked = false) {
    const groups = Object.fromEntries(zones.map((zone) => [zone.key, []]));
    items.forEach((item) => groups[classify(item)].push(item));
    host.innerHTML = zones.map((zone) => {
      const posts = groups[zone.key].slice(0, 2);
      const body = locked
        ? '<div class="zone-empty">登录后查看这个分区的最新动态。</div>'
        : posts.length
          ? posts.map((item) => {
              const parsed = parseContent(item.content);
              return `<a class="zone-post" href="details.html?id=${encodeURIComponent(item.id)}"><strong>${escapeHtml(parsed.text)}</strong><small>→</small><span>${escapeHtml(item.username || 'ISAer')} · ${relativeTime(item.created_at)}</span></a>`;
            }).join('')
          : '<div class="zone-empty">这个分区还没有新动态。</div>';
      return `<article class="zone-card"><div class="zone-head"><div class="zone-title"><span class="zone-icon">${zone.icon}</span><div><h3>${zone.label}</h3><p>${zone.description}</p></div></div><span class="zone-count">${locked ? '需登录' : `${groups[zone.key].length} 条`}</span></div><div class="zone-posts">${body}</div><a class="zone-link" href="messages.html?zone=${encodeURIComponent(zone.label)}">进入${zone.label} →</a></article>`;
    }).join('');
  }

  function initGreeting() {
    const node = document.getElementById('dayGreeting');
    if (!node) return;
    const hour = new Date().getHours();
    const part = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    node.textContent = `${part} · 校园社区在线`;
  }
  function initCarousel() {
    const slides = [...document.querySelectorAll('.hero-slide')];
    const host = document.getElementById('heroDots');
    if (!slides.length || !host) return;
    let current = 0;
    let timer;
    const dots = slides.map((slide, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `hero-dot${index === 0 ? ' active' : ''}`;
      button.setAttribute('aria-label', `显示第 ${index + 1} 张：${slide.dataset.label}`);
      host.appendChild(button);
      return button;
    });
    const schedule = () => {
      clearInterval(timer);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => show(current + 1), 6000);
    };
    const show = (next, restart = false) => {
      current = (next + slides.length) % slides.length;
      slides.forEach((slide, index) => slide.classList.toggle('active', index === current));
      dots.forEach((dot, index) => dot.classList.toggle('active', index === current));
      if (restart) schedule();
    };
    dots.forEach((dot, index) => dot.addEventListener('click', () => show(index, true)));
    document.getElementById('prevSlide')?.addEventListener('click', () => show(current - 1, true));
    document.getElementById('nextSlide')?.addEventListener('click', () => show(current + 1, true));
    document.querySelector('.hero')?.addEventListener('mouseenter', () => clearInterval(timer));
    document.querySelector('.hero')?.addEventListener('mouseleave', schedule);
    document.addEventListener('visibilitychange', () => document.hidden ? clearInterval(timer) : schedule());
    schedule();
  }

  async function initMealEntry() {
    const link = document.getElementById('mealEntryLink');
    const note = document.getElementById('mealEntryNote');
    if (!link || !note || !client) return;
    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      link.href = 'meal-rating.html';
      link.textContent = '进入今日评分 →';
      note.textContent = '反馈会与当前登录账号绑定';
    }
  }

  async function loadFeed() {
    const host = document.getElementById('latestFeed');
    if (!host || !client) return;
    try {
      const { data, error } = await client.from('approved_messages_public')
        .select('id,username,content,created_at,zone')
        .order('created_at', { ascending: false }).limit(40);
      if (error) throw error;
      renderZones(host, data || []);
    } catch (error) {
      host.innerHTML = '<div class="zone-card"><div class="zone-empty">暂时无法同步分区内容，请稍后重试。</div><a class="text-link" href="messages.html">前往校墙 →</a></div>';
    }
  }
  async function loadNotices() {
    const host = document.getElementById('latestNotices');
    if (!host) return;
    try {
      const response = await fetch('./notice.html');
      if (!response.ok) throw new Error();
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const notices = [...doc.querySelectorAll('.notice-item')].slice(0, 3);
      host.innerHTML = notices.map((item) => {
        const title = item.querySelector('h3')?.textContent.trim() || '站内公告';
        const match = item.textContent.match(/20\d{2}年\d{1,2}月\d{1,2}日/);
        return `<a class="notice-row" href="notice.html"><span class="notice-date">${escapeHtml(match?.[0] || '最新')}</span><span class="notice-title">${escapeHtml(title)}</span><span aria-hidden="true">→</span></a>`;
      }).join('');
    } catch (error) {
      host.innerHTML = '<a class="notice-row" href="notice.html"><span class="notice-date">最新</span><span class="notice-title">前往公告页查看更新</span><span>→</span></a>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initGreeting();
    initCarousel();
    initMealEntry();
    loadNotices();
    loadFeed();
  });
})();
