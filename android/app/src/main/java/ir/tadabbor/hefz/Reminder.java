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

import org.json.JSONArray;
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
 * Two daily notifications, each with its own time and switch:
 *  - "review": memorization/tadabbur reviews due today, counted at the moment it fires from the due days the page
 *    handed over (so the number stays right even if the app was not opened for days); skipped when nothing is due
 *    and the reader has already studied today.
 *  - "tip": the AI assistant's message of the day. Uses today's message if the app already fetched it, otherwise asks
 *    the AI server (same address as the in-app assistant) with the last known status; without internet it falls back
 *    to the app's own offline message.
 * Each alarm is a one-shot that reschedules itself for the next day (more punctual than an inexact repeating alarm),
 * and both are set again after a reboot or an app update.
 */
public class Reminder extends BroadcastReceiver {
    static final String PREFS = "reminder";
    static final String CH_REVIEW = "daily", CH_TIP = "tip";
    static final String A_REVIEW = "ir.tadabbor.hefz.REMIND", A_TIP = "ir.tadabbor.hefz.REMIND_TIP";
    static final String[] PART_FA = {"نیمه‌شب", "صبح", "ظهر", "عصر", "شب"};

    /** Old single-reminder entry point (kept for pages built before the two-notification settings). */
    static void save(Context c, boolean on, int hour, int minute, String title, String text) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("on", on).putInt("h", hour).putInt("m", minute)
                .putString("title", title).putString("text", text).remove("cfg").apply();
        schedule(c);
    }

    /** New entry point: the whole configuration as JSON from the page (see notifyCfg() in the page). */
    static void saveAll(Context c, String json) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("cfg", json).apply();
        schedule(c);
    }

    static JSONObject cfg(Context c) {
        try { String s = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("cfg", null); return s == null ? null : new JSONObject(s); }
        catch (Exception e) { return null; }
    }

    /** Local day number, the same as today() in the page. */
    static long today() {
        long now = System.currentTimeMillis();
        return (now + TimeZone.getDefault().getOffset(now)) / 86400000L;
    }

    static PendingIntent alarm(Context c, String action) {
        return PendingIntent.getBroadcast(c, A_TIP.equals(action) ? 9 : 7, new Intent(c, Reminder.class).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject j = cfg(c);
        if (j != null) {
            JSONObject r = j.optJSONObject("review"), t = j.optJSONObject("tip");
            set(c, A_REVIEW, r != null && r.optBoolean("on"), r == null ? 20 : r.optInt("h", 20), r == null ? 0 : r.optInt("m", 0));
            set(c, A_TIP, t != null && t.optBoolean("on"), t == null ? 8 : t.optInt("h", 8), t == null ? 0 : t.optInt("m", 0));
        } else {
            set(c, A_REVIEW, p.getBoolean("on", false), p.getInt("h", 20), p.getInt("m", 0));
            set(c, A_TIP, false, 8, 0);
        }
    }

    static void set(Context c, String action, boolean on, int h, int m) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarm(c, action);
        am.cancel(pi);
        if (!on) return;
        Calendar t = Calendar.getInstance();
        t.set(Calendar.HOUR_OF_DAY, h);
        t.set(Calendar.MINUTE, m);
        t.set(Calendar.SECOND, 0);
        t.set(Calendar.MILLISECOND, 0);
        if (t.getTimeInMillis() <= System.currentTimeMillis() + 30000) t.add(Calendar.DAY_OF_MONTH, 1);
        // Works in Doze too; Android may still shift it by a few minutes, which is fine for a daily reminder
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t.getTimeInMillis(), pi);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) { schedule(c); return; }
        boolean test = intent.getBooleanExtra("test", false);
        if (A_TIP.equals(a)) {
            final PendingResult pr = goAsync();
            new Thread(() -> {
                try { showTip(c, test); } catch (Exception ignored) { }
                finally { if (!test) schedule(c); pr.finish(); }
            }).start();
            return;
        }
        try { showReview(c, test); } catch (Exception ignored) { }
        if (!test) schedule(c);
    }

    static int countDue(JSONArray days, long d) {
        int n = 0;
        if (days != null) for (int i = 0; i < days.length(); i++) if (days.optLong(i, Long.MAX_VALUE) <= d) n++;
        return n;
    }

    static String fa(long n) {
        String s = String.valueOf(n); StringBuilder b = new StringBuilder();
        for (char ch : s.toCharArray()) b.append(ch >= '0' && ch <= '9' ? (char) ('۰' + (ch - '0')) : ch);
        return b.toString();
    }

    static void showReview(Context c, boolean test) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject j = cfg(c);
        String title, text;
        if (j == null) {
            if (!test && !p.getBoolean("on", false)) return;
            title = p.getString("title", "حفظ تدبری");
            text = p.getString("text", "وقت تدبر و مرور امروز است");
        } else {
            JSONObject r = j.optJSONObject("review");
            if (r == null || (!test && !r.optBoolean("on"))) return;
            long d = today();
            int md = countDue(r.optJSONArray("mem"), d), td = countDue(r.optJSONArray("tad"), d), weak = r.optInt("weak", 0);
            boolean studied = r.optLong("active", -1) == d;
            String next = r.optString("next", "");
            if (!test && md == 0 && td == 0 && studied) return;   // done for today: no need to nag
            String name = r.optString("name", "");
            StringBuilder b = new StringBuilder();
            if (md > 0) b.append(fa(md)).append(" مرور حفظ");
            if (td > 0) b.append(b.length() > 0 ? " · " : "").append(fa(td)).append(" مرور تدبر");
            if (weak > 0 && (md > 0 || td > 0)) b.append(" · ").append(fa(weak)).append(" آیه در دفتر اشتباهات");
            if (b.length() > 0) {
                title = (name.isEmpty() ? "" : name + "، ") + "مرورهای امروز منتظر شماست";
                text = b + (next.isEmpty() ? "" : "\nقدم بعد: " + next);
            } else {
                title = (name.isEmpty() ? "" : name + "، ") + "وقت حفظ تدبری است";
                text = next.isEmpty() ? "مروری امروز سررسید نشده؛ یک سیاق تازه یا تمرین کوتاه چطور است؟" : "مروری سررسید نشده. قدم بعد: " + next;
            }
        }
        post(c, CH_REVIEW, "یادآور مرور", 1, title, text);
    }

    static void showTip(Context c, boolean test) {
        JSONObject j = cfg(c);
        if (j == null) return;
        JSONObject t = j.optJSONObject("tip");
        if (t == null || (!test && !t.optBoolean("on"))) return;
        long d = today();
        String name = t.optString("name", ""), text = null;
        JSONObject cached = t.optJSONObject("cached");
        if (cached != null && cached.optLong("day", -1) == d && !cached.optString("text", "").isEmpty()) text = cached.optString("text");
        String url = t.optString("url", "");
        if (text == null && url.startsWith("http")) text = fetchTip(c, url, t.optString("device", ""), t.optJSONObject("ctx"), j.optJSONObject("review"), d);
        if (text == null || text.isEmpty()) text = t.optString("local", "");
        if (text.isEmpty()) return;
        text = text.replace("**", "").replaceAll("(?m)^\\s*[-*•]\\s+", "• ").trim();
        post(c, CH_TIP, "پیام روز دستیار", 2, "✦ پیام امروز" + (name.isEmpty() ? "" : " برای " + name), text);
    }

    /** Ask the AI server for a short message for a notification; null when it fails (the caller then uses the offline text). */
    static String fetchTip(Context c, String url, String device, JSONObject ctx, JSONObject review, long d) {
        try {
            if (ctx == null) ctx = new JSONObject();
            // Bring the saved status up to the present: time of day, days away and what is due now
            Calendar now = Calendar.getInstance();
            int h = now.get(Calendar.HOUR_OF_DAY);
            JSONObject nw = ctx.optJSONObject("now"); if (nw == null) { nw = new JSONObject(); ctx.put("now", nw); }
            nw.put("time", String.format(java.util.Locale.US, "%02d:%02d", h, now.get(Calendar.MINUTE)));
            nw.put("part", PART_FA[h < 4 ? 0 : h < 11 ? 1 : h < 15 ? 2 : h < 19 ? 3 : 4]);
            if (ctx.optLong("ctxDay", d) != d) nw.remove("date");
            long last = review == null ? -1 : review.optLong("active", -1);
            if (last >= 0) { ctx.put("daysSinceLastActivity", d - last); if (d - last > 1) ctx.put("streakDays", 0); }
            if (review != null) {
                JSONObject od = ctx.optJSONObject("overdue"); if (od == null) { od = new JSONObject(); ctx.put("overdue", od); }
                od.put("memReviews", countDue(review.optJSONArray("mem"), d));
                od.put("tadReviews", countDue(review.optJSONArray("tad"), d));
            }
            ctx.remove("ctxDay");
            JSONObject body = new JSONObject().put("mode", "daily").put("notify", true).put("ctx", ctx);
            HttpURLConnection h2 = (HttpURLConnection) new URL(url).openConnection();
            h2.setConnectTimeout(10000);
            h2.setReadTimeout(25000);
            h2.setRequestMethod("POST");
            h2.setDoOutput(true);
            h2.setRequestProperty("Content-Type", "application/json");
            h2.setRequestProperty("X-Device", device);
            h2.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") HefzTadabbori");
            try (OutputStream o = h2.getOutputStream()) { o.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            if (h2.getResponseCode() != 200) return null;
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (InputStream in = h2.getInputStream()) { byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); }
            String text = new JSONObject(bo.toString("UTF-8")).optString("text", "").trim();
            return text.isEmpty() ? null : text;
        } catch (Exception e) { return null; }
    }

    static void post(Context c, String channel, String channelName, int id, String title, String text) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(channel) == null)
            nm.createNotificationChannel(new NotificationChannel(channel, channelName, NotificationManager.IMPORTANCE_DEFAULT));
        Intent go = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(c, 8 + id, go, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true);
        try { NotificationManagerCompat.from(c).notify(id, b.build()); } catch (SecurityException ignored) { }
    }
}
