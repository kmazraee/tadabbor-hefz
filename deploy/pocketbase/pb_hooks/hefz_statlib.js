// Helpers for hefz_stats.pb.js: usage reports, per-user summaries and the admin dashboard's data.
// (PocketBase runs each hook in its own context, so shared code is loaded with require().)

const env = (k, d) => { const v = $os.getenv(k); return v === "" ? (d === undefined ? "" : d) : v; };
const IRAN = 210 * 60000;                       // Iran time is UTC+3:30 all year (no daylight saving since 2022)
const iranDate = ms => new Date(ms + IRAN).toISOString().slice(0, 10);
const iranHour = ms => new Date(ms + IRAN).getUTCHours();
const dayNum = s => Math.round(Date.parse(s + "T00:00:00Z") / 864e5);
const numDay = n => new Date(n * 864e5).toISOString().slice(0, 10);
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>"]/g, "").trim().slice(0, max);

// Country of the device's time zone: shows where users really are when they connect through a VPN
const TZC = {"Asia/Tehran": "IR", "Asia/Dubai": "AE", "Asia/Muscat": "OM", "Asia/Qatar": "QA", "Asia/Bahrain": "BH", "Asia/Kuwait": "KW",
  "Asia/Riyadh": "SA", "Asia/Baghdad": "IQ", "Asia/Kabul": "AF", "Asia/Karachi": "PK", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN",
  "Asia/Baku": "AZ", "Asia/Yerevan": "AM", "Asia/Tbilisi": "GE", "Asia/Dushanbe": "TJ", "Asia/Tashkent": "UZ", "Asia/Ashgabat": "TM",
  "Asia/Beirut": "LB", "Asia/Damascus": "SY", "Asia/Amman": "JO", "Asia/Kuala_Lumpur": "MY", "Asia/Jakarta": "ID", "Asia/Shanghai": "CN",
  "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Singapore": "SG", "Asia/Bangkok": "TH", "Europe/Istanbul": "TR", "Europe/Moscow": "RU",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE", "Europe/Paris": "FR", "Europe/Amsterdam": "NL", "Europe/Brussels": "BE",
  "Europe/Vienna": "AT", "Europe/Zurich": "CH", "Europe/Rome": "IT", "Europe/Madrid": "ES", "Europe/Stockholm": "SE", "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Warsaw": "PL", "Europe/Kiev": "UA", "Europe/Kyiv": "UA", "Europe/Athens": "GR",
  "Europe/Budapest": "HU", "Europe/Prague": "CZ", "Europe/Bucharest": "RO", "Europe/Lisbon": "PT", "Europe/Minsk": "BY",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Phoenix": "US", "America/Los_Angeles": "US",
  "America/Anchorage": "US", "America/Detroit": "US", "Pacific/Honolulu": "US", "America/Toronto": "CA", "America/Vancouver": "CA",
  "America/Edmonton": "CA", "America/Winnipeg": "CA", "America/Halifax": "CA", "America/Sao_Paulo": "BR", "America/Mexico_City": "MX",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU", "Australia/Perth": "AU", "Australia/Adelaide": "AU",
  "Pacific/Auckland": "NZ", "Africa/Cairo": "EG", "Africa/Johannesburg": "ZA"};

function findOne(col, field, value) {
  try { return $app.findFirstRecordByData(col, field, value); } catch (e) { return null; }
}
function hdr(e, k) { try { return e.request.header.get(k) || ""; } catch (x) { return ""; } }
// Cloudflare sends header values as raw UTF-8 bytes, which Go hands over as Latin-1 characters
function utf8(s) { try { return decodeURIComponent(escape(s)); } catch (x) { return s; } }

