package com.miqyas.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Build;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Home-screen widget showing today's steps (as a ring, matching the app's
 * own steps-detail ring) plus distance and calories burned, inspired by the
 * reference widget screenshot the user shared. Read-only by design, same as
 * CalorieWaterWidgetProvider — tapping the body opens the app; tapping the
 * small refresh icon just re-renders whatever is already cached in
 * SharedPreferences (no live Health Connect read from the widget process —
 * that only ever happens inside the app, which is what keeps the cached
 * values here trustworthy in the first place).
 *
 * Data comes from SharedPreferences written by MiqyasWidgetPlugin, which the
 * web app calls after every steps sync (see refreshSteps()/cacheSteps() in
 * docs/js/home.js + core.js). If the stored date isn't today (e.g. the app
 * hasn't been reopened/synced since before midnight), the widget shows an
 * unsynced empty state instead of yesterday's stale numbers — same
 * treatment CalorieWaterWidgetProvider gives its own stale data.
 */
public class StepsWidgetProvider extends AppWidgetProvider {

    private static final int RING_SIZE_DP = 100;
    private static final int RING_STROKE_DP = 9;
    private static final int RING_TRACK_COLOR = Color.parseColor("#2A3138");
    private static final int RING_PROGRESS_COLOR = Color.parseColor("#2FD3A6");

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateWidget(context, appWidgetManager, id);
        }
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(MiqyasWidgetPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String storedDate = prefs.getString("stepsDateKey", "");
        String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        boolean isToday = storedDate.equals(todayKey);

        int goal = prefs.getInt("stepsGoal", 8000);
        int steps = isToday ? prefs.getInt("stepsCurrent", 0) : 0;
        float distanceKm = isToday ? prefs.getFloat("stepsDistanceKm", 0f) : 0f;
        int calories = isToday ? prefs.getInt("stepsCalories", 0) : 0;
        long syncedAt = isToday ? prefs.getLong("stepsSyncedAt", 0L) : 0L;

        float pct = goal > 0 ? Math.min(steps / (float) goal, 1f) : 0f;

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_steps);

        views.setImageViewBitmap(R.id.widgetStepsRingImg, createRingBitmap(context, pct));
        views.setTextViewText(R.id.widgetStepsValue, String.format(Locale.US, "%,d", steps));
        views.setTextViewText(R.id.widgetStepsGoalText, "من " + String.format(Locale.US, "%,d", goal));
        views.setTextViewText(R.id.widgetStepsDistance, String.format(Locale.US, "%.2f كم", distanceKm));
        views.setTextViewText(R.id.widgetStepsCalories, String.format(Locale.US, "%,d", calories));

        if (syncedAt > 0) {
            String time = new SimpleDateFormat("HH:mm", Locale.US).format(new Date(syncedAt));
            views.setTextViewText(R.id.widgetStepsSyncText, "آخر مزامنة " + time);
        } else {
            views.setTextViewText(R.id.widgetStepsSyncText, "لم تتم المزامنة اليوم بعد");
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        Intent launchIntent = new Intent(context, MainActivity.class);
        PendingIntent openAppIntent = PendingIntent.getActivity(context, 0, launchIntent, flags);
        views.setOnClickPendingIntent(R.id.widgetStepsRoot, openAppIntent);

        Intent refreshIntent = new Intent(context, StepsWidgetProvider.class);
        refreshIntent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        refreshIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, new int[]{appWidgetId});
        PendingIntent refreshPendingIntent = PendingIntent.getBroadcast(context, appWidgetId, refreshIntent, flags);
        views.setOnClickPendingIntent(R.id.widgetStepsRefresh, refreshPendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    // RemoteViews has no native arc/ring view, so the progress ring is drawn
    // by hand into a Bitmap here (same stroke-round-cap look as the app's
    // own SVG rings — see paintStepsRing() in docs/js/home.js) and dropped
    // into an ImageView via setImageViewBitmap() above.
    private static Bitmap createRingBitmap(Context context, float pct) {
        float density = context.getResources().getDisplayMetrics().density;
        int sizePx = Math.round(RING_SIZE_DP * density);
        float strokePx = RING_STROKE_DP * density;

        Bitmap bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(strokePx);
        paint.setStrokeCap(Paint.Cap.ROUND);

        RectF rect = new RectF(strokePx / 2f, strokePx / 2f, sizePx - strokePx / 2f, sizePx - strokePx / 2f);

        paint.setColor(RING_TRACK_COLOR);
        canvas.drawArc(rect, 0, 360, false, paint);

        float sweep = 360f * Math.max(0f, Math.min(1f, pct));
        if (sweep > 0f) {
            paint.setColor(RING_PROGRESS_COLOR);
            canvas.drawArc(rect, -90, sweep, false, paint);
        }

        return bitmap;
    }
}
