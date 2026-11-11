// Accounts and sync for the app on Cloudflare Workers + D1 (free plan). It speaks the small subset of the
// PocketBase REST API that the app uses, so the app code is the same for both servers.
//   POST   /api/collections/users/records                 sign up
//   POST   /api/collections/users/auth-with-password      sign in
//   POST   /api/collections/users/auth-refresh            renew the token
//   DELETE /api/collections/users/records/:id             delete the account and its data
//   GET    /api/collections/hefz_sync/records             the signed-in user's record (list of 0 or 1)
//   POST   /api/collections/hefz_sync/records             create it
//   PATCH  /api/collections/hefz_sync/records/:id         update it
// Settings: binding DB (D1), secret TOKEN_SECRET (long random text), optional variable ALLOWED_ORIGIN (e.g. https://ganjineh-tadabbor.ir).
const enc = new TextEncoder();
const TOKEN_DAYS = 30, PBKDF2_ITER = 100000, MAX_BODY = 5_500_000;
const LIMIT = {max: 10, windowMs: 10 * 60 * 1000};      // failed sign-ins per email+IP in 10 minutes

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const rid = () => b64u(crypto.getRandomValues(new Uint8Array(12))).replace(/[-_]/g, "x").slice(0, 15).toLowerCase();

function cors(req, env) {
  const o = req.headers.get("Origin") || "", allow = env.ALLOWED_ORIGIN;
  const ok = !allow || allow.split(",").map(s => s.trim()).includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || o === "https://localhost" || o === "http://localhost";
  return {"Access-Control-Allow-Origin": ok && o ? o : (allow ? allow.split(",")[0].trim() : "*"), "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Max-Age": "86400", "Vary": "Origin"};
}
const json = (req, env, data, status = 200) => new Response(JSON.stringify(data), {status, headers: Object.assign({"Content-Type": "application/json", "Cache-Control": "no-store"}, cors(req, env))});
const fail = (req, env, status, message, data = {}) => json(req, env, {status, message, data}, status);

async function hmacKey(env) { return crypto.subtle.importKey("raw", enc.encode(env.TOKEN_SECRET), {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]); }
async function signToken(env, uid) {
  const body = b64u(enc.encode(JSON.stringify({id: uid, exp: Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400})));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(body));
  return body + "." + b64u(sig);
}
async function readToken(env, req) {
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), [body, sig] = t.split(".");
  if (!body || !sig) return null;
  try {
    if (!await crypto.subtle.verify("HMAC", await hmacKey(env), unb64u(sig), enc.encode(body))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return p.exp > Date.now() / 1000 ? p.id : null;
  } catch (e) { return null; }
}
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return b64u(await crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER}, k, 256));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const emailOk = e => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function body(req) {
  const t = await req.text();
  if (t.length > MAX_BODY) throw Object.assign(new Error("big"), {status: 413});
  try { return t ? JSON.parse(t) : {}; } catch (e) { throw Object.assign(new Error("bad json"), {status: 400}); }
}
const rec = r => r && {id: r.id, user: r.user, progress: JSON.parse(r.progress), settings: JSON.parse(r.settings), updated: r.updated};
const userRec = u => ({id: u.id, email: u.email, collectionName: "users"});
const now = () => new Date().toISOString().replace("T", " ");

