(function () {
  function setScore(meal, score) {
    const card = document.querySelector(`[data-meal="${meal}"]`);
    if (!card) return;
    card.dataset.score = String(score);
    card.querySelectorAll('.score-button').forEach(button => {
      const selected = Number(button.dataset.score) === Number(score);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const labels = ['', '很不满意', '不太满意', '一般', '比较满意', '非常满意'];
    card.querySelector('.score-description').textContent = `${score} 分 · ${labels[score]}`;
  }

  function showStatus(element, message, type = '') {
    element.textContent = message;
    element.className = `rating-status${type ? ` ${type}` : ''}`;
  }

  async function initialize() {
    const session = await ISAAuth.requireSession('/meal-rating.html');
    if (!session) return;
    const form = document.getElementById('ratingForm');
    const shell = document.getElementById('ratingShell');
    const status = document.getElementById('ratingStatus');
    const submit = document.getElementById('ratingSubmit');
    const comment = document.getElementById('ratingComment');
    const displayName = session.user.name || session.user.email?.split('@')[0] || '校园用户';
    document.getElementById('ratingIdentity').textContent = ` 此反馈将与当前账号（${displayName}）绑定。`;

    form.querySelectorAll('.score-button').forEach(button => {
      button.addEventListener('click', () => setScore(button.closest('[data-meal]').dataset.meal, Number(button.dataset.score)));
    });
    comment.addEventListener('input', () => {
      document.getElementById('ratingCommentCount').textContent = `${comment.value.length} / 500`;
    });

    try {
      const response = await fetch('/api/meal-ratings', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) return location.replace(ISAAuth.loginUrl('/meal-rating.html'));
      if (!response.ok) throw new Error('load_failed');
      const result = await response.json();
      document.getElementById('ratingDate').textContent = new Date(`${result.date}T12:00:00+08:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
      if (result.rating) {
        setScore('breakfast', result.rating.breakfast_score);
        setScore('lunch', result.rating.lunch_score);
        setScore('dinner', result.rating.dinner_score);
        comment.value = result.rating.comment || '';
        document.getElementById('ratingCommentCount').textContent = `${comment.value.length} / 500`;
        submit.textContent = '更新今日评分';
        showStatus(status, '已载入你今天提交的评分。');
      } else {
        showStatus(status, '每人每天一份，可在当天重复修改。');
      }
      shell.dataset.ready = 'true';
      submit.disabled = false;
    } catch {
      showStatus(status, '餐食评分暂时不可用，请稍后再试。', 'error');
      return;
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const scores = Object.fromEntries(['breakfast', 'lunch', 'dinner'].map(meal => [meal, Number(document.querySelector(`[data-meal="${meal}"]`)?.dataset.score || 0)]));
      if (Object.values(scores).some(score => score < 1 || score > 5)) {
        showStatus(status, '请先完成早餐、午餐和晚餐三项评分。', 'error');
        return;
      }
      submit.disabled = true;
      submit.textContent = '提交中…';
      showStatus(status, '正在保存今日反馈…');
      try {
        const response = await fetch('/api/meal-ratings', {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            breakfastScore: scores.breakfast,
            lunchScore: scores.lunch,
            dinnerScore: scores.dinner,
            comment: comment.value
          })
        });
        if (!response.ok) throw new Error('save_failed');
        showStatus(status, '今日餐食评分已提交并绑定当前账号。', 'success');
        submit.textContent = '更新今日评分';
      } catch {
        showStatus(status, '提交失败，请稍后重试。', 'error');
        submit.textContent = '重新提交';
      } finally {
        submit.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
