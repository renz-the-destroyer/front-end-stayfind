// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app-system.onrender.com/api";

const currentUser = JSON.parse(localStorage.getItem('user'));
const listingsGrid = document.getElementById('listingsGrid');

// Global variable to track selected stars
let selectedRating = 0;

// NEW: Tracks which Available/Occupied filter is currently active, so it
// can be cleared cleanly when switching to Browse/Saved and vice versa.
let currentAvailabilityFilter = null; // 'available' | 'occupied' | null

// NEW: Tracks which category pill (Apartment/House/Condo/Bedspace) is
// currently active. "" means "All" - no category restriction.
let currentCategoryFilter = "";

// NEW: Cache of whatever listings dataset is currently loaded/visible.
// Powers the search bar's autocomplete suggestions without needing an
// extra network request - it's refreshed every time loadListings() or a
// Smart Search finishes, so suggestions always reflect what's on screen.
let allListingsCache = [];

// NEW: Which suggestion row is currently keyboard-highlighted in the
// search bar's autocomplete dropdown (-1 = none highlighted).
let suggestionHighlightIndex = -1;

// NEW: whatever array is currently being shown in the grid (before any
// client-side sorting), refreshed by loadListings()/runSmartSearch().
// Powers the Sort dropdown - sorting works on a fresh copy of this each
// time, so switching back to "Newest" always restores the original order.
let currentDisplayedItems = [];
let currentSortOption = 'newest';

// NEW: pagination state for the Browse view. /api/view now returns listings
// one page at a time (see getAllListings in userController.js), so home.js
// tracks which page it's on, whether the server says more exist, and
// whether a "Load More" fetch is already in flight (to block double-clicks).
const LISTINGS_PAGE_SIZE = 12;
let currentPage = 1;
let hasMorePages = false;
let totalListingsCount = 0;
let isLoadingMorePages = false;

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
        if (heroSubtitle) heroSubtitle.innerText = "Discover verified stays across Candelaria.";
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
    setupLoadMoreButton(); // NEW: pagination control under the grid
    loadListings();
    setupSettingsLogic(); 
    setupPostListingLogic(); 
    setupBookmarkToggles(); 
    setupStarRatingLogic(); // Initialize star click listeners
    setupSideDrawer(); // NEW: hamburger-triggered side navigation
    setupFiltersToggle(); // NEW: collapsible filter panel on mobile
    setupAvailabilityFilterButtons(); // NEW: Available Property / Occupied Property buttons
    setupCategoryPills(); // NEW: one-tap Apartment/House/Condo/Bedspace quick filters
    setupSearchBarEnhancements(); // NEW: autocomplete, recent searches, clear button, live count
    setupStickySearchBar(); // NEW: compact search bar that slides in once you scroll past the real one
    setupFooter(); // NEW: footer year + Settings link

    // NEW: check for a landlord approval/rejection outcome to notify the user about
    checkLandlordStatusUpdate();
};

// --- NEW: SIDE DRAWER NAVIGATION ---
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

    drawer.querySelectorAll('a').forEach(link => link.addEventListener('click', closeDrawer));

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

// --- UPDATED: AVAILABLE / OCCUPIED PILLS (Any Status / Available / Occupied) ---
function setupAvailabilityFilterButtons() {
    const pillsContainer = document.getElementById('availabilityPills');
    if (!pillsContainer) return;

    pillsContainer.querySelectorAll('.availability-pill').forEach(pill => {
        pill.onclick = () => {
            pillsContainer.querySelectorAll('.availability-pill').forEach(p => p.classList.remove('availability-active'));
            pill.classList.add('availability-active');
            currentAvailabilityFilter = pill.getAttribute('data-availability') || null;
            const noStatusMsg = document.getElementById('no-status-msg');
            if (noStatusMsg) noStatusMsg.remove();
            filterListings();
        };
    });
}

function clearAvailabilityFilterState() {
    currentAvailabilityFilter = null;
    const pillsContainer = document.getElementById('availabilityPills');
    if (pillsContainer) {
        pillsContainer.querySelectorAll('.availability-pill').forEach(p => p.classList.remove('availability-active'));
        const anyPill = document.getElementById('anyStatusBtn');
        if (anyPill) anyPill.classList.add('availability-active');
    }
    const noStatusMsg = document.getElementById('no-status-msg');
    if (noStatusMsg) noStatusMsg.remove();
}

