// Shows a small "demo mode" badge when the current session came from /demo.
// The flag lives inside the signed JWT (demo: true), so it can't be faked into a real account.
(function () {
    function payload(t) {
        try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
    }
    var tok = localStorage.getItem('sm_token') || '';
    if (location.pathname.indexOf('employee') !== -1) tok = sessionStorage.getItem('emp_token') || '';
    var p = tok && payload(tok);
    window.SM_IS_DEMO = !!(p && p.demo);
    if (!window.SM_IS_DEMO) return;

    function mount() {
        var el = document.createElement('div');
        el.setAttribute('role', 'status');
        el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:400;display:flex;align-items:center;gap:12px;' +
            'background:#131E33;border:1px solid #F5B83D;color:#E9EEF6;border-radius:14px;padding:10px 14px;' +
            'font:500 14px "IBM Plex Sans Hebrew",Heebo,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:calc(100vw - 32px)';
        el.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#F5B83D;flex:none"></span>' +
            '<span>מצב הדגמה. הנתונים מתאפסים כל כמה שעות</span>' +
            '<a href="demo.html" style="color:#F5B83D;text-decoration:none;white-space:nowrap">יציאה מההדגמה</a>';
        el.querySelector('a').addEventListener('click', function () {
            localStorage.removeItem('sm_token'); localStorage.removeItem('sm_business_id'); localStorage.removeItem('sm_manager_name');
            sessionStorage.removeItem('emp_token');
        });
        document.body.appendChild(el);
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
