# حساب کاربری و همگام‌سازی روی Cloudflare (بدون سرور شخصی)

این پوشه همان کار PocketBase را روی **Cloudflare Workers + D1** انجام می‌دهد. نیازی به سرور یا کارت بانکی ندارد؛ فقط یک حساب Cloudflare. برنامه همان کد است و فقط آدرس سرور حساب فرق می‌کند.

> محدودیت‌های طرح رایگان Cloudflare (تعداد درخواست روزانه و زمان پردازش) و باز شدن آن برای کاربران ایرانی بدون فیلترشکن را از خود Cloudflare و با یک گوشی ایرانی بررسی کنید؛ این‌ها را من نمی‌توانم از اینجا تأیید کنم. سرویس رمز را با PBKDF2 (۱۰۰هزار دور، سقف Workers) رمزگذاری می‌کند؛ اگر در طرح رایگان خطای زمان پردازش (Error 1102) دیدید، در `worker.js` مقدار `PBKDF2_ITER` را کم کنید.

## راه‌اندازی از داشبورد (یک بار، حدود ده دقیقه)

1. در https://dash.cloudflare.com حساب رایگان بسازید.
2. **Storage & Databases ← D1 ← Create database**، نام: `hefz`. بعد در تب **Console** محتوای `schema.sql` را بچسبانید و اجرا کنید.
3. **Workers & Pages ← Create ← Create Worker**، نام: `hefz-accounts` و Deploy. سپس **Edit code**، همه کد را با محتوای `worker.js` عوض کنید و Deploy بزنید.
4. در همان Worker: **Settings ← Bindings ← Add ← D1 database**، نام متغیر `DB` و پایگاه‌داده `hefz`.
5. **Settings ← Variables and Secrets**: یک Secret به نام `TOKEN_SECRET` با یک متن تصادفی بلند (دست‌کم ۳۰ نویسه) و یک متغیر `ALLOWED_ORIGIN` با آدرس سایت، مثلاً `https://ganjineh-tadabbor.ir`.
6. آدرس Worker (مثل `https://hefz-accounts.نام-شما.workers.dev`) را به من بدهید یا خودتان بسازید:
   `ACCOUNT_URL=https://hefz-accounts.نام-شما.workers.dev python3 scripts/build_web.py`
   با این کار نسخه GitHub Pages و برنامه اندروید ورود اجباری و همگام‌سازی را می‌گیرند.

## آزمایش

`https://آدرس-worker/api/health` باید `{"ok":true}` برگرداند.

## نکته‌ها

- داده‌ها در D1 هستند و از داشبورد قابل پشتیبان‌گیری‌اند. حذف حساب از تنظیمات برنامه همه‌ی داده‌های کاربر را پاک می‌کند.
- ده تلاش اشتباه ورود در ده دقیقه برای هر ایمیل و نشانی، موقتاً قفل می‌شود.
- بازیابی رمز فراموش‌شده ندارد (ایمیل نمی‌فرستد).
