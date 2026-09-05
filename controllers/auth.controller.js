const userService = require('../services/user.service');
const { isValidEmail } = require('../services/validation.service');

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

async function login(req, res, next) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;

    const adminEmail = (process.env.ADMIN_EMAIL || 'lumen@gmail.com').toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'lumen@6922';

    if (email === adminEmail && password === adminPassword) {
      req.session.user = { role: 'admin', email, name: 'Admin', loggedInAt: Date.now() };
      return res.json({ ok: true, role: 'admin', redirect: '/admin' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, message: 'Enter a valid email address.' });
    }

    const user = await userService.findByEmail(email);
    if (!user || user.password !== password) {
      return res.status(401).json({ ok: false, message: 'Incorrect email or password.' });
    }

    req.session.user = { role: 'advertiser', email: user.email, name: user.name, id: user.id, loggedInAt: Date.now() };
    res.json({ ok: true, role: 'advertiser', redirect: '/dashboard' });
  } catch (err) {
    next(err);
  }
}

async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    const adminEmail = (process.env.ADMIN_EMAIL || 'lumen@gmail.com').toLowerCase();
    if (normalizedEmail === adminEmail) {
      return res.status(400).json({ ok: false, message: 'This email is reserved.' });
    }

    const result = await userService.create({ name, email: normalizedEmail, password });
    if (!result.ok) return res.status(400).json(result);

    req.session.user = {
      role: 'advertiser',
      email: result.user.email,
      name: result.user.name,
      id: result.user.id,
      loggedInAt: Date.now()
    };
    res.json({ ok: true, redirect: '/dashboard' });
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie('lumen.sid');
    res.json({ ok: true, redirect: '/login' });
  });
}

function getSession(req, res) {
  res.json({ ok: true, user: req.session.user || null });
}

async function updateProfile(req, res, next) {
  try {
    if (!req.session.user || req.session.user.role !== 'advertiser') {
      return res.status(403).json({ ok: false, message: 'Not permitted.' });
    }
    const result = await userService.updateName(req.session.user.id, req.body.name);
    if (!result.ok) return res.status(400).json(result);
    req.session.user.name = result.user.name;
    res.json({ ok: true, user: sanitizeUser(result.user) });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await userService.resetPassword(email, password);
    if (!result.ok) return res.status(400).json(result);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, signup, logout, getSession, resetPassword, updateProfile, sanitizeUser };
