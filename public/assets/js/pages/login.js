import { login, redirectIfAuthenticated } from '../core/auth.js';
import { showToast } from '../components/toast.js';
import { qs } from '../core/helpers.js';
import { mountNetworkPreview } from '../components/network-preview.js';

(async function init() {
  await redirectIfAuthenticated();

  // Mount real network preview on login page
  const previewEl = qs('#login-preview');
  if (previewEl) {
    mountNetworkPreview(previewEl, { adDisplayMs: 4000, introMs: 3000, screenTransitionMs: 900 });
  }

  const form = qs('#login-form');
  const submitBtn = qs('#login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = qs('#email').value;
    const password = qs('#password').value;

    submitBtn.classList.add('btn-loading');
    submitBtn.disabled = true;

    const result = await login(email, password);
    submitBtn.classList.remove('btn-loading');
    submitBtn.disabled = false;

    if (!result.ok) {
      showToast({ type: 'error', title: 'Could not sign in', message: result.message });
      return;
    }
    showToast({ type: 'success', title: 'Welcome back' });
    setTimeout(() => {
      window.location.href = result.role === 'admin' ? '/admin' : '/dashboard';
    }, 400);
  });
})();
