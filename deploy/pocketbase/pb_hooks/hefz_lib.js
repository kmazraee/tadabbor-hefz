// Helpers for hefz.pb.js (PocketBase runs each hook in its own context, so shared code is loaded with require()).
// Settings come from environment variables (see deploy/vps/tadabbor.env.example).

const env = (k, d) => { const v = $os.getenv(k); return v === "" ? (d === undefined ? "" : d) : v; };
const num = (k, d) => { const v = parseInt(env(k, ""), 10); return isNaN(v) ? d : v; };

const FA = "۰۱۲۳۴۵۶۷۸۹", AR = "٠١٢٣٤٥٦٧٨٩";
const digits = s => String(s || "").replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => AR.indexOf(d));
// Any common way of writing an Iranian mobile number -> 09xxxxxxxxx, or "" when it is not one
function normPhone(s) {
  let p = digits(s).replace(/[\s\-().]/g, "");
  if (p.indexOf("+98") === 0) p = "0" + p.slice(3);
  else if (p.indexOf("0098") === 0) p = "0" + p.slice(4);
  else if (p.indexOf("98") === 0 && p.length === 12) p = "0" + p.slice(2);
  else if (p.indexOf("9") === 0 && p.length === 10) p = "0" + p;
  return /^09[0-9]{9}$/.test(p) ? p : "";
}

const cfg = () => ({
  provider: env("SMS_PROVIDER", "log").toLowerCase(),
  ttl: num("OTP_TTL", 180) * 1000,           // code lifetime
  gap: num("OTP_RESEND", 60) * 1000,         // wait between two SMS to one number
  perWindow: num("OTP_MAX_PER_HOUR", 5),     // SMS per number per hour
  tries: 5,                                  // wrong codes before a new one is needed
  daily: num("SMS_DAILY_MAX", 300),          // all SMS per day (protects the SMS credit)
  len: num("OTP_LENGTH", 5),
});

function secret() {
  const s = env("OTP_SECRET");
  if (s.length < 20) throw new Error("OTP_SECRET is missing or shorter than 20 characters");
  return s;
}
const codeHash = (phone, code) => $security.hs256(phone + ":" + code, secret());

// Send the code. Each provider uses its "verify / template" API, which Iranian operators deliver quickly
// and which works on numbers that block advertising SMS.
function sendSms(phone, code) {
  const c = cfg(), key = env("SMS_API_KEY"), tpl = env("SMS_TEMPLATE");
  if (c.provider === "log") { console.log("[hefz] SMS_PROVIDER=log, not sent: phone " + phone + " code " + code); return; }   // shows in journalctl
  let r, ok = false;
  if (c.provider === "kavenegar") {
    r = $http.send({method: "GET", timeout: 15,
      url: "https://api.kavenegar.com/v1/" + encodeURIComponent(key) + "/verify/lookup.json?receptor=" + phone + "&token=" + code + "&template=" + encodeURIComponent(tpl)});
    ok = r.statusCode === 200 && r.json && r.json.return && r.json.return.status === 200;
  } else if (c.provider === "smsir") {
    r = $http.send({method: "POST", url: "https://api.sms.ir/v1/send/verify", timeout: 15,
      headers: {"Content-Type": "application/json", "Accept": "text/plain", "x-api-key": key},
      body: JSON.stringify({mobile: phone, templateId: parseInt(tpl, 10), parameters: [{name: env("SMS_PARAM", "CODE"), value: code}]})});
    ok = r.statusCode === 200 && r.json && r.json.status === 1;
  } else throw new Error("unknown SMS_PROVIDER " + c.provider);
  if (!ok) {
    $app.logger().error("SMS send failed", "provider", c.provider, "status", r.statusCode, "body", toString(r.body).slice(0, 300));
    throw new Error("sms failed");
  }
}

// One counter per day for all SMS, kept in memory (resets on restart, which only makes it more lenient)
function dailyOk() {
  const k = "hefz_sms_" + new Date().toISOString().slice(0, 10), n = $app.store().get(k) || 0;
  if (n >= cfg().daily) return false;
  $app.store().set(k, n + 1);
  return true;
}

function findOne(col, field, value) {
  try { return $app.findFirstRecordByData(col, field, value); } catch (e) { return null; }
}

const googleOn = () => env("GOOGLE_CLIENT_ID") !== "" && env("GOOGLE_CLIENT_SECRET") !== "";
const smsOn = () => cfg().provider !== "log" || env("SMS_ALLOW_LOG") === "1";

