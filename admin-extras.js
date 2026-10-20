// admin-extras.js — load AFTER admin.js.
//
// Later function declarations replace earlier ones of the same name, so
// admin.js stays untouched (same trick as messages-ui.js / home.js).
// Uses admin.js globals: API_BASE, adminKey, currentAdmin, adminHeaders,
// handleAuthError, nameMatchStatus, closeModal, openEditUser, deleteUser,
// openEditListing, deleteListing, deleteReview, openEditAdmin,
// deleteAdminAccount, approveLandlord, rejectLandlord, showDashboard.

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
function describeAction(method, rawPath) {
    const p = String(rawPath || '').replace(/^\/api\/admin/, '');
    let m;
    if ((m = p.match(/^\/landlord-requests\/(\d+)\/approve/))) return `Approved landlord request (user #${m[1]})`;
    if ((m = p.match(/^\/landlord-requests\/(\d+)\/reject/))) return `Rejected landlord request (user #${m[1]})`;
    if ((m = p.match(/^\/users\/(\d+)/))) return method === 'DELETE' ? `Deleted user #${m[1]}` : `Edited user #${m[1]}`;
    if ((m = p.match(/^\/listings\/(\d+)/))) return method === 'DELETE' ? `Deleted listing #${m[1]}` : `Edited listing #${m[1]}`;
    if ((m = p.match(/^\/reviews\/(\d+)/))) return `Deleted review #${m[1]}`;
    if (/^\/admins/.test(p)) {
        m = p.match(/^\/admins\/(\d+)/);
        if (method === 'POST') return 'Created an admin account';
        return method === 'DELETE' ? `Deleted admin #${m ? m[1] : '?'}` : `Edited admin #${m ? m[1] : '?'}`;
    }
    return `${method} ${p}`;
}

