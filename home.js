// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app.onrender.com/api";

const currentUser = JSON.parse(localStorage.getItem('user'));
const listingsGrid = document.getElementById('listingsGrid');

// --- 1. SECURITY & ROLE CHECK ---
window.onload = () => {
    if (!currentUser) {
        window.location.href = "index.html";
        return;
    }

    // Show "Post" button only if user is a landlord
    if (currentUser.role === 'landlord') {
        document.getElementById('postBtn').style.display = 'inline-block';
    }

    loadListings();
};

// --- 2. FETCH LISTINGS FROM MYSQL ---
async function loadListings() {
    listingsGrid.innerHTML = "<p style='text-align:center;'>Loading stays...</p>";
    
    try {
        const response = await fetch(`${API_BASE}/view`);
        const data = await response.json();

        if (data.length === 0) {
            listingsGrid.innerHTML = "<p style='text-align:center;'>No listings available yet.</p>";
            return;
        }

        renderListings(data);
    } catch (error) {
        console.error("Error fetching listings:", error);
        listingsGrid.innerHTML = "<p style='text-align:center; color:red;'>Failed to load listings.</p>";
    }
}

// --- 3. RENDER HTML CARDS ---
function renderListings(items) {
    listingsGrid.innerHTML = "";
    items.forEach(item => {
        // Note: Using 'item.title' or 'item.full_name' depending on your MySQL columns
        listingsGrid.innerHTML += `
            <div class="listing-card">
                <img src="${item.image_url || 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=500'}" class="listing-img">
                <div class="listing-info">
                    <div class="price">₱${Number(item.price || 0).toLocaleString()} /mo</div>
                    <div style="font-weight:bold; margin-top:5px; color:#333;">${item.title || 'Cozy Room'}</div>
                    <div class="location"><i class="fas fa-map-marker-alt"></i> ${item.location || 'Unknown'}</div>
                    <div class="details">
                        <span><i class="fas fa-bed"></i> Available</span>
                    </div>
                </div>
            </div>
        `;
    });
}

// --- 4. LOGOUT ---
document.getElementById('logoutLink').onclick = () => {
    localStorage.removeItem('user');
    window.location.href = "index.html";
};

// --- 5. SEARCH FILTER LOGIC ---
document.getElementById('searchLoc').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.listing-card');
    
    cards.forEach(card => {
        const location = card.querySelector('.location').innerText.toLowerCase();
        card.style.display = location.includes(term) ? "block" : "none";
    });
});
