// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app-system.onrender.com/api";

const currentUser = JSON.parse(localStorage.getItem('user'));
const listingsGrid = document.getElementById('listingsGrid');

// Global variable to track selected stars
let selectedRating = 0;

// --- 1. SECURITY & ROLE CHECK ---
window.onload = () => {
    if (!currentUser) {
        window.location.href = "index.html";
        return;
    }

    const postBtn = document.getElementById('postBtn');
    if (postBtn && currentUser.role === 'landlord') {
        postBtn.style.display = 'inline-block';
    }

    console.log("Welcome back, " + (currentUser.full_name || currentUser.name || "User"));

    loadListings();
    setupSettingsLogic(); 
    setupPostListingLogic(); 
    setupBookmarkToggles(); 
    setupStarRatingLogic(); // Initialize star click listeners
};

// --- 2. FETCH LISTINGS FROM MYSQL ---
async function loadListings() {
    if (!listingsGrid) return;
    
    listingsGrid.innerHTML = "<p style='text-align:center; grid-column: 1/-1;'>Loading stays...</p>";
    
    try {
        const response = await fetch(`${API_BASE}/view`);
        const data = await response.json();

        if (!data || data.length === 0) {
            listingsGrid.innerHTML = "<p style='text-align:center; grid-column: 1/-1;'>No listings available yet.</p>";
            return;
        }

        renderListings(data);
    } catch (error) {
        console.error("Error fetching listings:", error);
        listingsGrid.innerHTML = "<p style='text-align:center; color:red; grid-column: 1/-1;'>Failed to load listings. Check if backend is Live.</p>";
    }
}