// LEGACY: no longer wired up (setupAvailabilityFilterButtons() above now
// handles clicks directly through filterListings() instead). Left in place
// rather than deleted, per project convention.
function applyAvailabilityFilter(status, clickedBtn, otherBtn) {
    const cards = document.querySelectorAll('.listing-card');
    const isReapplyingSame = currentAvailabilityFilter === status;

    const savedMsg = document.getElementById('no-saved-msg');
    if (savedMsg) savedMsg.remove();
    const noStatusMsg = document.getElementById('no-status-msg');
    if (noStatusMsg) noStatusMsg.remove();
    const viewAllBtn = document.getElementById('viewAllBtn');
    const viewSavedBtn = document.getElementById('viewSavedBtn');
    if (viewSavedBtn) viewSavedBtn.classList.remove('nav-active');

    if (isReapplyingSame) {
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
function injectSmartSearchUI() {
    // The launcher's own CSS (needs a real stylesheet for the hover state and
    // the pulsing ring - inline style attributes can't do either).
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
            @media (max-width: 480px) {
                .ss-launcher-label { display: none; }
                .ss-launcher { padding: 14px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .ss-launcher-pulse { animation: none; }
            }
        `;
        document.head.appendChild(styleTag);
    }

    const btn = document.createElement('button');
    btn.id = "smartSearchBtn";
    btn.className = "ss-launcher";
    btn.setAttribute('aria-label', 'How to use Smart Search');
    btn.innerHTML = `
        <span class="ss-launcher-pulse"></span>
        <i class="fas fa-wand-magic-sparkles"></i>
        <span class="ss-launcher-label">Smart Search</span>
    `;
    document.body.appendChild(btn);

    // The old floating panel (input, suggestion chips, "Find Stays" button)
    // is gone. Tapping the launcher now just explains how Smart Search
    // works; the actual searching happens in the main search bar.
    btn.onclick = showSmartSearchTips;
}

// NEW: the how-to popup shown when the Smart Search button is tapped.
function showSmartSearchTips() {
    const examples = [
        'bahay malapit sa UP',
        'apartment na may wifi',
        'room under 5000',
        '5k pababa na bedspace',
        'cheapest condo',
        '3 bedrooms with parking'
    ];

    Swal.fire({
        title: 'Smart Search',
        html: `
            <div style="text-align:left; font-size:14px; color:#475569; line-height:1.6;">
                <p style="margin:0 0 14px;">Search the way you'd normally talk, in English or Tagalog. Type a sentence in the <strong>search bar</strong> and press <strong>Enter</strong>.</p>
                <div style="background:#f4f8fd; border:1px solid #e3f2fd; border-radius:12px; padding:12px 14px;">
                    <div style="font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#0d47a1; margin-bottom:8px;">Try typing</div>
                    ${examples.map(e => `<div style="padding:4px 0; font-weight:600; color:#1a2332;">&ldquo;${e}&rdquo;</div>`).join('')}
                </div>
                <p style="margin:12px 0 0; font-size:12.5px; color:#90a4ae;">It understands property types, prices, room counts, amenities and words like &ldquo;cheapest&rdquo; or &ldquo;malapit sa&rdquo;.</p>
            </div>
        `,
        confirmButtonText: 'Got it, let me try',
        confirmButtonColor: '#0d47a1'
    }).then((result) => {
        if (result.isConfirmed) focusMainSearchBar();
    });
}

// Scrolls back up to the main search bar and puts the cursor in it.
function focusMainSearchBar() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
        const input = document.getElementById('searchLoc');
        if (input) input.focus({ preventScroll: true });
    }, 350);
}

// --- UPDATED: SMART SEARCH LOGIC (API Connected) ---
// Only tenants get Smart Search (same as before - landlords never had the widget).
function isSmartSearchAvailable() {
    return !!currentUser && currentUser.role === 'tenant';
}

// When set, the main search bar's text is a Smart Search sentence rather than
// a keyword, so filterListings() must NOT use it as a substring filter - the
// grid already holds the smart results, and matching the whole sentence
// against titles would hide every card.
let smartSearchActiveQuery = null;

// Called by the main search form. Sentence-like queries go to Smart Search;
// short keyword queries keep filtering the loaded cards live, as before.
function handleMainSearchSubmit() {
    const term = (document.getElementById('searchLoc')?.value || '').trim();
    if (isSmartSearchAvailable() && looksLikeNaturalLanguageQuery(term)) {
        runSmartSearch(term);
    } else {
        filterListings();
    }
}

async function runSmartSearch(rawQuery) {
    rawQuery = (rawQuery || '').trim();
    if (!rawQuery) return;

    closeSearchSuggestions();
    Swal.fire({ title: 'Searching...', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });

    try {
        const response = await fetch(`${API_BASE}/smart-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: rawQuery.toLowerCase(),
                userContext: { role: currentUser.role, id: currentUser.id }
            })
        });

        if (!response.ok) throw new Error("Search failed");

        const data = await response.json();
        const results = data.results || [];

        if (results.length > 0) {
            smartSearchActiveQuery = rawQuery;
            allListingsCache = results;
            currentDisplayedItems = results;
            hasMorePages = false; // Smart Search returns its full ranked set - nothing left to page through
            hideLoadMoreButton();
            clearAvailabilityFilterState();
            clearCategoryFilterState();
            await renderListings(results);

            Swal.fire({
                title: 'Smart Search',
                text: `Found ${results.length} match${results.length === 1 ? '' : 'es'}!`,
                icon: 'success',
                toast: true,
                position: 'top-end',
                timer: 3000,
                showConfirmButton: false
            });
        } else {
            Swal.fire({
                title: 'No matches',
                text: `We couldn't find "${rawQuery}". Try simpler words like "apartment" or a place name.`,
                icon: 'info'
            });
        }
    } catch (error) {
        console.error("Smart Search Error:", error);
        Swal.fire('Error', 'Something went wrong with the smart search.', 'error');
    }
}

