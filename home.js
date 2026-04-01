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

    // Show "Post" button only if user is a landlord
    const postBtn = document.getElementById('postBtn');
    if (postBtn && currentUser.role === 'landlord') {
        postBtn.style.display = 'inline-block';
    }

    // Optional: Greet the user using their full_name
    console.log("Welcome back, " + (currentUser.full_name || currentUser.name));

    loadListings();
    setupSettingsLogic(); // Initialize settings features
    setupPostListingLogic(); // Initialize post listing features
    setupBookmarkToggles(); // Initialize the Browse/Saved view toggles
};

// --- 2. FETCH LISTINGS FROM MYSQL ---
async function loadListings() {
    if (!listingsGrid) return;
    
    listingsGrid.innerHTML = "<p style='text-align:center;'>Loading stays...</p>";
    
    try {
        const response = await fetch(`${API_BASE}/view`);
        const data = await response.json();

        if (!data || data.length === 0 || (data.length === 1 && !data[0].title)) {
            listingsGrid.innerHTML = "<p style='text-align:center;'>No listings available yet.</p>";
            return;
        }

        renderListings(data);
    } catch (error) {
        console.error("Error fetching listings:", error);
        listingsGrid.innerHTML = "<p style='text-align:center; color:red;'>Failed to load listings. Check if backend is Live.</p>";
    }
}

// --- 3. RENDER HTML CARDS (UPDATED WITH CAROUSEL & BOOKMARKS) ---
function renderListings(items) {
    listingsGrid.innerHTML = ""; 
    
    const savedListings = JSON.parse(localStorage.getItem('bookmarks')) || [];
    
    items.forEach(item => {
        if (!item.title && !item.price) return;

        const isSaved = savedListings.includes(item.id);
        
        // Handle images: Split by comma if multiple images exist
        const imgArray = item.images ? item.images.split(',') : ['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500'];
        
        // Generate Carousel HTML
        let carouselHTML = `
            <div class="carousel-container" id="carousel-${item.id}">
                <div class="carousel-track" style="transform: translateX(0px);">
                    ${imgArray.map(img => `<img src="${img.trim()}" class="carousel-img">`).join('')}
                </div>
                ${imgArray.length > 1 ? `
                    <button class="carousel-btn prev-btn" onclick="moveCarousel(event, ${item.id}, -1)"><i class="fas fa-chevron-left"></i></button>
                    <button class="carousel-btn next-btn" onclick="moveCarousel(event, ${item.id}, 1)"><i class="fas fa-chevron-right"></i></button>
                ` : ''}
            </div>
        `;
        
        listingsGrid.innerHTML += `
            <div class="listing-card" data-id="${item.id}" data-price="${item.price || 0}" data-rooms="${item.rooms || 0}">
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
            </div>
        `;
    });
}

// --- 3.1 CAROUSEL MOVEMENT LOGIC ---
function moveCarousel(event, id, direction) {
    event.stopPropagation(); // Stop card click
    const container = document.getElementById(`carousel-${id}`);
    const track = container.querySelector('.carousel-track');
    const images = track.querySelectorAll('img');
    const imgWidth = container.offsetWidth;
    
    // Calculate current index based on transform value
    let currentTransform = track.style.transform.replace('translateX(', '').replace('px)', '') || 0;
    let currentIdx = Math.abs(Math.round(parseInt(currentTransform) / imgWidth));
    
    let newIdx = currentIdx + direction;
    
    // Infinite loop logic
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

// --- 5. SMART SEARCH & FILTERS LOGIC ---
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

        if (matchesMainSearch && matchesPrice && matchesRooms && matchesSpecificLoc) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }
    });
}

function resetFilters() {
    document.getElementById('searchLoc').value = "";
    document.getElementById('maxPrice').value = "Infinity";
    document.getElementById('roomFilter').value = "all";
    document.getElementById('locFilter').value = "";
    filterListings();
    
    const viewAllBtn = document.getElementById('viewAllBtn');
    const viewSavedBtn = document.getElementById('viewSavedBtn');
    if(viewAllBtn) viewAllBtn.classList.add('nav-active');
    if(viewSavedBtn) viewSavedBtn.classList.remove('nav-active');
}

