// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app-system.onrender.com/api";

const currentUser = JSON.parse(localStorage.getItem('user'));
const listingsGrid = document.getElementById('listingsGrid');

// Global variable to track selected stars
let selectedRating = 0;

// NEW: Tracks which Available/Occupied filter is currently active, so it
// can be cleared cleanly when switching to Browse/Saved and vice versa.
let currentAvailabilityFilter = null; // 'available' | 'occupied' | null

// NEW: Tracks a snapshot of the Post/Edit Listing form so we can warn the user
// before they lose unsaved changes (Cancel button, clicking outside, closing the tab).
let originalFormSnapshot = null;

// NEW: Persistent list of File objects picked for "Post a Listing" / "Edit
// Listing". A native <input type="file"> REPLACES its entire FileList every
// time the picker is opened again - so choosing one photo, then opening
// "Choose files" a second time to add another, was silently discarding the
// first pick. That was the real cause of "uploading a different photo just
// replaces the one I picked." This array is now the single source of truth
// for what actually gets uploaded; the <input> is only used to grab new
// picks, which get appended here and then the input is cleared.
let selectedListingFiles = [];

// NEW: Rebuilds the photo preview strip from selectedListingFiles. Each
// thumbnail gets a small "x" button so a specific photo can be removed
// before publishing/saving, without clearing the whole selection.
function renderSelectedFilePreviews() {
    const previewDiv = document.getElementById('imagePreview');
    if (!previewDiv) return;

    if (selectedListingFiles.length === 0) {
        previewDiv.innerHTML = "";
        return;
    }

    previewDiv.innerHTML = selectedListingFiles.map((file, idx) => {
        const url = URL.createObjectURL(file);
        return `
            <div style="position:relative; width:60px; height:60px;">
                <img src="${url}" style="width:60px; height:60px; object-fit:cover; border-radius:5px; border:1px solid #ddd;">
                <span onclick="removeSelectedListingFile(${idx})" title="Remove photo" style="position:absolute; top:-6px; right:-6px; background:#ff5252; color:white; width:18px; height:18px; border-radius:50%; font-size:11px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-weight:bold; box-shadow:0 1px 3px rgba(0,0,0,0.4);">&times;</span>
            </div>
        `;
    }).join('');
}

// NEW: Removes one photo from the pending selection (called by the "x"
// button rendered in renderSelectedFilePreviews above).
function removeSelectedListingFile(index) {
    selectedListingFiles.splice(index, 1);
    renderSelectedFilePreviews();
}

// --- IMAGE HELPERS (NEW: shared by grid cards, the details modal, New Listing, and Edit Listing) ---

// UPDATED: This carousel builder used to live only inline inside renderListings().
// It's now a shared function so the exact same carousel markup can also be
// injected into the listing-details modal (#carouselWrapper), which previously
// never received any images at all - that was the main reason photos didn't
// show up when a user opened a listing.
function buildCarouselHTML(imagesField, carouselKey) {
    let imgArray = [];
    // FIX: split using '|||' instead of ',' because base64 data URLs
    // (e.g. "data:image/jpeg;base64,...") already contain commas internally.
    // Using ',' as a delimiter was corrupting every image, even a single upload.
    if (imagesField && imagesField.trim() !== "") {
        imgArray = imagesField.split('|||').map(img => img.trim()).filter(img => img !== "");
    }
    if (imgArray.length === 0) {
        imgArray = ['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500'];
    }

    // NEW: the details-modal carousel (carouselKey starts with "modal-") gets
    // its own rounded corners + bottom margin since it sits inside padded
    // modal content. Grid-card carousels stay flush/unrounded so the card's
    // own border-radius + overflow:hidden clips the image at the top edge.
    const isStandalone = String(carouselKey).startsWith('modal-');

    return `
        <div class="carousel-container ${isStandalone ? 'carousel-standalone' : ''}" id="carousel-${carouselKey}">
            <div class="carousel-track" style="transform: translateX(0px);">
                ${imgArray.map(img => `<img src="${img}" class="carousel-img" onerror="this.src='https://via.placeholder.com/400x200?text=No+Image'">`).join('')}
            </div>
            ${imgArray.length > 1 ? `
                <button class="carousel-btn prev-btn" onclick="moveCarousel(event, '${carouselKey}', -1)"><i class="fas fa-chevron-left"></i></button>
                <button class="carousel-btn next-btn" onclick="moveCarousel(event, '${carouselKey}', 1)"><i class="fas fa-chevron-right"></i></button>
                <div class="carousel-dots">${imgArray.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
            ` : ''}
        </div>
    `;
}

// NEW: shared image-compression helper. This used to be defined ONLY inside
// setupPostListingLogic() (New Listing), so Edit Listing had no way to
// compress and attach new photos. Moving it here lets both flows reuse the
// exact same compression code. Also reused by setupSettingsLogic() for
// compressing landlord verification documents.
function compressImageFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
        };
    });
}

// NEW: Shared helper used by both "New Listing" and "Edit Listing" right
// before submitting. It doesn't block the upload - it just warns the user if
// the combined compressed photos are large enough that they might exceed a
// hosting provider's database packet-size limit (a common reason multi-photo
// uploads fail while single-photo uploads succeed). If you still see photos
// fail to save after raising the DB column to LONGTEXT, this is the next
// thing to check - either reduce photo count or ask your DB host to raise
// max_allowed_packet.
function warnIfImagesTooLarge(base64Images) {
    if (!base64Images || base64Images.length === 0) return 0;
    const totalBytes = base64Images.reduce((sum, img) => sum + img.length, 0);
    const totalMB = totalBytes / (1024 * 1024);
    if (totalMB > 8) {
        Swal.fire({
            title: 'Heads up: large photos',
            text: `Your selected photos total about ${totalMB.toFixed(1)}MB after compression. If the upload fails, try using fewer photos or smaller images.`,
            icon: 'info',
            timer: 3500,
            showConfirmButton: false,
            toast: true,
            position: 'top-end'
        });
    }
    return totalMB;
}

// NEW: Checks whether the admin approved or rejected a pending landlord
// request since the last time this browser knew about it, and shows a
// one-time SweetAlert notification. Runs on every home.html load, since
// there's no push/email system wired up for this - checking on page visit
// is the simplest reliable way to surface the outcome. After showing the
// notification (or finding nothing changed), it syncs localStorage with the
// server's current truth so the same notification never repeats, and
// refreshes the Post button immediately if the role changed.
async function checkLandlordStatusUpdate() {
    if (!currentUser || !currentUser.id) return;

    try {
        const res = await fetch(`${API_BASE}/view/${currentUser.id}`);
        if (!res.ok) return;
        const freshUser = await res.json();
        if (!freshUser || freshUser.message === 'User not found') return;

        const oldStatus = currentUser.landlord_status || 'none';
        const newStatus = freshUser.landlord_status || 'none';

        if (oldStatus === 'pending' && newStatus === 'approved') {
            Swal.fire({
                title: 'Landlord Access Approved! 🎉',
                text: 'Congratulations! Your landlord request has been approved. The Post button is now unlocked so you can start listing your properties.',
                icon: 'success',
                confirmButtonText: 'Great!'
            });
        } else if (oldStatus === 'pending' && newStatus === 'rejected') {
            Swal.fire({
                title: 'Landlord Request Rejected',
                html: `<p style="text-align:left; font-size:14px; color:#555; margin:0;">${freshUser.landlord_rejection_reason || 'Your submitted documents did not meet our requirements.'}</p>
                       <p style="text-align:left; font-size:12px; color:#90a4ae; margin-top:12px;">You can update your documents and try again anytime from <strong>Settings</strong>.</p>`,
                icon: 'info',
                confirmButtonText: 'Got it'
            });
        }

        // NEW: sync localStorage + in-memory currentUser with the latest
        // server truth so this notification only ever fires once per change,
        // and so role-dependent UI (like the Post button) reflects reality
        // immediately without requiring a manual logout/login.
        if (oldStatus !== newStatus || currentUser.role !== freshUser.role) {
            currentUser.role = freshUser.role;
            currentUser.landlord_status = freshUser.landlord_status;
            currentUser.landlord_rejection_reason = freshUser.landlord_rejection_reason;
            localStorage.setItem('user', JSON.stringify(currentUser));

            const postBtn = document.getElementById('postBtn');
            if (postBtn) {
                postBtn.style.display = (currentUser.role === 'landlord') ? 'flex' : 'none';
            }
            const postFab = document.getElementById('postFab');
            if (postFab) {
                postFab.style.display = (currentUser.role === 'landlord') ? '' : 'none';
            }
        }
    } catch (err) {
        // Silent fail - this is a background check, shouldn't interrupt the page
        console.log("Landlord status check failed silently:", err);
    }
}

