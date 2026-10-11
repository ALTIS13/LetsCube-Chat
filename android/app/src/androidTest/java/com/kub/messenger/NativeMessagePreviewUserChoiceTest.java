package com.kub.messenger;

import static com.kub.messenger.NativeMessagePreviewVerificationTest.cleanupRenderedQaSession;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.evaluateBoolean;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.freshCleanupDeadline;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.loginRenderedQaSession;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.readMessagePreviewsPlugin;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.requireClosedCapabilities;
import static com.kub.messenger.NativeMessagePreviewVerificationTest.requireNativeStateProbe;
import static org.junit.Assert.assertTrue;

import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.os.SystemClock;
import android.view.Display;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.CapConfig;
import com.getcapacitor.PluginHandle;
import com.kub.messenger.NativeMessagePreviewVerificationTest.LogoutAttempt;
import com.kub.messenger.NativeMessagePreviewVerificationTest.NativeStateProbe;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Future actual-APK automated input only: PERSON_CHOICE_NOT_PROVEN.
 * Checked/enabled radios are the real hook's consumer readback, not an independent
 * server observer. The hook validates own-row ACK and fresh capability before ready.
 * Host owns artifact/incarnation binding and package cleanup; no captures or values.
 */
@RunWith(AndroidJUnit4.class)
public class NativeMessagePreviewUserChoiceTest {
    private static final long CHOICE_WINDOW_MS = 120_000;
    private static final long CALLBACK_MS = 2_000;

    static final String DOM_HELPERS =
        "const list=(root,s)=>[...root.querySelectorAll(s)];"
        + "const visible=e=>{if(!e||!e.isConnected||!e.getClientRects().length)return false;"
        + "for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);"
        + "if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<0.99"
        + "||s.pointerEvents==='none'||p.getAttribute('aria-hidden')==='true'||p.getAttribute('inert')!==null)return false;}return true;};"
        + "const enabled=e=>visible(e)&&!e.disabled&&!e.matches(':disabled')&&e.getAttribute('aria-disabled')!=='true';"
        + "const unique=nodes=>nodes.length===1?nodes[0]:null;"
        + "const row=unique(list(document,'[data-testid=native-message-preview-setting]'));"
        + "const viewport=()=>{const v=visualViewport;return !!v&&v.scale===1&&v.offsetLeft===0&&v.offsetTop===0"
        + "&&Number.isFinite(innerWidth)&&Number.isFinite(innerHeight)&&innerWidth>=40&&innerHeight>=40"
        + "&&innerWidth<=16384&&innerHeight<=16384&&Math.abs(v.width-innerWidth)<=1&&Math.abs(v.height-innerHeight)<=1;};"
        + "const select=()=>{if(mode==='menu')return unique(list(document,'button[aria-label=\"\\u041c\\u0435\\u043d\\u044e\"]').filter(visible));"
        + "if(mode==='settings'){const m=unique(list(document,'[role=menu][data-kub-menu=true]').filter(visible));"
        + "return m?unique(list(m,'button').filter(e=>visible(e)&&e.textContent.trim()==='\\u041d\\u0430\\u0441\\u0442\\u0440\\u043e\\u0439\\u043a\\u0438')):null;}"
        + "if(mode==='scroll')return unique(list(document,'[data-testid=settings-scroll]').filter(visible));"
        + "if(mode==='close'){const d=unique(list(document,'[role=dialog][aria-modal=true]').filter(e=>visible(e)&&e.querySelector('[data-testid=settings-scroll]')));"
        + "return d?unique(list(d,'button[aria-label=\"\\u0417\\u0430\\u043a\\u0440\\u044b\\u0442\\u044c\"]').filter(visible)):null;}"
        + "if(!row||!visible(row))return null;"
        + "if(mode==='disclosure')return unique(list(row,'[data-testid=settings-open-message-preview]'));"
        + "if(mode==='radio'&&['none','sender','message'].includes(choice))return unique(list(row,'input[type=radio]').filter(e=>e.value===choice));return null;};";

