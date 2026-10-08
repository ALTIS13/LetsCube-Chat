package com.kub.messenger;

import android.content.Context;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

// Inactive native-private composition. The genuine passive lifecycle issuer is a future input.
final class MessagePreviewPristineInitializer {
    enum Status { INITIALIZED_EMPTY_G0, UNAVAILABLE }
    static final class InitResult {
        final Status status;
        final Long generation;
        private InitResult(Status status, Long generation) { this.status=status; this.generation=generation; }
    }
    interface Completion { void complete(InitResult result); }
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    private static final InitResult REFUSED = new InitResult(Status.UNAVAILABLE, null);
    private static MessagePreviewPristineInitializer registered;
    private final Context context;
    private final int uid;
    private final MessagePreviewInitializationGate.ForegroundAuthority issuer;
    private final MessagePreviewInitializationGate gate;
    private final Thread worker;
    private Attempt pending;
    private boolean busy;
    private volatile boolean closed;
    private MessagePreviewJournalIO journal;
    private SecretKey metadataKey;
    private InitializedState initialized;
    private TransitionWork pendingTransition, activeTransition;

    private static final long TRANSITION_BUDGET_MILLIS = 10_000;
    enum TransitionStatus { RETIRED, INCOMPLETE, UNAVAILABLE, UNKNOWN, STALE_OWNER, INVALID_REQUEST, EXHAUSTED, BUSY }
    static final class TransitionResult {
        final TransitionStatus status;
        final Long generation;
        private TransitionResult(TransitionStatus status, Long generation) { this.status=status; this.generation=generation; }
    }
    interface TransitionCompletion { void complete(TransitionResult result); }
    private static final class InitializedState {
        final String installation;
        final MessagePreviewJournalIO journal;
        final MessagePreviewVaultFence fence;
        MessagePreviewMetadataEnvelope.Record checkedHead;
        Retirement current;
        boolean uncertain;
        long lastMillis;
        private InitializedState(Prepared prepared) {
            installation=prepared.record.header.installation;
            journal=prepared.journal;
            checkedHead=prepared.record;
            fence=new MessagePreviewVaultFence(checkedHead.header.generation);
        }
    }
    private static final class Retirement {
        final MessagePreviewVaultFence.Operation operation;
        final MessagePreviewMetadataEnvelope.Record predecessor;
        MessagePreviewMetadataEnvelope.Header expectedFinal;
        boolean completed;
        private Retirement(MessagePreviewVaultFence.Operation operation, MessagePreviewMetadataEnvelope.Record predecessor) {
            this.operation=operation; this.predecessor=predecessor;
        }
    }
    private static final class TransitionWork {
        final InitializedState state;
        final Retirement target;
        final boolean observe;
        final long deadline;
        final TransitionCompletion completion;
        boolean cancelled;
        private TransitionWork(InitializedState state, Retirement target, boolean observe, long now,
                               TransitionCompletion completion) {
            this.state=state; this.target=target; this.observe=observe;
            deadline=now+TRANSITION_BUDGET_MILLIS; this.completion=completion;
        }
    }

    private static final class Attempt {
        final MessagePreviewInitializationGate.Permit permit;
        final Completion completion;
        Attempt(MessagePreviewInitializationGate.Permit permit, Completion completion) {
            this.permit=permit; this.completion=completion;
        }
    }
    private static final class Prepared {
        final MessagePreviewJournalIO journal;
        final SecretKey key;
        final MessagePreviewMetadataEnvelope.Record record;
        Prepared(MessagePreviewJournalIO journal, SecretKey key, MessagePreviewMetadataEnvelope.Record record) {
            this.journal=journal; this.key=key; this.record=record;
        }
    }

    static MessagePreviewPristineInitializer getOrCreate(Context supplied,
            MessagePreviewInitializationGate.ForegroundAuthority issuer) throws Unavailable {
        try {
            requireMain();
            if (supplied == null || issuer == null || supplied.isDeviceProtectedStorage()) throw new Unavailable();
            Context application=supplied.getApplicationContext();
            int uid=Process.myUid();
            requireApplication(application, uid);
            MessagePreviewPristineInitializer owner;
            synchronized (MessagePreviewPristineInitializer.class) {
                if (registered != null) {
                    if (registered.context != application || registered.uid != uid || registered.issuer != issuer
                        || registered.closed) throw new Unavailable();
                    return registered;
                }
                owner=new MessagePreviewPristineInitializer(application, uid, issuer);
                registered=owner;
            }
            try { owner.worker.start(); }
            catch (RuntimeException failure) { owner.close(); throw new Unavailable(); }
            return owner;
        } catch (Exception refused) { throw new Unavailable(); }
    }

