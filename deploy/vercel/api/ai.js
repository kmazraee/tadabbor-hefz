// AI assistant of the tadabbor-hefz app as a free Cloudflare Worker: the app works without any server of its own.
// The model's API key is a secret of this Worker (never inside the app). Any OpenAI-compatible chat API works;
// default: Google Gemini Flash on the free tier through its OpenAI-compatible endpoint.
// Setup (Persian, step by step): deploy/cloudflare/README.md
//
// Settings (Worker → Settings → Variables and Secrets):
//   AI_API_KEY (secret, required)      AI_MODEL (default gemini-flash-latest,gemini-flash-lite-latest; comma separated, tried in order)
//   AI_BASE_URL (default https://generativelanguage.googleapis.com/v1beta/openai/)
//   AI_FALLBACK_API_KEY (secret) / AI_FALLBACK_BASE_URL / AI_FALLBACK_MODEL: second provider (e.g. Groq), tried when the first refuses
//   ALLOWED_ORIGINS (optional, comma separated): web origins allowed besides the Android app; empty = any
// Optional binding RATE (Rate Limiting): per device/IP cap per minute, see wrangler.toml.
//
// Request: POST /  {mode: "daily"|"chat", ctx: {...}, messages: [{role, content}]}  →  {text}

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
const cors = (origin) => ({
  ...(origin ? {"Access-Control-Allow-Origin": origin} : {}),
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

const handle = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    // The Android app loads from file:// (Origin "null" or none); web copies must be on the list when one is set
    const okOrigin = !allowed.length || !origin || origin === "null" || allowed.includes(origin);
    const h = cors(okOrigin ? origin || "*" : "");
    const out = (status, obj) => new Response(JSON.stringify(obj), {status, headers: {...h, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}});
    if (request.method === "OPTIONS") return new Response(null, {status: okOrigin ? 204 : 403, headers: h});
    if (request.method !== "POST") return out(405, {code: "ai_bad", message: "POST only"});
    if (!okOrigin) return out(403, {code: "ai_origin", message: "origin not allowed"});
    if (!env.AI_API_KEY) return out(503, {code: "ai_off", message: "AI_API_KEY is not set"});

    let body;
    try { body = await request.json(); } catch (e) { return out(400, {code: "ai_bad", message: "bad json"}); }
    const mode = body && body.mode === "daily" ? "daily" : "chat";
    let ctx = "{}";
    try { ctx = JSON.stringify((body && body.ctx) || {}); } catch (e) {}
    if (ctx.length > 9000) ctx = ctx.slice(0, 9000);
    const msgs = (Array.isArray(body && body.messages) ? body.messages : [])
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-12).map(m => ({role: m.role, content: m.content.slice(0, 2000)}));
    if (mode === "chat" && (!msgs.length || msgs[msgs.length - 1].role !== "user")) return out(400, {code: "ai_bad", message: "no question"});

    // Cap per device and per IP (Rate Limiting binding; skipped if not configured)
    if (env.RATE) {
      const dev = (request.headers.get("X-Device") || "").slice(0, 64);
      const ip = request.headers.get("CF-Connecting-IP") || "";
      for (const k of [dev && "d:" + dev, ip && "i:" + ip].filter(Boolean)) {
        try { const r = await env.RATE.limit({key: k}); if (!r.success) return out(429, {code: "ai_limit", message: "too many requests"}); } catch (e) {}
      }
    }

    const messages = [{role: "system", content: sys + (mode === "daily" ? "\n\n" + daily : "") + "\n\nوضعیت کاربر (JSON):\n" + ctx}];
    if (mode === "daily") messages.push({role: "user", content: "پیام امروز من را بنویس."});
    else messages.push(...msgs);

    // Several models of the main provider are tried in turn: a busy one (503) or one over its quota (429) is skipped
    const base1 = env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/";
    const providers = (env.AI_MODEL || "gemini-flash-lite-latest,gemini-flash-latest").split(",").map(m => m.trim()).filter(Boolean)
      .map(model => ({base: base1, key: env.AI_API_KEY, model}));
    if (env.AI_FALLBACK_API_KEY) {
      const fb = {base: env.AI_FALLBACK_BASE_URL || "https://api.groq.com/openai/v1/", key: env.AI_FALLBACK_API_KEY, model: env.AI_FALLBACK_MODEL || "llama-3.3-70b-versatile"};
      // AI_PREFER_FALLBACK=1 puts the fast provider (Groq) first and Gemini behind it
      if (env.AI_PREFER_FALLBACK === "1") providers.unshift(fb); else providers.push(fb);
    }
    let last = 0; const seen = [];
    for (const [i, p] of providers.entries()) {
      const req = {model: p.model, messages, temperature: mode === "daily" ? 0.8 : 0.4, max_tokens: mode === "daily" ? 350 : 800};
      if (p.base.includes("generativelanguage.googleapis.com") && !/lite/.test(p.model)) req.reasoning_effort = "low";   // Gemini: keep "thinking" short (lite does not think)
      try {
        // A slow model is abandoned after 9 seconds so the next one can answer
        const r = await fetch(p.base.replace(/\/+$/, "") + "/chat/completions", {
          method: "POST", headers: {"Content-Type": "application/json", "Authorization": "Bearer " + p.key}, body: JSON.stringify(req),
          signal: AbortSignal.timeout(i < providers.length - 1 ? 9000 : 20000)});
        last = r.status; seen.push(p.model + ":" + r.status);
        if (r.ok) {
          const j = await r.json();
          const text = ((((j.choices || [])[0] || {}).message || {}).content || "").trim();
          if (text) return out(200, {text, mode});
          last = 502;
        } else console.log("hefz-ai: provider " + i + " answered " + r.status + ": " + (await r.text()).slice(0, 300));
      } catch (e) { last = 599; seen.push(p.model + ":net"); console.log("hefz-ai: provider " + i + " unreachable: " + e); }
    }
    return out(502, {code: last === 429 ? "ai_busy" : "ai_upstream", message: "provider error " + last + " (" + seen.join(", ") + ")"});
  },
};

// Any unexpected error is answered as JSON with its text (never the keys), so it can be read in a browser
export default {
  async fetch(request, env, ctx) {
    try { return await handle.fetch(request, process.env); }
    catch (e) {
      console.log("hefz-ai crash: " + ((e && e.stack) || e));
      return new Response(JSON.stringify({code: "ai_crash", message: String((e && e.stack) || e).slice(0, 600)}),
        {status: 500, headers: {"Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"}});
    }
  },
};
