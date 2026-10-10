package com.kub.messenger;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import java.net.URI;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

// Consent-only diagnostic memory. This selector is never a credential or preview lease.
final class MessagePreviewQaUserChoice implements Application.ActivityLifecycleCallbacks {
    private static ActivityTracker activities;
    private final Application application;
    private final Bridge bridge;
    private final WebView document;
    private final MessagePreviewVerificationRuntime runtime;
    private final MessagePreviewForegroundAuthority issuer;
    private final MessagePreviewVerificationState.Clock clock;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Object authority;
    private String recipient, contextId, choice;
    private Attempt attempt;
    private long wallDeadline, elapsedDeadline, lastWall, lastElapsed, intentRevision;
    private ScheduledFuture<?> expiry;
    private boolean armed, consumed, retired, attached, pending, confirmed;

    static final class Attempt {
        final long revision, account;
        final String epoch, user, session, device;
        Attempt(long revision, String epoch, String user, String session, long account, String device) {
            this.revision=revision; this.epoch=epoch; this.user=user; this.session=session;
            this.account=account; this.device=device;
        }
    }
    static boolean onMain() { return Looper.getMainLooper() != null && Looper.myLooper() == Looper.getMainLooper(); }
    static void bootstrap(Application application) {
        if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE) return;
        try {
            MessagePreviewForegroundAuthority.getOrCreate(application);
            if (activities == null) {
                activities=new ActivityTracker(application);
                application.registerActivityLifecycleCallbacks(activities);
            }
        }
        catch (Exception unavailable) { /* Early authority cannot be synthesized after resume. */ }
    }
    // The issuer's snapshot is opaque: track only which Activity owns this Bridge.
    private static final class ActivityTracker implements Application.ActivityLifecycleCallbacks {
        final Application application;
        Activity active;
        ActivityTracker(Application application) { this.application=application; }
        public void onActivityResumed(Activity activity) { active=activity.getClass() == MainActivity.class ? activity : null; }
        private void retire(Activity activity) { if (active == activity) active=null; }
        public void onActivityPrePaused(Activity activity) { retire(activity); }
        public void onActivityPreStopped(Activity activity) { retire(activity); }
        public void onActivityPreDestroyed(Activity activity) { retire(activity); }
        public void onActivityPaused(Activity activity) { retire(activity); }
        public void onActivityStopped(Activity activity) { retire(activity); }
        public void onActivityDestroyed(Activity activity) { retire(activity); }
        public void onActivityCreated(Activity activity, Bundle state) {}
        public void onActivityStarted(Activity activity) {}
        public void onActivitySaveInstanceState(Activity activity, Bundle state) {}
    }
    static boolean ownActivity(Application application, Bridge bridge) {
        return onMain() && activities != null && activities.application == application && activities.active != null
            && activities.active == bridge.getActivity();
    }
    static boolean local(Bridge bridge) {
        try {
            if (!onMain() || bridge == null || bridge.getConfig() == null || bridge.getConfig().isLoggingEnabled()
                || bridge.getServerUrl() != null || !"https://localhost".equals(bridge.getLocalUrl())
                || bridge.getWebView() == null) return false;
            URI uri = new URI(bridge.getWebView().getUrl());
            return "https".equals(uri.getScheme()) && "localhost".equals(uri.getRawAuthority())
                && uri.getRawUserInfo() == null && uri.getPort() == -1;
        } catch (Exception unavailable) { return false; }
    }
    MessagePreviewQaUserChoice(Application application, Bridge bridge, MessagePreviewVerificationRuntime runtime,
            MessagePreviewForegroundAuthority issuer, MessagePreviewVerificationState.Clock clock) {
        this.application=application; this.bridge=bridge; this.document=bridge.getWebView();
        this.runtime=runtime; this.issuer=issuer; this.clock=clock;
    }
    synchronized boolean request(String expectedRecipient, ScheduledThreadPoolExecutor deadlines) {
        try {
            if (!onMain() || !BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE || armed || retired
                || !MessagePreviewVerificationState.uuid(expectedRecipient) || !local(bridge) || !ownActivity(application, bridge)) return false;
            authority=issuer.capture();
            lastWall=clock.wallTime(); lastElapsed=clock.elapsedTime();
            if (!issuer.isCurrent(authority) || !MessagePreviewVerificationState.safe(lastWall)
                || !MessagePreviewVerificationState.safe(lastElapsed)
                || lastWall > 9007199254620991L || lastElapsed > 9007199254620991L) { close(); return false; }
            wallDeadline=lastWall + 120_000; elapsedDeadline=lastElapsed + 120_000;
            armed=true; recipient=expectedRecipient;
            application.registerActivityLifecycleCallbacks(this); attached=true;
            expiry=deadlines.schedule(this::close, 120_000, TimeUnit.MILLISECONDS);
            return true;
        } catch (Exception unavailable) { close(); return false; }
    }
    // Called only after ordinary call-data credential scrubbing; retains metadata only.
    synchronized Attempt captureAttempt(Bridge liveBridge, MessagePreviewVerificationRuntime liveRuntime,
            long revision, String epoch, String user, String session, long account, String device) {
        if (!armed || consumed || retired) return null;
        consumed=true;
        if (bridge != liveBridge || runtime != liveRuntime || !recipient.equals(user)
            || !MessagePreviewVerificationState.safe(revision) || !MessagePreviewVerificationState.safe(account)
            || !MessagePreviewVerificationState.uuid(epoch) || !MessagePreviewVerificationState.uuid(user)
            || !MessagePreviewVerificationState.uuid(session) || !MessagePreviewVerificationState.uuid(device)) {
            close(); return null;
        }
        attempt=new Attempt(revision, epoch, user, session, account, device);
        return attempt;
    }
    // Plugin rechecks its own incarnation/runtime/bridge on main before entering here.
    synchronized void publish(Attempt expected, boolean verified) {
        if (expected == null || expected != attempt || retired) return;
        if (!onMain() || !verified || !current()
            || !runtime.matchesVerified(expected.revision, expected.epoch, expected.user,
                expected.session, expected.account, expected.device)) { close(); return; }
        if (contextId == null) contextId=UUID.randomUUID().toString();
    }
    private boolean current() {
        if (!onMain() || retired || !armed) return false;
        long wall=clock.wallTime(), elapsed=clock.elapsedTime();
        if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE || !issuer.isCurrent(authority) || !ownActivity(application, bridge)
            || bridge.getWebView() != document || !local(bridge)
            || !MessagePreviewVerificationState.safe(wall) || !MessagePreviewVerificationState.safe(elapsed)
            || wall < lastWall || elapsed < lastElapsed || wall >= wallDeadline || elapsed >= elapsedDeadline) {
            close(); return false;
        }
        lastWall=wall; lastElapsed=elapsed;
        return true;
    }
    synchronized boolean matches(Bridge liveBridge, MessagePreviewVerificationRuntime liveRuntime) {
        if (bridge == liveBridge && runtime == liveRuntime) return true;
        close(); return false;
    }
    synchronized JSObject context(String user, String session, String device, long account) {
        if (attempt == null || contextId == null || !attempt.user.equals(user) || !attempt.session.equals(session)
            || !attempt.device.equals(device) || attempt.account != account || !current()) return new JSObject().put("qa_choice_v", 0);
        return new JSObject().put("qa_choice_v", 1).put("purpose", "consent-only").put("contextId", contextId)
            .put("recipientId", attempt.user).put("recipientSessionId", attempt.session).put("deviceId", attempt.device)
            .put("accountEpoch", attempt.account).put("expiresAt", wallDeadline);
    }
    synchronized boolean begin(String context, long revision) {
        if (!exact(context) || !MessagePreviewVerificationState.safe(revision) || revision <= intentRevision || !current()) return false;
        intentRevision=revision; choice=null; confirmed=false; pending=true;
        return true;
    }
    synchronized boolean confirm(String context, long revision, String value) {
        if (!exact(context) || !pending || revision != intentRevision || !choice(value) || !current()) return false;
        pending=false; confirmed=true; choice=value;
        return true;
    }
    synchronized boolean retire(String context, long expectedRevision, long revision) {
        // Target match precedes high-water mutation; erasure needs no reacquired authority.
        if (!onMain() || !exact(context) || expectedRevision != intentRevision
            || !MessagePreviewVerificationState.safe(revision) || revision <= intentRevision) return false;
        intentRevision=revision; close(); contextId=null;
        return true;
    }
    private boolean exact(String context) { return contextId != null && contextId.equals(context); }
    private static boolean choice(String value) { return "none".equals(value) || "sender".equals(value) || "message".equals(value); }
    synchronized void bindingChanged(long revision) {
        if (attempt != null && MessagePreviewVerificationState.safe(revision) && revision > attempt.revision) close();
    }
    synchronized void close() {
        if (retired) return;
        retired=true; authority=null; recipient=null; attempt=null; choice=null; pending=false; confirmed=false;
        if (expiry != null) expiry.cancel(false);
        // Keep only the exact erasure handle/revision until its checked retire ACK.
        if (attached) main.post(() -> {
            synchronized (MessagePreviewQaUserChoice.this) {
                if (attached) { application.unregisterActivityLifecycleCallbacks(this); attached=false; }
            }
        });
    }
    synchronized boolean observed(String value) {
        if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE || !onMain()) return false;
        if ("RETIRED".equals(value)) return retired;
        return choice(value) && current() && confirmed && value.equals(choice);
    }
    private synchronized void lifecycleChanged() { if (armed && !issuer.isCurrent(authority)) close(); }
    @Override public void onActivityPrePaused(Activity activity) { lifecycleChanged(); }
    @Override public void onActivityPreStopped(Activity activity) { lifecycleChanged(); }
    @Override public void onActivityPreDestroyed(Activity activity) { lifecycleChanged(); }
    @Override public void onActivityPaused(Activity activity) { lifecycleChanged(); }
    @Override public void onActivityStopped(Activity activity) { lifecycleChanged(); }
    @Override public void onActivityDestroyed(Activity activity) { lifecycleChanged(); }
    @Override public void onActivityResumed(Activity activity) { lifecycleChanged(); }
    @Override public void onActivityCreated(Activity activity, Bundle state) { lifecycleChanged(); }
    @Override public void onActivityStarted(Activity activity) { lifecycleChanged(); }
    @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { lifecycleChanged(); }
}
