// Initialize EmailJS with your User ID
emailjs.init("Y7oJ_Er1PJ59eTUfI"); 

// REPLACE THIS with your Render URL (e.g., https://stayfind-api.onrender.com/api)
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
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value,
        role: 'pending' 
    };

    if (signUpData.password.length < 8) {
        return Swal.fire('Wait!', 'Password must be at least 8 characters.', 'warning');
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Sending OTP...';
    
    // Generate a random 6-digit OTP
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
                // Store user locally for the session
                localStorage.setItem('user', JSON.stringify(signUpData));
                Swal.fire('Success!', 'Account created successfully.', 'success').then(() => {
                    window.location.href = "dashboard.html";
                });
            } else {
                throw new Error(result.error || "Could not register account");
            }
        } catch (error) {
            btn.disabled = false;
            btn.innerText = "Verify & Create Account";
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
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Signing in...';

    try {
        const response = await fetch(`${API_BASE}/view`);
        const users = await response.json();
        
        // Find user by email and password in the database
        const user = users.find(u => u.email === email && u.password === password);

        if (user) {
            localStorage.setItem('user', JSON.stringify(user));
            // Redirect based on whether they are a new user or already set up
            window.location.href = (user.role === 'pending') ? "dashboard.html" : "home.html";
        } else {
            throw new Error("Invalid email or password.");
        }
    } catch (error) {
        btn.disabled = false;
        btn.innerText = "Sign In";
        Swal.fire('Login Failed', error.message, 'error');
    }
});