// --- NEW: SHARED UI HELPERS (empty states + skeleton loaders) ---
function emptyStateHTML(icon, title, subtitle, ctaHTML = "") {
    return `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="fas ${icon}"></i></div>
            <h3>${title}</h3>
            <p>${subtitle}</p>
            ${ctaHTML}
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

// --- NEW: RESULTS HEADER ("X Stays Available" + Sort dropdown) ---
function showResultsHeader() {
    const header = document.getElementById('resultsHeader');
    if (header) header.style.display = 'flex';
}

function hideResultsHeader() {
    const header = document.getElementById('resultsHeader');
    if (header) header.style.display = 'none';
}

function updateResultsHeaderCount(count) {
    const el = document.getElementById('resultsHeaderCount');
    if (!el) return;
    el.innerHTML = `<strong>${count}</strong> ${count === 1 ? 'Stay' : 'Stays'} Available`;
}

function sortListings(items, sortOption) {
    const copy = [...items];
    switch (sortOption) {
        case 'price_asc': return copy.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
        case 'price_desc': return copy.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
        case 'rooms_desc': return copy.sort((a, b) => (Number(b.rooms) || 0) - (Number(a.rooms) || 0));
        case 'newest':
        default:
            return copy;
    }
}

function applySorting() {
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) currentSortOption = sortSelect.value;
    renderListings(sortListings(currentDisplayedItems, currentSortOption));
}

// --- NEW: RATING HELPERS (for the card badge + the modal summary box) ---
// Builds a "★★★★☆"-style string for a given average (0-5). Used by both the
// card badge tooltip context and the details-modal summary box.
function buildStarString(avg) {
    const rounded = Math.round(avg);
    const full = Math.max(0, Math.min(5, rounded));
    return '★'.repeat(full) + '☆'.repeat(5 - full);
}

// Reads a listing's rating fields the same way regardless of where they came
// from (the normal /view endpoint, which now includes avg_rating/review_count
// via a SQL subquery, or Smart Search results, which may not have them yet -
// in that case we just show "no ratings" rather than guessing).
function getListingRatingInfo(item) {
    const avg = Number(item.avg_rating) || 0;
    const count = Number(item.review_count) || 0;
    return { avg, count };
}

// NEW: patches the star-average pill (.card-rating) and the comment-count
// badge (.card-comment-btn .comment-count-dot) on the grid card matching
// this listing, in place - called right after loadComments() fetches fresh
// review data, so posting a rating/comment reflects on the card underneath
// the modal immediately instead of requiring a reload. Safe no-op if the
// card isn't currently in the DOM (e.g. it's been filtered out).
function syncCardRatingBadge(listingId, avg, totalCount) {
    const card = document.querySelector(`.listing-card[data-id="${listingId}"]`);
    if (!card) return;

    const ratingEl = card.querySelector('.card-rating');
    if (ratingEl) {
        if (avg > 0) {
            ratingEl.classList.remove('card-rating-empty');
            ratingEl.innerHTML = `<i class="fas fa-star"></i>${avg.toFixed(1)}<span class="card-rating-count">(${totalCount})</span>`;
        } else {
            ratingEl.classList.add('card-rating-empty');
            ratingEl.innerHTML = `<i class="fas fa-star"></i>New`;
        }
    }

    const commentBtn = card.querySelector('.card-comment-btn');
    if (commentBtn) {
        let dot = commentBtn.querySelector('.comment-count-dot');
        if (totalCount > 0) {
            const label = totalCount > 99 ? '99+' : String(totalCount);
            if (dot) {
                dot.innerText = label;
            } else {
                dot = document.createElement('span');
                dot.className = 'comment-count-dot';
                dot.innerText = label;
                commentBtn.appendChild(dot);
            }
        } else if (dot) {
            dot.remove();
        }
    }
}

// NEW: keeps allListingsCache/currentDisplayedItems in sync with the latest
// avg_rating/review_count for a listing, so re-sorting or re-filtering
// after posting a rating doesn't fall back to the stale numbers from the
// last full /api/view fetch.
function updateCachedListingRating(listingId, avg, totalCount) {
    [allListingsCache, currentDisplayedItems].forEach(arr => {
        const item = arr.find(i => String(i.id) === String(listingId));
        if (item) {
            item.avg_rating = avg;
            item.review_count = totalCount;
        }
    });
}

// --- 2. FETCH LISTINGS FROM MYSQL ---
// NEW: builds the query string for GET /api/view. Landlords are scoped
// server-side now via role/user_id (getAllListings already supported this -
// home.js just never sent them before and filtered client-side instead, which
// meant every landlord downloaded every listing only to throw most away).
function buildListingsQuery(extraParams = '') {
    const roleParams = (currentUser && currentUser.role === 'landlord')
        ? `&role=landlord&user_id=${encodeURIComponent(currentUser.id)}`
        : '';
    return `${API_BASE}/view?${extraParams}${roleParams}`;
}

async function loadListings() {
    if (!listingsGrid) return;

    clearAvailabilityFilterState();
    clearCategoryFilterState();
    renderSkeletonCards();
    hideLoadMoreButton();

    smartSearchActiveQuery = null;

    // Reset pagination every time the grid is fully reloaded (Browse click,
    // Clear filters, initial page load).
    currentPage = 1;
    hasMorePages = false;
    totalListingsCount = 0;
    isLoadingMorePages = false;

    try {
        const response = await fetch(buildListingsQuery(`page=1&limit=${LISTINGS_PAGE_SIZE}`));
        const data = await response.json();
        const listings = Array.isArray(data.listings) ? data.listings : [];

        if (!response.ok) throw new Error(data.error || 'Failed to load listings');

        totalListingsCount = Number(data.total) || listings.length;
        hasMorePages = !!data.hasMore;

        if (listings.length === 0) {
            hideResultsHeader();
            if (currentUser && currentUser.role === 'landlord') {
                listingsGrid.innerHTML = emptyStateHTML(
                    'fa-clipboard-list',
                    "You haven't posted anything yet",
                    'Tap the button below to publish your first listing.',
                    `<button class="empty-state-cta" onclick="document.getElementById('postBtn').click()">Post a Listing</button>`
                );
            } else {
                listingsGrid.innerHTML = emptyStateHTML('fa-house-circle-xmark', 'No listings yet', 'Check back soon — new stays are added regularly.');
            }
            return;
        }

        allListingsCache = listings;
        currentDisplayedItems = listings;

        renderListings(listings);
        updateLoadMoreButton();
    } catch (error) {
        console.error("Error fetching listings:", error);
        hideResultsHeader();
        listingsGrid.innerHTML = emptyStateHTML('fa-triangle-exclamation', 'Something went wrong', "We couldn't load listings. Check if the backend is live and try again.");
    }
}

// --- NEW: LOAD MORE (pagination) ---
// The button is created once and injected right after the listings grid, so
// home.html doesn't need any changes. It's shown/hidden/relabelled by the
// helpers below depending on whether the server reported more pages.
function setupLoadMoreButton() {
    if (document.getElementById('loadMoreWrap') || !listingsGrid) return;

    if (!document.getElementById('loadMoreStyles')) {
        const styleTag = document.createElement('style');
        styleTag.id = 'loadMoreStyles';
        styleTag.textContent = `
            .load-more-wrap { display: none; text-align: center; padding: 0 5% 60px; margin-top: -40px; }
            .load-more-btn {
                border: 1.5px solid var(--accent); background: #fff; color: var(--primary);
                padding: 13px 30px; border-radius: 999px; font-weight: 700; font-size: 14px;
                cursor: pointer; transition: background 0.15s, color 0.15s, transform 0.15s, opacity 0.15s;
            }
            .load-more-btn:hover { background: var(--accent); color: #fff; transform: translateY(-1px); }
            .load-more-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
            .load-more-count { display: block; margin-top: 10px; font-size: 12px; color: var(--muted); font-weight: 600; }
        `;
        document.head.appendChild(styleTag);
    }

    const wrap = document.createElement('div');
    wrap.id = 'loadMoreWrap';
    wrap.className = 'load-more-wrap';
    wrap.innerHTML = `
        <button type="button" id="loadMoreBtn" class="load-more-btn">Load more stays</button>
        <span id="loadMoreCount" class="load-more-count"></span>
    `;
    listingsGrid.insertAdjacentElement('afterend', wrap);

    document.getElementById('loadMoreBtn').onclick = loadMoreListings;
}

function updateLoadMoreButton() {
    const wrap = document.getElementById('loadMoreWrap');
    const btn = document.getElementById('loadMoreBtn');
    const countEl = document.getElementById('loadMoreCount');
    if (!wrap || !btn) return;

    if (!hasMorePages) {
        wrap.style.display = 'none';
        return;
    }

    wrap.style.display = 'block';
    btn.disabled = isLoadingMorePages;
    btn.innerText = isLoadingMorePages ? 'Loading...' : 'Load more stays';
    if (countEl) countEl.innerText = `Showing ${currentDisplayedItems.length} of ${totalListingsCount} stays`;
}

function hideLoadMoreButton() {
    const wrap = document.getElementById('loadMoreWrap');
    if (wrap) wrap.style.display = 'none';
}

async function loadMoreListings() {
    if (isLoadingMorePages || !hasMorePages) return;

    isLoadingMorePages = true;
    updateLoadMoreButton();

    try {
        const nextPage = currentPage + 1;
        const response = await fetch(buildListingsQuery(`page=${nextPage}&limit=${LISTINGS_PAGE_SIZE}`));
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load more listings');

        const newListings = Array.isArray(data.listings) ? data.listings : [];

        currentPage = nextPage;
        hasMorePages = !!data.hasMore;
        totalListingsCount = Number(data.total) || totalListingsCount;

        allListingsCache = allListingsCache.concat(newListings);
        currentDisplayedItems = currentDisplayedItems.concat(newListings);

        // Re-render everything loaded so far (respecting the current sort),
        // then re-apply any active search/category/availability filters so
        // freshly loaded cards don't ignore what the person already set.
        renderListings(sortListings(currentDisplayedItems, currentSortOption)).then(() => {
            const hasActiveFilter = (document.getElementById('searchLoc')?.value || '').trim() !== ''
                || currentCategoryFilter !== '' || !!currentAvailabilityFilter
                || (document.getElementById('locFilter')?.value || '').trim() !== ''
                || (document.getElementById('roomFilter')?.value || 'all') !== 'all'
                || (document.getElementById('maxPrice')?.value || 'Infinity') !== 'Infinity';
            if (hasActiveFilter) filterListings();
        });
    } catch (err) {
        console.error("Load more error:", err);
        Swal.fire({ title: 'Error', text: 'Could not load more listings. Please try again.', icon: 'error', toast: true, position: 'top-end', timer: 3000, showConfirmButton: false });
    } finally {
        isLoadingMorePages = false;
        updateLoadMoreButton();
    }
}

// --- 3. RENDER HTML CARDS ---
async function renderListings(items) {
    listingsGrid.innerHTML = ""; 
    
    // With pagination, items.length is only what's loaded so far - show the
    // server's real total while more pages remain.
    updateResultsHeaderCount(hasMorePages ? totalListingsCount : items.length);
    showResultsHeader();

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

        let carouselHTML = buildCarouselHTML(item.images, item.id);

        const statusValue = (item.status || 'available').toLowerCase() === 'occupied' ? 'occupied' : 'available';
        const cardBadgesHTML = `
            <div class="card-badges">
                <span class="category-badge ${getCategoryBadgeClass(item.category)}">${item.category || 'Apartment'}</span>
                <span class="status-chip status-chip-${statusValue}"><span class="status-dot"></span>${statusValue === 'occupied' ? 'Occupied' : 'Available'}</span>
            </div>
        `;
        
        const card = document.createElement('div');
        card.className = 'listing-card';
        card.setAttribute('data-id', item.id);
        card.setAttribute('data-price', item.price || 0);
        card.setAttribute('data-rooms', item.rooms || 0);
        card.setAttribute('data-status', statusValue);
        card.setAttribute('data-amenities', (item.amenities || '').toLowerCase());
        card.setAttribute('data-category', (item.category || '').toLowerCase());
        card.setAttribute('data-title-raw', item.title || 'Cozy Room');
        card.setAttribute('data-location-raw', item.location || 'Unknown');
        card.style.animationDelay = `${Math.min(idx, 10) * 0.05}s`;
        
        card.onclick = () => showFullDetails(item);

        // UI SECURITY: Hide save button for landlords
        const saveButtonHTML = currentUser.role === 'tenant' ? `
            <div class="save-btn ${isSaved ? 'active' : ''}" onclick="toggleBookmark(event, ${item.id})">
                <i class="fas fa-heart"></i>
            </div>
        ` : "";

        const isOwnerCard = currentUser.role === 'landlord' && item.user_id && String(currentUser.id) === String(item.user_id);
        const quickEditHTML = isOwnerCard ? `
            <div class="quick-edit-btn" title="Quick edit">
                <i class="fas fa-pen"></i>
            </div>
        ` : "";

        // NEW: round "reviews" shortcut button - sits next to save/quick-edit
        // and jumps straight to the comment section of this listing's
        // details modal, with the current comment count as a little badge.
        const ratingInfo = getListingRatingInfo(item);
        const commentBtnHTML = `
            <div class="card-comment-btn" title="View reviews">
                <i class="fas fa-comment-dots"></i>
                ${ratingInfo.count > 0 ? `<span class="comment-count-dot">${ratingInfo.count > 99 ? '99+' : ratingInfo.count}</span>` : ''}
            </div>
        `;

        // NEW: star-average pill, shown in the same row as the landlord name.
        // Falls back to a muted "New" pill when the listing has no ratings yet.
        const ratingBadgeHTML = ratingInfo.avg > 0
            ? `<span class="card-rating"><i class="fas fa-star"></i>${ratingInfo.avg.toFixed(1)}<span class="card-rating-count">(${ratingInfo.count})</span></span>`
            : `<span class="card-rating card-rating-empty"><i class="fas fa-star"></i>New</span>`;

        card.innerHTML = `
            ${saveButtonHTML}
            ${quickEditHTML}
            ${commentBtnHTML}
            ${cardBadgesHTML}
            ${carouselHTML}
            <div class="listing-info">
                <div class="price-row">
                    <span class="price">₱${Number(item.price || 0).toLocaleString()}</span><span class="price-suffix">&nbsp;/mo</span>
                </div>
                <div class="title-text">${item.title || 'Cozy Room'}</div>
                <div class="landlord-name">
                    <i class="fas fa-user-tie"></i> ${item.landlord_name || 'Owner'}
                    ${ratingBadgeHTML}
                </div>
                <div class="location"><i class="fas fa-map-marker-alt"></i> <span class="location-text">${item.location || 'Unknown'}</span></div>
                <div class="details">
                    <span><i class="fas fa-bed"></i> ${item.rooms || 0} Rooms</span>
                    <span><i class="fas fa-expand"></i> ${item.size || 0} sqm</span>
                </div>
            </div>
        `;

        if (isOwnerCard) {
            const quickEditEl = card.querySelector('.quick-edit-btn');
            if (quickEditEl) {
                quickEditEl.onclick = (e) => {
                    e.stopPropagation();
                    openEditModal(item);
                };
            }
        }

        // NEW: wire the comment shortcut separately (same reasoning as the
        // quick-edit button above - avoids serializing the whole item into
        // an inline onclick attribute). Opens the details modal and jumps
        // straight to the reviews section.
        const commentBtnEl = card.querySelector('.card-comment-btn');
        if (commentBtnEl) {
            commentBtnEl.onclick = (e) => {
                e.stopPropagation();
                openReviewsFor(item);
            };
        }

        listingsGrid.appendChild(card);
    });
}

// NEW: opens a listing's details modal and scrolls straight to the reviews
// section, focusing the comment box so the person can start typing right
// away. Used by the new card "chat" shortcut button.
function openReviewsFor(item) {
    showFullDetails(item);
    // Wait a tick for the modal to render/display before scrolling to it.
    setTimeout(() => {
        const anchor = document.getElementById('reviewsSectionAnchor');
        if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const commentBox = document.getElementById('commentText');
        if (commentBox) commentBox.focus();
    }, 120);
}

function getCategoryBadgeClass(category) {
    const key = (category || '').toLowerCase();
    if (key === 'apartment') return 'cat-apartment';
    if (key === 'house') return 'cat-house';
    if (key === 'condo') return 'cat-condo';
    if (key === 'bedspace') return 'cat-bedspace';
    return 'cat-default';
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
    if(document.getElementById('postStatus')) document.getElementById('postStatus').value = (item.status === 'occupied') ? 'occupied' : 'available';

    const imageInputEl = document.getElementById('postImages');
    const previewDivEl = document.getElementById('imagePreview');
    const imagesLabelEl = document.getElementById('postImagesLabel');
    if (imagesLabelEl) imagesLabelEl.innerText = "Current Photos (choose new files only if you want to replace them)";
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

    originalFormSnapshot = getCurrentFormSnapshot();

    submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        submitBtn.innerText = "Saving...";

        let newImages = [];
        if (selectedListingFiles.length > 0) {
            try {
                newImages = await Promise.all(selectedListingFiles.map(file => compressImageFile(file)));
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
            status: document.getElementById('postStatus')?.value || 'available',
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
                clearUnsavedFlag();
                Swal.fire({ title: 'Updated!', text: 'Your listing has been updated.', icon: 'success' }).then(() => location.reload());
            } else {
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

// --- UPDATED: RESTYLED COMMENT RENDERING ---
// This is the part Renz actually asked to change. Each comment now renders
// as a small card with an avatar-initial circle, a name + star row, and the
// comment text underneath - built from the .comment-item/.comment-avatar/
// .comment-body/.comment-top-row/.comment-name/.comment-stars/.comment-text
// classes defined in home.html. A landlord reply (is_reply === 1) gets the
// .reply-item modifier class plus the existing .landlord-reply-badge, so it
// reads as visually "attached" to the comment above it. The average-rating
// summary box above the list (#commentsSummaryBox) is also filled in here,
// computed from whatever rated reviews (rating > 0) came back for this
// listing - no separate network call needed.
async function loadComments(listingId) {
    const list = document.getElementById('commentsDisplayList');
    const revCountBadge = document.getElementById('revCount'); 
    
    list.innerHTML = "<p style='font-size:12px; color:gray; text-align:center; padding:14px 0;'>Loading reviews...</p>";

    try {
        const res = await fetch(`${API_BASE}/get-reviews/${listingId}`);
        const reviews = await res.json();
        
        if (revCountBadge) {
            revCountBadge.innerText = reviews.length;
        }

        // NEW: fill in the "at a glance" summary box (average score, stars,
        // and count) from whatever rows actually carry a star rating.
        const ratedReviews = reviews.filter(r => r.rating && r.rating > 0);
        const avg = ratedReviews.length > 0
            ? ratedReviews.reduce((sum, r) => sum + Number(r.rating), 0) / ratedReviews.length
            : 0;
        const summaryBox = document.getElementById('commentsSummaryBox');
        const summaryScore = document.getElementById('commentsSummaryScore');
        const summaryStars = document.getElementById('commentsSummaryStars');
        const summaryCount = document.getElementById('commentsSummaryCount');
        if (summaryBox && summaryScore && summaryStars && summaryCount) {
            if (ratedReviews.length > 0) {
                summaryBox.classList.remove('comments-summary-empty');
                summaryScore.innerText = avg.toFixed(1);
                summaryStars.innerText = buildStarString(avg);
                summaryCount.innerText = `${ratedReviews.length} rating${ratedReviews.length === 1 ? '' : 's'}`;
            } else {
                summaryBox.classList.add('comments-summary-empty');
                summaryScore.innerText = '—';
                summaryStars.innerText = '☆☆☆☆☆';
                summaryCount.innerText = 'No ratings yet';
            }
        }

        // FIX: the star-average pill and comment-count badge on this
        // listing's card (sitting behind the modal, built once back in
        // renderListings()) never used to get told about a new rating/
        // comment - they only reflected whatever avg_rating/review_count
        // came back from the LAST full /api/view fetch, so a fresh rating
        // wouldn't show up on the card until the page was reloaded. Both
        // helpers below patch the actual DOM element in place and update
        // the cached listing data, so the card is correct immediately -
        // no reload, no refetch.
        syncCardRatingBadge(listingId, avg, reviews.length);
        updateCachedListingRating(listingId, avg, reviews.length);

        if (reviews.length === 0) {
            list.innerHTML = `<div class="comment-empty"><i class="fas fa-comment-slash"></i>No reviews yet. Be the first to leave one!</div>`;
            return;
        }

        list.innerHTML = reviews.map(rev => {
            const isReply = Number(rev.is_reply) === 1;
            const starsHTML = (!isReply && rev.rating)
                ? `<span class="comment-stars">${buildStarString(rev.rating)}</span>`
                : "";
            const nameLabel = isReply
                ? `${rev.user_name} <span class="landlord-reply-badge">Landlord</span>`
                : rev.user_name;
            const initial = (rev.user_name || "?").trim().charAt(0).toUpperCase() || "?";

            return `
                <div class="comment-item${isReply ? ' reply-item' : ''}">
                    <div class="comment-avatar">${initial}</div>
                    <div class="comment-body">
                        <div class="comment-top-row">
                            <span class="comment-name">${nameLabel}</span>
                            ${starsHTML}
                        </div>
                        <p class="comment-text">${rev.comment || ""}</p>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        list.innerHTML = "<p style='color:red; text-align:center;'>Error loading reviews.</p>";
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
        localStorage.removeItem('bookmarks');
        window.location.href = "index.html";
    };
}

