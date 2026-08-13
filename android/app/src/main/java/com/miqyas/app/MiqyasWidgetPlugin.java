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
 * Bridges today's calorie/water totals from the web app (running inside the
 * Capacitor WebView, backed by localStorage) to the native home-screen
 * widget, which — being a separate OS-level surface (RemoteViews drawn by
 * the launcher process) — has no access to the WebView's localStorage and
 * can only read plain Android SharedPreferences.
 *
 * Called from docs/js/core.js's syncWidget(), itself invoked after every
 * persist() (i.e. every time a meal, water amount, or goal changes) and
 * once at app boot, so the widget stays in sync with almost no lag while
 * the app is open. The widget provider itself (see
 * CalorieWaterWidgetProvider) treats stale data (from a previous day) as
 * zero, so a widget left un-refreshed overnight doesn't show yesterday's
 * numbers as if they were today's.
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
        editor.apply();

        // Ask Android to redraw every placed instance of the widget right now,
        // instead of waiting for the next periodic (30-min minimum) update.
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        ComponentName cn = new ComponentName(ctx, CalorieWaterWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(cn);
        if (ids != null && ids.length > 0) {
            Intent intent = new Intent(ctx, CalorieWaterWidgetProvider.class);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            ctx.sendBroadcast(intent);
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
