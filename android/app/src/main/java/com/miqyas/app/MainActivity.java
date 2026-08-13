package com.miqyas.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The app targets SDK 36 (Android 15+), where the OS enforces edge-to-edge
        // display and — unless we opt out of the default handling below — paints its
        // own translucent black "contrast protection" gradient on top of our WebView
        // content, anchored right above the system navigation bar. That system-drawn
        // scrim is what shows up as a black smudge behind the bottom nav (and behind
        // any bottom sheet content, like the water quick-add row, that sits near the
        // bottom edge of the screen). No CSS change can remove it because it isn't
        // part of the page — it's composited by the OS window manager on top of
        // everything. Disabling contrast enforcement and making both system bars
        // fully transparent removes that scrim.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
    }
}