// ===================== INJECTED CHROME (runs once, on load) =====================
(function injectChrome() {
    // --- Activity Log: sidebar link + panel ---
    const settingsLink = document.querySelector('.sidebar nav a[data-panel="settings"]');
    const settingsPanel = $('panel-settings');
    if (settingsLink && settingsPanel && !$('panel-activity')) {
        settingsLink.insertAdjacentHTML('beforebegin',
            '<a data-panel="activity"><i class="fas fa-clipboard-list"></i> <span>Activity Log</span></a>');
        settingsPanel.insertAdjacentHTML('beforebegin', `
            <div class="panel" id="panel-activity">
                <h1>Activity Log</h1>
                <div class="subtitle">Every change made in this panel — who did it and when</div>
                <div class="table-wrap">
                    <div class="table-scroll">
                        <table>
                            <thead><tr><th>When</th><th>Admin</th><th>Action</th></tr></thead>
                            <tbody id="activityTableBody"></tbody>
                        </table>
                    </div>
                </div>
            </div>`);
        document.querySelector('.sidebar nav a[data-panel="activity"]').addEventListener('click', () => loadActivity());
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
    $('usersTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === 'edit-user') { const u = ex.usersById.get(id); if (u) openEditUser(u); }
        if (btn.dataset.act === 'delete-user') deleteUser(id);
    });
    $('listingsTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === 'edit-listing') { const l = ex.listingsById.get(id); if (l) openEditListing(l); }
        if (btn.dataset.act === 'delete-listing') deleteListing(id);
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
            <span class="act-text">${esc(describeAction(r.method, r.path))}</span>
            <span class="act-meta">${esc(r.admin_name || 'Unknown admin')} · ${esc(fmtDate(r.created_at))}</span>
        </li>`).join('')}</ul>`;
}

function renderOverviewExtras(stats, ov, log) {
    const box = $('overviewExtras');
    if (!box) return;

    const pending = Number(stats.pendingRequests) || 0;
    const banner = pending > 0
        ? `<div class="alert-banner"><i class="fas fa-bell"></i> ${pending} landlord request${pending === 1 ? '' : 's'} waiting for review
               <button type="button" class="btn-primary-small" data-goto="requests">Review now</button></div>`
        : '';

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

        const [ov, log] = await Promise.all([
            adminGet('/overview').catch(() => null),
            adminGet('/audit-log?limit=6').catch(() => null)
        ]);
        renderOverviewExtras(data, ov, log);
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
        return `
        <tr>
            <td><div class="cell-user"><span class="avatar">${esc(initials(u.full_name || u.email))}</span><span>${esc(u.full_name || '—')}</span></div></td>
            <td>${esc(u.email)}</td>
            <td><span class="pill ${esc(u.role)}">${esc(u.role)}</span></td>
            <td><span class="pill ${esc(status)}">${esc(status)}</span></td>
            <td>${esc(u.contact || '—')}</td>
            <td>
                <button class="btn btn-edit" data-act="edit-user" data-id="${Number(u.id)}" title="Edit"><i class="fas fa-edit"></i></button>
                <button class="btn btn-delete" data-act="delete-user" data-id="${Number(u.id)}" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');

    renderPager('usersTableBody', rows.length, ex.userPage, (p) => { ex.userPage = p; renderUsers(); });
}

function exportUsersCsv() {
    const rows = filteredUsers();
    if (!rows.length) return Swal.fire('Nothing to export', 'There are no users in the current view.', 'info');
    downloadCsv('stayfind-users.csv',
        ['Name', 'Email', 'Role', 'Landlord status', 'Contact', 'Address'],
        rows.map(u => [u.full_name, u.email, u.role, u.landlord_status || 'none', u.contact, u.address]));
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
        const thumb = safeImg(l.thumbnail)
            ? `<img class="thumb" src="${esc(l.thumbnail)}" alt="" loading="lazy">`
            : `<span class="thumb thumb-empty"><i class="fas fa-image"></i></span>`;
        return `
        <tr>
            <td><div class="cell-listing">${thumb}<div><strong>${esc(l.title)}</strong>
                <span class="pill ${occupied ? 'pending' : 'approved'}">${occupied ? 'Occupied' : 'Available'}</span></div></div></td>
            <td>${esc(l.landlord_name || '—')}</td>
            <td>₱${Number(l.price || 0).toLocaleString()}</td>
            <td>${esc(l.location || '—')}</td>
            <td>
                <button class="btn btn-edit" data-act="edit-listing" data-id="${Number(l.id)}" title="Edit"><i class="fas fa-edit"></i></button>
                <button class="btn btn-delete" data-act="delete-listing" data-id="${Number(l.id)}" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');

    renderPager('listingsTableBody', rows.length, ex.listingPage, (p) => { ex.listingPage = p; renderListingsTable(); });
}

function exportListingsCsv() {
    const rows = filteredListings();
    if (!rows.length) return Swal.fire('Nothing to export', 'There are no listings in the current view.', 'info');
    downloadCsv('stayfind-listings.csv',
        ['Title', 'Category', 'Status', 'Price', 'Location', 'Rooms', 'Size (sqm)', 'Landlord', 'Landlord email', 'Posted'],
        rows.map(l => [l.title, l.category, l.status || 'available', l.price, l.location, l.rooms, l.size, l.landlord_name, l.landlord_email, l.created_at]));
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

// ===================== 7. ACTIVITY LOG =====================
async function loadActivity() {
    const tbody = $('activityTableBody');
    if (!tbody) return;
    try {
        const rows = await adminGet('/audit-log?limit=100');
        if (!rows) return;

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state"><i class="fas fa-clipboard-list" style="font-size:24px;"></i><p>No activity recorded yet.</p></div></td></tr>`;
            return;
        }
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${esc(fmtDate(r.created_at))}</td>
                <td>${esc(r.admin_name || 'Unknown admin')}</td>
                <td>${esc(describeAction(r.method, r.path))}</td>
            </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state">The activity log isn't available yet. Make sure the backend update is deployed.</div></td></tr>`;
    }
}

// ===================== 8. STARTUP + AUTO-REFRESH =====================
let _refreshTimer;
function startAutoRefresh() {
    clearInterval(_refreshTimer);
    _refreshTimer = setInterval(() => {
        if (adminKey && document.visibilityState === 'visible') loadLandlordRequests();
    }, 60000);
}

const _showDashboardOriginal = showDashboard;
showDashboard = function () {
    _showDashboardOriginal();
    loadActivity();
    startAutoRefresh();
};
