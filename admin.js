// REPLACE THIS with your Render URL (same as home.js / login.js)
const API_BASE = "https://stayfind-app-system.onrender.com/api/admin";

let adminKey = localStorage.getItem('adminKey');
// NEW: identity of the currently logged-in admin (id/full_name/email),
// stored after login so we can show "Signed in as..." and prevent an admin
// from deleting their own account in the Settings panel.
let currentAdmin = JSON.parse(localStorage.getItem('adminInfo') || 'null');
let editingUserId = null;
let editingListingId = null;
// NEW: tracks which admin account is being edited in the Add/Edit Admin modal
let editingAdminId = null;

// --- HELPER: build headers with the admin key attached ---
function adminHeaders() {
    return { 'Content-Type': 'application/json', 'x-admin-key': adminKey };
}

// NEW: Simple normalized-string name-match helper. Compares a user's
// registered full_name against the landlord_doc_name they typed as "printed
// on their Proof of Ownership document". This is plain text comparison only
// (no OCR, no reading the actual document image) — it exists to help the
// admin spot an obvious red flag quickly; the admin should still open "View
// Docs" and eyeball the actual document before approving or rejecting.
function nameMatchStatus(registeredName, docName) {
    if (!docName) return { label: 'No name given', cls: 'none' };
    const norm = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    return norm(registeredName) === norm(docName)
        ? { label: 'Match', cls: 'approved' }
        : { label: 'Mismatch', cls: 'rejected' };
}

// --- INIT ---
window.onload = () => {
    if (adminKey) {
        showDashboard();
    } else {
        showLogin();
    }
    setupNav();
    setupModalSaveHandlers();
    setupAdminAccountModal(); // NEW
};

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('dashboardScreen').style.display = 'none';
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboardScreen').style.display = 'block';

    // NEW: show who's currently logged in, under the sidebar brand
    const identityEl = document.getElementById('adminIdentity');
    if (identityEl && currentAdmin) {
        identityEl.innerText = `Signed in as ${currentAdmin.full_name || currentAdmin.email}`;
    }

    loadStats();
    loadLandlordRequests();
    loadUsers();
    loadListings();
    loadReviews();
    loadAdmins(); // NEW
}

