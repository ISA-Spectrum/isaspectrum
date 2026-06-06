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

    // 自动匹配页面，切换active高亮
    const pageName = location.pathname.split('/').pop(); // 获取当前文件名
    const links = document.querySelectorAll("#navList a");
    links.forEach(link=>{
        // 清空所有active
        link.classList.remove("active");
        // 当前页面和href一致就加上active
        const hrefName = link.getAttribute("href");
        if(hrefName === pageName){
            link.classList.add("active");
        }
    })
})