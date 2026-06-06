// 加载审核导航 + 自动高亮当前页面菜单
fetch("header-checker.html")
.then(res=>res.text())
.then(html=>{
    document.querySelector("#checkHeader").innerHTML = html;
    // 汉堡菜单
    const menuBtn = document.getElementById("menuBtn");
    const navList = document.getElementById("navList");
    if(menuBtn&&navList){
        menuBtn.onclick = ()=> navList.classList.toggle("show");
    }
// 自动匹配页面，兼容线上无.html / 本地带.html
let pageRaw = location.pathname.split('/').pop();
let currPage = pageRaw.replace(/\.html$/,'');
if(currPage === '') currPage = 'checker-pending';

const links = document.querySelectorAll("#navList a");
links.forEach(link=>{
    link.classList.remove("active");
    let hrefRaw = link.getAttribute("href");
    let hrefName = hrefRaw.replace(/\.html$/,'');
    if(hrefName === currPage){
        link.classList.add("active");
    }
})
})