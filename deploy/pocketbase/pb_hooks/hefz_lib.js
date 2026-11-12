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

const page = (title, text) => `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px/1.9 system-ui,Tahoma,sans-serif;background:#f6f3ec;color:#222;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}
@media(prefers-color-scheme:dark){body{background:#16181b;color:#eee}}main{max-width:420px}h1{font-size:1.3em}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main><script>setTimeout(function(){try{window.close()}catch(e){}},1500)</script></body></html>`;

module.exports = {env, digits, normPhone, cfg, codeHash, sendSms, dailyOk, findOne, googleOn, smsOn, page};