async function tooMany(env, key) {
  const row = await env.DB.prepare("SELECT n, t FROM attempts WHERE k = ?").bind(key).first();
  return !!row && Date.now() - row.t < LIMIT.windowMs && row.n >= LIMIT.max;
}
async function noteFail(env, key) {
  const row = await env.DB.prepare("SELECT n, t FROM attempts WHERE k = ?").bind(key).first(), t = Date.now();
  const n = row && t - row.t < LIMIT.windowMs ? row.n + 1 : 1;
  await env.DB.prepare("INSERT INTO attempts (k, n, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET n = ?, t = ?").bind(key, n, row && n > 1 ? row.t : t, n, row && n > 1 ? row.t : t).run();
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: cors(req, env)});
    if (!env.TOKEN_SECRET || env.TOKEN_SECRET.length < 24) return fail(req, env, 500, "TOKEN_SECRET is not set");
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, ""), m = req.method;
    try {
      let g;
      if (m === "POST" && path === "/api/collections/users/records") {
        const b = await body(req), email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
        if (!emailOk(email)) return fail(req, env, 400, "Failed to create record.", {email: {code: "validation_is_email"}});
        if (pw.length < 8 || pw.length > 72 || pw !== b.passwordConfirm) return fail(req, env, 400, "Failed to create record.", {password: {code: "validation_length_out_of_range"}});
        if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) return fail(req, env, 400, "Failed to create record.", {email: {code: "validation_not_unique"}});
        const salt = crypto.getRandomValues(new Uint8Array(16)), id = rid();
        await env.DB.prepare("INSERT INTO users (id, email, salt, hash, created) VALUES (?, ?, ?, ?, ?)").bind(id, email, b64u(salt), await hashPw(pw, salt), now()).run();
        return json(req, env, userRec({id, email}));
      }
      if (m === "POST" && path === "/api/collections/users/auth-with-password") {
        const b = await body(req), email = String(b.identity || "").trim().toLowerCase(), pw = String(b.password || "");
        const key = email + "|" + (req.headers.get("CF-Connecting-IP") || "");
        if (await tooMany(env, key)) return fail(req, env, 429, "Too many requests.");
        const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
        const ok = u && same(await hashPw(pw.slice(0, 72), unb64u(u.salt)), u.hash);
        if (!ok) { await noteFail(env, key); return fail(req, env, 400, "Failed to authenticate."); }
        return json(req, env, {token: await signToken(env, u.id), record: userRec(u)});
      }
      if (m === "POST" && path === "/api/collections/users/auth-refresh") {
        const uid = await readToken(env, req); if (!uid) return fail(req, env, 401, "The request requires valid record authorization token.");
        const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
        if (!u) return fail(req, env, 401, "The request requires valid record authorization token.");
        return json(req, env, {token: await signToken(env, u.id), record: userRec(u)});
      }
      if ((g = path.match(/^\/api\/collections\/users\/records\/([\w-]+)$/)) && m === "DELETE") {
        const uid = await readToken(env, req); if (!uid) return fail(req, env, 401, "Unauthorized");
        if (uid !== g[1]) return fail(req, env, 404, "The requested resource wasn't found.");
        await env.DB.batch([env.DB.prepare("DELETE FROM hefz_sync WHERE user = ?").bind(uid), env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid)]);
        return new Response(null, {status: 204, headers: cors(req, env)});
      }
      if (path === "/api/collections/hefz_sync/records" || path.startsWith("/api/collections/hefz_sync/records/")) {
        const uid = await readToken(env, req);
        if (!uid) return fail(req, env, m === "GET" ? 401 : 401, "The request requires valid record authorization token.");
        if (m === "GET" && path === "/api/collections/hefz_sync/records") {
          const r = await env.DB.prepare("SELECT * FROM hefz_sync WHERE user = ?").bind(uid).first();
          return json(req, env, {page: 1, perPage: 1, totalItems: r ? 1 : 0, totalPages: r ? 1 : 0, items: r ? [rec(r)] : []});
        }
        if (m === "POST" && path === "/api/collections/hefz_sync/records") {
          const b = await body(req);
          if (await env.DB.prepare("SELECT 1 FROM hefz_sync WHERE user = ?").bind(uid).first()) return fail(req, env, 400, "Failed to create record.", {user: {code: "validation_not_unique"}});
          const id = rid(), t = now();
          await env.DB.prepare("INSERT INTO hefz_sync (id, user, progress, settings, updated) VALUES (?, ?, ?, ?, ?)").bind(id, uid, JSON.stringify(b.progress || {}), JSON.stringify(b.settings || {}), t).run();
          return json(req, env, rec({id, user: uid, progress: JSON.stringify(b.progress || {}), settings: JSON.stringify(b.settings || {}), updated: t}));
        }
        if ((g = path.match(/^\/api\/collections\/hefz_sync\/records\/([\w-]+)$/)) && m === "PATCH") {
          const b = await body(req), r = await env.DB.prepare("SELECT * FROM hefz_sync WHERE id = ? AND user = ?").bind(g[1], uid).first();
          if (!r) return fail(req, env, 404, "The requested resource wasn't found.");
          const t = now(), p = "progress" in b ? JSON.stringify(b.progress) : r.progress, s = "settings" in b ? JSON.stringify(b.settings) : r.settings;
          await env.DB.prepare("UPDATE hefz_sync SET progress = ?, settings = ?, updated = ? WHERE id = ?").bind(p, s, t, r.id).run();
          return json(req, env, rec({id: r.id, user: uid, progress: p, settings: s, updated: t}));
        }
      }
      if (m === "GET" && (path === "" || path === "/api/health")) return json(req, env, {ok: true});
      return fail(req, env, 404, "The requested resource wasn't found.");
    } catch (e) {
      return fail(req, env, e.status || 500, e.status ? e.message : "Server error");
    }
  }
};