// --- LOGIN ---
document.getElementById('adminLoginBtn').onclick = async () => {
    const email = document.getElementById('adminEmail').value.trim();
    const password = document.getElementById('adminPassword').value;
    const btn = document.getElementById('adminLoginBtn');

    if (!email || !password) {
        return Swal.fire('Missing Info', 'Please enter both email and password.', 'warning');
    }

    btn.disabled = true;
    btn.innerText = "Signing in...";

    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();

        if (response.ok && result.success) {
            adminKey = result.adminKey;
            localStorage.setItem('adminKey', adminKey);

            // NEW: remember which admin just logged in
            currentAdmin = result.admin || null;
            if (currentAdmin) localStorage.setItem('adminInfo', JSON.stringify(currentAdmin));

            showDashboard();
        } else {
            Swal.fire('Login Failed', result.message || 'Invalid credentials', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Could not connect to server.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = "Sign In";
    }
};

// --- LOGOUT ---
document.getElementById('adminLogoutBtn').onclick = () => {
    localStorage.removeItem('adminKey');
    localStorage.removeItem('adminInfo'); // NEW
    adminKey = null;
    currentAdmin = null;
    showLogin();
};

// --- NAV / TAB SWITCHING ---
function setupNav() {
    document.querySelectorAll('.sidebar nav a[data-panel]').forEach(link => {
        link.onclick = () => {
            document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(`panel-${link.getAttribute('data-panel')}`).classList.add('active');
        };
    });
}

// --- HANDLE AUTH ERRORS GLOBALLY ---
function handleAuthError(response) {
    if (response.status === 401) {
        Swal.fire('Session Expired', 'Please log in again.', 'warning').then(() => {
            localStorage.removeItem('adminKey');
            localStorage.removeItem('adminInfo');
            adminKey = null;
            currentAdmin = null;
            showLogin();
        });
        return true;
    }
    return false;
}

// --- 1. STATS ---
async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/stats`, { headers: adminHeaders() });
        if (handleAuthError(res)) return;
        const data = await res.json();

        const cards = [
            { icon: 'fa-users', label: 'Total Users', value: data.totalUsers },
            { icon: 'fa-house-user', label: 'Landlords', value: data.totalLandlords },
            { icon: 'fa-user-tag', label: 'Tenants', value: data.totalTenants },
            { icon: 'fa-user-clock', label: 'Pending Requests', value: data.pendingRequests },
            { icon: 'fa-home', label: 'Total Listings', value: data.totalListings }
        ];

        document.getElementById('statsGrid').innerHTML = cards.map(c => `
            <div class="stat-card">
                <i class="fas ${c.icon}"></i>
                <div class="num">${c.value ?? 0}</div>
                <div class="label">${c.label}</div>
            </div>
        `).join('');
    } catch (err) {
        console.error("Stats error:", err);
    }
}

// --- 2. LANDLORD REQUESTS ---
// UPDATED: each row now includes a "Name Match" pill (Match / Mismatch / No
// name given), computed client-side from the user's registered full_name vs.
// the landlord_doc_name they typed. Empty-state colspan bumped from 5 to 6
// to match the new column count.
async function loadLandlordRequests() {
    const tbody = document.getElementById('requestsTableBody');
    try {
        const res = await fetch(`${API_BASE}/landlord-requests`, { headers: adminHeaders() });
        if (handleAuthError(res)) return;
        const rows = await res.json();

        const badge = document.getElementById('reqBadge');
        if (rows.length > 0) {
            badge.style.display = 'inline-block';
            badge.innerText = rows.length;
        } else {
            badge.style.display = 'none';
        }

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-check-circle" style="font-size:24px;"></i><p>No pending landlord requests.</p></div></td></tr>`;
            return;
        }

        window.__landlordRequestDocs = window.__landlordRequestDocs || {};

        tbody.innerHTML = rows.map(u => {
            window.__landlordRequestDocs[u.id] = u.landlord_documents || "";
            const match = nameMatchStatus(u.full_name, u.landlord_doc_name); // NEW
            return `
            <tr>
                <td>${u.full_name}</td>
                <td>${u.email}</td>
                <td>${u.contact || '—'}</td>
                <td>${u.address || '—'}</td>
                <td><span class="pill ${match.cls}">${match.label}</span></td>
                <td>
                    <button class="btn btn-edit" onclick="viewLandlordDocs(${u.id})"><i class="fas fa-file-image"></i> View Docs</button>
                    <button class="btn btn-approve" onclick="approveLandlord(${u.id})"><i class="fas fa-check"></i> Approve</button>
                    <button class="btn btn-reject" onclick="rejectLandlord(${u.id})"><i class="fas fa-times"></i> Reject</button>
                </td>
            </tr>
        `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">Failed to load requests.</div></td></tr>`;
    }
}

// UPDATED: labels array now includes the 4th document (Selfie Holding Valid
// ID), matching the order the frontend compresses+joins documents in:
// Ownership, Permits, BIR, Selfie.
function viewLandlordDocs(userId) {
    const docsString = (window.__landlordRequestDocs && window.__landlordRequestDocs[userId]) || "";
    const docs = docsString ? docsString.split('|||').map(d => d.trim()).filter(d => d !== "") : [];
    const labels = [
        "Proof of Property Ownership (TCT / Tax Declaration)",
        "Local Permits (Barangay Clearance + Mayor's/Business Permit)",
        "BIR Registration (Form 1901/1903)",
        "Selfie Holding Valid ID"
    ];

    const body = document.getElementById('docsModalBody');
    if (docs.length === 0) {
        body.innerHTML = `<div class="empty-state">No documents were uploaded for this request.</div>`;
    } else {
        body.innerHTML = docs.map((imgSrc, i) => `
            <div>
                <span class="doc-preview-label">${labels[i] || `Document ${i + 1}`}</span>
                <img src="${imgSrc}" class="doc-preview" onclick="window.open(this.src, '_blank')" onerror="this.src='https://via.placeholder.com/500x300?text=Failed+to+load'">
            </div>
        `).join('');
    }

    document.getElementById('viewDocsModal').style.display = 'flex';
}

