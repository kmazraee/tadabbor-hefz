// ---------- sign-in with an SMS code and with Google (server side: deploy/pocketbase/pb_hooks/hefz.pb.js) ----------
// The login page asks the server which ways it offers (GET /api/hefz/methods) and adds a button for each.
// The Cloudflare Worker and older servers answer 404 there, so only email + password shows, as before.
// Google: the server hands out the Google address (with PKCE); the page opens it in a new tab (web) or the phone's
// browser (app); Google sends the browser back to /api/hefz/oauth-done, and this page collects the code from
// /api/hefz/oauth-claim and finishes with the usual auth-with-oauth2 call. Nothing depends on popups or deep links.
const acctAlt = {m: (() => { try { return JSON.parse(localStorage.getItem("tadabbor-signin-ways")) || {}; } catch (e) { return {}; } })(), timer: 0};
async function acctWays() {
  try { const m = await pb("hefz/methods", {anon: true}); acctAlt.m = m || {}; store("tadabbor-signin-ways", acctAlt.m); }
  catch (e) { if (e.status === 404) { acctAlt.m = {}; store("tadabbor-signin-ways", {}); } }
  return acctAlt.m;
}
const altErr = e => {
  const d = e.data || {}, k = x => d[x] && d[x].code;
  if (k("phone")) return "شماره همراه درست نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ بنویسید.";
  if (k("code") === "wrong_code") return "کد اشتباه است.";
  if (k("code") === "expired") return "این کد دیگر معتبر نیست؛ کد تازه بگیرید.";
  if (k("code") === "too_many_tries") return "چند بار اشتباه وارد شد؛ کد تازه بگیرید.";
  if (k("code")) return "کد را درست بنویسید.";
  if (e.status === 429) return d.wait ? `کمی صبر کنید؛ ${FA(d.wait > 120 ? Math.ceil(d.wait / 60) + " دقیقه" : d.wait + " ثانیه")} دیگر دوباره امتحان کنید.` : "تلاش‌ها زیاد بود؛ کمی بعد دوباره امتحان کنید.";
  if (e.status === 502) return "پیامک فرستاده نشد؛ کمی بعد دوباره امتحان کنید.";
  if (e.status === 503) return "ارسال پیامک امروز به سقف رسیده؛ فردا یا با ایمیل وارد شوید.";
  return acctErr(e);
};
const altIn = (a, via) => acctSet({token: a.token, id: a.record.id, email: a.record.email || "", phone: a.record.phone || "", via});

// Called by showLogin() after it draws the page
function acctAltWire(box) {
  const slot = box.querySelector("#lg-alt"); if (!slot) return;
  const draw = m => {
    if (!m.phone && !m.google) { slot.innerHTML = ""; return; }
    slot.innerHTML = `<div class="lg-or"><span>یا</span></div>
      ${m.phone ? `<button type="button" class="ghost-btn lg-way" id="lg-phone">ورود با شماره همراه (کد پیامکی)</button>` : ""}
      ${m.google ? `<button type="button" class="ghost-btn lg-way" id="lg-google"><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> ورود با حساب گوگل</button>` : ""}`;
    const p = slot.querySelector("#lg-phone"), g = slot.querySelector("#lg-google");
    if (p) p.addEventListener("click", () => phoneStep(box));
    if (g) g.addEventListener("click", () => googleStart(box));
  };
  draw(acctAlt.m);
  acctWays().then(m => { if (box.contains(slot)) draw(m); });
  const pend = oauthPending();
  if (pend) googleWait(box);                       // the app was reloaded while the person was in the browser
}

function gformOf(box) { return box.querySelector(".gform"); }
function backLink(f, box) { const b = f.querySelector("#lg-back"); if (b) b.addEventListener("click", e => { e.preventDefault(); clearInterval(acctAlt.timer); oauthClear(); showLogin(); }); }

