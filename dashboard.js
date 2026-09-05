// REPLACE THIS with your Render URL
const API_BASE = "https://stayfind-app-system.onrender.com/api";

let userRole = null;
let currentUser = JSON.parse(localStorage.getItem('user'));

// --- 0. IMMEDIATE HIDE FUNCTION ---
function hideLoader() {
    const loader = document.getElementById('loader'); // Matches your HTML ID
    if (loader) {
        loader.style.display = 'none';
        console.log("Loader hidden successfully.");
    }
}

// Safety fallback: If window.onload takes too long, hide it after 2 seconds
setTimeout(hideLoader, 2000);

// NEW: shared image-compression helper (same approach used in home.js) so
// landlord verification documents get compressed to base64 before upload,
// instead of sending huge raw photo files.
function compressImageFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 1000; // slightly higher res than listing photos, docs need to stay legible
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.75));
            };
        };
    });
}

// --- 1. INITIALIZE PAGE ---
window.onload = () => {
    console.log("Dashboard Loaded. User:", currentUser);

    // FIXED: Ensure we have a user object before trying to read properties
    if (!currentUser || !currentUser.email) {
        console.error("No valid user session found. Redirecting...");
        window.location.href = "index.html";
        return;
    }

    // Pre-fill name from registration (Matches full_name in DB)
    const nameInput = document.getElementById('fullName');
    if (nameInput) {
        // Fallback to name or empty string if full_name isn't set yet
        nameInput.value = currentUser.full_name || currentUser.name || "";
    }
    
    // Redirect if they already finished setup (Case-insensitive check)
    if(currentUser.role && currentUser.role.toLowerCase() !== 'pending') {
        window.location.href = "home.html";
        return;
    }

    // Success! Hide the loader now
    hideLoader();
};

// --- 2. ROLE SELECTION LOGIC ---
const tenantBox = document.getElementById('roleTenant');
const landlordBox = document.getElementById('roleLandlord');
// NEW: reference to the document-upload section, toggled by role selection
const landlordDocsSection = document.getElementById('landlordDocsSection');

if (tenantBox && landlordBox) {
    tenantBox.onclick = () => setRole('tenant');
    landlordBox.onclick = () => setRole('landlord');
}

function setRole(role) {
    userRole = role;
    tenantBox.classList.remove('active');
    landlordBox.classList.remove('active');
    
    if (role === 'tenant') {
        tenantBox.classList.add('active');
        // NEW: hide + clear the doc upload section when switching back to tenant
        if (landlordDocsSection) landlordDocsSection.style.display = 'none';
    } else {
        landlordBox.classList.add('active');
        // NEW: reveal the doc upload section — these are required to submit
        // a landlord request for admin review.
        if (landlordDocsSection) landlordDocsSection.style.display = 'block';
    }
}

// --- 3. SAVE PROFILE TO DATABASE ---
document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!userRole) {
        return Swal.fire('Wait!', 'Please select if you are a Tenant or Landlord', 'warning');
    }

    // UPDATED: Require all 4 verification items before allowing a landlord
    // request to be submitted at all — the 3 original documents PLUS:
    //   - docSelfie: a selfie holding a valid government ID
    //   - docOwnerName: the name typed as printed on the Proof of Ownership
    //     document, used by the admin panel for a name cross-check against
    //     the user's registered full_name.
    // This is a frontend convenience check — the backend also enforces this,
    // so this can't be bypassed even if someone calls the API directly.
    let docOwnershipFile = null, docPermitsFile = null, docBirFile = null, docSelfieFile = null;
    let docOwnerName = "";
    if (userRole === 'landlord') {
        docOwnershipFile = document.getElementById('docOwnership').files[0];
        docPermitsFile = document.getElementById('docPermits').files[0];
        docBirFile = document.getElementById('docBir').files[0];
        docSelfieFile = document.getElementById('docSelfie').files[0]; // NEW
        docOwnerName = document.getElementById('docOwnerName').value.trim(); // NEW

        if (!docOwnershipFile || !docPermitsFile || !docBirFile || !docSelfieFile) {
            return Swal.fire('Missing Documents', 'Please upload all 4 required items: Proof of Ownership, Local Permits, BIR Registration, and a Selfie with valid ID.', 'warning');
        }
        if (!docOwnerName) {
            return Swal.fire('Missing Info', 'Please type the name shown on your Proof of Ownership document.', 'warning');
        }
    }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    // UPDATED: compress and attach all 4 landlord documents (if applicable).
    // Order matters here — it must match the labels array used by
    // admin.js's viewLandlordDocs(): Ownership, Permits, BIR, Selfie.
    let landlordDocuments = null;
    if (userRole === 'landlord') {
        try {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading documents...';
            const compressed = await Promise.all([
                compressImageFile(docOwnershipFile),
                compressImageFile(docPermitsFile),
                compressImageFile(docBirFile),
                compressImageFile(docSelfieFile) // NEW
            ]);
            landlordDocuments = compressed.join('|||');
        } catch (e) {
            console.error("Document conversion error:", e);
            btn.disabled = false;
            btn.innerHTML = 'Complete Setup';
            return Swal.fire('Error', 'Failed to process your documents. Please try again with different images.', 'error');
        }
    }

    const profileData = {
        full_name: document.getElementById('fullName').value.trim(),
        address: document.getElementById('address').value.trim(),
        contact: document.getElementById('contact').value.trim(),
        role: userRole,
        email: currentUser.email,
        // NEW: only included when requesting landlord status
        landlord_documents: landlordDocuments,
        // NEW: the applicant's self-typed "name on document", used by the
        // admin panel's name cross-check against the registered full_name
        landlord_doc_name: userRole === 'landlord' ? docOwnerName : null
    };

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
        const response = await fetch(`${API_BASE}/update-profile`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // UPDATED: Landlord approval gate. The server now tells us the
            // REAL role/landlord_status it applied, since picking "Landlord"
            // no longer instantly grants the role — it may come back as
            // role: 'tenant', landlord_status: 'pending' instead. We trust
            // the server's response rather than assuming userRole was granted.
            currentUser.role = result.role || userRole;
            currentUser.landlord_status = result.landlord_status;
            currentUser.full_name = profileData.full_name;
            currentUser.address = profileData.address;
            currentUser.contact = profileData.contact;
            
            localStorage.setItem('user', JSON.stringify(currentUser));

            // NEW: Different success message depending on whether the
            // landlord request is pending admin approval or the profile
            // was just completed normally (tenant, or already-approved landlord).
            const isPendingLandlord = (userRole === 'landlord' && currentUser.role !== 'landlord');

            Swal.fire({
                icon: 'success',
                title: isPendingLandlord ? 'Request Submitted!' : 'Profile Completed!',
                text: isPendingLandlord 
                    ? (result.message || 'Your landlord request and documents are waiting for admin approval. You can browse as a tenant in the meantime.')
                    : ('Welcome to StayFind, ' + profileData.full_name + '!'),
                timer: 2500,
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
    logoutBtn.onclick = (e) => {
        e.preventDefault();
        localStorage.clear(); // Use clear to ensure all old session data is gone
        window.location.href = "index.html";
    };
}