// --- NEW: PERSONALIZED HERO GREETING ---
// Fills in the hero header with a time-aware greeting and role-specific
// subtitle. Pure presentation - doesn't touch any data or state.
function setupHeroGreeting() {
    const heroGreeting = document.getElementById('heroGreeting');
    const heroSubtitle = document.getElementById('heroSubtitle');
    const heroEyebrow = document.getElementById('heroEyebrow');
    if (!heroGreeting || !currentUser) return;

    const name = (currentUser.full_name || currentUser.name || "there").trim().split(' ')[0];
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? "Good morning" : (hour < 18 ? "Good afternoon" : "Good evening");

    heroGreeting.innerText = `${timeGreeting}, ${name} 👋`;

    if (currentUser.role === 'landlord') {
        if (heroEyebrow) heroEyebrow.innerText = "Landlord Dashboard";
        if (heroSubtitle) heroSubtitle.innerText = "Here's what's happening with your listings today.";
    } else {
        if (heroEyebrow) heroEyebrow.innerText = "Find Your Next Stay";
        if (heroSubtitle) heroSubtitle.innerText = "Discover verified stays across the Philippines.";
    }
}

// --- 1. SECURITY & ROLE CHECK ---
window.onload = () => {
    if (!currentUser) {
        window.location.href = "index.html";
        return;
    }

    const postBtn = document.getElementById('postBtn');
    if (postBtn && currentUser.role === 'landlord') {
        postBtn.style.display = 'flex';
    }
    const postFab = document.getElementById('postFab');
    if (postFab && currentUser.role === 'landlord') {
        postFab.style.display = 'flex';
    }

    // NEW: Inject Smart Search Button if it doesn't exist in HTML
    if (!document.getElementById('smartSearchBtn') && currentUser.role === 'tenant') {
        injectSmartSearchUI();
    }

    console.log("Welcome back, " + (currentUser.full_name || currentUser.name || "User"));

    setupHeroGreeting(); // NEW: personalized hero header
    loadListings();
    setupSettingsLogic(); 
    setupPostListingLogic(); 
    setupBookmarkToggles(); 
    setupStarRatingLogic(); // Initialize star click listeners
    setupSideDrawer(); // NEW: hamburger-triggered side navigation
    setupFiltersToggle(); // NEW: collapsible filter panel on mobile
    setupAvailabilityFilterButtons(); // NEW: Available Property / Occupied Property buttons

    // NEW: check for a landlord approval/rejection outcome to notify the user about
    checkLandlordStatusUpdate();
};

// --- NEW: SIDE DRAWER NAVIGATION ---
// Consolidates what used to be separate top-nav links + a bottom mobile nav
// bar into a single hamburger-triggered slide-in panel that works the same
// way on phone and desktop. All the individual nav items (Browse, Saved,
// Post, Settings, Admin, Logout) keep their original element IDs, so every
// existing click handler elsewhere in this file (setupBookmarkToggles,
// setupSettingsLogic, the logout handler, etc.) keeps working untouched -
// this only adds the open/close behavior around them.
function setupSideDrawer() {
    const menuToggleBtn = document.getElementById('menuToggleBtn');
    const closeDrawerBtn = document.getElementById('closeDrawerBtn');
    const drawer = document.getElementById('sideDrawer');
    const overlay = document.getElementById('sideDrawerOverlay');
    if (!menuToggleBtn || !drawer || !overlay) return;

    function openDrawer() {
        drawer.classList.add('open');
        overlay.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        menuToggleBtn.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        menuToggleBtn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }

    menuToggleBtn.onclick = openDrawer;
    closeDrawerBtn.onclick = closeDrawer;
    overlay.onclick = closeDrawer;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDrawer();
    });

    // Close the drawer automatically once any link inside it is used, so the
    // user doesn't have to close it manually after navigating.
    drawer.querySelectorAll('a').forEach(link => link.addEventListener('click', closeDrawer));

    // Fill in the little identity card at the top of the drawer.
    const drawerUserInfo = document.getElementById('drawerUserInfo');
    if (drawerUserInfo && currentUser) {
        const name = currentUser.full_name || currentUser.name || "User";
        const initial = name.trim().charAt(0).toUpperCase() || "U";
        drawerUserInfo.innerHTML = `
            <div class="drawer-avatar">${initial}</div>
            <div>
                <div class="drawer-user-name">${name}</div>
                <div class="drawer-user-role">${currentUser.role === 'landlord' ? 'Landlord' : 'Tenant'}</div>
            </div>
        `;
    }
}

// --- NEW: COLLAPSIBLE FILTER PANEL (mobile only) ---
// On phones, the price/rooms/location filters used to always take up
// vertical space below the search bar even when nobody needed them right
// now. This tucks them behind a "Filters" toggle so the page opens clean;
// on desktop the CSS media query keeps them visible as before.
function setupFiltersToggle() {
    const toggleBtn = document.getElementById('filtersToggleBtn');
    const label = document.getElementById('filtersToggleLabel');
    const body = document.getElementById('advancedFiltersBody');
    if (!toggleBtn || !body) return;

    toggleBtn.onclick = () => {
        const isOpen = body.classList.toggle('open');
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
        const icon = toggleBtn.querySelector('i');
        if (icon) icon.className = isOpen ? 'fas fa-chevron-up' : 'fas fa-filter';
        if (label) label.innerText = isOpen ? 'Hide Filters' : 'Filters';
    };
}

// --- NEW: AVAILABLE PROPERTY / OCCUPIED PROPERTY FILTER BUTTONS ---
// Lets a tenant (or a landlord looking at their own listings) narrow the
// grid down to only 'available' or only 'occupied' listings. Tapping the
// same button twice clears the filter. Works on whatever is currently
// rendered in the grid (same pattern used by the existing "Saved" toggle),
// so it plays nicely with search/price/room filters already applied.
function setupAvailabilityFilterButtons() {
    const availableBtn = document.getElementById('availablePropertyBtn');
    const occupiedBtn = document.getElementById('occupiedPropertyBtn');
    if (!availableBtn || !occupiedBtn) return;

    availableBtn.onclick = () => applyAvailabilityFilter('available', availableBtn, occupiedBtn);
    occupiedBtn.onclick = () => applyAvailabilityFilter('occupied', occupiedBtn, availableBtn);
}

function clearAvailabilityFilterState() {
    currentAvailabilityFilter = null;
    const availableBtn = document.getElementById('availablePropertyBtn');
    const occupiedBtn = document.getElementById('occupiedPropertyBtn');
    if (availableBtn) availableBtn.classList.remove('availability-active');
    if (occupiedBtn) occupiedBtn.classList.remove('availability-active');
    const noStatusMsg = document.getElementById('no-status-msg');
    if (noStatusMsg) noStatusMsg.remove();
}

function applyAvailabilityFilter(status, clickedBtn, otherBtn) {
    const cards = document.querySelectorAll('.listing-card');
    const isReapplyingSame = currentAvailabilityFilter === status;

    // Clear any "Saved" view state so the two filters don't fight each other
    const savedMsg = document.getElementById('no-saved-msg');
    if (savedMsg) savedMsg.remove();
    const noStatusMsg = document.getElementById('no-status-msg');
    if (noStatusMsg) noStatusMsg.remove();
    const viewAllBtn = document.getElementById('viewAllBtn');
    const viewSavedBtn = document.getElementById('viewSavedBtn');
    if (viewSavedBtn) viewSavedBtn.classList.remove('nav-active');

    if (isReapplyingSame) {
        // Tapping the same button again clears the filter and shows everything
        currentAvailabilityFilter = null;
        clickedBtn.classList.remove('availability-active');
        cards.forEach(card => { card.style.display = "block"; });
        if (viewAllBtn) viewAllBtn.classList.add('nav-active');
        return;
    }

    currentAvailabilityFilter = status;
    clickedBtn.classList.add('availability-active');
    otherBtn.classList.remove('availability-active');
    if (viewAllBtn) viewAllBtn.classList.remove('nav-active');

    let found = 0;
    cards.forEach(card => {
        const cardStatus = card.getAttribute('data-status') || 'available';
        if (cardStatus === status) {
            card.style.display = "block";
            found++;
        } else {
            card.style.display = "none";
        }
    });

    if (found === 0) {
        const label = status === 'available' ? 'available' : 'occupied';
        listingsGrid.insertAdjacentHTML(
            'beforeend',
            `<div id="no-status-msg">${emptyStateHTML('fa-house-circle-xmark', `No ${label} properties`, `There are currently no ${label} listings to show.`)}</div>`
        );
    }
}

