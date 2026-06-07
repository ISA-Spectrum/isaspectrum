// common.js最终代码
fetch('./header.html')
.then(res=>{
  if(!res.ok) throw new Error('头部404')
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
}).catch(e=>console.error('头部加载失败',e))

fetch('./footer.html')
.then(res=>{
  if(!res.ok) throw new Error('底部404')
  return res.text()
})
.then(html=>document.getElementById('footerBox').innerHTML=html)
.catch(e=>console.error('底部加载失败',e))
// 注册Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('✅ Service Worker 注册成功:', reg);
      })
      .catch(err => {
        console.log('❌ Service Worker 注册失败:', err);
      });
  });
}