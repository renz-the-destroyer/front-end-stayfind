// admin-extras.js — load AFTER admin.js.
//
// Later function declarations replace earlier ones of the same name, so
// admin.js stays untouched (same trick as messages-ui.js / home.js).
// Uses admin.js globals: API_BASE, adminKey, currentAdmin, adminHeaders,
// handleAuthError, nameMatchStatus, closeModal, openEditUser,
// openEditAdmin, deleteAdminAccount, deleteReview, approveLandlord,
// rejectLandlord, showDashboard, adminSignOut, adminTokenExpiresAt.

// ===================== HELPERS =====================

// Escapes text before it goes into innerHTML. Names, emails, comments and
// titles all come from users, so they must NEVER be inserted raw.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));
const $ = (id) => document.getElementById(id);
const PER_PAGE = 10;

const ex = {
    users: [], usersById: new Map(), userSearch: '', userRole: '', userStatus: '', userPage: 1,
    listings: [], listingsById: new Map(), listingSearch: '', listingCat: '', listingPage: 1,
    requests: new Map(),
    adminsById: new Map()
};

// Small success popups become toasts instead of blocking dialogs.
const AdminToast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2600, timerProgressBar: true });
const _swalFire = Swal.fire;
Swal.fire = function (a, b, c) {
    if (typeof a === 'string' && c === 'success') {
        return AdminToast.fire({ icon: 'success', title: a, text: b });
    }
    return _swalFire.apply(this, arguments);
};

async function adminGet(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: adminHeaders() });
    if (handleAuthError(res)) return null;
    if (!res.ok) throw new Error('Request failed (' + res.status + ')');
    return res.json();
}

// POST helper for hide / unhide / suspend / unsuspend / dismiss appeal.
// Returns null if the session ended, otherwise { ok, data }.
async function adminPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify(body || {})
    });
    if (handleAuthError(res)) return null;
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

function fmtDate(v) {
    const d = new Date(v);
    return isNaN(d) ? '—' : d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}
function monthLabel(ym) {
    const d = new Date(ym + '-01T00:00:00');
    return isNaN(d) ? ym : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
const initials = (name) => (String(name || '?').trim().charAt(0).toUpperCase() || '?');
const safeImg = (src) => /^(https:\/\/|data:image\/)/i.test(src || '');

function goPanel(name) {
    const link = document.querySelector(`.sidebar nav a[data-panel="${name}"]`);
    if (link) link.click();
}

// CSV download. Cells starting with = + - @ get a leading ' so Excel can't
// run them as formulas (CSV injection).
function downloadCsv(filename, header, rows) {
    const cell = (v) => {
        let s = String(v ?? '');
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
    };
    const csv = [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderPager(tbodyId, total, page, onGo) {
    const tbody = $(tbodyId);
    if (!tbody) return;
    const id = 'pager-' + tbodyId;
    let el = $(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'pager';
        tbody.closest('.table-wrap').insertAdjacentElement('afterend', el);
    }
    if (total === 0) { el.style.display = 'none'; return; }

    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const from = (page - 1) * PER_PAGE + 1;
    const to = Math.min(page * PER_PAGE, total);
    el.style.display = 'flex';
    el.innerHTML = `
        <span class="pager-info">Showing ${from}–${to} of ${total}</span>
        <div class="pager-btns">
            <button type="button" data-go="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page"><i class="fas fa-chevron-left"></i></button>
            <span class="pager-page">Page ${page} / ${pages}</span>
            <button type="button" data-go="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Next page"><i class="fas fa-chevron-right"></i></button>
        </div>`;
    el.onclick = (e) => {
        const b = e.target.closest('button[data-go]');
        if (b && !b.disabled) onGo(Number(b.dataset.go));
    };
}

// Turns a logged request (method + path) into a readable sentence.
// `label` is the real listing title / user name saved with the log entry; the
// "#id" is only a fallback. The hide/unhide/suspend/... lines must come BEFORE
// the generic /users/:id and /listings/:id matches below them.
function describeAction(method, rawPath, label) {
    const p = String(rawPath || '').replace(/^\/api\/admin/, '');
    let m;
    const who = (id, word) => label || `${word} #${id}`;
    if ((m = p.match(/^\/listings\/(\d+)\/dismiss-appeal/))) return `Declined the appeal for listing ${who(m[1], 'listing')}`;
    if ((m = p.match(/^\/listings\/(\d+)\/unhide/))) return `Unhid listing ${who(m[1], 'listing')}`;
    if ((m = p.match(/^\/listings\/(\d+)\/hide/))) return `Hid listing ${who(m[1], 'listing')}`;
    if ((m = p.match(/^\/users\/(\d+)\/unsuspend/))) return `Unsuspended user ${who(m[1], 'user')}`;
    if ((m = p.match(/^\/users\/(\d+)\/suspend/))) return `Suspended user ${who(m[1], 'user')}`;
    if ((m = p.match(/^\/landlord-requests\/(\d+)\/approve/))) return `Approved landlord request of ${who(m[1], 'user')}`;
    if ((m = p.match(/^\/landlord-requests\/(\d+)\/reject/))) return `Rejected landlord request of ${who(m[1], 'user')}`;
    if ((m = p.match(/^\/users\/(\d+)/))) return method === 'DELETE' ? `Deleted user ${who(m[1], 'user')}` : `Edited user ${who(m[1], 'user')}`;
    if ((m = p.match(/^\/listings\/(\d+)/))) return method === 'DELETE' ? `Deleted listing ${who(m[1], 'listing')}` : `Edited listing ${who(m[1], 'listing')}`;
    if ((m = p.match(/^\/reviews\/(\d+)/))) return `Deleted ${label || 'review #' + m[1]}`;
    if (/^\/admins/.test(p)) {
        m = p.match(/^\/admins\/(\d+)/);
        if (method === 'POST') return label ? `Created admin account for ${label}` : 'Created an admin account';
        return method === 'DELETE' ? `Deleted admin ${who(m ? m[1] : '?', 'admin')}` : `Edited admin ${who(m ? m[1] : '?', 'admin')}`;
    }
    return `${method} ${p}`;
}

// The audit-log endpoint answers { rows, hasMore }. This also accepts the old
// plain-array answer, so nothing breaks if the frontend is deployed first.
const auditRows = (data) => Array.isArray(data) ? data : ((data && data.rows) || []);

// ===================== MODERATION DIALOG =====================
// Asks for a reason (pick a template, or write your own). Returns the reason text,
// or null if the admin cancelled. Reuses the look of the "Reject request" dialog.
async function askModerationReason({ title, subjectLine, icon, templates, confirmText, note }) {
    const options = [...templates, 'Other (write your own reason)'];
    const OTHER_INDEX = options.length - 1;

    const { value, isConfirmed } = await Swal.fire({
        title,
        iconHtml: `<i class="fas ${icon}"></i>`,
        html: `
            ${subjectLine ? `<p class="reject-applicant">${subjectLine}</p>` : ''}
            <span class="reject-label">Reason</span>
            <div class="reject-options">
                ${options.map((t, i) => `
                    <label class="reject-option">
                        <input type="radio" name="modReason" value="${i}" ${i === 0 ? 'checked' : ''}>
                        <span>${esc(t)}</span>
                    </label>`).join('')}
            </div>
            <textarea id="modCustomReason" class="reject-textarea" placeholder="Write a custom reason..." maxlength="300"></textarea>
            <p class="reject-note"><i class="fas fa-circle-info"></i> ${esc(note)}</p>
        `,
        showCancelButton: true,
        confirmButtonText: confirmText,
        cancelButtonText: 'Cancel',
        reverseButtons: true,
        focusConfirm: false,
        buttonsStyling: false,
        customClass: {
            popup: 'reject-popup',
            icon: 'reject-icon',
            title: 'reject-title',
            htmlContainer: 'reject-html',
            actions: 'reject-actions',
            confirmButton: 'reject-confirm',
            cancelButton: 'reject-cancel'
        },
        didOpen: (popup) => {
            const textarea = popup.querySelector('#modCustomReason');
            popup.querySelectorAll('input[name="modReason"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    const isOther = radio.checked && radio.value === String(OTHER_INDEX);
                    textarea.classList.toggle('show', isOther);
                    if (isOther) textarea.focus();
                });
            });
        },
        preConfirm: () => {
            const checked = document.querySelector('input[name="modReason"]:checked');
            const textarea = document.getElementById('modCustomReason');
            if (!checked) { Swal.showValidationMessage('Please pick a reason.'); return false; }
            const isOther = checked.value === String(OTHER_INDEX);
            const text = isOther ? textarea.value.trim() : options[Number(checked.value)];
            if (!text || text.length < 3) { Swal.showValidationMessage('Please write a reason.'); return false; }
            return text;
        }
    });

    return isConfirmed ? value : null;
}

