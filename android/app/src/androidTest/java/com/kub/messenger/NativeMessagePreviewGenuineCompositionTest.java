package com.kub.messenger;

import static com.kub.messenger.NativeMessagePreviewVerificationTest.evaluateBoolean;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.cleanupRenderedQaSession;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.freshCleanupDeadline;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.loginRenderedQaSession;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.logoutRenderedQaSession;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.readMessagePreviewsPlugin;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.readVerified;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.requireClosedCapabilities;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.requireNativeStateProbe;
import static org.junit.Assert.assertTrue;

import android.os.Bundle;
import android.os.Process;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.CapConfig;
import com.getcapacitor.PluginHandle;
import com.kub.messenger.NativeMessagePreviewVerificationTest.LogoutAttempt;
import com.kub.messenger.NativeMessagePreviewVerificationTest.NativeStateProbe;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Isolated QA composition only; authored source is not physical acceptance or preview consent. */
@RunWith(AndroidJUnit4.class)
public class NativeMessagePreviewGenuineCompositionTest {
    private static final long TEST_TIMEOUT_MS = 120_000;

    @Test public void normalQaSessionCommitsAndLogoutRetiresGenuineComposition() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String expectedRecipient = args.getString("qa_recipient_id");
        String email = args.getString("qa_email");
        String password = args.getString("qa_password");
        args.remove("qa_email");
        args.remove("qa_password");
        args.remove("qa_recipient_id");