    private MessagePreviewPristineInitializer(Context context, int uid,
            MessagePreviewInitializationGate.ForegroundAuthority issuer) throws Exception {
        this.context=context; this.uid=uid; this.issuer=issuer;
        worker=new Thread(new Runnable() {
            @Override public void run() { MessagePreviewPristineInitializer.this.work(); }
        }, "NmpvPristineOwner");
        worker.setDaemon(true);
        gate=new MessagePreviewInitializationGate(issuer, new MessagePreviewInitializationGate.MonotonicClock() {
            @Override public long nowMillis() { return SystemClock.elapsedRealtime(); }
        }, Thread.currentThread(), worker);
    }

    private static void requireMain() throws Unavailable {
        if (Looper.getMainLooper() == null || Looper.myLooper() != Looper.getMainLooper()) throw new Unavailable();
    }
    private static void requireApplication(Context context, int uid) throws Unavailable {
        if (uid < 10000 || Process.myUid() != uid || context == null || context.getApplicationContext() != context
            || context.isDeviceProtectedStorage() || context.getApplicationInfo() == null
            || context.getApplicationInfo().uid != uid) throw new Unavailable();
        UserManager manager=context.getSystemService(UserManager.class);
        if (manager == null || !manager.isUserUnlocked()) throw new Unavailable();
    }
    private void current(MessagePreviewInitializationGate.Permit permit) throws Exception {
        gate.currentBeforeEffect(permit);
        requireApplication(context, uid);
        gate.currentBeforeEffect(permit);
    }

    void initializeExplicit(Completion completion) {
        if (completion == null) return;
        try { requireMain(); requireApplication(context, uid); }
        catch (Exception refused) { deliver(completion, REFUSED); return; }
        boolean admitted=false;
        synchronized (this) {
            try {
                if (closed || busy) throw new Unavailable();
                MessagePreviewInitializationGate.Permit permit=gate.admit(gate.capture());
                busy=true;
                pending=new Attempt(permit, completion);
                admitted=true; notifyAll();
            } catch (Exception refused) { /* Fixed refusal, no platform effects or queued successor. */ }
        }
        if (!admitted) deliver(completion, REFUSED);
    }
    synchronized void invalidate() { gate.invalidate(); }
    synchronized void close() {
        closed=true; gate.close();
        if (activeTransition != null) activeTransition.cancelled=true;
        notifyAll();
    }