// ===================== INJECTED CHROME (runs once, on load) =====================
(function injectChrome() {
    // --- Activity Log: sidebar link + panel (filters + Load more) ---
    const settingsLink = document.querySelector('.sidebar nav a[data-panel="settings"]');
    const settingsPanel = $('panel-settings');
    if (settingsLink && settingsPanel && !$('panel-activity')) {
        settingsLink.insertAdjacentHTML('beforebegin',
            '<a data-panel="activity"><i class="fas fa-clipboard-list"></i> <span>Activity Log</span></a>');
        settingsPanel.insertAdjacentHTML('beforebegin', `
            <div class="panel" id="panel-activity">
                <h1>Activity Log</h1>
                <div class="subtitle">Every change made in this panel — who did it and when</div>

                <div class="activity-filters">
                    <div class="filter-field">
                        <label for="actAdmin">Admin</label>
                        <select id="actAdmin"><option value="">All admins</option></select>
                    </div>
                    <div class="filter-field">
                        <label for="actAction">Action</label>
                        <select id="actAction">
                            <option value="">All actions</option>
                            <option value="approve">Approved landlord</option>
                            <option value="reject">Rejected landlord</option>
                            <option value="user_edit">Edited user</option>
                            <option value="user_suspend">Suspended user</option>
                            <option value="user_unsuspend">Unsuspended user</option>
                            <option value="listing_hide">Hid listing</option>
                            <option value="listing_unhide">Unhid listing</option>
                            <option value="appeal_dismiss">Declined appeal</option>
                            <option value="review_delete">Deleted review</option>
                            <option value="admin_create">Created admin</option>
                            <option value="admin_edit">Edited admin</option>
                            <option value="admin_delete">Deleted admin</option>
                            <option value="user_delete">Deleted user (old)</option>
                            <option value="listing_edit">Edited listing (old)</option>
                            <option value="listing_delete">Deleted listing (old)</option>
                        </select>
                    </div>
                    <div class="filter-field">
                        <label for="actFrom">From</label>
                        <input type="date" id="actFrom">
                    </div>
                    <div class="filter-field">
                        <label for="actTo">To</label>
                        <input type="date" id="actTo">
                    </div>
                    <button type="button" class="btn-export" id="actClear"><i class="fas fa-rotate-left"></i> Clear filters</button>
                </div>

                <div class="activity-count" id="activityCount"></div>

                <div class="table-wrap">
                    <div class="table-scroll">
                        <table>
                            <thead><tr><th>When</th><th>Admin</th><th>Action</th></tr></thead>
                            <tbody id="activityTableBody"></tbody>
                        </table>
                    </div>
                </div>

                <div class="load-more-row" id="activityMoreRow">
                    <button type="button" class="btn-export" id="activityMoreBtn"><i class="fas fa-angles-down"></i> Load more</button>
                </div>
            </div>`);
        document.querySelector('.sidebar nav a[data-panel="activity"]').addEventListener('click', () => loadActivity());

        // Filters reload the log from the first page.
        $('actAdmin').onchange = (e) => { act.admin = e.target.value; loadActivity(); };
        $('actAction').onchange = (e) => { act.action = e.target.value; loadActivity(); };
        $('actFrom').onchange = (e) => { act.from = e.target.value; if (datesAreValid()) loadActivity(); };
        $('actTo').onchange = (e) => { act.to = e.target.value; if (datesAreValid()) loadActivity(); };
        $('actClear').onclick = () => { clearActivityFilters(); loadActivity(); };
        $('activityMoreBtn').onclick = () => fetchActivity(true);
    }

    // --- Overview: container for charts under the stat cards ---
    const statsGrid = $('statsGrid');
    if (statsGrid && !$('overviewExtras')) statsGrid.insertAdjacentHTML('afterend', '<div id="overviewExtras"></div>');

    // --- Users toolbar: filters + export ---
    const userTool = document.querySelector('#panel-users .toolbar');
    if (userTool && !$('userRoleFilter')) {
        userTool.insertAdjacentHTML('beforeend', `
            <select id="userRoleFilter" class="toolbar-select" aria-label="Filter by role">
                <option value="">All roles</option><option value="tenant">Tenant</option>
                <option value="landlord">Landlord</option><option value="pending">Pending setup</option>
            </select>
            <select id="userStatusFilter" class="toolbar-select" aria-label="Filter by landlord status">
                <option value="">All statuses</option><option value="none">None</option>
                <option value="pending">Pending</option><option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
            </select>
            <button type="button" class="btn-export" id="exportUsersBtn"><i class="fas fa-file-csv"></i> Export CSV</button>`);
        $('userRoleFilter').onchange = (e) => { ex.userRole = e.target.value; ex.userPage = 1; renderUsers(); };
        $('userStatusFilter').onchange = (e) => { ex.userStatus = e.target.value; ex.userPage = 1; renderUsers(); };
        $('exportUsersBtn').onclick = exportUsersCsv;
    }

    // --- Listings toolbar: category filter + export ---
    const listTool = document.querySelector('#panel-listings .toolbar');
    if (listTool && !$('listingCatFilter')) {
        listTool.insertAdjacentHTML('beforeend', `
            <select id="listingCatFilter" class="toolbar-select" aria-label="Filter by category">
                <option value="">All categories</option><option value="apartment">Apartment</option>
                <option value="house">House</option><option value="condo">Condo</option>
                <option value="bedspace">Bedspace</option>
            </select>
            <button type="button" class="btn-export" id="exportListingsBtn"><i class="fas fa-file-csv"></i> Export CSV</button>`);
        $('listingCatFilter').onchange = (e) => { ex.listingCat = e.target.value; ex.listingPage = 1; renderListingsTable(); };
        $('exportListingsBtn').onclick = exportListingsCsv;
    }

    // --- Row buttons use data-* + one click listener per table (no inline JSON) ---
    // Users can be edited / suspended / unsuspended (no delete).
    $('usersTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === 'edit-user') { const u = ex.usersById.get(id); if (u) openEditUser(u); }
        if (btn.dataset.act === 'suspend-user') suspendUser(id);
        if (btn.dataset.act === 'unsuspend-user') unsuspendUser(id);
    });
    // Listings can be hidden / unhidden, and appeals declined (no edit, no delete).
    $('listingsTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === 'hide-listing') hideListing(id);
        if (btn.dataset.act === 'unhide-listing') unhideListing(id);
        if (btn.dataset.act === 'dismiss-appeal') dismissAppeal(id);
    });
    $('requestsTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.disabled) return;
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === 'view-docs') viewLandlordDocs(id);
        if (btn.dataset.act === 'approve') approveLandlord(id);
        if (btn.dataset.act === 'reject') rejectLandlord(id);
    });
    $('adminsTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === 'edit-admin') { const a = ex.adminsById.get(id); if (a) openEditAdmin(a); }
        if (btn.dataset.act === 'delete-admin') deleteAdminAccount(id);
    });
    $('docsModalBody').addEventListener('click', (e) => {
        const img = e.target.closest('img[data-lightbox]');
        if (img) openLightbox(img.src);
    });

    // The top bar's Logout button reuses the sidebar's existing logout handler
    // from admin.js, so there is only one logout path.
    const topbarLogout = $('topbarLogoutBtn');
    if (topbarLogout) {
        topbarLogout.addEventListener('click', () => {
            const sidebarLogout = $('adminLogoutBtn');
            if (sidebarLogout) sidebarLogout.click();
        });
    }
})();

