// ShiftManager — manager dashboard logic.
// Same API contract as before; only the rendering moved from inline styles to admin.css classes.

const API = "https://shiftmanager-backend-n0ix.onrender.com";
let token = localStorage.getItem('sm_token');
let businessId = localStorage.getItem('sm_business_id');
let managerName = localStorage.getItem('sm_manager_name') || '';
let currentTab = 'dashboard';
let employees = [];
let notifInterval = null;

const ICON = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;

// ==================== INIT ====================
function isTokenValid(t) {
    if (!t) return false;
    try {
        const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.exp > Date.now() / 1000;
    } catch { return false; }
}

window.addEventListener('DOMContentLoaded', () => {
    const now = new Date();
    document.getElementById('report-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (token && businessId && isTokenValid(token)) {
        showApp();
    } else {
        localStorage.removeItem('sm_token');
        localStorage.removeItem('sm_business_id');
        localStorage.removeItem('sm_manager_name');
        window.location.replace('index.html');
    }
    document.addEventListener('click', () => closeNotifDropdown());
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        closeNotifDropdown();
    });
});

// SECURITY: escape any user-controlled string before it goes into innerHTML.
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// For values placed inside a JS string in an onclick attribute.
function jsArg(str) { return escapeHtml(JSON.stringify(String(str ?? ''))); }

