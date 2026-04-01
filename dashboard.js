// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app-system.onrender.com/api";

let userRole = null;
let currentUser = JSON.parse(localStorage.getItem('user'));

// --- 0. FORCE HIDE LOADER (Safety Timer) ---
// If the page is still "loading" after 3 seconds, force it to show the form.
setTimeout(() => {
    const loader = document.getElementById('loadingScreen') || 
                   document.querySelector('.loader-wrapper') || 
                   document.querySelector('.spinner');
    if (loader) {
        console.log("Safety timer triggered: Hiding loader manually.");
        loader.style.display = 'none';
    }
}, 3000);

// --- 1. INITIALIZE PAGE ---
window.onload = () => {
    console.log("Current User in Storage:", currentUser);

    if (!currentUser) {
        window.location.href = "index.html";
        return;
    }

    // Pre-fill name from registration
    const nameInput = document.getElementById('fullName');
    if (nameInput) {
        nameInput.value = currentUser.full_name || currentUser.name || "";
    }
    
    // Redirect if they already finished setup
    if(currentUser.role && currentUser.role.toLowerCase() !== 'pending') {
        window.location.href = "home.html";
        return;
    }

    // Hide loader immediately if everything is okay
    const loader = document.getElementById('loadingScreen') || document.querySelector('.loader-wrapper');
    if (loader) loader.style.display = 'none';
};

// --- 2. ROLE SELECTION LOGIC ---
const tenantBox = document.getElementById('roleTenant');
const landlordBox = document.getElementById('roleLandlord');

if (tenantBox && landlordBox) {
    tenantBox.onclick = () => setRole('tenant');
    landlordBox.onclick = () => setRole('landlord');
}

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

    const profileData = {
        full_name: document.getElementById('fullName').value,
        address: document.getElementById('address').value,
        contact: document.getElementById('contact').value,
        role: userRole,
        email: currentUser.email 
    };

    try {
        const response = await fetch(`${API_BASE}/update-profile`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            currentUser.role = userRole;
            currentUser.full_name = profileData.full_name;
            currentUser.address = profileData.address;
            currentUser.contact = profileData.contact;
            
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
            throw new Error(result.message || "Failed to update profile.");
        }
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = 'Complete Setup';
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
