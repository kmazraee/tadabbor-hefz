package ir.tadabbor.hefz;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/** Home-screen widget: today's reviews and next step, and a verse of the day. The page fills it through the bridge. */
public class Widget extends AppWidgetProvider {
    static final String PREFS = "widget";

    static void save(Context c, String title, String line, String verse, String meaning) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("title", title).putString("line", line).putString("verse", verse).putString("meaning", meaning).apply();
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, Widget.class));
        if (ids.length > 0) new Widget().onUpdate(c, m, ids);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        PendingIntent open = PendingIntent.getActivity(c, 9, new Intent(c, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
            v.setTextViewText(R.id.w_title, p.getString("title", "حفظ تدبری"));
            v.setTextViewText(R.id.w_line, p.getString("line", "برنامه را باز کنید تا برنامه امروز ساخته شود"));
            v.setTextViewText(R.id.w_verse, p.getString("verse", ""));
            v.setTextViewText(R.id.w_meaning, p.getString("meaning", ""));
            v.setOnClickPendingIntent(R.id.w_root, open);
            m.updateAppWidget(id, v);
        }
    }
}
