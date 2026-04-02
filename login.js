// Initialize EmailJS with your User ID
emailjs.init("Y7oJ_Er1PJ59eTUfI"); 

// FIXED: Added /api to the base URL to match your server.js prefix
const API_BASE = "https://stayfind-app-system.onrender.com/api";

let generatedOtp = null;
let signUpData = {}; 

// --- UI Logic: Toggling between Login and Register ---
const container = document.getElementById('container');
document.getElementById('signUp').addEventListener('click', () => container.classList.add("right-panel-active"));
document.getElementById('signIn').addEventListener('click', () => container.classList.remove("right-panel-active"));
document.getElementById('mobileSignUp').addEventListener('click', (e) => { e.preventDefault(); container.classList.add("right-panel-active"); });
document.getElementById('mobileSignIn').addEventListener('click', (e) => { e.preventDefault(); container.classList.remove("right-panel-active"); });

// --- Password Visibility Toggle ---
document.querySelectorAll('.toggle-password').forEach(icon => {
    icon.addEventListener('click', () => {
        const input = document.getElementById(icon.getAttribute('data-target'));
        input.type = input.type === 'password' ? 'text' : 'password';
        icon.classList.toggle('fa-eye');
        icon.classList.toggle('fa-eye-slash');
    });
});

// --- 1. SIGN UP: Handle Form and Send OTP ---
document.getElementById('signUpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('signUpBtn');
    
    signUpData = {
        full_name: document.getElementById('regName').value.trim(),
        email: document.getElementById('regEmail').value.trim().toLowerCase(),
        password: document.getElementById('regPassword').value,
        role: 'pending' 
    };

    if (signUpData.password.length < 8) {
        return Swal.fire('Wait!', 'Password must be at least 8 characters.', 'warning');
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Sending OTP...';
    
    generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    
    const templateParams = {
        email: signUpData.email,
        passcode: generatedOtp,
        time: "15 minutes"
    };

    emailjs.send('service_3hidsqf', 'template_cegi0tu', templateParams)
        .then(() => {
            btn.disabled = false;
            btn.innerText = "Sign Up";
            document.getElementById('displayEmail').innerText = signUpData.email;
            document.getElementById('otpModal').style.display = 'flex';
            Swal.fire('OTP Sent!', 'Check your email for your code.', 'success');
        }, (error) => {
            btn.disabled = false;
            btn.innerText = "Sign Up";
            Swal.fire('Error', 'Failed to send OTP. Please check your internet.', 'error');
        });
});

// --- 2. VERIFY OTP: Save User to MySQL via Node.js ---
document.getElementById('verifyOtpBtn').addEventListener('click', async () => {
    const userOtp = document.getElementById('otpInput').value;
    const btn = document.getElementById('verifyOtpBtn');

    if (userOtp === generatedOtp) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div> Saving Account...';

        try {
            const response = await fetch(`${API_BASE}/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(signUpData)
            });
            
            const result = await response.json();

            if (response.ok) {
                localStorage.clear();
                
                // --- ENHANCED ID CAPTURE ---
                let finalUserId = result.id || result.userId || result.insertId;

                // FALLBACK: If the server didn't return the ID in the result, 
                // we fetch the user list to find the ID of the email we just registered.
                if (!finalUserId) {
                    const userFetch = await fetch(`${API_BASE}/users`);
                    const allUsers = await userFetch.json();
                    const justCreated = allUsers.find(u => u.email.toLowerCase() === signUpData.email.toLowerCase());
                    if (justCreated) finalUserId = justCreated.id;
                }
                
                const userToSave = {
                    ...signUpData,
                    id: finalUserId // Now we are 99% sure we have an ID
                };

                // Remove password for security
                delete userToSave.password;

                localStorage.setItem('user', JSON.stringify(userToSave));
                
                Swal.fire('Success!', 'Account created successfully.', 'success').then(() => {
                    window.location.href = "dashboard.html";
                });
            } else {
                throw new Error(result.error || "Could not register account");
            }
        } catch (error) {
            btn.disabled = false;
            btn.innerText = "Verify & Create Account";
            console.error("Signup Error:", error);
            Swal.fire('Database Error', error.message, 'error');
        }
    } else {
        Swal.fire('Invalid OTP', 'The code you entered is incorrect.', 'error');
    }
});

// --- 3. SIGN IN: Authenticate via Node.js ---
document.getElementById('signInForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('signInBtn');
    
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value.trim();

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Signing in...';

    try {
        const response = await fetch(`${API_BASE}/users?t=${Date.now()}`);
        
        if (!response.ok) throw new Error("Server reached but returned an error.");
        
        const users = await response.json();
        
        const user = users.find(u => 
            u.email.toLowerCase().trim() === email && 
            u.password.toString().trim() === password
        );

        if (user) {
            localStorage.clear(); 
            localStorage.setItem('user', JSON.stringify(user));
            
            if (user.role && user.role.toLowerCase() === 'pending') {
                window.location.href = "dashboard.html";
            } else {
                window.location.href = "home.html";
            }
        } else {
            throw new Error("Invalid email or password.");
        }
    } catch (error) {
        btn.disabled = false;
        btn.innerText = "Sign In";
        console.error("Login Error:", error);
        Swal.fire('Login Failed', error.message, 'error');
    }
});
