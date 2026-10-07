package com.kub.messenger;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.Process;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Reads booleans/geometry only; requires the explicitly created anonymous QA profile. */
@RunWith(AndroidJUnit4.class)
public class BundledWebSmokeTest {
    @Test public void anonymousBundledWebMountsWithNativeCleanupBridge() throws Exception {
        assertTrue("Explicit non-primary QA profile must match this process", QaUserIsolation.matches(
            InstrumentationRegistry.getArguments().getString("qa_user"), Process.myUid()));
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            activity.onActivity(screen -> {
                assertNotNull("Capacitor bridge must mount", screen.getBridge());
                assertNotNull("Release must register the cleanup plugin", screen.getBridge().getPlugin("ChatNotifications"));
                assertNotNull("Release must preserve media export", screen.getBridge().getPlugin("MediaExport"));
                assertNotNull("Release must preserve voice bridge", screen.getBridge().getPlugin("VoiceCalls"));
            });
            JSONObject probe = null;
            for (int attempt = 0; attempt < 100; attempt++) {
                CountDownLatch evaluated = new CountDownLatch(1);
                AtomicReference<String> value = new AtomicReference<>();
                activity.onActivity(screen -> screen.getBridge().getWebView().evaluateJavascript(
                    "JSON.stringify({mounted:!!document.querySelector('#root')?.children.length,"
                    + "guest:!!document.querySelector('input[type=email],a[href=\"/login\"]'),"
                    + "native:window.Capacitor?.getPlatform()==='android',"
                    + "cleanup:window.Capacitor?.isPluginAvailable('ChatNotifications')===true,"
                    + "overflow:document.documentElement.scrollWidth>innerWidth+1,"
                    + "width:innerWidth,height:innerHeight})",
                    result -> { value.set(result); evaluated.countDown(); }));
                assertTrue("WebView evaluation must return", evaluated.await(5, TimeUnit.SECONDS));
                Object decoded = new JSONTokener(value.get()).nextValue();
                if (decoded instanceof String) probe = new JSONObject((String) decoded);
                if (probe != null && probe.optBoolean("mounted") && probe.optBoolean("guest")) break;
                SystemClock.sleep(250);
            }
            assertNotNull("Anonymous probe must finish", probe);
            assertTrue("Bundled React must mount", probe.getBoolean("mounted"));
            assertTrue("Only an anonymous home/login surface may be tested", probe.getBoolean("guest"));
            assertTrue("Bundled client must detect native Android", probe.getBoolean("native"));
            assertTrue("Web bridge must expose current cleanup capability", probe.getBoolean("cleanup"));
            assertTrue("Guest layout must not overflow horizontally", !probe.getBoolean("overflow"));
            assertTrue("WebView viewport must be nonblank", probe.getInt("width") > 100 && probe.getInt("height") > 100);
        }
    }
}