function apiFetch(path, options = {}) {
    return fetch(`${API}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(options.headers || {}) }
    }).then(res => {
        if (res.status === 401) handleLogout(); // SECURITY: expired/invalid token
        return res;
    });
}

// ==================== AUTH ====================
function handleLogout() {
    token = null; businessId = null; managerName = '';
    localStorage.removeItem('sm_token');
    localStorage.removeItem('sm_business_id');
    localStorage.removeItem('sm_manager_name');
    if (notifInterval) clearInterval(notifInterval);
    window.location.replace(window.SM_IS_DEMO ? 'demo.html' : 'index.html');
}

// ==================== 2FA SETUP ====================
let _setupToken = null;

function open2FASetupModal() {
    show2FAStep('start');
    apiFetch('/auth/2fa-status').then(r => r.json()).then(data => {
        const statusEl = document.getElementById('2fa-current-status');
        const disableBtn = document.getElementById('btn-disable-2fa');
        statusEl.innerHTML = data.is_2fa_enabled
            ? '<span class="badge badge-green">פעיל</span>'
            : '<span class="badge badge-gray">לא פעיל</span>';
        disableBtn.style.display = data.is_2fa_enabled ? 'flex' : 'none';
    }).catch(() => {});
    document.getElementById('modal-2fa-setup').style.display = 'flex';
}

function close2FASetupModal() {
    _setupToken = null;
    document.getElementById('modal-2fa-setup').style.display = 'none';
}

function show2FAStep(step) {
    ['start', 'qr', 'success'].forEach(s => { document.getElementById(`2fa-step-${s}`).style.display = 'none'; });
    document.getElementById(`2fa-step-${step}`).style.display = 'block';
}

async function startSetup2FA() {
    const btn = document.getElementById('btn-start-setup');
    btn.textContent = 'מכין קוד QR…';
    btn.disabled = true;
    try {
        const res = await apiFetch('/auth/setup-2fa', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { alert(data.detail || 'ההגדרה נכשלה'); return; }
        _setupToken = data.setup_token;
        document.getElementById('2fa-secret-text').textContent = data.secret;
        const qrEl = document.getElementById('qrcode');
        qrEl.innerHTML = '';
        new QRCode(qrEl, { text: data.provisioning_uri, width: 176, height: 176, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        document.getElementById('setup-totp-code').value = '';
        document.getElementById('setup-totp-error').textContent = '';
        show2FAStep('qr');
        setTimeout(() => document.getElementById('setup-totp-code').focus(), 200);
    } catch {
        alert('אין חיבור לשרת. נסה שוב');
    } finally {
        btn.textContent = 'הגדרה עם קוד QR חדש';
        btn.disabled = false;
    }
}

async function confirmSetup2FA() {
    const code = document.getElementById('setup-totp-code').value.trim();
    const errEl = document.getElementById('setup-totp-error');
    if (!/^\d{6}$/.test(code)) { errEl.textContent = 'הקלד את 6 הספרות מהאפליקציה'; return; }
    const btn = document.getElementById('btn-confirm-setup');
    btn.textContent = 'מאמת…';
    btn.disabled = true;
    errEl.textContent = '';
    try {
        const res = await fetch(`${API}/auth/verify-2fa`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pending_token: _setupToken, code })
        });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.detail || 'הקוד שגוי';
            document.getElementById('setup-totp-code').value = '';
            document.getElementById('setup-totp-code').focus();
            return;
        }
        show2FAStep('success');
    } catch {
        errEl.textContent = 'אין חיבור לשרת. נסה שוב';
    } finally {
        btn.textContent = 'אימות והפעלה';
        btn.disabled = false;
    }
}

async function disable2FA() {
    if (!confirm('לכבות את האימות הדו-שלבי? החשבון יהיה מוגן רק בסיסמה.')) return;
    try {
        const res = await apiFetch('/auth/disable-2fa', { method: 'POST' });
        const data = await res.json();
        if (res.ok) { close2FASetupModal(); alert('האימות הדו-שלבי כובה'); }
        else alert(data.detail || 'הפעולה נכשלה');
    } catch { alert('אין חיבור לשרת. נסה שוב'); }
}

// ==================== APP SHELL ====================
function showApp() {
    const app = document.getElementById('main-app');
    app.style.removeProperty('display');
    app.style.display = 'flex';
    document.getElementById('sidebar-manager').textContent = managerName;
    document.getElementById('sidebar-avatar').textContent = (managerName.trim()[0] || '?');
    document.getElementById('page-sub').textContent = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
    if (window.Chart) {
        Chart.defaults.font.family = "'IBM Plex Sans Hebrew', sans-serif";
        Chart.defaults.color = '#8C9AB3';
    }
    apiFetch(`/businesses/${businessId}/join-code`).then(r => r.json()).then(d => {
        if (d.business_name) document.getElementById('sidebar-business').textContent = d.business_name;
    }).catch(() => {});
    drawMiniDial();
    setInterval(drawMiniDial, 60000);
    loadEmployees();
    loadDashboard();
    loadApprovalsBadge();
    notifInterval = setInterval(loadNotifications, 30000);
    setInterval(() => { if (currentTab === 'dashboard') loadDashboard(); }, 60000);
}

function toggleSidebar() {
    const open = document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open', open);
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
}

const TAB_TITLES = {
    dashboard: 'סקירה', 'manage-shifts': 'נוכחות עכשיו', employees: 'עובדים', approvals: 'הצטרפות לעסק',
    leave: 'בקשות היעדרות', roster: 'סידור עבודה', shifts: 'היסטוריית משמרות', reports: 'דוחות שכר',
    ai: 'עוזר AI', branches: 'סניפים',
};

function switchTab(tab) {
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`nav-${tab}`)?.classList.add('active');
    currentTab = tab;
    document.getElementById('page-title').textContent = TAB_TITLES[tab] || tab;
    document.getElementById('main-content').scrollTop = 0;
    closeSidebar();
    refreshCurrentTab();
}

function refreshCurrentTab() {
    if (currentTab === 'dashboard') loadDashboard();
    else if (currentTab === 'employees') loadEmployees();
    else if (currentTab === 'leave') loadLeave();
    else if (currentTab === 'shifts') { loadAllShifts(); loadEmployeeSummary(); populateWorkerFilter(); }
    else if (currentTab === 'branches') loadBranches();
    else if (currentTab === 'approvals') { loadApprovals(); loadJoinCode(); }
    else if (currentTab === 'manage-shifts') loadManageShifts();
    else if (currentTab === 'roster') loadRoster();
    else if (currentTab === 'ai') ensureAIEmptyState();
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ==================== 24h DIAL (same geometry as the logo) ====================
function dialPt(h, r = 80) { const a = h / 24 * 2 * Math.PI; return [100 + r * Math.sin(a), 100 - r * Math.cos(a)]; }
function dialArc(f, t) { const [a, b] = dialPt(f), [c, d] = dialPt(t); return `M${a.toFixed(1)} ${b.toFixed(1)} A80 80 0 0 1 ${c.toFixed(1)} ${d.toFixed(1)}`; }
function drawMiniDial() {
    const n = new Date(), h = n.getHours() + n.getMinutes() / 60;
    const [x, y] = dialPt(h, 58);
    document.getElementById('mini-dial').innerHTML = `
        <circle cx="100" cy="100" r="80" fill="none" stroke="#26354F" stroke-width="22"/>
        <path d="${dialArc(10.65, 17.85)}" fill="none" stroke="#F5B83D" stroke-width="22"/>
        <path d="${dialArc(18.15, 22.85)}" fill="none" stroke="#8E7DF7" stroke-width="22"/>
        <line x1="100" y1="100" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#E9EEF6" stroke-width="12" stroke-linecap="round"/>
        <circle cx="100" cy="100" r="14" fill="#E9EEF6"/>`;
    const shift = h >= 10.5 && h < 18 ? 'משמרת בוקר פעילה' : h >= 18 && h < 23 ? 'משמרת ערב פעילה' : 'אין משמרת מתוכננת עכשיו';
    document.getElementById('now-sub').textContent = `${n.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })}, ${shift}`;
}

// ==================== DASHBOARD ====================
let _dashRetryTimer = null;
async function loadDashboard() {
    const statusBar = document.getElementById('dashboard-status');
    const statusMsg = document.getElementById('dashboard-status-msg');
    if (_dashRetryTimer) { clearTimeout(_dashRetryTimer); _dashRetryTimer = null; }
    try {
        const [statsRes, workersRes, notifsRes, empRes, chartsRes] = await Promise.all([
            apiFetch(`/dashboard/stats/${businessId}`),
            apiFetch(`/dashboard/active-workers/${businessId}`),
            apiFetch(`/notifications/${businessId}`),
            apiFetch(`/employees/${businessId}`),
            apiFetch(`/dashboard/charts/${businessId}`)
        ]);
        if (!statsRes.ok) throw new Error(`stats ${statsRes.status}`);
        const stats = await statsRes.json();
        const workers = workersRes.ok ? await workersRes.json() : [];
        const notifs = notifsRes.ok ? await notifsRes.json() : [];
        const emps = empRes.ok ? await empRes.json() : [];
        const charts = chartsRes.ok ? await chartsRes.json() : null;

        statusBar.style.display = 'none';
        if (charts) renderDashboardCharts(charts);

        document.getElementById('stat-active').textContent = stats.active_count ?? 0;
        document.getElementById('stat-hours').textContent = (stats.total_hours ?? 0).toLocaleString('he-IL');
        document.getElementById('stat-total-emp').textContent = emps.filter(e => e.is_active).length;
        document.getElementById('stat-leave').textContent = stats.pending_leave ?? 0;
        setCount('leave-badge', stats.pending_leave);

        renderNotifications(notifs);

        const container = document.getElementById('active-workers-list');
        container.innerHTML = !workers.length
            ? '<p class="empty">אף אחד לא במשמרת כרגע</p>'
            : workers.map(w => `
                <div class="worker-row">
                    <div>
                        <p class="name"><span class="live-dot"></span>${escapeHtml(w.full_name)}</p>
                        <p class="meta num">נכנס ב-${formatTime(w.clock_in)}, ${escapeHtml(w.hours_so_far)} שעות עד עכשיו
                            ${w.hours_so_far > 8 ? '<span class="badge badge-amber" style="margin-right:6px">שעות נוספות</span>' : ''}</p>
                    </div>
                    <button onclick="forceOut(${w.shift_id}, ${jsArg(w.full_name)})" class="btn btn-ghost btn-sm">רישום יציאה</button>
                </div>`).join('');
    } catch (e) {
        console.error('Dashboard load failed:', e);
        statusBar.style.display = 'flex';
        statusMsg.textContent = 'השרת מתעורר משינה. מנסה שוב בעוד 15 שניות…';
        _dashRetryTimer = setTimeout(() => { statusMsg.textContent = 'מתחבר מחדש…'; loadDashboard(); }, 15000);
    }
}

function setCount(id, n) {
    const el = document.getElementById(id);
    if (!el) return;
    if (n > 0) { el.textContent = n; el.style.display = 'inline-flex'; } else el.style.display = 'none';
}

// Strip the emoji the server puts at the start of notification messages
function cleanMsg(m) { return String(m || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s*[✅❌]\s*$/u, ''); }

const NOTIF_NAV = {
    registration_pending: { label: 'להצטרפות לעסק', tab: 'approvals' },
    leave_pending: { label: 'לבקשות ההיעדרות', tab: 'leave' },
};

function notifHTML(n) {
    const nav = NOTIF_NAV[n.type];
    return `
        <div class="notif-item">
            <div>
                <p>${escapeHtml(cleanMsg(n.message))}</p>
                ${nav ? `<button class="nav-chip" onclick="switchTab('${nav.tab}'); closeNotifDropdown();">${nav.label}</button>` : ''}
            </div>
            <button class="x" onclick="dismissNotif(${n.id})" title="סימון כנקרא" aria-label="סימון כנקרא">${ICON('x')}</button>
        </div>`;
}

function renderNotifications(notifs) {
    const container = document.getElementById('notif-list');
    const badge = document.getElementById('notif-badge');
    if (!notifs.length) { container.innerHTML = '<p class="empty">אין עדכונים חדשים</p>'; badge.style.display = 'none'; return; }
    badge.textContent = notifs.length; badge.style.display = 'flex';
    container.innerHTML = notifs.slice(0, 5).map(notifHTML).join('');
}

async function loadNotifications() {
    try {
        const res = await apiFetch(`/notifications/${businessId}`);
        if (res.ok) renderNotifications(await res.json());
    } catch {}
}

async function dismissNotif(id) {
    await apiFetch(`/notifications/mark-read/${id}`, { method: 'POST' });
    loadNotifDropdown();
    if (currentTab === 'dashboard') loadDashboard();
}

function toggleNotifDropdown(e) {
    e.stopPropagation();
    const dd = document.getElementById('notif-dropdown');
    if (dd.classList.contains('open')) dd.classList.remove('open');
    else { loadNotifDropdown(); dd.classList.add('open'); }
}
function closeNotifDropdown() { document.getElementById('notif-dropdown')?.classList.remove('open'); }

async function loadNotifDropdown() {
    try {
        const res = await apiFetch(`/notifications/${businessId}`);
        if (res.ok) { const data = await res.json(); renderNotifications(data); renderNotifDropdown(data); }
    } catch {}
}

function renderNotifDropdown(notifs) {
    const list = document.getElementById('notif-dropdown-list');
    list.innerHTML = notifs.length ? notifs.map(notifHTML).join('') : '<p class="empty">אין התראות חדשות</p>';
}

async function markAllRead() {
    try {
        await apiFetch(`/notifications/mark-all-read/${businessId}`, { method: 'POST' });
        closeNotifDropdown();
        loadNotifications();
        if (currentTab === 'dashboard') loadDashboard();
    } catch {}
}

async function forceOut(shiftId, name) {
    if (!confirm(`לרשום יציאה עכשיו עבור ${name || 'העובד'}?`)) return;
    await apiFetch(`/shifts/force-out/${shiftId}`, { method: 'POST' });
    loadDashboard();
}

// ==================== CHARTS ====================
let _chartWeekly = null, _chartTop = null;
function renderDashboardCharts(data) {
    if (!window.Chart) return;
    const grid = 'rgba(38,53,79,.7)';
    const base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };

    if (_chartWeekly) _chartWeekly.destroy();
    _chartWeekly = new Chart(document.getElementById('chart-weekly'), {
        type: 'bar',
        data: { labels: data.weekly.labels, datasets: [{ data: data.weekly.hours, backgroundColor: '#F5B83D', borderRadius: 6, maxBarThickness: 34 }] },
        // RTL: Sunday on the right, value axis on the right
        options: { ...base, scales: { x: { reverse: true, grid: { display: false } }, y: { position: 'right', grid: { color: grid }, beginAtZero: true, ticks: { precision: 0 } } } }
    });

    if (_chartTop) _chartTop.destroy();
    const box = document.getElementById('chart-top').parentElement;
    box.querySelector('.empty')?.remove();
    if (!data.top_employees.length) { box.insertAdjacentHTML('beforeend', '<p class="empty">אין עדיין שעות החודש</p>'); return; }
    _chartTop = new Chart(document.getElementById('chart-top'), {
        type: 'bar',
        data: { labels: data.top_employees.map(e => e.name), datasets: [{ data: data.top_employees.map(e => e.hours), backgroundColor: '#8E7DF7', borderRadius: 6, maxBarThickness: 26 }] },
        // RTL: bars grow from the right, names on the right
        options: { ...base, indexAxis: 'y', scales: { x: { reverse: true, grid: { color: grid }, beginAtZero: true }, y: { position: 'right', grid: { display: false } } } }
    });
}

// ==================== EMPLOYEES ====================
async function loadEmployees() {
    try {
        const res = await apiFetch(`/employees/${businessId}`);
        employees = await res.json();
        const tbody = document.getElementById('employees-table');
        tbody.innerHTML = !employees.length
            ? '<tr><td colspan="6" class="empty">עוד אין עובדים. הוסף עובד ראשון, או שתף את קוד ההצטרפות</td></tr>'
            : employees.map(e => `
                <tr>
                    <td class="strong">${escapeHtml(e.full_name)}</td>
                    <td><span class="badge ${e.role === 'manager' ? 'badge-amber' : 'badge-gray'}">${e.role === 'manager' ? 'מנהל' : 'עובד'}</span></td>
                    <td>${e.hourly_rate ? '₪' + e.hourly_rate : '<span class="faint">–</span>'}</td>
                    <td style="direction:ltr;text-align:right">${escapeHtml(e.phone) || '<span class="faint">–</span>'}</td>
                    <td><span class="badge ${e.is_active ? 'badge-green' : 'badge-gray'}">${e.is_active ? 'פעיל' : 'מושבת'}</span></td>
                    <td style="text-align:left;white-space:nowrap">
                        <button onclick="openEmployeeModal(${e.id})" class="link-btn">עריכה</button>
                        ${e.is_active ? `<button onclick="deactivateEmployee(${e.id})" class="link-btn danger">השבתה</button>` : ''}
                    </td>
                </tr>`).join('');
        const sel = document.getElementById('filter-worker');
        const cur = sel.value;
        sel.innerHTML = '<option value="">כל העובדים</option>' + employees.map(e => `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`).join('');
        sel.value = cur;
    } catch (e) { console.error(e); }
}

function openEmployeeModal(id = null) {
    document.getElementById('emp-id').value = id || '';
    document.getElementById('emp-name').value = '';
    document.getElementById('emp-role').value = 'worker';
    document.getElementById('emp-passcode').value = '';
    document.getElementById('emp-passcode').placeholder = id ? 'השאר ריק כדי לא לשנות' : 'לפחות 4 תווים';
    document.getElementById('emp-passcode-hint').textContent = id ? '(רק אם רוצים להחליף)' : '';
    document.getElementById('emp-rate').value = '';
    document.getElementById('emp-phone').value = '';
    document.getElementById('emp-email').value = '';
    document.getElementById('emp-error').textContent = '';
    document.getElementById('employee-modal-title').textContent = id ? 'עריכת עובד' : 'הוספת עובד';
    if (id) {
        const emp = employees.find(e => e.id === id);
        if (emp) {
            document.getElementById('emp-name').value = emp.full_name;
            document.getElementById('emp-role').value = emp.role;
            document.getElementById('emp-rate').value = emp.hourly_rate || '';
            document.getElementById('emp-phone').value = emp.phone || '';
            document.getElementById('emp-email').value = emp.email || '';
        }
    }
    openModal('employee-modal');
    setTimeout(() => document.getElementById('emp-name').focus(), 50);
}

async function saveEmployee() {
    const id = document.getElementById('emp-id').value;
    const name = document.getElementById('emp-name').value.trim();
    const passcode = document.getElementById('emp-passcode').value.trim();
    const err = document.getElementById('emp-error');
    if (!name) { err.textContent = 'חסר שם מלא'; return; }
    if (!id && !passcode) { err.textContent = 'חסרה סיסמה לעובד החדש'; return; }
    if (passcode && passcode.length < 4) { err.textContent = 'הסיסמה צריכה לפחות 4 תווים'; return; }
    const body = {
        full_name: name,
        role: document.getElementById('emp-role').value,
        passcode: passcode || undefined,
        hourly_rate: parseFloat(document.getElementById('emp-rate').value) || 0,
        phone: document.getElementById('emp-phone').value || null,
        email: document.getElementById('emp-email').value || null,
    };
    try {
        const res = id
            ? await apiFetch(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(body) })
            : await apiFetch('/employees/', { method: 'POST', body: JSON.stringify({ ...body, business_id: parseInt(businessId) }) });
        if (!res.ok) { const d = await res.json(); err.textContent = d.detail || 'השמירה נכשלה'; return; }
        closeModal('employee-modal');
        loadEmployees();
    } catch { err.textContent = 'אין חיבור לשרת. נסה שוב'; }
}

async function deactivateEmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!confirm(`להשבית את ${emp ? emp.full_name : 'העובד'}? הוא לא יוכל להתחבר, וההיסטוריה שלו תישמר.`)) return;
    const res = await apiFetch(`/employees/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'ההשבתה נכשלה'); }
    loadEmployees();
}

