package com.kub.messenger;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

// One isolated QA diagnostic, not preview consent or a background credential consumer.
final class MessagePreviewForegroundComposition implements Application.ActivityLifecycleCallbacks {
    interface Completion { void complete(boolean verified); }
    private static MessagePreviewForegroundComposition registered;
    private final Application application;
    private final Object bridge;
    private final MessagePreviewVerificationRuntime runtime;
    private final MessagePreviewForegroundAuthority issuer;
    private final ScheduledThreadPoolExecutor deadlines;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Object lifecycle;
    private String recipient;
    private long requestedAt, requestDeadline;
    private ScheduledFuture<?> expiry;
    private Invocation invocation;
    private MessagePreviewVerificationProducer producer;
    private MessagePreviewPristineInitializer owner;
    private boolean requested, consumed, cancelled, detached, initializing, beginSent, erasureSent;
    private boolean cleanupScheduled, finished;
    private boolean initializedObserved, pendingObserved, committedObserved, retiredObserved;

    private static final class Invocation {
        final MessagePreviewVaultProvisioning.Identity identity;
        final long deadline;
        String access, publicKey;
        Completion completion;
        Invocation(long revision, String epoch, String user, String session, long account, String device,
                String access, String key, long deadline, Completion completion) {
            MessagePreviewVaultFence.Context context = new MessagePreviewVaultFence.Context(revision, epoch, user, session, account);
            MessagePreviewVaultFence.Owner owner = new MessagePreviewVaultFence.Owner(user, session, device, account);
            identity = new MessagePreviewVaultProvisioning.Identity(MessagePreviewVaultProvisioning.opaque(), 1, 0, context, owner);
            this.access = access; publicKey = key; this.deadline = deadline; this.completion = completion;
        }
    }