// --- REDESIGNED: SMART SEARCH UI INJECTION ---
// Builds the floating "Smart Finder" launcher + panel. The IDs
// (smartSearchBtn, smartSearchBox, smartInput, executeSmartSearch) and the
// show/hide-via-style.display mechanism are kept the same so
// processSmartSearch() below still works without any changes to its wiring.
function injectSmartSearchUI() {
    // Inject the widget's CSS once (keyframes/hover states need a real
    // stylesheet - inline style attributes can't do animations or :hover).
    if (!document.getElementById('smartSearchStyles')) {
        const styleTag = document.createElement('style');
        styleTag.id = 'smartSearchStyles';
        styleTag.textContent = `
            .ss-launcher {
                position: fixed; bottom: 20px; right: 20px; z-index: 999;
                display: flex; align-items: center; gap: 10px;
                padding: 14px 22px 14px 18px; border-radius: 999px; border: none;
                background: linear-gradient(135deg, #0d47a1, #1e88e5); color: #fff;
                font-family: 'Plus Jakarta Sans', 'Montserrat', sans-serif;
                font-weight: 700; font-size: 14px; cursor: pointer;
                box-shadow: 0 10px 30px rgba(13,71,161,0.4);
                transition: transform 0.2s ease, box-shadow 0.2s ease;
            }
            .ss-launcher:hover { transform: translateY(-2px); box-shadow: 0 14px 36px rgba(13,71,161,0.5); }
            .ss-launcher:active { transform: scale(0.96); }
            .ss-launcher i { font-size: 16px; }
            .ss-launcher-pulse {
                position: absolute; inset: 0; border-radius: 999px;
                border: 2px solid rgba(66,165,245,0.6);
                animation: ss-pulse 2.2s ease-out infinite; pointer-events: none;
            }
            @keyframes ss-pulse {
                0% { transform: scale(1); opacity: 0.8; }
                100% { transform: scale(1.35); opacity: 0; }
            }
            .ss-panel {
                display: none; position: fixed; bottom: 90px; right: 20px; z-index: 1000;
                width: 340px; max-width: calc(100vw - 40px);
                background: #ffffff; border-radius: 22px; overflow: hidden;
                box-shadow: 0 24px 60px rgba(16,24,40,0.22);
                border: 1px solid rgba(13,71,161,0.08);
                font-family: 'Plus Jakarta Sans', 'Montserrat', sans-serif;
                opacity: 0; transform: translateY(16px) scale(0.97);
                transition: opacity 0.25s ease, transform 0.25s ease;
                flex-direction: column;
            }
            .ss-panel.open { display: flex; opacity: 1; transform: translateY(0) scale(1); }
            .ss-panel-header {
                background: linear-gradient(135deg, #0d47a1, #1565c0 55%, #1e88e5);
                padding: 20px 20px 22px; display: flex; align-items: flex-start;
                justify-content: space-between; position: relative; overflow: hidden;
            }
            .ss-panel-header::after {
                content: ""; position: absolute; width: 140px; height: 140px;
                background: rgba(255,255,255,0.08); border-radius: 50%; top: -60px; right: -40px;
            }
            .ss-panel-eyebrow {
                display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 1px;
                text-transform: uppercase; color: rgba(255,255,255,0.75); margin-bottom: 4px;
            }
            .ss-panel-title { margin: 0; color: #fff; font-size: 19px; font-weight: 800; letter-spacing: -0.3px; }
            .ss-close-btn {
                background: rgba(255,255,255,0.16); border: none; color: #fff;
                width: 30px; height: 30px; border-radius: 9px; cursor: pointer; font-size: 13px;
                flex-shrink: 0; position: relative; z-index: 2; transition: background 0.15s;
            }
            .ss-close-btn:hover { background: rgba(255,255,255,0.3); }
            .ss-panel-body { padding: 18px 20px 20px; }
            .ss-panel-intro { margin: 0 0 14px; font-size: 12.5px; color: #64748b; line-height: 1.5; }
            .ss-chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
            .ss-chip {
                display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
                border-radius: 999px; border: 1px solid #e3f2fd; background: #f8fbff;
                color: #0d47a1; font-size: 11.5px; font-weight: 600; cursor: pointer;
                font-family: inherit; transition: background 0.15s, transform 0.15s, border-color 0.15s;
            }
            .ss-chip i { font-size: 10px; color: #42a5f5; }
            .ss-chip:hover { background: #e3f2fd; border-color: #42a5f5; transform: translateY(-1px); }
            .ss-chip:active { transform: scale(0.96); }
            .ss-input-row { position: relative; margin-bottom: 12px; }
            .ss-input-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 13px; }
            .ss-input {
                width: 100%; padding: 12px 14px 12px 38px; border-radius: 12px;
                border: 1.5px solid #e5e9f0; background: #fbfcfe; font-size: 13.5px;
                font-family: inherit; outline: none; box-sizing: border-box;
                transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
            }
            .ss-input:focus { border-color: #42a5f5; box-shadow: 0 0 0 4px rgba(66,165,245,0.14); background: #fff; }
            .ss-submit-btn {
                width: 100%; padding: 13px; border: none; border-radius: 13px;
                background: linear-gradient(135deg, #0d47a1, #1565c0); color: #fff;
                font-weight: 700; font-size: 13.5px; cursor: pointer;
                box-shadow: 0 10px 22px rgba(13,71,161,0.28);
                transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
                display: flex; align-items: center; justify-content: center; gap: 8px;
                font-family: inherit;
            }
            .ss-submit-btn:hover { transform: translateY(-1px); box-shadow: 0 14px 28px rgba(13,71,161,0.35); }
            .ss-submit-btn:disabled { opacity: 0.75; cursor: not-allowed; transform: none; }
            .ss-dot {
                width: 6px; height: 6px; border-radius: 50%; background: #fff;
                display: inline-block; margin: 0 2px; animation: ss-bounce 1.2s infinite ease-in-out;
            }
            .ss-dot:nth-child(2) { animation-delay: 0.15s; }
            .ss-dot:nth-child(3) { animation-delay: 0.3s; }
            @keyframes ss-bounce {
                0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
                40% { transform: scale(1); opacity: 1; }
            }
            @media (max-width: 480px) {
                .ss-panel { width: 100%; right: 0; bottom: 0; border-radius: 22px 22px 0 0; max-width: 100vw; }
                .ss-launcher-label { display: none; }
                .ss-launcher { padding: 14px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .ss-launcher-pulse, .ss-dot { animation: none; }
                .ss-panel { transition: none; }
            }
        `;
        document.head.appendChild(styleTag);
    }

    const btn = document.createElement('button');
    btn.id = "smartSearchBtn";
    btn.className = "ss-launcher";
    btn.setAttribute('aria-label', 'Open Smart Search');
    btn.innerHTML = `
        <span class="ss-launcher-pulse"></span>
        <i class="fas fa-wand-magic-sparkles"></i>
        <span class="ss-launcher-label">Smart Search</span>
    `;
    document.body.appendChild(btn);

    const chatbox = document.createElement('div');
    chatbox.id = "smartSearchBox";
    chatbox.className = "ss-panel";
    chatbox.innerHTML = `
        <div class="ss-panel-header">
            <div>
                <span class="ss-panel-eyebrow">AI-Assisted</span>
                <h3 class="ss-panel-title">Smart Finder</h3>
            </div>
            <button type="button" id="smartSearchCloseBtn" class="ss-close-btn" aria-label="Close"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="ss-panel-body">
            <p class="ss-panel-intro">Search naturally, in English or Tagalog — try a shortcut below or type your own.</p>
            <div class="ss-chip-row" id="smartChipRow">
                <button type="button" class="ss-chip" data-query="house malapit sa UP"><i class="fas fa-house"></i>House near UP</button>
                <button type="button" class="ss-chip" data-query="apartment na may wifi"><i class="fas fa-wifi"></i>Has wifi</button>
                <button type="button" class="ss-chip" data-query="room under 5000"><i class="fas fa-peso-sign"></i>Under ₱5,000</button>
                <button type="button" class="ss-chip" data-query="may parking"><i class="fas fa-square-parking"></i>Parking</button>
            </div>
            <div class="ss-input-row">
                <i class="fas fa-magnifying-glass ss-input-icon"></i>
                <input type="text" id="smartInput" class="ss-input" placeholder="e.g. bahay malapit sa palengke...">
            </div>
            <button type="button" id="executeSmartSearch" class="ss-submit-btn">
                <span class="ss-submit-label"><i class="fas fa-wand-magic-sparkles"></i> Find Stays</span>
            </button>
        </div>
    `;
    document.body.appendChild(chatbox);

    // Animated open/close. Still driven by style.display (block <-> none)
    // underneath, so processSmartSearch()'s existing line that sets
    // smartSearchBox.style.display = 'none' on a successful search keeps
    // working exactly as before - no changes needed there for the open/close
    // mechanism itself.
    function openPanel() {
        chatbox.style.display = 'flex';
        requestAnimationFrame(() => chatbox.classList.add('open'));
        document.getElementById('smartInput').focus();
    }
    function closePanel() {
        chatbox.classList.remove('open');
        setTimeout(() => {
            if (!chatbox.classList.contains('open')) chatbox.style.display = 'none';
        }, 220);
    }

    btn.onclick = () => {
        const isOpen = chatbox.classList.contains('open');
        if (isOpen) closePanel(); else openPanel();
    };
    document.getElementById('smartSearchCloseBtn').onclick = closePanel;

    // NEW: Suggestion chips - tapping one fills the input and runs the
    // search immediately, doubling as a quick demo of what Smart Search
    // actually understands (property type, amenities, price).
    document.querySelectorAll('.ss-chip').forEach(chip => {
        chip.onclick = () => {
            document.getElementById('smartInput').value = chip.getAttribute('data-query');
            processSmartSearch();
        };
    });

    document.getElementById('executeSmartSearch').onclick = processSmartSearch;
    document.getElementById('smartInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') processSmartSearch();
    });
}