    // Admission uses only retained checked state. UID/CE/key/record reads belong to the worker.
    void retireExact(String operationId, long vaultRevision, long expectedGeneration,
                     MessagePreviewVaultFence.Correlation correlation, TransitionCompletion completion) {
        if (completion == null) return;
        TransitionStatus status=TransitionStatus.UNAVAILABLE;
        try {
            requireMain();
            long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                if (closed || initialized == null) throw new Unavailable();
                if (busy) status=TransitionStatus.BUSY;
                else if (operationId == null || !operationId.matches("[0-9a-f]{32}")
                    || !MessagePreviewVerificationState.safe(vaultRevision)
                    || !MessagePreviewVerificationState.safe(expectedGeneration)) status=TransitionStatus.INVALID_REQUEST;
                else if (initialized.uncertain) status=TransitionStatus.UNAVAILABLE;
                else if (correlation != null) status=TransitionStatus.INVALID_REQUEST; // No BEGIN in this slice.
                else if (now < initialized.lastMillis || now < 0 || now > Long.MAX_VALUE-TRANSITION_BUDGET_MILLIS)
                    status=TransitionStatus.UNAVAILABLE;
                else if (initialized.checkedHead.header.generation != expectedGeneration)
                    status=TransitionStatus.STALE_OWNER;
                else {
                    MessagePreviewVaultFence.Admission admission=initialized.fence.retire(operationId, vaultRevision, expectedGeneration, null);
                    if (admission.decision == MessagePreviewVaultFence.Decision.RESERVED) {
                        Retirement target=new Retirement(admission.operation, initialized.checkedHead);
                        initialized.current=target; initialized.uncertain=true; initialized.lastMillis=now;
                        queueTransition(new TransitionWork(initialized, target, false, now, completion));
                        return;
                    }
                    status=TransitionStatus.valueOf(admission.decision.name());
                }
            }
        } catch (Exception refused) { /* Fixed refusal without storage or reservation replay. */ }
        deliverTransition(completion, new TransitionResult(status, null));
    }

    void observeRetirement(String operationId, TransitionCompletion completion) {
        if (completion == null) return;
        TransitionStatus status=TransitionStatus.UNAVAILABLE;
        try {
            requireMain();
            long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                if (closed || initialized == null) throw new Unavailable();
                if (busy) status=TransitionStatus.BUSY;
                else if (operationId == null || !operationId.matches("[0-9a-f]{32}")) status=TransitionStatus.INVALID_REQUEST;
                else if (initialized.current == null || !initialized.current.operation.operationId.equals(operationId))
                    status=TransitionStatus.UNKNOWN;
                else if (now < initialized.lastMillis || now < 0 || now > Long.MAX_VALUE-TRANSITION_BUDGET_MILLIS)
                    status=TransitionStatus.UNAVAILABLE;
                else {
                    initialized.lastMillis=now;
                    queueTransition(new TransitionWork(initialized, initialized.current, true, now, completion));
                    return;
                }
            }
        } catch (Exception refused) { /* Observation never reserves a generation or executes a write. */ }
        deliverTransition(completion, new TransitionResult(status, null));
    }
    synchronized void cancelRetirement(String operationId) {
        if (activeTransition != null && activeTransition.target.operation.operationId.equals(operationId))
            activeTransition.cancelled=true;
    }
    private void queueTransition(TransitionWork work) {
        busy=true; activeTransition=work; pendingTransition=work; notifyAll();
    }
    private static void deliverTransition(TransitionCompletion completion, TransitionResult result) {
        try { completion.complete(result); }
        catch (RuntimeException ignored) { /* A checked internal head survives a lost callback. */ }
    }

    private static void deliver(Completion completion, InitResult result) {
        try { completion.complete(result); }
        catch (RuntimeException ignored) { /* A lost callback never authorizes initialization replay. */ }
    }
    private void work() {
        while (true) {
            Attempt attempt;
            TransitionWork transition;
            synchronized (this) {
                while (pending == null && pendingTransition == null && !closed) {
                    try { wait(); }
                    catch (InterruptedException refused) { closed=true; gate.close(); }
                }
                if (pending == null && pendingTransition == null) return;
                attempt=pending; pending=null;
                transition=pendingTransition; pendingTransition=null;
            }
            if (transition != null) { performTransition(transition); continue; }
            InitResult result=REFUSED;
            boolean finished=false;
            try {
                gate.consume(attempt.permit);
                Prepared prepared=initialize(attempt.permit);
                current(attempt.permit);
                synchronized (this) {
                    if (closed) throw new Unavailable();
                    gate.currentBeforeEffect(attempt.permit);
                    gate.finishInitialized(attempt.permit);
                    journal=prepared.journal;
                    metadataKey=prepared.key;
                    initialized=new InitializedState(prepared);
                    finished=true;
                    result=new InitResult(Status.INITIALIZED_EMPTY_G0, 0L);
                }
            } catch (Exception refused) { /* Retain every attempted marker/key/journal residue. */ }
            finally {
                if (!finished) {
                    try { gate.settleFailure(attempt.permit); }
                    catch (Exception refused) { close(); }
                    metadataKey=null;
                }
                // No cancellation/timeout releases this slot while a platform call is still held.
                synchronized (this) { busy=false; }
            }
            deliver(attempt.completion, result);
        }
    }

    private void cleanInventory(KeyStore store, MessagePreviewInitializationGate.Permit permit) throws Exception {
        current(permit);
        MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(store.aliases(), new MessagePreviewOwnedKeyInventory.CurrentCheck() {
            @Override public boolean isCurrent() throws Exception {
                MessagePreviewPristineInitializer.this.current(permit); return true;
            }
        });
        current(permit);
    }
    private void beforeMint(KeyStore store, String alias, MessagePreviewInitializationGate.Permit permit,
            MessagePreviewAtomicBackend.MarkerIO markers, MessagePreviewAtomicBackend.MarkerReservation reservation) throws Exception {
        current(permit); markers.requireCurrent(reservation);
        cleanInventory(store, permit);
        current(permit);
        if (store.containsAlias(alias)) throw new Unavailable();
        current(permit); markers.requireCurrent(reservation);
    }

    private Prepared initialize(MessagePreviewInitializationGate.Permit permit) throws Exception {
        current(permit);
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");
        current(permit); store.load(null); current(permit);
        cleanInventory(store, permit);
        MessagePreviewAtomicBackend.MarkerIO markers=new MessagePreviewAtomicBackend.MarkerIO(context, gate, permit);
        MessagePreviewAtomicBackend.MarkerReservation reservation=markers.reserve();
        current(permit); markers.requireCurrent(reservation);
        String installation=reservation.installation;
        String alias="letscube.nmpv.metadata.v1." + installation;
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        beforeMint(store, alias, permit, markers, reservation);
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false).build());
        beforeMint(store, alias, permit, markers, reservation);
        generator.generateKey();
        current(permit); markers.requireCurrent(reservation);
        SecretKey key=new MessagePreviewKeystoreReader(context, installation).loadMetadata();
        current(permit); markers.requireCurrent(reservation);
        MessagePreviewJournalIO candidate=new MessagePreviewJournalIO(new TransitionBackend(new MessagePreviewAtomicBackend(context)));
        current(permit); markers.requireCurrent(reservation);
        long wall=System.currentTimeMillis();
        if (!MessagePreviewVerificationState.safe(wall)) throw new Unavailable();
        MessagePreviewMetadataEnvelope.Header header=new MessagePreviewMetadataEnvelope.Header(
            installation, 0, MessagePreviewMetadataEnvelope.Kind.EMPTY, "", 0, wall, "", 0, 0);
        byte[] bytes=MessagePreviewMetadataEnvelope.seal(header, new byte[0], key);
        current(permit); markers.requireCurrent(reservation);
        if (candidate.write(bytes, installation, key) != MessagePreviewJournalIO.Result.CHECKED) throw new Unavailable();
        current(permit); markers.requireCurrentAfterInitialJournal(reservation);
        MessagePreviewMetadataEnvelope.Record readback=candidate.read(installation, key);
        current(permit); markers.requireCurrentAfterInitialJournal(reservation);
        MessagePreviewMetadataEnvelope.Header h=readback.header;
        if (!installation.equals(h.installation) || h.generation != 0 || h.kind != MessagePreviewMetadataEnvelope.Kind.EMPTY
            || !h.alias.isEmpty() || h.expiresWallMillis != 0 || h.wallHighWaterMillis != wall
            || !h.operationId.isEmpty() || h.baseGeneration != 0 || h.vaultRevision != 0
            || readback.credentialBytes().length != 0) throw new Unavailable();
        return new Prepared(candidate, key, readback);
    }

    private final class TransitionBackend implements MessagePreviewJournalIO.Backend {
        private final MessagePreviewAtomicBackend delegate;
        private TransitionBackend(MessagePreviewAtomicBackend delegate) { this.delegate=delegate; }
        @Override public InputStream openRead() throws IOException { return delegate.openRead(); }
        @Override public OutputStream startWrite() throws IOException {
            TransitionWork work;
            synchronized (MessagePreviewPristineInitializer.this) {
                work=activeTransition;
                if (initialized != null && work == null) throw new IOException("UNAVAILABLE", (Throwable) null);
            }
            // Kernel prewrite authentication can block before any storage effect.
            try { if (work != null) transitionCurrent(work); }
            catch (Exception refused) { throw new IOException("UNAVAILABLE", (Throwable) null); }
            return delegate.startWrite();
        }
        @Override public void sync(OutputStream stream) throws IOException { delegate.sync(stream); }
        @Override public void finishWrite(OutputStream stream) throws IOException { delegate.finishWrite(stream); }
        @Override public void failWrite(OutputStream stream) throws IOException { delegate.failWrite(stream); }
    }

    private void transitionMemory(TransitionWork work, long now) throws Unavailable {
        if (Thread.currentThread() != worker || closed || !busy || activeTransition != work
            || initialized != work.state || initialized.current != work.target || work.cancelled
            || now < work.state.lastMillis || now < 0 || now >= work.deadline
            || (!work.state.fence.canErase(work.target.operation) && !(work.observe && work.target.completed)))
            throw new Unavailable();
        work.state.lastMillis=now;
    }
    private void transitionCurrent(TransitionWork work) throws Exception {
        long now=SystemClock.elapsedRealtime();
        synchronized (this) { transitionMemory(work, now); }
        requireApplication(context, uid);
        now=SystemClock.elapsedRealtime();
        synchronized (this) { transitionMemory(work, now); }
    }
    private SecretKey transitionKey(TransitionWork work) throws Exception {
        transitionCurrent(work);
        SecretKey key=new MessagePreviewKeystoreReader(context, work.state.installation).loadMetadata();
        transitionCurrent(work);
        return key;
    }
    private static boolean sameHeader(MessagePreviewMetadataEnvelope.Header a, MessagePreviewMetadataEnvelope.Header b) {
        return a != null && b != null && a.installation.equals(b.installation) && a.generation == b.generation
            && a.kind == b.kind && a.alias.equals(b.alias) && a.expiresWallMillis == b.expiresWallMillis
            && a.wallHighWaterMillis == b.wallHighWaterMillis && a.operationId.equals(b.operationId)
            && a.baseGeneration == b.baseGeneration && a.vaultRevision == b.vaultRevision;
    }
    private void performTransition(TransitionWork work) {
        TransitionResult result=new TransitionResult(TransitionStatus.INCOMPLETE, null);
        boolean finished=false;
        try {
            MessagePreviewMetadataEnvelope.Record readback;
            if (work.observe) {
                SecretKey key=transitionKey(work);
                readback=work.state.journal.read(work.state.installation, key);
                transitionCurrent(work);
            } else readback=writeRetirement(work);
            if (!sameHeader(readback.header, work.target.expectedFinal) || readback.credentialBytes().length != 0)
                throw new Unavailable();
            transitionKey(work); // A retained Java key reference alone is not current key availability.
            long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                transitionMemory(work, now);
                if (!work.target.completed && !work.state.fence.complete(work.target.operation)) throw new Unavailable();
                work.target.completed=true; work.state.checkedHead=readback; work.state.uncertain=false;
                finished=true;
                result=new TransitionResult(TransitionStatus.RETIRED, readback.header.generation);
            }
        } catch (Exception refused) { /* Unknown/partial bytes retain exact correlation, never reset/replay. */ }
        finally {
            synchronized (this) {
                if (!finished && initialized == work.state && work.state.current == work.target) work.state.uncertain=true;
                if (activeTransition == work) { activeTransition=null; busy=false; }
            }
        }
        // Historical checked operation only, not a current capability or credential lease.
        deliverTransition(work.completion, result);
    }
    private MessagePreviewMetadataEnvelope.Record writeRetirement(TransitionWork work) throws Exception {
        SecretKey key=transitionKey(work);
        MessagePreviewMetadataEnvelope.Record predecessor=work.state.journal.read(work.state.installation, key);
        transitionCurrent(work);
        if (!sameHeader(predecessor.header, work.target.predecessor.header)
            || !Arrays.equals(predecessor.credentialBytes(), work.target.predecessor.credentialBytes())
            || predecessor.header.kind != MessagePreviewMetadataEnvelope.Kind.EMPTY
            || !predecessor.header.alias.isEmpty() || predecessor.credentialBytes().length != 0
            || predecessor.header.generation != work.target.operation.baseGeneration) throw new Unavailable();
        long wall=System.currentTimeMillis();
        if (!MessagePreviewVerificationState.safe(wall)) throw new Unavailable();
        wall=Math.max(wall, predecessor.header.wallHighWaterMillis);
        MessagePreviewVaultFence.Operation operation=work.target.operation;
        MessagePreviewMetadataEnvelope.Header empty=new MessagePreviewMetadataEnvelope.Header(work.state.installation,
            operation.generation, MessagePreviewMetadataEnvelope.Kind.EMPTY, "", 0, wall, operation.operationId,
            operation.baseGeneration, operation.vaultRevision);
        transitionCurrent(work);
        work.target.expectedFinal=empty;
        MessagePreviewMetadataEnvelope.Header retiring=new MessagePreviewMetadataEnvelope.Header(work.state.installation,
            operation.generation, MessagePreviewMetadataEnvelope.Kind.RETIRING, "", 0, wall, operation.operationId,
            operation.baseGeneration, operation.vaultRevision);
        writeTransitionRecord(work, retiring);
        writeTransitionRecord(work, empty);
        key=transitionKey(work);
        MessagePreviewMetadataEnvelope.Record result=work.state.journal.read(work.state.installation, key);
        transitionCurrent(work);
        return result;
    }
    private void writeTransitionRecord(TransitionWork work, MessagePreviewMetadataEnvelope.Header header) throws Exception {
        SecretKey key=transitionKey(work);
        byte[] bytes=MessagePreviewMetadataEnvelope.seal(header, new byte[0], key);
        transitionCurrent(work);
        // An entered kernel write may finish despite cancellation; no next write/ACK follows a stale return.
        if (work.state.journal.write(bytes, work.state.installation, key) != MessagePreviewJournalIO.Result.CHECKED)
            throw new Unavailable();
        transitionCurrent(work);
    }
}