// --- 10. FILTERING & SEARCH ---

function normalizeForSearch(str) {
    return (str || '').toString().toLowerCase().replace(/\s+/g, '');
}

function escapeHtml(str) {
    return (str || '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
}

function escapeRegExp(str) {
    return (str || '').toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatch(rawText, rawTerm) {
    const term = (rawTerm || '').trim();
    if (!term) return rawText;
    const re = new RegExp(`(${escapeRegExp(term)})`, 'ig');
    return rawText.replace(re, '<mark class="search-highlight">$1</mark>');
}

function filterListings() {
    const searchTerm = smartSearchActiveQuery ? '' : document.getElementById('searchLoc').value.toLowerCase();
    const normalizedSearchTerm = normalizeForSearch(searchTerm);
    const maxPriceValue = document.getElementById('maxPrice').value;
    const maxPrice = maxPriceValue === "Infinity" ? Infinity : parseInt(maxPriceValue);
    
    const minRooms = document.getElementById('roomFilter').value;
    const locFilter = document.getElementById('locFilter').value.toLowerCase();

    const cards = document.querySelectorAll('.listing-card');
    let visibleCount = 0;

    cards.forEach(card => {
        const titleRaw = card.getAttribute('data-title-raw') || '';
        const locationRaw = card.getAttribute('data-location-raw') || '';
        const titleText = titleRaw.toLowerCase();
        const locationText = locationRaw.toLowerCase();
        const amenitiesText = card.getAttribute('data-amenities') || '';
        const categoryText = card.getAttribute('data-category') || '';
        const price = parseInt(card.getAttribute('data-price'));
        const rooms = parseInt(card.getAttribute('data-rooms'));
        const cardStatus = card.getAttribute('data-status') || 'available';

        const matchesMainSearch =
            normalizeForSearch(titleText).includes(normalizedSearchTerm) ||
            normalizeForSearch(locationText).includes(normalizedSearchTerm) ||
            normalizeForSearch(amenitiesText).includes(normalizedSearchTerm) ||
            normalizeForSearch(categoryText).includes(normalizedSearchTerm);
        const matchesPrice = isNaN(maxPrice) || price <= maxPrice;
        const matchesRooms = minRooms === "all" || rooms >= parseInt(minRooms);
        const matchesSpecificLoc = locationText.includes(locFilter);
        const matchesAvailability = !currentAvailabilityFilter || cardStatus === currentAvailabilityFilter;
        const matchesCategoryPill = !currentCategoryFilter || categoryText === currentCategoryFilter;

        const isVisible = matchesMainSearch && matchesPrice && matchesRooms && matchesSpecificLoc && matchesAvailability && matchesCategoryPill;
        card.style.display = isVisible ? "block" : "none";
        if (isVisible) visibleCount++;

        const titleEl = card.querySelector('.title-text');
        const locationTextEl = card.querySelector('.location-text');
        if (titleEl) titleEl.innerHTML = highlightMatch(escapeHtml(titleRaw), searchTerm);
        if (locationTextEl) locationTextEl.innerHTML = highlightMatch(escapeHtml(locationRaw), searchTerm);
    });

    const hasActiveSearch = searchTerm.trim() !== "" || currentCategoryFilter !== "" || !!currentAvailabilityFilter ||
        locFilter.trim() !== "" || minRooms !== "all" || maxPriceValue !== "Infinity";
    updateSearchMetaRow(searchTerm, visibleCount, cards.length, hasActiveSearch);

    updateFilterEmptyState(hasActiveSearch, visibleCount, cards.length);
}

function updateFilterEmptyState(hasActiveSearch, visibleCount, totalCount) {
    const existingMsg = document.getElementById('no-filter-results-msg');
    if (existingMsg) existingMsg.remove();

    if (hasActiveSearch && visibleCount === 0 && totalCount > 0) {
        listingsGrid.insertAdjacentHTML(
            'beforeend',
            `<div id="no-filter-results-msg">${emptyStateHTML(
                'fa-magnifying-glass-minus',
                'No matches found',
                'Try a different keyword or category, or clear your filters to see everything again.',
                `<button class="empty-state-cta" onclick="resetFilters()">Clear Filters</button>`
            )}</div>`
        );
    }
}

function looksLikeNaturalLanguageQuery(term) {
    const lower = (term || '').toLowerCase().trim();
    const words = lower.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false; // one word is a plain keyword search

    // Short queries that are still clearly "smart" (sort or price intent)
    const intentWords = [
        'cheapest', 'pinakamura', 'mura', 'murang', 'affordable', 'budget',
        'expensive', 'mahal', 'pinakamahal', 'biggest', 'malaki', 'pinakamalaki',
        'pababa', 'pataas', 'under', 'below', 'above', 'over'
    ];
    if (words.some(w => intentWords.includes(w))) return true;

    if (words.length < 3) return false;
    const connectorWords = [
        'malapit', 'sa', 'na', 'may', 'meron', 'gusto', 'kong',
        'near', 'with', 'around', 'less', 'than'
    ];
    return words.some(w => connectorWords.includes(w));
}


function updateSearchMetaRow(searchTerm, visibleCount, totalCount, hasActiveSearch) {
    const metaRow = document.getElementById('searchMetaRow');
    if (!metaRow) return;

    if (!hasActiveSearch) {
        metaRow.innerHTML = "";
        metaRow.style.display = "none";
        return;
    }

    let html = `<span id="resultCountText"><strong>${visibleCount}</strong> of ${totalCount} ${totalCount === 1 ? 'stay' : 'stays'} shown</span>`;

    if (isSmartSearchAvailable() && looksLikeNaturalLanguageQuery(searchTerm)) {
        html += `<span class="smart-search-hint-link" id="smartSearchHintLink"><i class="fas fa-wand-magic-sparkles"></i> Press Enter for Smart Search</span>`;
    }

    metaRow.innerHTML = html;
    metaRow.style.display = "flex";

    const hintLink = document.getElementById('smartSearchHintLink');
    if (hintLink) {
        hintLink.onclick = () => runSmartSearch(document.getElementById('searchLoc').value);
    }
}

// --- NEW: RECENT SEARCHES (localStorage, most-recent-first, max 5) ---
function getRecentSearches() {
    try {
        return JSON.parse(localStorage.getItem('recentSearches')) || [];
    } catch (e) {
        return [];
    }
}

function saveRecentSearch(term) {
    const clean = (term || '').trim();
    if (!clean) return;
    let recent = getRecentSearches().filter(t => t.toLowerCase() !== clean.toLowerCase());
    recent.unshift(clean);
    recent = recent.slice(0, 5);
    localStorage.setItem('recentSearches', JSON.stringify(recent));
}

function clearRecentSearches() {
    localStorage.removeItem('recentSearches');
}

function buildAutocompleteSuggestions(rawTerm) {
    const term = normalizeForSearch(rawTerm);
    if (!term) return [];

    const seen = new Set();
    const suggestions = [];

    allListingsCache.forEach(item => {
        const title = (item.title || '').trim();
        if (title && normalizeForSearch(title).includes(term) && !seen.has('t:' + title.toLowerCase())) {
            seen.add('t:' + title.toLowerCase());
            suggestions.push({ icon: 'fa-house', label: title, sub: item.location || '' });
        }
    });

    allListingsCache.forEach(item => {
        const loc = (item.location || '').trim();
        if (loc && normalizeForSearch(loc).includes(term) && !seen.has('l:' + loc.toLowerCase())) {
            seen.add('l:' + loc.toLowerCase());
            suggestions.push({ icon: 'fa-location-dot', label: loc, sub: 'Location' });
        }
    });

    ['Apartment', 'House', 'Condo', 'Bedspace'].forEach(cat => {
        if (normalizeForSearch(cat).includes(term) && !seen.has('c:' + cat.toLowerCase())) {
            seen.add('c:' + cat.toLowerCase());
            suggestions.push({ icon: 'fa-tag', label: cat, sub: 'Category' });
        }
    });

    return suggestions.slice(0, 6);
}

function renderSearchSuggestions() {
    const box = document.getElementById('searchSuggestions');
    const input = document.getElementById('searchLoc');
    if (!box || !input) return;

    const rawTerm = input.value;
    let html = '';

    if (!rawTerm.trim()) {
        const recent = getRecentSearches();
        if (recent.length > 0) {
            html += `<div class="search-suggestions-section-label">Recent Searches</div>`;
            recent.forEach(term => {
                html += `<div class="search-suggestion-item" data-value="${escapeHtmlAttr(term)}">
                    <i class="fas fa-clock-rotate-left"></i> ${escapeHtml(term)}
                </div>`;
            });
            html += `<div class="search-suggestion-clear-recent" id="clearRecentSearchesBtn">Clear recent searches</div>`;
        }
    } else {
        const matches = buildAutocompleteSuggestions(rawTerm);
        if (matches.length > 0) {
            html += `<div class="search-suggestions-section-label">Suggestions</div>`;
            matches.forEach(m => {
                html += `<div class="search-suggestion-item" data-value="${escapeHtmlAttr(m.label)}">
                    <i class="fas ${m.icon}"></i> ${highlightMatch(escapeHtml(m.label), rawTerm)}
                    ${m.sub ? `<span class="suggestion-sub">${escapeHtml(m.sub)}</span>` : ''}
                </div>`;
            });
        }
    }

    box.innerHTML = html;
    box.classList.toggle('open', html !== '');
    suggestionHighlightIndex = -1;
}

function updateSuggestionHighlight(items) {
    items.forEach((el, i) => el.classList.toggle('highlighted', i === suggestionHighlightIndex));
}

function closeSearchSuggestions() {
    const box = document.getElementById('searchSuggestions');
    if (box) box.classList.remove('open');
    suggestionHighlightIndex = -1;
}

function updateClearButtonVisibility() {
    const input = document.getElementById('searchLoc');
    const clearBtn = document.getElementById('searchClearBtn');
    if (!input || !clearBtn) return;
    clearBtn.style.display = input.value.trim() ? 'flex' : 'none';
}

function setupSearchBarEnhancements() {
    const input = document.getElementById('searchLoc');
    const clearBtn = document.getElementById('searchClearBtn');
    const suggestionsBox = document.getElementById('searchSuggestions');
    const wrapper = document.getElementById('searchBoxWrapper');
    if (!input || !suggestionsBox || !wrapper) return;

    input.addEventListener('input', () => {
        updateClearButtonVisibility();
        renderSearchSuggestions();
    });

    input.addEventListener('focus', () => {
        renderSearchSuggestions();
    });

    input.addEventListener('keydown', (e) => {
        const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
        if (!suggestionsBox.classList.contains('open') || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            suggestionHighlightIndex = Math.min(suggestionHighlightIndex + 1, items.length - 1);
            updateSuggestionHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            suggestionHighlightIndex = Math.max(suggestionHighlightIndex - 1, 0);
            updateSuggestionHighlight(items);
        } else if (e.key === 'Enter' && suggestionHighlightIndex >= 0 && items[suggestionHighlightIndex]) {
            e.preventDefault();
            items[suggestionHighlightIndex].click();
        } else if (e.key === 'Escape') {
            closeSearchSuggestions();
        }
    });

    wrapper.addEventListener('submit', () => {
        saveRecentSearch(input.value);
        closeSearchSuggestions();
    });

    if (clearBtn) {
        clearBtn.onclick = () => {
            const wasSmart = !!smartSearchActiveQuery;
            input.value = "";
            updateClearButtonVisibility();
            closeSearchSuggestions();
            if (wasSmart) {
                loadListings(); // grid currently holds Smart Search results - bring the full list back
            } else {
                filterListings();
            }
            input.focus();
        };
    }

    suggestionsBox.addEventListener('click', (e) => {
        if (e.target.closest('#clearRecentSearchesBtn')) {
            clearRecentSearches();
            renderSearchSuggestions();
            return;
        }
        const item = e.target.closest('.search-suggestion-item');
        if (item) {
            const value = item.getAttribute('data-value') || '';
            input.value = value;
            updateClearButtonVisibility();
            saveRecentSearch(value);
            closeSearchSuggestions();
            filterListings();
        }
    });

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target) && !suggestionsBox.contains(e.target)) {
            closeSearchSuggestions();
        }
    });

    updateClearButtonVisibility();
}