// --- UPDATED: SMART SEARCH LOGIC (API Connected) ---
async function processSmartSearch() {
    const rawQuery = document.getElementById('smartInput').value.trim();
    if (!rawQuery) return;

    const searchBtn = document.getElementById('executeSmartSearch');
    // NEW: swap in an animated "thinking" dots indicator instead of just
    // changing button text, and remember the original markup so it can be
    // restored exactly afterward.
    const originalBtnContent = searchBtn.innerHTML;
    searchBtn.disabled = true;
    searchBtn.innerHTML = '<span class="ss-dot"></span><span class="ss-dot"></span><span class="ss-dot"></span>';

    try {
        const response = await fetch(`${API_BASE}/smart-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: rawQuery.toLowerCase(),
                userContext: { role: currentUser.role, id: currentUser.id } // Send role context to backend
            }) 
        });

        if (!response.ok) throw new Error("Search failed");

        const data = await response.json();
        console.log("🕵️ BACKEND RESPONSE:", data); 

        let results = data.results || [];

        if (results.length > 0) {
            const smartSearchBoxEl = document.getElementById('smartSearchBox');
            smartSearchBoxEl.classList.remove('open'); // NEW: keep panel state consistent for next time it's opened
            smartSearchBoxEl.style.display = 'none';
            renderListings(results); 
            
            Swal.fire({ 
                title: 'Smart Search', 
                text: `Found ${results.length} matches!`, 
                icon: 'success', 
                toast: true, 
                position: 'top-end', 
                timer: 3000, 
                showConfirmButton: false 
            });
        } else {
            Swal.fire({ 
                title: 'No matches', 
                text: `We couldn't find exactly "${rawQuery}". Try simpler keywords like "apartment" or "eu".`, 
                icon: 'info' 
            });
        }
    } catch (error) {
        console.error("Smart Search Error:", error);
        Swal.fire('Error', 'Something went wrong with the smart search.', 'error');
    } finally {
        searchBtn.disabled = false;
        searchBtn.innerHTML = originalBtnContent; // NEW: restore the original icon+label markup
        document.getElementById('smartInput').value = "";
    }
}

// --- NEW: SHARED UI HELPERS (empty states + skeleton loaders) ---
// Small presentational helpers used by loadListings() and the "Saved" view
// so every empty/loading/error state looks consistent instead of a plain
// line of text.
function emptyStateHTML(icon, title, subtitle) {
    return `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="fas ${icon}"></i></div>
            <h3>${title}</h3>
            <p>${subtitle}</p>
        </div>
    `;
}

function renderSkeletonCards(count = 8) {
    if (!listingsGrid) return;
    listingsGrid.innerHTML = Array.from({ length: count }).map(() => `
        <div class="listing-card skeleton-card">
            <div class="skeleton-block skeleton-image"></div>
            <div class="listing-info">
                <div class="skeleton-block skeleton-line" style="width:45%;"></div>
                <div class="skeleton-block skeleton-line" style="width:85%; margin-top:12px;"></div>
                <div class="skeleton-block skeleton-line" style="width:60%; margin-top:8px;"></div>
                <div class="skeleton-block skeleton-line" style="width:70%; margin-top:14px; height:12px;"></div>
            </div>
        </div>
    `).join('');
}

// --- 2. FETCH LISTINGS FROM MYSQL ---
async function loadListings() {
    if (!listingsGrid) return;

    clearAvailabilityFilterState(); // NEW: reset the availability filter whenever the grid is fully reloaded
    renderSkeletonCards(); // NEW: shimmer placeholders instead of a bare "Loading..." line
    
    try {
        const response = await fetch(`${API_BASE}/view`);
        const data = await response.json();

        if (!data || data.length === 0) {
            listingsGrid.innerHTML = emptyStateHTML('fa-house-circle-xmark', 'No listings yet', 'Check back soon — new stays are added regularly.');
            return;
        }

        const dataToShow = (currentUser && currentUser.role === 'landlord') 
            ? data.filter(item => {
                const itemOwner = String(item.user_id || item.landlord_id || "");
                const currentId = String(currentUser.id || "");
                return itemOwner === currentId;
            })
            : data;

        if (dataToShow.length === 0 && currentUser.role === 'landlord') {
            listingsGrid.innerHTML = emptyStateHTML('fa-clipboard-list', "You haven't posted anything yet", 'Tap the + button to publish your first listing.');
            return;
        }

        renderListings(dataToShow);
    } catch (error) {
        console.error("Error fetching listings:", error);
        listingsGrid.innerHTML = emptyStateHTML('fa-triangle-exclamation', 'Something went wrong', "We couldn't load listings. Check if the backend is live and try again.");
    }
}

// --- 3. RENDER HTML CARDS ---
async function renderListings(items) {
    listingsGrid.innerHTML = ""; 
    
    let savedListings = JSON.parse(localStorage.getItem('bookmarks')) || [];
    
    if (currentUser && currentUser.id) {
        try {
            const favRes = await fetch(`${API_BASE}/get-bookmarks/${currentUser.id}`);
            if (favRes.ok) {
                const favData = await favRes.json();
                savedListings = favData.map(item => item.listing_id);
                localStorage.setItem('bookmarks', JSON.stringify(savedListings));
            }
        } catch (err) { 
            console.log("Database bookmark sync failed, using local backup."); 
        }
    }
    
    items.forEach((item, idx) => {
        if (!item.title && !item.price) return;

        const isSaved = savedListings.includes(item.id);

        // UPDATED: now uses the shared buildCarouselHTML() helper defined near the
        // top of this file (also used by the details modal below).
        let carouselHTML = buildCarouselHTML(item.images, item.id);

        // NEW: Availability badge (Available / Occupied), driven by the new
        // `status` column on listings. Defaults to 'available' for any
        // existing rows created before this column existed.
        const statusValue = (item.status || 'available').toLowerCase() === 'occupied' ? 'occupied' : 'available';
        const statusBadgeHTML = `<div class="status-badge ${statusValue}">${statusValue === 'occupied' ? 'Occupied' : 'Available'}</div>`;
        
        const card = document.createElement('div');
        card.className = 'listing-card';
        card.setAttribute('data-id', item.id);
        card.setAttribute('data-price', item.price || 0);
        card.setAttribute('data-rooms', item.rooms || 0);
        card.setAttribute('data-status', statusValue); // NEW: used by the Available/Occupied filter buttons
        // FIX: the search bar's placeholder promises "title, location, or
        // amenities" but amenities text was never stored anywhere on the
        // card, so searching "wifi" (or any amenity) could never match.
        // Stashing it here (lowercased, same as the other filter fields)
        // is what filterListings() below now checks against.
        card.setAttribute('data-amenities', (item.amenities || '').toLowerCase());
        // NEW: stagger the fade-in-up animation slightly per card (capped so a
        // long list doesn't leave later cards waiting too long to appear).
        card.style.animationDelay = `${Math.min(idx, 10) * 0.05}s`;
        
        card.onclick = () => showFullDetails(item);

        // UI SECURITY: Hide save button for landlords
        const saveButtonHTML = currentUser.role === 'tenant' ? `
            <div class="save-btn ${isSaved ? 'active' : ''}" onclick="toggleBookmark(event, ${item.id})">
                <i class="fas fa-heart"></i>
            </div>
        ` : "";

        card.innerHTML = `
            ${saveButtonHTML}
            <div class="category-badge">${item.category || 'Apartment'}</div>
            ${statusBadgeHTML}
            ${carouselHTML}
            <div class="listing-info">
                <div class="price-row">
                    <span class="price">₱${Number(item.price || 0).toLocaleString()}</span><span class="price-suffix">&nbsp;/mo</span>
                </div>
                <div class="title-text">${item.title || 'Cozy Room'}</div>
                <div class="landlord-name">
                    <i class="fas fa-user-tie"></i> ${item.landlord_name || 'Owner'}
                </div>
                <div class="location"><i class="fas fa-map-marker-alt"></i> ${item.location || 'Unknown'}</div>
                <div class="details">
                    <span><i class="fas fa-bed"></i> ${item.rooms || 0} Rooms</span>
                    <span><i class="fas fa-expand"></i> ${item.size || 0} sqm</span>
                </div>
            </div>
        `;
        listingsGrid.appendChild(card);
    });
}

