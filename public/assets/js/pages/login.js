import { login, redirectIfAuthenticated } from '../core/auth.js';
import { showToast } from '../components/toast.js';
import { qs } from '../core/helpers.js';
import { mountSmallDisplayTV } from '../components/small-display-tv.js';
import { mountNetworkPreview } from '../components/network-preview.js';

(async function init() {
  await redirectIfAuthenticated();

  // Same reusable Small Display TV chassis used everywhere else (see
  // small-display-tv.js) - this is a decorative rotating showcase across
  // the whole screen network (mountNetworkPreview), not tied to any one
  // selected screen, so it doesn't use ScreenPreviewController here.
  const tvMount = qs('#login-tv-mount');
  if (tvMount) {
    const tv = mountSmallDisplayTV(tvMount);
    mountNetworkPreview(tv.screenEl, { adDisplayMs: 4000, introMs: 3000, screenTransitionMs: 900 });
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
