package com.kub.messenger;

import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowManager;

// Only the separately packaged offline instrumentation app may declare this Activity.
public final class VaultProvisioningProbeActivity extends Activity {
    private static volatile long launchUntil;
    private volatile boolean resumed;

    static void allowLaunch(long until) { launchUntil = until; }
    static void disallowLaunch() { launchUntil = 0; }
    private static boolean launchCurrent() {
        long now = SystemClock.elapsedRealtime(); return now >= 0 && now < launchUntil;
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (!launchCurrent()) { finish(); return; }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE
            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(new View(this));
    }

    @Override protected void onResume() {
        // The base implementation dispatches resumed callbacks synchronously.
        resumed = launchCurrent(); super.onResume(); if (!resumed) finish();
    }
    @Override protected void onPause() { resumed = false; super.onPause(); }
    @Override protected void onStop() { resumed = false; super.onStop(); }
    @Override protected void onDestroy() { resumed = false; super.onDestroy(); }

    boolean isProbeResumed() { return resumed && !isFinishing() && !isDestroyed(); }
}
