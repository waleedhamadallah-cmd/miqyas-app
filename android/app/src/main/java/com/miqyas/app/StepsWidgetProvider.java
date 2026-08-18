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
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Build;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Home-screen widget showing today's steps (as a ring, matching the app's
 * own steps-detail ring color — see --steps in docs/css/styles.css), plus
 * distance, calories burned, and — since the calorie/water widget's own
 * fields are reused here too — remaining/over food calories, all inspired
 * by the reference widget screenshot the user shared.
 *
 * Read-only by design, same as CalorieWaterWidgetProvider — tapping the
 * body opens the app; tapping the small refresh icon just re-renders
 * whatever is already cached in SharedPreferences (no live Health Connect
 * read from the widget process — that only ever happens inside the app,
 * which is what keeps the cached values here trustworthy in the first
 * place).
 *
 * Two colors respond to the user's own progress, mirroring how the app
 * itself signals the same two states elsewhere:
 *  - The steps ring switches from the app's steps-purple to the app's own
 *    "good" teal/blue gradient (#ringGrad in docs/index.html) once today's
 *    goal is reached — same idea as the streak flame getting warmer with a
 *    longer streak, just applied to "did I hit today's goal".
 *  - The calories-eaten pill switches to the app's own "over goal" red
 *    gradient (#ringGradOver) once logged calories pass the daily goal —
 *    literally the same threshold and colors as the home hero ring's
 *    `over` state (see renderRing() in docs/js/home.js).
 *
 * Data comes from SharedPreferences written by MiqyasWidgetPlugin, which
 * the web app calls after every steps sync AND after every persist() (see
 * refreshSteps()/cacheSteps() in docs/js/home.js + core.js, and syncWidget()
 * in core.js). If a given day's data isn't today's (e.g. the app hasn't
 * been reopened/synced since before midnight), the affected part of the
 * widget shows its own unsynced/empty state instead of a stale number from
 * yesterday — same treatment CalorieWaterWidgetProvider gives its data.
 * Steps/distance/calories-burned and calories-eaten are tracked against two
 * independent "is this today's data" checks (stepsDateKey vs dateKey)
 * since they come from two different sync pipelines (Health Connect vs
 * meal logging) that don't necessarily update at the same moment.
 */
public class StepsWidgetProvider extends AppWidgetProvider {

    private static final int RING_SIZE_DP = 100;
    private static final int RING_STROKE_DP = 9;
    private static final int RING_TRACK_COLOR = Color.parseColor("#2A3138");

    // In-progress ring: the app's own --steps purple, as a light-to-solid
    // gradient for a bit more depth than a flat stroke.
    private static final int[] RING_COLORS_PROGRESS = {Color.parseColor("#C2AFFF"), Color.parseColor("#9B7BFF")};
    // Goal-reached ring: the app's own #ringGrad ("good") gradient.
    private static final int[] RING_COLORS_ACHIEVED = {Color.parseColor("#5EE6C9"), Color.parseColor("#2F6FE0")};

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateWidget(context, appWidgetManager, id);
        }
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(MiqyasWidgetPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());

        boolean stepsIsToday = prefs.getString("stepsDateKey", "").equals(todayKey);
        int goal = prefs.getInt("stepsGoal", 8000);
        int steps = stepsIsToday ? prefs.getInt("stepsCurrent", 0) : 0;
        float distanceKm = stepsIsToday ? prefs.getFloat("stepsDistanceKm", 0f) : 0f;
        int caloriesBurned = stepsIsToday ? prefs.getInt("stepsCalories", 0) : 0;
        long syncedAt = stepsIsToday ? prefs.getLong("stepsSyncedAt", 0L) : 0L;
        boolean achieved = goal > 0 && steps >= goal;

        boolean calIsToday = prefs.getString("dateKey", "").equals(todayKey);
        int calGoal = prefs.getInt("calGoal", 2000);
        int calCurrent = calIsToday ? prefs.getInt("calCurrent", 0) : 0;
        int calRemaining = calGoal - calCurrent;
        boolean calOver = calIsToday && calRemaining < 0;

        float pct = goal > 0 ? Math.min(steps / (float) goal, 1f) : 0f;

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_steps);

        views.setImageViewBitmap(R.id.widgetStepsRingImg, createRingBitmap(context, pct, achieved));
        views.setTextViewText(R.id.widgetStepsValue, String.format(Locale.US, "%,d", steps));
        views.setTextViewText(R.id.widgetStepsGoalText, "من " + String.format(Locale.US, "%,d", goal));
        views.setTextViewText(R.id.widgetStepsDistance, String.format(Locale.US, "%.2f كم", distanceKm));
        views.setTextViewText(R.id.widgetStepsCalories, String.format(Locale.US, "%,d", caloriesBurned));

        // calRemaining can be negative once over goal — the label switches
        // (matching the app's own hero ring wording) and the value shows a
        // plain positive magnitude either way, since the label already says
        // which direction it is.
        views.setTextViewText(R.id.widgetStepsCalEatenLabel, calOver ? "سعرة زيادة عن الهدف" : "سعرة متبقية");
        views.setTextViewText(R.id.widgetStepsCalEatenValue, String.format(Locale.US, "%,d", Math.abs(calRemaining)));
        views.setInt(R.id.widgetStepsCalEatenPill, "setBackgroundResource",
                calOver ? R.drawable.widget_stat_pill_bg_warn : R.drawable.widget_stat_pill_bg);

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
    // into an ImageView via setImageViewBitmap() above. The stroke uses a
    // diagonal LinearGradient (matching the app's own #ringGrad/#ringGradOver
    // SVG gradients, which are also top-left-to-bottom-right) instead of a
    // flat color, purely for a bit more visual depth.
    private static Bitmap createRingBitmap(Context context, float pct, boolean achieved) {
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

        paint.setShader(null);
        paint.setColor(RING_TRACK_COLOR);
        canvas.drawArc(rect, 0, 360, false, paint);

        float sweep = 360f * Math.max(0f, Math.min(1f, pct));
        if (sweep > 0f) {
            int[] colors = achieved ? RING_COLORS_ACHIEVED : RING_COLORS_PROGRESS;
            paint.setShader(new LinearGradient(0, 0, sizePx, sizePx, colors[0], colors[1], Shader.TileMode.CLAMP));
            canvas.drawArc(rect, -90, sweep, false, paint);
        }

        return bitmap;
    }
}