// ==================== LEAVE ====================
let currentLeaveFilter = 'all';
const LEAVE_TYPES = { vacation: 'חופשה', sick: 'מחלה', personal: 'אישי', other: 'אחר' };
const LEAVE_STATUS = { pending: ['ממתינה', 'badge-amber'], approved: ['אושרה', 'badge-green'], rejected: ['נדחתה', 'badge-rose'] };

function formatDate(d) { return d ? new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) : '–'; }

async function loadLeave(filter = currentLeaveFilter) {
    currentLeaveFilter = filter;
    ['all', 'pending', 'approved', 'rejected'].forEach(f =>
        document.getElementById(`leave-filter-${f}`)?.classList.toggle('active', f === filter));
    const url = filter === 'all' ? `/leave/${businessId}` : `/leave/${businessId}?status=${filter}`;
    try {
        const res = await apiFetch(url);
        const requests = await res.json();
        const container = document.getElementById('leave-list');
        if (!requests.length) { container.innerHTML = '<p class="empty">אין בקשות בתצוגה הזו</p>'; return; }
        container.innerHTML = requests.map(r => {
            const [label, cls] = LEAVE_STATUS[r.status] || [r.status, 'badge-gray'];
            const days = r.start_date === r.end_date ? formatDate(r.start_date) : `${formatDate(r.start_date)} עד ${formatDate(r.end_date)}`;
            return `
            <div class="card ${r.status === 'pending' ? 'attention' : ''}">
                <div class="card-row">
                    <div>
                        <p class="title">${escapeHtml(r.full_name)} <span class="muted" style="font-weight:400">· ${escapeHtml(LEAVE_TYPES[r.leave_type] || r.leave_type)}</span></p>
                        <p class="meta num">${days}</p>
                    </div>
                    <span class="badge ${cls}">${label}</span>
                </div>
                ${r.reason ? `<p class="quote">${escapeHtml(r.reason)}</p>` : ''}
                ${r.manager_note ? `<p class="quote faint">ההערה שלך: ${escapeHtml(r.manager_note)}</p>` : ''}
                ${r.status === 'pending' ? `
                    <div class="actions" style="margin-top:12px">
                        <button onclick="promptLeaveAction(${r.id}, 'approved')" class="btn btn-ok btn-sm">אישור</button>
                        <button onclick="promptLeaveAction(${r.id}, 'rejected')" class="btn btn-danger btn-sm">דחייה</button>
                    </div>` : ''}
            </div>`;
        }).join('');
    } catch (e) { console.error(e); }
}

