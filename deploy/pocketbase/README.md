# حساب کاربری و همگام‌سازی (PocketBase)

در نسخه‌ای که با این بخش ساخته شود ورود به حساب اجباری است؛ نسخه بدون آن مثل قبل بی‌حساب کار می‌کند. با این بخش، کاربر در «تنظیمات ← حساب کاربری» با ایمیل و رمز عبور حساب می‌سازد و پیشرفت، تدبرها و تنظیماتش بین گوشی و سایت همگام می‌شود.

PocketBase یک فایل اجرایی رایگان و متن‌باز است (پایگاه‌داده SQLite داخلش است). ثبت‌نام، ورود و رمزگذاری رمز عبور را خودش انجام می‌دهد. قانون‌های `pb_migrations/1_hefz_sync.js` تضمین می‌کنند هر کاربر فقط رکورد خودش را ببیند و تغییر دهد.

## نصب روی سرور (یک بار)

1. فایل `pocketbase_*_linux_amd64.zip` را از https://github.com/pocketbase/pocketbase/releases بگیرید و در `/opt/pocketbase/` باز کنید.
2. پوشه `pb_migrations` همین مسیر را کنار فایل اجرایی بگذارید: `/opt/pocketbase/pb_migrations/1_hefz_sync.js`.
3. مدیر (superuser) بسازید: `/opt/pocketbase/pocketbase superuser upsert you@example.com 'یک-رمز-قوی'`
4. سرویس systemd (`/etc/systemd/system/pocketbase.service`):
   ```
   [Unit]
   Description=PocketBase (hefz accounts)
   After=network.target
   [Service]
   User=www-data
   WorkingDirectory=/opt/pocketbase
   ExecStart=/opt/pocketbase/pocketbase serve --http=127.0.0.1:8090
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
   سپس `chown -R www-data /opt/pocketbase && systemctl enable --now pocketbase`. مایگریشن هنگام اولین اجرا خودکار انجام می‌شود.
5. `deploy/nginx.conf` به‌روز شده (بخش `/api/`)؛ دوباره کپی کنید و `nginx -t && systemctl reload nginx`.
6. نسخه وب را با `python3 scripts/build_server.py` بسازید و `dist/` را کپی کنید. این نسخه بخش حساب را دارد.
7. پنل مدیر را از راه تونل ببینید: `ssh -L 8090:127.0.0.1:8090 server` و سپس `http://localhost:8090/_/`. در Settings → Application گزینه Rate limiting را روشن کنید و در Collections ← users، قانون‌ها را همان پیش‌فرض نگه دارید.

برای اینکه برنامه اندروید هم حساب داشته باشد: `SITE_BASE=https://دامنه-شما/ ACCOUNT_API=1 python3 scripts/build_web.py` (این برنامه از همان `/api/` استفاده می‌کند).

## پشتیبان‌گیری و نگهداری

همه چیز در پوشه `/opt/pocketbase/pb_data` است؛ از همین پوشه گاهی کپی بگیرید (`rsync` یا `cp -a` وقتی سرویس خاموش است، یا از پنل Settings ← Backups).

## چند نکته

- ورود فعلاً با ایمیل است. بازیابی رمز فراموش‌شده ایمیل (SMTP) لازم دارد؛ در Settings → Mail تنظیم می‌شود. تا آن موقع کاربر با «ساخت حساب» تازه و فایل پشتیبان می‌تواند ادامه دهد.
- ورود با گوگل بعداً با همین PocketBase (Auth providers ← Google) اضافه می‌شود؛ حساب Google Cloud و OAuth لازم دارد و برای کاربر ایرانی ممکن است بدون فیلترشکن کار نکند.
- شماره همراه کاربر هرگز به سرور فرستاده نمی‌شود.

## دستیار هوش مصنوعی (اختیاری)

کادر «پیام امروز» بالای صفحه اصلی و «دستیار هوشمند» (در منو و همان کادر) از مسیر `/api/hefz/ai` همین سرور با مدل حرف می‌زنند. کلید API فقط روی سرور است و هرگز داخل برنامه یا سایت قرار نمی‌گیرد. فقط کاربرانی که وارد حساب شده‌اند می‌توانند بپرسند و هر کاربر روزی حداکثر ۴۰ پرسش دارد (`AI_DAILY_LIMIT`). بدون این بخش، کادر بالای صفحه همچنان یک خلاصه روزانه ساده (بدون هوش مصنوعی) نشان می‌دهد.

مدل پیش‌فرض **Google Gemini Flash** از طریق نسخه رایگان Google AI Studio است (بهترین کیفیت فارسی و دانش قرآنی در میان گزینه‌های رایگان). هر سرویس سازگار با OpenAI هم کار می‌کند.

1. کلید رایگان بگیرید: https://aistudio.google.com/apikey (کارت بانکی لازم نیست).
2. فایل `pb_hooks/ai.pb.js` را کنار `pb_migrations` بگذارید: `/opt/pocketbase/pb_hooks/ai.pb.js`.
3. فایل `/opt/pocketbase/ai.env` بسازید و دسترسی‌اش را محدود کنید (`chmod 600`، مالک `www-data`):
   ```
   AI_API_KEY=کلید-gemini
   # اختیاری: سرویس دوم وقتی اولی جواب نداد (سهمیه تمام شد، تحریم منطقه، قطعی)، مثلاً Groq رایگان:
   # AI_FALLBACK_API_KEY=کلید-groq
   # AI_FALLBACK_BASE_URL=https://api.groq.com/openai/v1/
   # AI_FALLBACK_MODEL=llama-3.3-70b-versatile
   # AI_MODEL=gemini-flash-latest
   # AI_DAILY_LIMIT=40
   ```
4. در سرویس systemd زیر `[Service]` اضافه کنید: `EnvironmentFile=/opt/pocketbase/ai.env` و سپس `systemctl daemon-reload && systemctl restart pocketbase`.
5. `deploy/nginx.conf` (خط `proxy_read_timeout`) را دوباره کپی و `nginx -t && systemctl reload nginx` کنید.
6. آزمایش: در برنامه وارد شوید؛ کادر «پیام امروز» باید برچسب «دستیار هوشمند» بگیرد. خطاهای سرویس مدل در `journalctl -u pocketbase` با پیشوند `hefz-ai` دیده می‌شود.

### اگر سرور داخل ایران است

Google، Groq و OpenRouter درخواست از IP ایران را رد می‌کنند (پیام `User location is not supported` در لاگ). یکی از این راه‌ها:
- **پیشنهادی:** PocketBase را روی سروری خارج از ایران اجرا کنید، یا فقط برای همین درخواست‌ها پراکسی خروجی بگذارید: در `ai.env` خط `HTTPS_PROXY=http://آدرس-پراکسی:پورت` (Go این متغیر را برای درخواست‌های بیرونی به کار می‌برد).
- یا از یک درگاه ایرانی سازگار با OpenAI (پولی، با ریال) استفاده کنید: `AI_BASE_URL=آدرس-درگاه/v1/` و `AI_API_KEY` و `AI_MODEL` همان درگاه.

### حریم خصوصی

برای هر پرسش، خلاصه‌ای از پیشرفت کاربر (نام کوچک، سوره‌های حفظ/تدبرشده، مرورهای عقب‌مانده، هدف) همراه سؤال به سرویس مدل فرستاده می‌شود؛ شماره همراه و ایمیل فرستاده نمی‌شود. در نسخه رایگان Gemini، گوگل ممکن است از متن پرسش‌ها برای بهبود محصولاتش استفاده کند؛ اگر این مهم است، در Google AI Studio صورت‌حساب (Billing) فعال کنید.
