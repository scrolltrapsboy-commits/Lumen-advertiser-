import { requireAuth, resetPassword, updateProfileName } from '../core/auth.js';
import { mountShell } from '../components/shell.js';
import { showLoader, hideLoader } from '../components/loader.js';
import { showToast } from '../components/toast.js';
import { qs } from '../core/helpers.js';

(async function init() {
  showLoader('Loading Settings');
  const session = await requireAuth('advertiser');
  if (!session) return;

  const main = mountShell({ activeHref: '/settings', session });
  hideLoader();

  main.insertAdjacentHTML('beforeend', `
    <div class="page-header">
      <div>
        <div class="eyebrow">Account</div>
        <h1 style="font-size:var(--fs-heading);margin-top:8px;">Settings</h1>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="glass-card">
        <h3 style="margin-bottom:16px;">Profile</h3>
        <div class="field"><label>Full name</label><input type="text" id="profile-name" value="${session.name || ''}"></div>
        <div class="field"><label>Email</label><input type="email" value="${session.email}" disabled></div>
        <button class="btn btn-primary" id="save-profile">Save Changes</button>
      </div>
      <div class="glass-card">
        <h3 style="margin-bottom:16px;">Change Password</h3>
        <div class="field"><label>New password</label><input type="password" id="new-password" placeholder="At least 6 characters"></div>
        <div class="field"><label>Confirm password</label><input type="password" id="confirm-password"></div>
        <button class="btn btn-secondary" id="save-password">Update Password</button>
      </div>
    </div>
  `);

  qs('#save-profile').addEventListener('click', async () => {
    const result = await updateProfileName(qs('#profile-name').value.trim());
    if (!result.ok) {
      showToast({ type: 'error', title: 'Could not update profile', message: result.message });
      return;
    }
    showToast({ type: 'success', title: 'Profile updated' });
  });

  qs('#save-password').addEventListener('click', async () => {
    const password = qs('#new-password').value;
    const confirm = qs('#confirm-password').value;
    if (password !== confirm) { showToast({ type: 'error', title: 'Passwords do not match' }); return; }
    const result = await resetPassword(session.email, password);
    if (!result.ok) { showToast({ type: 'error', title: 'Could not update password', message: result.message }); return; }
    showToast({ type: 'success', title: 'Password updated' });
    qs('#new-password').value = '';
    qs('#confirm-password').value = '';
  });
})();
