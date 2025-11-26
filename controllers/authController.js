const pool = require('../secure-app/config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createLogger } = require('../secure-app/utils/logger');
const logger = createLogger();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'strict',
  domain: process.env.COOKIE_DOMAIN,
  path: '/',
};

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hashed]
    );
    res.status(201).json({ message: 'User created', userId: result.insertId });
  } catch (err) {
    logger.error(err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already registered' });
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.execute('SELECT id, password FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const payload = { sub: user.id };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    const refreshToken = jwt.sign(payload, process.env.REFRESH_JWT_SECRET, { expiresIn: process.env.REFRESH_JWT_EXPIRES_IN || '7d' });
    await pool.execute('UPDATE users SET refresh_token = ? WHERE id = ?', [refreshToken, user.id]);
    res.cookie('token', token, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...COOKIE_OPTIONS, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ message: 'Logged in' });
  } catch (err) {
    next(err);
  }
}

async function refreshToken(req, res, next) {
  try {
    const { refreshToken } = req.cookies || req.body;
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });
    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.REFRESH_JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ? AND refresh_token = ?', [payload.sub, refreshToken]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid refresh token' });
    const newToken = jwt.sign({ sub: payload.sub }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.cookie('token', newToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });
    return res.json({ message: 'Token refreshed' });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const userId = req.user && req.user.sub;
    if (userId) {
      await pool.execute('UPDATE users SET refresh_token = NULL WHERE id = ?', [userId]);
    }
    res.clearCookie('token', COOKIE_OPTIONS);
    res.clearCookie('refreshToken', COOKIE_OPTIONS);
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const userId = req.user && req.user.sub;
    const [rows] = await pool.execute('SELECT id, name, email, created_at FROM users WHERE id = ?', [userId]);
    const user = rows[0];
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refreshToken, logout, me };