// --- NEW: STICKY (COMPACT) SEARCH BAR ---
function setupStickySearchBar() {
    const stickyBar = document.getElementById('stickySearchBar');
    const stickyInput = document.getElementById('stickySearchInput');
    const filterContainer = document.querySelector('.filter-container');
    const mainInput = document.getElementById('searchLoc');
    if (!stickyBar || !stickyInput || !filterContainer || !mainInput) return;

    window.addEventListener('scroll', () => {
        const triggerPoint = filterContainer.offsetTop + filterContainer.offsetHeight;
        stickyBar.classList.toggle('visible', window.scrollY > triggerPoint);
    });

    stickyInput.addEventListener('input', () => {
        mainInput.value = stickyInput.value;
        smartSearchActiveQuery = null;
        updateClearButtonVisibility();
        filterListings();
    });

    mainInput.addEventListener('input', () => {
        if (document.activeElement !== stickyInput) stickyInput.value = mainInput.value;
    });
}

// --- NEW: FOOTER WIRING (current year + Settings link) ---
function setupFooter() {
    const yearEl = document.getElementById('footerYear');
    if (yearEl) yearEl.innerText = new Date().getFullYear();

    const footerSettingsLink = document.getElementById('footerSettingsLink');
    if (footerSettingsLink) {
        footerSettingsLink.onclick = (e) => {
            e.preventDefault();
            const settingsBtn = document.getElementById('settingsBtn');
            if (settingsBtn) settingsBtn.click();
        };
    }
}

