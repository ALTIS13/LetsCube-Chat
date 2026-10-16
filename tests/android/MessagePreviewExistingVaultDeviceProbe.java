package com.kub.messenger;

import android.app.Application;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import android.os.Looper;
import android.os.Process;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.File;
import java.io.FileDescriptor;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Isolated self-targeting device test. All payloads are fictional and stay native. */
public final class MessagePreviewExistingVaultDeviceProbe extends Instrumentation {
    private static final String PACKAGE = "com.letscube.qa.previewvault20261016";
    private static final String INSTALL = "11111111111111111111111111111111";
    private static final String OP = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String META = "letscube.nmpv.metadata.v1." + INSTALL;
    private static final String CREDENTIAL = "letscube.nmpv.credential.v1." + INSTALL + "." + OP;
    private static final String WRONG = "letscube.nmpv.credential.v1." + INSTALL + ".bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String ACCESS = "FICTIONAL-NATIVE-QA-NOT-A-CREDENTIAL";
    private Context app;
    private File namespace, marker, journal;
    private KeyStore store;
    private SecretKey metadataKey, credentialKey, wrongKey;
    private long now, expires;
    private int checks, fdBefore, fdAfter, fdReads;
    private String requested;
    private String phase = "START";
    private boolean ownContext, fixturePresent;
    private final MessagePreviewVaultFence.Owner owner = new MessagePreviewVaultFence.Owner(
        "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333", 3);