// Stat cards / banner buttons that jump to another panel
document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto]');
    if (t) goPanel(t.dataset.goto);
});
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('stat-card') && e.target.dataset.goto) {
        e.preventDefault();
        goPanel(e.target.dataset.goto);
    }
});

// Esc closes the lightbox first, then any open modal. Clicking the dark
// backdrop closes a modal too (only if the click STARTED on the backdrop, so
// dragging a text selection out of an input doesn't close it by accident).
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || Swal.isVisible()) return;
    const lb = $('adminLightbox');
    if (lb && lb.style.display === 'flex') { closeLightbox(); return; }
    document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
});
let _downOnBackdrop = false;
document.addEventListener('mousedown', (e) => { _downOnBackdrop = !!(e.target.classList && e.target.classList.contains('modal')); });
document.addEventListener('click', (e) => {
    if (_downOnBackdrop && e.target.classList && e.target.classList.contains('modal')) e.target.style.display = 'none';
});

// ===================== LIGHTBOX =====================
function openLightbox(src) {
    let lb = $('adminLightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'adminLightbox';
        lb.className = 'lightbox';
        lb.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close"><i class="fas fa-times"></i></button><img alt="">';
        lb.addEventListener('click', closeLightbox);
        document.body.appendChild(lb);
    }
    lb.querySelector('img').src = src;
    lb.style.display = 'flex';
}
function closeLightbox() {
    const lb = $('adminLightbox');
    if (lb) lb.style.display = 'none';
}

// ===================== 1. OVERVIEW =====================
function barList(items) {
    if (!items.length) return '<p class="muted-note">No data yet.</p>';
    const max = Math.max(...items.map(i => Number(i.value) || 0), 1);
    return items.map(i => `
        <div class="bar-row">
            <span class="bar-label" title="${esc(i.label)}">${esc(i.label)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(((Number(i.value) || 0) / max) * 100)}%"></div></div>
            <span class="bar-value">${Number(i.value) || 0}</span>
        </div>`).join('');
}
const insightCard = (title, inner) => `<div class="insight-card"><h3>${esc(title)}</h3>${inner}</div>`;

function activityList(log) {
    if (!log || !log.length) return '<p class="muted-note">No admin activity recorded yet.</p>';
    return `<ul class="activity-list">${log.map(r => `
        <li>
            <span class="act-text">${esc(describeAction(r.method, r.path, r.target_label))}</span>
            <span class="act-meta">${esc(r.admin_name || 'Unknown admin')} · ${esc(fmtDate(r.created_at))}</span>
        </li>`).join('')}</ul>`;
}