        try {
            assertTrue("NMPV_QA_USER_REFUSED",
                QaUserIsolation.matches(args.getString("qa_user"), Process.myUid()));
            assertTrue("NMPV_QA_RECIPIENT_REFUSED", expectedRecipient != null && expectedRecipient.matches(
                "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"));
            NativeStateProbe nativeProbe = requireNativeStateProbe();
            NativeStateProbe compositionProbe = (screen, recipient) -> {
                MessagePreviewsPlugin plugin = readMessagePreviewsPlugin(screen);
                return plugin != null && plugin.hasVerifiedBinding(recipient)
                    && plugin.hasQaCompositionPhase("INITIALIZED")
                    && plugin.hasQaCompositionPhase("PENDING")
                    && plugin.hasQaCompositionPhase("COMMITTED")
                    && !plugin.hasQaCompositionPhase("RETIRED");
            };
            NativeStateProbe retirementProbe = (screen, recipient) -> {
                MessagePreviewsPlugin plugin = readMessagePreviewsPlugin(screen);
                return plugin != null && plugin.hasQaCompositionPhase("RETIRED")
                    && !plugin.hasVerifiedBinding(recipient);
            };
            long deadline = SystemClock.elapsedRealtime() + TEST_TIMEOUT_MS;

            try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
                LogoutAttempt logoutAttempt = new LogoutAttempt();
                Throwable primaryFailure = null;
                boolean compositionRequested = false;
                try {
                    requireQaBridge(activity);
                    requireClosedCapabilities(activity, deadline);
                    assertTrue("NMPV_QA_LOCAL_ORIGIN_REFUSED", evaluateBoolean(activity,
                        "(()=>location.origin==='https://localhost')()", deadline));
                    requireQaCompositionRequest(activity, expectedRecipient);
                    compositionRequested = true;
                    requireClosedCapabilities(activity, deadline);

                    // The shared rendered-login loop awaits both checked COMMITTED and the actual binding.
                    assertTrue("NMPV_QA_RENDERED_LOGIN_NOT_SUBMITTED",
                        loginRenderedQaSession(activity, compositionProbe, expectedRecipient, email, password, deadline));
                    email = password = null;
                    requireClosedCapabilities(activity, deadline);
                    assertTrue("NMPV_QA_COMPOSITION_COMMIT_NOT_OBSERVED",
                        readVerified(activity, compositionProbe, expectedRecipient));

                    logoutRenderedQaSession(activity, nativeProbe, expectedRecipient, logoutAttempt, deadline);
                    boolean retired = false;
                    while (SystemClock.elapsedRealtime() < deadline) {
                        if (readVerified(activity, retirementProbe, expectedRecipient)) {
                            retired = true;
                            break;
                        }
                        SystemClock.sleep(250);
                    }
                    assertTrue("NMPV_QA_COMPOSITION_RETIREMENT_NOT_OBSERVED", retired);
                    requireClosedCapabilities(activity, deadline);
                    assertTrue("NMPV_QA_BINDING_RETAINED_AFTER_LOGOUT",
                        !readVerified(activity, nativeProbe, expectedRecipient));
                } catch (Exception | AssertionError failure) {
                    primaryFailure = failure;
                    throw failure;
                } finally {
                    email = password = null;
                    try {
                        cleanupGenuineComposition(activity, nativeProbe, retirementProbe, expectedRecipient,
                            compositionRequested, logoutAttempt, freshCleanupDeadline());
                    } catch (AssertionError unknown) {
                        if (primaryFailure == null) throw unknown;
                        primaryFailure.addSuppressed(unknown);
                    }
                }
            }
        } finally {
            email = password = expectedRecipient = null;
        }
    }

    private static void cleanupGenuineComposition(ActivityScenario<MainActivity> activity, NativeStateProbe nativeProbe,
        NativeStateProbe retirementProbe, String expectedRecipient, boolean requested, LogoutAttempt attempt, long deadline) {
        cleanupRenderedQaSession(activity, nativeProbe, expectedRecipient, attempt, deadline);
        if (!requested) return;
        try {
            while (SystemClock.elapsedRealtime() < deadline) {
                if (readVerified(activity, retirementProbe, expectedRecipient)) return;
                SystemClock.sleep(250);
            }
        } catch (RuntimeException | AssertionError ignored) { /* Runtime retirement alone is not exact vault erasure. */ }
        throw new AssertionError("NMPV_QA_RETIREMENT_CLEANUP_UNKNOWN");
    }

    @SuppressWarnings("deprecation")
    private static void requireQaBridge(ActivityScenario<MainActivity> activity) {
        AtomicBoolean ready = new AtomicBoolean(false);
        activity.onActivity(screen -> {
            try {
                if (screen.getBridge() == null || screen.getBridge().getConfig() == null) return;
                for (String name : new String[] { "VoiceCalls", "ChatNotifications", "MediaExport", "MessagePreviews" }) {
                    PluginHandle handle = screen.getBridge().getPlugin(name);
                    if (handle == null || handle.getInstance() == null) return;
                }
                CapConfig config = screen.getBridge().getConfig();
                ready.set("none".equals(config.getString("android.loggingBehavior",
                    config.getString("loggingBehavior", null))) && !config.isLoggingEnabled());
            } catch (RuntimeException ignored) { /* No configuration or native error content leaves the app. */ }
        });
        assertTrue("NMPV_QA_REAL_PLUGINS_LOGGING_NONE_REQUIRED", ready.get());
    }

    private static void requireQaCompositionRequest(ActivityScenario<MainActivity> activity, String expectedRecipient) {
        AtomicBoolean requested = new AtomicBoolean(false);
        activity.onActivity(screen -> {
            try {
                MessagePreviewsPlugin plugin = readMessagePreviewsPlugin(screen);
                requested.set(plugin != null && !plugin.hasVerifiedBinding(expectedRecipient)
                    && !plugin.hasQaCompositionPhase("INITIALIZED")
                    && !plugin.hasQaCompositionPhase("PENDING")
                    && !plugin.hasQaCompositionPhase("COMMITTED")
                    && !plugin.hasQaCompositionPhase("RETIRED")
                    && plugin.requestQaComposition(expectedRecipient));
            } catch (RuntimeException ignored) { /* A refused QA request exposes only a fixed failure label. */ }
        });
        assertTrue("NMPV_QA_COMPOSITION_REQUEST_REFUSED", requested.get());
    }
}
