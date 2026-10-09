package com.kub.messenger;

import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Process;
import android.os.SystemClock;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

// Inactive conditional port. The future sole owner supplies journal provenance and live Gate authority.
final class MessagePreviewCredentialKeyCustody {
    private static final String OWNED_PREFIX = "letscube.nmpv.";
    private static final String CREDENTIAL_PREFIX = "letscube.nmpv.credential.v1.";
    private static final String METADATA_PREFIX = "letscube.nmpv.metadata.v1.";
    interface Gate { void requireCurrent(Request exactRequest) throws Exception; }
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    static final class Request {
        final MessagePreviewCredentialKeyCustody custody;
        final MessagePreviewVaultFence fence;
        final MessagePreviewVaultFence.Operation operation;
        final MessagePreviewVaultFence.Operation unmaterializedAllocation;
        final MessagePreviewMetadataEnvelope.Record retainedPredecessor, expectedHead;
        final long admittedAtElapsedMillis, deadlineElapsedMillis;
        private boolean consumed;
        private long lastElapsed;
        Request(MessagePreviewCredentialKeyCustody custody, MessagePreviewVaultFence fence,
                MessagePreviewVaultFence.Operation operation, MessagePreviewMetadataEnvelope.Record retainedPredecessor,
                MessagePreviewMetadataEnvelope.Record expectedHead, long admittedAtElapsedMillis,
                long deadlineElapsedMillis) throws Unavailable {
            this(custody, fence, operation, retainedPredecessor, expectedHead, admittedAtElapsedMillis, deadlineElapsedMillis, null);
        }
        private Request(MessagePreviewCredentialKeyCustody custody, MessagePreviewVaultFence fence,
                MessagePreviewVaultFence.Operation operation, MessagePreviewMetadataEnvelope.Record retainedPredecessor,
                MessagePreviewMetadataEnvelope.Record expectedHead, long admittedAtElapsedMillis,
                long deadlineElapsedMillis, MessagePreviewVaultFence.Operation abandoned) throws Unavailable {
            require(custody != null && fence != null && operation != null && retainedPredecessor != null && expectedHead != null);
            require(admittedAtElapsedMillis >= 0 && deadlineElapsedMillis > admittedAtElapsedMillis
                && deadlineElapsedMillis - admittedAtElapsedMillis <= 10000);
            this.custody = custody; this.fence = fence; this.operation = operation;
            this.retainedPredecessor = retainedPredecessor; this.expectedHead = expectedHead;
            unmaterializedAllocation = abandoned;
            this.admittedAtElapsedMillis = admittedAtElapsedMillis; this.deadlineElapsedMillis = deadlineElapsedMillis;
            lastElapsed = admittedAtElapsedMillis;
            custody.shape(this);
        }
        static Request retireUnmaterialized(MessagePreviewCredentialKeyCustody custody, MessagePreviewVaultFence fence,
                MessagePreviewVaultFence.Operation retire, MessagePreviewMetadataEnvelope.Record predecessor,
                MessagePreviewVaultFence.Operation abandoned, MessagePreviewMetadataEnvelope.Record retiring,
                long admitted, long deadline) throws Unavailable {
            require(abandoned != null);
            return new Request(custody, fence, retire, predecessor, retiring, admitted, deadline, abandoned);
        }
    }
    private final Context application;
    private final int expectedUid;
    private final Thread soleWorker;
    private final String installation, metadataAlias;
    private final MessagePreviewJournalIO journal;
    private final Gate gate;