    static final String TARGET_PROBE =
        "if(!viewport())return null;const e=select();if(!enabled(e))return null;"
        + "const r=e.getBoundingClientRect();const a=[r.left,r.top,r.right,r.bottom];"
        + "if(!a.every(Number.isFinite)||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight"
        + "||r.right-r.left<4||r.bottom-r.top<4)return null;"
        + "const x=mode==='scroll'?r.right-Math.min(16,(r.right-r.left)/4):(r.left+r.right)/2;const y=(r.top+r.bottom)/2;"
        + "const hit=(x,y)=>{const h=document.elementFromPoint(x,y);return !!h&&(h===e||e.contains(h));};"
        + "const points=mode==='scroll'?Array.from({length:7},(_,i)=>[x,r.top+(r.bottom-r.top)*(0.75-0.5*i/6)])"
        + ":[[x,y],[r.left+1,r.top+1],[r.right-1,r.top+1],[r.left+1,r.bottom-1],[r.right-1,r.bottom-1]];"
        + "if(!points.every(p=>hit(p[0],p[1])))return null;return [x,y,...a,innerWidth,innerHeight];";

    static final String SAVED_PROBE =
        "if(!row||!visible(row)||!['none','sender','message'].includes(choice))return false;"
        + "const r=list(row,'input[type=radio]');return r.length===3&&r.every(enabled)"
        + "&&['none','sender','message'].every(v=>r.filter(e=>e.value===v).length===1)"
        + "&&r.filter(e=>e.checked).length===1&&r.some(e=>e.value===choice&&e.checked);";

    static final String SCROLL_UP_PROBE =
        "const e=select(),s=unique(list(document,'[data-testid=settings-scroll]').filter(visible));"
        + "return enabled(e)&&!!s&&e.getBoundingClientRect().top<s.getBoundingClientRect().top+8;";

    static final class InputGeometry {
        static long deadline(long armedAt) {
            return armedAt < 0 || armedAt > Long.MAX_VALUE - CHOICE_WINDOW_MS ? -1 : armedAt + CHOICE_WINDOW_MS;
        }

        static double[] map(double[] css, double scale, int width, int height, int left, int top) {
            if (css == null || css.length != 8 || !Double.isFinite(scale) || scale < 0.25 || scale > 8
                || width <= 0 || height <= 0 || width > 16_384 || height > 16_384
                || left < 0 || top < 0 || left + (long) width > 16_384 || top + (long) height > 16_384) return null;
            for (double value : css) if (!Double.isFinite(value) || value < 0 || value > 16_384) return null;
            if (css[6] < 40 || css[7] < 40 || Math.abs(css[6] * scale - width) > 2
                || Math.abs(css[7] * scale - height) > 2 || css[4] - css[2] < 4 || css[5] - css[3] < 4
                || css[4] > css[6] || css[5] > css[7] || css[0] <= css[2] || css[0] >= css[4]
                || css[1] <= css[3] || css[1] >= css[5]) return null;
            return new double[] { left + css[0] * scale, top + css[1] * scale };
        }
    }

    private static final class Target {
        final WebView webView;
        final double[] css, point;
        final double scale;
        final int width, height, left, top;
        final long measured;
        Target(WebView webView, double[] css, double scale, int width, int height, int left, int top) {
            this.webView = webView; this.css = css; this.scale = scale;
            this.width = width; this.height = height; this.left = left; this.top = top;
            this.point = InputGeometry.map(css, scale, width, height, left, top);
            this.measured = SystemClock.elapsedRealtime();
        }
    }

