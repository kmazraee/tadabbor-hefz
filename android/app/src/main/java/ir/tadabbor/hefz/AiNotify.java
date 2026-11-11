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
import java.util.Locale;

/**
 * Daily message of the assistant ("پیام امروز") as a notification at the hour the reader chose.
 * The page hands over a snapshot of the reader's status each time it is open. At the alarm the local summary is shown
 * at once; then the assistant is asked with that snapshot and, if it answers, its text replaces the summary silently.
 */
public class AiNotify extends BroadcastReceiver {
    static final String PREFS = "ainotify";
    static final String CHANNEL = "aidaily";
    static final String ACTION = "ir.tadabbor.hefz.AI_NOTIFY";
    static final int ID = 2;
    static final long DAY = 86400000L;

    static void save(Context c, boolean on, int hour, int minute, String url, String device, String body, String fallback, String title) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("on", on).putInt("h", hour).putInt("m", minute)
                .putString("url", url).putString("device", device).putString("body", body)
                .putString("fallback", fallback).putString("title", title)
                .putLong("at", System.currentTimeMillis()).apply();
        schedule(c);
    }

    static void schedule(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 9, new Intent(c, AiNotify.class).setAction(ACTION),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (!p.getBoolean("on", false)) return;
        Calendar t = Calendar.getInstance();
        t.set(Calendar.HOUR_OF_DAY, p.getInt("h", 7));
        t.set(Calendar.MINUTE, p.getInt("m", 30));
        t.set(Calendar.SECOND, 0);
        if (t.getTimeInMillis() <= System.currentTimeMillis()) t.add(Calendar.DAY_OF_MONTH, 1);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, t.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    @Override
    public void onReceive(final Context c, Intent intent) {
        if (!ACTION.equals(intent.getAction())) return;
        final SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("on", false)) return;
        final long days = Math.max(0, (System.currentTimeMillis() - p.getLong("at", System.currentTimeMillis())) / DAY);
        // The saved summary speaks of "today"; after a few days away a plain invitation is truer
        String fallback = days >= 2 ? "چند روز است سری نزده‌اید؛ قرآن منتظر است. امروز با یک مرور کوتاه برگردید."
                : p.getString("fallback", "وقت تدبر و مرور امروز است");
        show(c, p.getString("title", "پیام امروز حفظ تدبری"), fallback);
        final String url = p.getString("url", "");
        if (url == null || !url.startsWith("http")) return;
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                String text = ask(url, p.getString("device", ""), p.getString("body", "{}"), days);
                if (text != null && !text.trim().isEmpty()) show(c, p.getString("title", "پیام امروز حفظ تدبری"), text.trim());
            } catch (Exception ignored) {
            } finally {
                pending.finish();
            }
        }).start();
    }

    /** Asks the assistant for the daily message; the snapshot's clock and days away are brought up to now. */
    static String ask(String url, String device, String body, long days) throws Exception {
        JSONObject req = new JSONObject(body);
        JSONObject ctx = req.optJSONObject("ctx");
        if (ctx != null) {
            Calendar now = Calendar.getInstance();
            int h = now.get(Calendar.HOUR_OF_DAY);
            JSONObject n = new JSONObject();
            n.put("time", String.format(Locale.US, "%02d:%02d", h, now.get(Calendar.MINUTE)));
            n.put("part", h < 4 ? "نیمه‌شب" : h < 11 ? "صبح" : h < 15 ? "ظهر" : h < 19 ? "عصر" : "شب");
            ctx.put("now", n);
            if (days > 0) {
                if (!ctx.isNull("daysSinceLastActivity")) ctx.put("daysSinceLastActivity", ctx.optLong("daysSinceLastActivity") + days);
                if (days > 1) ctx.put("streakDays", 0);
                ctx.remove("today");
                ctx.put("snapshotAgeDays", days);
            }
        }
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(20000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("X-Device", device);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") HefzTadabbori");
        try (OutputStream o = c.getOutputStream()) { o.write(req.toString().getBytes(StandardCharsets.UTF_8)); }
        if (c.getResponseCode() != 200) return null;
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        try (InputStream in = c.getInputStream()) {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        }
        // Notifications show plain text: drop the model's **bold** marks
        return new JSONObject(bo.toString("UTF-8")).optString("text", "").replace("**", "");
    }

    static void show(Context c, String title, String text) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "پیام امروز دستیار", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(c, 10, new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true);
        try { NotificationManagerCompat.from(c).notify(ID, b.build()); } catch (SecurityException ignored) { }
    }
}
