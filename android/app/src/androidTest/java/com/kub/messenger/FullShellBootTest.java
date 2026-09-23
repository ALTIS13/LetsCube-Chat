package com.kub.messenger;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNotNull;

import android.app.Instrumentation;
import android.app.Instrumentation.ActivityMonitor;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.io.File;
import java.io.FileOutputStream;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Guest-only full Capacitor shell smoke, run on an owned empty emulator. */
@RunWith(AndroidJUnit4.class)
public class FullShellBootTest {
    private static final String READY = "document.documentElement.dataset.kubBootState === 'ready'"
        + " && document.getElementById('root')?.dataset.kubAppReady === 'true'"
        + " && !document.getElementById('kub-boot-recovery')"
        + " && (() => {"
        + " const field = document.querySelector('[data-testid=auth-form-shell] input[type=email]');"
        + " if (!field) return false;"
        + " const style = getComputedStyle(field);"
        + " const rect = field.getBoundingClientRect();"
        + " return style.display !== 'none' && style.visibility === 'visible'"
        + " && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;"
        + " })()";

    private boolean evaluate(Instrumentation instrumentation, MainActivity activity, String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            WebView webView = activity.getBridge() == null ? null : activity.getBridge().getWebView();
            if (webView == null) {
                latch.countDown();
            } else {
                webView.evaluateJavascript(expression, result -> {
                    value.set(result);
                    latch.countDown();
                });
            }
        });
        return latch.await(3, TimeUnit.SECONDS) && "true".equals(value.get());
    }

    private void awaitReady(Instrumentation instrumentation, MainActivity activity) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 45_000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (evaluate(instrumentation, activity, READY)) return;
            SystemClock.sleep(350);
        }
        throw new AssertionError("Full Capacitor shell did not reach React-ready within 45 seconds");
    }

    private void awaitFocus(Instrumentation instrumentation, MainActivity activity, boolean expected) {
        long deadline = SystemClock.elapsedRealtime() + 15_000;
        while (SystemClock.elapsedRealtime() < deadline) {
            AtomicReference<Boolean> focused = new AtomicReference<>();
            instrumentation.runOnMainSync(() -> focused.set(activity.hasWindowFocus()));
            if (focused.get() == expected) return;
            SystemClock.sleep(100);
        }
        throw new AssertionError(expected ? "App did not return to foreground" : "App did not enter background");
    }

    @Test(timeout = 145_000)
    public void coldLaunchAndResumeKeepReactReady() throws Exception {
        assertTrue("Owned emulator required", android.os.Build.FINGERPRINT.startsWith("google/sdk_gphone"));
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        ActivityMonitor monitor = instrumentation.addMonitor(MainActivity.class.getName(), null, false);
        instrumentation.runOnMainSync(() -> context.startActivity(new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)));
        MainActivity activity = (MainActivity) instrumentation.waitForMonitorWithTimeout(monitor, 20_000);
        instrumentation.removeMonitor(monitor);
        assertTrue("MainActivity was not created", activity != null);
        awaitReady(instrumentation, activity);
        awaitFocus(instrumentation, activity, true);

        AtomicReference<Boolean> moved = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> moved.set(activity.moveTaskToBack(true)));
        assertTrue("Activity task was not moved to background", moved.get());
        awaitFocus(instrumentation, activity, false);
        instrumentation.runOnMainSync(() -> context.startActivity(new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)));
        awaitFocus(instrumentation, activity, true);
        awaitReady(instrumentation, activity);
        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
        assertNotNull("Focused guest screen capture failed", screenshot);
        File screenshotFile = new File(context.getExternalFilesDir(null), "full-shell-guest.png");
        try (FileOutputStream output = new FileOutputStream(screenshotFile)) {
            assertTrue("Guest screenshot encoding failed", screenshot.compress(Bitmap.CompressFormat.PNG, 100, output));
        } finally {
            screenshot.recycle();
        }
    }
}
