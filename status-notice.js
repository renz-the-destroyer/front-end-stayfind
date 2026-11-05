// status-notice.js — load AFTER home.js.
// Replaces checkLandlordStatusUpdate() from home.js (later function
// declarations win), so home.js stays untouched. Same logic as before;
// only the popups look different. Uses home.js globals: currentUser,
// API_BASE, escapeHtml.

(function injectStatusNoticeStyles() {
    if (document.getElementById('statusNoticeStyles')) return;
    const style = document.createElement('style');
    style.id = 'statusNoticeStyles';
    style.textContent = `
        .sn-popup.swal2-popup {
            width: 440px; max-width: calc(100vw - 32px);
            padding: 0; border-radius: 24px; overflow: hidden;
            font-family: 'Plus Jakarta Sans', 'Montserrat', sans-serif;
            box-shadow: 0 30px 80px rgba(8, 24, 60, 0.35);
        }
        .sn-popup .swal2-html-container { margin: 0; padding: 0; text-align: left; }
        .sn-popup .swal2-actions { margin: 0; padding: 0 24px 24px; gap: 10px; width: 100%; flex-wrap: nowrap; }

        /* Coloured header */
        .sn-header { position: relative; overflow: hidden; padding: 30px 24px 26px; text-align: center; color: #fff; }
        .sn-header::after {
            content: ""; position: absolute; width: 190px; height: 190px; border-radius: 50%;
            background: rgba(255,255,255,0.1); top: -90px; right: -60px; pointer-events: none;
        }
        .sn-header.sn-rejected { background: linear-gradient(135deg, #c62828, #ef5350); }
        .sn-header.sn-approved { background: linear-gradient(135deg, #1b7a3a, #43a047); }
        .sn-icon {
            position: relative; z-index: 1;
            width: 62px; height: 62px; border-radius: 50%; margin: 0 auto 14px;
            background: rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.45);
            display: flex; align-items: center; justify-content: center; font-size: 26px;
        }
        .sn-title { position: relative; z-index: 1; margin: 0 0 4px; font-size: 21px; font-weight: 800; letter-spacing: -0.3px; }
        .sn-subtitle { position: relative; z-index: 1; margin: 0; font-size: 13.5px; opacity: 0.92; }

        /* Body */
        .sn-body { padding: 22px 24px 8px; }
        .sn-label {
            display: block; margin: 0 0 8px; font-size: 11px; font-weight: 800;
            text-transform: uppercase; letter-spacing: 0.06em; color: #5c6b7a;
        }
        .sn-reason {
            background: #fff5f5; border: 1.5px solid #f6c9cb; border-left: 5px solid #e5484d;
            border-radius: 14px; padding: 14px 16px; margin: 0 0 20px;
            font-size: 15.5px; font-weight: 600; line-height: 1.55; color: #1a2332;
        }
        .sn-steps { list-style: none; margin: 0 0 6px; padding: 0; counter-reset: sn; }
        .sn-steps li {
            counter-increment: sn; display: flex; align-items: flex-start; gap: 12px;
            margin-bottom: 11px; font-size: 14px; font-weight: 600; line-height: 1.45; color: #1a2332;
        }
        .sn-steps li::before {
            content: counter(sn); flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%;
            background: #e3f2fd; color: #0d47a1; font-size: 12px; font-weight: 800;
            display: flex; align-items: center; justify-content: center; margin-top: 1px;
        }
        .sn-message { margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #1a2332; font-weight: 500; }

        /* Buttons */
        .sn-btn-main, .sn-btn-alt {
            flex: 1; margin: 0; padding: 13px 14px; border: none; border-radius: 12px;
            font-family: inherit; font-size: 14px; font-weight: 800; cursor: pointer;
            transition: transform 0.12s ease, box-shadow 0.15s ease, background 0.15s ease;
        }
        .sn-btn-main { background: linear-gradient(135deg, #0d47a1, #1565c0); color: #fff; box-shadow: 0 10px 22px rgba(13,71,161,0.3); }
        .sn-btn-main.sn-green { background: linear-gradient(135deg, #1b7a3a, #43a047); box-shadow: 0 10px 22px rgba(46,125,50,0.3); }
        .sn-btn-alt { background: #eef1f6; color: #475569; }
        .sn-btn-main:hover, .sn-btn-alt:hover { transform: translateY(-1px); }
        .sn-btn-alt:hover { background: #e3e8f0; }
    `;
    document.head.appendChild(style);
})();

