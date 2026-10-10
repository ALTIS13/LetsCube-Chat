package com.kub.messenger;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.net.Uri;
import android.os.Bundle;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Native own-SDK/Auth/resolver verification only; not FCM delivery or OS display. */
@RunWith(AndroidJUnit4.class)
public class NativeMessagePreviewVerificationTest {
    private static final long TEST_TIMEOUT_MS = 120_000;
    private static final long CLEANUP_TIMEOUT_MS = 20_000;
    private static final long CALLBACK_TIMEOUT_MS = 5_000;
    private static final String UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    interface NativeStateProbe {
        boolean verifiedForRecipient(MainActivity activity, String expectedRecipient);
    }

    static final class LogoutAttempt {
        private boolean confirmationAttempted;
    }

    static NativeStateProbe requireNativeStateProbe() {
        return (activity, expectedRecipient) -> {
            MessagePreviewsPlugin plugin = readMessagePreviewsPlugin(activity);
            return plugin != null && plugin.hasVerifiedBinding(expectedRecipient);
        };
    }

    static MessagePreviewsPlugin readMessagePreviewsPlugin(MainActivity activity) {
        assertTrue("NMPV_NATIVE_PROBE_MAIN_REQUIRED", Looper.myLooper() == Looper.getMainLooper());
        PluginHandle handle = activity.getBridge().getPlugin("MessagePreviews");
        Plugin plugin = handle.getInstance();
        return plugin instanceof MessagePreviewsPlugin ? (MessagePreviewsPlugin) plugin : null;
    }

    private static final String FORM_HELPERS =
        "const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';"
        + "const shells=[...document.querySelectorAll('[data-testid=auth-form-shell]')].filter(visible);"
        + "const forms=shells.length===1?[...shells[0].querySelectorAll('form')].filter(visible):[];"
        + "const form=forms.length===1?forms[0]:null;"
        + "const emails=form?[...form.querySelectorAll('input[type=email]')].filter(visible):[];"
        + "const passwords=form?[...form.querySelectorAll('input[type=password][autocomplete=current-password]')].filter(visible):[];"
        + "const buttons=form?[...form.querySelectorAll('button[type=submit]')].filter(visible):[];"
        + "const email=emails.length===1?emails[0]:null;"
        + "const password=passwords.length===1?passwords[0]:null;"
        + "const submit=buttons.length===1?buttons[0]:null;"
        + "const captcha=!!document.querySelector('[data-testid=auth-captcha],[data-sitekey],iframe[src*=captcha],iframe[src*=turnstile],input[name*=captcha]');";

    private static final String LOGOUT_HELPERS =
        "const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';"
        + "const enabled=e=>visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';";

    private static final String OPEN_ACCOUNT_MENU =
        "(()=>{" + LOGOUT_HELPERS
        + "const buttons=[...document.querySelectorAll('button[aria-label=\"\\u041c\\u0435\\u043d\\u044e\"]')].filter(visible);"
        + "if(buttons.length!==1||!enabled(buttons[0]))return false;buttons[0].click();return true;})()";

    private static final String SELECT_SIGN_OUT =
        "(()=>{" + LOGOUT_HELPERS
        + "const menus=[...document.querySelectorAll('[role=menu][data-kub-menu=true]')].filter(visible);"
        + "if(menus.length!==1)return false;"
        + "const buttons=[...menus[0].querySelectorAll('button')].filter(e=>visible(e)&&e.textContent.trim()==='\\u0412\\u044b\\u0439\\u0442\\u0438');"
        + "if(buttons.length!==1||!enabled(buttons[0]))return false;buttons[0].click();return true;})()";

