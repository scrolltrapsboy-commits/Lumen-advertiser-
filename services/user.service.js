const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { isValidEmail, isValidPassword } = require('./validation.service');

async function list() {
  return db.read('users.json');
}

async function findByEmail(email) {
  const users = await list();
  return users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase()) || null;
}

async function findById(id) {
  const users = await list();
  return users.find(u => u.id === id) || null;
}

async function create({ name, email, password }) {
  email = String(email || '').trim().toLowerCase();
  if (!name || !String(name).trim()) return { ok: false, message: 'Enter your full name.' };
  if (!isValidEmail(email)) return { ok: false, message: 'Enter a valid email address.' };
  if (!isValidPassword(password)) return { ok: false, message: 'Password must be at least 6 characters.' };

  // Atomic: the "is this email taken?" check and the write happen as one
  // queued operation, so two concurrent signups for the same email can't
  // both pass the check before either writes.
  return db.update('users.json', (users) => {
    const existing = users.find(u => u.email.toLowerCase() === email);
    if (existing) return { data: users, result: { ok: false, message: 'An account with this email already exists.' } };
    const user = { id: uuidv4(), name: String(name).trim(), email, password: String(password), createdAt: Date.now() };
    users.push(user);
    return { data: users, result: { ok: true, user } };
  });
}

async function updateName(id, name) {
  const users = await list();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return { ok: false, message: 'User not found.' };
  users[idx].name = String(name || '').trim() || users[idx].name;
  await db.write('users.json', users);
  return { ok: true, user: users[idx] };
}

async function resetPassword(email, newPassword) {
  email = String(email || '').trim().toLowerCase();
  if (!isValidPassword(newPassword)) return { ok: false, message: 'Password must be at least 6 characters.' };
  const users = await list();
  const idx = users.findIndex(u => u.email.toLowerCase() === email);
  if (idx === -1) return { ok: false, message: 'No account found for that email.' };
  users[idx].password = String(newPassword);
  await db.write('users.json', users);
  return { ok: true };
}

async function remove(id) {
  const users = await list();
  const next = users.filter(u => u.id !== id);
  await db.write('users.json', next);
  return { ok: true };
}

module.exports = { list, findByEmail, findById, create, updateName, resetPassword, remove };
