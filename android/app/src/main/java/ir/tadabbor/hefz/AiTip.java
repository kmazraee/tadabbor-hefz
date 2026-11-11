package ir.tadabbor.hefz;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.TimeZone;

/**
 * The AI assistant's daily message as a notification. Once a day (inexact alarm) it shows the message the app already
 * fetched today; if there is none, it asks the assistant server for one with the status summary the app last saved
 * (the same JSON the home box sends), and falls back to a short line when the phone is offline. Rescheduled after reboot.
 */
public class AiTip extends BroadcastReceiver {
    static final String PREFS = "aitip";
    static final String CHANNEL = "ai_daily";
    static final String ACTION = "ir.tadabbor.hefz.AITIP";

    /** Same day number as today() in the page: whole days since 1970 in local time. */
    static long today() {
        long now = System.currentTimeMillis();
        return (now + TimeZone.getDefault().getOffset(now)) / 86400000L;
    }

    static void save(Context c, boolean on, int hour, int minute, String url, String device, String ctx, String text, long day, String title) {
        SharedPreferences.Editor e = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("on", on).putInt("h", hour).putInt("m", minute)
                .putString("url", url).putString("device", device).putString("ctx", ctx)
                .putString("title", title).putLong("ctxAt", System.currentTimeMillis());
        // Keep a message the notification itself fetched today unless the app sends a newer one
        if (text != null && !text.isEmpty()) e.putString("text", text).putLong("day", day);
        e.apply();
        schedule(c);
    }

    /** {"day":N,"text":"...","at":ms} for a message fetched today by the notification, or "" */
    static String fetchedToday(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (p.getLong("fday", -1) != today()) return "";
        try { return new JSONObject().put("day", p.getLong("fday", -1)).put("text", p.getString("ftext", "")).put("at", p.getLong("fat", 0)).toString(); }
        catch (Exception e) { return ""; }
    }

    static void schedule(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 9, new Intent(c, AiTip.class).setAction(ACTION),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (!p.getBoolean("on", false)) return;
        Calendar t = Calendar.getInstance();
        t.set(Calendar.HOUR_OF_DAY, p.getInt("h", 8));
        t.set(Calendar.MINUTE, p.getInt("m", 0));
        t.set(Calendar.SECOND, 0);
        if (t.getTimeInMillis() <= System.currentTimeMillis()) t.add(Calendar.DAY_OF_MONTH, 1);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, t.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) { schedule(c); return; }
        final SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("on", false)) return;
        final long day = today();
        if (p.getLong("day", -1) == day && !p.getString("text", "").isEmpty()) { show(c, p, p.getString("text", "")); return; }
        if (p.getLong("fday", -1) == day) return;   // already shown today
        final PendingResult done = goAsync();
        new Thread(() -> {
            String text = null;
            try { text = fetch(p); } catch (Exception ignored) { }
            if (text != null && !text.trim().isEmpty()) {
                p.edit().putLong("fday", day).putString("ftext", text).putLong("fat", System.currentTimeMillis()).apply();
                show(c, p, text);
            } else {
                p.edit().putLong("fday", day).putString("ftext", "").apply();
                show(c, p, "پیام امروز دستیار آماده است؛ برای دیدن مرورها و قدم بعدی، برنامه را باز کنید.");
            }
            done.finish();
        }).start();
    }

    /** Ask the assistant server, with the saved status summary brought up to date for the time of day. */
    static String fetch(SharedPreferences p) throws Exception {
        String url = p.getString("url", "");
        if (!url.startsWith("http")) return null;
        JSONObject ctx;
        try { ctx = new JSONObject(p.getString("ctx", "{}")); } catch (Exception e) { ctx = new JSONObject(); }
        long away = (System.currentTimeMillis() - p.getLong("ctxAt", System.currentTimeMillis())) / 86400000L;
        if (away > 0 && ctx.has("daysSinceLastActivity") && !ctx.isNull("daysSinceLastActivity"))
            ctx.put("daysSinceLastActivity", ctx.optInt("daysSinceLastActivity", 0) + away);
        Calendar now = Calendar.getInstance();
        int h = now.get(Calendar.HOUR_OF_DAY);
        String part = h < 4 ? "نیمه‌شب" : h < 11 ? "صبح" : h < 15 ? "ظهر" : h < 19 ? "عصر" : "شب";
        ctx.put("now", new JSONObject().put("time", String.format(java.util.Locale.US, "%02d:%02d", h, now.get(Calendar.MINUTE))).put("part", part));
        ctx.put("deliveredAs", "phone notification: keep it to two or three short sentences");
        String body = new JSONObject().put("mode", "daily").put("ctx", ctx).toString();

        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(10000);
        con.setReadTimeout(30000);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setRequestProperty("Content-Type", "application/json");
        con.setRequestProperty("X-Device", p.getString("device", ""));
        con.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") HefzTadabbori");
        try (OutputStream o = con.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        if (con.getResponseCode() != 200) return null;
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        try (InputStream in = con.getInputStream()) { byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); }
        return new JSONObject(bo.toString("UTF-8")).optString("text", null);
    }

    /** The model may use **bold** and "- " lists; a notification shows plain text. */
    static String plain(String t) {
        return t.replaceAll("\\*\\*([^*\\n]+)\\*\\*", "$1").replaceAll("(?m)^\\s*[-*•]\\s+", "• ").trim();
    }

    static void show(Context c, SharedPreferences p, String raw) {
        String text = plain(raw);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "پیام روزانه دستیار", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(c, 10, new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(p.getString("title", "پیام امروز دستیار"))
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true);
        try { NotificationManagerCompat.from(c).notify(2, b.build()); } catch (SecurityException ignored) { }
    }
}