// Event listeners for real-time filtering
document.getElementById('searchLoc').addEventListener('input', filterListings);
document.getElementById('maxPrice').addEventListener('change', filterListings);
document.getElementById('roomFilter').addEventListener('change', filterListings);
document.getElementById('locFilter').addEventListener('input', filterListings);


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

            if (response.ok && result.success) {
                Object.assign(currentUser, updatedData);
                localStorage.setItem('user', JSON.stringify(currentUser));

                Swal.fire({
                    title: 'Success!',
                    text: 'Profile updated successfully.',
                    icon: 'success',
                    target: '#settingsModal'
                }).then(() => location.reload());
            } else {
                Swal.fire({ title: 'Restricted', text: result.message || 'Failed', icon: 'error', target: '#settingsModal' });
            }
        } catch (err) {
            Swal.fire({ title: 'Error', text: 'Server error', icon: 'error', target: '#settingsModal' });
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
        }
    };
}

// --- 7. POST LISTING LOGIC (WITH IMAGE UPLOAD) ---
function setupPostListingLogic() {
    const postModal = document.getElementById('postModal');
    const postBtn = document.getElementById('postBtn');
    const submitPostBtn = document.getElementById('submitPostBtn');
    const imageInput = document.getElementById('postImages');
    const previewDiv = document.getElementById('imagePreview');

    if (!postBtn || !postModal) return;

    // Image Preview Logic
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

    submitPostBtn.onclick = async () => {
        // Convert all selected images to Base64 strings
        const imageFiles = Array.from(imageInput.files);
        const toBase64 = file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });

        let base64Images = [];
        try {
            base64Images = await Promise.all(imageFiles.map(file => toBase64(file)));
        } catch (e) {
            console.error("Image conversion error", e);
        }

        const listingData = {
            title: document.getElementById('postTitle').value,
            price: document.getElementById('postPrice').value,
            location: document.getElementById('postLocation').value,
            rooms: document.getElementById('postRooms').value,
            size: document.getElementById('postSize').value,
            images: base64Images.join(','), // Store multiple images as comma-separated string
            user_id: currentUser.id
        };

        if (!listingData.title || !listingData.price) {
            Swal.fire({ title: 'Missing Info', text: 'Title and Price are required', icon: 'warning', target: '#postModal' });
            return;
        }

        submitPostBtn.disabled = true;
        submitPostBtn.innerText = "Publishing...";

        try {
            const response = await fetch(`${API_BASE}/add-listing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(listingData)
            });

            if (response.ok) {
                Swal.fire({ title: 'Success!', text: 'Listing published.', icon: 'success', target: '#postModal' })
                .then(() => location.reload());
            } else {
                Swal.fire({ title: 'Error', text: 'Failed to post', icon: 'error', target: '#postModal' });
            }
        } catch (err) {
            Swal.fire({ title: 'Error', text: 'Could not connect to server', icon: 'error', target: '#postModal' });
        } finally {
            submitPostBtn.disabled = false;
            submitPostBtn.innerText = "Publish Listing";
        }
    };
}

// --- 8. BOOKMARK SYSTEM LOGIC ---
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

        allCards.forEach(card => {
            const id = parseInt(card.getAttribute('data-id'));
            card.style.display = savedIds.includes(id) ? "block" : "none";
        });
        
        if (savedIds.length === 0) {
            listingsGrid.innerHTML = "<p style='text-align:center; grid-column: 1/-1;'>You haven't saved any listings yet.</p>";
        }
    };

    viewAllBtn.onclick = () => {
        viewAllBtn.classList.add('nav-active');
        viewSavedBtn.classList.remove('nav-active');
        loadListings();
    };
}

// Global modal close logic
window.onclick = (event) => {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
};
