package com.kub.messenger;

import android.app.Application;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.UUID;

/** Application-scoped Auth coordinator. SDK remains the sole access-token refresh owner. */
final class MessagePreviewSession {
    interface Completion { void complete(boolean verified); }
    private static MessagePreviewSession registered;
    private static long revisionCounter;
    static synchronized long nextRevision() {
        return revisionCounter < 9007199254740991L ? ++revisionCounter : -1;
    }
    static void suspendContent() { denyContent(); }
    private final Application application;
    private final MessagePreviewForegroundAuthority issuer;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final RoutingAuthority routing = new RoutingAuthority();
    private final MessagePreviewPristineInitializer owner;
    private Object bridge;
    private MessagePreviewVerificationRuntime runtime;
    private Invocation pending, running, retained;
    private long authRevision = -1, lastVerificationRevision = -1, generation, vaultRevision;
    private boolean loaded, busy, terminal, retireRequested, committed;
    private Binding binding;
    private static final Object CONTENT = new Object();
    private static long contentEpoch;
    private static boolean contentDenied;
    static final class ContentPermit {
        private final long epoch;
        private ContentPermit(long epoch) { this.epoch = epoch; }
    }
    static final class Binding {
        final String contextId, recipient, session, device, publicKey;
        final long accountEpoch, generation, vaultRevision, expiresAt;
        private final Invocation source;
        private Binding(Invocation source, long generation, long vaultRevision, long expiresAt) {
            this.source = source; contextId = UUID.randomUUID().toString(); recipient = source.owner.recipient;
            session = source.owner.session; device = source.owner.device; accountEpoch = source.owner.accountEpoch;
            publicKey = source.publicKey; this.generation = generation; this.vaultRevision = vaultRevision; this.expiresAt = expiresAt;
        }
    }
    static ContentPermit captureContent() {
        synchronized (CONTENT) { return contentDenied ? null : new ContentPermit(contentEpoch); }
    }
    static boolean contentCurrent(ContentPermit permit) {
        synchronized (CONTENT) { return permit != null && !contentDenied && permit.epoch == contentEpoch; }
    }
    static boolean publishContent(ContentPermit permit, Runnable posting) {
        synchronized (CONTENT) {
            if (posting == null || !contentCurrent(permit)) return false;
            posting.run(); return true;
        }
    }
    private static void denyContent() {
        synchronized (CONTENT) { contentDenied = true; if (contentEpoch < Long.MAX_VALUE) contentEpoch++; }
    }
    synchronized Binding binding(Object expectedBridge, MessagePreviewVerificationRuntime expectedRuntime) {
        return bridge == expectedBridge && runtime == expectedRuntime && current(binding) ? binding : null;
    }
    synchronized boolean current(Binding expected) {
        return expected != null && binding == expected && committed && !terminal && !expected.source.cancelled
            && retained == expected.source && authRevision == expected.source.context.revision
            && bridge == expected.source.bridge && runtime == expected.source.runtime
            && System.currentTimeMillis() < expected.expiresAt;
    }
    synchronized boolean blockContent(Binding expected) {
        if (!current(expected)) return false;
        denyContent(); return true;
    }
    synchronized boolean allowContent(Binding expected, String choice) {
        if (!current(expected) || !("none".equals(choice) || "sender".equals(choice) || "message".equals(choice))) return false;
        synchronized (CONTENT) {
            if (contentEpoch == Long.MAX_VALUE) return false;
            contentEpoch++; contentDenied = "none".equals(choice); return true;
        }
    }

