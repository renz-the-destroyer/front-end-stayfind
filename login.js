// Initialize EmailJS with your User ID
emailjs.init("Y7oJ_Er1PJ59eTUfI"); 

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
            
            const result = await response.json().catch(() => ({}));

            if (response.ok) {
                localStorage.clear();

                // The server returns the new user's id. (The old fallback that
                // downloaded the whole users table to find it is gone - that
                // endpoint no longer exists.)
                const finalUserId = result.id || result.userId || result.insertId;
                if (!finalUserId) {
                    throw new Error("Account created, but we couldn't start your session. Please sign in.");
                }

                const userToSave = {
                    ...signUpData,
                    id: finalUserId
                };

                // Never keep the password in the browser
                delete userToSave.password;

                localStorage.setItem('user', JSON.stringify(userToSave));
                if (result.token) localStorage.setItem('token', result.token);
                
                Swal.fire('Success!', 'Account created successfully.', 'success').then(() => {
                    window.location.href = "dashboard.html";
                });
            } else {
                throw new Error(result.message || result.error || "Could not register account");
            }
        } catch (error) {
            btn.disabled = false;
            btn.innerText = "Verify & Create Account";
            console.error("Signup Error:", error);
            Swal.fire('Sign Up Failed', error.message, 'error');
        }
    } else {
        Swal.fire('Invalid OTP', 'The code you entered is incorrect.', 'error');
    }
});

// --- 3. SIGN IN: the SERVER checks the password now ---
document.getElementById('signInForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('signInBtn');
    
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        return Swal.fire('Missing Info', 'Please enter your email and password.', 'warning');
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Signing in...';

    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            throw new Error(result.message || "Invalid email or password.");
        }

        const user = result.user; // already has no password / documents
        localStorage.clear(); 
        localStorage.setItem('user', JSON.stringify(user));
        if (result.token) localStorage.setItem('token', result.token);
        
        if (user.role && user.role.toLowerCase() === 'pending') {
            window.location.href = "dashboard.html";
        } else {
            window.location.href = "home.html";
        }
    } catch (error) {
        btn.disabled = false;
        btn.innerText = "Sign In";
        console.error("Login Error:", error);
        Swal.fire('Login Failed', error.message, 'error');
    }
});
