// Copyright (c) 2026 ISA Spectrum
// Copyright (c) 2026 沧海四象
// Licensed under the MIT License.
// 加载审核导航 + 自动高亮当前页面菜单

// ========== 全局错误捕获 开始 ==========
window.onerror = function() {
    location.href = "500.html";
    return true;
};
window.addEventListener("unhandledrejection", function() {
    location.href = "500.html";
});
// ========== 全局错误捕获 结束 ==========

// ========== 初始化 Supabase + 权限校验（沿用你的逻辑） ==========
const SUPABASE_URL = 'https://bbcnrsktqarvceekrswb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiY25yc2t0cWFydmNlZWtyc3diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjUxODYsImV4cCI6MjA5NTEwMTE4Nn0.Mu6GW91z1HW2iX-tbQgH5qXrvpG2SPc9QoqCxGvV-54';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async function checkAuditAuth() {
    const { data: { session } } = await supabase.auth.getSession();

    // 1. 已登录
    if (session && session.user) {
        // maybeSingle：查不到数据不会抛异常，完美适配你的需求
        const { data: checker } = await supabase
            .from('checkers')
            .select('*')
            .eq('user_id', session.user.id)
            .maybeSingle();

        // 是审核员 → 正常加载页面
        if (checker) {
            loadCheckerNav();
            return;
        }
    }

    // 2. 未登录 / 已登录但非审核员 → 统一跳 403
    location.href = "403.html";
})();

// ========== 加载审核导航与菜单 ==========
function loadCheckerNav() {
    fetch("header-checker.html")
    .then(res=>{
        if(!res.ok) {
            if(res.status === 404) location.href = "404.html";
            throw new Error('审核导航加载异常');
        }
        return res.text();
    })
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
    .catch(e=>{
        console.error('审核导航加载失败', e);
        location.href = "500.html";
    });
}