// --- 4. SHOW FULL DETAILS POPUP ---
function showFullDetails(item) {
    const detailModal = document.getElementById('detailsModal');
    if (!detailModal) return;

    document.getElementById('detTitle').innerText = item.title;
    document.getElementById('detPrice').innerText = Number(item.price).toLocaleString();
    document.getElementById('detLocation').innerText = item.location;
    document.getElementById('detRooms').innerText = item.rooms;
    document.getElementById('detSize').innerText = item.size;
    document.getElementById('detAmenities').innerText = item.amenities || "None listed";
    document.getElementById('detLandlord').innerText = item.landlord_name || "N/A";
    document.getElementById('detContact').innerText = item.landlord_contact || "No contact provided";
    document.getElementById('detType').innerText = item.category || "Apartment";

    // NEW / FIX: render the photo carousel inside the details modal.
    // #carouselWrapper already existed in home.html but nothing was ever
    // writing into it, so no photos ever showed up here before. We use a
    // distinct 'modal-<id>' key so this carousel never shares a DOM id with
    // the same listing's carousel on the grid card behind it.
    const carouselWrapperEl = document.getElementById('carouselWrapper');
    if (carouselWrapperEl) {
        carouselWrapperEl.innerHTML = buildCarouselHTML(item.images, `modal-${item.id}`);
    }

    // SECURITY: strictly check if the user is a Landlord AND the owner of this item
    const isOwner = currentUser && currentUser.role === 'landlord' && item.user_id && String(currentUser.id) === String(item.user_id);

    const ratingArea = document.getElementById('ratingInputArea');
    if (ratingArea) {
        ratingArea.style.display = isOwner ? 'none' : 'block';
    }

    selectedRating = 0;
    resetStars();
    document.getElementById('commentText').value = "";

    loadComments(item.id);

    const postCommentBtn = document.getElementById('postCommentBtn');
    postCommentBtn.onclick = () => submitComment(item.id, isOwner);

    const delContainer = document.getElementById('deleteBtnContainer');
    if (delContainer) {
        // UI SECURITY: Only show buttons if isOwner is true
        delContainer.innerHTML = isOwner 
            ? `<button class="btn-edit" id="editListingBtn" style="background:#007bff; color:white; padding:8px 15px; border:none; border-radius:5px; cursor:pointer; margin-right:10px;">
                    <i class="fas fa-edit"></i> Edit Listing
               </button>
               <button class="btn-delete" onclick="deleteListing(${item.id})">Delete Listing</button>` 
            : "";
        
        if (isOwner) {
            document.getElementById('editListingBtn').onclick = () => openEditModal(item);
        }
    }

    detailModal.style.display = 'block';
}

// (The rest of your functions: openEditModal, setupStarRatingLogic, etc. remain unchanged below)
function openEditModal(item) {
    const postModal = document.getElementById('postModal');
    if (!postModal) return;

    postModal.style.display = 'block';
    const modalHeader = postModal.querySelector('h2') || document.querySelector('#postModal h3');
    if(modalHeader) modalHeader.innerText = "Edit Your Listing";
    
    const submitBtn = document.getElementById('submitPostBtn');
    submitBtn.innerText = "Save Changes";

    document.getElementById('postTitle').value = item.title;
    document.getElementById('postPrice').value = item.price;
    document.getElementById('postLocation').value = item.location;
    document.getElementById('postRooms').value = item.rooms;
    document.getElementById('postSize').value = item.size;
    if(document.getElementById('postAmenities')) document.getElementById('postAmenities').value = item.amenities || "";
    if(document.getElementById('postCategory')) document.getElementById('postCategory').value = item.category || "Apartment";
    // NEW: pre-fill the Availability dropdown with this listing's current status
    if(document.getElementById('postStatus')) document.getElementById('postStatus').value = (item.status === 'occupied') ? 'occupied' : 'available';

    // NEW: reset the file input and preview the listing's existing photos so
    // the landlord can see what's currently posted, and so any leftover file
    // selection/preview from a previous "Post a Listing" session doesn't leak
    // into Edit mode.
    const imageInputEl = document.getElementById('postImages');
    const previewDivEl = document.getElementById('imagePreview');
    // NEW: optional label text swap - only activates if you've added
    // id="postImagesLabel" to the <label> above the photo input in
    // home.html. Safe no-op if that id isn't present.
    const imagesLabelEl = document.getElementById('postImagesLabel');
    if (imagesLabelEl) imagesLabelEl.innerText = "Current Photos (choose new files only if you want to replace them)";
    // NEW: clear any pending multi-photo selection left over from a previous
    // "Post a Listing" or Edit session before showing this listing's current
    // photos - keeps the accumulating-selection behavior (see
    // renderSelectedFilePreviews / imageInput.onchange in
    // setupPostListingLogic) from mixing sessions together.
    selectedListingFiles = [];
    if (imageInputEl) imageInputEl.value = "";
    if (previewDivEl) {
        previewDivEl.innerHTML = "";
        let existingImgs = [];
        if (item.images && item.images.trim() !== "") {
            existingImgs = item.images.split('|||').map(img => img.trim()).filter(img => img !== "");
        }
        if (existingImgs.length > 0) {
            previewDivEl.innerHTML =
                `<p style="width:100%; font-size:11px; color:#777; margin:0 0 5px 0;">Current photos (choose new photos below to replace all of them):</p>` +
                existingImgs.map(img =>
                    `<img src="${img}" style="width:60px; height:60px; object-fit:cover; border-radius:5px; border:1px solid #ddd;" onerror="this.src='https://via.placeholder.com/60?text=No+Img'">`
                ).join('');
        }
    }

    // NEW: capture a snapshot of the form so we can warn about unsaved changes later
    originalFormSnapshot = getCurrentFormSnapshot();

    submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        submitBtn.innerText = "Saving...";

        // FIX: this used to never read the image input at all, so uploading a
        // new photo while editing had zero effect - nothing was ever sent to
        // the server. Now we compress any newly selected files and include
        // them in the update, exactly like New Listing does.
        let newImages = [];
        // UPDATED: use the accumulated selectedListingFiles array instead of
        // imageInputEl.files directly, so picking replacement photos across
        // multiple "Choose files" clicks accumulates instead of only keeping
        // the last click's picks.
        if (selectedListingFiles.length > 0) {
            try {
                newImages = await Promise.all(selectedListingFiles.map(file => compressImageFile(file)));
                // NEW: warn (non-blocking) if the newly selected photos are large
                // enough to risk hitting a DB/server payload limit.
                warnIfImagesTooLarge(newImages);
            } catch (e) {
                console.error("Image conversion error (edit):", e);
            }
        }

        const updatedData = {
            listingId: item.id,
            user_id: currentUser.id,
            title: document.getElementById('postTitle').value.trim(),
            category: document.getElementById('postCategory')?.value || "Apartment",
            price: parseFloat(document.getElementById('postPrice').value) || 0,
            location: document.getElementById('postLocation').value.trim(),
            rooms: parseInt(document.getElementById('postRooms').value) || 0,
            size: parseFloat(document.getElementById('postSize').value) || 0,
            amenities: document.getElementById('postAmenities')?.value || "",
            // NEW: send the chosen Availability status along with the rest of the update
            status: document.getElementById('postStatus')?.value || 'available',
            // FIX: only overwrite photos when the landlord actually picked new
            // ones - otherwise send null so the backend's COALESCE(...) in
            // server.js keeps the existing photos untouched.
            images: newImages.length > 0 ? newImages.join('|||') : null,
            thumbnail: newImages.length > 0 ? newImages[0] : null
        };

        try {
            const response = await fetch(`${API_BASE}/update-listing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });

            if (response.ok) {
                clearUnsavedFlag(); // NEW: prevent the unsaved-changes warning from firing during reload
                Swal.fire({ title: 'Updated!', text: 'Your listing has been updated.', icon: 'success' }).then(() => location.reload());
            } else {
                // FIX: this branch used to show a hardcoded generic message and
                // never looked at the response body, so the real reason a
                // multi-photo edit failed (e.g. a DB "Data too long for column"
                // error) was completely invisible. Now we surface it.
                const errResult = await response.json().catch(() => ({ message: "Failed to update listing." }));
                Swal.fire('Error', errResult.message || errResult.error || 'Failed to update listing.', 'error');
            }
        } catch (err) {
            Swal.fire('Error', 'Server connection error.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = "Save Changes";
        }
    };
}

function setupStarRatingLogic() {
    const stars = document.querySelectorAll('#starContainer i');
    stars.forEach(star => {
        star.onclick = (e) => {
            selectedRating = parseInt(e.target.getAttribute('data-value'));
            updateStarDisplay(selectedRating);
        };
    });
}

function updateStarDisplay(val) {
    const stars = document.querySelectorAll('#starContainer i');
    stars.forEach(s => {
        if (parseInt(s.getAttribute('data-value')) <= val) {
            s.classList.add('active');
        } else {
            s.classList.remove('active');
        }
    });
}

function resetStars() {
    const stars = document.querySelectorAll('#starContainer i');
    stars.forEach(s => s.classList.remove('active'));
}

async function loadComments(listingId) {
    const list = document.getElementById('commentsDisplayList');
    const revCountBadge = document.getElementById('revCount'); 
    
    list.innerHTML = "<p style='font-size:12px; color:gray;'>Loading reviews...</p>";

    try {
        const res = await fetch(`${API_BASE}/get-reviews/${listingId}`);
        const reviews = await res.json();
        
        if (revCountBadge) {
            revCountBadge.innerText = reviews.length;
        }
        
        list.innerHTML = reviews.length ? "" : "<p style='color:gray; font-size:12px;'>No reviews yet.</p>";
        
        reviews.forEach(rev => {
            const starIcons = rev.rating ? `<span style="color:#ffc107; margin-left:5px;">${'★'.repeat(rev.rating)}${'☆'.repeat(5-rev.rating)}</span>` : "";
            list.innerHTML += `
                <div class="comment-item">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong style="font-size:13px;">${rev.user_name}</strong>
                        ${starIcons}
                    </div>
                    <p style="margin: 5px 0 0 0; font-size:13px; color:#555;">${rev.comment}</p>
                </div>
            `;
        });
    } catch (err) {
        list.innerHTML = "<p style='color:red;'>Error loading reviews.</p>";
        if (revCountBadge) revCountBadge.innerText = "0";
    }
}

async function submitComment(listingId, isOwner) {
    const commentText = document.getElementById('commentText').value.trim();
    
    if (!currentUser || !currentUser.id) {
        Swal.fire({ title: 'Session Error', text: 'User ID not found.', icon: 'error', target: '#detailsModal' });
        return;
    }

    if (!commentText && selectedRating === 0) {
        Swal.fire({ title: 'Empty', text: 'Please add a rating or a comment.', icon: 'warning', target: '#detailsModal' });
        return;
    }

    const reviewData = {
        listing_id: listingId,
        user_id: currentUser.id,
        user_name: currentUser.full_name || currentUser.name || "User",
        comment: commentText,
        rating: isOwner ? null : selectedRating 
    };

    try {
        const response = await fetch(`${API_BASE}/add-review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reviewData)
        });

        if (response.ok) {
            document.getElementById('commentText').value = "";
            selectedRating = 0;
            resetStars();
            loadComments(listingId);
        } else {
            const errData = await response.json();
            Swal.fire({ title: 'Error', text: errData.message || 'Failed to post review.', icon: 'error', target: '#detailsModal' });
        }
    } catch (err) {
        Swal.fire({ title: 'Error', text: 'Server connection failed.', icon: 'error', target: '#detailsModal' });
    }
}

