# سرور حساب کاربری روی VPS خودتان (همگام‌سازی، ورود با پیامک و گوگل)

این پوشه PocketBase را روی VPS نصب می‌کند، **جدا از هر چیز دیگری که روی سرور دارید**:

- کاربر لینوکسی جدا (`tadabbor`، بدون امکان ورود) و پوشه جدا (`/opt/tadabbor`)
- سرویس جدا `tadabbor-api` که فقط روی `127.0.0.1` گوش می‌دهد و از بیرون مستقیم دیده نمی‌شود
- سرویس در «جعبه» systemd اجرا می‌شود: فقط در `/opt/tadabbor/pb_data` می‌تواند بنویسد، به پوشه‌های خانگی و سیستم دسترسی ندارد و حافظه (۵۱۲ مگابایت) و پردازنده‌اش سقف دارد
- اسکریپت نصب هیچ بسته‌ای نصب نمی‌کند و به nginx، دیوار آتش یا سرویس‌های دیگر دست نمی‌زند؛ تنها چیزی که به nginx اضافه می‌شود یک فایل سایت جداست (`nginx-api.conf`)

Docker لازم نیست؛ PocketBase یک فایل اجرایی است.

## نصب (یک بار)

۱. زیردامنه را در DNS به IP سرور بدهید، مثلاً `api.ganjineh-tadabbor.ir` (رکورد A).

۲. روی سرور:
```sh
sudo git clone https://github.com/kmazraee/tadabbor-hefz /opt/tadabbor/src
sudo sh /opt/tadabbor/src/deploy/vps/install.sh
```
اگر پورت 8095 گرفته بود: `sudo PORT=8096 sh …/install.sh` (همان عدد را در فایل nginx هم بگذارید).
در پایان باید `OK: tadabbor-api is running` ببینید.

۳. سایت nginx: راهنمای بالای فایل `nginx-api.conf` را دنبال کنید (کپی، جایگزین کردن دامنه، گرفتن گواهی با certbot، `nginx -t` و reload). بعد باید این آدرس `{"code":200,...}` بدهد:
`https://api.ganjineh-tadabbor.ir/api/health`

۴. حساب مدیر و پنل مدیریت. پنل از اینترنت بسته است و فقط از راه تونل SSH باز می‌شود:
```sh
sudo -u tadabbor /opt/tadabbor/bin/pocketbase superuser upsert you@example.com 'یک-رمز-قوی' --dir=/opt/tadabbor/pb_data
```
روی کامپیوتر خودتان: `ssh -L 8095:127.0.0.1:8095 کاربر@سرور` و سپس `http://localhost:8095/_/`.
برای پشتیبان‌گیری خودکار شبانه روی گوگل درایو: [BACKUP.md](BACKUP.md) (`sudo sh /opt/tadabbor/src/deploy/vps/backup-setup.sh`).

## ورود با پیامک

در `/opt/tadabbor/tadabbor.env` (فقط root می‌تواند بخواندش):
- کاوه‌نگار: در پنل کاوه‌نگار یک الگوی «تأیید» (Verify Lookup) با یک توکن (`%token`) بسازید، سپس:
  `SMS_PROVIDER=kavenegar`، `SMS_API_KEY=کلید API`، `SMS_TEMPLATE=نام الگو`
- sms.ir: یک قالب ارسال سریع با پارامتر `CODE` بسازید، سپس:
  `SMS_PROVIDER=smsir`، `SMS_API_KEY=کلید`، `SMS_TEMPLATE=شناسه عددی قالب`

بعد: `sudo systemctl restart tadabbor-api`.
برای آزمایش بدون پیامک: `SMS_PROVIDER=log` و `SMS_ALLOW_LOG=1`؛ کد در `sudo journalctl -u tadabbor-api -f` نوشته می‌شود (بعد از آزمایش `SMS_ALLOW_LOG=0`).