    MessagePreviewCredentialKeyCustody(Context application, int expectedUid, Thread soleWorker, String installation,
            MessagePreviewJournalIO preparedJournal, Gate suppliedGate) throws Unavailable {
        require(application != null && expectedUid >= 10000 && soleWorker != null && hex32(installation)
            && preparedJournal != null && suppliedGate != null);
        this.application = application; this.expectedUid = expectedUid; this.soleWorker = soleWorker;
        this.installation = installation; metadataAlias = METADATA_PREFIX + installation;
        journal = preparedJournal; gate = suppliedGate;
    }
    private static void require(boolean value) throws Unavailable { if (!value) throw new Unavailable(); }
    private static boolean safe(long value) { return MessagePreviewVerificationState.safe(value); }
    private static boolean hex32(String value) {
        if (value == null || value.length() != 32) return false;
        for (int i = 0; i < 32; i++) {
            char c = value.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }
    private boolean alias(String value) {
        String prefix = CREDENTIAL_PREFIX + installation + ".";
        return value != null && value.length() == prefix.length() + 32 && value.startsWith(prefix)
            && hex32(value.substring(prefix.length()));
    }
    private void shape(Request r) throws Unavailable {
        require(r.custody == this);
        MessagePreviewMetadataEnvelope.Header h = r.expectedHead.header, p = r.retainedPredecessor.header;
        MessagePreviewVaultFence.Operation op = r.operation;
        require(h != null && p != null && installation.equals(h.installation) && installation.equals(p.installation)
            && h.kind != null && safe(h.generation) && h.generation > 0 && safe(h.baseGeneration)
            && h.baseGeneration < 9007199254740991L && h.generation == h.baseGeneration + 1
            && safe(h.vaultRevision) && safe(h.expiresWallMillis) && h.expiresWallMillis == 0
            && safe(h.wallHighWaterMillis) && hex32(h.operationId)
            && h.generation == op.generation && h.baseGeneration == op.baseGeneration
            && h.operationId.equals(op.operationId) && h.vaultRevision == op.vaultRevision
            && r.expectedHead.credentialBytes().length == 0);
        if (r.unmaterializedAllocation == null) require(p.generation == op.baseGeneration);
        else {
            MessagePreviewVaultFence.Operation a = r.unmaterializedAllocation;
            require(op.kind == MessagePreviewVaultFence.Kind.RETIRE && h.kind == MessagePreviewMetadataEnvelope.Kind.RETIRING
                && (a.kind == MessagePreviewVaultFence.Kind.BEGIN || a.kind == MessagePreviewVaultFence.Kind.REFUSED)
                && safe(a.baseGeneration) && a.baseGeneration < 9007199254740991L && safe(a.generation)
                && p.generation == a.baseGeneration && a.generation == a.baseGeneration + 1
                && a.generation == op.baseGeneration && op.generation == op.baseGeneration + 1
                && hex32(a.operationId) && !a.operationId.equals(op.operationId)
                && safe(a.vaultRevision) && op.vaultRevision > a.vaultRevision);
        }
        require((h.kind == MessagePreviewMetadataEnvelope.Kind.PENDING && alias(h.alias))
            || (h.kind == MessagePreviewMetadataEnvelope.Kind.RETIRING && (h.alias.isEmpty() || alias(h.alias))));
        require(p.alias.isEmpty() || alias(p.alias));
        if (h.kind == MessagePreviewMetadataEnvelope.Kind.RETIRING) require(h.alias.equals(p.alias));
        else require(p.alias.isEmpty() || !h.alias.equals(p.alias));
    }
    private void consume(Request r) throws Unavailable {
        require(r != null && r.custody == this);
        synchronized (r) { require(!r.consumed); r.consumed = true; }
    }
    private void memory(Request r) throws Exception {
        require(r.custody == this && Thread.currentThread() == soleWorker);
        gate.requireCurrent(r);
        require(r.operation.kind == MessagePreviewVaultFence.Kind.BEGIN
            ? r.fence.canContinue(r.operation) : r.fence.canErase(r.operation));
    }
    private void current(Request r) throws Exception {
        memory(r);
        long now = SystemClock.elapsedRealtime();
        memory(r); // A platform clock read can also return after retirement.
        synchronized (r) {
            require(now >= r.admittedAtElapsedMillis && now >= r.lastElapsed && now < r.deadlineElapsedMillis);
            r.lastElapsed = now;
        }
    }
    private void platform(Request r) throws Exception {
        current(r); int uid = Process.myUid(); current(r);
        require(uid == expectedUid && application instanceof Application);
        Context actual = application.getApplicationContext(); current(r); require(actual == application);
        ApplicationInfo info = application.getApplicationInfo(); current(r); require(info != null && info.uid == expectedUid);
        boolean protectedStorage = application.isDeviceProtectedStorage(); current(r); require(!protectedStorage);
        UserManager manager = application.getSystemService(UserManager.class); current(r); require(manager != null);
        boolean unlocked = manager.isUserUnlocked(); current(r); require(unlocked);
    }
    private static boolean equal(MessagePreviewMetadataEnvelope.Record actual, MessagePreviewMetadataEnvelope.Record expected) {
        MessagePreviewMetadataEnvelope.Header a = actual.header, b = expected.header;
        return a.installation.equals(b.installation) && a.generation == b.generation && a.kind == b.kind
            && a.alias.equals(b.alias) && a.expiresWallMillis == b.expiresWallMillis
            && a.wallHighWaterMillis == b.wallHighWaterMillis && a.operationId.equals(b.operationId)
            && a.baseGeneration == b.baseGeneration && a.vaultRevision == b.vaultRevision
            && Arrays.equals(actual.credentialBytes(), expected.credentialBytes());
    }
    private void snapshot(Request r) throws Exception {
        platform(r);
        MessagePreviewKeystoreReader reader = new MessagePreviewKeystoreReader(application, installation); current(r);
        SecretKey metadata = reader.loadMetadata(); current(r);
        MessagePreviewMetadataEnvelope.Record actual = journal.read(installation, metadata); current(r);
        require(equal(actual, r.expectedHead));
        platform(r);
    }
    private KeyStore store(Request r) throws Exception {
        platform(r);
        KeyStore value = KeyStore.getInstance("AndroidKeyStore"); current(r);
        value.load(null); current(r);
        return value;
    }
    private void inventory(Request r, KeyStore store, String permittedCredential) throws Exception {
        current(r); Enumeration<String> aliases = store.aliases(); current(r); require(aliases != null);
        Set<String> seen = new HashSet<>(); boolean metadata = false; int count = 0;
        while (true) {
            current(r); boolean more = aliases.hasMoreElements(); current(r);
            if (!more) { require(metadata); current(r); return; }
            require(count < 256);
            current(r); String value = aliases.nextElement(); current(r); count++;
            require(value != null && value.length() <= 256 && seen.add(value));
            if (metadataAlias.equals(value)) metadata = true;
            if (value.startsWith(OWNED_PREFIX)) require(metadataAlias.equals(value) || value.equals(permittedCredential));
        }
    }
    private boolean contains(Request r, KeyStore store, String alias) throws Exception {
        current(r); boolean present = store.containsAlias(alias); current(r); return present;
    }
    private void beforeCreate(Request r, KeyStore store) throws Exception {
        snapshot(r); inventory(r, store, null);
        require(!contains(r, store, r.expectedHead.header.alias));
        platform(r);
    }

    SecretKey createPendingKey(Request request) throws Unavailable {
        consume(request);
        try {
            require(request.unmaterializedAllocation == null && request.operation.kind == MessagePreviewVaultFence.Kind.BEGIN
                && request.expectedHead.header.kind == MessagePreviewMetadataEnvelope.Kind.PENDING);
            current(request);
            KeyStore store = store(request);
            beforeCreate(request, store);
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"); current(request);
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(request.expectedHead.header.alias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false).build(); current(request);
            beforeCreate(request, store);
            generator.init(spec); current(request);
            beforeCreate(request, store); // Held init must not overwrite a newly present candidate/namespace.
            generator.generateKey(); current(request);
            snapshot(request); inventory(request, store, request.expectedHead.header.alias);
            require(contains(request, store, request.expectedHead.header.alias));
            platform(request);
            MessagePreviewKeystoreReader reader = new MessagePreviewKeystoreReader(application, installation); current(request);
            SecretKey result = reader.loadCredential(request.expectedHead.header.alias); current(request);
            snapshot(request); inventory(request, store, request.expectedHead.header.alias);
            require(contains(request, store, request.expectedHead.header.alias)); // Confirm alias survived the borrowed-handle readback.
            platform(request);
            return result;
        } catch (Exception refused) { throw new Unavailable(); }
    }

    void deleteRetiringKey(Request request) throws Unavailable {
        consume(request);
        try {
            require(request.expectedHead.header.kind == MessagePreviewMetadataEnvelope.Kind.RETIRING);
            current(request);
            KeyStore store = store(request);
            snapshot(request);
            String exactAlias = request.expectedHead.header.alias;
            inventory(request, store, exactAlias.isEmpty() ? null : exactAlias);
            if (!exactAlias.isEmpty() && contains(request, store, exactAlias)) {
                snapshot(request); inventory(request, store, exactAlias); platform(request);
                current(request); store.deleteEntry(exactAlias); current(request);
            }
            if (!exactAlias.isEmpty()) require(!contains(request, store, exactAlias));
            snapshot(request); inventory(request, store, null); platform(request);
        } catch (Exception refused) { throw new Unavailable(); }
    }
}