async function deleteListing(listingId) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: "This listing will be permanently removed.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff5252',
        cancelButtonColor: '#aaa',
        confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`${API_BASE}/delete-listing/${listingId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.id }) 
            });

            if (response.ok) {
                Swal.fire('Deleted!', 'Listing removed.', 'success').then(() => location.reload());
            } else {
                Swal.fire('Error', 'Unauthorized or failed to delete.', 'error');
            }
        } catch (err) {
            Swal.fire('Error', 'Could not connect to server.', 'error');
        }
    }
}

function moveCarousel(event, id, direction) {
    event.stopPropagation();
    const container = document.getElementById(`carousel-${id}`);
    const track = container.querySelector('.carousel-track');
    const images = track.querySelectorAll('img');
    const imgWidth = container.clientWidth; 
    
    let currentTransform = track.style.transform.replace('translateX(', '').replace('px)', '') || 0;
    let currentIdx = Math.abs(Math.round(parseInt(currentTransform) / imgWidth));
    
    let newIdx = currentIdx + direction;
    if (newIdx < 0) newIdx = images.length - 1;
    if (newIdx >= images.length) newIdx = 0;
    
    track.style.transform = `translateX(-${newIdx * imgWidth}px)`;

    // NEW: keep the dot indicator in sync with the visible slide
    const dots = container.querySelectorAll('.carousel-dots .dot');
    if (dots.length) {
        dots.forEach((d, i) => d.classList.toggle('active', i === newIdx));
    }
}

// --- 9. LOGOUT LOGIC ---
const logoutLink = document.getElementById('logoutLink');
if (logoutLink) {
    logoutLink.onclick = (e) => {
        e.preventDefault();
        localStorage.removeItem('user');
        localStorage.removeItem('bookmarks'); // Clean local bookmarks on logout
        window.location.href = "index.html";
    };
}

// --- 10. FILTERING & SEARCH ---
function filterListings() {
    const searchTerm = document.getElementById('searchLoc').value.toLowerCase();
    const maxPriceValue = document.getElementById('maxPrice').value;
    const maxPrice = maxPriceValue === "Infinity" ? Infinity : parseInt(maxPriceValue);
    
    const minRooms = document.getElementById('roomFilter').value;
    const locFilter = document.getElementById('locFilter').value.toLowerCase();

    const cards = document.querySelectorAll('.listing-card');

    cards.forEach(card => {
        const titleText = card.querySelector('.title-text').innerText.toLowerCase();
        const locationText = card.querySelector('.location').innerText.toLowerCase();
        // FIX: amenities are now stored on the card as data-amenities (see
        // renderListings above) so the search bar can actually match them -
        // previously this value didn't exist anywhere and "wifi"/"aircon"/etc.
        // searches always came up empty no matter what a listing had.
        const amenitiesText = card.getAttribute('data-amenities') || '';
        const price = parseInt(card.getAttribute('data-price'));
        const rooms = parseInt(card.getAttribute('data-rooms'));
        const cardStatus = card.getAttribute('data-status') || 'available';

        // UPDATED: matchesMainSearch now also checks amenitiesText.
        const matchesMainSearch = titleText.includes(searchTerm) || locationText.includes(searchTerm) || amenitiesText.includes(searchTerm);
        const matchesPrice = isNaN(maxPrice) || price <= maxPrice;
        const matchesRooms = minRooms === "all" || rooms >= parseInt(minRooms);
        const matchesSpecificLoc = locationText.includes(locFilter);
        // NEW: also respect whatever Available/Occupied filter is currently active
        const matchesAvailability = !currentAvailabilityFilter || cardStatus === currentAvailabilityFilter;

        card.style.display = (matchesMainSearch && matchesPrice && matchesRooms && matchesSpecificLoc && matchesAvailability) ? "block" : "none";
    });
}

function resetFilters() {
    document.getElementById('searchLoc').value = "";
    document.getElementById('maxPrice').value = "Infinity";
    document.getElementById('roomFilter').value = "all";
    document.getElementById('locFilter').value = "";
    clearAvailabilityFilterState(); // NEW: also clear the Available/Occupied toggle
    
    const viewAllBtn = document.getElementById('viewAllBtn');
    const viewSavedBtn = document.getElementById('viewSavedBtn');
    if(viewAllBtn) viewAllBtn.classList.add('nav-active');
    if(viewSavedBtn) viewSavedBtn.classList.remove('nav-active');
    
    loadListings();
}

if(document.getElementById('searchLoc')) document.getElementById('searchLoc').addEventListener('input', filterListings);
if(document.getElementById('maxPrice')) document.getElementById('maxPrice').addEventListener('change', filterListings);
if(document.getElementById('roomFilter')) document.getElementById('roomFilter').addEventListener('change', filterListings);
if(document.getElementById('locFilter')) document.getElementById('locFilter').addEventListener('input', filterListings);

// --- 11. PROFILE SETTINGS ---
// UPDATED: now also handles the 4th verification item (selfie with ID) and
// the landlord_doc_name field (name typed as printed on the ownership doc,
// used by the admin panel's name cross-check).
function setupSettingsLogic() {
    const settingsBtn = document.getElementById('settingsBtn');
    const modal = document.getElementById('settingsModal');
    const saveBtn = document.getElementById('saveSettingsBtn');
    // NEW: refs for the landlord document upload section
    const editRoleSelect = document.getElementById('editRole');
    const docsSection = document.getElementById('settingsLandlordDocsSection');

    if (!settingsBtn || !modal) return;

    // NEW: toggle the document section based on the currently selected role
    // in the dropdown. Skips showing it if the user is already an approved
    // landlord (no need to re-upload documents every time).
    function toggleDocsSection() {
        if (!docsSection || !editRoleSelect) return;
        const alreadyApproved = currentUser.landlord_status === 'approved';
        if (editRoleSelect.value === 'landlord' && !alreadyApproved) {
            docsSection.style.display = 'block';
        } else {
            docsSection.style.display = 'none';
        }
    }

    if (editRoleSelect) {
        editRoleSelect.addEventListener('change', toggleDocsSection);
    }

    settingsBtn.onclick = () => {
        document.getElementById('editName').value = currentUser.full_name || currentUser.name || "";
        document.getElementById('editAddress').value = currentUser.address || "";
        document.getElementById('editContact').value = currentUser.contact || "";
        document.getElementById('editRole').value = currentUser.role || "tenant";
        // NEW: reset file/text inputs and re-evaluate whether the doc
        // section should show, every time the modal is opened
        if (document.getElementById('settingsDocOwnership')) document.getElementById('settingsDocOwnership').value = "";
        if (document.getElementById('settingsDocPermits')) document.getElementById('settingsDocPermits').value = "";
        if (document.getElementById('settingsDocBir')) document.getElementById('settingsDocBir').value = "";
        if (document.getElementById('settingsDocSelfie')) document.getElementById('settingsDocSelfie').value = ""; // NEW
        if (document.getElementById('settingsDocOwnerName')) document.getElementById('settingsDocOwnerName').value = ""; // NEW
        toggleDocsSection();
        modal.style.display = 'block';
    };

    saveBtn.onclick = async () => {
        const chosenRole = document.getElementById('editRole').value;
        const alreadyApproved = currentUser.landlord_status === 'approved';
        const isNewLandlordRequest = (chosenRole === 'landlord' && !alreadyApproved);

        // UPDATED: require all 4 verification items + owner name when
        // submitting a fresh landlord request
        let docOwnershipFile = null, docPermitsFile = null, docBirFile = null, docSelfieFile = null;
        let docOwnerName = "";
        if (isNewLandlordRequest) {
            docOwnershipFile = document.getElementById('settingsDocOwnership').files[0];
            docPermitsFile = document.getElementById('settingsDocPermits').files[0];
            docBirFile = document.getElementById('settingsDocBir').files[0];
            docSelfieFile = document.getElementById('settingsDocSelfie').files[0]; // NEW
            docOwnerName = document.getElementById('settingsDocOwnerName').value.trim(); // NEW

            if (!docOwnershipFile || !docPermitsFile || !docBirFile || !docSelfieFile) {
                return Swal.fire({ title: 'Missing Documents', text: 'Please upload all 4 required items: Proof of Ownership, Local Permits, BIR Registration, and a Selfie with valid ID.', icon: 'warning', target: '#settingsModal' });
            }
            if (!docOwnerName) {
                return Swal.fire({ title: 'Missing Info', text: 'Please type the name shown on your Proof of Ownership document.', icon: 'warning', target: '#settingsModal' });
            }
        }

        saveBtn.disabled = true;
        saveBtn.innerText = "Updating...";

        // UPDATED: compress and attach all 4 landlord documents (if
        // applicable), reusing the shared compressImageFile() helper defined
        // near the top of this file. Order must match the labels array used
        // by admin.js's viewLandlordDocs(): Ownership, Permits, BIR, Selfie.
        let landlordDocuments = null;
        if (isNewLandlordRequest) {
            try {
                saveBtn.innerText = "Uploading documents...";
                const compressed = await Promise.all([
                    compressImageFile(docOwnershipFile),
                    compressImageFile(docPermitsFile),
                    compressImageFile(docBirFile),
                    compressImageFile(docSelfieFile) // NEW
                ]);
                landlordDocuments = compressed.join('|||');
            } catch (e) {
                console.error("Document conversion error:", e);
                saveBtn.disabled = false;
                saveBtn.innerText = "Save Changes";
                return Swal.fire({ title: 'Error', text: 'Failed to process your documents. Please try again.', icon: 'error', target: '#settingsModal' });
            }
        }

        const updatedData = {
            full_name: document.getElementById('editName').value.trim(),
            address: document.getElementById('editAddress').value.trim(),
            contact: document.getElementById('editContact').value.trim(),
            role: chosenRole,
            email: currentUser.email,
            // NEW: only populated when submitting a fresh landlord request
            landlord_documents: landlordDocuments,
            // NEW: the applicant's self-typed "name on document", used by the
            // admin panel's name cross-check against the registered full_name
            landlord_doc_name: isNewLandlordRequest ? docOwnerName : null
        };

        saveBtn.innerText = "Updating...";

        try {
            const response = await fetch(`${API_BASE}/update-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });

            const result = await response.json();

            if (response.ok && (result.success || result.status === 'success')) {
                // NEW: trust the server's real role/landlord_status, same as dashboard.js
                const newUserObj = { ...currentUser, ...updatedData, role: result.role || updatedData.role, landlord_status: result.landlord_status };
                delete newUserObj.landlord_documents; // don't keep base64 blobs in localStorage
                delete newUserObj.landlord_doc_name; // NEW: no need to keep this locally either
                localStorage.setItem('user', JSON.stringify(newUserObj));

                Swal.fire({
                    title: result.landlord_status === 'pending' ? 'Request Submitted' : 'Success!',
                    text: result.message || 'Profile updated successfully.',
                    icon: 'success',
                    target: '#settingsModal'
                }).then(() => location.reload());
            } else {
                Swal.fire({ title: 'Notice', text: result.message || 'Failed to update profile', icon: 'info', target: '#settingsModal' });
            }
        } catch (err) {
            Swal.fire({ title: 'Error', text: 'Server error', icon: 'error', target: '#settingsModal' });
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
        }
    };
}

