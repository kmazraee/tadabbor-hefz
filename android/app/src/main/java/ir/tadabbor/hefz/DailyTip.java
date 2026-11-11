package ir.tadabbor.hefz;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * The AI assistant's «پیام امروز» as a daily notification.
 * A daily inexact alarm wakes this receiver, which hands the work to {@link DailyTipJob} (a job may use the network
 * for longer than a receiver may). The page saves what the job needs: the assistant's address, a compact picture of
 * the reader's progress (the same one the home card sends) and an offline text to show when the assistant cannot be reached.
 */
public class DailyTip extends BroadcastReceiver {
    static final String PREFS = "dailytip";
    static final String ACTION = "ir.tadabbor.hefz.DAILY_TIP";
    static final int JOB_ID = 4711;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void save(Context c, boolean on, int hour, int minute, String url, String device, String ctx, String fallback, String name) {
        prefs(c).edit().putBoolean("on", on).putInt("h", hour).putInt("m", minute)
                .putString("url", url).putString("device", device).putString("ctx", ctx)
                .putString("fallback", fallback).putString("name", name)
                .putLong("ctxDay", dayNumber(System.currentTimeMillis())).apply();
        schedule(c);
    }

    /** The message the page already showed today, so the notification says the same thing. */
    static void saveToday(Context c, String key, String text) { prefs(c).edit().putString("tipKey", key).putString("tipText", text).apply(); }

    static String lastTip(Context c) {
        SharedPreferences p = prefs(c);
        try { return new JSONObject().put("k", p.getString("tipKey", "")).put("text", p.getString("tipText", "")).toString(); }
        catch (Exception e) { return "{}"; }
    }

    /** Calendar day in the phone's local time, the same number the page's today() gives. */
    static long dayNumber(long ms) { return (ms + TimeZone.getDefault().getOffset(ms)) / 86400000L; }

    /** Part of the day, as dayPart() in the page. */
    static String dayPart(int h) { return h < 4 ? "midnight" : h < 11 ? "morning" : h < 15 ? "noon" : h < 19 ? "afternoon" : "night"; }

    static String todayKey() {
        long now = System.currentTimeMillis();
        return dayNumber(now) + ":" + dayPart(Calendar.getInstance().get(Calendar.HOUR_OF_DAY));
    }

    static void schedule(Context c) {
        SharedPreferences p = prefs(c);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 17, new Intent(c, DailyTip.class).setAction(ACTION),
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
        if (!ACTION.equals(a) || !prefs(c).getBoolean("on", false)) return;
        // Runs as soon as there is a connection; after 15 minutes without one it runs anyway and shows the offline text
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, DailyTipJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setOverrideDeadline(15 * 60 * 1000L)
                .build();
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.schedule(job);
    }
}
