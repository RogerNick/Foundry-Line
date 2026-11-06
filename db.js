// Storage layer: Node's built-in SQLite. On Railway, point DATA_DIR at a mounted volume so saves survive redeploys.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'foundry-line.db');
const db = new DatabaseSync(file);

db.exec(`
  pragma journal_mode = wal;
  pragma foreign_keys = on;
  create table if not exists users(
    id integer primary key autoincrement,
    username text not null,
    username_lc text unique not null,
    pass text not null,
    created_at text not null default (datetime('now')));
  create table if not exists sessions(
    token_hash text primary key,
    user_id integer not null references users(id) on delete cascade,
    expires_at integer not null);
  create table if not exists saves(
    user_id integer not null references users(id) on delete cascade,
    slot integer not null,
    data text not null,
    meta text,
    updated_at text not null,
    primary key(user_id, slot));
  create table if not exists blueprints(
    user_id integer primary key references users(id) on delete cascade,
    data text not null,
    updated_at text not null);
`);
// Beating the game unlocks creative saves for the whole account
try { db.exec('alter table users add column beaten integer not null default 0'); } catch (e) { /* column already there */ }
db.prepare('delete from sessions where expires_at < ?').run(Date.now());

const st = {
  createUser: db.prepare('insert into users(username, username_lc, pass) values(?,?,?)'),
  userByName: db.prepare('select id, username, pass from users where username_lc=?'),
  createSession: db.prepare('insert into sessions(token_hash, user_id, expires_at) values(?,?,?)'),
  userBySession: db.prepare('select u.id, u.username, u.beaten from sessions s join users u on u.id=s.user_id where s.token_hash=? and s.expires_at > ?'),
  setBeaten: db.prepare('update users set beaten=1 where id=?'),
  deleteSession: db.prepare('delete from sessions where token_hash=?'),
  listSaves: db.prepare('select slot, meta, updated_at from saves where user_id=? order by slot'),
  getSave: db.prepare('select data, meta, updated_at from saves where user_id=? and slot=?'),
  putSave: db.prepare(`insert into saves(user_id, slot, data, meta, updated_at) values(?,?,?,?,?)
    on conflict(user_id, slot) do update set data=excluded.data, meta=excluded.meta, updated_at=excluded.updated_at`),
  deleteSave: db.prepare('delete from saves where user_id=? and slot=?'),
  getBlueprints: db.prepare('select data from blueprints where user_id=?'),
  putBlueprints: db.prepare(`insert into blueprints(user_id, data, updated_at) values(?,?,?)
    on conflict(user_id) do update set data=excluded.data, updated_at=excluded.updated_at`),
};
const now = () => new Date().toISOString();
const plain = r => (r ? { ...r } : null);
const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };

module.exports = {
  file,
  createUser(username, pass) {
    try {
      const r = st.createUser.run(username, username.toLowerCase(), pass);
      return { id: Number(r.lastInsertRowid), username };
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return null;
      throw e;
    }
  },
  userByName: username => plain(st.userByName.get(username.toLowerCase())),
  setBeaten: userId => { st.setBeaten.run(userId); },
  createSession: (tokenHash, userId, expiresMs) => { st.createSession.run(tokenHash, userId, expiresMs); },
  userBySession: tokenHash => plain(st.userBySession.get(tokenHash, Date.now())),
  deleteSession: tokenHash => { st.deleteSession.run(tokenHash); },
  listSaves: userId => st.listSaves.all(userId).map(r => ({ slot: r.slot, meta: parse(r.meta) || {}, updated_at: r.updated_at })),
  getSave(userId, slot) {
    const r = st.getSave.get(userId, slot);
    return r ? { data: r.data, meta: parse(r.meta) || {}, updated_at: r.updated_at } : null;
  },
  putSave: (userId, slot, data, meta) => { st.putSave.run(userId, slot, data, JSON.stringify(meta), now()); },
  deleteSave: (userId, slot) => { st.deleteSave.run(userId, slot); },
  getBlueprints(userId) { const r = st.getBlueprints.get(userId); return r ? parse(r.data) || [] : []; },
  putBlueprints: (userId, list) => { st.putBlueprints.run(userId, JSON.stringify(list), now()); },
};
