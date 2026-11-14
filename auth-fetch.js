// auth-fetch.js - load this BEFORE home.js / dashboard.js.
//
// Wraps fetch() so every request to the StayFind API automatically carries the
// login token. If the server says the session is invalid or expired (401), the
// person is sent back to the login page.
//
// - home.html is public: a guest has no token, so a 401 there must NOT redirect
//   them. Only someone who actually HAD a token, or someone on a login-only page
//   like dashboard.html, is sent to the login page.
// - NEW: if the 401 is because an admin SUSPENDED the account, a popup explains
//   it before the redirect (it used to just redirect silently).
// - NEW: /api/admin requests are left alone. The admin panel has its own token
//   handling, and a normal user's token must not interfere with it.
(function () {
    const API_PREFIX = "https://stayfind-app-system.onrender.com/api";
    const LOGIN_URL = "index.html?auth=signin";
    const originalFetch = window.fetch.bind(window);

    const onPublicPage = /(^|\/)home\.html$/.test(window.location.pathname);
    let sessionEnding = false; // several requests can fail together: handle only once

    // Clears the session but keeps the landlord notification memory
    function clearSessionKeepNotices() {
        const keep = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('landlordSeen_')) keep[k] = localStorage.getItem(k);
        }
        localStorage.clear();
        Object.keys(keep).forEach(k => localStorage.setItem(k, keep[k]));
    }

    async function endSession(response) {
        if (sessionEnding) return;
        sessionEnding = true;

        let message = '';
        try {
            const data = await response.clone().json();
            message = String((data && data.message) || '');
        } catch (e) { /* no readable message */ }

        clearSessionKeepNotices();

        if (/suspended/i.test(message) && typeof Swal !== 'undefined') {
            await Swal.fire({
                title: 'Account suspended',
                text: 'An admin suspended your account, so you were signed out. Log in again to see the reason.',
                icon: 'error',
                confirmButtonText: 'OK',
                allowOutsideClick: false,
                allowEscapeKey: false
            });
        }
        window.location.href = LOGIN_URL;
    }

    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : ((input && input.url) || '');
        if (!url.startsWith(API_PREFIX)) return originalFetch(input, init);
        if (url.startsWith(API_PREFIX + '/admin')) return originalFetch(input, init); // admin panel: own token

        const options = { ...(init || {}) };
        const headers = new Headers(options.headers || {});
        const token = localStorage.getItem('token');
        if (token) headers.set('Authorization', 'Bearer ' + token);
        options.headers = headers;

        const response = await originalFetch(input, options);
        if (response.status === 401 && (token || !onPublicPage)) {
            endSession(response); // not awaited: the caller still gets the response
        }
        return response;
    };
})();