// --- 3. RENDER HTML CARDS (Includes DB Bookmark Sync) ---
async function renderListings(items) {
    listingsGrid.innerHTML = ""; 
    
    let savedListings = JSON.parse(localStorage.getItem('bookmarks')) || [];
    
    // SYNC: Fetch bookmarks from DB to prevent loss on logout/refresh
    if (currentUser && currentUser.id) {
        try {
            const favRes = await fetch(`${API_BASE}/get-bookmarks/${currentUser.id}`);
            if (favRes.ok) {
                const favData = await favRes.json();
                // Map the DB results to an array of IDs
                savedListings = favData.map(item => item.listing_id);
                localStorage.setItem('bookmarks', JSON.stringify(savedListings));
            }
        } catch (err) { 
            console.log("Database bookmark sync failed, using local backup."); 
        }
    }
    
    items.forEach(item => {
        if (!item.title && !item.price) return;

        const isSaved = savedListings.includes(item.id);
        
        let imgArray = [];
        if (item.images && item.images.trim() !== "") {
            imgArray = item.images.split(',').map(img => img.trim());
        } else {
            imgArray = ['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500'];
        }
        
        let carouselHTML = `
            <div class="carousel-container" id="carousel-${item.id}">
                <div class="carousel-track" style="transform: translateX(0px);">
                    ${imgArray.map(img => `<img src="${img}" class="carousel-img" onerror="this.src='https://via.placeholder.com/400x200?text=No+Image'">`).join('')}
                </div>
                ${imgArray.length > 1 ? `
                    <button class="carousel-btn prev-btn" onclick="moveCarousel(event, ${item.id}, -1)"><i class="fas fa-chevron-left"></i></button>
                    <button class="carousel-btn next-btn" onclick="moveCarousel(event, ${item.id}, 1)"><i class="fas fa-chevron-right"></i></button>
                ` : ''}
            </div>
        `;
        
        const card = document.createElement('div');
        card.className = 'listing-card';
        card.setAttribute('data-id', item.id);
        card.setAttribute('data-price', item.price || 0);
        card.setAttribute('data-rooms', item.rooms || 0);
        
        card.onclick = () => showFullDetails(item);

        card.innerHTML = `
            <div class="save-btn ${isSaved ? 'active' : ''}" onclick="toggleBookmark(event, ${item.id})">
                <i class="fas fa-heart"></i>
            </div>
            ${carouselHTML}
            <div class="listing-info">
                <div class="price">₱${Number(item.price || 0).toLocaleString()} /mo</div>
                <div class="title-text" style="font-weight:bold; margin-top:5px; color:#333;">${item.title || 'Cozy Room'}</div>
                <div class="landlord-name" style="font-size:0.85rem; color:#007bff; margin-bottom:5px;">
                    <i class="fas fa-user-tie"></i> ${item.landlord_name || 'Owner'}
                </div>
                <div class="location"><i class="fas fa-map-marker-alt"></i> ${item.location || 'Unknown'}</div>
                <div class="details">
                    <span><i class="fas fa-bed"></i> ${item.rooms || 0} Rooms</span>
                    <span style="margin-left:10px;"><i class="fas fa-expand"></i> ${item.size || 0} sqm</span>
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

    const isOwner = currentUser && currentUser.id && item.user_id && String(currentUser.id) === String(item.user_id);

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
        // UPDATED: Added Edit Button alongside Delete Button for owners
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

// --- NEW: OPEN EDIT MODAL FUNCTION ---
function openEditModal(item) {
    const postModal = document.getElementById('postModal');
    if (!postModal) return;

    // Reuse the Post Modal but change content
    postModal.style.display = 'block';
    document.querySelector('#postModal h2').innerText = "Edit Your Listing";
    const submitBtn = document.getElementById('submitPostBtn');
    submitBtn.innerText = "Save Changes";

    // Fill form with existing data
    document.getElementById('postTitle').value = item.title;
    document.getElementById('postPrice').value = item.price;
    document.getElementById('postLocation').value = item.location;
    document.getElementById('postRooms').value = item.rooms;
    document.getElementById('postSize').value = item.size;
    if(document.getElementById('postAmenities')) document.getElementById('postAmenities').value = item.amenities || "";
    if(document.getElementById('postCategory')) document.getElementById('postCategory').value = item.category || "Apartment";

    // Update the click logic for the button
    submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        submitBtn.innerText = "Saving...";

        const updatedData = {
            listingId: item.id,
            user_id: currentUser.id,
            title: document.getElementById('postTitle').value.trim(),
            category: document.getElementById('postCategory')?.value || "Apartment",
            price: parseFloat(document.getElementById('postPrice').value) || 0,
            location: document.getElementById('postLocation').value.trim(),
            rooms: parseInt(document.getElementById('postRooms').value) || 0,
            size: parseFloat(document.getElementById('postSize').value) || 0,
            amenities: document.getElementById('postAmenities')?.value || ""
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
                Swal.fire('Error', 'Failed to update listing.', 'error');
            }
        } catch (err) {
            Swal.fire('Error', 'Server connection error.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = "Save Changes";
        }
    };
}

// --- 5. STAR RATING LOGIC ---
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

// --- 6. REVIEWS & COMMENTS ---
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
        Swal.fire({ title: 'Session Error', text: 'User ID not found. Please log out and log in again.', icon: 'error', target: '#detailsModal' });
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
        console.error("Review Error:", err);
        Swal.fire({ title: 'Error', text: 'Server connection failed.', icon: 'error', target: '#detailsModal' });
    }
}

// --- 7. DELETE LISTING ---
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
                Swal.fire('Deleted!', 'Your listing has been removed.', 'success')
                .then(() => location.reload());
            } else {
                Swal.fire('Error', 'Unauthorized or failed to delete.', 'error');
            }
        } catch (err) {
            Swal.fire('Error', 'Could not connect to server.', 'error');
        }
    }
}

// --- 8. CAROUSEL MOVEMENT ---
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

    if (!settingsBtn || !modal) return;

    settingsBtn.onclick = () => {
        document.getElementById('editName').value = currentUser.full_name || currentUser.name || "";
        document.getElementById('editAddress').value = currentUser.address || "";
        document.getElementById('editContact').value = currentUser.contact || "";
        document.getElementById('editRole').value = currentUser.role || "tenant";
        modal.style.display = 'block';
    };

    saveBtn.onclick = async () => {
        const updatedData = {
            full_name: document.getElementById('editName').value.trim(),
            address: document.getElementById('editAddress').value.trim(),
            contact: document.getElementById('editContact').value.trim(),
            role: document.getElementById('editRole').value,
            email: currentUser.email
        };

        saveBtn.disabled = true;
        saveBtn.innerText = "Updating...";

        try {
            const response = await fetch(`${API_BASE}/update-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedData)
            });

            const result = await response.json();

            if (response.ok && (result.success || result.status === 'success')) {
                const newUserObj = { ...currentUser, ...updatedData };
                localStorage.setItem('user', JSON.stringify(newUserObj));

                Swal.fire({
                    title: 'Success!',
                    text: 'Profile updated successfully.',
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
    const submitPostBtn = document.getElementById('submitPostBtn');
    const imageInput = document.getElementById('postImages');
    const previewDiv = document.getElementById('imagePreview');

    if (!postBtn || !postModal) return;

    if (imageInput) {
        imageInput.onchange = () => {
            previewDiv.innerHTML = "";
            Array.from(imageInput.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewDiv.innerHTML += `<img src="${e.target.result}" style="width:60px; height:60px; object-fit:cover; border-radius:5px; border:1px solid #ddd;">`;
                };
                reader.readAsDataURL(file);
            });
        };
    }

    postBtn.onclick = (e) => {
        e.preventDefault();
        // Reset modal to "Post Mode"
        document.querySelector('#postModal h2').innerText = "Post a Listing";
        submitPostBtn.innerText = "Publish Listing";
        postModal.style.display = 'block';
    };

    const compressImage = (file) => {
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
    };

    submitPostBtn.onclick = async () => {
        // ... (The default Logic for creating a NEW post)
        // Note: The logic for EDITING is handled separately in openEditModal()
        // but if this button is clicked when not in Edit Mode, it runs this:
        if (submitPostBtn.innerText === "Save Changes") return; 

        const imageFiles = Array.from(imageInput.files);
        
        submitPostBtn.disabled = true;
        submitPostBtn.innerText = "Processing...";

        let base64Images = [];
        try {
            base64Images = await Promise.all(imageFiles.map(file => compressImage(file)));
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
            images: base64Images.join(','), 
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
                Swal.fire({ title: 'Error', text: errResult.message || 'Failed to post', icon: 'error', target: '#postModal' });
            }
        } catch (err) {
            Swal.fire({ title: 'Error', text: 'Could not connect to server', icon: 'error', target: '#postModal' });
        } finally {
            submitPostBtn.disabled = false;
            submitPostBtn.innerText = "Publish Listing";
        }
    };
}

// --- 13. UPDATED: PERSISTENT BOOKMARK SYSTEM ---
async function toggleBookmark(event, listingId) {
    event.stopPropagation();
    let saved = JSON.parse(localStorage.getItem('bookmarks')) || [];
    const iconWrapper = event.currentTarget;
    const isAdding = !saved.includes(listingId);

    // Update UI and Local Storage immediately
    if (isAdding) {
        saved.push(listingId);
        iconWrapper.classList.add('active');
    } else {
        saved = saved.filter(id => id !== listingId);
        iconWrapper.classList.remove('active');
    }
    localStorage.setItem('bookmarks', JSON.stringify(saved));

    // SYNC WITH DATABASE (Crucial for persistence)
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
            
            if (isAdding) {
                const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
                Toast.fire({ icon: 'success', title: 'Saved to bookmarks' });
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
            listingsGrid.innerHTML = "<p id='no-saved-msg' style='text-align:center; grid-column: 1/-1;'>You haven't saved any listings yet.</p>";
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