    private static final class RoutingAuthority implements MessagePreviewVaultProvisioning.Authority {
        volatile MessagePreviewVerificationProducer producer;
        public void requireCurrent(MessagePreviewVaultProvisioning.Identity identity) throws Exception {
            MessagePreviewVerificationProducer expected = producer;
            if (expected == null) throw new IllegalStateException("UNAVAILABLE");
            expected.requireCurrent(identity);
            if (producer != expected) throw new IllegalStateException("UNAVAILABLE");
        }
        public MessagePreviewVaultProvisioning.Verification verify(MessagePreviewVaultProvisioning.Identity identity,
                String access, long deadline) throws Exception { throw new IllegalStateException("UNAVAILABLE"); }
        public MessagePreviewVaultProvisioning.Verification verify(MessagePreviewVaultProvisioning.Identity identity,
                String access, long deadline, MessagePreviewVaultProvisioning.Current current) throws Exception {
            MessagePreviewVerificationProducer expected = producer;
            if (expected == null) throw new IllegalStateException("UNAVAILABLE");
            requireCurrent(identity);
            MessagePreviewVaultProvisioning.Verification result = expected.verify(identity, access, deadline, current);
            if (producer != expected) throw new IllegalStateException("UNAVAILABLE");
            requireCurrent(identity);
            return result;
        }
    }
    private static final class Invocation {
        final Object bridge;
        final MessagePreviewVerificationRuntime runtime;
        final MessagePreviewVaultFence.Context context;
        final MessagePreviewVaultFence.Owner owner;
        final long deadline;
        MessagePreviewVaultProvisioning.Identity identity;
        MessagePreviewVerificationProducer producer;
        String access, publicKey;
        Completion completion;
        boolean cancelled, began;
        Invocation(Object bridge, MessagePreviewVerificationRuntime runtime, long revision, String epoch, String recipient,
                String session, long account, String device, String access, String key, long deadline, Completion completion) {
            this.bridge = bridge; this.runtime = runtime;
            context = new MessagePreviewVaultFence.Context(revision, epoch, recipient, session, account);
            owner = new MessagePreviewVaultFence.Owner(recipient, session, device, account);
            this.access = access; publicKey = key; this.deadline = deadline; this.completion = completion;
        }
    }
    private static final class Operation {
        final long revision;
        final String id;
        Operation(long revision, String id) { this.revision = revision; this.id = id; }
    }
    private Operation nextOperation(long floor, boolean retirement) {
        long ceiling = retirement ? 9007199254740991L : 9007199254740990L;
        // Native mode retains at most one imported legacy ID, without clearing its replay pin.
        for (int skipped = 0; skipped < 2 && floor < ceiling; skipped++) {
            long revision = ++floor;
            String id = owner.nextOperationId(revision);
            if (id != null) return new Operation(revision, id);
        }
        return null;
    }
    static synchronized MessagePreviewSession getOrCreate(Application application) throws Exception {
        requireMain();
        if (registered == null) registered = new MessagePreviewSession(application);
        if (registered.application != application) throw new IllegalStateException("UNAVAILABLE");
        return registered;
    }
    private MessagePreviewSession(Application application) throws Exception {
        this.application = application;
        issuer = MessagePreviewForegroundAuthority.getOrCreate(application);
        owner = MessagePreviewPristineInitializer.getOrCreateForSession(application, issuer, routing);
    }
    private static void requireMain() {
        if (Looper.getMainLooper() == null || Looper.myLooper() != Looper.getMainLooper()) throw new IllegalStateException("UNAVAILABLE");
    }
    synchronized void attach(Object nextBridge, MessagePreviewVerificationRuntime nextRuntime) {
        requireMain();
        if (nextBridge == null || nextRuntime == null) throw new IllegalStateException("UNAVAILABLE");
        if (bridge == nextBridge && runtime == nextRuntime) return;
        cancelRequests(); bridge = nextBridge; runtime = nextRuntime; authRevision = lastVerificationRevision = -1;
    }
    // Called before any asynchronous erasure; callbacks cannot revive the old native admission.
    synchronized void invalidate(Object expectedBridge, MessagePreviewVerificationRuntime expectedRuntime, long revision) {
        if (bridge != expectedBridge || runtime != expectedRuntime || !MessagePreviewVerificationState.safe(revision)
            || revision <= authRevision) return;
        authRevision = revision; cancelRequests(); retireRequested = true; post(this::drive);
    }
    synchronized void verify(Object expectedBridge, MessagePreviewVerificationRuntime expectedRuntime,
            long revision, String epoch, String recipient, String session, long account, String device,
            String access, String key, long deadline, Completion completion) {
        if (completion == null) return;
        Invocation next = new Invocation(expectedBridge, expectedRuntime, revision, epoch, recipient, session,
            account, device, access, key, deadline, completion);
        if (terminal || bridge != expectedBridge || runtime != expectedRuntime || revision < authRevision || revision <= lastVerificationRevision
            || !MessagePreviewVerificationState.safe(revision) || !MessagePreviewVerificationState.safe(account)
            || !MessagePreviewVerificationState.uuid(epoch) || !MessagePreviewVerificationState.uuid(recipient)
            || !MessagePreviewVerificationState.uuid(session) || !MessagePreviewVerificationState.uuid(device)
            || !runtime.deadlineFuture(deadline) || !MessagePreviewVerificationRuntime.header(access, 8192)
            || !MessagePreviewVerificationRuntime.header(key, 4096)) { reply(next, false); return; }
        cancelRequests(); authRevision = lastVerificationRevision = revision; pending = next;
        post(this::drive);
    }
    private void cancelRequests() {
        committed = false; binding = null; denyContent();
        if (pending != null) { pending.cancelled = true; reply(pending, false); pending = null; }
        if (running != null) { running.cancelled = true; reply(running, false); }
        MessagePreviewVerificationProducer producer = routing.producer; routing.producer = null;
        if (producer != null) producer.close();
        // Unloaded bootstrap owns installation metadata only; latest Auth waits for it.
        // Its foreground permit still expires on lifecycle changes, independently of Auth.
        if (terminal || loaded || !busy) owner.invalidate();
    }
    private boolean current(Invocation attempt) {
        return attempt != null && !attempt.cancelled && !terminal && bridge == attempt.bridge && runtime == attempt.runtime
            && authRevision == attempt.context.revision && attempt.runtime.deadlineFuture(attempt.deadline);
    }
    private void post(Runnable work) {
        if (!main.post(work)) { synchronized (this) { terminal = true; cancelRequests(); } }
    }
    private synchronized void reply(Invocation attempt, boolean value) {
        Completion completion = attempt.completion;
        attempt.completion = null; attempt.access = null;
        if (!value) attempt.publicKey = null;
        if (completion == null) return;
        // Plugin methods run on CapacitorPlugins and may hold Plugin while entering Session.
        // Claim once here, but never invoke their completion while holding Session.
        post(() -> {
            boolean accepted;
            synchronized (MessagePreviewSession.this) {
                accepted = value && current(attempt) && binding != null && binding.source == attempt && current(binding);
            }
            try { completion.complete(accepted); } catch (RuntimeException unknown) { /* Never replay an ACK. */ }
        });
    }
    private synchronized void drive() {
        requireMain();
        if (busy || terminal) return;
        if (!loaded) {
            if (pending == null && !retireRequested) return;
            busy = true;
            owner.loadExisting(result -> post(() -> loaded(result, false)));
            return;
        }
        if (retireRequested) { retire(); return; }
        Invocation attempt = pending; pending = null;
        if (attempt == null) return;
        if (!current(attempt)) { reply(attempt, false); return; }
        running = attempt;
        try {
            Operation operation = nextOperation(vaultRevision, false);
            if (operation == null) throw new IllegalStateException("UNAVAILABLE");
            attempt.identity = new MessagePreviewVaultProvisioning.Identity(operation.id,
                operation.revision, generation, attempt.context, attempt.owner);
            attempt.producer = new MessagePreviewVerificationProducer(attempt.runtime, issuer, attempt.publicKey);
            routing.producer = attempt.producer;
            attempt.producer.arm(attempt.identity, attempt.deadline);
            busy = true;
            attempt.began = owner.beginOwned(attempt.identity.operationId, attempt.identity.vaultRevision, generation, attempt.context, attempt.owner,
                result -> post(() -> began(attempt, result)));
            if (attempt.began) retained = attempt;
        } catch (Exception refused) { failed(attempt); }
    }
    private synchronized void loaded(MessagePreviewPristineInitializer.InitResult result, boolean pristineAttempt) {
        requireMain();
        if (result.status == MessagePreviewPristineInitializer.Status.UNAVAILABLE) {
            if (!pristineAttempt && (retireRequested || (pending != null && current(pending)))) {
                // This does not infer a reset from failed loading. The existing initializer independently
                // requires a pristine namespace AND a complete clean key inventory before its first effect.
                // A signed-out clear must settle that same guarded EMPTY before a later login.
                owner.initializeExplicit(next -> post(() -> loaded(next, true)));
                return;
            }
            busy = false; terminal = true; cancelRequests(); return;
        }
        if (result.generation == null || result.vaultRevision == null) {
            busy = false; terminal = true; cancelRequests(); return;
        }
        generation = result.generation; vaultRevision = result.vaultRevision;
        loaded = true; busy = false;
        if (result.status == MessagePreviewPristineInitializer.Status.LOADED_EXISTING
            || result.status == MessagePreviewPristineInitializer.Status.LOADED_FOR_RETIREMENT) retireRequested = true;
        drive();
    }
    private synchronized void began(Invocation attempt, MessagePreviewPristineInitializer.ProvisionResult result) {
        requireMain(); busy = false;
        if (!current(attempt) || result.status != MessagePreviewPristineInitializer.ProvisionStatus.PENDING
            || result.generation == null || result.generation != attempt.identity.generation || result.ticket == null) { failed(attempt); return; }
        generation = result.generation; vaultRevision = attempt.identity.vaultRevision;
        String borrowed = attempt.access; attempt.access = null;
        busy = true;
        owner.provisionExact(attempt.identity.operationId, result.ticket, borrowed, next -> post(() -> provisioned(attempt, next)));
    }
    private synchronized void provisioned(Invocation attempt, MessagePreviewPristineInitializer.ProvisionResult result) {
        requireMain(); busy = false;
        try {
            if (!current(attempt) || result.status != MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED
                || result.generation == null || result.generation != attempt.identity.generation
                || result.expiresAt == null || result.expiresAt <= System.currentTimeMillis()) throw new IllegalStateException("UNAVAILABLE");
            attempt.producer.requireCurrentInvocation();
            MessagePreviewVaultFence.Context c = attempt.context;
            if (!attempt.runtime.matchesVerified(c.revision, c.epoch, c.recipient, c.session, c.accountEpoch, attempt.owner.device))
                throw new IllegalStateException("UNAVAILABLE");
            generation = result.generation; vaultRevision = attempt.identity.vaultRevision;
            running = null; committed = true; binding = new Binding(attempt, generation, vaultRevision, result.expiresAt);
            reply(attempt, true); drive();
        } catch (Exception refused) { failed(attempt); }
    }
    private void failed(Invocation attempt) {
        busy = false; running = null; reply(attempt, false);
        attempt.cancelled = true;
        if (attempt.producer != null) attempt.producer.close();
        if (routing.producer == attempt.producer) routing.producer = null;
        if (attempt.began || retained != null) retireRequested = true;
        drive();
    }
    private void retire() {
        requireMain(); busy = true; committed = false;
        Invocation prior = retained;
        Operation operation = nextOperation(Math.max(vaultRevision, prior == null ? 0 : prior.identity.vaultRevision), true);
        if (operation == null) { busy = false; terminal = true; cancelRequests(); return; }
        long base = prior == null ? generation : prior.identity.baseGeneration;
        MessagePreviewVaultFence.Correlation correlation = prior == null ? null
            : new MessagePreviewVaultFence.Correlation(prior.identity.operationId, prior.identity.vaultRevision);
        owner.retireExact(operation.id, operation.revision, base, correlation, result -> post(() -> {
            synchronized (MessagePreviewSession.this) {
                busy = false;
                if (result.status != MessagePreviewPristineInitializer.TransitionStatus.RETIRED || result.generation == null) {
                    terminal = true; cancelRequests(); return;
                }
                generation = result.generation; vaultRevision = operation.revision; retained = null; retireRequested = false;
                drive();
            }
        }));
    }
}