function promptLeaveAction(id, action) {
    document.getElementById('leave-note-id').value = id;
    document.getElementById('leave-note-action').value = action;
    document.getElementById('leave-note-title').textContent = action === 'approved' ? 'אישור הבקשה' : 'דחיית הבקשה';
    document.getElementById('leave-note-confirm').textContent = action === 'approved' ? 'אישור' : 'דחייה';
    document.getElementById('leave-note-text').value = '';
    openModal('leave-note-modal');
}

async function confirmLeaveAction() {
    const id = document.getElementById('leave-note-id').value;
    const status = document.getElementById('leave-note-action').value;
    const note = document.getElementById('leave-note-text').value;
    try {
        await apiFetch(`/leave/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, manager_note: note }) });
        closeModal('leave-note-modal');
        loadLeave();
        loadDashboard();
    } catch {}
}

// ==================== SHIFT HISTORY ====================
function getShiftFilters() {
    const workerId = document.getElementById('filter-worker')?.value;
    const fromDate = document.getElementById('filter-from')?.value;
    const toDate = document.getElementById('filter-to')?.value;
    const params = [];
    if (workerId) params.push(`worker_id=${workerId}`);
    if (fromDate) params.push(`from_date=${fromDate}T00:00:00`);
    if (toDate) params.push(`to_date=${toDate}T23:59:59`);
    return params.length ? '?' + params.join('&') : '';
}

function clearShiftFilters() {
    document.getElementById('filter-from').value = '';
    document.getElementById('filter-to').value = '';
    document.getElementById('filter-worker').value = '';
    loadAllShifts();
    loadEmployeeSummary();
}

async function loadAllShifts() {
    try {
        const res = await apiFetch(`/dashboard/all-shifts/${businessId}${getShiftFilters()}`);
        const shifts = await res.json();
        const tbody = document.getElementById('shifts-table');
        tbody.innerHTML = !shifts.length
            ? '<tr><td colspan="5" class="empty">אין משמרות בטווח הזה</td></tr>'
            : shifts.map(s => `
                <tr>
                    <td class="strong">${escapeHtml(s.full_name)}</td>
                    <td>${formatDateTime(s.clock_in)}</td>
                    <td>${s.clock_out ? formatDateTime(s.clock_out) : '<span class="badge badge-green">במשמרת</span>'}</td>
                    <td>${s.total_hours != null ? s.total_hours : '<span class="faint">–</span>'}</td>
                    <td style="text-align:left"><button onclick="openEditShift(${s.shift_id}, '${s.clock_in}', '${s.clock_out || ''}')" class="link-btn">תיקון</button></td>
                </tr>`).join('');
    } catch (e) { console.error(e); }
}

async function loadEmployeeSummary() {
    const fromDate = document.getElementById('filter-from')?.value;
    const toDate = document.getElementById('filter-to')?.value;
    const params = [];
    if (fromDate) params.push(`from_date=${fromDate}T00:00:00`);
    if (toDate) params.push(`to_date=${toDate}T23:59:59`);
    const qs = params.length ? '?' + params.join('&') : '';
    try {
        const res = await apiFetch(`/dashboard/employee-summary/${businessId}${qs}`);
        const data = await res.json();
        const active = data.filter(e => e.total_shifts > 0).sort((a, b) => b.total_hours - a.total_hours);
        document.getElementById('shifts-summary').innerHTML = active.map(e => `
            <div class="card">
                <p class="title" style="font-size:15px">${escapeHtml(e.full_name)}</p>
                <p class="num" style="font-size:26px;font-weight:500;margin-top:4px">${e.total_hours}</p>
                <p class="meta">שעות ב-${e.total_shifts} משמרות</p>
            </div>`).join('');
    } catch {}
}

async function populateWorkerFilter() { if (!employees.length) await loadEmployees(); }

function openEditShift(id, clockIn, clockOut) {
    document.getElementById('edit-shift-id').value = id;
    document.getElementById('edit-clock-in').value = clockIn ? clockIn.slice(0, 16) : '';
    document.getElementById('edit-clock-out').value = clockOut ? clockOut.slice(0, 16) : '';
    openModal('edit-shift-modal');
}

async function saveShiftEdit() {
    const id = document.getElementById('edit-shift-id').value;
    const body = { clock_in: document.getElementById('edit-clock-in').value, clock_out: document.getElementById('edit-clock-out').value };
    try {
        const res = await apiFetch(`/shifts/edit/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (res.ok) { closeModal('edit-shift-modal'); loadAllShifts(); loadEmployeeSummary(); }
        else { const d = await res.json(); alert(d.detail || 'השמירה נכשלה'); }
    } catch {}
}

async function deleteShift() {
    const id = document.getElementById('edit-shift-id').value;
    if (!confirm('למחוק את המשמרת לצמיתות? אי אפשר לשחזר אותה.')) return;
    try {
        const res = await apiFetch(`/shifts/${id}`, { method: 'DELETE' });
        if (res.ok) { closeModal('edit-shift-modal'); loadAllShifts(); loadEmployeeSummary(); }
        else { const d = await res.json(); alert(d.detail || 'המחיקה נכשלה'); }
    } catch {}
}

// ==================== REPORTS ====================
const ils = n => '₪' + Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 });