    private static final String CONFIRM_SIGN_OUT =
        "(()=>{" + LOGOUT_HELPERS
        + "const dialogs=[...document.querySelectorAll('[role=dialog][aria-modal=true]')].filter(visible);"
        + "if(dialogs.length!==1)return false;"
        + "const title=document.getElementById(dialogs[0].getAttribute('aria-labelledby'));"
        + "if(!visible(title)||title.textContent.trim()!=='\\u0412\\u044b\\u0439\\u0442\\u0438 \\u0438\\u0437 \\u0430\\u043a\\u043a\\u0430\\u0443\\u043d\\u0442\\u0430?')return false;"
        + "const buttons=[...dialogs[0].querySelectorAll('button')].filter(e=>visible(e)&&e.textContent.trim()==='\\u0412\\u044b\\u0439\\u0442\\u0438');"
        + "if(buttons.length!==1||!enabled(buttons[0]))return false;buttons[0].click();return true;})()";

    private static final String SIGNED_OUT_VIEW =
        "(()=>{" + LOGOUT_HELPERS
        + "const menus=[...document.querySelectorAll('button[aria-label=\"\\u041c\\u0435\\u043d\\u044e\"]')].filter(visible);"
        + "const dialogs=[...document.querySelectorAll('[role=dialog][aria-modal=true]')].filter(visible);"
        + "if(menus.length||dialogs.length)return false;"
        + "const shells=[...document.querySelectorAll('[data-testid=auth-form-shell]')].filter(visible);"
        + "const forms=shells.length===1?[...shells[0].querySelectorAll('form')].filter(visible):[];"
        + "const login=location.pathname==='/login'&&forms.length===1"
        + "&&[...forms[0].querySelectorAll('input[type=email]')].filter(visible).length===1"
        + "&&[...forms[0].querySelectorAll('input[type=password][autocomplete=current-password]')].filter(visible).length===1"
        + "&&[...forms[0].querySelectorAll('button[type=submit]')].filter(visible).length===1;"
        + "const titles=[...document.querySelectorAll('#public-home-title')].filter(visible);"
        + "const links=[...document.querySelectorAll('a[href=\"/login\"]')].filter(visible);"
        + "const guest=location.pathname==='/'&&titles.length===1&&links.length===1;"
        + "return login||guest;})()";

    private static final String LOGOUT_SURFACE_OPEN =
        "(()=>{" + LOGOUT_HELPERS
        + "return [...document.querySelectorAll('[role=menu][data-kub-menu=true],[role=dialog][aria-modal=true]')]"
        + ".some(visible);})()";

