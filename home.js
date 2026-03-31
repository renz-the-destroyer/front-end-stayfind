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
};

// --- 2. FETCH LISTINGS FROM MYSQL ---
async function loadListings() {
    if (!listingsGrid) return;
    
    listingsGrid.innerHTML = "<p style='text-align:center;'>Loading stays...</p>";
    
    try {
        const response = await fetch(`${API_BASE}/view`);
        const data = await response.json();

        if (!data || data.length === 0) {
            listingsGrid.innerHTML = "<p style='text-align:center;'>No listings available yet.</p>";
            return;
        }

        renderListings(data);
    } catch (error) {
        console.error("Error fetching listings:", error);
        listingsGrid.innerHTML = "<p style='text-align:center; color:red;'>Failed to load listings. Check if backend is Live.</p>";
    }
}

// --- 3. RENDER HTML CARDS (MATCHED TO CLEVER CLOUD COLUMNS) ---
function renderListings(items) {
    listingsGrid.innerHTML = "";
    items.forEach(item => {
        // FIXED: Using item.images to match your DB column 'images'
        // FIXED: Using item.price, item.title, item.location, item.rooms, and item.size
        const displayImage = item.images || 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500';
        
        listingsGrid.innerHTML += `
            <div class="listing-card">
                <img src="${displayImage}" class="listing-img" alt="${item.title || 'Listing'}">
                <div class="listing-info">
                    <div class="price">₱${Number(item.price || 0).toLocaleString()} /mo</div>
                    <div style="font-weight:bold; margin-top:5px; color:#333;">${item.title || 'Cozy Room'}</div>
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

// --- 5. SEARCH FILTER LOGIC ---
const searchInput = document.getElementById('searchLoc');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.listing-card');
        
        cards.forEach(card => {
            const locationText = card.querySelector('.location').innerText.toLowerCase();
            const titleText = card.querySelector('div[style*="font-weight:bold"]').innerText.toLowerCase();
            
            // Search works for both Location and Title
            if (locationText.includes(term) || titleText.includes(term)) {
                card.style.display = "block";
            } else {
                card.style.display = "none";
            }
        });
    });
}