// --- NEW: CATEGORY QUICK-FILTER PILLS ---
function setupCategoryPills() {
    const pillsContainer = document.getElementById('categoryPills');
    if (!pillsContainer) return;

    pillsContainer.querySelectorAll('.category-pill').forEach(pill => {
        pill.onclick = () => {
            pillsContainer.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentCategoryFilter = pill.getAttribute('data-category') || '';
            filterListings();
        };
    });
}

function clearCategoryFilterState() {
    currentCategoryFilter = "";
    const pillsContainer = document.getElementById('categoryPills');
    if (!pillsContainer) return;
    pillsContainer.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    const allPill = pillsContainer.querySelector('.category-pill[data-category=""]');
    if (allPill) allPill.classList.add('active');
}

function resetFilters() {
    document.getElementById('searchLoc').value = "";
    document.getElementById('maxPrice').value = "Infinity";
    document.getElementById('roomFilter').value = "all";
    document.getElementById('locFilter').value = "";
    clearAvailabilityFilterState();
    clearCategoryFilterState();
    updateClearButtonVisibility();
    closeSearchSuggestions();
    
    const viewAllBtn = document.getElementById('viewAllBtn');
    const viewSavedBtn = document.getElementById('viewSavedBtn');
    if(viewAllBtn) viewAllBtn.classList.add('nav-active');
    if(viewSavedBtn) viewSavedBtn.classList.remove('nav-active');
    
    loadListings();
}

