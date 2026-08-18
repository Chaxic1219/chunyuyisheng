"use strict";
/**
 * 管理端会话持久化（P0）：
 * - SQLite 为真源，进程内 Map 为热缓存
 * - 重启后 sid Cookie 仍可恢复登录态
 * - API 兼容原 Map：set / get / delete / entries
 */

function createAdminSessionStore(db){
  db.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    username TEXT,
    role TEXT,
    created_at_ms INTEGER NOT NULL,
    last_seen_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at_ms)`);

  const mem = new Map();
  const upsertStmt = db.prepare(`INSERT INTO admin_sessions(
      token, admin_id, username, role, created_at_ms, last_seen_at_ms, expires_at_ms
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(token) DO UPDATE SET
      admin_id=excluded.admin_id,
      username=excluded.username,
      role=excluded.role,
      created_at_ms=excluded.created_at_ms,
      last_seen_at_ms=excluded.last_seen_at_ms,
      expires_at_ms=excluded.expires_at_ms`);
  const selectStmt = db.prepare("SELECT * FROM admin_sessions WHERE token=?");
  const deleteStmt = db.prepare("DELETE FROM admin_sessions WHERE token=?");
  const deleteByAdminStmt = db.prepare("DELETE FROM admin_sessions WHERE admin_id=?");
  const purgeStmt = db.prepare("DELETE FROM admin_sessions WHERE expires_at_ms<=?");

  function rowToSession(row){
    if(!row) return null;
    return {
      adminId: +row.admin_id,
      username: row.username || "",
      role: row.role || "super",
      createdAt: +row.created_at_ms,
      lastSeenAt: +row.last_seen_at_ms,
      expiresAt: +row.expires_at_ms
    };
  }

  function writeDb(token, s){
    upsertStmt.run(
      String(token),
      +s.adminId,
      String(s.username || ""),
      String(s.role || "super"),
      +s.createdAt || Date.now(),
      +s.lastSeenAt || Date.now(),
      +s.expiresAt || 0
    );
    s._persistedAt = Date.now();
  }

  const persistMinMs = Math.max(5 * 1000, Number(process.env.ADMIN_SESSION_PERSIST_MS) || 60 * 1000);

  function purgeExpired(ts){
    const now = ts != null ? +ts : Date.now();
    try{ purgeStmt.run(now); }catch(e){}
    for(const [token, s] of mem.entries()){
      if(!s || !s.expiresAt || s.expiresAt <= now) mem.delete(token);
    }
  }

  // 启动预热：装入未过期会话
  purgeExpired(Date.now());
  try{
    const rows = db.prepare("SELECT * FROM admin_sessions WHERE expires_at_ms>?").all(Date.now());
    for(const row of rows){
      const s = rowToSession(row);
      if(s) mem.set(String(row.token), s);
    }
  }catch(e){}

  return {
    set(token, session, opts){
      const t = String(token || "");
      if(!t || !session) return this;
      mem.set(t, session);
      const o = opts || {};
      // 滑动续期节流：热路径高频 authed 不每次打 SQLite；登录/踢下线仍强制落库
      if(o.throttle){
        const last = +session._persistedAt || 0;
        const ttlLeft = (+session.expiresAt || 0) - Date.now();
        if(last && (Date.now() - last) < persistMinMs && ttlLeft > persistMinMs * 2){
          return this;
        }
      }
      writeDb(t, session);
      return this;
    },
    get(token){
      const t = String(token || "");
      if(!t) return undefined;
      const ts = Date.now();
      let s = mem.get(t);
      if(!s){
        const row = selectStmt.get(t);
        s = rowToSession(row);
        if(s){
          s._persistedAt = ts;
          mem.set(t, s);
        }
      }
      if(!s) return undefined;
      if(!s.expiresAt || s.expiresAt <= ts){
        mem.delete(t);
        try{ deleteStmt.run(t); }catch(e){}
        return undefined;
      }
      return s;
    },
    delete(token){
      const t = String(token || "");
      if(!t) return false;
      const had = mem.delete(t);
      try{ deleteStmt.run(t); }catch(e){}
      return had;
    },
    deleteByAdminId(adminId){
      const id = +adminId;
      let dropped = 0;
      for(const [token, s] of mem.entries()){
        if(+s.adminId === id){ mem.delete(token); dropped++; }
      }
      try{
        const info = deleteByAdminStmt.run(id);
        if(info && info.changes > dropped) dropped = info.changes;
      }catch(e){}
      return dropped;
    },
    entries(){ return mem.entries(); },
    get size(){ return mem.size; },
    purgeExpired,
    persistMinMs
  };
}

module.exports = { createAdminSessionStore };
