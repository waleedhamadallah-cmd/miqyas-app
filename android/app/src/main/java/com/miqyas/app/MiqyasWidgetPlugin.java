package com.miqyas.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges today's calorie/water totals — and, since the steps widget was
 * added, today's steps/distance/calories-burned totals too — from the web
 * app (running inside the Capacitor WebView, backed by localStorage) to the
 * native home-screen widgets, which — being separate OS-level surfaces
 * (RemoteViews drawn by the launcher process) — have no access to the
 * WebView's localStorage and can only read plain Android SharedPreferences.
 *
 * Called from docs/js/core.js's syncWidget(), itself invoked after every
 * persist() (i.e. every time a meal, water amount, goal, or steps sync
 * changes) and once at app boot, so both widgets stay in sync with almost
 * no lag while the app is open. Each widget provider (see
 * CalorieWaterWidgetProvider and StepsWidgetProvider) treats stale data
 * (from a previous day) as zero/unsynced, so a widget left un-refreshed
 * overnight doesn't show yesterday's numbers as if they were today's.
 */
@CapacitorPlugin(name = "MiqyasWidget")
public class MiqyasWidgetPlugin extends Plugin {

    public static final String PREFS_NAME = "com.miqyas.app.widget";

    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();

        SharedPreferences.Editor editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        editor.putString("dateKey", call.getString("dateKey", ""));
        editor.putInt("calCurrent", call.getInt("calCurrent", 0));
        editor.putInt("calGoal", call.getInt("calGoal", 2000));
        editor.putInt("waterCurrent", call.getInt("waterCurrent", 0));
        editor.putInt("waterGoal", call.getInt("waterGoal", 2500));

        // Steps fields are only meaningful once Health Connect is granted —
        // absent on the plain web/PWA and before the user connects it, in
        // which case the JS side just omits them and these defaults (0 /
        // never-synced) keep the steps widget in its honest empty state.
        editor.putString("stepsDateKey", call.getString("stepsDateKey", ""));
        editor.putInt("stepsCurrent", call.getInt("stepsCurrent", 0));
        editor.putInt("stepsGoal", call.getInt("stepsGoal", 8000));
        editor.putFloat("stepsDistanceKm", call.getFloat("stepsDistanceKm", 0f));
        editor.putInt("stepsCalories", call.getInt("stepsCalories", 0));
        editor.putLong("stepsSyncedAt", call.getLong("stepsSyncedAt", 0L));
        editor.apply();

        // Ask Android to redraw every placed instance of both widgets right
        // now, instead of waiting for the next periodic (30-min minimum)
        // update.
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        requestRedraw(ctx, mgr, CalorieWaterWidgetProvider.class);
        requestRedraw(ctx, mgr, StepsWidgetProvider.class);

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    private void requestRedraw(Context ctx, AppWidgetManager mgr, Class<?> providerClass) {
        ComponentName cn = new ComponentName(ctx, providerClass);
        int[] ids = mgr.getAppWidgetIds(cn);
        if (ids != null && ids.length > 0) {
            Intent intent = new Intent(ctx, providerClass);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            ctx.sendBroadcast(intent);
        }
    }
}
