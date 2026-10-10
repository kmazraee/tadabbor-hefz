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

import java.util.Calendar;

/** Daily study reminder: an inexact daily alarm that shows one notification, rescheduled after reboot. */
public class Reminder extends BroadcastReceiver {
    static final String PREFS = "reminder";
    static final String CHANNEL = "daily";

    static void save(Context c, boolean on, int hour, int minute, String title, String text) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("on", on).putInt("h", hour).putInt("m", minute)
                .putString("title", title).putString("text", text).apply();
        schedule(c);
    }

    static void schedule(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 7, new Intent(c, Reminder.class).setAction("ir.tadabbor.hefz.REMIND"),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (!p.getBoolean("on", false)) return;
        Calendar t = Calendar.getInstance();
        t.set(Calendar.HOUR_OF_DAY, p.getInt("h", 20));
        t.set(Calendar.MINUTE, p.getInt("m", 0));
        t.set(Calendar.SECOND, 0);
        if (t.getTimeInMillis() <= System.currentTimeMillis()) t.add(Calendar.DAY_OF_MONTH, 1);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, t.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) { schedule(c); return; }
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("on", false)) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "یادآور روزانه", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(c, 8, new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(p.getString("title", "حفظ تدبری"))
                .setContentText(p.getString("text", "وقت تدبر و مرور امروز است"))
                .setStyle(new NotificationCompat.BigTextStyle().bigText(p.getString("text", "وقت تدبر و مرور امروز است")))
                .setContentIntent(open)
                .setAutoCancel(true);
        try { NotificationManagerCompat.from(c).notify(1, b.build()); } catch (SecurityException ignored) { }
    }
}
