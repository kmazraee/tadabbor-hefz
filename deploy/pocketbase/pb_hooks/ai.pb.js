/// <reference path="../pb_data/types.d.ts" />
// AI assistant of the app: POST /api/hefz/ai (signed-in users only).
// The model's API key stays on this server (environment variable AI_API_KEY); the app never sees it.
// Any OpenAI-compatible chat API works. Default: Google Gemini (free tier) through its OpenAI-compatible endpoint.
//
// Environment (see deploy/pocketbase/README.md, section «دستیار هوش مصنوعی»):
//   AI_API_KEY        required; without it the route answers 503 and the app keeps its offline daily summary
//   AI_BASE_URL       default https://generativelanguage.googleapis.com/v1beta/openai/
//   AI_MODEL          default gemini-flash-latest
//   AI_FALLBACK_BASE_URL / AI_FALLBACK_API_KEY / AI_FALLBACK_MODEL   optional second provider (e.g. Groq or OpenRouter),
//                     tried when the first one refuses (quota, region block, outage)
//   AI_DAILY_LIMIT    requests per user per day, default 40
//
// Note: PocketBase runs each handler in its own context, so everything the handler needs is defined inside it.
routerAdd("POST", "/api/hefz/ai", (e) => {
  const env = (k, d) => { const v = ($os.getenv(k) || "").trim(); return v || d; };
  const key = env("AI_API_KEY", "");
  if (!key) return e.json(503, {code: "ai_off", message: "AI is not configured on this server"});

  // ---- input: {mode: "daily"|"chat", ctx: {...}, messages: [{role, content}]} ----
  const body = e.requestInfo().body || {};
  const mode = body.mode === "daily" ? "daily" : "chat";
  let ctx = "";
  try { ctx = JSON.stringify(body.ctx || {}); } catch (err) { ctx = "{}"; }
  if (ctx.length > 9000) ctx = ctx.slice(0, 9000);
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map(m => ({role: m.role, content: m.content.slice(0, 2000)}));
  if (mode === "chat" && (!msgs.length || msgs[msgs.length - 1].role !== "user")) return e.json(400, {code: "ai_bad", message: "no question"});

  // ---- per-user daily limit (kept in memory; resets on restart, which is fine for a soft cap) ----
  const limit = parseInt(env("AI_DAILY_LIMIT", "40"), 10) || 40;
  const day = new Date().toISOString().slice(0, 10);
  const sk = "hefz-ai:" + e.auth.id;
  const used = $app.store().get(sk);
  const n = used && used.d === day ? used.n : 0;
  if (n >= limit) return e.json(429, {code: "ai_limit", message: "daily limit reached"});
  $app.store().set(sk, {d: day, n: n + 1});

  // ---- instructions: written here, on the server, so a client cannot replace them ----
  const sys = [
    "تو «دستیار حفظ تدبری» هستی؛ دستیار هوشمند برنامه‌ای برای تدبر و حفظ قرآن کریم به روش استاد علی صبوحی طسوجی (تدبر سیاق‌محور: هر سوره به سیاق‌ها و گام‌ها تقسیم می‌شود؛ اول تدبر، بعد حفظ، بعد مرور).",
    "همیشه فارسی روان و محترمانه بنویس، کاربر را «شما» خطاب کن. لحنت گرم، امیدبخش و با شوخ‌طبعی ملایم باشد؛ شوخی فقط درباره برنامه و عادت‌های روزانه کاربر، هرگز درباره قرآن، اهل‌بیت، مقدسات یا باورهای دینی. سرزنش نکن؛ تشویق کن و قدم بعدی مشخص بده.",
    "داده «وضعیت کاربر» که در ادامه می‌آید تنها منبع تو درباره پیشرفت اوست؛ عددی نساز و چیزی را که در آن نیست حدس نزن. ساعت و تاریخ را هم از همان داده بگیر.",
    "درباره قرآن: آدرس دقیق بده (نام سوره و شماره آیه). متن عربی آیه را فقط وقتی کاملاً مطمئنی بیاور و هرگز آیه یا حدیثی نساز؛ اگر مطمئن نیستی بگو و کاربر را به متن مصحف و ترجمه داخل برنامه ارجاع بده. در تفسیر، برداشت‌ها را به‌عنوان دیدگاه مفسران مطرح کن (تفسیر پیش‌فرض برنامه المیزان است) و میان متن آیه و برداشت فرق بگذار.",
    "حکم شرعی و فتوا نده؛ برای احکام، کاربر را به رساله یا دفتر مرجع تقلیدش ارجاع بده. در موضوعات اختلافی بی‌طرف و مختصر باش.",
    "پاسخ‌ها کوتاه و کاربردی باشد (معمولاً کمتر از ۱۸۰ کلمه)، با جمله‌های ساده؛ اگر فهرست لازم است از خط تیره استفاده کن. از تیتر و جدول استفاده نکن.",
    "اگر سؤال ربطی به قرآن، یادگیری یا برنامه ندارد، کوتاه و مؤدبانه جواب بده و به مسیر یادگیری برگرد.",
  ].join("\n");
  const daily = [
    "کار الان: «پیام امروز» بالای صفحه اصلی را بنویس. حداکثر ۷۰ کلمه، بدون تیتر، بدون فهرست طولانی.",
    "۱) سلام و احوال‌پرسی متناسب با ساعت کاربر (صبح، ظهر، عصر، شب یا نیمه‌شب) و اگر نام دارد با نامش.",
    "۲) یک جمله درباره وضعیتش (پیوستگی روزها، سوره‌های حفظ/تدبرشده، قدم مسیر).",
    "۳) کارهای عقب‌مانده را مشخص بگو (مرورهای سررسیده حفظ و تدبر، اشتباه‌های باز، عقب‌ماندن از هدف، چند روز غیبت). اگر چیزی عقب نیست، تحسین کن.",
    "۴) یک قدم مشخص برای همین الان پیشنهاد کن. یک شوخی ملایم کوتاه مجاز است.",
  ].join("\n");
  const messages = [{role: "system", content: sys + (mode === "daily" ? "\n\n" + daily : "") + "\n\nوضعیت کاربر (JSON):\n" + ctx}];
  if (mode === "daily") messages.push({role: "user", content: "پیام امروز من را بنویس."});
  else msgs.forEach(m => messages.push(m));

  // ---- call the provider, then the fallback if the first one refuses ----
  const providers = [{base: env("AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"), key: key, model: env("AI_MODEL", "gemini-flash-latest")}];
  if (env("AI_FALLBACK_API_KEY", "")) providers.push({base: env("AI_FALLBACK_BASE_URL", "https://api.groq.com/openai/v1/"), key: env("AI_FALLBACK_API_KEY", ""), model: env("AI_FALLBACK_MODEL", "llama-3.3-70b-versatile")});
  let lastStatus = 0;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const req = {model: p.model, messages: messages, temperature: mode === "daily" ? 0.8 : 0.4, max_tokens: mode === "daily" ? 400 : 1200};
    if (p.base.indexOf("generativelanguage.googleapis.com") >= 0) req.reasoning_effort = "low";   // Gemini: keep "thinking" short
    let res;
    try {
      res = $http.send({
        url: p.base.replace(/\/+$/, "") + "/chat/completions",
        method: "POST",
        headers: {"Content-Type": "application/json", "Authorization": "Bearer " + p.key},
        body: JSON.stringify(req),
        timeout: 60,
      });
    } catch (err) { lastStatus = 599; console.log("hefz-ai: provider " + i + " unreachable: " + err); continue; }
    lastStatus = res.statusCode;
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const j = res.json || {};
      const text = (((j.choices || [])[0] || {}).message || {}).content || "";
      if (text.trim()) return e.json(200, {text: text.trim(), mode: mode});
      lastStatus = 502;
      continue;
    }
    console.log("hefz-ai: provider " + i + " answered " + res.statusCode + ": " + (() => { try { return toString(res.body).slice(0, 300); } catch (x) { return ""; } })());
  }
  // The user gets their request back if every provider refused
  const u = $app.store().get(sk); if (u && u.d === day && u.n > 0) $app.store().set(sk, {d: day, n: u.n - 1});
  return e.json(502, {code: lastStatus === 429 ? "ai_busy" : "ai_upstream", message: "provider error " + lastStatus});
}, $apis.requireAuth("users"));
