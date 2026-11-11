# دستیار هوش مصنوعی روی Cloudflare Pages (قابل‌دسترس در ایران)

همان تابع `deploy/cloudflare/ai-worker.js` است، ولی به‌جای Worker به‌صورت «Pages Function» اجرا می‌شود. آدرس `pages.dev` در ایران معمولاً باز می‌شود و `workers.dev` و `netlify.app` فیلتر هستند. کلید Gemini فقط در تنظیمات Cloudflare می‌ماند.

## راه‌اندازی (از داشبورد Cloudflare، حدود ۱۰ دقیقه)

1. **Workers & Pages** ← **Create** ← تب **Pages** ← **Connect to Git** ← مخزن `tadabbor-hefz` را انتخاب کنید.
2. تنظیمات ساخت:
   - Project name: مثلاً `hefz-ai` (آدرس می‌شود `hefz-ai.pages.dev`)
   - Production branch: `main`
   - **Root directory:** `deploy/cloudflare-pages`
   - Framework preset: None، Build command: خالی، **Build output directory:** `public`
3. **Save and Deploy.**
4. بعد از ساخت: پروژه ← **Settings** ← **Variables and Secrets** (یا Environment variables) ← **Add** ← نوع **Secret**، نام `AI_API_KEY`، مقدار کلید Gemini (از https://aistudio.google.com/apikey) ← محیط **Production**. بعد یک بار **Retry deployment** بزنید تا کلید اعمال شود.
5. آدرس پروژه را (مثلاً `https://hefz-ai.pages.dev`) برای Claude بفرستید. آدرس برنامه باید `https://hefz-ai.pages.dev/api/ai` شود (فایل `deploy/cloudflare/AI_API`) و نسخه تازه ساخته شود.

تست: `https://hefz-ai.pages.dev/api/ai` را در مرورگر باز کنید؛ جواب «POST only» یعنی تابع بالاست.

متغیرهای اختیاری مثل Worker: `AI_MODEL`، `AI_FALLBACK_API_KEY` (Groq)، `ALLOWED_ORIGINS`. محدودیت هر دستگاه (Rate Limiting) در Pages در دسترس نیست.

سهمیه رایگان: طبق مستندات Cloudflare، Pages Functions از سهمیه Workers رایگان استفاده می‌کند (روزی ۱۰۰ هزار درخواست در زمان نوشتن این متن؛ عدد روز را از مستندات Cloudflare ببینید). سهمیه رایگان Gemini جدا و محدودتر است.