async function approveLandlord(id) {
    const confirm = await Swal.fire({ title: 'Approve this landlord?', text: 'They will immediately be able to post listings.', icon: 'question', showCancelButton: true, confirmButtonText: 'Yes, approve' });
    if (!confirm.isConfirmed) return;

    try {
        const res = await fetch(`${API_BASE}/landlord-requests/${id}/approve`, { method: 'POST', headers: adminHeaders() });
        if (handleAuthError(res)) return;
        if (res.ok) {
            Swal.fire('Approved!', 'The user can now post listings. They will be notified next time they visit the site.', 'success');
            loadLandlordRequests();
            loadUsers();
            loadStats();
        } else {
            Swal.fire('Error', 'Failed to approve request.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// UPDATED: rejection reasons are now picked from a template dropdown instead
// of a free-text-only box, so wording stays consistent across admins. An
// "Other" option still allows a fully custom reason when none of the
// templates fit. The backend endpoint and its `reason` field are unchanged —
// this only changes how that string gets built on the frontend.
async function rejectLandlord(id) {
    const templates = [
        "The Proof of Ownership document was blurry or unreadable.",
        "The name on the document doesn't match your registered name.",
        "The Local Permits (Barangay/Mayor's) appear expired or invalid.",
        "The BIR Registration document is missing or unreadable.",
        "The selfie doesn't clearly show your face together with the ID.",
        "Other (write below)"
    ];
    const OTHER_INDEX = templates.length - 1;

    const { value: formValues, isConfirmed } = await Swal.fire({
        title: 'Reject this request?',
        html: `
            <p style="font-size:13px;color:#78909c;margin-bottom:10px; text-align:left;">Pick a reason, or choose "Other" to write your own.</p>
            <select id="rejectTemplateSelect" class="swal2-select" style="width:100%; margin-bottom:10px;">
                ${templates.map((t, i) => `<option value="${i}">${t}</option>`).join('')}
            </select>
            <textarea id="rejectCustomReason" class="swal2-textarea" placeholder="Write a custom reason..." style="display:none; width:100%;"></textarea>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Reject & Notify',
        confirmButtonColor: '#ff5252',
        didOpen: () => {
            const select = document.getElementById('rejectTemplateSelect');
            const textarea = document.getElementById('rejectCustomReason');
            const toggleCustom = () => {
                const isOther = select.value === String(OTHER_INDEX);
                textarea.style.display = isOther ? 'block' : 'none';
            };
            select.addEventListener('change', toggleCustom);
            toggleCustom();
        },
        preConfirm: () => {
            const select = document.getElementById('rejectTemplateSelect');
            const textarea = document.getElementById('rejectCustomReason');
            const isOther = select.value === String(OTHER_INDEX);
            const reason = isOther ? textarea.value.trim() : templates[select.value];
            if (!reason) {
                Swal.showValidationMessage('Please write a reason.');
                return false;
            }
            return reason;
        }
    });

    if (!isConfirmed) return;

    try {
        const res = await fetch(`${API_BASE}/landlord-requests/${id}/reject`, {
            method: 'POST',
            headers: adminHeaders(),
            body: JSON.stringify({ reason: formValues })
        });
        if (handleAuthError(res)) return;
        if (res.ok) {
            Swal.fire('Rejected', 'The request has been rejected. The applicant will see your reason next time they visit the site.', 'info');
            loadLandlordRequests();
            loadUsers();
            loadStats();
        } else {
            Swal.fire('Error', 'Failed to reject request.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// --- 3. USERS (CRUD) ---
async function loadUsers(search = "") {
    const tbody = document.getElementById('usersTableBody');
    try {
        const res = await fetch(`${API_BASE}/users?search=${encodeURIComponent(search)}`, { headers: adminHeaders() });
        if (handleAuthError(res)) return;
        const rows = await res.json();

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No users found.</div></td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(u => `
            <tr>
                <td>${u.full_name || '—'}</td>
                <td>${u.email}</td>
                <td><span class="pill ${u.role}">${u.role}</span></td>
                <td><span class="pill ${u.landlord_status || 'none'}">${u.landlord_status || 'none'}</span></td>
                <td>${u.contact || '—'}</td>
                <td>
                    <button class="btn btn-edit" onclick='openEditUser(${JSON.stringify(u)})'><i class="fas fa-edit"></i></button>
                    <button class="btn btn-delete" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">Failed to load users.</div></td></tr>`;
    }
}

document.getElementById('userSearch').addEventListener('input', (e) => loadUsers(e.target.value));

function openEditUser(user) {
    editingUserId = user.id;
    document.getElementById('euFullName').value = user.full_name || "";
    document.getElementById('euEmail').value = user.email || "";
    document.getElementById('euContact').value = user.contact || "";
    document.getElementById('euAddress').value = user.address || "";
    document.getElementById('euRole').value = user.role || "tenant";
    document.getElementById('euLandlordStatus').value = user.landlord_status || "none";
    document.getElementById('editUserModal').style.display = 'flex';
}

async function deleteUser(id) {
    const confirm = await Swal.fire({ title: 'Delete this user?', text: 'This cannot be undone.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ff5252', confirmButtonText: 'Delete' });
    if (!confirm.isConfirmed) return;

    try {
        const res = await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE', headers: adminHeaders() });
        if (handleAuthError(res)) return;
        if (res.ok) {
            Swal.fire('Deleted', 'User removed.', 'success');
            loadUsers();
            loadStats();
        } else {
            Swal.fire('Error', 'Failed to delete user.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// --- 4. LISTINGS (CRUD) ---
async function loadListings(search = "") {
    const tbody = document.getElementById('listingsTableBody');
    try {
        const res = await fetch(`${API_BASE}/listings?search=${encodeURIComponent(search)}`, { headers: adminHeaders() });
        if (handleAuthError(res)) return;
        const rows = await res.json();

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No listings found.</div></td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(l => `
            <tr>
                <td>${l.title}</td>
                <td>${l.landlord_name || '—'}</td>
                <td>₱${Number(l.price || 0).toLocaleString()}</td>
                <td>${l.location || '—'}</td>
                <td>
                    <button class="btn btn-edit" onclick='openEditListing(${JSON.stringify(l)})'><i class="fas fa-edit"></i></button>
                    <button class="btn btn-delete" onclick="deleteListing(${l.id})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Failed to load listings.</div></td></tr>`;
    }
}

document.getElementById('listingSearch').addEventListener('input', (e) => loadListings(e.target.value));

function openEditListing(listing) {
    editingListingId = listing.id;
    document.getElementById('elTitle').value = listing.title || "";
    document.getElementById('elCategory').value = listing.category || "Apartment";
    document.getElementById('elPrice').value = listing.price || 0;
    document.getElementById('elLocation').value = listing.location || "";
    document.getElementById('elRooms').value = listing.rooms || 0;
    document.getElementById('elSize').value = listing.size || 0;
    document.getElementById('elAmenities').value = listing.amenities || "";
    document.getElementById('editListingModal').style.display = 'flex';
}

async function deleteListing(id) {
    const confirm = await Swal.fire({ title: 'Delete this listing?', text: 'This cannot be undone.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ff5252', confirmButtonText: 'Delete' });
    if (!confirm.isConfirmed) return;

    try {
        const res = await fetch(`${API_BASE}/listings/${id}`, { method: 'DELETE', headers: adminHeaders() });
        if (handleAuthError(res)) return;
        if (res.ok) {
            Swal.fire('Deleted', 'Listing removed.', 'success');
            loadListings();
            loadStats();
        } else {
            Swal.fire('Error', 'Failed to delete listing.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// --- 5. REVIEWS (moderation) ---
async function loadReviews() {
    const tbody = document.getElementById('reviewsTableBody');
    try {
        const res = await fetch(`${API_BASE}/reviews`, { headers: adminHeaders() });
        if (handleAuthError(res)) return;
        const rows = await res.json();

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No reviews yet.</div></td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${r.listing_title || '—'}</td>
                <td>${r.user_name || '—'}</td>
                <td>${r.rating ? '★'.repeat(r.rating) : '—'}</td>
                <td>${r.comment || '—'}</td>
                <td><button class="btn btn-delete" onclick="deleteReview(${r.id})"><i class="fas fa-trash"></i></button></td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Failed to load reviews.</div></td></tr>`;
    }
}

async function deleteReview(id) {
    const confirm = await Swal.fire({ title: 'Delete this review?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ff5252', confirmButtonText: 'Delete' });
    if (!confirm.isConfirmed) return;

    try {
        const res = await fetch(`${API_BASE}/reviews/${id}`, { method: 'DELETE', headers: adminHeaders() });
        if (handleAuthError(res)) return;
        if (res.ok) {
            Swal.fire('Deleted', 'Review removed.', 'success');
            loadReviews();
        } else {
            Swal.fire('Error', 'Failed to delete review.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// --- NEW: 6. ADMIN ACCOUNT MANAGEMENT (Settings panel) ---
async function loadAdmins() {
    const tbody = document.getElementById('adminsTableBody');
    try {
        const res = await fetch(`${API_BASE}/admins`, { headers: adminHeaders() });
        if (handleAuthError(res)) return;
        const rows = await res.json();

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No admin accounts found.</div></td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(a => {
            const isSelf = currentAdmin && String(currentAdmin.id) === String(a.id);
            const addedDate = a.created_at ? new Date(a.created_at).toLocaleDateString() : '—';
            return `
            <tr>
                <td>${a.full_name}${isSelf ? ' <span class="pill you">You</span>' : ''}</td>
                <td>${a.email}</td>
                <td>${addedDate}</td>
                <td>
                    <button class="btn btn-edit" onclick='openEditAdmin(${JSON.stringify(a)})'><i class="fas fa-edit"></i></button>
                    <button class="btn btn-delete" onclick="deleteAdminAccount(${a.id})" ${isSelf ? 'disabled title="You can\'t delete your own account while logged in as it"' : ''}><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">Failed to load admin accounts.</div></td></tr>`;
    }
}

function setupAdminAccountModal() {
    const addBtn = document.getElementById('addAdminBtn');
    if (!addBtn) return;

    addBtn.onclick = () => {
        editingAdminId = null;
        document.getElementById('adminAccountModalTitle').innerText = 'Add Admin';
        document.getElementById('aaFullName').value = "";
        document.getElementById('aaEmail').value = "";
        document.getElementById('aaPassword').value = "";
        document.getElementById('aaPasswordHint').innerText = 'Required for a new admin.';
        document.getElementById('adminAccountModal').style.display = 'flex';
    };
}

function openEditAdmin(admin) {
    editingAdminId = admin.id;
    document.getElementById('adminAccountModalTitle').innerText = 'Edit Admin';
    document.getElementById('aaFullName').value = admin.full_name || "";
    document.getElementById('aaEmail').value = admin.email || "";
    document.getElementById('aaPassword').value = "";
    document.getElementById('aaPasswordHint').innerText = 'Leave blank to keep the current password.';
    document.getElementById('adminAccountModal').style.display = 'flex';
}

async function deleteAdminAccount(id) {
    const confirm = await Swal.fire({ title: 'Delete this admin account?', text: 'They will immediately lose access to this panel.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ff5252', confirmButtonText: 'Delete' });
    if (!confirm.isConfirmed) return;

    try {
        const res = await fetch(`${API_BASE}/admins/${id}`, { method: 'DELETE', headers: adminHeaders() });
        if (handleAuthError(res)) return;
        const result = await res.json().catch(() => ({}));
        if (res.ok) {
            Swal.fire('Deleted', 'Admin account removed.', 'success');
            loadAdmins();
        } else {
            Swal.fire('Error', result.message || 'Failed to delete admin account.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Server connection failed.', 'error');
    }
}

// --- MODAL HELPERS ---
function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function setupModalSaveHandlers() {
    document.getElementById('saveUserBtn').onclick = async () => {
        const payload = {
            full_name: document.getElementById('euFullName').value.trim(),
            email: document.getElementById('euEmail').value.trim(),
            contact: document.getElementById('euContact').value.trim(),
            address: document.getElementById('euAddress').value.trim(),
            role: document.getElementById('euRole').value,
            landlord_status: document.getElementById('euLandlordStatus').value
        };

        try {
            const res = await fetch(`${API_BASE}/users/${editingUserId}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(payload) });
            if (handleAuthError(res)) return;
            if (res.ok) {
                closeModal('editUserModal');
                Swal.fire('Saved!', 'User updated.', 'success');
                loadUsers();
                loadLandlordRequests();
                loadStats();
            } else {
                Swal.fire('Error', 'Failed to update user.', 'error');
            }
        } catch (err) {
            Swal.fire('Error', 'Server connection failed.', 'error');
        }
    };

    document.getElementById('saveListingBtn').onclick = async () => {
        const payload = {
            title: document.getElementById('elTitle').value.trim(),
            category: document.getElementById('elCategory').value,
            price: parseFloat(document.getElementById('elPrice').value) || 0,
            location: document.getElementById('elLocation').value.trim(),
            rooms: parseInt(document.getElementById('elRooms').value) || 0,
            size: parseFloat(document.getElementById('elSize').value) || 0,
            amenities: document.getElementById('elAmenities').value.trim()
        };

        try {
            const res = await fetch(`${API_BASE}/listings/${editingListingId}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(payload) });
            if (handleAuthError(res)) return;
            if (res.ok) {
                closeModal('editListingModal');
                Swal.fire('Saved!', 'Listing updated.', 'success');
                loadListings();
            } else {
                Swal.fire('Error', 'Failed to update listing.', 'error');
            }
        } catch (err) {
            Swal.fire('Error', 'Server connection failed.', 'error');
        }
    };

    // NEW: save handler for the Add/Edit Admin modal (handles both create and update)
    document.getElementById('saveAdminAccountBtn').onclick = async () => {
        const full_name = document.getElementById('aaFullName').value.trim();
        const email = document.getElementById('aaEmail').value.trim();
        const password = document.getElementById('aaPassword').value;

        if (!full_name || !email) {
            return Swal.fire('Missing Info', 'Full name and email are required.', 'warning');
        }
        if (!editingAdminId && !password) {
            return Swal.fire('Missing Password', 'Password is required when adding a new admin.', 'warning');
        }

        const saveBtn = document.getElementById('saveAdminAccountBtn');
        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";

        try {
            let res;
            if (editingAdminId) {
                res = await fetch(`${API_BASE}/admins/${editingAdminId}`, {
                    method: 'PUT',
                    headers: adminHeaders(),
                    body: JSON.stringify({ full_name, email, password })
                });
            } else {
                res = await fetch(`${API_BASE}/admins`, {
                    method: 'POST',
                    headers: adminHeaders(),
                    body: JSON.stringify({ full_name, email, password })
                });
            }

            if (handleAuthError(res)) return;
            const result = await res.json().catch(() => ({}));

            if (res.ok) {
                closeModal('adminAccountModal');
                Swal.fire('Saved!', result.message || 'Admin account saved.', 'success');
                loadAdmins();
            } else {
                Swal.fire('Error', result.message || 'Failed to save admin account.', 'error');
            }
        } catch (err) {
            Swal.fire('Error', 'Server connection failed.', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save";
        }
    };
}