    static void bootstrap(Application application) {
        if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION) return;
        try { MessagePreviewForegroundAuthority.getOrCreate(application); }
        catch (Exception refused) { /* A missing early issuer is a fixed QA refusal, never callback replay. */ }
    }

    MessagePreviewForegroundComposition(Application application, Object bridge, MessagePreviewVerificationRuntime runtime,
            MessagePreviewForegroundAuthority issuer, ScheduledThreadPoolExecutor deadlines) throws Exception {
        requireMain();
        if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION || application == null || bridge == null
            || runtime == null || issuer == null || deadlines == null) throw new IllegalStateException("UNAVAILABLE");
        synchronized (MessagePreviewForegroundComposition.class) {
            if (registered != null) throw new IllegalStateException("UNAVAILABLE");
            registered = this;
        }
        this.application = application; this.bridge = bridge; this.runtime = runtime;
        this.issuer = issuer; this.deadlines = deadlines;
    }

    private static void requireMain() {
        if (Looper.getMainLooper() == null || Looper.myLooper() != Looper.getMainLooper()) throw new IllegalStateException("UNAVAILABLE");
    }

    synchronized boolean request(String expectedRecipient) {
        try {
            requireMain();
            if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION || requested || cancelled
                || !MessagePreviewVerificationState.uuid(expectedRecipient)) return false;
            lifecycle = issuer.capture();
            requestedAt = SystemClock.elapsedRealtime();
            if (!MessagePreviewVerificationState.safe(requestedAt) || requestedAt > 9007199254620991L
                || !issuer.isCurrent(lifecycle)) return false;
            requested = true; recipient = expectedRecipient; requestDeadline = requestedAt + 120_000;
            application.registerActivityLifecycleCallbacks(this);
            expiry = deadlines.schedule(this::close, 120_000, TimeUnit.MILLISECONDS);
            return true;
        } catch (Exception refused) { close(); return false; }
    }

    // Called on Capacitor's taskHandler. Credentials live only in this scrub-able continuation.
    synchronized boolean offer(Object liveBridge, MessagePreviewVerificationRuntime liveRuntime,
            long revision, String epoch, String user, String session, long account, String device,
            String access, String key, long originalDeadline, Completion completion) {
        if (!requested) return false;
        if (consumed || cancelled) { completion.complete(false); return true; }
        consumed = true;
        if (expiry != null) expiry.cancel(false);
        invocation = new Invocation(revision, epoch, user, session, account, device, access, key, originalDeadline, completion);
        long now = SystemClock.elapsedRealtime();
        if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION || bridge != liveBridge || runtime != liveRuntime
            || !recipient.equals(user) || !requestCurrent(now) || !runtime.deadlineFuture(originalDeadline)
            || !MessagePreviewVerificationRuntime.header(access, 8192) || !MessagePreviewVerificationRuntime.header(key, 4096)) {
            close(); return true;
        }
        try {
            expiry = deadlines.schedule(this::close, originalDeadline - now, TimeUnit.MILLISECONDS);
            post(this::admit);
        } catch (RuntimeException refused) { close(); }
        return true;
    }

    private boolean requestCurrent(long now) {
        return requested && !cancelled && issuer.isCurrent(lifecycle) && MessagePreviewVerificationState.safe(now)
            && now >= requestedAt && now < requestDeadline;
    }
    private boolean current(Invocation expected) {
        long now = SystemClock.elapsedRealtime();
        return invocation == expected && requestCurrent(now) && now < expected.deadline
            && runtime.deadlineFuture(expected.deadline);
    }
    private void post(Runnable continuation) {
        if (!main.post(continuation)) { close(); finishUnknown(); }
    }

    private synchronized void admit() {
        requireMain();
        Invocation attempt = invocation;
        try {
            if (!current(attempt)) throw new IllegalStateException("UNAVAILABLE");
            producer = new MessagePreviewVerificationProducer(runtime, issuer, attempt.publicKey);
            producer.arm(attempt.identity, attempt.deadline);
            attempt.publicKey = null;
            owner = MessagePreviewPristineInitializer.getOrCreate(application, issuer, producer);
            initializing = true;
            owner.initializeExplicit(result -> post(() -> initialized(attempt, result)));
        } catch (Exception refused) { close(); }
    }
    private synchronized void initialized(Invocation attempt, MessagePreviewPristineInitializer.InitResult result) {
        requireMain(); initializing = false;
        if (!current(attempt) || result.status != MessagePreviewPristineInitializer.Status.INITIALIZED_EMPTY_G0
            || result.generation == null || result.generation != 0L) { close(); retireOnMain(); return; }
        initializedObserved = true; beginSent = true;
        owner.beginOwned(attempt.identity.operationId, 1, 0, attempt.identity.context, attempt.identity.owner,
            outcome -> post(() -> pending(attempt, outcome)));
    }
    private synchronized void pending(Invocation attempt, MessagePreviewPristineInitializer.ProvisionResult result) {
        requireMain();
        if (!current(attempt) || result.status != MessagePreviewPristineInitializer.ProvisionStatus.PENDING
            || result.generation == null || result.generation != 1L || result.ticket == null) { close(); return; }
        pendingObserved = true;
        String borrowed = attempt.access; attempt.access = null;
        owner.provisionExact(attempt.identity.operationId, result.ticket, borrowed,
            outcome -> post(() -> committed(attempt, outcome)));
    }
    private synchronized void committed(Invocation attempt, MessagePreviewPristineInitializer.ProvisionResult result) {
        requireMain();
        MessagePreviewVaultFence.Context c = attempt.identity.context;
        if (!current(attempt) || result.status != MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED
            || result.generation == null || result.generation != 1L
            || !runtime.matchesVerified(c.revision, c.epoch, c.recipient, c.session, c.accountEpoch, attempt.identity.owner.device)) {
            close(); return;
        }
        try { producer.requireCurrentInvocation(); }
        catch (Exception refused) { close(); return; }
        committedObserved = true;
        reply(attempt, true);
        // Retain original expiry after ACK: a reply is not a renewable credential lease.
    }
    private static void reply(Invocation attempt, boolean value) {
        if (attempt == null) return;
        Completion completion = attempt.completion;
        attempt.completion = null; attempt.access = null; attempt.publicKey = null;
        if (completion != null) {
            try { completion.complete(value); } catch (RuntimeException ignored) { /* Lost ACK never authorizes replay. */ }
        }
    }
    synchronized void bindingChanged(long nextRevision) {
        if (consumed && invocation != null && MessagePreviewVerificationState.safe(nextRevision)
            && nextRevision > invocation.identity.context.revision) close();
    }
    synchronized void bindingChanged() { if (consumed) close(); }
    synchronized void close() {
        if (cancelled) return;
        cancelled = true;
        if (expiry != null) expiry.cancel(false);
        reply(invocation, false);
        if (producer != null) producer.close();
        if (owner != null) owner.invalidate();
        post(this::retireOnMain);
    }

    private synchronized void retireOnMain() {
        requireMain();
        if (!detached) { application.unregisterActivityLifecycleCallbacks(this); detached = true; }
        if (owner == null || finished) return;
        if (!cleanupScheduled) { cleanupScheduled = true; main.postDelayed(this::finishUnknown, 10_000); }
        if (initializing || erasureSent) return;
        if (!beginSent) { finishUnknown(); return; }
        erasureSent = true;
        Invocation attempt = invocation;
        // Correlation handles a BEGIN whose durable ACK was lost, without assuming G1.
        MessagePreviewVaultFence.Correlation correlation = pendingObserved ? null
            : new MessagePreviewVaultFence.Correlation(attempt.identity.operationId, 1);
        owner.retireExact(MessagePreviewVaultProvisioning.opaque(), 2, pendingObserved ? 1 : 0, correlation,
            result -> post(() -> retired(result)));
    }
    private synchronized void retired(MessagePreviewPristineInitializer.TransitionResult result) {
        requireMain();
        if (!finished && result.status == MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            && result.generation != null && result.generation == 2L) retiredObserved = true;
        finishUnknown();
    }
    private synchronized void finishUnknown() {
        // No EMPTY claim on refusal/unknown; terminal owner is never reconstructed.
        finished = true;
        if (owner != null) owner.close();
    }
    synchronized boolean phaseObserved(String phase) {
        if (!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION || phase == null) return false;
        switch (phase) {
            case "INITIALIZED": return initializedObserved;
            case "PENDING": return pendingObserved;
            case "COMMITTED": return committedObserved;
            case "RETIRED": return retiredObserved;
            default: return false;
        }
    }
    private void lifecycleChanged() { if (requested && !issuer.isCurrent(lifecycle)) close(); }
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