if(document.getElementById('searchLoc')) document.getElementById('searchLoc').addEventListener('input', () => { smartSearchActiveQuery = null; filterListings(); });
if(document.getElementById('maxPrice')) document.getElementById('maxPrice').addEventListener('change', filterListings);
if(document.getElementById('roomFilter')) document.getElementById('roomFilter').addEventListener('change', filterListings);
if(document.getElementById('locFilter')) document.getElementById('locFilter').addEventListener('input', filterListings);

// --- 11. PROFILE SETTINGS ---
function setupSettingsLogic() {
    const settingsBtn = document.getElementById('settingsBtn');
    const modal = document.getElementById('settingsModal');
    const saveBtn = document.getElementById('saveSettingsBtn');
    const editRoleSelect = document.getElementById('editRole');
    const docsSection = document.getElementById('settingsLandlordDocsSection');

    if (!settingsBtn || !modal) return;

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
        if (document.getElementById('settingsDocOwnership')) document.getElementById('settingsDocOwnership').value = "";
        if (document.getElementById('settingsDocPermits')) document.getElementById('settingsDocPermits').value = "";
        if (document.getElementById('settingsDocBir')) document.getElementById('settingsDocBir').value = "";
        if (document.getElementById('settingsDocSelfie')) document.getElementById('settingsDocSelfie').value = "";
        if (document.getElementById('settingsDocOwnerName')) document.getElementById('settingsDocOwnerName').value = "";
        toggleDocsSection();
        modal.style.display = 'block';
    };

    saveBtn.onclick = async () => {
        const chosenRole = document.getElementById('editRole').value;
        const alreadyApproved = currentUser.landlord_status === 'approved';
        const isNewLandlordRequest = (chosenRole === 'landlord' && !alreadyApproved);

        let docOwnershipFile = null, docPermitsFile = null, docBirFile = null, docSelfieFile = null;
        let docOwnerName = "";
        if (isNewLandlordRequest) {
            docOwnershipFile = document.getElementById('settingsDocOwnership').files[0];
            docPermitsFile = document.getElementById('settingsDocPermits').files[0];
            docBirFile = document.getElementById('settingsDocBir').files[0];
            docSelfieFile = document.getElementById('settingsDocSelfie').files[0];
            docOwnerName = document.getElementById('settingsDocOwnerName').value.trim();

            if (!docOwnershipFile || !docPermitsFile || !docBirFile || !docSelfieFile) {
                return Swal.fire({ title: 'Missing Documents', text: 'Please upload all 4 required items: Proof of Ownership, Local Permits, BIR Registration, and a Selfie with valid ID.', icon: 'warning', target: '#settingsModal' });
            }
            if (!docOwnerName) {
                return Swal.fire({ title: 'Missing Info', text: 'Please type the name shown on your Proof of Ownership document.', icon: 'warning', target: '#settingsModal' });
            }
        }

        saveBtn.disabled = true;
        saveBtn.innerText = "Updating...";

        let landlordDocuments = null;
        if (isNewLandlordRequest) {
            try {
                saveBtn.innerText = "Uploading documents...";
                const compressed = await Promise.all([
                    compressImageFile(docOwnershipFile),
                    compressImageFile(docPermitsFile),
                    compressImageFile(docBirFile),
                    compressImageFile(docSelfieFile)
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
            landlord_documents: landlordDocuments,
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
                const newUserObj = { ...currentUser, ...updatedData, role: result.role || updatedData.role, landlord_status: result.landlord_status };
                delete newUserObj.landlord_documents;
                delete newUserObj.landlord_doc_name;
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
    const postFab = document.getElementById('postFab');
    const submitPostBtn = document.getElementById('submitPostBtn');
    const imageInput = document.getElementById('postImages');
    const previewDiv = document.getElementById('imagePreview');

    if (!postBtn || !postModal) return;

    if (imageInput) {
        imageInput.onchange = () => {
            const newFiles = Array.from(imageInput.files);
            if (newFiles.length === 0) return;
            selectedListingFiles = selectedListingFiles.concat(newFiles);
            imageInput.value = "";
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
        if(document.getElementById('postStatus')) document.getElementById('postStatus').value = "available";
        selectedListingFiles = [];
        if(previewDiv) previewDiv.innerHTML = "";
        if(imageInput) imageInput.value = "";
        const imagesLabelEl = document.getElementById('postImagesLabel');
        if (imagesLabelEl) imagesLabelEl.innerText = "Listing Photos (Select Multiple)";

        submitPostBtn.onclick = addNewListingAction; 
        postModal.style.display = 'block';
        originalFormSnapshot = getCurrentFormSnapshot();
    }

    postBtn.onclick = openPostModalForNewListing;
    if (postFab) postFab.onclick = openPostModalForNewListing;

    async function addNewListingAction() {
        const imageFiles = selectedListingFiles;
        submitPostBtn.disabled = true;
        submitPostBtn.innerText = "Processing...";

        let base64Images = [];
        try {
            base64Images = await Promise.all(imageFiles.map(file => compressImageFile(file)));
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
            status: document.getElementById('postStatus')?.value || 'available',
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
                clearUnsavedFlag();
                Swal.fire({ title: 'Success!', text: 'Listing published.', icon: 'success', target: '#postModal' }).then(() => location.reload());
            } else {
                const errResult = await response.json().catch(() => ({ message: "Submission Failed" }));
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

    // UPDATED: the Saved view used to filter whichever cards were already in
    // the DOM. That only worked because every listing was always loaded at
    // once - with pagination, a saved listing sitting on page 2 would
    // silently be missing. It now fetches the complete list (all=true) and
    // filters that by the bookmarked ids, so Saved is always correct
    // regardless of how many pages the Browse view has loaded.
    viewSavedBtn.onclick = async () => {
        clearAvailabilityFilterState();
        clearCategoryFilterState();
        viewSavedBtn.classList.add('nav-active');
        viewAllBtn.classList.remove('nav-active');
        hideLoadMoreButton();
        hasMorePages = false;

        const savedIds = (JSON.parse(localStorage.getItem('bookmarks')) || []).map(Number);

        const showEmptySaved = () => {
            hideResultsHeader();
            const msgText = (currentUser.role === 'landlord')
                ? "You haven't saved any of your own listings yet."
                : "You haven't saved any listings yet.";
            listingsGrid.innerHTML = `<div id="no-saved-msg">${emptyStateHTML(
                'fa-heart-crack',
                'Nothing saved yet',
                msgText,
                `<button class="empty-state-cta" onclick="document.getElementById('viewAllBtn').click()">Browse Listings</button>`
            )}</div>`;
        };

        if (savedIds.length === 0) {
            showEmptySaved();
            return;
        }

        renderSkeletonCards(Math.min(savedIds.length, 8));

        try {
            const response = await fetch(buildListingsQuery('all=true'));
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to load saved listings');

            const everything = Array.isArray(data.listings) ? data.listings : [];
            const savedListings = everything.filter(item => savedIds.includes(Number(item.id)));

            allListingsCache = everything;
            currentDisplayedItems = savedListings;

            if (savedListings.length === 0) {
                showEmptySaved();
                return;
            }

            renderListings(savedListings);
        } catch (err) {
            console.error("Saved view error:", err);
            hideResultsHeader();
            listingsGrid.innerHTML = emptyStateHTML('fa-triangle-exclamation', 'Something went wrong', "We couldn't load your saved listings. Please try again.");
        }
    };

    viewAllBtn.onclick = () => {
        clearAvailabilityFilterState();
        clearCategoryFilterState();
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

// --- 15. UNSAVED CHANGES PROTECTION ---

function getCurrentFormSnapshot() {
    return JSON.stringify({
        title: document.getElementById('postTitle')?.value || "",
        category: document.getElementById('postCategory')?.value || "",
        price: document.getElementById('postPrice')?.value || "",
        location: document.getElementById('postLocation')?.value || "",
        rooms: document.getElementById('postRooms')?.value || "",
        size: document.getElementById('postSize')?.value || "",
        amenities: document.getElementById('postAmenities')?.value || "",
        status: document.getElementById('postStatus')?.value || ""
    });
}

function isPostFormDirty() {
    if (originalFormSnapshot === null) return false;
    const currentSnapshot = getCurrentFormSnapshot();
    const fieldsChanged = currentSnapshot !== originalFormSnapshot;
    const newPhotosSelected = selectedListingFiles.length > 0;
    return fieldsChanged || newPhotosSelected;
}

function clearUnsavedFlag() {
    originalFormSnapshot = null;
}

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

window.addEventListener('beforeunload', function (e) {
    const postModal = document.getElementById('postModal');
    if (postModal && postModal.style.display === 'block' && isPostFormDirty()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});
