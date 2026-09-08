// Copyright (c) 2026 ISA Spectrum · MIT License
(function(){
  const include=async(selector,path)=>{const target=document.querySelector(selector);if(!target)return;const response=await fetch(path);if(!response.ok)throw new Error(`${path} 加载失败`);target.innerHTML=await response.text()};
  const normalizePage=value=>{const page=(value||'').split('/').pop().replace(/\.html$/,'');return !page||page==='index'?'main':page};
  const initHeader=()=>{
    const header=document.getElementById('siteHeader'),button=document.getElementById('menuBtn'),list=document.getElementById('navList');if(!header||!button||!list)return;
    const closeMenu=()=>{list.classList.remove('show');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','打开导航菜单');document.body.classList.remove('menu-open')};
    button.addEventListener('click',()=>{const open=!list.classList.contains('show');list.classList.toggle('show',open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'关闭导航菜单':'打开导航菜单');document.body.classList.toggle('menu-open',open)});
    const current=normalizePage(location.pathname);list.querySelectorAll('a').forEach(link=>{const active=normalizePage(link.getAttribute('href'))===current;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');link.addEventListener('click',closeMenu)});
    document.addEventListener('click',event=>{if(!header.contains(event.target))closeMenu()});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu()});window.addEventListener('resize',()=>{if(innerWidth>860)closeMenu()});
    const syncHeader=()=>header.classList.toggle('scrolled',scrollY>12);syncHeader();addEventListener('scroll',syncHeader,{passive:true});
  };
  Promise.all([include('#headerBox','./header.html'),include('#footerBox','./footer.html')]).then(initHeader).catch(error=>console.error(error));
})();
