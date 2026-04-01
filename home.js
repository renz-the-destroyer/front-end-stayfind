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

// --- 3. RENDER HTML CARDS ---
function renderListings(items) {
    listingsGrid.innerHTML = ""; 
    
    items.forEach(item => {
        if (!item.title && !item.price) return;

        const displayImage = item.images || 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500';
        
        listingsGrid.innerHTML += `
            <div class="listing-card" data-price="${item.price || 0}" data-rooms="${item.rooms || 0}">
                <img src="${displayImage}" class="listing-img" alt="${item.title || 'Listing'}">
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

// --- 7. POST LISTING LOGIC ---
function setupPostListingLogic() {
    const postModal = document.getElementById('postModal');
    const postBtn = document.getElementById('postBtn');
    const submitPostBtn = document.getElementById('submitPostBtn');

    if (!postBtn || !postModal) return;

    postBtn.onclick = (e) => {
        e.preventDefault();
        postModal.style.display = 'block';
    };

    submitPostBtn.onclick = async () => {
        const listingData = {
            title: document.getElementById('postTitle').value,
            price: document.getElementById('postPrice').value,
            location: document.getElementById('postLocation').value,
            rooms: document.getElementById('postRooms').value,
            size: document.getElementById('postSize').value,
            landlord_email: currentUser.email
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

// Global modal close logic
window.onclick = (event) => {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
};
