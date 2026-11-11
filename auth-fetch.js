// auth-fetch.js - load this BEFORE home.js / dashboard.js.
//
// Wraps fetch() so every request to the StayFind API automatically carries the
// login token. That way home.js, messages-ui.js and dashboard.js keep working
// without editing each fetch call. If the server says the session is invalid or
// expired (401), the person is sent back to the login page.
(function () {
    const API_PREFIX = "https://stayfind-app-system.onrender.com/api";
    const LOGIN_URL = "index.html?auth=signin";
    const originalFetch = window.fetch.bind(window);

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

    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : ((input && input.url) || '');
        if (!url.startsWith(API_PREFIX)) return originalFetch(input, init);

        const options = { ...(init || {}) };
        const headers = new Headers(options.headers || {});
        const token = localStorage.getItem('token');
        if (token) headers.set('Authorization', 'Bearer ' + token);
        options.headers = headers;

        const response = await originalFetch(input, options);
        if (response.status === 401) {
            clearSessionKeepNotices();
            window.location.href = LOGIN_URL;
        }
        return response;
    };
})();
