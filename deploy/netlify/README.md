# دستیار هوشمند روی Netlify

1. در app.netlify.com با حساب گیت‌هاب وارد شوید، Add new site → Import an existing project و مخزن `tadabbor-hefz` را انتخاب کنید.
2. Base directory را `deploy/netlify` بگذارید و Deploy کنید.
3. Site configuration → Environment variables: مقدار `AI_API_KEY` را با کلید جمنای اضافه کنید و دوباره Deploy کنید.
4. آدرس `https://<نام-سایت>.netlify.app/api/ai` را باز کنید: باید `POST only` نشان دهد.
