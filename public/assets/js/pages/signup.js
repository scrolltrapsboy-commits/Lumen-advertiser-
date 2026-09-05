import { signup, redirectIfAuthenticated } from '../core/auth.js';
import { showToast } from '../components/toast.js';
import { qs } from '../core/helpers.js';
import { mountNetworkPreview } from '../components/network-preview.js';

(async function init() {
  await redirectIfAuthenticated();

  // Mount real network preview on signup page
  const previewEl = qs('#signup-preview');
  if (previewEl) {
    mountNetworkPreview(previewEl, { adDisplayMs: 4000, introMs: 3000, screenTransitionMs: 900 });
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
