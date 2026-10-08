package com.kub.messenger;

import android.content.Context;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
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
        Prepared(MessagePreviewJournalIO journal, SecretKey key) { this.journal=journal; this.key=key; }
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
    synchronized void close() { closed=true; gate.close(); notifyAll(); }

    private static void deliver(Completion completion, InitResult result) {
        try { completion.complete(result); }
        catch (RuntimeException ignored) { /* A lost callback never authorizes initialization replay. */ }
    }
    private void work() {
        while (true) {
            Attempt attempt;
            synchronized (this) {
                while (pending == null && !closed) {
                    try { wait(); }
                    catch (InterruptedException refused) { closed=true; gate.close(); }
                }
                if (pending == null) return;
                attempt=pending; pending=null;
            }
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
        MessagePreviewJournalIO candidate=new MessagePreviewJournalIO(new MessagePreviewAtomicBackend(context));
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
        return new Prepared(candidate, key);
    }
}