    private static final class Failed extends RuntimeException {
        private static final long serialVersionUID = 1L;
        Failed() { super("QA_REFUSED", null, false, false); }
    }
    private static final class CallbackFailure extends RuntimeException {
        private static final long serialVersionUID = 1L;
        CallbackFailure() { super("QA_CALLBACK", null, false, false); }
    }
    private interface Action { void run() throws Exception; }
    private static void require(boolean yes) { if (!yes) throw new Failed(); }
    private void pass() { checks++; }
    private void refuses(Action action) throws Exception {
        try { action.run(); }
        catch (MessagePreviewExistingVault.Unavailable | MessagePreviewKeystoreReader.Unavailable
                | MessagePreviewCredentialEnvelope.Unavailable expected) { pass(); return; }
        throw new Failed();
    }
    @Override public void onCreate(Bundle arguments) {
        phase = "ARGUMENTS";
        try {
            require(arguments != null && arguments.keySet().size() == 1 && arguments.containsKey("phase"));
            requested = arguments.getString("phase");
            require("seed".equals(requested) || "resume".equals(requested));
            require(Looper.getMainLooper() != null);
        } catch (Throwable refused) { finish(0, result(false)); return; }
        start();
    }
    @Override public void onStart() {
        boolean passed = false;
        try { runProbe(); passed = true; }
        catch (Throwable refused) { /* Never expose native exception text, identifiers or payloads. */ }
        finish(passed ? -1 : 0, result(passed));
    }
    private Bundle result(boolean passed) {
        Bundle b = new Bundle();
        b.putString("status", passed ? ("seed".equals(requested) ? "PASS_SEEDED_EXISTING_VAULT" : "PASS_EXISTING_VAULT_ONLY") : "REFUSED");
        b.putString("phase", phase); b.putInt("checks", checks);
        b.putInt("pid", Process.myPid()); b.putInt("fdReads", fdReads); b.putInt("fdBefore", fdBefore); b.putInt("fdAfter", fdAfter);
        b.putBoolean("ownContext", ownContext); b.putBoolean("fixtureRetained", fixturePresent);
        b.putBoolean("authPerformed", false); b.putBoolean("networkPerformed", false);
        b.putBoolean("notificationDeliveryProven", false); return b;
    }
    private void context() {
        require(Looper.getMainLooper() != null && Looper.myLooper() != Looper.getMainLooper());
        require(PACKAGE.equals(getContext().getPackageName()) && PACKAGE.equals(getTargetContext().getPackageName()));
        app = getTargetContext().getApplicationContext();
        require(app != null && app.getClass() == Application.class && app.getApplicationContext() == app
            && PACKAGE.equals(app.getPackageName()) && !app.isDeviceProtectedStorage()
            && app.getApplicationInfo().uid == Process.myUid() && Process.myUid() >= 10000 && Process.myUid() < 100000);
        UserManager users = app.getSystemService(UserManager.class);
        require(users != null && users.isUserUnlocked()); ownContext = true; pass();
    }
    private static boolean absent(File file) throws Exception {
        try { Os.lstat(file.getPath()); return false; }
        catch (ErrnoException e) { if (e.errno == OsConstants.ENOENT) return true; throw e; }
    }
    private void own(File file, boolean directory, int mode) throws Exception {
        require(file.equals(file.getCanonicalFile())); StructStat stat = Os.lstat(file.getPath());
        require(stat.st_uid == Process.myUid() && (directory ? OsConstants.S_ISDIR(stat.st_mode) : OsConstants.S_ISREG(stat.st_mode))
            && (mode < 0 || (stat.st_mode & 07777) == mode));
    }
    private void write(File file, byte[] bytes, boolean createOnly) throws Exception {
        require(file.getParentFile().equals(namespace)); own(namespace, true, 0700);
        if (createOnly) require(absent(file)); else own(file, false, 0600);
        int flags = OsConstants.O_WRONLY | OsConstants.O_NOFOLLOW
            | (createOnly ? OsConstants.O_CREAT | OsConstants.O_EXCL : OsConstants.O_TRUNC);
        FileDescriptor fd = Os.open(file.getPath(), flags, 0600);
        try {
            Os.fchmod(fd, 0600); int offset = 0;
            while (offset < bytes.length) { int n = Os.write(fd, bytes, offset, bytes.length - offset); require(n > 0); offset += n; }
            Os.fsync(fd);
        } finally { Os.close(fd); }
        own(file, false, 0600);
    }
    private byte[] read(File file) throws Exception {
        require(file.getParentFile().equals(namespace)); own(file, false, 0600);
        long size = Os.lstat(file.getPath()).st_size; require(size >= 0 && size <= 16384);
        byte[] result = new byte[(int) size]; FileDescriptor fd = Os.open(file.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW, 0);
        try {
            int offset = 0;
            while (offset < result.length) { int n = Os.read(fd, result, offset, result.length - offset); require(n > 0); offset += n; }
            require(Os.read(fd, new byte[1], 0, 1) == 0);
        } finally { Os.close(fd); }
        return result;
    }
    private final class Snapshot {
        private final byte[] markerBytes = read(marker), journalBytes = read(journal);
        private final String[] children = children();
        private final long markerInode = Os.lstat(marker.getPath()).st_ino, journalInode = Os.lstat(journal.getPath()).st_ino;
        Snapshot() throws Exception { }
        void unchanged() throws Exception {
            require(Arrays.equals(markerBytes, read(marker)) && Arrays.equals(journalBytes, read(journal))
                && Arrays.equals(children, children()) && Os.lstat(marker.getPath()).st_ino == markerInode
                && Os.lstat(journal.getPath()).st_ino == journalInode);
        }
    }
    private String[] children() {
        String[] names = namespace.list(); require(names != null); Arrays.sort(names); return names;
    }
    private SecretKey mint(String alias) throws Exception {
        require(!store.containsAlias(alias));
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(false).build());
        return generator.generateKey();
    }
    private MessagePreviewMetadataEnvelope.Header header(MessagePreviewMetadataEnvelope.Kind kind, long generation, long revision) {
        return new MessagePreviewMetadataEnvelope.Header(INSTALL, generation, kind,
            kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED || kind == MessagePreviewMetadataEnvelope.Kind.PENDING ? CREDENTIAL : "",
            kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED ? expires : 0, now - 1000, OP, generation - 1, revision);
    }
    private void seed(MessagePreviewMetadataEnvelope.Kind kind) throws Exception {
        MessagePreviewMetadataEnvelope.Header h = header(kind, 9, 47);
        byte[] credential = kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED
            ? MessagePreviewCredentialEnvelope.seal(h, owner, ACCESS, expires, credentialKey) : new byte[0];
        try { write(journal, MessagePreviewMetadataEnvelope.seal(h, credential, metadataKey), absent(journal)); }
        finally { Arrays.fill(credential, (byte) 0); }
    }
    private MessagePreviewMetadataEnvelope.Record altered(MessagePreviewMetadataEnvelope.Header h, byte[] blob) throws Exception {
        return MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(h, blob, metadataKey), INSTALL, metadataKey);
    }
    private static boolean zero(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return false;
        for (byte value : bytes) if (value != 0) return false; return true;
    }
    private void consume(MessagePreviewMetadataEnvelope.Record record) throws Exception {
        MessagePreviewKeystoreReader keys = new MessagePreviewKeystoreReader(app, INSTALL);
        SecretKey loaded = keys.loadCredential(record.header.alias);
        byte[][] borrowed = {null}; int[] calls = {0};
        MessagePreviewCredentialEnvelope.consume(record, record.header, loaded, (actual, access, expiry) -> {
            calls[0]++; borrowed[0] = access;
            require(owner.recipient.equals(actual.recipient) && owner.session.equals(actual.session)
                && owner.device.equals(actual.device) && actual.accountEpoch == 3 && expiry == expires
                && Arrays.equals(access, ACCESS.getBytes(StandardCharsets.US_ASCII)));
        });
        require(calls[0] == 1 && zero(borrowed[0])); pass();
        calls[0] = 0; borrowed[0] = null; CallbackFailure expected = new CallbackFailure(); boolean propagated = false;
        try {
            MessagePreviewCredentialEnvelope.consume(record, record.header, loaded, (actual, access, expiry) -> {
                calls[0]++; borrowed[0] = access; throw expected;
            });
        } catch (CallbackFailure failure) { propagated = failure == expected; }
        require(propagated && calls[0] == 1 && zero(borrowed[0])); pass();
        MessagePreviewCredentialEnvelope.Consumer never = (actual, access, expiry) -> { throw new Failed(); };
        refuses(() -> MessagePreviewCredentialEnvelope.consume(record, header(MessagePreviewMetadataEnvelope.Kind.COMMITTED, 9, 48), loaded, never));
        refuses(() -> MessagePreviewCredentialEnvelope.consume(record, record.header, wrongKey, never));
        byte[] corrupt = record.credentialBytes(); corrupt[corrupt.length - 1] ^= 1;
        MessagePreviewMetadataEnvelope.Record corrupted = altered(record.header, corrupt); Arrays.fill(corrupt, (byte) 0);
        refuses(() -> MessagePreviewCredentialEnvelope.consume(corrupted, corrupted.header, loaded, never));
    }
    private void runProbe() throws Exception {
        phase = "CONTEXT"; context();
        File root = app.getNoBackupFilesDir().getCanonicalFile(); own(root, true, -1);
        namespace = new File(root, "native-message-previews-v1");
        marker = new File(namespace, "installation-v1.bin"); journal = new File(namespace, "journal-v1.bin");
        if ("seed".equals(requested)) seedFixture();
        else {
            phase = "EXISTING_ONLY"; own(namespace, true, 0700); own(marker, false, 0600); own(journal, false, 0600);
            require(Os.lstat(marker.getPath()).st_size == 28); fixturePresent = true;
            store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        }
        phase = "COMMITTED"; Snapshot intact = new Snapshot();
        MessagePreviewExistingVault first = MessagePreviewExistingVault.open(app);
        MessagePreviewMetadataEnvelope.Record authenticated = first.readAuthenticated();
        require(authenticated.header.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED
            && authenticated.header.generation == 9 && authenticated.header.vaultRevision == 47
            && authenticated.header.installation.equals(INSTALL) && authenticated.header.alias.equals(CREDENTIAL));
        now = System.currentTimeMillis(); expires = authenticated.header.expiresWallMillis;
        MessagePreviewMetadataEnvelope.Record committed = first.readCommitted(now);
        require(committed.header.generation == 9 && committed.header.vaultRevision == 47 && first.isCurrent(committed, now)); pass();
        MessagePreviewExistingVault cold = MessagePreviewExistingVault.open(app);
        MessagePreviewMetadataEnvelope.Record fresh = cold.readCommitted(now);
        require(fresh.header.generation == 9 && fresh.header.vaultRevision == 47 && cold.isCurrent(committed, now)); intact.unchanged(); pass();
        MessagePreviewKeystoreReader keyReader = new MessagePreviewKeystoreReader(app, INSTALL);
        metadataKey = keyReader.loadMetadata(); credentialKey = keyReader.loadCredential(CREDENTIAL);
        require(store.containsAlias(WRONG)); wrongKey = keyReader.loadCredential(WRONG);
        phase = "CONSUME"; consume(committed); intact.unchanged();
        if ("seed".equals(requested)) {
            phase = "FD_READS"; fdBefore = fdCount();
            for (int i = 0; i < 20; i++) {
                MessagePreviewMetadataEnvelope.Record read = MessagePreviewExistingVault.open(app).readCommitted(now);
                require(read.header.generation == 9 && read.header.vaultRevision == 47); fdReads++;
            }
            fdAfter = fdCount(); require(fdReads == 20 && fdBefore == fdAfter); intact.unchanged(); pass();
            phase = "SEEDED"; return;
        }
        negatives(cold, committed);
    }
    private void seedFixture() throws Exception {
        phase = "SEED_ONLY"; now = System.currentTimeMillis(); expires = now + 600000;
        require(absent(namespace)); Os.mkdir(namespace.getPath(), 0700); own(namespace, true, 0700); fixturePresent = true;
        byte[] nonce = new byte[16]; Arrays.fill(nonce, (byte) 0x11);
        byte[] encoded = MessagePreviewInstallationMarker.encode(nonce); require(encoded.length == 28);
        write(marker, encoded, true); Arrays.fill(encoded, (byte) 0); Arrays.fill(nonce, (byte) 0); pass();
        phase = "KEYS"; store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        require(!store.containsAlias(META) && !store.containsAlias(CREDENTIAL) && !store.containsAlias(WRONG));
        metadataKey = mint(META); credentialKey = mint(CREDENTIAL); wrongKey = mint(WRONG);
        MessagePreviewKeystoreReader keyReader = new MessagePreviewKeystoreReader(app, INSTALL);
        keyReader.loadMetadata(); keyReader.loadCredential(CREDENTIAL); pass();
        seed(MessagePreviewMetadataEnvelope.Kind.COMMITTED);
    }
    private void negatives(MessagePreviewExistingVault cold, MessagePreviewMetadataEnvelope.Record committed) throws Exception {
        Snapshot intact = new Snapshot();
        phase = "WRONG_HEAD";
        MessagePreviewMetadataEnvelope.Record wrong = altered(header(MessagePreviewMetadataEnvelope.Kind.COMMITTED, 10, 48), committed.credentialBytes());
        require(!cold.isCurrent(wrong, now)); intact.unchanged(); pass();
        phase = "CLOCK"; refuses(() -> cold.readCommitted(committed.header.wallHighWaterMillis - 1)); refuses(() -> cold.readCommitted(expires)); intact.unchanged();
        phase = "STATES";
        for (MessagePreviewMetadataEnvelope.Kind kind : new MessagePreviewMetadataEnvelope.Kind[] {
                MessagePreviewMetadataEnvelope.Kind.EMPTY, MessagePreviewMetadataEnvelope.Kind.PENDING, MessagePreviewMetadataEnvelope.Kind.RETIRING}) {
            seed(kind); Snapshot state = new Snapshot(); MessagePreviewExistingVault existing = MessagePreviewExistingVault.open(app);
            require(existing.readAuthenticated().header.kind == kind && !existing.isCurrent(committed, now));
            refuses(() -> existing.readCommitted(now)); state.unchanged();
        }
        phase = "CORRUPT"; seed(MessagePreviewMetadataEnvelope.Kind.COMMITTED);
        byte[] damaged = read(journal); damaged[damaged.length - 1] ^= 1; write(journal, damaged, false); Arrays.fill(damaged, (byte) 0);
        Snapshot corrupt = new Snapshot(); refuses(() -> MessagePreviewExistingVault.open(app).readAuthenticated()); corrupt.unchanged();
        phase = "CREDENTIAL_KEY_LOSS"; seed(MessagePreviewMetadataEnvelope.Kind.COMMITTED); Snapshot loss = new Snapshot();
        store.deleteEntry(CREDENTIAL); refuses(() -> new MessagePreviewKeystoreReader(app, INSTALL).loadCredential(CREDENTIAL));
        require(!store.containsAlias(CREDENTIAL)); loss.unchanged();
        phase = "METADATA_KEY_LOSS"; store.deleteEntry(META);
        refuses(() -> MessagePreviewExistingVault.open(app).readCommitted(now));
        require(!store.containsAlias(META)); loss.unchanged();
        phase = "OWN_ALIAS_CLEANUP"; store.deleteEntry(WRONG);
        require(!store.containsAlias(META) && !store.containsAlias(CREDENTIAL) && !store.containsAlias(WRONG)); pass();
        phase = "COMPLETE";
    }
    private static int fdCount() {
        String[] entries = new File("/proc/self/fd").list(); require(entries != null && entries.length > 0); return entries.length;
    }
}
