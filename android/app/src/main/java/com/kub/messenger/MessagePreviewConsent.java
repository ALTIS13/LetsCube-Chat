package com.kub.messenger;

import android.content.Context;
import android.os.Looper;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

/** One native consent queue per plugin attachment; no bridge credential or independent Auth authority. */
final class MessagePreviewConsent {
    interface Completion { void complete(boolean accepted); }
    // Fictional HTTP/clock ports are injectable in package tests. Default uses the fixed native transport.
    interface Http { Object capability(byte[] borrowedAccess, String publicKey, String device, long deadline) throws Exception; }
    private static final int REFRESH = 0, BEGIN = 1, CONFIRM = 2;
    private final Context context;
    private final MessagePreviewSession session;
    private final Http http;
    private final LongSupplier wall, elapsed;
    private final Object state = new Object();
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(32), work -> { Thread t = new Thread(work, "NmpvConsent"); t.setDaemon(true); return t; });
    private MessagePreviewSession.Binding scope;
    private Pending pending;
    private long sequence, lastRevision = -1;
    private boolean begun, closed, confirmed;
    private MessagePreviewChoiceStore choices; // Worker-confined, retaining the store's rollback floor.

    MessagePreviewConsent(Context context, MessagePreviewSession session) {
        this(context, session, new MessagePreviewHttpTransport(SystemClock::elapsedRealtime));
    }
    private MessagePreviewConsent(Context context, MessagePreviewSession session, MessagePreviewHttpTransport transport) {
        this(context, session, (access, key, device, deadline) ->
            transport.capability(new String(access, StandardCharsets.US_ASCII), key, device, deadline),
            System::currentTimeMillis, SystemClock::elapsedRealtime);
    }
    MessagePreviewConsent(Context context, MessagePreviewSession session, Http http, LongSupplier wall, LongSupplier elapsed) {
        if (context == null || session == null || http == null || wall == null || elapsed == null) throw unavailable();
        this.context = context; this.session = session; this.http = http; this.wall = wall; this.elapsed = elapsed;
    }
    void refresh(MessagePreviewSession.Binding binding, Completion completion) { submit(REFRESH, binding, -1, null, completion); }
    void begin(MessagePreviewSession.Binding binding, long revision, Completion completion) { submit(BEGIN, binding, revision, null, completion); }
    void confirm(MessagePreviewSession.Binding binding, long revision, String choice, Completion completion) { submit(CONFIRM, binding, revision, choice, completion); }

    private static final class Pending {
        final long revision;
        boolean ready, confirming;
        Pending(long revision) { this.revision = revision; }
    }
    private final class Work implements Runnable {
        final int kind;
        final MessagePreviewSession.Binding binding;
        final Pending pending;
        final long sequence, revision;
        final String choice;
        Completion completion;
        long wallHigh, elapsedHigh, deadline;
        Work(int kind, MessagePreviewSession.Binding binding, long revision, String choice, Completion completion) {
            this.kind = kind; this.binding = binding; this.revision = revision; this.choice = choice;
            this.completion = completion; sequence = MessagePreviewConsent.this.sequence; pending = MessagePreviewConsent.this.pending;
        }
        public void run() {
            boolean accepted = false;
            try {
                require(Looper.getMainLooper() != null && Looper.myLooper() != Looper.getMainLooper());
                wallHigh = wall.getAsLong(); elapsedHigh = elapsed.getAsLong();
                require(MessagePreviewVerificationState.safe(elapsedHigh) && elapsedHigh <= MessagePreviewVerificationState.MAX_SAFE_INTEGER - 8_000);
                deadline = elapsedHigh + 8_000;
                requireCurrent(this);
                if (kind == CONFIRM) require(pending.ready);
                MessagePreviewExistingVault vault = MessagePreviewExistingVault.open(context);
                MessagePreviewMetadataEnvelope.Record record = vault.readCommitted(now(this));
                require(record.header.generation == binding.generation && record.header.vaultRevision == binding.vaultRevision
                    && record.header.expiresWallMillis == binding.expiresAt);
                checkHead(this, vault, record);
                String level = capability(this, vault, record);
                require(kind != CONFIRM || choice.equals(level));
                save(this, vault, record, level);
                // Session can invoke us while holding its monitor. Never invert Session -> state.
                synchronized (session) {
                    synchronized (state) {
                        requireCurrent(this); now(this);
                        if (kind == BEGIN) pending.ready = true;
                        else { require(session.allowContent(binding, level)); confirmed = true; }
                        if (kind == CONFIRM) MessagePreviewConsent.this.pending = null;
                        accepted = true;
                    }
                }
            } catch (Exception refused) {
                synchronized (session) {
                    synchronized (state) {
                        if (active(this)) {
                            session.blockContent(binding);
                            if (kind == CONFIRM) MessagePreviewConsent.this.pending = null;
                        }
                    }
                }
            } finally {
                Completion reply = completion; completion = null;
                reply(reply, accepted);
            }
        }
    }
    // Admission and enqueue are ordered together; none of this performs platform I/O.
    private void submit(int kind, MessagePreviewSession.Binding binding, long revision, String choice, Completion completion) {
        synchronized (session) {
            synchronized (state) {
                Work work = admission(kind, binding, revision, choice, completion);
                if (work != null) {
                    if (kind == BEGIN) session.blockContent(binding);
                    try { worker.execute(work); return; }
                    catch (RejectedExecutionException refused) { if (pending == work.pending) pending = null; }
                }
            }
        }
        reply(completion, false);
    }
    private Work admission(int kind, MessagePreviewSession.Binding binding, long revision, String choice, Completion completion) {
        if (closed || completion == null || !session.current(binding) || sequence == Long.MAX_VALUE) return null;
        if (scope != binding) { scope = binding; pending = null; begun = confirmed = false; lastRevision = -1; }
        if (kind == REFRESH) {
            if (begun) return null;
            sequence++;
        } else if (kind == BEGIN) {
            if (!MessagePreviewVerificationState.safe(revision) || revision >= MessagePreviewVerificationState.MAX_SAFE_INTEGER
                || revision <= lastRevision) return null;
            begun = true; confirmed = false; lastRevision = revision; pending = new Pending(revision); sequence++;
        } else {
            if (pending == null || pending.confirming || pending.revision != revision || !level(choice)) return null;
            pending.confirming = true;
        }
        if (kind != BEGIN) session.blockContent(binding);
        return new Work(kind, binding, revision, choice, completion);
    }
    private boolean active(Work op) {
        return !closed && scope == op.binding && sequence == op.sequence
            && (op.kind == REFRESH ? !begun : pending == op.pending);
    }
    private void requireCurrent(Work op) {
        synchronized (session) { synchronized (state) { require(active(op) && session.current(op.binding)); } }
    }
    private long now(Work op) {
        long wallNow = wall.getAsLong(), elapsedNow = elapsed.getAsLong();
        require(MessagePreviewVerificationState.safe(wallNow) && wallNow >= op.wallHigh
            && elapsedNow >= op.elapsedHigh && elapsedNow < op.deadline && wallNow < op.binding.expiresAt);
        op.wallHigh = wallNow; op.elapsedHigh = elapsedNow; return wallNow;
    }
    private void checkHead(Work op, MessagePreviewExistingVault vault, MessagePreviewMetadataEnvelope.Record record) {
        requireCurrent(op);
        require(vault.isCurrent(record, now(op)));
        requireCurrent(op); require(now(op) >= record.header.wallHighWaterMillis);
    }
    private String capability(Work op, MessagePreviewExistingVault vault, MessagePreviewMetadataEnvelope.Record record) throws Exception {
        requireCurrent(op);
        var key = new MessagePreviewKeystoreReader(context, record.header.installation).loadCredential(record.header.alias);
        checkHead(op, vault, record);
        String[] result = {null};
        MessagePreviewCredentialEnvelope.consume(record, record.header, key, (owner, access, expiry) -> {
            require(owner.recipient.equals(op.binding.recipient) && owner.session.equals(op.binding.session)
                && owner.device.equals(op.binding.device) && owner.accountEpoch == op.binding.accountEpoch && expiry == op.binding.expiresAt);
            checkHead(op, vault, record);
            if (op.kind == BEGIN) result[0] = "none";
            else {
                try {
                    Object response = http.capability(access, op.binding.publicKey, op.binding.device, op.deadline);
                    checkHead(op, vault, record);
                    result[0] = MessagePreviewResponseParser.capability(response, op.binding.recipient, op.binding.session, op.binding.device);
                    require(result[0] != null);
                } catch (Exception refused) { throw unavailable(); }
            }
        });
        checkHead(op, vault, record); return result[0];
    }
    private void save(Work op, MessagePreviewExistingVault vault, MessagePreviewMetadataEnvelope.Record record, String level) throws Exception {
        checkHead(op, vault, record);
        if (choices == null) choices = new MessagePreviewChoiceStore(context);
        long floor = Math.max(0, op.revision);
        // A missing/uncertain read is not permission to reset: write independently authenticates
        // existing bytes and refuses corruption or a lower durable/process revision.
        try { floor = Math.max(floor, choices.read(record).revision); }
        catch (MessagePreviewChoiceStore.Unavailable missingOrUncertain) { }
        require(floor < MessagePreviewVerificationState.MAX_SAFE_INTEGER);
        long next = floor + 1;
        checkHead(op, vault, record);
        require(choices.write(record, level, op.binding.publicKey, next, () -> checkHead(op, vault, record)));
        checkHead(op, vault, record);
        MessagePreviewChoiceStore.Choice saved = choices.read(record);
        require(saved.revision == next && level.equals(saved.level) && op.binding.publicKey.equals(saved.publicKey)
            && choices.isCurrent(record, saved));
        checkHead(op, vault, record);
    }
    void close() {
        synchronized (session) { synchronized (state) {
            if (closed) return;
            closed = true;
            // Destroying a WebView is not signing out. Keep a completed durable choice for
            // the FCM service, but never grant a pending/unknown result after detach.
            if (!confirmed || pending != null) session.blockContent(scope);
            pending = null; worker.shutdown();
        } }
    }
    private static boolean level(String value) { return "none".equals(value) || "sender".equals(value) || "message".equals(value); }
    private static void require(boolean yes) { if (!yes) throw unavailable(); }
    private static IllegalStateException unavailable() { return new IllegalStateException("UNAVAILABLE", (Throwable) null); }
    private static void reply(Completion completion, boolean accepted) {
        if (completion != null) try { completion.complete(accepted); }
        catch (RuntimeException | Error unknown) { /* Callback uncertainty never replays a completion or operation. */ }
    }
}
