// ---------- usage time for the admin dashboard (signed-in users only) ----------
// Counts the seconds the app is on screen and in use (a touch or key in the last 5 minutes, or recitation playing),
// and reports them with the app version, platform and a coarse device name to the account server
// (POST /api/hefz/ping). The server adds the country and city Cloudflare derives from the connection and does not keep the IP.
// No content, notes or Quran text is sent. Code: deploy/pocketbase/pb_hooks/hefz_stats.pb.js
const usage = {sid: "", secs: 0, sent: -1, act: Date.now(), hidAt: 0, media: new Set()};
function usageSid() { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, "0")).join(""); }
function usageEnv() {
  const ua = navigator.userAgent || "", and = ua.match(/Android ([\d.]+)/), ios = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)/);
  const os = and ? "Android " + and[1].split(".")[0] : ios ? "iOS " + ios[1] : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  const br = IS_APP ? "" : /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const m = ua.match(/Android [\d.]+; (?:[a-z]{2}[-_][a-z]{2}; )?([^;)]+?)(?: Build[/;]|\))/i), dev = m && m[1] !== "K" ? m[1].trim() : "";
  let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  const pwa = !IS_APP && window.matchMedia && matchMedia("(display-mode: standalone)").matches;
  return {plat: IS_APP ? "android" : pwa ? "pwa" : "web", ver: VERSION, os, br, dev: dev.slice(0, 40), tz};
}
function usagePing() {
  if (!ACCT_ON || !acct || !acct.token || !usage.sid || usage.secs === usage.sent) return;
  usage.sent = usage.secs;
  try {
    fetch(ACCT_API + "hefz/ping", {method: "POST", keepalive: true, cache: "no-store",
      headers: {"Content-Type": "application/json", Authorization: acct.token},
      body: JSON.stringify(Object.assign({sid: usage.sid, secs: usage.secs}, usageEnv()))}).catch(() => {});
  } catch (e) {}
}
if (ACCT_ON) {
  // Recitation keeps counting while the screen is on even without touches
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { usage.media.add(this); return play.apply(this, arguments); };
  const busy = () => { usage.act = Date.now(); };
  ["pointerdown", "keydown", "wheel", "touchmove"].forEach(t => addEventListener(t, busy, {passive: true, capture: true}));
  usage.sid = usageSid();
  setInterval(() => {
    if (document.hidden || !acct) return;
    const playing = [...usage.media].some(a => !a.paused && !a.ended);
    if (!playing) usage.media.clear();
    if (playing || Date.now() - usage.act < 300000) usage.secs += 5;
    if (usage.secs > 0 && (usage.sent < 0 || usage.secs - usage.sent >= 120)) usagePing();
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { usage.hidAt = Date.now(); usagePing(); return; }
    usage.act = Date.now();
    // Back after 30 minutes or more: a new session
    if (usage.hidAt && Date.now() - usage.hidAt > 1800000) { usage.sid = usageSid(); usage.secs = 0; usage.sent = -1; }
  });
  addEventListener("pagehide", usagePing);
}