// ---------- POST /api/hefz/ping (signed-in user) ----------
function ping(e) {
  const b = e.requestInfo().body || {}, now = Date.now(), uid = e.auth.id;
  const sid = String(b.sid || "");
  if (!/^[a-f0-9]{16,40}$/.test(sid)) return e.json(400, {status: 400, message: "bad sid", data: {}});
  const secs = Math.max(0, Math.min(parseInt(b.secs, 10) || 0, 6 * 3600));
  let rec = findOne("hefz_sessions", "sid", sid);
  if (rec && rec.getString("user") !== uid) return e.json(403, {status: 403, message: "forbidden", data: {}});
  if (!rec) {
    rec = new Record($app.findCollectionByNameOrId("hefz_sessions"));
    rec.set("user", uid); rec.set("sid", sid); rec.set("start", now - secs * 1000);
    rec.set("day", iranDate(now)); rec.set("hour", iranHour(now));
    let cc = clean(hdr(e, "CF-IPCountry"), 2).toUpperCase();
    if (!/^[A-Z][A-Z0-9]$/.test(cc) || cc === "XX") cc = "";
    rec.set("country", cc);
    rec.set("region", clean(utf8(hdr(e, "CF-Region")), 60));
    rec.set("city", clean(utf8(hdr(e, "CF-IPCity")), 60));
    const tz = clean(b.tz, 40); rec.set("tz", tz); rec.set("tzc", TZC[tz] || "");
  }
  rec.set("plat", ["android", "web", "pwa"].indexOf(b.plat) >= 0 ? b.plat : "");
  rec.set("ver", clean(b.ver, 16)); rec.set("os", clean(b.os, 24)); rec.set("br", clean(b.br, 16)); rec.set("dev", clean(b.dev, 40));
  // Never more than the session's real length (plus some slack for a clock or a late report)
  const most = Math.round((now - rec.getInt("start")) / 1000) + 300;
  rec.set("secs", Math.max(rec.getInt("secs"), Math.min(secs, most)));
  rec.set("last", now);
  $app.save(rec);
  return e.json(200, {ok: true});
}

