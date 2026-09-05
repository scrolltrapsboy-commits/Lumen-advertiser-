import { resetPassword } from '../core/auth.js';
import { showToast } from '../components/toast.js';
import { qs } from '../core/helpers.js';

(function init() {
  const step1 = qs('#step-email');
  const step2 = qs('#step-reset');
  let verifiedEmail = '';

  qs('#find-account-form').addEventListener('submit', (e) => {
    e.preventDefault();
    verifiedEmail = qs('#reset-email').value.trim().toLowerCase();
    step1.style.display = 'none';
    step2.style.display = 'block';
    showToast({ type: 'info', title: 'Account located', message: 'Set a new password below.' });
  });

  qs('#reset-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = qs('#new-password').value;
    const confirm = qs('#confirm-password').value;
    if (password !== confirm) {
      showToast({ type: 'error', title: 'Passwords do not match' });
      return;
    }
    const result = await resetPassword(verifiedEmail, password);
    if (!result.ok) {
      showToast({ type: 'error', title: 'Could not reset password', message: result.message });
      return;
    }
    showToast({ type: 'success', title: 'Password updated' });
    setTimeout(() => { window.location.href = '/login'; }, 600);
  });
})();
