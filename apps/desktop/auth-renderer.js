(function() {
const { createClient } = require('@supabase/supabase-js');
const { ipcRenderer, shell } = require('electron');

// Configuration (Synced with main.js)
const SUPABASE_URL = 'https://psnrofnlgpqkfprjrbnm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnJvZm5sZ3Bxa2ZwcmpyYm5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNDYyMzksImV4cCI6MjA4MzYyMjIzOX0.oYlLKiEI7cO03H4IGyMV0r2HqJYo30tadfnl-XZZZMI';

try {
    console.log('[supabase] auth config', {
        url: SUPABASE_URL,
        anonKeyPrefix: String(SUPABASE_ANON_KEY || '').slice(0, 24),
    });
} catch (e) {}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM Elements
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const statusMsg = document.getElementById('status-msg');

const btnLogin = document.getElementById('btn-login');
const btnSignup = document.getElementById('btn-signup');

// --- HELPERS ---

function showStatus(msg, type = 'error') {
    statusMsg.innerText = msg;
    statusMsg.classList.remove('hidden', 'bg-red-500/20', 'text-red-300', 'bg-green-500/20', 'text-green-300', 'border-red-500/30', 'border-green-500/30');
    statusMsg.classList.add('border');

    if (type === 'error') {
        statusMsg.classList.add('bg-red-500/20', 'text-red-300', 'border-red-500/30');
    } else {
        statusMsg.classList.add('bg-green-500/20', 'text-green-300', 'border-green-500/30');
    }
}

function setLoading(btn, isLoading, text) {
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i>`;
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalText || text;
    }
}

// --- SESSION SYNC ACROSS PAGES ---
// Store session in main process for cross-page persistence
async function syncSessionToMain() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            await ipcRenderer.invoke('auth:store-session', {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                expires_at: session.expires_at
            });
            console.log('[auth-renderer] Session synced to main process');
        }
    } catch (e) {
        console.error('[auth-renderer] Failed to sync session:', e);
    }
}

async function navigateToDashboard() {
    // Sync session to main process before navigating
    await syncSessionToMain();
    window.location.href = 'index.html';
}

// --- AUTH LOGIC ---

// 1. Check Session on Load
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        console.log('Session found, syncing and redirecting...');
        
        // Clean URL hash if on web to remove sensitive tokens from address bar
        if (typeof process !== 'undefined' && process.platform === 'web' && window.location.hash) {
            window.history.replaceState(null, null, window.location.pathname);
        }
        
        await syncSessionToMain();
        navigateToDashboard();
    } else {
        console.log('No session found, showing login form');
    }
});


// 2. Email Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    setLoading(btnLogin, true);

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            showStatus(error.message, 'error');
        } else {
            showStatus('Logged in! Syncing...', 'success');
            await syncSessionToMain();
            navigateToDashboard();
        }
    } catch (e) {
        showStatus('Unexpected error during login', 'error');
    } finally {
        setLoading(btnLogin, false, 'Sign In');
    }
});

// 3. Email Signup
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;

    setLoading(btnSignup, true);

    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });

        if (error) {
            showStatus(error.message, 'error');
        } else {
            showStatus('Signup successful! Check your email.', 'success');
        }
    } catch (e) {
        showStatus('Unexpected error during signup', 'error');
    } finally {
        setLoading(btnSignup, false, 'Create Account');
    }
});

// 4. Social Auth (Google / GitHub) - External Browser Flow
ipcRenderer.on('supabase:auth-callback', async (event, url) => {
    console.log("Received Auth Callback:", url);
    // URL Format: AlphaOps://auth/callback#access_token=...&refresh_token=...&...

    try {
        // Parse Hash (Implicit Grant)
        const hashIndex = url.indexOf('#');
        if (hashIndex === -1) {
            // If no hash, check for query parameters (e.g., for error messages)
            const queryIndex = url.indexOf('?');
            if (queryIndex !== -1) {
                const queryString = url.substring(queryIndex + 1);
                const params = new URLSearchParams(queryString);
                const errorDesc = params.get('error_description');
                if (errorDesc) throw new Error(decodeURIComponent(errorDesc));
            }
            return; // No hash or relevant query params found
        }

        const fragment = url.substring(hashIndex + 1);
        const params = new URLSearchParams(fragment);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken
            });

            if (error) throw error;

            showStatus('Login successful! Redirecting...', 'success');
            setTimeout(() => navigateToDashboard(), 500);
        } else {
            // Check for error description in hash fragment
            const errorDesc = params.get('error_description');
            if (errorDesc) throw new Error(decodeURIComponent(errorDesc));
        }

    } catch (err) {
        showStatus('Auth Callback Error: ' + err.message, 'error');
    }
});

async function handleSocialLogin(provider) {
    const isWeb = typeof process !== 'undefined' && process.platform === 'web';
    
    try {
        const authOptions = {
            provider: provider,
            options: {
                redirectTo: isWeb ? window.location.origin + '/auth' : 'http://localhost:3456',
                queryParams: {
                    prompt: 'select_account consent',
                    access_type: 'offline'
                }
            }
        };

        if (!isWeb) {
            authOptions.options.skipBrowserRedirect = true;
        }

        const { data, error } = await supabase.auth.signInWithOAuth(authOptions);

        if (error) throw error;

        if (!isWeb && data && data.url) {
            // Open in Default System Browser for Desktop
            shell.openExternal(data.url);
            showStatus(`Please complete login in your browser...`, 'info');
        }

    } catch (err) {
        showStatus(err.message, 'error');
    }
}

// Attach listeners to Social Buttons
// Note: We need multiple buttons since we have them in both forms
['btn-google', 'btn-google-up'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => handleSocialLogin('google'));
});

['btn-github', 'btn-github-up'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => handleSocialLogin('github'));
});
})();
