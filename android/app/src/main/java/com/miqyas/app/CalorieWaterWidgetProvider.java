package com.miqyas.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Home-screen widget showing today's calories-vs-goal and water-vs-goal as
 * two small progress bars. Read-only by design (per the user's choice) —
 * tapping anywhere on it opens the app rather than logging water directly,
 * so there's no risk of the widget's cached numbers drifting from what the
 * app itself shows.
 *
 * Data comes from SharedPreferences written by MiqyasWidgetPlugin, which the
 * web app calls on every state change. If the stored date isn't today (e.g.
 * the app hasn't been opened since before midnight), the widget shows 0 for
 * both instead of yesterday's stale totals — see updateWidget() below.
 */
public class CalorieWaterWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateWidget(context, appWidgetManager, id);
        }
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(MiqyasWidgetPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String storedDate = prefs.getString("dateKey", "");
        String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        boolean isToday = storedDate.equals(todayKey);

        int calGoal = prefs.getInt("calGoal", 2000);
        int waterGoal = prefs.getInt("waterGoal", 2500);
        int calCurrent = isToday ? prefs.getInt("calCurrent", 0) : 0;
        int waterCurrent = isToday ? prefs.getInt("waterCurrent", 0) : 0;

        int calPct = calGoal > 0 ? Math.min(Math.round(calCurrent * 100f / calGoal), 100) : 0;
        int waterPct = waterGoal > 0 ? Math.min(Math.round(waterCurrent * 100f / waterGoal), 100) : 0;

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calorie_water);
        views.setTextViewText(R.id.widgetCalText, calCurrent + " / " + calGoal + " سعرة");
        views.setProgressBar(R.id.widgetCalBar, 100, calPct, false);
        views.setTextViewText(R.id.widgetWaterText, waterCurrent + " / " + waterGoal + " مل");
        views.setProgressBar(R.id.widgetWaterBar, 100, waterPct, false);

        Intent launchIntent = new Intent(context, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, launchIntent, flags);
        views.setOnClickPendingIntent(R.id.widgetRoot, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
