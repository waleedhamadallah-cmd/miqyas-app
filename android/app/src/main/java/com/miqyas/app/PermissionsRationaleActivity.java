package com.miqyas.app;

import android.app.Activity;
import android.os.Bundle;

/**
 * Required by Health Connect: when the user taps "privacy policy" from the
 * system Health Connect permission dialog, it opens whatever activity is
 * registered for androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE (Android
 * 13 and below) / the ViewPermissionUsageActivity alias (Android 14+) — see
 * AndroidManifest.xml. مِقياس has no separate privacy-policy webpage, so
 * this just explains in-app, in plain terms, what the app writes to and
 * reads from Health Connect (see activity_permissions_rationale.xml).
 */
public class PermissionsRationaleActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_permissions_rationale);
    }
}
