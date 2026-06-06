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
  const currPage = location.pathname.split('/').pop() || 'main.html'
  document.querySelectorAll('.nav-links a').forEach(a=>{
    a.classList.toggle('active',a.getAttribute('href')===currPage)
  })
}).catch(e=>console.error('头部加载失败',e))

fetch('./footer.html')
.then(res=>{
  if(!res.ok) throw new Error('底部404')
  return res.text()
})
.then(html=>document.getElementById('footerBox').innerHTML=html)
.catch(e=>console.error('底部加载失败',e))