async function loadReport() {
    const monthVal = document.getElementById('report-month').value;
    if (!monthVal) { alert('בחר חודש'); return; }
    const [year, month] = monthVal.split('-');
    try {
        const res = await apiFetch(`/reports/monthly/${businessId}?year=${year}&month=${month}`);
        const data = await res.json();
        const summary = document.getElementById('report-summary');
        summary.style.display = 'grid';
        summary.style.marginBottom = '16px';
        summary.innerHTML = `
            <div class="kpi"><p>סה"כ שעות</p><strong>${data.grand_total_hours.toLocaleString('he-IL')}</strong></div>
            <div class="kpi"><p>שכר משוער כולל</p><strong>${ils(data.grand_total_salary)}</strong></div>`;
        const rows = data.employees.filter(e => e.total_shifts > 0 || e.role !== 'manager').map(e => `
            <tr>
                <td class="strong">${escapeHtml(e.full_name)}</td>
                <td><span class="badge ${e.role === 'manager' ? 'badge-amber' : 'badge-gray'}">${e.role === 'manager' ? 'מנהל' : 'עובד'}</span></td>
                <td>${e.total_shifts}</td>
                <td>${e.total_hours}</td>
                <td>${e.hourly_rate ? '₪' + e.hourly_rate : '<span class="faint">–</span>'}</td>
                <td class="strong">${ils(e.estimated_salary)}</td>
            </tr>`).join('');
        document.getElementById('report-table').innerHTML = (rows || '<tr><td colspan="6" class="empty">אין משמרות בחודש הזה</td></tr>') + `
            <tr class="total"><td colspan="3">סה"כ</td><td>${data.grand_total_hours}</td><td></td><td>${ils(data.grand_total_salary)}</td></tr>`;
    } catch (e) { console.error(e); }
}

