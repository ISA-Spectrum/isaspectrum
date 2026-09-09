(function () {
  const SUPABASE_URL = 'https://bbcnrsktqarvceekrswb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_f3Kav8ipJco_f9tw5zO50A_w7KigE5D';
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function getShanghaiDate() {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function setScore(meal, score) {
    const card = document.querySelector(`[data-meal="${meal}"]`);
    if (!card) return;
    card.dataset.score = String(score);
    card.querySelectorAll('.score-button').forEach((button) => {
      const selected = Number(button.dataset.score) === Number(score);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const labels = ['', '很不满意', '不太满意', '一般', '比较满意', '非常满意'];
    card.querySelector('.score-description').textContent = `${score} 分 · ${labels[score]}`;
  }

  async function initialize() {
    const shell = document.getElementById('ratingShell');
    const form = document.getElementById('ratingForm');
    const status = document.getElementById('ratingStatus');
    const submit = document.getElementById('ratingSubmit');
    const comment = document.getElementById('ratingComment');
    const today = getShanghaiDate();

    document.getElementById('ratingDate').textContent = new Date(`${today}T12:00:00+08:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
      location.replace('login.html?returnTo=meal-rating.html');
      return;
    }

    const user = session.user;
    const displayName = user.user_metadata?.username || user.email?.split('@')[0] || '校园用户';
    document.getElementById('ratingIdentity').textContent = ` 此反馈将与当前账号（${displayName}）绑定。`;
    shell.dataset.ready = 'true';
    submit.disabled = false;
    status.textContent = '每人每天一份，可在当天重复修改。';

    form.querySelectorAll('.score-button').forEach((button) => {
      button.addEventListener('click', () => setScore(button.closest('[data-meal]').dataset.meal, Number(button.dataset.score)));
    });
    comment.addEventListener('input', () => {
      document.getElementById('ratingCommentCount').textContent = `${comment.value.length} / 500`;
    });

    const { data: saved, error: loadError } = await client.from('meal_ratings')
      .select('breakfast_score,lunch_score,dinner_score,comment')
      .eq('user_id', user.id).eq('rating_date', today).maybeSingle();
    if (saved) {
      setScore('breakfast', saved.breakfast_score);
      setScore('lunch', saved.lunch_score);
      setScore('dinner', saved.dinner_score);
      comment.value = saved.comment || '';
      document.getElementById('ratingCommentCount').textContent = `${comment.value.length} / 500`;
      submit.textContent = '更新今日评分';
      status.textContent = '已载入你今天提交的评分。';
    } else if (loadError && loadError.code !== 'PGRST116') {
      status.textContent = '餐食评分暂未开放，请稍后再试。';
      status.className = 'rating-status error';
      submit.disabled = true;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const scores = Object.fromEntries(['breakfast', 'lunch', 'dinner'].map((meal) => [meal, Number(document.querySelector(`[data-meal="${meal}"]`)?.dataset.score || 0)]));
      if (Object.values(scores).some((score) => score < 1 || score > 5)) {
        status.textContent = '请先完成早餐、午餐和晚餐三项评分。';
        status.className = 'rating-status error';
        return;
      }

      submit.disabled = true;
      submit.textContent = '提交中…';
      status.textContent = '正在保存今日反馈…';
      status.className = 'rating-status';
      const { error } = await client.from('meal_ratings').upsert({
        user_id: user.id,
        display_name: displayName,
        rating_date: today,
        breakfast_score: scores.breakfast,
        lunch_score: scores.lunch,
        dinner_score: scores.dinner,
        comment: comment.value.trim() || null
      }, { onConflict: 'user_id,rating_date' });

      if (error) {
        status.textContent = '提交失败，请稍后重试。';
        status.className = 'rating-status error';
        submit.textContent = '重新提交';
      } else {
        status.textContent = '今日餐食评分已提交并绑定当前账号。';
        status.className = 'rating-status success';
        submit.textContent = '更新今日评分';
      }
      submit.disabled = false;
    });
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
