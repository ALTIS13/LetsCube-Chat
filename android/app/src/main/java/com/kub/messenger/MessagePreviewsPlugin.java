package com.kub.messenger;

import android.os.SystemClock;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

@CapacitorPlugin(name = "MessagePreviews")
public class MessagePreviewsPlugin extends Plugin {
    private MessagePreviewVerificationRuntime runtime;
    private ThreadPoolExecutor worker;
    private ScheduledThreadPoolExecutor deadlines;
    private MessagePreviewForegroundComposition qaComposition;
    private WebViewListener qaDocumentListener;

    @Override public synchronized void load() {
        handleOnDestroy();
        MessagePreviewVerificationState state = new MessagePreviewVerificationState(new MessagePreviewVerificationState.Clock() {
            public long wallTime() { return System.currentTimeMillis(); }
            public long elapsedTime() { return SystemClock.elapsedRealtime(); }
        });
        MessagePreviewHttpTransport transport = new MessagePreviewHttpTransport(state::elapsed);
        runtime = new MessagePreviewVerificationRuntime(state, deadline -> {
            long remaining = deadline - SystemClock.elapsedRealtime();
            if (remaining <= 0) throw new IllegalStateException();
            return Tasks.await(FirebaseMessaging.getInstance().getToken(), remaining, TimeUnit.MILLISECONDS);
        }, transport, transport);
        worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new SynchronousQueue<>(), work -> {
            Thread thread = new Thread(work, "letscube-preview-verification"); thread.setDaemon(true); return thread;
        });
        deadlines = new ScheduledThreadPoolExecutor(1, work -> {
            Thread thread = new Thread(work, "letscube-preview-deadline"); thread.setDaemon(true); return thread;
        });
        deadlines.setRemoveOnCancelPolicy(true);
    }
    @PluginMethod public void getCapabilities(PluginCall call) { call.resolve(new JSObject().put("protocol", 0)); }
    @PluginMethod public synchronized void beginBinding(PluginCall call) {
        if (qaComposition != null && !loggingOff()) qaComposition.close();
        if (!loggingOff()) { if (runtime != null) runtime.retire(); call.resolve(new JSObject().put("epoch", JSONObject.NULL)); return; }
        Long revision = integer(call, "revision"), account = integer(call, "accountEpoch");
        String epoch = runtime == null || revision == null ? null
            : runtime.beginBinding(revision, call.getString("recipientId"), call.getString("recipientSessionId"), account == null ? -1 : account);
        if (qaComposition != null && revision != null) qaComposition.bindingChanged(revision);
        call.resolve(new JSObject().put("epoch", epoch == null ? JSONObject.NULL : epoch));
    }
    @PluginMethod public synchronized void clearBinding(PluginCall call) {
        Long revision = integer(call, "revision");
        boolean applied = runtime != null && revision != null && runtime.clearBinding(revision);
        if (applied && qaComposition != null) qaComposition.bindingChanged(revision);
        call.resolve(new JSObject().put("applied", applied));
    }
    @PluginMethod public synchronized void verifyBinding(PluginCall call) {
        long started = qaComposition == null ? -1 : SystemClock.elapsedRealtime();
        long originalDeadline = MessagePreviewVerificationState.safe(started) && started <= 9007199254732991L
            ? started + 8_000 : -1;
        Long revision = integer(call, "revision"), account = integer(call, "accountEpoch");
        String epoch = call.getString("epoch"), user = call.getString("recipientId"), session = call.getString("recipientSessionId");
        String device = call.getString("deviceId"), access = call.getString("accessToken"), key = call.getString("publicApiKey");
        // The Capacitor call remains pending, but its retained data must not hold credentials.
        call.getData().remove("accessToken"); call.getData().remove("publicApiKey");
        if (qaComposition != null && !loggingOff()) qaComposition.close();
        if (!loggingOff()) { if (runtime != null) runtime.retire(); verified(call, false); return; }
        if (qaComposition != null && qaComposition.offer(getBridge(), runtime,
            revision == null ? -1 : revision, epoch, user, session, account == null ? -1 : account,
            device, access, key, originalDeadline, value -> verified(call, value))) return;
        if (runtime == null || worker == null || revision == null || account == null) { verified(call, false); return; }
        MessagePreviewVerificationRuntime owner = runtime;
        AtomicBoolean replied = new AtomicBoolean();
        try {
            ScheduledFuture<?> timeout = deadlines.schedule(() -> {
                if (replied.compareAndSet(false, true)) {
                    owner.cancelBinding(revision, epoch, user, session, account, device); verified(call, false);
                }
            }, 8_000, TimeUnit.MILLISECONDS);
            try {
                worker.execute(() -> {
                    boolean success = owner.verifyBinding(revision, epoch, user, session, account, device, access, key);
                    if (replied.compareAndSet(false, true)) {
                        timeout.cancel(false); verified(call, success && owner.matchesVerified(revision, epoch, user, session, account, device));
                    }
                });
            } catch (RejectedExecutionException busy) { timeout.cancel(false); throw busy; }
        } catch (RejectedExecutionException busy) {
            owner.rejectBinding(revision, epoch, user, session, account, device); verified(call, false);
        }
    }
    private static void verified(PluginCall call, boolean value) { call.resolve(new JSObject().put("verified", value)); }
    private boolean loggingOff() {
        try { return getBridge() != null && getBridge().getConfig() != null && !getBridge().getConfig().isLoggingEnabled(); }
        catch (RuntimeException unavailable) { return false; }
    }
    private static Long integer(PluginCall call, String key) {
        Object value = call.getData().opt(key);
        if (!(value instanceof Number)) return null;
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) && number >= 0 && number <= 9007199254740991d && number == Math.rint(number)
            ? ((Number) value).longValue() : null;
    }
    // Instrumentation observes only a boolean, never a tuple, ticket or credential.
    synchronized boolean hasVerifiedBinding(String expectedRecipientId) {
        return loggingOff() && runtime != null && runtime.hasVerifiedBinding(expectedRecipientId);
    }
    synchronized boolean requestQaComposition(String expectedRecipientId) {
        if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION || !loggingOff() || runtime == null || deadlines == null
            || getActivity() == null || getActivity().getClass() != MainActivity.class) return false;
        try {
            if (qaComposition != null) return false;
            android.app.Application application = getActivity().getApplication();
            MessagePreviewForegroundAuthority issuer = MessagePreviewForegroundAuthority.getOrCreate(application);
            qaComposition = new MessagePreviewForegroundComposition(application, getBridge(), runtime, issuer, deadlines);
            qaDocumentListener = new WebViewListener() {
                @Override public void onPageStarted(WebView webView) { retireQaDocument(); }
            };
            getBridge().addWebViewListener(qaDocumentListener);
            return qaComposition.request(expectedRecipientId);
        } catch (Exception refused) { if (qaComposition != null) qaComposition.close(); return false; }
    }
    private synchronized void retireQaDocument() {
        if (qaComposition != null) qaComposition.close();
        if (runtime != null) runtime.retire();
    }
    synchronized boolean hasQaCompositionPhase(String phase) {
        return loggingOff() && qaComposition != null && qaComposition.phaseObserved(phase);
    }
    @Override protected synchronized void handleOnDestroy() {
        if (qaComposition != null) qaComposition.close();
        if (qaDocumentListener != null) {
            Bridge oldBridge = getBridge();
            WebViewListener oldListener = qaDocumentListener; qaDocumentListener = null;
            // Page callbacks iterate the listener list; remove after that iteration, on main.
            if (oldBridge != null) new Handler(Looper.getMainLooper()).post(() -> oldBridge.removeWebViewListener(oldListener));
        }
        if (runtime != null) runtime.close();
        if (worker != null) worker.shutdownNow();
        if (deadlines != null) deadlines.shutdownNow();
    }
}