محافظت‌ها: هر شماره هر ۶۰ ثانیه یک کد و ساعتی حداکثر ۵ کد؛ هر کد ۳ دقیقه اعتبار و ۵ بار امتحان؛ هر IP ده دقیقه‌ای ۵ درخواست کد؛ کل سرور روزانه حداکثر ۳۰۰ پیامک (`SMS_DAILY_MAX`). کد روی سرور فقط به‌صورت هش نگه داشته می‌شود.

## ورود با گوگل

۱. در https://console.cloud.google.com یک پروژه بسازید ← APIs & Services ← OAuth consent screen (External، نام برنامه، ایمیل پشتیبانی، دامنه `ganjineh-tadabbor.ir`) ← Publish.
۲. Credentials ← Create credentials ← OAuth client ID ← نوع **Web application**.
   Authorized redirect URI: `https://api.ganjineh-tadabbor.ir/api/hefz/oauth-done`
۳. Client ID و Client secret را در `tadabbor.env` بگذارید (`GOOGLE_CLIENT_ID`، `GOOGLE_CLIENT_SECRET`) و `sudo systemctl restart tadabbor-api`.

در سایت، صفحه گوگل در زبانه تازه باز می‌شود؛ در برنامه اندروید در مرورگر گوشی. بعد از ورود، کاربر به برنامه برمی‌گردد و ورود خودش کامل می‌شود.

## وصل کردن برنامه به این سرور

آدرس سرور در فایل `deploy/vps/ACCOUNT_URL` نوشته شده و `scripts/build_web.py` به‌طور پیش‌فرض از آن استفاده می‌کند. پس هر ساخت (سایت، برنامه اندروید، ساخت خودکار) به این سرور وصل است و صفحه ورود هر روشی را که سرور روشن کرده نشان می‌دهد (`/api/hefz/methods`). ورود برای استفاده از برنامه اجباری است.

برای ساخت یک نسخه بدون حساب: `ACCOUNT_URL= python3 scripts/build_web.py`

## به‌روزرسانی و نگهداری

```sh
cd /opt/tadabbor/src && sudo git pull && sudo sh deploy/vps/install.sh
```
تنظیمات (`tadabbor.env`) و داده‌ها (`pb_data`) دست نمی‌خورند.
- وضعیت: `systemctl status tadabbor-api` · گزارش‌ها: `journalctl -u tadabbor-api -n 100`
- پشتیبان: هر شب خودکار روی گوگل درایو، راهنما در [BACKUP.md](BACKUP.md) (`sudo tadabbor-backup status`، `restore`)
- حذف کامل: `sudo systemctl disable --now tadabbor-api tadabbor-backup.timer && sudo rm -f /etc/systemd/system/tadabbor-backup.* /usr/local/bin/tadabbor-backup && sudo rm -rf /opt/tadabbor /etc/systemd/system/tadabbor-api.service /etc/nginx/sites-enabled/tadabbor-api && sudo userdel tadabbor`

## داشبورد مدیریتی

نشانی: `https://dashboard.ganjineh-tadabbor.ir` — با **ایمیل و رمز حساب مدیر PocketBase** (همان superuser مرحله ۴ نصب) وارد شوید. صفحه فقط‌خواندنی است و کار دیگری با سرور نمی‌کند.

راه‌اندازی زیردامنه (یک بار، بعد از `install.sh`):
۱. در Cloudflare یک رکورد A با نام `dashboard` و IP سرور بسازید، **فعلاً با ابر خاکستری (DNS only)**.
۲. روی سرور: `sudo sh /opt/tadabbor/src/deploy/vps/dashboard-site.sh` — یک سایت nginx جدا (`tadabbor-dashboard`) می‌سازد، گواهی Let's Encrypt می‌گیرد و داشبورد را از زیردامنه api برمی‌دارد. اگر nginx خطا بدهد، همه‌چیز را به حالت قبل برمی‌گرداند.
۳. بعد از `OK` ابر رکورد `dashboard` را نارنجی (Proxied) کنید.

روی این زیردامنه فقط صفحه داشبورد و داده‌هایش باز است؛ بقیه API و پنل PocketBase آنجا ۴۰۴ می‌دهند.