// ----- SMS code -----
function phoneStep(box, err, phone, sent) {
  const f = gformOf(box); clearInterval(acctAlt.timer);
  const ph = phone || (PHONE_OK(cfg.phone || "") ? cfg.phone : "");
  f.innerHTML = `<h2>ورود با شماره همراه</h2>
    <form id="lg-ph" class="wform" novalidate>
      ${sent ? `<p class="small">کد ${FA(sent.len || 5)} رقمی به <bdi dir="ltr">${FA(ph)}</bdi> پیامک شد.</p>
        <label for="lg-code">کد پیامک‌شده</label><input id="lg-code" dir="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>`
      : `<label for="lg-tel">شماره همراه</label><input id="lg-tel" type="tel" dir="ltr" inputmode="numeric" autocomplete="tel" placeholder="۰۹۱۲۳۴۵۶۷۸۹" value="${esc(FA(ph))}" required>`}
      ${err ? `<p class="werr" role="alert">${esc(err)}</p>` : ""}
      <button type="submit" id="lg-go">${sent ? "ورود" : "فرستادن کد"}</button>
    </form>
    ${sent ? `<p class="gnote"><a href="#" id="lg-resend" aria-disabled="true"></a> · <a href="#" id="lg-other">شماره دیگر</a></p>` : ""}
    <p class="gnote"><a href="#" id="lg-back">بازگشت به ورود با ایمیل</a></p>
    <p class="gnote">شماره همراه فقط برای فرستادن کد ورود و شناختن حساب شما روی سرور برنامه نگه داشته می‌شود.</p>`;
  backLink(f, box);
  const lock = on => f.querySelectorAll("button,input").forEach(x => { x.disabled = on; });
  const ask = async num => {
    lock(true);
    try { const r = await pb("hefz/otp/request", {method: "POST", anon: true, body: {phone: num}}); phoneStep(box, "", num, {len: (r && r.len) || 5, at: Date.now(), resend: (r && r.resend) || 60}); }
    catch (e) { phoneStep(box, altErr(e), num, sent); }
  };
  if (sent) {
    const rs = f.querySelector("#lg-resend");
    const tick = () => {
      const left = Math.ceil((sent.at + sent.resend * 1000 - Date.now()) / 1000);
      rs.textContent = left > 0 ? `فرستادن دوباره تا ${FA(left)} ثانیه دیگر` : "فرستادن دوباره کد";
      rs.setAttribute("aria-disabled", left > 0 ? "true" : "false");
      if (left <= 0) clearInterval(acctAlt.timer);
    };
    tick(); acctAlt.timer = setInterval(tick, 1000);
    rs.addEventListener("click", e => { e.preventDefault(); if (rs.getAttribute("aria-disabled") !== "true") ask(ph); });
    f.querySelector("#lg-other").addEventListener("click", e => { e.preventDefault(); phoneStep(box, "", ph); });
  }
  f.querySelector("#lg-ph").addEventListener("submit", async e => {
    e.preventDefault();
    if (!sent) {
      const num = String(f.querySelector("#lg-tel").value || "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[\s-]/g, "").replace(/^\+98|^0098/, "0");
      if (!PHONE_OK(num)) return phoneStep(box, "شماره همراه درست نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ بنویسید.", num);
      return ask(num);
    }
    const code = String(f.querySelector("#lg-code").value || "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/\D/g, "");
    if (!code) return phoneStep(box, "کد را بنویسید.", ph, sent);
    lock(true);
    try {
      const a = await pb("hefz/otp/verify", {method: "POST", anon: true, body: {phone: ph, code}});
      clearInterval(acctAlt.timer); altIn(a, "otp");
      if (!PHONE_OK(cfg.phone || "")) { cfg.phone = ph; saveCfg(); }
      await acctAfterLogin(box);
    } catch (e2) { phoneStep(box, altErr(e2), ph, sent); }
  });
  setTimeout(() => { const i = f.querySelector(sent ? "#lg-code" : "#lg-tel"); if (i) i.focus(); }, 50);
}

// ----- Google -----
const oauthPending = () => { try { const p = JSON.parse(localStorage.getItem("tadabbor-oauth")); return p && Date.now() - p.t < 600000 ? p : null; } catch (e) { return null; } };
const oauthClear = () => { try { localStorage.removeItem("tadabbor-oauth"); } catch (e) {} };
async function googleStart(box) {
  const f = gformOf(box); f.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try {
    const m = await pb("collections/users/auth-methods", {anon: true});
    const p = ((m.oauth2 || {}).providers || []).find(x => x.name === "google");
    if (!p) return showLogin("ورود با گوگل روی سرور فعال نیست.");
    const redirect = ACCT_API + "hefz/oauth-done";
    store("tadabbor-oauth", {state: p.state, verifier: p.codeVerifier, redirect, t: Date.now()});
    const url = p.authURL + encodeURIComponent(redirect);
    if (IS_APP) location.href = url;                          // the app opens web addresses in the phone's browser
    else if (!window.open(url, "_blank")) location.href = url;
    googleWait(box);
  } catch (e) { showLogin(acctErr(e)); }
}
function googleWait(box) {
  const f = gformOf(box); clearInterval(acctAlt.timer);
  f.innerHTML = `<h2>ورود با گوگل</h2>
    <p>در صفحه‌ای که باز شد وارد حساب گوگل خود شوید، بعد به همین‌جا برگردید.</p>
    <p class="small muted" role="status" id="lg-gst">منتظر تأیید گوگل…</p>
    <p class="gnote"><a href="#" id="lg-back">انصراف و بازگشت</a></p>`;
  backLink(f, box);
  let busy = false;
  const check = async () => {
    const p = oauthPending(); if (!p) { clearInterval(acctAlt.timer); return showLogin("زمان ورود با گوگل گذشت؛ دوباره امتحان کنید."); }
    if (busy || !box.contains(f)) return; busy = true;
    try {
      const r = await pb("hefz/oauth-claim?state=" + encodeURIComponent(p.state), {anon: true});
      clearInterval(acctAlt.timer); oauthClear();
      if (r.error || !r.code) return showLogin("ورود با گوگل انجام نشد.");
      const a = await pb("collections/users/auth-with-oauth2", {method: "POST", anon: true,
        body: {provider: "google", code: r.code, codeVerifier: p.verifier, redirectURL: p.redirect, createData: {emailVisibility: false}}});
      altIn(a, "google");
      await acctAfterLogin(box);
    } catch (e) {
      if (e.status === 404) return;                     // not back from Google yet
      clearInterval(acctAlt.timer); oauthClear(); showLogin(acctErr(e));
    } finally { busy = false; }
  };
  acctAlt.timer = setInterval(check, 2500);
  check();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && oauthPending() && document.getElementById("lg-gst")) { const b = document.getElementById("intro"); if (b) googleWait(b); } });
