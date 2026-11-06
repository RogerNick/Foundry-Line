// Foundry Line web server: accounts, sessions, cloud save slots and blueprint sync.
// No npm packages needed: built-in http, crypto (scrypt) and node:sqlite.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const COOKIE = 'fl_session';
const SESSION_DAYS = 30;
const SLOTS = 3;
const MAX_BODY = 12 * 1024 * 1024;
const INDEX = path.join(__dirname, 'public', 'index.html');

// ---- helpers ----
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [kind, saltHex, keyHex] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
const DUMMY_HASH = hashPassword('not-a-real-password');

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, value, expires) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${expires.toUTCString()}`];
  if (PROD) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('This save is too large to store.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('The request was not valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ---- rate limits for login and sign-up ----
const hits = new Map();
function limited(key, max, windowMs) {
  const t = Date.now();
  const h = (hits.get(key) || []).filter(x => t - x < windowMs);
  h.push(t); hits.set(key, h);
  return h.length > max;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.every(x => t - x > 3600e3)) hits.delete(k); }, 600e3).unref();
const ipOf = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.createSession(sha(token), userId, expires.getTime());
  setCookie(res, token, expires);
}
function currentUser(req) {
  const token = cookies(req)[COOKIE];
  return token ? db.userBySession(sha(token)) : null;
}

// ---- routes ----
const routes = [];
const route = (method, pattern, needsUser, fn) => routes.push({ method, re: new RegExp('^' + pattern + '$'), needsUser, fn });

route('POST', '/api/register', false, async (req, res) => {
  const { username, password } = await readJson(req);
  if (limited('reg:' + ipOf(req), 8, 3600e3)) return send(res, 429, { error: 'Too many new accounts from here. Try again later.' });
  if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{3,24}$/.test(username))
    return send(res, 400, { error: 'Usernames are 3 to 24 letters, numbers, dashes or underscores.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 200)
    return send(res, 400, { error: 'Passwords need at least 8 characters.' });
  const user = db.createUser(username, hashPassword(password));
  if (!user) return send(res, 409, { error: 'That username is taken.' });
  startSession(res, user.id);
  send(res, 200, { username: user.username });
});

route('POST', '/api/login', false, async (req, res) => {
  const { username, password } = await readJson(req);
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
    return send(res, 400, { error: 'Enter a username and password.' });
  if (limited('login:' + ipOf(req) + ':' + username.toLowerCase(), 10, 15 * 60e3))
    return send(res, 429, { error: 'Too many attempts. Wait 15 minutes and try again.' });
  const user = db.userByName(username);
  const ok = checkPassword(password, user ? user.pass : DUMMY_HASH) && !!user;
  if (!ok) return send(res, 401, { error: 'Wrong username or password.' });
  startSession(res, user.id);
  send(res, 200, { username: user.username });
});

route('POST', '/api/logout', false, async (req, res) => {
  const token = cookies(req)[COOKIE];
  if (token) db.deleteSession(sha(token));
  setCookie(res, '', new Date(0));
  send(res, 200, { ok: true });
});

route('GET', '/api/me', true, async (req, res, user) => send(res, 200, { username: user.username, beaten: !!user.beaten }));

route('GET', '/api/saves', true, async (req, res, user) => send(res, 200, { slots: SLOTS, saves: db.listSaves(user.id), beaten: !!user.beaten }));

route('GET', '/api/saves/(\\d+)', true, async (req, res, user, m) => {
  const slot = Number(m[1]);
  if (slot < 1 || slot > SLOTS) return send(res, 400, { error: 'Unknown save slot.' });
  const s = db.getSave(user.id, slot);
  if (!s) return send(res, 404, { error: 'That slot is empty.' });
  send(res, 200, s);
});

async function putSave(req, res, user, m) {
  const slot = Number(m[1]);
  if (slot < 1 || slot > SLOTS) return send(res, 400, { error: 'Unknown save slot.' });
  const { data, meta } = await readJson(req);
  if (typeof data !== 'string' || !data.startsWith('{')) return send(res, 400, { error: 'Save data is missing.' });
  const m2 = meta && typeof meta === 'object' ? {
    playTime: Number(meta.playTime) || 0, techs: Number(meta.techs) || 0, buildings: Number(meta.buildings) || 0,
    day: Number(meta.day) || 1, won: !!meta.won, planets: Math.min(9, Number(meta.planets) || 1), creative: !!meta.creative,
  } : {};
  db.putSave(user.id, slot, data, m2);
  // a real (non-creative) win unlocks creative saves for this account
  if (m2.won && !m2.creative && !user.beaten) db.setBeaten(user.id);
  send(res, 200, { ok: true, savedAt: new Date().toISOString() });
}
route('PUT', '/api/saves/(\\d+)', true, putSave);
route('POST', '/api/saves/(\\d+)', true, putSave); // navigator.sendBeacon on page close

route('DELETE', '/api/saves/(\\d+)', true, async (req, res, user, m) => {
  db.deleteSave(user.id, Number(m[1]));
  send(res, 200, { ok: true });
});

route('GET', '/api/blueprints', true, async (req, res, user) => send(res, 200, { blueprints: db.getBlueprints(user.id) }));
route('PUT', '/api/blueprints', true, async (req, res, user) => {
  const { blueprints } = await readJson(req);
  if (!Array.isArray(blueprints) || blueprints.length > 500) return send(res, 400, { error: 'Blueprint list is invalid.' });
  db.putBlueprints(user.id, blueprints);
  send(res, 200, { ok: true });
});

route('GET', '/healthz', false, async (req, res) => send(res, 200, 'ok'));

// ---- server ----
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = p.match(r.re);
      if (!m) continue;
      let user = null;
      if (r.needsUser) { user = currentUser(req); if (!user) return send(res, 401, { error: 'Please log in again.' }); }
      return await r.fn(req, res, user, m);
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (p.startsWith('/assets/illustrated/')) {
      const fileName = p.slice('/assets/illustrated/'.length);
      if (!/^[a-z0-9_-]+\.svg$/.test(fileName)) return send(res, 404, 'Not found');
      return fs.readFile(path.join(__dirname, 'public', 'assets', 'illustrated', fileName), (err, data) => {
        if (err) return send(res, 404, 'Not found');
        send(res, 200, data, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      });
    }
    fs.readFile(INDEX, (err, html) => {
      if (err) return send(res, 500, 'The game page is missing. Run: node build/build.js');
      send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    });
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong on the server.' });
  }
});

server.listen(PORT, () => console.log(`Foundry Line running on port ${PORT}. Database: ${db.file}`));