// --- 12. POST NEW LISTING ---
function setupPostListingLogic() {
    const postModal = document.getElementById('postModal');
    const postBtn = document.getElementById('postBtn');
    const postFab = document.getElementById('postFab'); // NEW: floating mobile shortcut, mirrors postBtn
    const submitPostBtn = document.getElementById('submitPostBtn');
    const imageInput = document.getElementById('postImages');
    const previewDiv = document.getElementById('imagePreview');

    if (!postBtn || !postModal) return;

    if (imageInput) {
        // UPDATED: this used to read imageInput.files directly and REPLACE the
        // whole preview every time it fired - which meant picking photos in
        // more than one "Choose files" click threw away the earlier picks
        // (browsers replace the input's FileList on every open, they never
        // merge). Now every newly chosen batch is APPENDED to the persistent
        // selectedListingFiles array (declared near the top of this file),
        // the input is cleared so it's ready for the next pick, and the whole
        // preview strip (with per-photo remove buttons) is re-rendered from
        // that array - so choosing photo 1, then photo 2, then photo 3 in
        // separate clicks now correctly keeps all three.
        imageInput.onchange = () => {
            const newFiles = Array.from(imageInput.files);
            if (newFiles.length === 0) return;
            selectedListingFiles = selectedListingFiles.concat(newFiles);
            imageInput.value = ""; // reset so re-picking the same file still fires onchange
            renderSelectedFilePreviews();
        };
    }

    function openPostModalForNewListing(e) {
        if (e) e.preventDefault();
        const modalHeader = postModal.querySelector('h2') || document.querySelector('#postModal h3');
        if(modalHeader) modalHeader.innerText = "Post a Listing";
        submitPostBtn.innerText = "Publish Listing";
        
        document.getElementById('postTitle').value = "";
        document.getElementById('postPrice').value = "";
        document.getElementById('postLocation').value = "";
        document.getElementById('postRooms').value = "";
        document.getElementById('postSize').value = "";
        if(document.getElementById('postAmenities')) document.getElementById('postAmenities').value = "";
        // NEW: new listings always start as "Available"
        if(document.getElementById('postStatus')) document.getElementById('postStatus').value = "available";
        // NEW: clear the persistent multi-photo selection whenever a fresh
        // "Post a Listing" session starts, so nothing carries over from a
        // previous attempt or from Edit mode.
        selectedListingFiles = [];
        if(previewDiv) previewDiv.innerHTML = "";
        if(imageInput) imageInput.value = "";
        // NEW: reset the photo label back to normal (openEditModal changes its
        // wording) - safe no-op if you haven't added id="postImagesLabel" yet.
        const imagesLabelEl = document.getElementById('postImagesLabel');
        if (imagesLabelEl) imagesLabelEl.innerText = "Listing Photos (Select Multiple)";

        submitPostBtn.onclick = addNewListingAction; 
        postModal.style.display = 'block';
        originalFormSnapshot = getCurrentFormSnapshot(); // NEW: snapshot for unsaved-changes tracking
    }

    postBtn.onclick = openPostModalForNewListing;
    // NEW: the mobile floating "+" button opens the exact same flow
    if (postFab) postFab.onclick = openPostModalForNewListing;

    // UPDATED: now calls the shared compressImageFile() helper defined near
    // the top of this file (instead of a local copy that only existed inside
    // this function), so New Listing and Edit Listing both compress photos
    // exactly the same way.
    async function addNewListingAction() {
        // UPDATED: use the accumulated selectedListingFiles array (built up
        // across possibly multiple "Choose files" clicks) instead of
        // imageInput.files, which only ever reflects the most recent single
        // picker interaction.
        const imageFiles = selectedListingFiles;
        submitPostBtn.disabled = true;
        submitPostBtn.innerText = "Processing...";

        let base64Images = [];
        try {
            base64Images = await Promise.all(imageFiles.map(file => compressImageFile(file)));
            // NEW: warn (non-blocking) if the selected photos are large enough
            // to risk hitting a DB/server payload limit once combined.
            warnIfImagesTooLarge(base64Images);
        } catch (e) {
            console.error("Image conversion error", e);
        }

        const listingData = {
            user_id: currentUser.id,
            title: document.getElementById('postTitle').value.trim(),
            category: document.getElementById('postCategory')?.value || "Apartment",
            price: parseFloat(document.getElementById('postPrice').value) || 0,
            location: document.getElementById('postLocation').value.trim(),
            rooms: parseInt(document.getElementById('postRooms').value) || 0,
            size: parseFloat(document.getElementById('postSize').value) || 0,
            amenities: document.getElementById('postAmenities')?.value || "",
            // NEW: send the chosen Availability status ('available' by default)
            status: document.getElementById('postStatus')?.value || 'available',
            // FIX: join with '|||' instead of ',' so multi-image uploads don't get
            // corrupted when split back apart in renderListings().
            images: base64Images.join('|||'), 
            thumbnail: base64Images.length > 0 ? base64Images[0] : "" 
        };

        if (!listingData.title || !listingData.price || !listingData.location) {
            Swal.fire({ title: 'Missing Info', text: 'Title, Price, and Location are required', icon: 'warning', target: '#postModal' });
            submitPostBtn.disabled = false;
            submitPostBtn.innerText = "Publish Listing";
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/add-listing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(listingData)
            });

            if (response.ok) {
                clearUnsavedFlag(); // NEW: prevent the unsaved-changes warning from firing during reload
                Swal.fire({ title: 'Success!', text: 'Listing published.', icon: 'success', target: '#postModal' }).then(() => location.reload());
            } else {
                const errResult = await response.json().catch(() => ({ message: "Submission Failed" }));
                // FIX: the backend's addListing controller sends the failure
                // reason as `error`, not `message`, so this was always falling
                // through to the generic "Failed to post" text and hiding the
                // real DB error (e.g. "Data too long for column 'images'" when
                // multiple photos are uploaded and the column is still TEXT).
                Swal.fire({ title: 'Error', text: errResult.message || errResult.error || 'Failed to post', icon: 'error', target: '#postModal' });
            }
        } catch (err) {
            Swal.fire({ title: 'Error', text: 'Could not connect to server', icon: 'error', target: '#postModal' });
        } finally {
            submitPostBtn.disabled = false;
            submitPostBtn.innerText = "Publish Listing";
        }
    }

    submitPostBtn.onclick = addNewListingAction;
}

