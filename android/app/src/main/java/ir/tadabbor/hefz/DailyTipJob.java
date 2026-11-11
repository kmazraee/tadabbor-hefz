package ir.tadabbor.hefz;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobParameters;
import android.app.job.JobService;
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

/** Asks the assistant for today's message (or reuses the one already shown in the app) and posts it as a notification. */
public class DailyTipJob extends JobService {
    static final String CHANNEL = "ai";
    static final String[] PART_FA = {"نیمه‌شب", "صبح", "ظهر", "عصر", "شب"};

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            try { show(this, message(this)); } catch (Exception ignored) { }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return false; }

    static String message(Context c) {
        SharedPreferences p = DailyTip.prefs(c);
        String key = DailyTip.todayKey();
        if (key.equals(p.getString("tipKey", "")) && !p.getString("tipText", "").isEmpty()) return p.getString("tipText", "");
        String url = p.getString("url", "");
        if (url.startsWith("http")) {
            try {
                String text = ask(url, p.getString("device", ""), freshContext(p));
                if (text != null && !text.trim().isEmpty()) { DailyTip.saveToday(c, key, text.trim()); return text.trim(); }
            } catch (Exception ignored) { }
        }
        return p.getString("fallback", "وقت تدبر و مرور امروز است");
    }

    /** The saved progress picture, brought to this moment: the clock, the part of the day and the days that passed. */
    static String freshContext(SharedPreferences p) throws Exception {
        JSONObject ctx = new JSONObject(p.getString("ctx", "{}"));
        Calendar now = Calendar.getInstance();
        int h = now.get(Calendar.HOUR_OF_DAY);
        String part = DailyTip.dayPart(h);
        String[] parts = {"midnight", "morning", "noon", "afternoon", "night"};
        String fa = "";
        for (int i = 0; i < parts.length; i++) if (parts[i].equals(part)) fa = PART_FA[i];
        JSONObject n = ctx.optJSONObject("now");
        if (n == null) n = new JSONObject();
        n.put("time", String.format(Locale.US, "%02d:%02d", h, now.get(Calendar.MINUTE))).put("part", fa);
        long passed = DailyTip.dayNumber(System.currentTimeMillis()) - p.getLong("ctxDay", DailyTip.dayNumber(System.currentTimeMillis()));
        if (passed > 0) {
            n.remove("date");
            if (!ctx.isNull("daysSinceLastActivity") && ctx.has("daysSinceLastActivity"))
                ctx.put("daysSinceLastActivity", ctx.optInt("daysSinceLastActivity") + passed);
            JSONObject t = ctx.optJSONObject("today");
            if (t != null) t.put("ayatMemorized", 0).put("siyaqTadabbur", 0).put("reviews", 0);
        }
        ctx.put("now", n);
        return new JSONObject().put("mode", "daily").put("ctx", ctx).toString();
    }

    static String ask(String url, String device, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(45000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("X-Device", device);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") HefzTadabbori");
        try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        if (c.getResponseCode() != 200) return null;
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int k;
            while ((k = in.read(buf)) > 0) bo.write(buf, 0, k);
            return new JSONObject(bo.toString("UTF-8")).optString("text", null);
        }
    }

    static void show(Context c, String text) {
        String plain = text.replaceAll("\\*\\*([^*\\n]+)\\*\\*", "$1").replaceAll("(?m)^\\s*[-•*]\\s+", "• ").trim();
        String name = DailyTip.prefs(c).getString("name", "");
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "پیام روزانه دستیار هوشمند", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(c, 18, new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(name.isEmpty() ? "✦ پیام امروز دستیار" : "✦ پیام امروز برای " + name)
                .setContentText(plain)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(plain))
                .setContentIntent(open)
                .setAutoCancel(true);
        try { NotificationManagerCompat.from(c).notify(2, b.build()); } catch (SecurityException ignored) { }
    }
}