async function exportCSV() {
    const monthVal = document.getElementById('report-month').value;
    if (!monthVal) { alert('בחר חודש'); return; }
    const [year, month] = monthVal.split('-');
    try {
        // SECURITY: the export needs the auth header, so download via fetch + blob
        const res = await apiFetch(`/reports/export/${businessId}?year=${year}&month=${month}`);
        if (!res.ok) { alert('הייצוא נכשל'); return; }
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url; a.download = `report_${year}_${month}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    } catch { alert('אין חיבור לשרת. נסה שוב'); }
}

// ==================== BRANCHES ====================
let branches = [];

async function loadBranches() {
    try {
        const res = await apiFetch(`/branches/${businessId}`);
        branches = await res.json();
        const container = document.getElementById('branches-list');
        container.innerHTML = !branches.length
            ? '<p class="empty">עוד אין סניפים. אפשר להוסיף סניף ראשון</p>'
            : branches.map(b => `
                <div class="card">
                    <div class="card-row">
                        <p class="title">${escapeHtml(b.name)}</p>
                        <div class="actions">
                            <button onclick="openBranchModal(${b.id})" class="link-btn">עריכה</button>
                            <button onclick="deleteBranch(${b.id})" class="link-btn danger">מחיקה</button>
                        </div>
                    </div>
                    ${b.address ? `<p class="meta">${escapeHtml(b.address)}</p>` : ''}
                </div>`).join('');
    } catch {}
}

function openBranchModal(id = null) {
    document.getElementById('branch-id').value = id || '';
    document.getElementById('branch-modal-title').textContent = id ? 'עריכת סניף' : 'הוספת סניף';
    const b = id ? branches.find(x => x.id === id) : null;
    document.getElementById('branch-name').value = b?.name || '';
    document.getElementById('branch-address').value = b?.address || '';
    openModal('branch-modal');
}

async function saveBranch() {
    const id = document.getElementById('branch-id').value;
    const name = document.getElementById('branch-name').value.trim();
    if (!name) { alert('חסר שם לסניף'); return; }
    const body = { business_id: parseInt(businessId), name, address: document.getElementById('branch-address').value };
    try {
        if (id) await apiFetch(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        else await apiFetch('/branches/', { method: 'POST', body: JSON.stringify(body) });
        closeModal('branch-modal');
        loadBranches();
    } catch {}
}

async function deleteBranch(id) {
    if (!confirm('למחוק את הסניף?')) return;
    await apiFetch(`/branches/${id}`, { method: 'DELETE' });
    loadBranches();
}

// ==================== AI ====================
let aiChatHistory = [];
let aiPendingActions = {};
let aiActionSeq = 0;
const AI_SUGGESTIONS = ['מי עבד הכי הרבה שעות החודש?', 'מי במשמרת עכשיו?', 'אילו בקשות חופש ממתינות?', 'מי ביקש משמרת ערב בשבוע הבא?'];

function ensureAIEmptyState() {
    const box = document.getElementById('ai-response');
    if (box.children.length) return;
    box.innerHTML = `
        <div class="ai-empty">
            <svg class="i" style="width:34px;height:34px;color:var(--day)"><use href="#i-spark"/></svg>
            <h3>שאל על העסק, או בקש פעולה</h3>
            <p>העוזר רואה את העובדים, הסידור, הנוכחות והבקשות. כשהוא מציע לשנות משהו, השינוי קורה רק אחרי שתאשר.</p>
            <div class="ai-suggest">${AI_SUGGESTIONS.map(s => `<button onclick="askAI(${jsArg(s)})">${escapeHtml(s)}</button>`).join('')}</div>
        </div>`;
}

async function askAI(preset) {
    const input = document.getElementById('ai-input');
    const q = (typeof preset === 'string' ? preset : input.value).trim();
    if (!q) return;
    const box = document.getElementById('ai-response');
    box.querySelector('.ai-empty')?.remove();
    box.insertAdjacentHTML('beforeend', `<div class="msg me">${escapeHtml(q)}</div><div id="ai-thinking" class="msg ai thinking">חושב…</div>`);
    box.scrollTop = box.scrollHeight;
    input.value = '';
    aiChatHistory.push({ role: 'user', content: q });
    try {
        const res = await apiFetch('/ai/manager-ask', { method: 'POST', body: JSON.stringify({ query: q, history: aiChatHistory.slice(0, -1) }) });
        const data = await res.json();
        const answer = data.answer || data.detail || 'לא התקבלה תשובה.';
        aiChatHistory.push({ role: 'model', content: answer });
        document.getElementById('ai-thinking')?.remove();
        // SECURITY: escape the answer; render **bold** only
        const html = escapeHtml(answer).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        box.insertAdjacentHTML('beforeend', `<div class="msg ai ${res.ok ? '' : 'error'}">${html}</div>`);
        renderPendingActions(box, data.pending_actions || []);
        box.scrollTop = box.scrollHeight;
    } catch (err) {
        console.error('AI Error:', err);
        document.getElementById('ai-thinking')?.remove();
        box.insertAdjacentHTML('beforeend', '<div class="msg ai error">אין חיבור לשרת. נסה שוב</div>');
    }
}

function renderPendingActions(box, actions) {
    actions.forEach(a => {
        const id = 'ai-action-' + (++aiActionSeq);
        aiPendingActions[id] = a;
        box.insertAdjacentHTML('beforeend', `
            <div id="${id}" class="ai-action">
                <span>${escapeHtml(a.description)}</span>
                <span class="actions">
                    <button onclick="confirmAIAction('${id}')" class="btn btn-primary btn-sm">אישור וביצוע</button>
                    <button onclick="dismissAIAction('${id}')" class="btn btn-ghost btn-sm">ביטול</button>
                </span>
            </div>`);
    });
}

async function confirmAIAction(id) {
    const a = aiPendingActions[id];
    const el = document.getElementById(id);
    if (!a || !el) return;
    el.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
        const res = await apiFetch('/ai/execute-action', { method: 'POST', body: JSON.stringify({ tool: a.tool, args: a.args }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'הפעולה נכשלה');
        el.className = 'ai-action done';
        el.innerHTML = `<span>בוצע: ${escapeHtml(data.description)}</span>`;
        aiChatHistory.push({ role: 'user', content: `(המנהל אישר ובוצע: ${data.description})` });
    } catch (e) {
        el.className = 'ai-action fail';
        el.innerHTML = `<span>${escapeHtml(e.message)}</span>`;
    }
    delete aiPendingActions[id];
}

function dismissAIAction(id) {
    const el = document.getElementById(id);
    if (el) { el.className = 'ai-action cancel'; el.innerHTML = `<span>בוטל: ${escapeHtml(aiPendingActions[id]?.description || '')}</span>`; }
    delete aiPendingActions[id];
}

function clearAIChat() {
    aiPendingActions = {};
    aiChatHistory = [];
    document.getElementById('ai-response').innerHTML = '';
    ensureAIEmptyState();
}

// ==================== MANAGE SHIFTS (live attendance) ====================
function nowLocalISO() {
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

async function loadManageShifts() {
    try {
        const res = await apiFetch(`/shifts/status/${businessId}`);
        const workers = (await res.json()).filter(w => w.is_active !== false)
            .sort((a, b) => (b.clocked_in - a.clocked_in) || a.full_name.localeCompare(b.full_name, 'he'));
        const container = document.getElementById('manage-shifts-list');
        container.innerHTML = !workers.length ? '<p class="empty">אין עובדים</p>' : workers.map(w => `
            <div class="card ${w.clocked_in ? 'on' : ''}">
                <div class="card-row">
                    <div>
                        <p class="title">${w.clocked_in ? '<span class="live-dot"></span>' : ''}${escapeHtml(w.full_name)}</p>
                        <p class="meta num">${w.clocked_in ? `במשמרת מאז ${formatDateTime(w.clock_in)}` : 'לא במשמרת'}</p>
                    </div>
                    ${w.clocked_in
                        ? `<button onclick="openManualCloseModal(${w.shift_id}, ${jsArg(w.full_name)}, '${w.clock_in}')" class="btn btn-ghost btn-sm">רישום יציאה</button>`
                        : `<button onclick="openManualOpenModal(${w.user_id}, ${jsArg(w.full_name)})" class="btn btn-ok btn-sm">רישום כניסה</button>`}
                </div>
            </div>`).join('');
    } catch (e) { console.error(e); }
}

function openManualOpenModal(userId, name) {
    document.getElementById('manual-open-user-id').value = userId;
    document.getElementById('manual-open-name').textContent = name;
    document.getElementById('manual-open-time').value = nowLocalISO();
    document.getElementById('manual-open-error').textContent = '';
    openModal('manual-open-modal');
}

async function confirmManualOpen() {
    const userId = document.getElementById('manual-open-user-id').value;
    const clockIn = document.getElementById('manual-open-time').value;
    const errEl = document.getElementById('manual-open-error');
    if (!clockIn) { errEl.textContent = 'בחר שעת כניסה'; return; }
    try {
        const res = await apiFetch('/shifts/manual-open', { method: 'POST', body: JSON.stringify({ user_id: parseInt(userId), clock_in: clockIn }) });
        if (res.ok) { closeModal('manual-open-modal'); loadManageShifts(); loadDashboard(); }
        else { const d = await res.json(); errEl.textContent = d.detail || 'הפעולה נכשלה'; }
    } catch { errEl.textContent = 'אין חיבור לשרת. נסה שוב'; }
}

function openManualCloseModal(shiftId, name, clockIn) {
    document.getElementById('manual-close-shift-id').value = shiftId;
    document.getElementById('manual-close-name').textContent = name;
    document.getElementById('manual-close-clockin').textContent = `נכנס ב-${formatDateTime(clockIn)}`;
    document.getElementById('manual-close-time').value = nowLocalISO();
    document.getElementById('manual-close-error').textContent = '';
    openModal('manual-close-modal');
}

async function confirmManualClose() {
    const shiftId = document.getElementById('manual-close-shift-id').value;
    const clockOut = document.getElementById('manual-close-time').value;
    const errEl = document.getElementById('manual-close-error');
    if (!clockOut) { errEl.textContent = 'בחר שעת יציאה'; return; }
    try {
        const res = await apiFetch(`/shifts/manual-close/${shiftId}`, { method: 'POST', body: JSON.stringify({ clock_out: clockOut }) });
        if (res.ok) { closeModal('manual-close-modal'); loadManageShifts(); loadDashboard(); }
        else { const d = await res.json(); errEl.textContent = d.detail || 'הפעולה נכשלה'; }
    } catch { errEl.textContent = 'אין חיבור לשרת. נסה שוב'; }
}

// ==================== APPROVALS ====================
let joinCode = '';

async function loadJoinCode() {
    try {
        const res = await apiFetch(`/businesses/${businessId}/join-code`);
        const data = await res.json();
        joinCode = data.join_code;
        document.getElementById('join-code-display').textContent = joinCode;
        document.getElementById('register-link').textContent = `${window.location.origin}/employee-register.html?code=${joinCode}`;
    } catch {}
}

async function regenerateCode() {
    if (!confirm('ליצור קוד חדש? הקוד הנוכחי יפסיק לעבוד.')) return;
    const res = await apiFetch(`/businesses/${businessId}/regenerate-code`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(data.detail || 'הפעולה נכשלה'); return; }
    joinCode = data.join_code;
    loadJoinCode();
}

function copyJoinCode() {
    const link = document.getElementById('register-link').textContent;
    navigator.clipboard.writeText(link).then(() => {
        const btn = document.querySelector('#tab-approvals .btn-primary');
        const old = btn.innerHTML;
        btn.textContent = 'הקישור הועתק';
        setTimeout(() => btn.innerHTML = old, 1800);
    });
}

async function loadApprovalsBadge() {
    try {
        const res = await apiFetch(`/register/pending/${businessId}`);
        if (res.ok) setCount('approvals-badge', (await res.json()).length);
    } catch {}
}

async function loadApprovals() {
    try {
        const res = await apiFetch(`/register/pending/${businessId}`);
        const users = await res.json();
        setCount('approvals-badge', users.length);
        const container = document.getElementById('approvals-list');
        container.innerHTML = !users.length ? '<p class="empty">אין בקשות שממתינות לאישור</p>' : users.map(u => `
            <div class="card attention">
                <div class="card-row">
                    <div>
                        <p class="title">${escapeHtml(u.full_name)}</p>
                        <p class="meta" style="direction:ltr;text-align:right">${[u.phone, u.email].filter(Boolean).map(escapeHtml).join(' · ') || '&nbsp;'}</p>
                    </div>
                    <div class="actions">
                        <button onclick="handleApproval(${u.id}, 'approve', ${jsArg(u.full_name)})" class="btn btn-ok btn-sm">אישור</button>
                        <button onclick="handleApproval(${u.id}, 'reject', ${jsArg(u.full_name)})" class="btn btn-danger btn-sm">דחייה</button>
                    </div>
                </div>
            </div>`).join('');
    } catch (e) { console.error(e); }
}

async function handleApproval(userId, action, name) {
    if (!confirm(`${action === 'approve' ? 'לאשר' : 'לדחות'} את ${name || 'העובד'}?`)) return;
    await apiFetch(`/register/${userId}/${action}`, { method: 'PUT' });
    loadApprovals();
    loadEmployees();
    loadDashboard();
}

// ==================== UTILS ====================
function formatTime(dt) { return dt ? new Date(dt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }) : '–'; }
function formatDateTime(dt) { return dt ? new Date(dt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '–'; }

// ==================== ROSTER ====================
const SHIFT_LABELS = { morning: 'בוקר', evening: 'ערב', double: 'כפולה', off: '+' };
const PREF_LABELS = { morning: 'ביקש בוקר', evening: 'ביקש ערב', double: 'ביקש כפולה' };
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const POSITIONS = ['', 'מטבח', 'פס', 'גריל', 'בר', 'קופה', 'מלצרות'];
let rosterWeekStart = getSunday(new Date());
let rosterData = {};
let rosterViewData = null;
let rosterLocked = false;
let rosterMode = 'edit';

function getSunday(d) { const day = new Date(d); day.setDate(day.getDate() - day.getDay()); day.setHours(0, 0, 0, 0); return day; }
function rosterPrevWeek() { rosterWeekStart = new Date(rosterWeekStart.getTime() - 7 * 86400000); loadRoster(); }
function rosterNextWeek() { rosterWeekStart = new Date(rosterWeekStart.getTime() + 7 * 86400000); loadRoster(); }
function rosterKey(userId, day) { return `${userId}_${day}`; }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function loadRoster() {
    const weekStr = isoDate(rosterWeekStart);
    const end = new Date(rosterWeekStart.getTime() + 6 * 86400000);
    const fmt = d => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
    document.getElementById('roster-week-label').textContent = `${fmt(rosterWeekStart)} – ${fmt(end)}`;

    const [res, prefRes] = await Promise.all([
        apiFetch(`/roster/${businessId}?week_start=${weekStr}`),
        apiFetch(`/roster/preferences/${businessId}?week_start=${weekStr}`)
    ]);
    if (!res.ok) return;
    const data = await res.json();
    const prefs = prefRes.ok ? await prefRes.json() : [];
    const prefMap = {};
    prefs.forEach(p => { prefMap[`${p.user_id}_${p.day}`] = p.preference; });
    rosterData = {};
    rosterViewData = data;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    rosterLocked = new Date(rosterWeekStart.getTime() + 7 * 86400000) <= today;
    document.getElementById('btn-save-roster').style.display = rosterLocked ? 'none' : '';
    document.getElementById('roster-lock-msg').style.display = rosterLocked ? '' : 'none';
    document.getElementById('roster-table').classList.toggle('locked', rosterLocked);

    const todayIdx = Math.round((today - rosterWeekStart) / 86400000);
    document.getElementById('roster-head').innerHTML = `<tr><th class="emp">עובד</th>${DAY_NAMES.map((d, i) => {
        const date = new Date(rosterWeekStart.getTime() + i * 86400000);
        return `<th${i === todayIdx ? ' style="color:var(--day)"' : ''}>${d}<small class="num">${fmt(date)}</small></th>`;
    }).join('')}</tr>`;

    document.getElementById('roster-body').innerHTML = data.employees.map(emp => {
        emp.days.forEach((item, d) => {
            rosterData[rosterKey(emp.id, d)] = { shift_type: item.shift_type || 'off', position: item.position || '', note: item.note || '' };
        });
        return `<tr><td class="emp">${escapeHtml(emp.name)}</td>${emp.days.map((item, d) => {
            const s = item.shift_type || 'off';
            const pref = prefMap[`${emp.id}_${d}`];
            const posOpts = POSITIONS.map(p => `<option value="${p}" ${item.position === p ? 'selected' : ''}>${p || 'עמדה'}</option>`).join('');
            return `<td>
                <span class="shift-cell s-${s}" role="button" tabindex="0" onclick="cycleShift(${emp.id},${d},this)"
                      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();cycleShift(${emp.id},${d},this)}"
                      data-uid="${emp.id}" data-day="${d}" data-shift="${s}">${SHIFT_LABELS[s]}</span>
                ${s === 'off' && pref ? `<div class="pref">${PREF_LABELS[pref] || pref}</div>` : ''}
                <div class="shift-extras" style="display:${s === 'off' ? 'none' : 'block'}">
                    <select onchange="updatePosition(${emp.id},${d},this)" ${rosterLocked ? 'disabled' : ''}>${posOpts}</select>
                    <input type="text" placeholder="הערה" value="${escapeHtml(item.note || '')}" onchange="updateNote(${emp.id},${d},this)" ${rosterLocked ? 'disabled' : ''}>
                </div>
            </td>`;
        }).join('')}</tr>`;
    }).join('');

    document.getElementById('roster-msg').style.display = data.employees.length ? 'none' : 'block';
    if (rosterMode === 'view') renderRosterView(data);
}

function cycleShift(userId, day, el) {
    if (rosterLocked) return;
    const order = ['off', 'morning', 'evening', 'double'];
    const next = order[(order.indexOf(el.dataset.shift) + 1) % order.length];
    el.dataset.shift = next;
    rosterData[rosterKey(userId, day)] = { ...(rosterData[rosterKey(userId, day)] || {}), shift_type: next };
    el.className = `shift-cell s-${next}`;
    el.textContent = SHIFT_LABELS[next];
    el.parentElement.querySelector('.pref')?.remove();
    const extras = el.parentElement.querySelector('.shift-extras');
    if (extras) extras.style.display = next === 'off' ? 'none' : 'block';
    markRosterDirty(true);
}

function updatePosition(userId, day, sel) {
    rosterData[rosterKey(userId, day)] = { ...(rosterData[rosterKey(userId, day)] || {}), position: sel.value };
    markRosterDirty(true);
}
function updateNote(userId, day, inp) {
    rosterData[rosterKey(userId, day)] = { ...(rosterData[rosterKey(userId, day)] || {}), note: inp.value };
    markRosterDirty(true);
}
function markRosterDirty(dirty) {
    document.getElementById('btn-save-roster').textContent = dirty ? 'שמירת השינויים' : 'שמירת הסידור';
}

async function saveRoster() {
    const btn = document.getElementById('btn-save-roster');
    btn.disabled = true; btn.textContent = 'שומר…';
    const entries = Object.entries(rosterData).map(([key, val]) => {
        const [user_id, day] = key.split('_');
        return { user_id: parseInt(user_id), day: parseInt(day), shift_type: val.shift_type || 'off', position: val.position || '', note: val.note || '' };
    });
    const res = await apiFetch(`/roster/${businessId}`, { method: 'POST', body: JSON.stringify({ week_start: isoDate(rosterWeekStart), entries }) });
    btn.disabled = false;
    if (res.ok) { btn.textContent = 'הסידור נשמר'; setTimeout(() => markRosterDirty(false), 1800); }
    else { const d = await res.json().catch(() => ({})); btn.textContent = 'שמירת השינויים'; alert(d.detail || 'השמירה נכשלה'); }
}

function setRosterMode(mode) {
    rosterMode = mode;
    const editEl = document.getElementById('roster-table').parentElement;
    const viewEl = document.getElementById('roster-view-panel');
    document.getElementById('btn-roster-edit').classList.toggle('active', mode === 'edit');
    document.getElementById('btn-roster-view').classList.toggle('active', mode === 'view');
    editEl.style.display = mode === 'view' ? 'none' : '';
    viewEl.style.display = mode === 'view' ? 'block' : 'none';
    if (mode === 'view' && rosterViewData) renderRosterView(rosterViewData);
}

function renderRosterView(data) {
    const container = document.getElementById('roster-view-panel');
    const rows = (workers, d) => workers.map(emp => {
        const pos = emp.days[d]?.position || '', note = emp.days[d]?.note || '';
        return `<tr><td class="strong">${escapeHtml(emp.name)}</td><td>${pos ? `<span class="badge badge-gray">${escapeHtml(pos)}</span>` : '<span class="faint">–</span>'}</td><td class="muted">${escapeHtml(note)}</td></tr>`;
    }).join('');
    const block = (label, color, workers, d) => !workers.length ? '' : `
        <div class="shift-block">
            <p class="lbl-s" style="color:${color}">${label}</p>
            <table class="data-table"><tbody>${rows(workers, d)}</tbody></table>
        </div>`;
    const html = DAY_NAMES.map((dayName, d) => {
        const date = new Date(rosterWeekStart.getTime() + d * 86400000).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
        const morning = data.employees.filter(e => ['morning', 'double'].includes(e.days[d]?.shift_type));
        const evening = data.employees.filter(e => ['evening', 'double'].includes(e.days[d]?.shift_type));
        if (!morning.length && !evening.length) return '';
        return `<div class="panel panel-b day-card">
            <h3>יום ${dayName} <span class="faint num" style="font-weight:400">${date}</span></h3>
            ${block('בוקר, 10:30–18:00', 'var(--day)', morning, d)}
            ${block('ערב, 18:00–23:00', '#B4A8FA', evening, d)}
        </div>`;
    }).join('');
    container.innerHTML = html || '<p class="empty">עוד לא שובצו משמרות בשבוע הזה</p>';
}