    @Test public void normalQaSessionVerifiesOwnNativeDeviceWithoutPreviewActivation() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        assertTrue("NMPV_QA_USER_REFUSED",
            QaUserIsolation.matches(args.getString("qa_user"), Process.myUid()));
        NativeStateProbe nativeProbe = requireNativeStateProbe();
        String expectedRecipient = args.getString("qa_recipient_id");
        assertTrue("NMPV_QA_RECIPIENT_REFUSED",
            expectedRecipient != null && expectedRecipient.matches(UUID));
        String email = args.getString("qa_email");
        String password = args.getString("qa_password");
        args.remove("qa_email");
        args.remove("qa_password");
        args.remove("qa_recipient_id");
        long deadline = SystemClock.elapsedRealtime() + TEST_TIMEOUT_MS;

        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            LogoutAttempt logoutAttempt = new LogoutAttempt();
            Throwable primaryFailure = null;
            try {
                activity.onActivity(screen -> {
                    assertNotNull("Actual bundled Capacitor bridge must mount", screen.getBridge());
                    for (String name : new String[] { "VoiceCalls", "ChatNotifications", "MediaExport", "MessagePreviews" }) {
                        assertNotNull("Required native plugin must remain available", screen.getBridge().getPlugin(name));
                    }
                });
                requireClosedCapabilities(activity, deadline);
                loginRenderedQaSession(activity, nativeProbe, expectedRecipient, email, password, deadline);
                email = password = null;
                requireClosedCapabilities(activity, deadline);
                assertTrue("Native verification must remain current for the expected QA recipient",
                    readVerified(activity, nativeProbe, expectedRecipient));
                logoutRenderedQaSession(activity, nativeProbe, expectedRecipient, logoutAttempt, deadline);
            } catch (Exception | AssertionError failure) {
                primaryFailure = failure;
                throw failure;
            } finally {
                email = password = null;
                try {
                    cleanupRenderedQaSession(activity, nativeProbe, expectedRecipient, logoutAttempt, freshCleanupDeadline());
                } catch (AssertionError unknown) {
                    if (primaryFailure == null) throw unknown;
                    primaryFailure.addSuppressed(unknown);
                }
            }
        } finally {
            email = password = expectedRecipient = null;
        }
    }

    static boolean loginRenderedQaSession(ActivityScenario<MainActivity> activity, NativeStateProbe nativeProbe,
        String expectedRecipient, String email, String password, long deadline) throws Exception {
        boolean loginOpened = false;
        boolean loginSubmitted = false;
        boolean verified = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            boolean mounted = evaluateBoolean(activity,
                "(()=>!!document.querySelector('#root')?.children.length"
                + "&&window.Capacitor?.getPlatform()==='android')()", deadline);
            if (mounted && readVerified(activity, nativeProbe, expectedRecipient)) {
                verified = true;
                break;
            }
            if (mounted && !loginSubmitted) {
                assertTrue("NMPV_CAPTCHA_UNAVAILABLE", !evaluateBoolean(activity,
                    "(()=>!!document.querySelector('[data-testid=auth-captcha],[data-sitekey],iframe[src*=captcha],"
                    + "iframe[src*=turnstile],input[name*=captcha]'))()", deadline));
            }
            if (mounted && !loginSubmitted && evaluateBoolean(activity,
                "(()=>{" + FORM_HELPERS
                + "return !!form&&!!email&&!!password&&!!submit&&!captcha;})()", deadline)) {
                assertTrue("NMPV_LOGIN_CREDENTIALS_UNAVAILABLE",
                    email != null && !email.isEmpty() && email.length() <= 320 && email.indexOf('\0') < 0
                    && password != null && !password.isEmpty() && password.length() <= 4_096 && password.indexOf('\0') < 0);
                fillRenderedLogin(activity, email, password, deadline);
                boolean submitted = evaluateBoolean(activity,
                    "(()=>{" + FORM_HELPERS
                    + "if(!form||!email||!password||!submit||captcha||email.disabled||email.readOnly"
                    + "||password.disabled||password.readOnly||submit.disabled||submit.getAttribute('aria-disabled')==='true'"
                    + "||!form.checkValidity())return false;submit.click();return true;})()", deadline);
                assertTrue("NMPV_LOGIN_CONTROL_REFUSED", submitted);
                loginSubmitted = true;
                email = password = null;
            } else if (mounted && !loginOpened && !loginSubmitted) {
                loginOpened = evaluateBoolean(activity,
                    "(()=>{const links=[...document.querySelectorAll('a[href=\"/login\"]')]"
                    + ".filter(e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden');"
                    + "if(links.length!==1)return false;links[0].click();return true;})()", deadline);
            }
            SystemClock.sleep(250);
        }
        assertTrue("NMPV_VERIFICATION_NOT_OBSERVED", verified);
        return loginSubmitted;
    }

    private static void requireRenderedLogoutClick(ActivityScenario<MainActivity> activity, NativeStateProbe probe,
        String expectedRecipient, LogoutAttempt attempt, String script, String refusal, long deadline) throws Exception {
        while (SystemClock.elapsedRealtime() < deadline) {
            assertTrue("NMPV_LOGOUT_OWNER_REFUSED", readVerified(activity, probe, expectedRecipient));
            if (CONFIRM_SIGN_OUT.equals(script) ? confirmRenderedSignOut(activity, attempt, deadline)
                : evaluateBoolean(activity, script, deadline)) return;
            SystemClock.sleep(250);
        }
        throw new AssertionError(refusal);
    }

    static void logoutRenderedQaSession(ActivityScenario<MainActivity> activity, NativeStateProbe probe,
        String expectedRecipient, LogoutAttempt attempt, long deadline) throws Exception {
        requireRenderedLogoutClick(activity, probe, expectedRecipient, attempt, OPEN_ACCOUNT_MENU, "NMPV_LOGOUT_MENU_REFUSED", deadline);
        requireRenderedLogoutClick(activity, probe, expectedRecipient, attempt, SELECT_SIGN_OUT, "NMPV_LOGOUT_ROW_REFUSED", deadline);
        requireRenderedLogoutClick(activity, probe, expectedRecipient, attempt, CONFIRM_SIGN_OUT, "NMPV_LOGOUT_CONFIRM_REFUSED", deadline);
        boolean cleanupObserved = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (evaluateBoolean(activity, SIGNED_OUT_VIEW, deadline) && !readVerified(activity, probe, expectedRecipient)) {
                cleanupObserved = true;
                break;
            }
            SystemClock.sleep(250);
        }
        assertTrue("NMPV_LOGOUT_NOT_OBSERVED", cleanupObserved);
    }

    static long freshCleanupDeadline() {
        return SystemClock.elapsedRealtime() + CLEANUP_TIMEOUT_MS;
    }

    static void cleanupRenderedQaSession(ActivityScenario<MainActivity> activity, NativeStateProbe probe,
        String expectedRecipient, LogoutAttempt attempt, long deadline) {
        try {
            if (logoutRenderedQaSessionForCleanup(activity, attempt, deadline)) {
                while (SystemClock.elapsedRealtime() < deadline) {
                    if (!readVerified(activity, probe, expectedRecipient)) return;
                    SystemClock.sleep(250);
                }
            }
        } catch (Exception | AssertionError ignored) { /* Cleanup exposes only a fixed UNKNOWN label. */ }
        throw new AssertionError("NMPV_QA_LOGOUT_CLEANUP_UNKNOWN");
    }

    private static boolean confirmRenderedSignOut(ActivityScenario<MainActivity> activity, LogoutAttempt attempt, long deadline)
        throws Exception {
        if (attempt.confirmationAttempted) return false;
        // A lost/throwing callback cannot prove that the rendered confirmation was not dispatched.
        attempt.confirmationAttempted = true;
        boolean submitted = evaluateBoolean(activity, CONFIRM_SIGN_OUT, deadline);
        if (!submitted) attempt.confirmationAttempted = false;
        return submitted;
    }

    private static boolean logoutRenderedQaSessionForCleanup(ActivityScenario<MainActivity> activity, LogoutAttempt attempt, long deadline)
        throws Exception {
        boolean menuOpened = false, rowSelected = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (evaluateBoolean(activity, SIGNED_OUT_VIEW, deadline)) return true;
            // Resume a partially completed rendered logout, but never replay a submitted confirmation.
            if (!attempt.confirmationAttempted) {
                boolean submitted = confirmRenderedSignOut(activity, attempt, deadline);
                if (!submitted && !rowSelected && evaluateBoolean(activity, SELECT_SIGN_OUT, deadline)) rowSelected = true;
                else if (!submitted && !menuOpened && !rowSelected && !evaluateBoolean(activity, LOGOUT_SURFACE_OPEN, deadline)) {
                    menuOpened = evaluateBoolean(activity, OPEN_ACCOUNT_MENU, deadline);
                }
            }
            SystemClock.sleep(250);
        }
        return false;
    }

    private static void fillRenderedLogin(ActivityScenario<MainActivity> activity, String email, String password,
        long deadline) throws Exception {
        boolean filled = evaluateBoolean(activity,
            "(()=>{" + FORM_HELPERS
            + "if(!form||!email||!password||!submit||captcha||email.disabled||email.readOnly"
            + "||password.disabled||password.readOnly||submit.disabled)return false;"
            + "const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;"
            + "if(!setter)return false;"
            + "email.focus();setter.call(email," + JSONObject.quote(email) + ");email.dispatchEvent(new Event('input',{bubbles:true}));"
            + "password.focus();setter.call(password," + JSONObject.quote(password) + ");password.dispatchEvent(new Event('input',{bubbles:true}));"
            + "return email.value.length>0&&password.value.length>0;})()", deadline);
        assertTrue("NMPV_LOGIN_CONTROL_REFUSED", filled);
    }

    static boolean readVerified(ActivityScenario<MainActivity> activity, NativeStateProbe probe,
        String expectedRecipient) {
        AtomicBoolean verified = new AtomicBoolean(false);
        AtomicBoolean readable = new AtomicBoolean(false);
        activity.onActivity(screen -> {
            try {
                verified.set(probe.verifiedForRecipient(screen, expectedRecipient));
                readable.set(true);
            } catch (RuntimeException ignored) { /* No native identity or error body in instrumentation output. */ }
        });
        assertTrue("Native verification probe must return a read-only boolean", readable.get());
        return verified.get();
    }

    static boolean evaluateBoolean(ActivityScenario<MainActivity> activity, String script, long deadline)
        throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        AtomicBoolean dispatched = new AtomicBoolean(false);
        activity.onActivity(screen -> {
            try {
                Uri url = Uri.parse(screen.getBridge().getWebView().getUrl());
                if (!"https".equals(url.getScheme()) || !"localhost".equals(url.getHost())
                    || url.getPort() != -1 || url.getUserInfo() != null) { done.countDown(); return; }
                screen.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); });
                dispatched.set(true);
            } catch (RuntimeException ignored) { done.countDown(); }
        });
        assertTrue("Only actual local bundled WebView may be inspected", dispatched.get());
        assertTrue("Bounded boolean-only WebView callback must finish", done.await(remaining(deadline), TimeUnit.MILLISECONDS));
        String value = result.get();
        assertTrue("WebView probe may return only a boolean, never DOM/auth content", "true".equals(value) || "false".equals(value));
        return "true".equals(value);
    }

    static void requireClosedCapabilities(ActivityScenario<MainActivity> activity, long deadline)
        throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean closed = new AtomicBoolean(false);
        activity.onActivity(screen -> {
            try {
                Plugin plugin = screen.getBridge().getPlugin("MessagePreviews").getInstance();
                PluginCall call = new PluginCall(null, "MessagePreviews", PluginCall.CALLBACK_ID_DANGLING,
                    "getCapabilities", new JSObject()) {
                    @Override public void resolve(JSObject result) {
                        try {
                            Object protocol = result.get("protocol");
                            closed.set(result.length() == 1 && protocol instanceof Integer && ((Integer) protocol) == 0);
                        } catch (Exception ignored) { closed.set(false); }
                        done.countDown();
                    }
                    @Override public void resolve() { done.countDown(); }
                    @Override public void reject(String message, String code, Exception error, JSObject data) {
                        done.countDown();
                    }
                };
                // This public method/signature is in the frozen bridge contract, not a guessed runtime getter.
                plugin.getClass().getMethod("getCapabilities", PluginCall.class).invoke(plugin, call);
            } catch (Exception ignored) { done.countDown(); }
        });
        assertTrue("Bounded real native capability reply must finish", done.await(remaining(deadline), TimeUnit.MILLISECONDS));
        assertTrue("Native preview capability must remain exactly protocol0 before and after verification", closed.get());
    }

    private static long remaining(long deadline) {
        long remaining = deadline - SystemClock.elapsedRealtime();
        assertTrue("NMPV_DEADLINE_EXHAUSTED", remaining > 0);
        return Math.min(CALLBACK_TIMEOUT_MS, remaining);
    }
}
