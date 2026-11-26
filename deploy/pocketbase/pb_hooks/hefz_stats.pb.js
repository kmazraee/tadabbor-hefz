/// <reference path="../pb_data/types.d.ts" />
// Usage statistics and the admin dashboard (deploy/vps/README.md, «داشبورد مدیریتی»).
//   POST /api/hefz/ping               signed-in app: {sid, secs, plat, ver, os, br, dev, tz} -> one row per session in hefz_sessions
//   GET  /api/hefz/admin              the dashboard page (sign-in with the PocketBase superuser's email and password)
//   POST /api/hefz/admin/login        {email, password} -> a read-only dashboard token (12 hours)
//   GET  /api/hefz/admin/stats?days=  everything on the dashboard's summary tabs
//   GET  /api/hefz/admin/users        all users with their summary
//   GET  /api/hefz/admin/user?id=     one user: summary and last sessions
// ADMIN_WEB=0 in tadabbor.env closes the dashboard to the internet (then it opens only through an SSH tunnel).
// (Handler bodies live in hefz_statlib.js: PocketBase runs each handler in its own context.)

routerAdd("POST", "/api/hefz/ping", (e) => require(`${__hooks}/hefz_statlib.js`).ping(e), $apis.requireAuth("users"));

routerAdd("GET", "/api/hefz/admin", (e) => {
  const S = require(`${__hooks}/hefz_statlib.js`);
  if (!S.allowed(e)) return e.json(404, {status: 404, message: "not found", data: {}});
  const h = e.response.header();
  h.set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  h.set("X-Frame-Options", "DENY"); h.set("Referrer-Policy", "no-referrer"); h.set("X-Robots-Tag", "noindex, nofollow"); h.set("Cache-Control", "no-store");
  return e.html(200, toString($os.readFile(`${__hooks}/admin.html`)));
});

routerAdd("POST", "/api/hefz/admin/login", (e) => require(`${__hooks}/hefz_statlib.js`).login(e));

routerAdd("GET", "/api/hefz/admin/{what}", (e) => {
  const S = require(`${__hooks}/hefz_statlib.js`);
  e.response.header().set("Cache-Control", "no-store");
  if (!S.check(e)) return e.json(401, {status: 401, message: "sign in again", data: {}});
  const what = e.request.pathValue("what");
  if (what === "stats") { S.refreshAll(100); return S.stats(e); }
  if (what === "users") return S.userList(e);
  if (what === "user") return S.userOne(e);
  return e.json(404, {status: 404, message: "not found", data: {}});
});

// Keep the per-user summary in step with the synced progress
onRecordAfterCreateSuccess((e) => { e.next(); try { require(`${__hooks}/hefz_statlib.js`).refreshUser(e.record); } catch (x) { $app.logger().error("ustats", "error", String(x)); } }, "hefz_sync");
onRecordAfterUpdateSuccess((e) => { e.next(); try { require(`${__hooks}/hefz_statlib.js`).refreshUser(e.record); } catch (x) { $app.logger().error("ustats", "error", String(x)); } }, "hefz_sync");

// Summaries for records synced before this update; old sessions (STATS_KEEP_DAYS, default 400) are removed
cronAdd("hefz_stats", "7 * * * *", () => {
  const S = require(`${__hooks}/hefz_statlib.js`);
  S.refreshAll(500);
  const keep = Math.max(30, parseInt(S.env("STATS_KEEP_DAYS", "400"), 10) || 400);
  $app.db().newQuery("DELETE FROM hefz_sessions WHERE day < {:d}").bind({d: S.iranDate(Date.now() - keep * 864e5)}).execute();
});
