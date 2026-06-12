// Copyright (c) 2026 ISA Spectrum
// Copyright (c) 2026 沧海四象
// Licensed under the MIT License.
// common.js最终代码

// ========== 全局错误捕获 开始 ==========
// 1. 捕获页面 JS 运行异常
window.onerror = function(msg, url, line, col, error) {
    location.href = "500.html";
    return true;
};
// 2. 捕获异步 Promise 异常
window.addEventListener("unhandledrejection", function() {
    location.href = "500.html";
});
// ========== 全局错误捕获 结束 ==========

fetch('./header.html')
.then(res=>{
  if(!res.ok) {
    // 资源404 跳转404页
    if(res.status === 404) location.href = "404.html";
    throw new Error('头部加载异常');
  }
  return res.text()
})
.then(html=>{
  document.getElementById('headerBox').innerHTML = html
  // 菜单+导航高亮
  const btn = document.getElementById('menuBtn')
  const navList = document.getElementById('navList')
  if(btn) btn.onclick = ()=> navList.classList.toggle('show')
  // 处理线上pages无.html、本地带.html兼容
  let pageRaw = location.pathname.split('/').pop();
  let currPage = pageRaw.replace(/\.html$/,'');
  if(currPage === '') currPage = 'main';

  document.querySelectorAll('.nav-links a').forEach(a=>{
      a.classList.remove('active');
      let hrefRaw = a.getAttribute('href');
      let hrefName = hrefRaw.replace(/\.html$/,'');
      if(hrefName === currPage){
          a.classList.add('active');
      }
  })
}).catch(e=>{
  console.error('头部加载失败',e);
  // 非404类加载异常 跳转500
  location.href = "500.html";
})

fetch('./footer.html')
.then(res=>{
  if(!res.ok) {
    if(res.status === 404) location.href = "404.html";
    throw new Error('底部加载异常');
  }
  return res.text()
})
.then(html=>document.getElementById('footerBox').innerHTML=html)
.catch(e=>{
  console.error('底部加载失败',e);
  location.href = "500.html";
})

// 注册Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        console.log('✅ Service Worker 注册成功:', reg);
      })
      .catch(err => {
        console.log('❌ Service Worker 注册失败:', err);
        location.href = "500.html";
      });
  });
}