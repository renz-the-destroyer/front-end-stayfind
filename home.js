// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app-system.onrender.com/api";

const currentUser = JSON.parse(localStorage.getItem('user'));
const listingsGrid = document.getElementById('listingsGrid');

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
};

// --- 2. FETCH LISTINGS FROM MYSQL ---
async function loadListings() {
    if (!listingsGrid) return;
    
    listingsGrid.innerHTML = "<p style='text-align:center; grid-column: 1/-1;'>Loading stays...</p>";
    
    try {
        // Pointed to /view which now calls getAllListings in the backend
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

// --- 3. RENDER HTML CARDS ---
function renderListings(items) {
    listingsGrid.innerHTML = ""; 
    
    const savedListings = JSON.parse(localStorage.getItem('bookmarks')) || [];
    
    items.forEach(item => {
        // Validation to ensure it's a listing and not a user object
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
        card.innerHTML = `
            <div class="save-btn ${isSaved ? 'active' : ''}" onclick="toggleBookmark(event, ${item.id})">
                <i class="fas fa-heart"></i>
            </div>
            ${carouselHTML}
            <div class="listing-info">
                <div class="price">₱${Number(item.price || 0).toLocaleString()} /mo</div>
                <div class="title-text" style="font-weight:bold; margin-top:5px; color:#333;">${item.title || 'Cozy Room'}</div>
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

// --- 3.1 CAROUSEL MOVEMENT LOGIC ---
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

// --- 4. LOGOUT ---
const logoutLink = document.getElementById('logoutLink');
if (logoutLink) {
    logoutLink.onclick = (e) => {
        e.preventDefault();
        localStorage.removeItem('user');
        window.location.href = "index.html";
    };
}

// --- 5. SMART SEARCH & FILTERS ---
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

// --- 6. SETTINGS MODAL LOGIC ---
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
            full_name: document.getElementById('editName').value,
            address: document.getElementById('editAddress').value,
            contact: document.getElementById('editContact').value,
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
                Object.assign(currentUser, updatedData);
                localStorage.setItem('user', JSON.stringify(currentUser));

                Swal.fire({
                    title: 'Success!',
                    text: 'Profile updated successfully.',
                    icon: 'success',
                    target: '#settingsModal'
                }).then(() => location.reload());
            } else {
                Swal.fire({ title: 'Error', text: result.message || 'Failed to update profile', icon: 'error', target: '#settingsModal' });
            }
        } catch (err) {
            Swal.fire({ title: 'Error', text: 'Server error', icon: 'error', target: '#settingsModal' });
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
        }
    };
}

// --- 7. POST LISTING LOGIC ---
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
            // FIXED: Target /add-listing to match index.js update
            const response = await fetch(`${API_BASE}/add-listing`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(listingData)
            });

            if (response.ok) {
                Swal.fire({ title: 'Success!', text: 'Listing published.', icon: 'success', target: '#postModal' })
                .then(() => location.reload());
            } else {
                const errResult = await response.json().catch(() => ({ message: "Submission Failed" }));
                console.error("Server Error Response:", errResult);
                Swal.fire({ title: 'Error', text: errResult.message || 'Failed to post', icon: 'error', target: '#postModal' });
            }
        } catch (err) {
            console.error("Network Error:", err);
            Swal.fire({ title: 'Error', text: 'Could not connect to server', icon: 'error', target: '#postModal' });
        } finally {
            submitPostBtn.disabled = false;
            submitPostBtn.innerText = "Publish Listing";
        }
    };
}

// --- 8. BOOKMARK SYSTEM ---
function toggleBookmark(event, listingId) {
    event.stopPropagation();
    let saved = JSON.parse(localStorage.getItem('bookmarks')) || [];
    const iconWrapper = event.currentTarget;
    
    if (saved.includes(listingId)) {
        saved = saved.filter(id => id !== listingId);
        iconWrapper.classList.remove('active');
    } else {
        saved.push(listingId);
        iconWrapper.classList.add('active');
        
        const Toast = Swal.mixin({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true
        });
        Toast.fire({ icon: 'success', title: 'Added to bookmarks' });
    }
    localStorage.setItem('bookmarks', JSON.stringify(saved));
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

window.onclick = (event) => {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
};
