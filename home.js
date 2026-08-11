// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app-system.onrender.com/api";

const currentUser = JSON.parse(localStorage.getItem('user'));
const listingsGrid = document.getElementById('listingsGrid');

// Global variable to track selected stars
let selectedRating = 0;

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

// --- NEW: SMART SEARCH UI INJECTION ---
function injectSmartSearchUI() {
    const btn = document.createElement('button');
    btn.id = "smartSearchBtn";
    btn.innerHTML = '<i class="fas fa-robot"></i> Smart Search';
    btn.style = "position:fixed; bottom:20px; right:20px; z-index:999; padding:12px 20px; border-radius:30px; border:none; background:#007bff; color:white; cursor:pointer; box-shadow:0 4px 15px rgba(0,0,0,0.2); font-weight:bold;";
    document.body.appendChild(btn);

    const chatbox = document.createElement('div');
    chatbox.id = "smartSearchBox";
    chatbox.style = "display:none; position:fixed; bottom:80px; right:20px; z-index:999; width:300px; background:white; border-radius:15px; box-shadow:0 5px 25px rgba(0,0,0,0.3); overflow:hidden; border:1px solid #ddd; font-family:sans-serif;";
    chatbox.innerHTML = `
        <div style="background:#007bff; color:white; padding:15px; font-weight:bold; display:flex; justify-content:space-between;">
            <span>Smart Finder</span>
            <i class="fas fa-times" style="cursor:pointer;" onclick="document.getElementById('smartSearchBox').style.display='none'"></i>
        </div>
        <div style="padding:15px;">
            <p style="font-size:12px; color:#666; margin-bottom:10px;">Type what you are looking for (e.g., "Bahay malapit sa palengke" or "Room under 5000")</p>
            <input type="text" id="smartInput" placeholder="Ask me anything..." style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px; outline:none;">
            <button id="executeSmartSearch" style="width:100%; margin-top:10px; padding:10px; background:#28a745; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">Find Stays</button>
        </div>
    `;
    document.body.appendChild(chatbox);

    btn.onclick = () => {
        chatbox.style.display = chatbox.style.display === 'none' ? 'block' : 'none';
        document.getElementById('smartInput').focus();
    };

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
    searchBtn.disabled = true;
    searchBtn.innerText = "Searching...";

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
            document.getElementById('smartSearchBox').style.display = 'none';
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
        searchBtn.innerText = "Find Stays";
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
        
        const card = document.createElement('div');
        card.className = 'listing-card';
        card.setAttribute('data-id', item.id);
        card.setAttribute('data-price', item.price || 0);
        card.setAttribute('data-rooms', item.rooms || 0);
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

    // NEW: reset the file input and preview the listing's existing photos so
    // the landlord can see what's currently posted, and so any leftover file
    // selection/preview from a previous "Post a Listing" session doesn't leak
    // into Edit mode.
    const imageInputEl = document.getElementById('postImages');
    const previewDivEl = document.getElementById('imagePreview');
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
        const price = parseInt(card.getAttribute('data-price'));
        const rooms = parseInt(card.getAttribute('data-rooms'));

        const matchesMainSearch = titleText.includes(searchTerm) || locationText.includes(searchTerm);
        const matchesPrice = isNaN(maxPrice) || price <= maxPrice;
        const matchesRooms = minRooms === "all" || rooms >= parseInt(minRooms);
        const matchesSpecificLoc = locationText.includes(locFilter);

        card.style.display = (matchesMainSearch && matchesPrice && matchesRooms && matchesSpecificLoc) ? "block" : "none";
    });
}

function resetFilters() {
    document.getElementById('searchLoc').value = "";
    document.getElementById('maxPrice').value = "Infinity";
    document.getElementById('roomFilter').value = "all";
    document.getElementById('locFilter').value = "";
    
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
        // NEW: reset file inputs and re-evaluate whether the doc section
        // should show, every time the modal is opened
        if (document.getElementById('settingsDocOwnership')) document.getElementById('settingsDocOwnership').value = "";
        if (document.getElementById('settingsDocPermits')) document.getElementById('settingsDocPermits').value = "";
        if (document.getElementById('settingsDocBir')) document.getElementById('settingsDocBir').value = "";
        toggleDocsSection();
        modal.style.display = 'block';
    };

    saveBtn.onclick = async () => {
        const chosenRole = document.getElementById('editRole').value;
        const alreadyApproved = currentUser.landlord_status === 'approved';
        const isNewLandlordRequest = (chosenRole === 'landlord' && !alreadyApproved);

        // NEW: require all 3 documents when submitting a fresh landlord request
        let docOwnershipFile = null, docPermitsFile = null, docBirFile = null;
        if (isNewLandlordRequest) {
            docOwnershipFile = document.getElementById('settingsDocOwnership').files[0];
            docPermitsFile = document.getElementById('settingsDocPermits').files[0];
            docBirFile = document.getElementById('settingsDocBir').files[0];

            if (!docOwnershipFile || !docPermitsFile || !docBirFile) {
                return Swal.fire({ title: 'Missing Documents', text: 'Please upload all 3 required documents: Proof of Ownership, Local Permits, and BIR Registration.', icon: 'warning', target: '#settingsModal' });
            }
        }

        saveBtn.disabled = true;
        saveBtn.innerText = "Updating...";

        // NEW: compress and attach the 3 landlord documents (if applicable),
        // reusing the shared compressImageFile() helper defined near the top
        // of this file.
        let landlordDocuments = null;
        if (isNewLandlordRequest) {
            try {
                saveBtn.innerText = "Uploading documents...";
                const compressed = await Promise.all([
                    compressImageFile(docOwnershipFile),
                    compressImageFile(docPermitsFile),
                    compressImageFile(docBirFile)
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
            landlord_documents: landlordDocuments
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
        // NEW: clear the persistent multi-photo selection whenever a fresh
        // "Post a Listing" session starts, so nothing carries over from a
        // previous attempt or from Edit mode.
        selectedListingFiles = [];
        if(previewDiv) previewDiv.innerHTML = "";
        if(imageInput) imageInput.value = "";

        submitPostBtn.onclick = addNewListingAction; 
        postModal.style.display = 'block';
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
        event.target.style.display = "none";
    }
};

function closeDetails() {
    const modal = document.getElementById('detailsModal');
    if (modal) modal.style.display = 'none';
}