چه چیزهایی نشان می‌دهد:
- **خلاصه:** کل کاربران، کاربران جدید، فعال امروز / ۷ روز / ۳۰ روز، زمان استفاده هر کاربر در روز، مجموع ساعت استفاده و طول جلسه‌ها، نمودار روزانه، روش ورود (گوگل / پیامک / ایمیل)، قیف کاربران، ساعت‌ها و روزهای هفته پرمصرف
- **کاربران:** جدول همه کاربران با جستجو و مرتب‌سازی، خروجی CSV، و جزئیات هر کاربر (پیشرفت، سوره‌ها، جلسه‌ها)
- **یادگیری:** آیه‌های حفظ‌شده، سیاق‌های تدبرشده، سوره‌های کامل، مرورها، آزمون‌ها، سطح تسلط، زنجیره روزها، هدف روزانه، سوره‌های پرطرفدار، قاری و ترجمه پرطرفدار
- **مکان و دستگاه:** کشور و شهر، بستر (اندروید / سایت / PWA)، نسخه برنامه، سیستم‌عامل، مرورگر، مدل گوشی
- **ماندگاری:** بازگشت کاربران بعد از ۱، ۷ و ۳۰ روز و جدول گروه‌های هفتگی

از کجا می‌آید:
- آمار یادگیری از داده‌های همگام‌شده کاربران است (همه کاربران از اول؛ با هر همگام‌سازی به‌روز می‌شود).
- زمان استفاده، مکان و دستگاه از **نسخه تازه برنامه** ثبت می‌شود (هر بار که برنامه باز است، هر ۲ دقیقه و موقع بستن یک گزارش کوچک به `/api/hefz/ping`). IP ذخیره نمی‌شود.
- کشور و شهر را Cloudflare می‌دهد. **کشور** خودکار روشن است. برای **شهر**: در Cloudflare ← دامنه ← Rules ← Settings (یا Transform Rules) ← Managed Transforms ← گزینه **Add visitor location headers** را روشن کنید.
- کاربرانی که با VPN وصل می‌شوند کشور VPN را نشان می‌دهند؛ برای همین «کشور بر اساس منطقه زمانی گوشی» هم کنارش هست.

امنیت: رمز اشتباه ده دقیقه‌ای حداکثر ۵ بار از هر IP، و بعد از ۱۰ تلاش اشتباه ورود به داشبورد ۱۵ دقیقه قفل می‌شود. ورود ۱۲ ساعت اعتبار دارد و با عوض کردن رمز مدیر باطل می‌شود. اگر نمی‌خواهید داشبورد از اینترنت باز شود، در `tadabbor.env` بنویسید `ADMIN_WEB=0`؛ آن‌وقت داشبورد فقط با تونل SSH باز می‌شود: `ssh -L 8095:127.0.0.1:8095 کاربر@سرور` و سپس `http://localhost:8095/api/hefz/admin`.

جلسه‌های قدیمی‌تر از ۴۰۰ روز خودکار پاک می‌شوند (`STATS_KEEP_DAYS`). با حذف حساب یک کاربر، آمار او هم پاک می‌شود.

## نکته‌ها

- حساب‌ها جدا از هم‌اند: کسی که یک بار با شماره و یک بار با گوگل وارد شود، دو حساب جدا دارد. ورود با گوگل و ایمیل یکسان (ایمیل تأییدشده گوگل) به همان حساب ایمیلی وصل می‌شود.
- پشت Cloudflare (ابر نارنجی، پیشنهادی؛ IP سرور پنهان می‌ماند): در Cloudflare، SSL/TLS را روی **Full (strict)** بگذارید و این را یک بار روی سرور اجرا کنید تا IP واقعی کاربران به سرور برسد:
  ```sh
  (for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do echo "set_real_ip_from $ip;"; done; echo "real_ip_header CF-Connecting-IP;") > /etc/nginx/tadabbor-cloudflare.conf
  sed -i 's|# include /etc/nginx/tadabbor-cloudflare.conf;|include /etc/nginx/tadabbor-cloudflare.conf;|' /etc/nginx/sites-available/tadabbor-api
  nginx -t && systemctl reload nginx
  ```