function renderOverviewExtras(stats, ov, log) {
    const box = $('overviewExtras');
    if (!box) return;

    const pending = Number(stats.pendingRequests) || 0;
    const appeals = Number(stats.pendingAppeals) || 0;
    const banner = (pending > 0
        ? `<div class="alert-banner"><i class="fas fa-bell"></i> ${pending} landlord request${pending === 1 ? '' : 's'} waiting for review
               <button type="button" class="btn-primary-small" data-goto="requests">Review now</button></div>`
        : '') + (appeals > 0
        ? `<div class="alert-banner"><i class="fas fa-flag"></i> ${appeals} hidden listing${appeals === 1 ? ' has' : 's have'} a landlord appeal waiting
               <button type="button" class="btn-primary-small" data-goto="listings">Review now</button></div>`
        : '');

    let cards = '';
    if (ov) {
        const landlordLabel = { none: 'No application', pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
        cards += insightCard('Listings by category', barList((ov.byCategory || []).map(r => ({ label: r.category || 'Uncategorized', value: r.n }))));
        cards += insightCard('Availability', barList((ov.byStatus || []).map(r => ({ label: r.status, value: r.n }))));
        cards += insightCard('Landlord applications', barList((ov.byLandlordStatus || []).map(r => ({ label: landlordLabel[r.status] || r.status, value: r.n }))));
        cards += insightCard('Listings posted (last 6 months)', barList((ov.perMonth || []).map(r => ({ label: monthLabel(r.ym), value: r.n }))));
    }
    cards += insightCard('Recent admin activity', activityList(log));

    box.innerHTML = banner + `<div class="insight-grid">${cards}</div>`;
}

async function loadStats() {
    try {
        const data = await adminGet('/stats');
        if (!data) return;

        const cards = [
            { icon: 'fa-users', label: 'Total Users', value: data.totalUsers, go: 'users' },
            { icon: 'fa-house-user', label: 'Landlords', value: data.totalLandlords, go: 'users' },
            { icon: 'fa-user-tag', label: 'Tenants', value: data.totalTenants, go: 'users' },
            { icon: 'fa-user-clock', label: 'Pending Requests', value: data.pendingRequests, go: 'requests' },
            { icon: 'fa-home', label: 'Total Listings', value: data.totalListings, go: 'listings' }
        ];
        $('statsGrid').innerHTML = cards.map(c => `
            <div class="stat-card clickable" data-goto="${c.go}" role="button" tabindex="0">
                <i class="fas ${c.icon}"></i>
                <div class="num">${Number(c.value) || 0}</div>
                <div class="label">${esc(c.label)}</div>
            </div>`).join('');

        const [ov, logData] = await Promise.all([
            adminGet('/overview').catch(() => null),
            adminGet('/audit-log?limit=6').catch(() => null)
        ]);
        renderOverviewExtras(data, ov, logData ? auditRows(logData) : null);
    } catch (err) {
        console.error('Stats error:', err);
    }
}

// ===================== 2. LANDLORD REQUESTS =====================
async function loadLandlordRequests() {
    const tbody = $('requestsTableBody');
    try {
        const rows = await adminGet('/landlord-requests');
        if (!rows) return;

        const badge = $('reqBadge');
        if (rows.length > 0) { badge.style.display = 'inline-block'; badge.innerText = rows.length; }
        else { badge.style.display = 'none'; }

        ex.requests = new Map(rows.map(r => [Number(r.id), r]));

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-check-circle" style="font-size:24px;"></i><p>No pending landlord requests.</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(u => {
            const match = nameMatchStatus(u.full_name, u.landlord_doc_name);
            const id = Number(u.id);
            return `
            <tr>
                <td>${esc(u.full_name)}</td>
                <td>${esc(u.email)}</td>
                <td>${esc(u.contact || '—')}</td>
                <td>${esc(u.address || '—')}</td>
                <td><span class="pill ${esc(match.cls)}">${esc(match.label)}</span></td>
                <td>
                    <button class="btn btn-edit" data-act="view-docs" data-id="${id}" ${Number(u.has_documents) ? '' : 'disabled title="No documents uploaded"'}><i class="fas fa-file-image"></i> View Docs</button>
                    <button class="btn btn-approve" data-act="approve" data-id="${id}"><i class="fas fa-check"></i> Approve</button>
                    <button class="btn btn-reject" data-act="reject" data-id="${id}"><i class="fas fa-times"></i> Reject</button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">Failed to load requests.</div></td></tr>`;
    }
}

// Document review: loads this applicant's documents on demand, with a
// checklist (Approve unlocks only when every item is ticked) and in-page zoom.
async function viewLandlordDocs(userId) {
    const id = Number(userId);
    const req = ex.requests.get(id) || {};
    const body = $('docsModalBody');
    $('viewDocsModal').style.display = 'flex';
    body.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading documents…</p></div>';

    try {
        const data = await adminGet(`/landlord-requests/${id}/documents`);
        if (!data) return;

        const docs = String(data.documents || '').split('|||').map(d => d.trim()).filter(d => safeImg(d));
        const labels = [
            'Proof of Property Ownership (TCT / Tax Declaration)',
            "Local Permits (Barangay Clearance + Mayor's/Business Permit)",
            'BIR Registration (Form 1901/1903)',
            'Selfie Holding Valid ID'
        ];
        const checks = [
            'Proof of Ownership is readable and the name matches the applicant',
            "Barangay Clearance and Mayor's/Business Permit look valid and not expired",
            'BIR Registration (Form 1901/1903) is present and readable',
            "Selfie clearly shows the applicant's face next to a valid ID"
        ];
        const match = nameMatchStatus(req.full_name, req.landlord_doc_name);

        const head = `
            <div class="review-head">
                <div><span class="review-label">Applicant</span><strong>${esc(req.full_name || '—')}</strong><small>${esc(req.email || '')}</small></div>
                <div><span class="review-label">Name on Proof of Ownership</span><strong>${esc(req.landlord_doc_name || '—')}</strong>
                     <small><span class="pill ${esc(match.cls)}">Name ${esc(match.label)}</span></small></div>
            </div>`;

        if (docs.length === 0) {
            body.innerHTML = head + `<div class="empty-state">No readable documents were uploaded for this request.</div>
                <div class="review-actions"><button type="button" class="btn btn-reject" id="reviewRejectBtn"><i class="fas fa-times"></i> Reject</button></div>`;
        } else {
            body.innerHTML = head
                + docs.map((src, i) => `
                    <div>
                        <span class="doc-preview-label">${esc(labels[i] || `Document ${i + 1}`)}</span>
                        <img src="${esc(src)}" class="doc-preview" data-lightbox="1" alt="${esc(labels[i] || 'Document')}">
                    </div>`).join('')
                + `<div class="review-checklist">
                        <span class="review-label">Verification checklist</span>
                        ${checks.map(c => `<label class="check-row"><input type="checkbox" class="review-check"> <span>${esc(c)}</span></label>`).join('')}
                   </div>
                   <div class="review-actions">
                        <button type="button" class="btn btn-reject" id="reviewRejectBtn"><i class="fas fa-times"></i> Reject</button>
                        <button type="button" class="btn btn-approve" id="reviewApproveBtn" disabled><i class="fas fa-check"></i> Approve</button>
                   </div>`;

            const boxes = body.querySelectorAll('.review-check');
            boxes.forEach(cb => cb.onchange = () => {
                $('reviewApproveBtn').disabled = ![...boxes].every(b => b.checked);
            });
            $('reviewApproveBtn').onclick = () => { closeModal('viewDocsModal'); approveLandlord(id); };
        }
        $('reviewRejectBtn').onclick = () => { closeModal('viewDocsModal'); rejectLandlord(id); };
    } catch (err) {
        body.innerHTML = '<div class="empty-state">Could not load the documents. Please try again.</div>';
    }
}

// Extra confirmation when the typed name doesn't match the registered name.
const _approveLandlordOriginal = approveLandlord;
approveLandlord = async function (id) {
    const req = ex.requests.get(Number(id));
    if (req && nameMatchStatus(req.full_name, req.landlord_doc_name).cls === 'rejected') {
        const c = await Swal.fire({
            title: 'Name mismatch',
            html: `<p style="font-size:13.5px;text-align:left;margin:0;">Registered name: <strong>${esc(req.full_name)}</strong><br>Name on document: <strong>${esc(req.landlord_doc_name)}</strong></p>
                   <p style="font-size:12.5px;color:#78909c;text-align:left;">Only approve if you checked the document and they are the same person.</p>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Approve anyway'
        });
        if (!c.isConfirmed) return;
    }
    return _approveLandlordOriginal(id);
};

// ===================== 3. USERS =====================
let _usersTimer;
function loadUsers(search) {
    const typed = typeof search === 'string';
    if (typed) { ex.userSearch = search; ex.userPage = 1; }
    clearTimeout(_usersTimer);
    _usersTimer = setTimeout(fetchUsers, typed ? 250 : 0); // wait for the typing to pause
}

async function fetchUsers() {
    try {
        const rows = await adminGet(`/users?search=${encodeURIComponent(ex.userSearch)}`);
        if (!rows) return;
        ex.users = rows;
        ex.usersById = new Map(rows.map(u => [Number(u.id), u]));
        renderUsers();
    } catch (err) {
        $('usersTableBody').innerHTML = `<tr><td colspan="6"><div class="empty-state">Failed to load users.</div></td></tr>`;
    }
}

function filteredUsers() {
    return ex.users.filter(u =>
        (!ex.userRole || u.role === ex.userRole) &&
        (!ex.userStatus || (u.landlord_status || 'none') === ex.userStatus));
}

function renderUsers() {
    const tbody = $('usersTableBody');
    const rows = filteredUsers();
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (ex.userPage > pages) ex.userPage = pages;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No users found.</div></td></tr>`;
        renderPager('usersTableBody', 0, 1, () => {});
        return;
    }

    const slice = rows.slice((ex.userPage - 1) * PER_PAGE, ex.userPage * PER_PAGE);
    tbody.innerHTML = slice.map(u => {
        const status = u.landlord_status || 'none';
        const suspended = Number(u.is_suspended) === 1;
        const id = Number(u.id);
        return `
        <tr>
            <td><div class="cell-user"><span class="avatar">${esc(initials(u.full_name || u.email))}</span><span>${esc(u.full_name || '—')}</span>
                ${suspended ? `<span class="pill rejected" title="${esc(u.suspended_reason || '')}">Suspended</span>` : ''}</div></td>
            <td>${esc(u.email)}</td>
            <td><span class="pill ${esc(u.role)}">${esc(u.role)}</span></td>
            <td><span class="pill ${esc(status)}">${esc(status)}</span></td>
            <td>${esc(u.contact || '—')}</td>
            <td>
                <button class="btn btn-edit" data-act="edit-user" data-id="${id}" title="Edit"><i class="fas fa-edit"></i></button>
                ${suspended
                    ? `<button class="btn btn-approve" data-act="unsuspend-user" data-id="${id}" title="Unsuspend"><i class="fas fa-user-check"></i></button>`
                    : `<button class="btn btn-delete" data-act="suspend-user" data-id="${id}" title="Suspend"><i class="fas fa-user-slash"></i></button>`}
            </td>
        </tr>`;
    }).join('');

    renderPager('usersTableBody', rows.length, ex.userPage, (p) => { ex.userPage = p; renderUsers(); });
}

function exportUsersCsv() {
    const rows = filteredUsers();
    if (!rows.length) return Swal.fire('Nothing to export', 'There are no users in the current view.', 'info');
    downloadCsv('stayfind-users.csv',
        ['Name', 'Email', 'Role', 'Landlord status', 'Suspended', 'Contact', 'Address'],
        rows.map(u => [u.full_name, u.email, u.role, u.landlord_status || 'none', Number(u.is_suspended) === 1 ? 'Yes' : 'No', u.contact, u.address]));
}

// Suspend / unsuspend a user (replaces deleting them).
async function suspendUser(id) {
    const u = ex.usersById.get(Number(id));
    const reason = await askModerationReason({
        title: 'Suspend this user?',
        subjectLine: u ? `User: <strong>${esc(u.full_name || u.email)}</strong>` : '',
        icon: 'fa-user-slash',
        templates: [
            "Repeated violations of StayFind's rules.",
            'Suspected fake or fraudulent account.',
            'Abusive or harassing behavior toward other users.'
        ],
        confirmText: 'Suspend',
        note: "They are signed out right away and can't log in. If they are a landlord, their listings leave the public feed. Nothing is deleted. They will see this reason when they try to log in."
    });
    if (!reason) return;

    try {
        const r = await adminPost(`/users/${Number(id)}/suspend`, { reason });
        if (!r) return;
        if (r.ok) {
            Swal.fire('Suspended', 'The user is suspended. You can unsuspend them at any time.', 'success');
            fetchUsers();
            fetchListings();
        } else {
            Swal.fire('Error', r.data.message || 'Failed to suspend user.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

async function unsuspendUser(id) {
    const u = ex.usersById.get(Number(id));
    const c = await Swal.fire({
        title: 'Unsuspend this user?',
        text: `${u ? (u.full_name || u.email) : 'This user'} will be able to log in again, and any listings that were not hidden separately become visible.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Yes, unsuspend'
    });
    if (!c.isConfirmed) return;

    try {
        const r = await adminPost(`/users/${Number(id)}/unsuspend`, {});
        if (!r) return;
        if (r.ok) {
            Swal.fire('Unsuspended', 'The user can log in again.', 'success');
            fetchUsers();
            fetchListings();
        } else {
            Swal.fire('Error', r.data.message || 'Failed to unsuspend user.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// ===================== 4. LISTINGS =====================
let _listingsTimer;
function loadListings(search) {
    const typed = typeof search === 'string';
    if (typed) { ex.listingSearch = search; ex.listingPage = 1; }
    clearTimeout(_listingsTimer);
    _listingsTimer = setTimeout(fetchListings, typed ? 250 : 0);
}

async function fetchListings() {
    try {
        const rows = await adminGet(`/listings?search=${encodeURIComponent(ex.listingSearch)}`);
        if (!rows) return;
        ex.listings = rows;
        ex.listingsById = new Map(rows.map(l => [Number(l.id), l]));
        renderListingsTable();
    } catch (err) {
        $('listingsTableBody').innerHTML = `<tr><td colspan="5"><div class="empty-state">Failed to load listings.</div></td></tr>`;
    }
}

function filteredListings() {
    return ex.listings.filter(l => !ex.listingCat || String(l.category || '').toLowerCase() === ex.listingCat);
}

function renderListingsTable() {
    const tbody = $('listingsTableBody');
    const rows = filteredListings();
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (ex.listingPage > pages) ex.listingPage = pages;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No listings found.</div></td></tr>`;
        renderPager('listingsTableBody', 0, 1, () => {});
        return;
    }

    const slice = rows.slice((ex.listingPage - 1) * PER_PAGE, ex.listingPage * PER_PAGE);
    tbody.innerHTML = slice.map(l => {
        const occupied = (l.status || 'available') === 'occupied';
        const hidden = Number(l.is_hidden) === 1;
        const hasAppeal = hidden && !!l.appeal_at;
        const id = Number(l.id);
        const thumb = safeImg(l.thumbnail)
            ? `<img class="thumb" src="${esc(l.thumbnail)}" alt="" loading="lazy">`
            : `<span class="thumb thumb-empty"><i class="fas fa-image"></i></span>`;
        return `
        <tr>
            <td><div class="cell-listing">${thumb}<div><strong>${esc(l.title)}</strong>
                <span class="pill ${occupied ? 'pending' : 'approved'}">${occupied ? 'Occupied' : 'Available'}</span>
                ${hidden ? '<span class="pill rejected">Hidden</span>' : ''}
                ${hasAppeal ? '<span class="pill pending">Appeal</span>' : ''}
                ${hidden && l.hidden_reason ? `<div style="font-size:11.5px; color:#c0392f; margin-top:4px; font-weight:600;">Reason: ${esc(l.hidden_reason)}</div>` : ''}
                ${hasAppeal ? `<div style="font-size:11.5px; color:#1565c0; margin-top:4px; font-weight:600;"><i class="fas fa-flag"></i> Landlord appeal (${esc(fmtDate(l.appeal_at))}): ${esc(l.appeal_message || '')}</div>` : ''}
                </div></div></td>
            <td>${esc(l.landlord_name || '—')}</td>
            <td>₱${Number(l.price || 0).toLocaleString()}</td>
            <td>${esc(l.location || '—')}</td>
            <td>
                ${hidden
                    ? `<button class="btn btn-approve" data-act="unhide-listing" data-id="${id}" title="Make visible again"><i class="fas fa-eye"></i> Unhide</button>`
                    : `<button class="btn btn-reject" data-act="hide-listing" data-id="${id}" title="Hide from the public"><i class="fas fa-eye-slash"></i> Hide</button>`}
                ${hasAppeal ? `<button class="btn btn-reject" data-act="dismiss-appeal" data-id="${id}" title="Keep it hidden and tell the landlord why"><i class="fas fa-ban"></i> Decline appeal</button>` : ''}
            </td>
        </tr>`;
    }).join('');

    renderPager('listingsTableBody', rows.length, ex.listingPage, (p) => { ex.listingPage = p; renderListingsTable(); });
}

function exportListingsCsv() {
    const rows = filteredListings();
    if (!rows.length) return Swal.fire('Nothing to export', 'There are no listings in the current view.', 'info');
    downloadCsv('stayfind-listings.csv',
        ['Title', 'Category', 'Status', 'Visibility', 'Hidden reason', 'Price', 'Location', 'Rooms', 'Size (sqm)', 'Landlord', 'Landlord email', 'Posted'],
        rows.map(l => [l.title, l.category, l.status || 'available', Number(l.is_hidden) === 1 ? 'Hidden' : 'Visible', l.hidden_reason || '', l.price, l.location, l.rooms, l.size, l.landlord_name, l.landlord_email, l.created_at]));
}

// Hide / unhide a listing (replaces deleting and editing it).
async function hideListing(id) {
    const l = ex.listingsById.get(Number(id));
    const reason = await askModerationReason({
        title: 'Hide this listing?',
        subjectLine: l ? `Listing: <strong>${esc(l.title)}</strong>` : '',
        icon: 'fa-eye-slash',
        templates: [
            'The photos or description are misleading or inaccurate.',
            'The price or details do not match the actual property.',
            'This looks like a duplicate of another listing.',
            'The listing contains inappropriate or prohibited content.',
            'Reported by users and under review.'
        ],
        confirmText: 'Hide listing',
        note: 'It disappears from the public feed and search right away. The landlord can still see it, together with this reason, and can appeal. You can unhide it any time.'
    });
    if (!reason) return;

    try {
        const r = await adminPost(`/listings/${Number(id)}/hide`, { reason });
        if (!r) return;
        if (r.ok) {
            Swal.fire('Hidden', 'The listing is hidden from the public. The landlord can see your reason.', 'success');
            fetchListings();
        } else {
            Swal.fire('Error', r.data.message || 'Failed to hide listing.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

async function unhideListing(id) {
    const l = ex.listingsById.get(Number(id));
    const c = await Swal.fire({
        title: 'Show this listing again?',
        text: `${l ? l.title : 'This listing'} will appear in the public feed again.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Yes, unhide'
    });
    if (!c.isConfirmed) return;

    try {
        const r = await adminPost(`/listings/${Number(id)}/unhide`, {});
        if (!r) return;
        if (r.ok) {
            Swal.fire('Visible', 'The listing is public again.', 'success');
            fetchListings();
        } else {
            Swal.fire('Error', r.data.message || 'Failed to unhide listing.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// Decline a landlord's appeal. The listing stays hidden, and the landlord
// sees "Appeal declined: <reason>" and can appeal again after fixing it.
async function dismissAppeal(id) {
    const l = ex.listingsById.get(Number(id));
    const reason = await askModerationReason({
        title: 'Decline this appeal?',
        subjectLine: l ? `Listing: <strong>${esc(l.title)}</strong>` : '',
        icon: 'fa-flag',
        templates: [
            'The issue has not been fixed yet.',
            'The listing still does not meet our guidelines.',
            'We could not verify the corrections you described.'
        ],
        confirmText: 'Decline appeal',
        note: 'The listing stays hidden. The landlord will see "Appeal declined" with this reason and can send a new appeal after fixing the problem. To approve the appeal, use Unhide instead.'
    });
    if (!reason) return;

    try {
        const r = await adminPost(`/listings/${Number(id)}/dismiss-appeal`, { reason });
        if (!r) return;
        if (r.ok) {
            Swal.fire('Declined', 'The appeal was declined and the landlord can see your reason.', 'success');
            fetchListings();
            loadStats();
        } else {
            Swal.fire('Error', r.data.message || 'Failed to decline the appeal.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// ===================== 5. REVIEWS =====================
async function loadReviews() {
    const tbody = $('reviewsTableBody');
    try {
        const rows = await adminGet('/reviews');
        if (!rows) return;

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No reviews yet.</div></td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => {
            const rating = Math.min(5, Number(r.rating) || 0);
            const isReply = Number(r.is_reply) === 1;
            return `
            <tr>
                <td>${esc(r.listing_title || '—')}</td>
                <td>${esc(r.user_name || '—')}</td>
                <td>${rating ? '★'.repeat(rating) : '—'}</td>
                <td>${isReply ? '<span class="pill you">Landlord reply</span> ' : ''}${esc(r.comment || '—')}</td>
                <td><button class="btn btn-delete" onclick="deleteReview(${Number(r.id)})"><i class="fas fa-trash"></i></button></td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Failed to load reviews.</div></td></tr>`;
    }
}

// ===================== 6. ADMIN ACCOUNTS (Settings) =====================
async function loadAdmins() {
    const tbody = $('adminsTableBody');
    try {
        const rows = await adminGet('/admins');
        if (!rows) return;
        ex.adminsById = new Map(rows.map(a => [Number(a.id), a]));

        // If this admin just renamed themselves (or changed their email) in
        // Settings, update the top bar right away - no extra request.
        if (currentAdmin) {
            const mine = ex.adminsById.get(Number(currentAdmin.id));
            if (mine && (mine.full_name !== currentAdmin.full_name || mine.email !== currentAdmin.email)) {
                currentAdmin = { id: mine.id, full_name: mine.full_name, email: mine.email };
                sessionStorage.setItem('adminInfo', JSON.stringify(currentAdmin));
                renderAdminIdentity();
            }
        }

        populateActivityAdminFilter(); // keep the Activity Log's admin dropdown current

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No admin accounts found.</div></td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(a => {
            const isSelf = currentAdmin && String(currentAdmin.id) === String(a.id);
            const added = a.created_at ? new Date(a.created_at).toLocaleDateString() : '—';
            return `
            <tr>
                <td>${esc(a.full_name)}${isSelf ? ' <span class="pill you">You</span>' : ''}</td>
                <td>${esc(a.email)}</td>
                <td>${esc(added)}</td>
                <td>
                    <button class="btn btn-edit" data-act="edit-admin" data-id="${Number(a.id)}"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-delete" data-act="delete-admin" data-id="${Number(a.id)}" ${isSelf ? 'disabled title="You can\'t delete your own account while logged in"' : ''}><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">Failed to load admin accounts.</div></td></tr>`;
    }
}

// ===================== 7. ACTIVITY LOG (filters + Load more) =====================
const ACTIVITY_PAGE = 25;

// Everything the Activity Log panel remembers. `seq` numbers each request so a
// slow answer for old filters can never overwrite the result of newer ones.
const act = { admin: '', action: '', from: '', to: '', rows: [], hasMore: false, loading: false, seq: 0 };

function activityFiltersActive() {
    return !!(act.admin || act.action || act.from || act.to);
}

// Fills the "Admin" dropdown from the admin accounts list and keeps the selection.
function populateActivityAdminFilter() {
    const sel = $('actAdmin');
    if (!sel) return;
    const keep = act.admin;
    const admins = [...ex.adminsById.values()].sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
    sel.innerHTML = '<option value="">All admins</option>' + admins.map(a =>
        `<option value="${Number(a.id)}">${esc(a.full_name || a.email)}${currentAdmin && String(currentAdmin.id) === String(a.id) ? ' (you)' : ''}</option>`
    ).join('');
    sel.value = keep;
    if (sel.value !== keep) { act.admin = ''; sel.value = ''; } // that admin no longer exists
}

function clearActivityFilters() {
    act.admin = ''; act.action = ''; act.from = ''; act.to = '';
    if ($('actAdmin')) $('actAdmin').value = '';
    if ($('actAction')) $('actAction').value = '';
    if ($('actFrom')) $('actFrom').value = '';
    if ($('actTo')) $('actTo').value = '';
}

// "From" must not be after "To".
function datesAreValid() {
    if (act.from && act.to && act.from > act.to) {
        AdminToast.fire({ icon: 'warning', title: '"From" must be on or before "To".' });
        return false;
    }
    return true;
}

function setActivityBusy(busy) {
    const btn = $('activityMoreBtn');
    if (!btn) return;
    btn.disabled = busy;
    btn.innerHTML = busy
        ? '<i class="fas fa-spinner fa-spin"></i> Loading…'
        : '<i class="fas fa-angles-down"></i> Load more';
}

function renderActivity() {
    const tbody = $('activityTableBody');
    const countEl = $('activityCount');
    const moreRow = $('activityMoreRow');
    if (!tbody) return;

    if (act.rows.length === 0) {
        const msg = activityFiltersActive() ? 'No activity matches these filters.' : 'No activity recorded yet.';
        tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="fas fa-clipboard-list" style="font-size:24px;"></i><p>${msg}</p></div></td></tr>`;
        if (countEl) countEl.innerHTML = '';
        if (moreRow) moreRow.style.display = 'none';
        return;
    }

    tbody.innerHTML = act.rows.map(r => `
        <tr>
            <td>${esc(fmtDate(r.created_at))}</td>
            <td>${esc(r.admin_name || 'Unknown admin')}</td>
            <td>${esc(describeAction(r.method, r.path, r.target_label))}</td>
        </tr>`).join('');

    if (countEl) {
        countEl.innerHTML = `Showing <strong>${act.rows.length}</strong> ${act.rows.length === 1 ? 'entry' : 'entries'}${act.hasMore ? ' — more available' : ''}`;
    }
    if (moreRow) moreRow.style.display = act.hasMore ? 'flex' : 'none';
}

// append = false: start over from the newest entry. append = true: the next older page.
async function fetchActivity(append) {
    const tbody = $('activityTableBody');
    if (!tbody) return;
    if (append && act.loading) return;

    const mySeq = ++act.seq;
    act.loading = true;
    setActivityBusy(true);

    if (!append) {
        tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading…</p></div></td></tr>';
        const moreRow = $('activityMoreRow');
        if (moreRow) moreRow.style.display = 'none';
    }

    const p = new URLSearchParams({ limit: String(ACTIVITY_PAGE) });
    if (act.admin) p.set('admin_id', act.admin);
    if (act.action) p.set('action', act.action);
    if (act.from) p.set('from', act.from);
    if (act.to) p.set('to', act.to);
    if (act.from || act.to) p.set('tz', String(new Date().getTimezoneOffset())); // so "Nov 12" means Nov 12 where the admin is
    if (append && act.rows.length) p.set('before', String(act.rows[act.rows.length - 1].id));

    try {
        const data = await adminGet('/audit-log?' + p.toString());
        if (!data || mySeq !== act.seq) return; // signed out, or newer filters already took over

        const rows = auditRows(data);
        act.rows = append ? act.rows.concat(rows) : rows;
        act.hasMore = !Array.isArray(data) && !!data.hasMore;
        renderActivity();
    } catch (err) {
        if (mySeq === act.seq && !append) {
            tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state">The activity log isn't available right now. Make sure the backend update is deployed.</div></td></tr>`;
        } else if (mySeq === act.seq) {
            AdminToast.fire({ icon: 'error', title: 'Could not load more entries.' });
        }
    } finally {
        if (mySeq === act.seq) {
            act.loading = false;
            setActivityBusy(false);
        }
    }
}

// Opens the log from the first page with the current filters.
async function loadActivity() {
    if (!$('activityTableBody')) return;
    if (ex.adminsById.size === 0) {
        // The admin list normally loads at startup; fetch it if it hasn't yet.
        try {
            const admins = await adminGet('/admins');
            if (admins) ex.adminsById = new Map(admins.map(a => [Number(a.id), a]));
        } catch (e) { /* the dropdown just stays at "All admins" */ }
    }
    populateActivityAdminFilter();
    fetchActivity(false);
}

// ===================== 8. LIVE UPDATES (replaces the old 60-second refresh) =====================
// Every 20 seconds, while the tab is visible, the panel asks the server for the
// dashboard numbers. If anything changed (a new landlord request, a landlord
// appeal, a new user or listing), it shows a toast and refreshes the tables, so
// nobody has to reload the page. Every third check (about once a minute) it
// also refreshes the Users and Listings tables, to catch changes by other admins.
// These background checks are not user activity, so the idle timeout still works.
const LIVE_ADMIN_MS = 20000;
let _refreshTimer;
let livePrev = null;   // the numbers from the previous check (null = take a baseline)
let liveTickCount = 0;

async function adminLiveTick() {
    if (!adminKey || document.visibilityState !== 'visible' || Swal.isVisible()) return;

    try {
        const s = await adminGet('/stats');
        if (!s || !adminKey) return; // signed out meanwhile

        const cur = {
            req: Number(s.pendingRequests) || 0,
            app: Number(s.pendingAppeals) || 0,
            users: Number(s.totalUsers) || 0,
            listings: Number(s.totalListings) || 0
        };
        const prev = livePrev;
        livePrev = cur;
        liveTickCount++;

        if (!prev) return; // first check = baseline only

        const changed = JSON.stringify(prev) !== JSON.stringify(cur);
        if (changed) {
            if (cur.app > prev.app) {
                AdminToast.fire({ icon: 'info', title: 'A landlord sent an appeal for a hidden listing.', timer: 6000 });
            } else if (cur.req > prev.req) {
                AdminToast.fire({ icon: 'info', title: 'A new landlord request is waiting.', timer: 6000 });
            }
        }

        if (changed || liveTickCount % 3 === 0) {
            loadStats();
            loadLandlordRequests();
            fetchListings();
            fetchUsers();
        }
    } catch (err) {
        console.log('Live update check failed silently:', err);
    }
}

function startAutoRefresh() {
    clearInterval(_refreshTimer);
    livePrev = null;
    liveTickCount = 0;
    _refreshTimer = setInterval(adminLiveTick, LIVE_ADMIN_MS);
}

// ===================== 9. WHO IS SIGNED IN =====================
// Paints the top bar (and the small line in the sidebar) from currentAdmin.
function renderAdminIdentity() {
    const name = currentAdmin ? String(currentAdmin.full_name || currentAdmin.email || 'Admin') : 'Admin';
    const email = currentAdmin ? String(currentAdmin.email || '') : '';

    const avatar = $('topbarAvatar');
    const nameEl = $('topbarName');
    const emailEl = $('topbarEmail');
    if (avatar) avatar.innerText = initials(name);
    if (nameEl) nameEl.innerText = name;
    if (emailEl) emailEl.innerText = email;

    const sidebarLine = $('adminIdentity');
    if (sidebarLine && currentAdmin) sidebarLine.innerText = `Signed in as ${name}`;
}

// Asks the server who this token belongs to (GET /api/admin/me). This keeps the
// top bar correct after a refresh, and if the admin account was deleted while
// the person was still signed in, the server answers 401 and adminGet's
// handleAuthError signs them out.
async function refreshAdminIdentity() {
    try {
        const data = await adminGet('/me');
        if (!data || !data.admin) return; // null = 401 was already handled
        currentAdmin = { id: data.admin.id, full_name: data.admin.full_name, email: data.admin.email };
        sessionStorage.setItem('adminInfo', JSON.stringify(currentAdmin));
        renderAdminIdentity();
    } catch (err) {
        // Network hiccup: keep showing the cached name from login.
        console.log('Could not refresh admin identity:', err);
    }
}

// ===================== 10. SESSION WATCH =====================
// Signs the admin out when they walk away (idle) or when the 2-hour token runs
// out, and double-checks the session the moment the tab comes back into view.
//
// To test quickly, temporarily set IDLE_LIMIT_MS to 2 * 60 * 1000 (2 minutes).
const IDLE_LIMIT_MS = 30 * 60 * 1000;  // sign out after 30 minutes without activity
const IDLE_WARN_MS = 60 * 1000;        // warn during the last 60 seconds

let lastActivityAt = Date.now();
let sessionTick = null;
let idleWarningOpen = false;
let expiryWarned = false;

// Any of these counts as "the admin is here". While the warning popup is open
// they are ignored on purpose: only the "Stay signed in" button extends the session.
function noteActivity() {
    if (!idleWarningOpen) lastActivityAt = Date.now();
}
['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(ev =>
    document.addEventListener(ev, noteActivity, { passive: true, capture: true }));

function startSessionWatch() {
    lastActivityAt = Date.now();
    idleWarningOpen = false;
    expiryWarned = false;
    clearInterval(sessionTick);
    sessionTick = setInterval(checkSession, 1000);
}

// Called by adminSignOut() in admin.js, whatever the reason for signing out.
function stopSessionWatch() {
    clearInterval(sessionTick);
    sessionTick = null;
    clearInterval(_refreshTimer); // NEW: stop the live updates too
    livePrev = null;
    idleWarningOpen = false;
    expiryWarned = false;
    if (Swal.isVisible()) Swal.close();

    // Forget the data held in memory, too.
    ex.users = []; ex.usersById = new Map();
    ex.listings = []; ex.listingsById = new Map();
    ex.requests = new Map(); ex.adminsById = new Map();

    // And reset the Activity Log (rows + filters + any request still in flight).
    act.rows = []; act.hasMore = false; act.loading = false; act.seq++;
    clearActivityFilters();
    const countEl = $('activityCount');
    if (countEl) countEl.innerHTML = '';
    const moreRow = $('activityMoreRow');
    if (moreRow) moreRow.style.display = 'none';
    const adminSel = $('actAdmin');
    if (adminSel) adminSel.innerHTML = '<option value="">All admins</option>';
}

function endSession(message) {
    adminSignOut(); // admin.js: clears the token, wipes the page, shows the login screen
    if (message) Swal.fire({ title: 'Signed out', text: message, icon: 'info' });
}

function checkSession() {
    if (!adminKey) return;

    const now = Date.now();
    const exp = adminTokenExpiresAt(adminKey); // null if the token couldn't be read

    if (exp && now >= exp) {
        endSession('Your session expired. Please sign in again.');
        return;
    }

    const idleFor = now - lastActivityAt;
    if (idleFor >= IDLE_LIMIT_MS) {
        endSession('You were signed out after 30 minutes of inactivity.');
        return;
    }

    // Heads-up shortly before the hard 2-hour limit (this one can't be extended).
    if (exp && exp - now <= 60000 && !expiryWarned) {
        expiryWarned = true;
        AdminToast.fire({ icon: 'warning', title: 'Your session ends in about a minute. Please finish up.', timer: 8000 });
    }

    if (idleFor >= IDLE_LIMIT_MS - IDLE_WARN_MS && !idleWarningOpen) showIdleWarning();
}

function showIdleWarning() {
    idleWarningOpen = true;
    let countdownTimer = null;

    Swal.fire({
        title: 'Still there?',
        html: 'You will be signed out in <b id="idleCountdown">60</b> seconds because of inactivity.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Stay signed in',
        cancelButtonText: 'Log out now',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
            countdownTimer = setInterval(() => {
                const left = Math.max(0, Math.ceil((IDLE_LIMIT_MS - (Date.now() - lastActivityAt)) / 1000));
                const el = document.getElementById('idleCountdown');
                if (el) el.textContent = left;
            }, 500);
        },
        willClose: () => clearInterval(countdownTimer)
    }).then((result) => {
        idleWarningOpen = false;
        if (result.isConfirmed) {
            lastActivityAt = Date.now(); // the admin is still here
        } else if (result.dismiss === Swal.DismissReason.cancel) {
            adminSignOut(); // chose "Log out now"
        }
        // Any other close means the session already ended on its own.
    });
}

// Timers are slowed down in background tabs, so check straight away when the tab
// comes back, ask the server whether the session is still valid, and look for
// changes that happened while the tab was hidden.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && adminKey) {
        checkSession();
        if (adminKey) refreshAdminIdentity(); // a 401 here signs the admin out
        if (adminKey) adminLiveTick();
    }
});
// Same check when the browser restores the page from its back/forward cache.
window.addEventListener('pageshow', (e) => {
    if (e.persisted && adminKey) checkSession();
});

const _showDashboardOriginal = showDashboard;
showDashboard = function () {
    _showDashboardOriginal();
    renderAdminIdentity();      // instant, from the cached login info
    refreshAdminIdentity();     // then confirm with the server
    loadActivity();
    startAutoRefresh();
    startSessionWatch();
};
