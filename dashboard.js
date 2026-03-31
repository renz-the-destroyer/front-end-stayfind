// REPLACE THIS with your Render URL
const API_BASE = "https://your-render-app-name.onrender.com/api";

let userRole = null;
let currentUser = JSON.parse(localStorage.getItem('user'));

// --- 1. INITIALIZE PAGE ---
window.onload = () => {
    if (!currentUser) {
        window.location.href = "index.html";
        return;
    }

    // Pre-fill name from registration
    document.getElementById('fullName').value = currentUser.name || "";
    document.getElementById('loader').style.display = 'none';
    
    // Redirect if they already finished setup
    if(currentUser.role && currentUser.role !== 'pending') {
        window.location.href = "home.html";
    }
};

// --- 2. ROLE SELECTION LOGIC ---
const tenantBox = document.getElementById('roleTenant');
const landlordBox = document.getElementById('roleLandlord');

tenantBox.addEventListener('click', () => setRole('tenant'));
landlordBox.addEventListener('click', () => setRole('landlord'));

function setRole(role) {
    userRole = role;
    tenantBox.classList.remove('active');
    landlordBox.classList.remove('active');
    
    if (role === 'tenant') tenantBox.classList.add('active');
    else landlordBox.classList.add('active');
}

// --- 3. SAVE PROFILE TO DATABASE ---
document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!userRole) {
        return Swal.fire('Wait!', 'Please select if you are a Tenant or Landlord', 'warning');
    }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    // In your Node backend, you likely use 'update' route. 
    // We need to send the ID or Email to find the right record.
    const profileData = {
        name: document.getElementById('fullName').value,
        address: document.getElementById('address').value,
        contact: document.getElementById('contact').value,
        role: userRole,
        email: currentUser.email // Using email to identify the user in the database
    };

    try {
        // This calls your Node.js backend /api/update
        const response = await fetch(`${API_BASE}/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });

        if (response.ok) {
            // Update the user data in browser memory
            currentUser.role = userRole;
            currentUser.name = profileData.name;
            localStorage.setItem('user', JSON.stringify(currentUser));

            Swal.fire({
                icon: 'success',
                title: 'Profile Completed!',
                text: 'Welcome to StayFind, ' + profileData.name + '!',
                timer: 2000,
                showConfirmButton: false
            }).then(() => {
                window.location.href = "home.html";
            });
        } else {
            throw new Error("Failed to update profile. Try again.");
        }
    } catch (err) {
        btn.disabled = false;
        btn.innerText = "Complete Setup";
        Swal.fire('Error', err.message, 'error');
    }
});

// --- 4. LOGOUT ---
document.getElementById('logoutBtn').onclick = () => {
    localStorage.removeItem('user');
    window.location.href = "index.html";
};