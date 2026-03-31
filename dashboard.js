// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app-system.onrender.com/api";

let userRole = null;
let currentUser = JSON.parse(localStorage.getItem('user'));

// --- 1. INITIALIZE PAGE ---
window.onload = () => {
    if (!currentUser) {
        window.location.href = "index.html";
        return;
    }

    // Pre-fill name from registration (Matches full_name in DB)
    document.getElementById('fullName').value = currentUser.full_name || currentUser.name || "";
    
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    
    // Redirect if they already finished setup
    if(currentUser.role && currentUser.role !== 'pending') {
        window.location.href = "home.html";
    }
};

// --- 2. ROLE SELECTION LOGIC ---
const tenantBox = document.getElementById('roleTenant');
const landlordBox = document.getElementById('roleLandlord');

if (tenantBox && landlordBox) {
    tenantBox.addEventListener('click', () => setRole('tenant'));
    landlordBox.addEventListener('click', () => setRole('landlord'));
}

function setRole(role) {
    userRole = role;
    tenantBox.classList.remove('active');
    landlordBox.classList.remove('active');
    
    if (role === 'tenant') tenantBox.classList.add('active');
    else landlordBox.classList.add('active');
}

// --- 3. SAVE PROFILE TO DATABASE (FIXED) ---
document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!userRole) {
        return Swal.fire('Wait!', 'Please select if you are a Tenant or Landlord', 'warning');
    }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    // Data package sent to backend
    const profileData = {
        full_name: document.getElementById('fullName').value, // FIXED: Matches backend controller
        address: document.getElementById('address').value,
        contact: document.getElementById('contact').value,
        role: userRole,
        email: currentUser.email // Key used to find the user in DB
    };

    try {
        // FIXED: Endpoint changed to /update-profile to match your router
        const response = await fetch(`${API_BASE}/update-profile`, {
            method: 'POST', // Matches router.post in index.js
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // Update the user data in browser memory so home.html knows the role
            currentUser.role = userRole;
            currentUser.full_name = profileData.full_name;
            localStorage.setItem('user', JSON.stringify(currentUser));

            Swal.fire({
                icon: 'success',
                title: 'Profile Completed!',
                text: 'Welcome to StayFind, ' + profileData.full_name + '!',
                timer: 2000,
                showConfirmButton: false
            }).then(() => {
                window.location.href = "home.html";
            });
        } else {
            throw new Error(result.message || "Failed to update profile. Try again.");
        }
    } catch (err) {
        btn.disabled = false;
        btn.innerText = "Complete Setup";
        Swal.fire('Error', err.message, 'error');
    }
});

// --- 4. LOGOUT ---
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.onclick = () => {
        localStorage.removeItem('user');
        window.location.href = "index.html";
    };
}