const page = (title, text, btn) => `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px/1.9 system-ui,Tahoma,sans-serif;background:#f6f3ec;color:#222;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}
@media(prefers-color-scheme:dark){body{background:#16181b;color:#eee}}main{max-width:420px}h1{font-size:1.3em}
.go{display:inline-block;margin-top:8px;padding:12px 28px;border-radius:12px;background:#1f6f5c;color:#fff;text-decoration:none;font-weight:700}</style></head>
<body><main><h1>${title}</h1><p>${text}</p>${btn ? `<a class="go" id="go" href="${btn.href}">${btn.label}</a>` : ""}</main>
${btn && btn.auto ? `<script>setTimeout(function(){location.replace(document.getElementById("go").href)},300)</script>` : ""}</body></html>`;

// Where the browser goes after Google: the app asks for it (oauth-ret) just before it opens Google.
//   "app"        -> back into the Android app (intent link to ir.tadabbor.hefz); the app then finishes the sign-in
//   https://...  -> the web copy's own page (same tab); it finishes the sign-in when it loads
// Only the app's own sites may be named (HEFZ_RETURN_HOSTS adds more, comma-separated).
const APP_PKG = "ir.tadabbor.hefz", APP_SCHEME = "tadabborhefz";
function retOk(ret) {
  if (ret === "app") return true;
  const m = /^https:\/\/([^\/?#:]+)(:\d+)?(\/[^#]*)?$/.exec(String(ret || ""));
  if (!m || ret.length > 500) return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^#]*)?$/.test(String(ret || ""));
  const h = m[1].toLowerCase();
  const allow = ["ganjineh-tadabbor.ir", "kmazraee.github.io", "hefz-ai.pages.dev"].concat(env("HEFZ_RETURN_HOSTS").split(",").map(x => x.trim().toLowerCase()).filter(Boolean));
  return allow.some(a => h === a || h.slice(-(a.length + 1)) === "." + a);
}
const retKey = state => "hefz_ret_" + state;
function retSet(state, ret) { $app.store().set(retKey(state), JSON.stringify({ret, at: Date.now()})); }
function retGet(state) {
  try { const v = JSON.parse($app.store().get(retKey(state)) || "null"); return v && Date.now() - v.at < 900000 ? v.ret : ""; } catch (e) { return ""; }
}
const appLink = (state, fallback) => `intent://oauth?state=${encodeURIComponent(state)}#Intent;scheme=${APP_SCHEME};package=${APP_PKG}` +
  (fallback ? `;S.browser_fallback_url=${encodeURIComponent(fallback)}` : "") + ";end";

// Google redirects the browser here after sign-in; the code waits for the app to collect it (oauth-claim),
// and the browser is sent straight back to the app (or the web page) that started the sign-in.
function oauthDone(e) {
  const info = e.requestInfo(), q = Object.assign({}, info.query || {}, info.body || {});
  const state = String(q.state || "").slice(0, 100);
  if (!state) return e.html(400, page("خطا", "درخواست ورود ناقص است. دوباره از برنامه امتحان کنید."));
  const ret = retGet(state);
  if (q.shown === "1") {                                  // the app could not be opened by itself: offer a button
    return e.html(200, page("ورود با گوگل انجام شد", "برای تمام شدن ورود، دکمهٔ زیر را بزنید.", {href: appLink(state), label: "بازگشت به برنامه"}));
  }
  let rec = findOne("hefz_oauth", "state", state);
  if (!rec) { rec = new Record($app.findCollectionByNameOrId("hefz_oauth")); rec.set("state", state); }
  rec.set("code", String(q.code || "").slice(0, 2000)); rec.set("error", String(q.error || "").slice(0, 200)); rec.set("at", Date.now());
  $app.save(rec);
  if (ret === "app") {
    const self = env("HEFZ_PUBLIC_URL", "https://" + e.request.host).replace(/\/+$/, "") + "/api/hefz/oauth-done?shown=1&state=" + encodeURIComponent(state);
    return e.redirect(302, appLink(state, self));
  }
  if (ret) return e.redirect(302, ret);
  // Started by an older copy of the app that did not say where to return
  return q.error ? e.html(200, page("ورود انجام نشد", "ورود با گوگل لغو شد. به برنامه برگردید و دوباره امتحان کنید."))
                 : e.html(200, page("ورود با گوگل انجام شد", "به برنامه «حفظ تدبری قرآن» برگردید؛ ورود شما آنجا کامل می‌شود."));
}

module.exports = {env, digits, normPhone, cfg, codeHash, sendSms, dailyOk, findOne, googleOn, smsOn, page, oauthDone, retOk, retSet, retKey};
