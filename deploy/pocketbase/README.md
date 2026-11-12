# حساب کاربری و همگام‌سازی (PocketBase)

> برای VPS (با ورود پیامکی و گوگل، جدا از سرویس‌های دیگر سرور) راهنمای کامل‌تر و اسکریپت نصب در `deploy/vps/README.md` است.

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


دستیار هوش مصنوعی به این سرور نیازی ندارد؛ راهنمایش در `deploy/cloudflare/README.md` است.
