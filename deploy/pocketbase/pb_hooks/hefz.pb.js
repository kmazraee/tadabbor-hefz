/// <reference path="../pb_data/types.d.ts" />
// Extra sign-in routes for the Tadabbor app (PocketBase JS hooks).
//   GET  /api/hefz/methods            which sign-in ways this server offers: {email, phone, google}
//   POST /api/hefz/otp/request        {phone}        -> sends a one-time code by SMS
//   POST /api/hefz/otp/verify         {phone, code}  -> the usual PocketBase auth response {token, record}
//   GET  /api/hefz/oauth-done         Google sends the browser back here; the code is kept for the app to collect
//   GET  /api/hefz/oauth-claim?state= the app collects that code (then calls auth-with-oauth2 itself, with its PKCE verifier)
// Google is set up from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on every start.

onBootstrap((e) => {
  e.next();
  const L = require(`${__hooks}/hefz_lib.js`);
  const users = e.app.findCollectionByNameOrId("users");
  const want = L.googleOn();
  const has = users.oauth2.enabled && users.oauth2.providers.some(p => p.name === "google" && p.clientId === L.env("GOOGLE_CLIENT_ID"));
  if (want === has) return;
  unmarshal({oauth2: want ? {enabled: true, mappedFields: {name: "name", avatarURL: ""},
    providers: [{name: "google", clientId: L.env("GOOGLE_CLIENT_ID"), clientSecret: L.env("GOOGLE_CLIENT_SECRET")}]}
    : {enabled: false, providers: []}}, users);
  e.app.save(users);
});

routerAdd("GET", "/api/hefz/methods", (e) => {
  const L = require(`${__hooks}/hefz_lib.js`);
  return e.json(200, {email: true, phone: L.smsOn(), google: L.googleOn()});
});

routerAdd("POST", "/api/hefz/otp/request", (e) => {
  const L = require(`${__hooks}/hefz_lib.js`), c = L.cfg();
  if (!L.smsOn()) return e.json(404, {status: 404, message: "SMS sign-in is off", data: {}});
  const phone = L.normPhone((e.requestInfo().body || {}).phone);
  if (!phone) return e.json(400, {status: 400, message: "invalid phone", data: {phone: {code: "invalid_phone"}}});
  const now = Date.now();
  let rec = L.findOne("hefz_otps", "phone", phone);
  if (!rec) { rec = new Record($app.findCollectionByNameOrId("hefz_otps")); rec.set("phone", phone); rec.set("window", now); }
  const wait = rec.getInt("sent") + c.gap - now;
  if (wait > 0) return e.json(429, {status: 429, message: "wait", data: {wait: Math.ceil(wait / 1000)}});
  if (now - rec.getInt("window") > 3600000) { rec.set("window", now); rec.set("sends", 0); }
  if (rec.getInt("sends") >= c.perWindow) return e.json(429, {status: 429, message: "too many", data: {wait: Math.ceil((rec.getInt("window") + 3600000 - now) / 1000)}});
  if (!L.dailyOk()) return e.json(503, {status: 503, message: "daily SMS limit reached", data: {}});
  const code = $security.randomStringWithAlphabet(c.len, "0123456789");
  try { L.sendSms(phone, code); } catch (err) { return e.json(502, {status: 502, message: "SMS could not be sent", data: {}}); }
  rec.set("hash", L.codeHash(phone, code)); rec.set("tries", 0); rec.set("expires", now + c.ttl);
  rec.set("sent", now); rec.set("sends", rec.getInt("sends") + 1);
  $app.save(rec);
  return e.json(200, {ok: true, len: c.len, ttl: Math.round(c.ttl / 1000), resend: Math.round(c.gap / 1000)});
});

routerAdd("POST", "/api/hefz/otp/verify", (e) => {
  const L = require(`${__hooks}/hefz_lib.js`), c = L.cfg();
  const body = e.requestInfo().body || {}, phone = L.normPhone(body.phone);
  const code = L.digits(body.code).replace(/\D/g, "");
  const bad = (k) => e.json(400, {status: 400, message: "invalid code", data: {code: {code: k}}});
  if (!phone || !code) return bad("invalid_code");
  const rec = L.findOne("hefz_otps", "phone", phone);
  if (!rec || !rec.getString("hash") || rec.getInt("expires") < Date.now()) return bad("expired");
  if (rec.getInt("tries") >= c.tries) return bad("too_many_tries");
  if (!$security.equal(rec.getString("hash"), L.codeHash(phone, code))) {
    rec.set("tries", rec.getInt("tries") + 1); $app.save(rec);
    return bad(rec.getInt("tries") >= c.tries ? "too_many_tries" : "wrong_code");
  }
  rec.set("hash", ""); rec.set("expires", 0); $app.save(rec);     // one use only; the send counters stay
  let user = L.findOne("users", "phone", phone);
  if (!user) {
    user = new Record($app.findCollectionByNameOrId("users"));
    user.set("phone", phone);
    user.setPassword($security.randomString(40));   // never used: this account signs in by SMS only
    user.setVerified(true);
    $app.save(user);
  }
  return $apis.recordAuthResponse(e, user, "otp", null);
});

// Google -> here (redirect_uri). Works for the web copy (new tab) and the Android app (system browser).
const oauthDone = (e) => {
  const L = require(`${__hooks}/hefz_lib.js`);
  const info = e.requestInfo(), q = Object.assign({}, info.query || {}, info.body || {});
  const state = String(q.state || "").slice(0, 100);
  if (!state) return e.html(400, L.page("خطا", "درخواست ورود ناقص است. دوباره از برنامه امتحان کنید."));
  let rec = L.findOne("hefz_oauth", "state", state);
  if (!rec) { rec = new Record($app.findCollectionByNameOrId("hefz_oauth")); rec.set("state", state); }
  rec.set("code", String(q.code || "").slice(0, 2000)); rec.set("error", String(q.error || "").slice(0, 200)); rec.set("at", Date.now());
  $app.save(rec);
  return q.error ? e.html(200, L.page("ورود انجام نشد", "ورود با گوگل لغو شد. به برنامه برگردید و دوباره امتحان کنید."))
                 : e.html(200, L.page("ورود با گوگل انجام شد", "به برنامه «حفظ تدبری قرآن» برگردید؛ ورود شما آنجا کامل می‌شود."));
};
routerAdd("GET", "/api/hefz/oauth-done", (e) => oauthDone(e));
routerAdd("POST", "/api/hefz/oauth-done", (e) => oauthDone(e));

routerAdd("GET", "/api/hefz/oauth-claim", (e) => {
  const L = require(`${__hooks}/hefz_lib.js`);
  const state = String(e.request.url.query().get("state") || "");
  const rec = state.length >= 20 ? L.findOne("hefz_oauth", "state", state) : null;
  if (!rec || Date.now() - rec.getInt("at") > 600000) return e.json(404, {status: 404, message: "not yet", data: {}});
  const out = {code: rec.getString("code"), error: rec.getString("error")};
  $app.delete(rec);
  return e.json(200, out);
});

// Old one-time codes and unclaimed Google codes
cronAdd("hefz_cleanup", "*/15 * * * *", () => {
  const now = Date.now();
  $app.db().newQuery("DELETE FROM hefz_oauth WHERE at < {:t}").bind({t: now - 600000}).execute();
  $app.db().newQuery("DELETE FROM hefz_otps WHERE expires < {:t} AND sent < {:w}").bind({t: now, w: now - 3600000}).execute();
});