// --- 13. UPDATED: PERSISTENT BOOKMARK SYSTEM ---
async function toggleBookmark(event, listingId) {
    event.stopPropagation();
    let saved = JSON.parse(localStorage.getItem('bookmarks')) || [];
    const iconWrapper = event.currentTarget;
    const isAdding = !saved.includes(listingId);

    if (isAdding) {
        saved.push(listingId);
        iconWrapper.classList.add('active');
    } else {
        saved = saved.filter(id => id !== listingId);
        iconWrapper.classList.remove('active');
    }
    localStorage.setItem('bookmarks', JSON.stringify(saved));

    if (currentUser && currentUser.id) {
        try {
            await fetch(`${API_BASE}/toggle-bookmark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    userId: currentUser.id, 
                    listingId: listingId,
                    action: isAdding ? 'add' : 'remove'
                })
            });
            
            const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
            if (isAdding) {
                Toast.fire({ icon: 'success', title: 'Saved to bookmarks' });
            } else {
                // NEW: "unsave" notification
                Toast.fire({ icon: 'info', title: 'Removed from bookmarks' });
            }
        } catch (err) { 
            console.error("Bookmark sync error:", err); 
        }
    }
}

function setupBookmarkToggles() {
    const viewAllBtn = document.getElementById('viewAllBtn');
    const viewSavedBtn = document.getElementById('viewSavedBtn');

    if (!viewAllBtn || !viewSavedBtn) return;

    viewSavedBtn.onclick = () => {
        clearAvailabilityFilterState(); // NEW: keep the Available/Occupied toggle from conflicting with Saved view
        const savedIds = JSON.parse(localStorage.getItem('bookmarks')) || [];
        const allCards = document.querySelectorAll('.listing-card');
        
        viewSavedBtn.classList.add('nav-active');
        viewAllBtn.classList.remove('nav-active');

        let found = 0;
        allCards.forEach(card => {
            const id = parseInt(card.getAttribute('data-id'));
            if (savedIds.includes(id)) {
                card.style.display = "block";
                found++;
            } else {
                card.style.display = "none";
            }
        });
        
        if (found === 0) {
            const msgText = (currentUser.role === 'landlord') 
                ? "You haven't saved any of your own listings yet." 
                : "You haven't saved any listings yet.";
            listingsGrid.innerHTML = `<div id="no-saved-msg">${emptyStateHTML('fa-heart-crack', 'Nothing saved yet', msgText)}</div>`;
        }
    };

    viewAllBtn.onclick = () => {
        clearAvailabilityFilterState(); // NEW
        viewAllBtn.classList.add('nav-active');
        viewSavedBtn.classList.remove('nav-active');
        const msg = document.getElementById('no-saved-msg');
        if(msg) msg.remove();
        loadListings(); 
    };
}

// --- 14. MODAL & CLOSING UTILITIES ---
window.onclick = (event) => {
    if (event.target.classList.contains('modal')) {
        // NEW: If the click is on the postModal's dark background, run the
        // unsaved-changes check first instead of closing it immediately.
        if (event.target.id === 'postModal') {
            closePostModalSafely();
        } else {
            event.target.style.display = "none";
        }
    }
};

function closeDetails() {
    const modal = document.getElementById('detailsModal');
    if (modal) modal.style.display = 'none';
}

// --- 15. UNSAVED CHANGES PROTECTION (NEW) ---

// Snapshot of the Post/Edit Listing form's text fields, taken right after the modal opens.
// Used to detect if the user changed anything before trying to close the modal.
function getCurrentFormSnapshot() {
    return JSON.stringify({
        title: document.getElementById('postTitle')?.value || "",
        category: document.getElementById('postCategory')?.value || "",
        price: document.getElementById('postPrice')?.value || "",
        location: document.getElementById('postLocation')?.value || "",
        rooms: document.getElementById('postRooms')?.value || "",
        size: document.getElementById('postSize')?.value || "",
        amenities: document.getElementById('postAmenities')?.value || "",
        status: document.getElementById('postStatus')?.value || "" // NEW: track availability changes too
    });
}

// Returns true if any field changed OR the user selected new/pending photos since the modal opened.
function isPostFormDirty() {
    if (originalFormSnapshot === null) return false; // modal isn't currently being tracked
    const currentSnapshot = getCurrentFormSnapshot();
    const fieldsChanged = currentSnapshot !== originalFormSnapshot;
    // NEW: also counts as dirty if photos are pending in the shared
    // selectedListingFiles array (this file's actual source of truth for
    // pending uploads, since the <input> itself gets cleared after every pick).
    const newPhotosSelected = selectedListingFiles.length > 0;
    return fieldsChanged || newPhotosSelected;
}

// Call this right after a successful publish/update so no stale warning fires during reload.
function clearUnsavedFlag() {
    originalFormSnapshot = null;
}

// Safely closes the Post/Edit Listing modal - warns the user first if they have unsaved changes.
function closePostModalSafely() {
    if (isPostFormDirty()) {
        Swal.fire({
            title: 'Unsaved Changes',
            text: 'You have unsaved changes. Are you sure you want to discard them?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Discard Changes',
            cancelButtonText: 'Keep Editing',
            confirmButtonColor: '#ff5252',
            target: '#postModal'
        }).then((result) => {
            if (result.isConfirmed) {
                clearUnsavedFlag();
                document.getElementById('postModal').style.display = 'none';
            }
        });
    } else {
        clearUnsavedFlag();
        document.getElementById('postModal').style.display = 'none';
    }
}

// Warn on browser tab close / refresh / navigation while the Post/Edit Listing modal is open and dirty.
window.addEventListener('beforeunload', function (e) {
    const postModal = document.getElementById('postModal');
    if (postModal && postModal.style.display === 'block' && isPostFormDirty()) {
        e.preventDefault();
        e.returnValue = ''; // required for browsers to show the native confirmation prompt
        return '';
    }
});