    @Test public void automatedSettingsChoiceAndRetirementPersonChoiceNotProven() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String recipient = args.getString("qa_recipient_id");
        String email = args.getString("qa_email"), password = args.getString("qa_password");
        args.remove("qa_email"); args.remove("qa_password"); args.remove("qa_recipient_id");
        String phase = "ISOLATION";
        AssertionError retained = null;
        try {
            assertTrue("NMPUC_ISOLATION_REFUSED", QaUserIsolation.matches(args.getString("qa_user"), Process.myUid()));
            assertTrue("NMPUC_RECIPIENT_REFUSED", recipient != null && recipient.matches(
                "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"));
            phase = "ACTIVITY";
            try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
                NativeStateProbe binding = requireNativeStateProbe();
                LogoutAttempt logout = new LogoutAttempt();
                AtomicReference<MessagePreviewsPlugin> owner = new AtomicReference<>();
                AssertionError failure = null;
                boolean finalNone = false;
                try {
                    phase = "BRIDGE";
                    waitForLocalDocument(activity, SystemClock.elapsedRealtime() + 20_000);
                    requireQaBridge(activity, owner);
                    requireClosedCapabilities(activity, SystemClock.elapsedRealtime() + CALLBACK_MS);
                    phase = "ARM";
                    long deadline = requestOnce(activity, owner.get(), recipient);
                    phase = "LOGIN";
                    assertTrue("NMPUC_LOGIN_NOT_SUBMITTED", loginRenderedQaSession(activity, binding, recipient, email, password, deadline));
                    email = password = null;
                    phase = "SETTINGS";
                    tapOnce(activity, "menu", "none", deadline);
                    tapOnce(activity, "settings", "none", deadline);
                    reveal(activity, "disclosure", "none", deadline);
                    if (!evaluateBoolean(activity, script("disclosure", "none",
                        "const e=select();return !!e&&e.getAttribute('aria-expanded')==='true';"), deadline)) {
                        tapOnce(activity, "disclosure", "none", deadline);
                    }
                    phase = "INITIAL_NONE";
                    waitForChoice(activity, owner.get(), "none", false, deadline);
                    for (String choice : new String[] { "sender", "message", "none" }) {
                        phase = "SAVE_" + choice.toUpperCase(java.util.Locale.ROOT);
                        reveal(activity, "radio", choice, deadline);
                        tapOnce(activity, "radio", choice, deadline);
                        waitForChoice(activity, owner.get(), choice, true, deadline);
                    }
                    finalNone = true;
                } catch (Exception | AssertionError ignored) {
                    failure = ArmDiagnostics.phaseFailure(phase, ignored);
                } finally {
                    email = password = null;
                    // None failure never triggers a compensating/replayed write. Cleanup has its own
                    // bound, not a renewed consent window, and does not depend on finalNone/login.
                    if (!finalNone) failure = append(failure, "NMPUC_FINAL_NONE_UNCONFIRMED_FAILED");
                    failure = cleanup(activity, owner.get(), binding, recipient, logout, failure);
                }
                if (failure != null) { retained = failure; throw failure; }
            }
        } catch (Exception | AssertionError ignored) {
            if (retained == null) throw ArmDiagnostics.phaseFailure(phase, ignored);
            // try-with-resources may append a framework close exception: never report it.
            throw ArmDiagnostics.report(phase, retained);
        } finally {
            email = password = recipient = null;
        }
    }

    private static AssertionError append(AssertionError prior, String fixedCode) {
        AssertionError next = new AssertionError(fixedCode);
        if (prior == null) return next;
        prior.addSuppressed(next); return prior;
    }

    static final class ArmDiagnostics {
        private final AtomicReference<String> first = new AtomicReference<>();
        void fail(String code) { first.compareAndSet(null, allowed(code) ? code : "NMPUC_ARM_FAILED"); }
        boolean failed() { return first.get() != null; }
        AssertionError failure() { return new AssertionError(first.get()); }
        static boolean allowed(String code) {
            return code != null && code.matches("NMPUC_ARM_(STATE_(INITIALIZED|CREATED|STARTED|DESTROYED|UNKNOWN|RUNTIME_EXCEPTION)"
                + "|CALLBACK_(NOT_RUN|RUNTIME_EXCEPTION)|LOCAL_WEBVIEW|PLUGIN_INCARNATION|NOT_MAIN|NATIVE_LOCAL"
                + "|OWN_ACTIVITY|ALREADY_VERIFIED|NATIVE_FALSE|RUNTIME_EXCEPTION)_FAILED");
        }
        static String stateFailure(Lifecycle.State state) {
            if (state == null) return "NMPUC_ARM_STATE_UNKNOWN_FAILED";
            switch (state) {
                case INITIALIZED: return "NMPUC_ARM_STATE_INITIALIZED_FAILED";
                case CREATED: return "NMPUC_ARM_STATE_CREATED_FAILED";
                case STARTED: return "NMPUC_ARM_STATE_STARTED_FAILED";
                case DESTROYED: return "NMPUC_ARM_STATE_DESTROYED_FAILED";
                default: return "NMPUC_ARM_STATE_UNKNOWN_FAILED";
            }
        }
        private static String fallback(String phase) {
            return phase != null && phase.matches("ISOLATION|ACTIVITY|BRIDGE|ARM|LOGIN|SETTINGS|INITIAL_NONE|SAVE_(SENDER|MESSAGE|NONE)")
                ? "NMPUC_" + phase + "_FAILED" : "NMPUC_FAILED";
        }
        static AssertionError phaseFailure(String phase, Throwable failure) {
            String code = failure instanceof AssertionError ? failure.getMessage() : null;
            return new AssertionError("ARM".equals(phase) && allowed(code) ? code : fallback(phase));
        }
        private static boolean cleanupCode(String code) {
            return code != null && code.matches("NMPUC_(FINAL_NONE_UNCONFIRMED_FAILED|NATIVE_RETIREMENT_UNKNOWN|CLEANUP_RESUME_UNKNOWN"
                + "|SETTINGS_CLOSE_UNKNOWN|RENDERED_LOGOUT_UNKNOWN|FINAL_NATIVE_CLOSURE_UNKNOWN)");
        }
        static AssertionError report(String phase, AssertionError failure) {
            String code = failure.getMessage();
            AssertionError report = new AssertionError(("ARM".equals(phase) && allowed(code)) || cleanupCode(code)
                || fallback(phase).equals(code) ? code : fallback(phase));
            for (Throwable suppressed : failure.getSuppressed()) {
                if (suppressed instanceof AssertionError && cleanupCode(suppressed.getMessage())) append(report, suppressed.getMessage());
            }
            return report;
        }
    }

    private static AssertionError cleanup(ActivityScenario<MainActivity> activity, MessagePreviewsPlugin owner,
        NativeStateProbe binding, String recipient, LogoutAttempt logout, AssertionError failure) {
        try {
            activity.moveToState(Lifecycle.State.STARTED);
            assertTrue("NMPUC_RETIREMENT_UNKNOWN", nativeChoice(activity, owner, "RETIRED", false));
        } catch (Exception | AssertionError ignored) { failure = append(failure, "NMPUC_NATIVE_RETIREMENT_UNKNOWN"); }
        try { activity.moveToState(Lifecycle.State.RESUMED); }
        catch (Exception | AssertionError ignored) { failure = append(failure, "NMPUC_CLEANUP_RESUME_UNKNOWN"); }
        long deadline = freshCleanupDeadline();
        try {
            if (evaluateBoolean(activity, "(()=>!!document.querySelector('[data-testid=settings-scroll]'))()", deadline)) {
                tapOnce(activity, "close", "none", deadline);
            }
        } catch (Exception | AssertionError ignored) { failure = append(failure, "NMPUC_SETTINGS_CLOSE_UNKNOWN"); }
        // Closing Settings must not consume the independent ordinary logout budget.
        try { cleanupRenderedQaSession(activity, binding, recipient, logout, freshCleanupDeadline()); }
        catch (Exception | AssertionError ignored) { failure = append(failure, "NMPUC_RENDERED_LOGOUT_UNKNOWN"); }
        try {
            requireClosedCapabilities(activity, freshCleanupDeadline());
            assertTrue("NMPUC_RETIREMENT_UNKNOWN", nativeChoice(activity, owner, "RETIRED", false));
        } catch (Exception | AssertionError ignored) { failure = append(failure, "NMPUC_FINAL_NATIVE_CLOSURE_UNKNOWN"); }
        return failure;
    }

    private static void waitForLocalDocument(ActivityScenario<MainActivity> activity, long deadline) throws Exception {
        while (SystemClock.elapsedRealtime() < deadline) {
            if (evaluateBoolean(activity, "(()=>location.origin==='https://localhost'&&document.readyState==='complete'"
                + "&&!!document.querySelector('#root')?.children.length&&window.Capacitor?.getPlatform()==='android')()", deadline)) return;
            SystemClock.sleep(100);
        }
        throw new AssertionError("NMPUC_LOCAL_DOCUMENT_UNAVAILABLE");
    }

    @SuppressWarnings("deprecation")
    private static void requireQaBridge(ActivityScenario<MainActivity> activity, AtomicReference<MessagePreviewsPlugin> owner) {
        activity.onActivity(screen -> {
            try {
                if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE || BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION
                    || localWebView(screen) == null) return;
                for (String name : new String[] { "VoiceCalls", "ChatNotifications", "MediaExport", "MessagePreviews" }) {
                    PluginHandle handle = screen.getBridge().getPlugin(name);
                    if (handle == null || handle.getInstance() == null) return;
                }
                CapConfig config = screen.getBridge().getConfig();
                if (config != null && !config.isLoggingEnabled() && "none".equals(config.getString("android.loggingBehavior",
                    config.getString("loggingBehavior", null)))) owner.set(readMessagePreviewsPlugin(screen));
            } catch (RuntimeException ignored) { /* Only a fixed refusal leaves the process. */ }
        });
        assertTrue("NMPUC_QA_BRIDGE_REFUSED", owner.get() != null);
    }

    private static long requestOnce(ActivityScenario<MainActivity> activity, MessagePreviewsPlugin owner, String recipient) {
        AtomicBoolean accepted = new AtomicBoolean(false);
        AtomicBoolean callback = new AtomicBoolean(false);
        ArmDiagnostics diagnostic = new ArmDiagnostics();
        long[] armedAt = { 0 };
        String exceptionCode = "NMPUC_ARM_STATE_RUNTIME_EXCEPTION_FAILED";
        try {
            Lifecycle.State state = activity.getState();
            if (state != Lifecycle.State.RESUMED) {
                diagnostic.fail(ArmDiagnostics.stateFailure(state)); throw diagnostic.failure();
            }
            exceptionCode = "NMPUC_ARM_CALLBACK_RUNTIME_EXCEPTION_FAILED";
            activity.onActivity(screen -> {
                callback.set(true);
                try {
                    if (!MessagePreviewQaUserChoice.onMain()) { diagnostic.fail("NMPUC_ARM_NOT_MAIN_FAILED"); return; }
                    if (localWebView(screen) == null) { diagnostic.fail("NMPUC_ARM_LOCAL_WEBVIEW_FAILED"); return; }
                    if (owner == null || readMessagePreviewsPlugin(screen) != owner) { diagnostic.fail("NMPUC_ARM_PLUGIN_INCARNATION_FAILED"); return; }
                    if (!MessagePreviewQaUserChoice.local(screen.getBridge())) { diagnostic.fail("NMPUC_ARM_NATIVE_LOCAL_FAILED"); return; }
                    if (!MessagePreviewQaUserChoice.ownActivity(screen.getApplication(), screen.getBridge())) { diagnostic.fail("NMPUC_ARM_OWN_ACTIVITY_FAILED"); return; }
                    if (owner.hasVerifiedBinding(recipient)) { diagnostic.fail("NMPUC_ARM_ALREADY_VERIFIED_FAILED"); return; }
                    armedAt[0] = SystemClock.elapsedRealtime();
                    accepted.set(owner.requestQaUserChoice(recipient));
                    if (!accepted.get()) diagnostic.fail("NMPUC_ARM_NATIVE_FALSE_FAILED");
                } catch (RuntimeException ignored) { diagnostic.fail("NMPUC_ARM_RUNTIME_EXCEPTION_FAILED"); }
            });
        } catch (RuntimeException ignored) { diagnostic.fail(exceptionCode); }
        // First refusal survives framework failures; none permits a second private request.
        if (!callback.get()) diagnostic.fail("NMPUC_ARM_CALLBACK_NOT_RUN_FAILED");
        if (!accepted.get()) diagnostic.fail("NMPUC_ARM_NATIVE_FALSE_FAILED");
        if (diagnostic.failed()) throw diagnostic.failure();
        return InputGeometry.deadline(armedAt[0]);
    }

    private static boolean nativeChoice(ActivityScenario<MainActivity> activity, MessagePreviewsPlugin owner, String choice,
        boolean initial) {
        AtomicBoolean result = new AtomicBoolean(false);
        activity.onActivity(screen -> {
            try {
                if (owner == null || readMessagePreviewsPlugin(screen) != owner) return;
                // Exact inspected observer name. Initial load has no confirmed native intent yet.
                if ("RETIRED".equals(choice)) { result.set(owner.hasQaUserChoice("RETIRED")); return; }
                boolean matching = initial || owner.hasQaUserChoice(choice);
                for (String other : new String[] { "none", "sender", "message" }) {
                    if ((initial || !other.equals(choice)) && owner.hasQaUserChoice(other)) matching = false;
                }
                result.set(matching && !owner.hasQaUserChoice("RETIRED"));
            } catch (RuntimeException ignored) { /* Native diagnostic memory is not server proof. */ }
        });
        return result.get();
    }

    private static void waitForChoice(ActivityScenario<MainActivity> activity, MessagePreviewsPlugin owner, String choice,
        boolean confirmed, long deadline) throws Exception {
        while (SystemClock.elapsedRealtime() < deadline) {
            requireClosedCapabilities(activity, deadline);
            if (evaluateBoolean(activity, script("radio", choice, SAVED_PROBE), deadline)
                && nativeChoice(activity, owner, choice, !confirmed)) { remaining(deadline); return; }
            if (!confirmed && (evaluateBoolean(activity, script("radio", "sender", SAVED_PROBE), deadline)
                || evaluateBoolean(activity, script("radio", "message", SAVED_PROBE), deadline))) {
                throw new AssertionError("NMPUC_INITIAL_OWNER_CHOICE_MISMATCH");
            }
            SystemClock.sleep(100);
        }
        throw new AssertionError("NMPUC_CHECKED_HOOK_AND_NATIVE_UNCONFIRMED");
    }

    private static String script(String mode, String choice, String body) {
        return "(()=>{const mode=" + JSONObject.quote(mode) + ",choice=" + JSONObject.quote(choice) + ";" + DOM_HELPERS + body + "})()";
    }

    private static WebView localWebView(MainActivity screen) {
        try {
            WebView view = screen.getBridge().getWebView();
            Uri url = Uri.parse(view.getUrl());
            return "https".equals(url.getScheme()) && "localhost".equals(url.getHost())
                && url.getPort() == -1 && url.getUserInfo() == null ? view : null;
        } catch (RuntimeException ignored) { return null; }
    }

    private static long remaining(long deadline) {
        long left = deadline - SystemClock.elapsedRealtime();
        assertTrue("NMPUC_DEADLINE_EXHAUSTED", left > 0);
        return Math.min(CALLBACK_MS, left);
    }

    @SuppressWarnings("deprecation")
    private static boolean nativeGeometry(WebView view, Target target) {
        if (!view.isAttachedToWindow() || !view.isShown() || !view.hasWindowFocus() || view.getAlpha() < 0.99f
            || view.getDisplay() == null || view.getDisplay().getDisplayId() != Display.DEFAULT_DISPLAY
            || view.getScrollX() != 0 || view.getScrollY() != 0 || !view.getMatrix().isIdentity()) return false;
        int[] offset = new int[2]; view.getLocationOnScreen(offset);
        Rect visible = new Rect();
        if (!view.getGlobalVisibleRect(visible) || visible.width() != view.getWidth() || visible.height() != view.getHeight()) return false;
        return target == null || (view == target.webView && view.getWidth() == target.width && view.getHeight() == target.height
            && offset[0] == target.left && offset[1] == target.top && Math.abs(view.getScale() - target.scale) < 0.001
            && SystemClock.elapsedRealtime() - target.measured <= 1_000);
    }

    @SuppressWarnings("deprecation")
    private static Target measure(ActivityScenario<MainActivity> activity, String mode, String choice, long deadline) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Target> result = new AtomicReference<>();
        activity.onActivity(screen -> {
            try {
                WebView view = localWebView(screen);
                if (view == null || !nativeGeometry(view, null)) { done.countDown(); return; }
                view.evaluateJavascript(script(mode, choice, TARGET_PROBE), value -> {
                    try {
                        if ("null".equals(value)) return;
                        // Numeric-only private transport: never return/log DOM, identities or Auth.
                        if (value == null || value.length() > 512) return;
                        JSONArray array = new JSONArray(value);
                        if (array.length() != 8) return;
                        double[] css = new double[8];
                        for (int i = 0; i < 8; ++i) {
                            Object number = array.get(i);
                            if (!(number instanceof Number)) return;
                            css[i] = ((Number) number).doubleValue();
                        }
                        int[] offset = new int[2]; view.getLocationOnScreen(offset);
                        Target target = new Target(view, css, view.getScale(), view.getWidth(), view.getHeight(), offset[0], offset[1]);
                        if (target.point != null && localWebView(screen) == view && nativeGeometry(view, target)) result.set(target);
                    } catch (Exception ignored) { /* Malformed numeric callback is unavailable, not content. */ }
                    finally { done.countDown(); }
                });
            } catch (RuntimeException ignored) { done.countDown(); }
        });
        assertTrue("NMPUC_GEOMETRY_CALLBACK_UNKNOWN", done.await(remaining(deadline), TimeUnit.MILLISECONDS));
        return result.get();
    }

    private static void reveal(ActivityScenario<MainActivity> activity, String mode, String choice, long deadline) throws Exception {
        // Wait for the real Settings/hook load before scrolling; a missing/disabled
        // disclosure is not permission to scroll through another surface.
        boolean present = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (evaluateBoolean(activity, script(mode, choice, "return enabled(select());"), deadline)) { present = true; break; }
            requireClosedCapabilities(activity, deadline);
            SystemClock.sleep(100);
        }
        assertTrue("NMPUC_SETTINGS_CONTROL_UNAVAILABLE", present);
        for (int scroll = 0; scroll <= 6; ++scroll) {
            if (measure(activity, mode, choice, deadline) != null) return;
            assertTrue("NMPUC_TARGET_NOT_VISIBLE", scroll < 6);
            Target scroller = measure(activity, "scroll", "none", deadline);
            assertTrue("NMPUC_SCROLL_TARGET_UNAVAILABLE", scroller != null);
            boolean towardEarlier = evaluateBoolean(activity, script(mode, choice, SCROLL_UP_PROBE), deadline);
            injectOnce(activity, scroller, "scroll", "none", towardEarlier ? -1 : 1, deadline);
            SystemClock.sleep(150);
        }
    }

    private static void tapOnce(ActivityScenario<MainActivity> activity, String mode, String choice, long deadline) throws Exception {
        requireClosedCapabilities(activity, deadline);
        Target target = null;
        while (SystemClock.elapsedRealtime() < deadline && target == null) {
            target = measure(activity, mode, choice, deadline);
            if (target == null) SystemClock.sleep(100);
        }
        assertTrue("NMPUC_TAP_TARGET_UNAVAILABLE", target != null);
        if ("radio".equals(mode)) assertTrue("NMPUC_RADIO_ALREADY_CHECKED", evaluateBoolean(activity,
            script(mode, choice, "const e=select();return enabled(e)&&!e.checked;"), deadline));
        injectOnce(activity, target, mode, choice, 0, deadline);
        requireClosedCapabilities(activity, deadline);
    }

    private static void injectOnce(ActivityScenario<MainActivity> activity, Target target, String mode, String choice,
        int direction, long deadline) throws Exception {
        String recheck = "const current=(()=>{" + TARGET_PROBE + "})();const old=" + new JSONArray(target.css).toString()
            + ";return !!current&&current.length===8&&current.every((n,i)=>Math.abs(n-old[i])<=0.5);";
        assertTrue("NMPUC_HIT_TEST_CHANGED", evaluateBoolean(activity, script(mode, choice, recheck), deadline));
        AtomicBoolean stillLocal = new AtomicBoolean(false);
        activity.onActivity(screen -> stillLocal.set(localWebView(screen) == target.webView && nativeGeometry(target.webView, target)));
        assertTrue("NMPUC_NATIVE_MAPPING_CHANGED", stillLocal.get());
        remaining(deadline);
        double x = target.point[0], y = target.point[1];
        double distance = direction * (target.css[5] - target.css[3]) * target.scale * 0.5;
        long down = SystemClock.uptimeMillis();
        boolean released = false;
        try {
            send(down, MotionEvent.ACTION_DOWN, x, y + distance / 2);
            if (direction == 0) SystemClock.sleep(50);
            if (direction != 0) for (int step = 1; step <= 6; ++step) {
                remaining(deadline); SystemClock.sleep(25);
                send(down, MotionEvent.ACTION_MOVE, x, y + distance / 2 - distance * step / 6);
            }
            remaining(deadline);
            send(down, MotionEvent.ACTION_UP, x, y - distance / 2);
            released = true;
        } finally {
            // A lost injection acknowledgement never causes a second tap/save.
            if (!released) send(down, MotionEvent.ACTION_CANCEL, x, y);
        }
    }

    private static void send(long down, int action, double x, double y) {
        MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, (float) x, (float) y, 0);
        event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try { InstrumentationRegistry.getInstrumentation().sendPointerSync(event); }
        finally { event.recycle(); }
    }
}
