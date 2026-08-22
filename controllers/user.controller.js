const userService = require('../services/user.service');

async function list(req, res, next) {
  try {
    const users = await userService.list();
    const sanitized = users.map(({ password, ...rest }) => rest);
    res.json({ ok: true, users: sanitized });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await userService.remove(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, remove };
