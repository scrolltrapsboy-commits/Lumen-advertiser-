import { signup, redirectIfAuthenticated } from '../core/auth.js';
import { showToast } from '../components/toast.js';
import { qs } from '../core/helpers.js';
import { mountSmallDisplayTV } from '../components/small-display-tv.js';
import { mountNetworkPreview } from '../components/network-preview.js';

(async function init() {
  await redirectIfAuthenticated();

  // Same reusable Small Display TV chassis used everywhere else (see
  // small-display-tv.js) - decorative rotating showcase, not a
  // per-screen live preview, so no ScreenPreviewController here.
  const tvMount = qs('#signup-tv-mount');
  if (tvMount) {
    const tv = mountSmallDisplayTV(tvMount);
    mountNetworkPreview(tv.screenEl, { adDisplayMs: 4000, introMs: 3000, screenTransitionMs: 900 });
  }

  const form = qs('#signup-form');
  const submitBtn = qs('#signup-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = qs('#name').value;
    const email = qs('#email').value;
    const password = qs('#password').value;
    const confirm = qs('#confirm').value;

    if (password !== confirm) {
      showToast({ type: 'error', title: 'Passwords do not match' });
      return;
    }

    submitBtn.classList.add('btn-loading');
    submitBtn.disabled = true;

    const result = await signup({ name, email, password });
    submitBtn.classList.remove('btn-loading');
    submitBtn.disabled = false;

    if (!result.ok) {
      showToast({ type: 'error', title: 'Could not create account', message: result.message });
      return;
    }
    showToast({ type: 'success', title: 'Account created' });
    setTimeout(() => { window.location.href = '/dashboard'; }, 400);
  });
})();
