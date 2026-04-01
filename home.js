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
    setupSettingsLogic(); // Initialize the new settings features
};

// --- 2. FETCH LISTINGS FROM MYSQL ---
async function loadListings() {
    if (!listingsGrid) return;
    
    listingsGrid.innerHTML = "<p style='text-align:center;'>Loading stays...</p>";
    
    try {
        const response = await fetch(`${API_BASE}/view`);
        const data = await response.json();

        // Check if data is empty or just contains an empty error object
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

// --- 3. RENDER HTML CARDS (UPDATED TO PREVENT GHOST CARDS) ---
function renderListings(items) {
    // CRITICAL: Clear the grid first to prevent duplicates
    listingsGrid.innerHTML = ""; 
    
    items.forEach(item => {
        // SAFETY CHECK: Skip if item has no data (prevents "Unknown" cards)
        if (!item.title && !item.price) return;

        const displayImage = item.images || 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500';
        
        listingsGrid.innerHTML += `
            <div class="listing-card" data-price="${item.price || 0}">
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

// --- 5. SEARCH & PRICE FILTER LOGIC (SYNCED WITH HTML) ---
const searchInput = document.getElementById('searchLoc');
const priceFilter = document.getElementById('maxPrice'); // Target updated ID

function filterListings() {
    const term = searchInput ? searchInput.value.toLowerCase() : "";
    
    // Handle the "Infinity" string from the dropdown
    const filterValue = priceFilter ? priceFilter.value : "Infinity";
    const maxPrice = filterValue === "Infinity" ? Infinity : parseInt(filterValue);
    
    const cards = document.querySelectorAll('.listing-card');
    
    cards.forEach(card => {
        const locationText = card.querySelector('.location').innerText.toLowerCase();
        const titleText = card.querySelector('.title-text').innerText.toLowerCase();
        const price = parseInt(card.getAttribute('data-price'));
        
        const matchesSearch = locationText.includes(term) || titleText.includes(term);
        const matchesPrice = isNaN(maxPrice) || price <= maxPrice;

        if (matchesSearch && matchesPrice) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }
    });
}

if (searchInput) searchInput.addEventListener('input', filterListings);
if (priceFilter) priceFilter.addEventListener('change', filterListings);


// --- 6. SETTINGS MODAL LOGIC (FIXED POPUP LAYERING) ---
function setupSettingsLogic() {
    const settingsBtn = document.getElementById('settingsBtn');
    const modal = document.getElementById('settingsModal');
    const saveBtn = document.getElementById('saveSettingsBtn');

    if (!settingsBtn || !modal) return;

    // Open Modal and Pre-fill data
    settingsBtn.onclick = () => {
        document.getElementById('editName').value = currentUser.full_name || currentUser.name || "";
        document.getElementById('editAddress').value = currentUser.address || "";
        document.getElementById('editContact').value = currentUser.contact || "";
        document.getElementById('editRole').value = currentUser.role || "tenant";
        modal.style.display = 'block';
    };

    // Save Logic
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
                // Update local storage so the UI updates without relogging
                currentUser.full_name = updatedData.full_name;
                currentUser.address = updatedData.address;
                currentUser.contact = updatedData.contact;
                currentUser.role = updatedData.role;
                localStorage.setItem('user', JSON.stringify(currentUser));

                Swal.fire({
                    title: 'Success!',
                    text: 'Profile updated successfully.',
                    icon: 'success',
                    target: '#settingsModal'
                }).then(() => {
                    location.reload(); 
                });
            } else {
                Swal.fire({
                    title: 'Restricted',
                    text: result.message || 'Failed to update',
                    icon: 'error',
                    target: '#settingsModal'
                });
            }
        } catch (err) {
            Swal.fire({
                title: 'Error',
                text: 'Could not connect to server',
                icon: 'error',
                target: '#settingsModal'
            });
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Update Profile";
        }
    };

    // Close modal when clicking outside of it
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };
}
