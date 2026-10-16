package com.kub.messenger;

import android.content.Context;
import android.os.Looper;
import android.os.Process;
import android.os.UserManager;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.File;
import java.io.FileDescriptor;
import java.util.Arrays;
import javax.crypto.SecretKey;

/** Load-only native snapshot reader; not lifecycle, credential or publication authority. */
final class MessagePreviewExistingVault {
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    private final Context supplied, context;
    private final Thread worker;
    private final int uid;
    private final File root, namespace, marker;
    private final StructStat rootIdentity, namespaceIdentity, markerIdentity;
    private final String installation;
    private final MessagePreviewJournalIO journal;
    private final MessagePreviewKeystoreReader keys;

    static MessagePreviewExistingVault open(Context context) throws Unavailable {
        return new MessagePreviewExistingVault(context);
    }
    private MessagePreviewExistingVault(Context supplied) throws Unavailable {
        try {
            this.supplied = supplied;
            context = supplied == null ? null : supplied.getApplicationContext();
            worker = Thread.currentThread(); uid = Process.myUid();
            memory();
            File raw = context.getNoBackupFilesDir();
            if (raw == null || !raw.isAbsolute() || !OsConstants.S_ISDIR(Os.lstat(raw.getPath()).st_mode)) throw new Unavailable();
            for (File part = raw; part != null; part = part.getParentFile()) {
                if (".".equals(part.getName()) || "..".equals(part.getName())) throw new Unavailable();
            }
            // Android may alias a parent of no_backup, but not the root leaf itself.
            root = raw.getCanonicalFile(); rootIdentity = owned(root, true, -1);
            namespace = new File(root, "native-message-previews-v1");
            namespaceIdentity = owned(namespace, true, 0700);
            marker = new File(namespace, "installation-v1.bin");
            markerIdentity = owned(marker, false, -1);
            installation = readMarker();
            keys = new MessagePreviewKeystoreReader(context, installation);
            journal = new MessagePreviewJournalIO(new MessagePreviewAtomicBackend(context));
            current();
        } catch (Exception refused) { throw new Unavailable(); }
    }
    private void memory() throws Unavailable {
        if (Thread.currentThread() != worker || Looper.getMainLooper() == null || Looper.myLooper() == Looper.getMainLooper()
            || uid < 10000 || Process.myUid() != uid || context == null || supplied == null
            || supplied.getApplicationContext() != context || context.getApplicationContext() != context
            || supplied.isDeviceProtectedStorage() || context.isDeviceProtectedStorage()
            || context.getApplicationInfo() == null || context.getApplicationInfo().uid != uid) throw new Unavailable();
        UserManager user = context.getSystemService(UserManager.class);
        if (user == null || !user.isUserUnlocked()) throw new Unavailable();
    }
    private StructStat owned(File path, boolean directory, int mode) throws Exception {
        if (!path.equals(path.getCanonicalFile())) throw new Unavailable();
        StructStat stat = Os.lstat(path.getPath());
        if (stat.st_uid != uid || (directory ? !OsConstants.S_ISDIR(stat.st_mode) : !OsConstants.S_ISREG(stat.st_mode))
            || (mode >= 0 && (stat.st_mode & 07777) != mode)) throw new Unavailable();
        return stat;
    }
    private static void same(StructStat expected, StructStat actual) throws Unavailable {
        if (expected.st_dev != actual.st_dev || expected.st_ino != actual.st_ino
            || expected.st_uid != actual.st_uid || expected.st_mode != actual.st_mode) throw new Unavailable();
    }
    private void paths() throws Exception {
        memory();
        File raw = context.getNoBackupFilesDir();
        if (raw == null || !OsConstants.S_ISDIR(Os.lstat(raw.getPath()).st_mode)
            || !root.equals(raw.getCanonicalFile())) throw new Unavailable();
        same(rootIdentity, owned(root, true, -1)); same(namespaceIdentity, owned(namespace, true, 0700));
        memory();
    }
    private String readMarker() throws Exception {
        paths();
        StructStat markerBefore = owned(marker, false, 0600);
        same(markerIdentity, markerBefore);
        if (markerBefore.st_size != 28) throw new Unavailable();
        byte[] bytes = new byte[29];
        FileDescriptor fd = Os.open(marker.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW, 0);
        try {
            same(markerBefore, Os.fstat(fd));
            if (Os.fstat(fd).st_size != 28) throw new Unavailable();
            int total = 0;
            while (total < bytes.length) {
                int count = Os.read(fd, bytes, total, bytes.length - total);
                if (count == 0) break;
                if (count < 0) throw new Unavailable();
                total += count;
            }
            if (total != 28) throw new Unavailable();
            paths();
            StructStat after = owned(marker, false, 0600);
            same(markerBefore, after); same(after, Os.fstat(fd));
            if (after.st_size != 28 || Os.fstat(fd).st_size != 28) throw new Unavailable();
            return MessagePreviewInstallationMarker.decode(Arrays.copyOf(bytes, 28));
        } finally { Arrays.fill(bytes, (byte) 0); Os.close(fd); }
    }
    private void current() throws Exception {
        if (!installation.equals(readMarker())) throw new Unavailable();
        memory();
    }
    MessagePreviewMetadataEnvelope.Record readAuthenticated() throws Unavailable {
        try {
            current();
            SecretKey metadataKey = keys.loadMetadata();
            current();
            // AtomicFile.openRead may recover its own backup; no pristine init, key repair or explicit write.
            MessagePreviewMetadataEnvelope.Record record = journal.read(installation, metadataKey);
            current();
            return record;
        } catch (Exception refused) { throw new Unavailable(); }
    }
    MessagePreviewMetadataEnvelope.Record readCommitted(long now) throws Unavailable {
        MessagePreviewMetadataEnvelope.Record record = readAuthenticated();
        MessagePreviewMetadataEnvelope.Header h = record.header;
        if (h.kind != MessagePreviewMetadataEnvelope.Kind.COMMITTED || !MessagePreviewVerificationState.safe(now)
            || now < h.wallHighWaterMillis || now >= h.expiresWallMillis) throw new Unavailable();
        return record;
    }
    boolean isCurrent(MessagePreviewMetadataEnvelope.Record expected, long now) {
        byte[] left = null, right = null;
        try {
            if (expected == null) return false;
            MessagePreviewMetadataEnvelope.Record actual = readCommitted(now);
            MessagePreviewMetadataEnvelope.Header a = actual.header, b = expected.header;
            if (!a.installation.equals(b.installation) || a.kind != b.kind || a.generation != b.generation
                || !a.alias.equals(b.alias) || !a.operationId.equals(b.operationId) || a.baseGeneration != b.baseGeneration
                || a.vaultRevision != b.vaultRevision || a.expiresWallMillis != b.expiresWallMillis
                || a.wallHighWaterMillis != b.wallHighWaterMillis) return false;
            left = actual.credentialBytes(); right = expected.credentialBytes();
            return Arrays.equals(left, right);
        } catch (Exception refused) { return false; }
        finally { if (left != null) Arrays.fill(left, (byte) 0); if (right != null) Arrays.fill(right, (byte) 0); }
    }
}