// Opens Settings with the Landlord role already picked, so the document
// upload section is visible right away.
function openSettingsForResubmit() {
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.click();
    const roleSelect = document.getElementById('editRole');
    if (roleSelect) {
        roleSelect.value = 'landlord';
        roleSelect.dispatchEvent(new Event('change'));
    }
}

function showRejectedNotice(reason) {
    return Swal.fire({
        html: `
            <div class="sn-header sn-rejected">
                <div class="sn-icon"><i class="fas fa-file-circle-xmark"></i></div>
                <h2 class="sn-title">Landlord Request Rejected</h2>
                <p class="sn-subtitle">Your documents need a little fix.</p>
            </div>
            <div class="sn-body">
                <span class="sn-label">Reason from admin</span>
                <div class="sn-reason">${escapeHtml(reason || 'Your submitted documents did not meet our requirements.')}</div>

                <span class="sn-label">What to do next</span>
                <ol class="sn-steps">
                    <li>Open <strong>&nbsp;Settings&nbsp;</strong> and choose the Landlord role.</li>
                    <li>Upload clear, readable photos of your documents.</li>
                    <li>Submit again &mdash; an admin will review it.</li>
                </ol>
            </div>
        `,
        showConfirmButton: true,
        confirmButtonText: '<i class="fas fa-file-arrow-up"></i>&nbsp; Update documents',
        showCancelButton: true,
        cancelButtonText: 'Later',
        reverseButtons: true,
        buttonsStyling: false,
        focusConfirm: false,
        customClass: {
            popup: 'sn-popup',
            confirmButton: 'sn-btn-main',
            cancelButton: 'sn-btn-alt'
        }
    }).then((result) => {
        if (result.isConfirmed) openSettingsForResubmit();
    });
}

function showApprovedNotice() {
    return Swal.fire({
        html: `
            <div class="sn-header sn-approved">
                <div class="sn-icon"><i class="fas fa-circle-check"></i></div>
                <h2 class="sn-title">You're Approved! 🎉</h2>
                <p class="sn-subtitle">Landlord access is now unlocked.</p>
            </div>
            <div class="sn-body">
                <p class="sn-message">Congratulations! The <strong>Post</strong> button is now available, so you can start listing your properties.</p>
            </div>
        `,
        confirmButtonText: 'Great!',
        buttonsStyling: false,
        customClass: {
            popup: 'sn-popup',
            confirmButton: 'sn-btn-main sn-green'
        }
    });
}

// Same logic as home.js's version — only the popups changed.
async function checkLandlordStatusUpdate() {
    if (!currentUser || !currentUser.id) return;

    try {
        const res = await fetch(`${API_BASE}/view/${currentUser.id}`);
        if (!res.ok) return;
        const freshUser = await res.json();
        if (!freshUser || freshUser.message === 'User not found') return;

        const newStatus = freshUser.landlord_status || 'none';
        const newReason = freshUser.landlord_rejection_reason || '';
        const seenKey = `landlordSeen_${currentUser.id}`;
        const lastSeen = localStorage.getItem(seenKey) || '';
        const currentSignature = newStatus === 'rejected' ? `rejected|${newReason}` : newStatus;

        if (currentSignature !== lastSeen) {
            if (newStatus === 'approved' && lastSeen.startsWith('pending')) {
                showApprovedNotice();
            } else if (newStatus === 'rejected') {
                showRejectedNotice(newReason);
            }
            localStorage.setItem(seenKey, currentSignature);
        }

        if (currentUser.landlord_status !== freshUser.landlord_status || currentUser.role !== freshUser.role) {
            currentUser.role = freshUser.role;
            currentUser.landlord_status = freshUser.landlord_status;
            currentUser.landlord_rejection_reason = freshUser.landlord_rejection_reason;
            localStorage.setItem('user', JSON.stringify(currentUser));

            const postBtn = document.getElementById('postBtn');
            if (postBtn) postBtn.style.display = (currentUser.role === 'landlord') ? 'flex' : 'none';
            const postFab = document.getElementById('postFab');
            if (postFab) postFab.style.display = (currentUser.role === 'landlord') ? '' : 'none';
        }
    } catch (err) {
        console.log("Landlord status check failed silently:", err);
    }
}
