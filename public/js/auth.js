/* Login page logic — sign-in only; accounts are created by vendors (with OTP). */
const loginForm = document.getElementById('login-form');
const errBox = document.getElementById('auth-error');

function showError(msg) {
  errBox.textContent = msg;
  errBox.classList.remove('hidden');
}

// If this device's session was terminated by a login elsewhere, api.js stashes
// the server's message before redirecting here — show it once.
const sessionMessage = localStorage.getItem('session_message');
if (sessionMessage) {
  localStorage.removeItem('session_message');
  showError(sessionMessage);
}

// Already signed in? Offer a one-tap continue — but never auto-redirect,
// so it's always possible to sign in as a different account from this page.
// (Signing in as another account terminates this device's session server-side
// for the old account.)
if (API.token) {
  API.get('/api/auth/me')
    .then((user) => {
      const wrap = document.createElement('div');
      wrap.className = 'session-banner';
      wrap.innerHTML = `
        <span class="session-avatar" aria-hidden="true">${esc((user.name || '?').slice(0, 1).toUpperCase())}</span>
        <div class="session-info"><b>${esc(user.name || '')}</b><small>Signed in${user.is_vendor ? ' · Vendor' : ''}</small></div>
        <a class="btn btn-primary btn-sm" href="/dashboard.html">Continue</a>
        <button type="button" class="session-switch">Use another account</button>`;
      wrap.querySelector('.session-switch').onclick = () => {
        // Keep the current session only if the user continues; switching means
        // the next successful sign-in simply replaces the stored token.
        wrap.remove();
        document.getElementById('login-email')?.focus();
      };
      document.querySelector('.auth-card').prepend(wrap);
    })
    .catch(() => localStorage.removeItem('token'));
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.classList.add('hidden');
  const fd = new FormData(loginForm);
  try {
    const data = await API.post('/api/auth/login', {
      email: fd.get('email'),
      password: fd.get('password'),
    });
    localStorage.setItem('token', data.token);
    location.href = '/dashboard.html';
  } catch (err) {
    showError(err.message);
  }
});