// ---------- per-user summary of the synced progress ----------
let SIY = null;
function siyaq() { if (!SIY) SIY = require(`${__hooks}/hefz_siyaq.js`); return SIY; }
function parse(rec, f) { try { const v = JSON.parse(rec.getString(f) || "null"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }

function summarize(p, cfg) {
  const S = siyaq(), items = p.items || {}, notes = p.notes || {};
  const size = k => { const a = String(k).split(":"), s = S[+a[0] - 1]; return s ? (s[1][+a[1] - 1] || 0) : 0; };
  const per = {}, mastery = [0, 0, 0, 0, 0], lv = [0, 4, 10, 30, 90];
  const at = sn => per[sn] || (per[sn] = [+sn, 0, 0]);
  let memS = 0, memA = 0, learn = 0, tadS = 0, tadA = 0;
  for (const k in items) {
    const it = items[k] || {};
    if (it.pre) continue;                                   // marked as known before using the app
    if ((it.stage || 0) >= 5) {
      memS++; memA += size(k); at(k.split(":")[0])[1]++;
      let l = 1; lv.forEach((min, i) => { if ((it.ivl || 1) >= min) l = i + 1; }); mastery[l - 1]++;
    } else if (it.stage) learn++;
  }
  for (const k in notes) { const n = notes[k] || {}; if (n.done && !n.pre) { tadS++; tadA += size(k); at(k.split(":")[0])[2]++; } }
  let surahsMem = 0, surahsTad = 0;
  const surahs = Object.keys(per).map(sn => { const r = per[sn], all = (S[+sn - 1] || ["", []])[1].length; if (all && r[1] >= all) surahsMem++; if (all && r[2] >= all) surahsTad++; return [r[0], r[1], r[2], all]; });
  const sum = {a: 0, r: 0, ra: 0, tr: 0, q: 0, hq: 0}, days = {}, log = p.log || {};
  const today = Math.floor((Date.now() + IRAN) / 864e5);
  let logDays = 0, lastLog = 0;
  for (const d in log) {
    const x = log[d] || {}; let n = 0;
    for (const f in sum) sum[f] += +x[f] || 0;
    for (const f of ["m", "t", "r", "tr", "q", "hq", "w"]) n += +x[f] || 0;
    if (n > 0) { logDays++; lastLog = Math.max(lastLog, +d); if (+d > today - 120) days[numDay(+d)] = n; }
  }
  const hq = Array.isArray(p.hq) ? p.hq : [];
  const last = Math.max(+p.lastActive || 0, lastLog);
  return {
    name: clean(cfg.name, 80), mem_siyaq: memS, mem_ayat: memA, learn_siyaq: learn, tad_siyaq: tadS, tad_ayat: tadA,
    surahs_mem: surahsMem, surahs_tad: surahsTad, new_ayat: sum.a, reviews: sum.r, rev_ayat: sum.ra, tad_rev: sum.tr,
    quizzes: sum.q + Math.max(sum.hq, hq.length), quiz_avg: hq.length ? Math.round(hq.reduce((a, x) => a + (+x.p || 0), 0) / hq.length) : 0,
    streak: last >= today - 1 ? (+p.streak || 0) : 0, best: +p.best || +p.streak || 0, last_day: last ? numDay(last) : "",
    log_days: logDays, day_goal: +cfg.dayGoal || 0,
    vnotes: Object.keys(p.vnote || {}).length, bms: Object.keys(p.bm || {}).length,
    lessons: Object.keys(p.watched || {}).filter(k => p.watched[k]).length, levels: Object.keys(p.passed || {}).length,
    days, mastery, surahs,
    prefs: {reciter: clean(cfg.reciter, 40), trans: clean(cfg.trans, 30), tafsir: clean(cfg.tafsir, 30), theme: clean(cfg.theme, 12),
      remind: !!cfg.remind, tip: !!cfg.tipOn, goal: !!p.goal},
  };
}
function refreshUser(sync) {
  const uid = sync.getString("user");
  let rec = findOne("hefz_ustats", "user", uid);
  const ms = Date.parse(String(sync.getString("updated")).replace(" ", "T")) || Date.now();
  if (rec && rec.getInt("synced") === ms) return;
  if (!rec) { rec = new Record($app.findCollectionByNameOrId("hefz_ustats")); rec.set("user", uid); }
  const s = summarize(parse(sync, "progress"), parse(sync, "settings"));
  for (const k in s) rec.set(k, s[k]);
  rec.set("synced", ms);
  $app.save(rec);
}
// Summaries missing or older than the synced record (first start after the update, or a failed hook)
function refreshAll(limit) {
  const rows = arrayOf(new DynamicModel({id: ""}));
  $app.db().newQuery("SELECT s.id FROM hefz_sync s LEFT JOIN hefz_ustats u ON u.user = s.user WHERE u.id IS NULL OR u.synced < CAST(strftime('%s', s.updated) AS INTEGER) * 1000 - 1000 LIMIT " + (limit || 200)).all(rows);
  let n = 0;
  for (const r of rows) { try { refreshUser($app.findRecordById("hefz_sync", r.id)); n++; } catch (e) { $app.logger().error("ustats refresh failed", "id", r.id, "error", String(e)); } }
  return n;
}

// ---------- admin sign-in (the PocketBase superuser's email and password) ----------
function secret() {
  const s = env("OTP_SECRET");
  if (s.length < 20) throw new Error("OTP_SECRET is missing or shorter than 20 characters");
  return s + ":admin-dashboard";
}
// Dashboard only: open from the internet unless ADMIN_WEB=0 (then only through an SSH tunnel to the server itself)
function allowed(e) {
  if (env("ADMIN_WEB", "1") !== "0") return true;
  const ip = e.realIP();
  return ip === "127.0.0.1" || ip === "::1";
}
const sign = (su, exp) => $security.hs256(su.id + "." + exp, secret() + su.tokenKey());
function login(e) {
  if (!allowed(e)) return e.json(404, {status: 404, message: "not found", data: {}});
  const st = $app.store(), now = Date.now(), lock = st.get("hefz_admin_fail") || {n: 0, t: now};
  if (now - lock.t > 900000) { lock.n = 0; lock.t = now; }
  if (lock.n >= 10) return e.json(429, {status: 429, message: "locked", data: {wait: Math.ceil((lock.t + 900000 - now) / 1000)}});
  const b = e.requestInfo().body || {};
  let su = null;
  try { su = $app.findAuthRecordByEmail("_superusers", String(b.email || "").trim().toLowerCase()); } catch (x) {}
  if (!su || !su.validatePassword(String(b.password || ""))) {
    lock.n++; st.set("hefz_admin_fail", lock);
    $app.logger().warn("admin dashboard: wrong sign-in", "ip", e.realIP());
    return e.json(400, {status: 400, message: "wrong email or password", data: {}});
  }
  const exp = now + 12 * 3600000;
  return e.json(200, {token: su.id + "." + exp + "." + sign(su, exp), exp});
}
// The dashboard's own token: read-only, 12 hours, void once the admin's password changes
function check(e) {
  if (!allowed(e)) return false;
  const p = hdr(e, "X-Admin-Token").split(".");
  if (p.length !== 3 || !(+p[1] > Date.now())) return false;
  let su = null;
  try { su = $app.findRecordById("_superusers", p[0]); } catch (x) { return false; }
  return $security.equal(p[2], sign(su, +p[1]));
}

// ---------- dashboard data ----------
function q(sql, shape, params) {
  const rows = arrayOf(new DynamicModel(shape));
  $app.db().newQuery(sql).bind(params || {}).all(rows);
  return rows.map(r => { const o = {}; for (const k in shape) o[k] = r[k]; return o; });
}
const one = (sql, params) => (q(sql, {n: 0}, params)[0] || {n: 0}).n;
const top = (col, from, lim) => q(`SELECT COALESCE(NULLIF(${col}, ''), '?') k, COUNT(DISTINCT user) n FROM hefz_sessions WHERE day >= {:from} GROUP BY 1 ORDER BY n DESC LIMIT ${lim || 20}`, {k: "", n: 0}, {from});
const USER_DAY = "date(replace(created, 'Z', ''), '+210 minutes')";

function stats(e) {
  const days = Math.max(7, Math.min(parseInt(e.request.url.query().get("days"), 10) || 30, 365));
  const now = Date.now(), t = iranDate(now), tn = dayNum(t), from = numDay(tn - days + 1);
  const d7 = numDay(tn - 6), d30 = numDay(tn - 29), p7 = numDay(tn - 13);
  const out = {now, today: t, days, from};

  const total = one("SELECT COUNT(*) n FROM users");
  const google = one("SELECT COUNT(DISTINCT recordRef) n FROM _externalAuths WHERE provider = 'google' AND collectionRef = (SELECT id FROM _collections WHERE name = 'users')");
  const phone = one("SELECT COUNT(*) n FROM users WHERE phone != ''");
  out.users = {
    total, google, phone, email: Math.max(0, total - google - phone),
    synced: one("SELECT COUNT(*) n FROM hefz_sync"),
    learners: one("SELECT COUNT(*) n FROM hefz_ustats WHERE mem_siyaq + tad_siyaq + learn_siyaq > 0"),
    newToday: one(`SELECT COUNT(*) n FROM users WHERE ${USER_DAY} = {:t}`, {t}),
    new7: one(`SELECT COUNT(*) n FROM users WHERE ${USER_DAY} >= {:d}`, {d: d7}),
    newPrev7: one(`SELECT COUNT(*) n FROM users WHERE ${USER_DAY} >= {:a} AND ${USER_DAY} < {:b}`, {a: p7, b: d7}),
    newRange: one(`SELECT COUNT(*) n FROM users WHERE ${USER_DAY} >= {:d}`, {d: from}),
  };
  const act = d => one("SELECT COUNT(DISTINCT user) n FROM hefz_sessions WHERE day >= {:d}", {d});
  out.active = {today: act(t), d7: act(d7), d30: act(d30), prev7: one("SELECT COUNT(DISTINCT user) n FROM hefz_sessions WHERE day >= {:a} AND day < {:b}", {a: p7, b: d7}), range: act(from)};
  out.tracking = (q("SELECT COALESCE(MIN(day), '') d, COUNT(*) n FROM hefz_sessions", {d: "", n: 0})[0]) || {d: "", n: 0};

  // Day by day
  const ses = {}, nu = {}, learn = {};
  q("SELECT day, COUNT(DISTINCT user) dau, COUNT(*) sess, COALESCE(SUM(secs), 0) secs FROM hefz_sessions WHERE day >= {:from} GROUP BY day", {day: "", dau: 0, sess: 0, secs: 0}, {from}).forEach(r => { ses[r.day] = r; });
  q(`SELECT ${USER_DAY} day, COUNT(*) n FROM users WHERE ${USER_DAY} >= {:from} GROUP BY 1`, {day: "", n: 0}, {from}).forEach(r => { nu[r.day] = r.n; });
  // Learning days come from the synced progress, so they reach back before usage tracking began
  const lrows = q("SELECT COALESCE(days, '{}') j FROM hefz_ustats", {j: ""});
  let learn7 = 0, learn30 = 0;
  for (const r of lrows) {
    let m = {}; try { m = JSON.parse(r.j) || {}; } catch (x) {}
    let a7 = false, a30 = false;
    for (const d in m) { if (d >= from) learn[d] = (learn[d] || 0) + 1; if (d >= d7) a7 = true; if (d >= d30) a30 = true; }
    if (a7) learn7++; if (a30) learn30++;
  }
  out.active.learn7 = learn7; out.active.learn30 = learn30;
  out.series = [];
  for (let n = dayNum(from); n <= tn; n++) {
    const d = numDay(n), s = ses[d] || {};
    out.series.push({d, dau: s.dau || 0, sess: s.sess || 0, secs: s.secs || 0, nu: nu[d] || 0, learn: learn[d] || 0});
  }
  const tm = q("SELECT COUNT(*) n, COALESCE(SUM(secs), 0) secs, COUNT(DISTINCT user || day) ud FROM hefz_sessions WHERE day >= {:from} AND secs > 0", {n: 0, secs: 0, ud: 0}, {from})[0];
  out.time = {sessions: tm.n, secs: tm.secs, perSession: tm.n ? Math.round(tm.secs / tm.n) : 0, perUserDay: tm.ud ? Math.round(tm.secs / tm.ud) : 0};
  out.hours = Array(24).fill(0);
  q("SELECT hour, COUNT(*) n FROM hefz_sessions WHERE day >= {:from} GROUP BY hour", {hour: 0, n: 0}, {from}).forEach(r => { if (r.hour >= 0 && r.hour < 24) out.hours[r.hour] = r.n; });
  // Saturday first (Iranian week)
  out.weekdays = Array(7).fill(0);
  q("SELECT CAST(strftime('%w', day) AS INTEGER) w, COUNT(*) n FROM hefz_sessions WHERE day >= {:from} GROUP BY 1", {w: 0, n: 0}, {from}).forEach(r => { out.weekdays[(r.w + 1) % 7] = r.n; });

  // Where and on what (distinct users in the range)
  out.countries = top("country", from, 30);
  out.tzCountries = top("tzc", from, 30);
  out.cities = q("SELECT COALESCE(NULLIF(country, ''), '?') c, COALESCE(NULLIF(city, ''), '?') city, COALESCE(region, '') region, COUNT(DISTINCT user) n FROM hefz_sessions WHERE day >= {:from} GROUP BY 1, 2 ORDER BY n DESC LIMIT 40", {c: "", city: "", region: "", n: 0}, {from});
  out.platforms = top("plat", from); out.os = top("os", from); out.browsers = top("br", from);
  out.versions = top("ver", from, 15); out.devices = top("dev", from, 20);

  // Retention: of the users who signed up since tracking began, how many came back N days later or after
  const since = out.tracking.d || t;
  const ret = n => q(`SELECT COUNT(*) n, COALESCE(SUM(EXISTS(SELECT 1 FROM hefz_sessions s WHERE s.user = u.id AND s.day >= date(${USER_DAY}, '+${n} days'))), 0) back
    FROM users u WHERE ${USER_DAY} >= {:since} AND ${USER_DAY} <= {:last}`, {n: 0, back: 0}, {since, last: numDay(tn - n)})[0];
  out.retention = {d1: ret(1), d7: ret(7), d30: ret(30)};
  // Weekly cohorts (Saturday to Friday): week 0 = sign-up week
  const sat = n => n - ((n + 5) % 7);           // day number of that week's Saturday (1970-01-01 was a Thursday)
  const w0 = Math.max(sat(dayNum(since)), sat(tn) - 7 * 7);
  const cu = q(`SELECT id, ${USER_DAY} d FROM users WHERE ${USER_DAY} >= {:a}`, {id: "", d: ""}, {a: numDay(w0)});
  const cs = q(`SELECT DISTINCT s.user u, s.day d FROM hefz_sessions s JOIN users x ON x.id = s.user WHERE ${USER_DAY.replace("created", "x.created")} >= {:a}`, {u: "", d: ""}, {a: numDay(w0)});
  const cw = {}, byUser = {};
  cu.forEach(r => { const w = sat(dayNum(r.d)); byUser[r.id] = w; (cw[w] = cw[w] || {size: 0, w: Array(8).fill(0), seen: {}}).size++; });
  cs.forEach(r => { const w = byUser[r.u]; if (w === undefined) return; const k = Math.floor((sat(dayNum(r.d)) - w) / 7); if (k < 0 || k > 7) return; const c = cw[w], key = r.u + ":" + k; if (!c.seen[key]) { c.seen[key] = 1; c.w[k]++; } });
  out.cohorts = Object.keys(cw).map(Number).sort((a, b) => a - b).map(w => ({week: numDay(w), size: cw[w].size, w: cw[w].w.slice(0, Math.floor((tn - w) / 7) + 1)}));

  // Learning (from the synced progress)
  const L = q(`SELECT COALESCE(SUM(mem_ayat), 0) mem_ayat, COALESCE(SUM(mem_siyaq), 0) mem_siyaq, COALESCE(SUM(tad_siyaq), 0) tad_siyaq, COALESCE(SUM(tad_ayat), 0) tad_ayat,
    COALESCE(SUM(surahs_mem), 0) surahs_mem, COALESCE(SUM(surahs_tad), 0) surahs_tad, COALESCE(SUM(reviews), 0) reviews, COALESCE(SUM(rev_ayat), 0) rev_ayat,
    COALESCE(SUM(tad_rev), 0) tad_rev, COALESCE(SUM(quizzes), 0) quizzes, COALESCE(SUM(vnotes), 0) vnotes, COALESCE(SUM(bms), 0) bms,
    COALESCE(SUM(lessons), 0) lessons, COALESCE(MAX(best), 0) best, COALESCE(SUM(day_goal > 0), 0) goals, COUNT(*) users,
    COALESCE(ROUND(AVG(NULLIF(quiz_avg, 0))), 0) quiz_avg FROM hefz_ustats`,
    {mem_ayat: 0, mem_siyaq: 0, tad_siyaq: 0, tad_ayat: 0, surahs_mem: 0, surahs_tad: 0, reviews: 0, rev_ayat: 0, tad_rev: 0, quizzes: 0, vnotes: 0, bms: 0, lessons: 0, best: 0, goals: 0, users: 0, quiz_avg: 0})[0];
  L.streaks = q(`SELECT CASE WHEN streak = 0 THEN 0 WHEN streak < 3 THEN 1 WHEN streak < 7 THEN 2 WHEN streak < 30 THEN 3 ELSE 4 END b, COUNT(*) n FROM hefz_ustats GROUP BY 1`, {b: 0, n: 0});
  L.memBuckets = q(`SELECT CASE WHEN mem_ayat = 0 THEN 0 WHEN mem_ayat < 20 THEN 1 WHEN mem_ayat < 100 THEN 2 WHEN mem_ayat < 500 THEN 3 ELSE 4 END b, COUNT(*) n FROM hefz_ustats GROUP BY 1`, {b: 0, n: 0});
  L.goalDist = q("SELECT day_goal k, COUNT(*) n FROM hefz_ustats WHERE day_goal > 0 GROUP BY 1 ORDER BY 1", {k: 0, n: 0});
  const mast = [0, 0, 0, 0, 0], sur = {}, pref = {reciter: {}, trans: {}, tafsir: {}, theme: {}}, flags = {remind: 0, tip: 0, goal: 0};
  q("SELECT COALESCE(mastery, '[]') m, COALESCE(surahs, '[]') s, COALESCE(prefs, '{}') p FROM hefz_ustats", {m: "", s: "", p: ""}).forEach(r => {
    try { (JSON.parse(r.m) || []).forEach((n, i) => { if (i < 5) mast[i] += +n || 0; }); } catch (x) {}
    try { (JSON.parse(r.s) || []).forEach(a => { const o = sur[a[0]] || (sur[a[0]] = {n: a[0], users: 0, mem: 0, tad: 0, full: 0}); o.users++; if (a[1]) o.mem++; if (a[2]) o.tad++; if (a[3] && a[1] >= a[3]) o.full++; }); } catch (x) {}
    try { const p = JSON.parse(r.p) || {}; for (const k in pref) if (p[k]) pref[k][p[k]] = (pref[k][p[k]] || 0) + 1; for (const k in flags) if (p[k]) flags[k]++; } catch (x) {}
  });
  const S = siyaq();
  L.mastery = mast;
  L.surahs = Object.values(sur).sort((a, b) => b.users - a.users || a.n - b.n).slice(0, 25).map(o => Object.assign(o, {name: (S[o.n - 1] || [""])[0]}));
  L.prefs = {}; for (const k in pref) L.prefs[k] = Object.entries(pref[k]).map(([k2, n]) => ({k: k2, n})).sort((a, b) => b.n - a.n).slice(0, 10);
  L.flags = flags;
  out.learning = L;
  return e.json(200, out);
}

function userList(e) {
  const rows = q(`SELECT u.id, COALESCE(u.email, '') email, COALESCE(u.phone, '') phone, COALESCE(NULLIF(u.name, ''), s.name, '') name, u.created,
      EXISTS(SELECT 1 FROM _externalAuths x WHERE x.recordRef = u.id AND x.provider = 'google') google,
      COALESCE(s.mem_ayat, 0) mem_ayat, COALESCE(s.tad_siyaq, 0) tad_siyaq, COALESCE(s.reviews, 0) reviews, COALESCE(s.streak, 0) streak, COALESCE(s.last_day, '') last_day,
      COALESCE(a.n, 0) sessions, COALESCE(a.secs, 0) secs, COALESCE(a.last, 0) last, COALESCE(a.days, 0) days,
      COALESCE((SELECT country || '|' || city || '|' || plat || '|' || ver || '|' || tzc FROM hefz_sessions z WHERE z.user = u.id ORDER BY z.last DESC LIMIT 1), '') ls
    FROM users u LEFT JOIN hefz_ustats s ON s.user = u.id
    LEFT JOIN (SELECT user, COUNT(*) n, CAST(SUM(secs) AS INTEGER) secs, CAST(MAX(last) AS INTEGER) last, COUNT(DISTINCT day) days FROM hefz_sessions GROUP BY user) a ON a.user = u.id
    ORDER BY u.created DESC LIMIT 5000`,
    {id: "", email: "", phone: "", name: "", created: "", google: 0, mem_ayat: 0, tad_siyaq: 0, reviews: 0, streak: 0, last_day: "", sessions: 0, secs: 0, last: 0, days: 0, ls: ""});
  return e.json(200, {items: rows.map(r => { const l = r.ls.split("|"); delete r.ls; return Object.assign(r, {country: l[0] || "", city: l[1] || "", plat: l[2] || "", ver: l[3] || "", tzc: l[4] || "", via: r.google ? "google" : r.phone ? "phone" : "email"}); })});
}

const USTATS = ["name", "mem_siyaq", "mem_ayat", "learn_siyaq", "tad_siyaq", "tad_ayat", "surahs_mem", "surahs_tad", "new_ayat", "reviews", "rev_ayat",
  "tad_rev", "quizzes", "quiz_avg", "streak", "best", "last_day", "log_days", "day_goal", "vnotes", "bms", "lessons", "levels", "days", "mastery", "surahs", "prefs"];
function userOne(e) {
  const id = String(e.request.url.query().get("id") || "");
  let u = null; try { u = $app.findRecordById("users", id); } catch (x) { return e.json(404, {status: 404, message: "not found", data: {}}); }
  const s = findOne("hefz_ustats", "user", id), sync = findOne("hefz_sync", "user", id);
  const sum = {};
  const JS = ["days", "mastery", "surahs", "prefs"], TXT = ["name", "last_day"];
  if (s) for (const n of USTATS) sum[n] = JS.indexOf(n) >= 0 ? parse(s, n) : TXT.indexOf(n) >= 0 ? s.getString(n) : s.getFloat(n);
  if (sum.surahs && Array.isArray(sum.surahs)) { const S = siyaq(); sum.surahs = sum.surahs.map(a => a.concat([(S[a[0] - 1] || [""])[0]])); }
  const ses = q("SELECT day, hour, secs, plat, ver, os, br, dev, country, region, city, tz FROM hefz_sessions WHERE user = {:id} ORDER BY start DESC LIMIT 200",
    {day: "", hour: 0, secs: 0, plat: "", ver: "", os: "", br: "", dev: "", country: "", region: "", city: "", tz: ""}, {id});
  return e.json(200, {
    id, email: u.getString("email"), phone: u.getString("phone"), name: u.getString("name") || sum.name || "", created: u.getString("created"),
    verified: u.verified(), via: one("SELECT COUNT(*) n FROM _externalAuths WHERE recordRef = {:id} AND provider = 'google'", {id}) ? "google" : u.getString("phone") ? "phone" : "email",
    synced: sync ? sync.getString("updated") : "", stats: sum, sessions: ses,
  });
}

module.exports = {env, ping, refreshUser, refreshAll, login, check, allowed, stats, userList, userOne, iranDate};
