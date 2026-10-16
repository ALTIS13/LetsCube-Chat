package com.kub.messenger;

import android.content.Context;
import android.os.Looper;
import android.os.Process;
import android.os.UserManager;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Checked native storage. Caller supplies fresh head/Auth/server-ACK authorization.
final class MessagePreviewChoiceStore {
    // The app has one CE namespace per process; AtomicFile does not serialize instances.
    private static final Object FILE_LOCK = new Object();
    private static final byte[] PURPOSE = "LETSCUBE-CHOICE-v1".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] DOMAIN = "LETSCUBE-NMPV-CHOICE-v1".getBytes(StandardCharsets.US_ASCII);
    private static final String[] LEVELS = {"none", "sender", "message"};
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    static final class Choice {
        final String level, publicKey;
        final long revision;
        private final MessagePreviewMetadataEnvelope.Record authenticated;
        private Choice(String level, String publicKey, long revision, MessagePreviewMetadataEnvelope.Record authenticated) {
            this.level = level; this.publicKey = publicKey; this.revision = revision; this.authenticated = authenticated;
        }
    }
    private final Context supplied, context;
    private final Thread worker;
    private final int uid;
    private final File root, namespace, file;
    private final StructStat rootIdentity, namespaceIdentity;
    private final MessagePreviewJournalIO journal;
    private MessagePreviewMetadataEnvelope.Header seenHeader;
    private long seenRevision = -1;

    MessagePreviewChoiceStore(Context supplied) throws Unavailable {
        synchronized (FILE_LOCK) {
            try {
                this.supplied = supplied; context = supplied == null ? null : supplied.getApplicationContext();
                worker = Thread.currentThread(); uid = Process.myUid(); memory();
                File raw = context.getNoBackupFilesDir(); require(raw != null && raw.isAbsolute());
                require(OsConstants.S_ISDIR(Os.lstat(raw.getPath()).st_mode));
                root = raw.getCanonicalFile(); rootIdentity = owned(root, true);
                namespace = new File(root, "native-message-previews-v1"); namespaceIdentity = owned(namespace, true);
                require((namespaceIdentity.st_mode & 07777) == 0700);
                file = new File(namespace, "choice-v1.bin"); current();
                journal = new MessagePreviewJournalIO(new Backend());
            } catch (Exception refused) { throw new Unavailable(); }
        }
    }
    private static void require(boolean yes) throws Unavailable { if (!yes) throw new Unavailable(); }
    private void memory() throws Unavailable {
        require(Thread.currentThread() == worker && Looper.getMainLooper() != null && Looper.myLooper() != Looper.getMainLooper()
            && uid >= 10000 && Process.myUid() == uid && supplied != null && context != null
            && supplied.getApplicationContext() == context && context.getApplicationContext() == context
            && !supplied.isDeviceProtectedStorage() && !context.isDeviceProtectedStorage()
            && context.getApplicationInfo() != null && context.getApplicationInfo().uid == uid);
        UserManager user = context.getSystemService(UserManager.class); require(user != null && user.isUserUnlocked());
    }
    private StructStat owned(File path, boolean directory) throws Exception {
        require(path.equals(path.getCanonicalFile())); StructStat s = Os.lstat(path.getPath());
        require(s.st_uid == uid && (directory ? OsConstants.S_ISDIR(s.st_mode) : OsConstants.S_ISREG(s.st_mode))); return s;
    }
    private static void same(StructStat a, StructStat b) throws Unavailable {
        require(a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_uid == b.st_uid && a.st_mode == b.st_mode);
    }
    private boolean absent(File path) throws Exception {
        try { require(owned(path, false).st_size <= 16384); return false; }
        catch (ErrnoException missing) { if (missing.errno != OsConstants.ENOENT) throw missing; return true; }
    }
    private boolean missing() throws Exception {
        return absent(file) & absent(new File(file.getPath() + ".bak")) & absent(new File(file.getPath() + ".new"));
    }
    private void current() throws Exception {
        memory(); File raw = context.getNoBackupFilesDir();
        require(raw != null && OsConstants.S_ISDIR(Os.lstat(raw.getPath()).st_mode) && root.equals(raw.getCanonicalFile()));
        same(rootIdentity, owned(root, true)); same(namespaceIdentity, owned(namespace, true)); missing(); memory();
    }
    private SecretKey key(MessagePreviewMetadataEnvelope.Record expected) throws Exception {
        require(expected != null && expected.header.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED);
        current(); SecretKey key = new MessagePreviewKeystoreReader(context, expected.header.installation).loadMetadata(); current(); return key;
    }
    private static boolean header(MessagePreviewMetadataEnvelope.Header a, MessagePreviewMetadataEnvelope.Header b) {
        return a.installation.equals(b.installation) && a.kind == b.kind && a.generation == b.generation
            && a.alias.equals(b.alias) && a.expiresWallMillis == b.expiresWallMillis && a.wallHighWaterMillis == b.wallHighWaterMillis
            && a.operationId.equals(b.operationId) && a.baseGeneration == b.baseGeneration && a.vaultRevision == b.vaultRevision;
    }
    private static int level(String value) { for (int i = 0; i < LEVELS.length; i++) if (LEVELS[i].equals(value)) return i; return -1; }
    private static void input(String level, String publicKey, long revision) throws Unavailable {
        require(level(level) >= 0 && MessagePreviewVerificationState.safe(revision) && publicKey != null && publicKey.length() >= 1 && publicKey.length() <= 4096);
        for (int i = 0; i < publicKey.length(); i++) require(publicKey.charAt(i) >= 33 && publicKey.charAt(i) <= 126);
    }
    private static void clear(byte[] bytes) { if (bytes != null) Arrays.fill(bytes, (byte) 0); }
    private static byte[] encrypt(byte[] plain, SecretKey key) throws Exception {
        byte[] iv = null, cipher = null;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key); c.updateAAD(DOMAIN);
            cipher = c.doFinal(plain); iv = c.getIV(); require(iv != null && iv.length == 12 && cipher.length == plain.length + 16);
            return ByteBuffer.allocate(12 + cipher.length).put(iv).put(cipher).array();
        } finally { clear(iv); clear(cipher); }
    }
    private Choice decode(MessagePreviewMetadataEnvelope.Record record, SecretKey key) throws Exception {
        byte[] blob = null, plain = null, pub = null, magic = null;
        try {
            require(record.header.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED);
            blob = record.credentialBytes(); require(blob.length >= PURPOSE.length + 40 && blob.length <= PURPOSE.length + 11 + 4096 + 28);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, blob, 0, 12));
            c.updateAAD(DOMAIN); plain = c.doFinal(blob, 12, blob.length - 12);
            ByteBuffer b = ByteBuffer.wrap(plain); magic = new byte[PURPOSE.length]; b.get(magic); require(Arrays.equals(magic, PURPOSE));
            long revision = b.getLong(); int level = b.get() & 255, length = b.getShort() & 65535;
            require(level < LEVELS.length && length >= 1 && length <= 4096 && b.remaining() == length);
            pub = new byte[length]; b.get(pub); for (byte value : pub) require(value >= 33 && value <= 126);
            String publicKey = new String(pub, StandardCharsets.US_ASCII); input(LEVELS[level], publicKey, revision);
            return new Choice(LEVELS[level], publicKey, revision, record);
        } finally { clear(blob); clear(plain); clear(pub); clear(magic); }
    }
    private Choice existing(MessagePreviewMetadataEnvelope.Record expected, SecretKey key) throws Exception {
        current(); if (missing()) return null;
        Choice choice = decode(journal.read(expected.header.installation, key), key); current(); return choice;
    }
    private long floor(MessagePreviewMetadataEnvelope.Header head) { return seenHeader != null && header(seenHeader, head) ? seenRevision : -1; }
    private void remember(Choice choice) { seenHeader = choice.authenticated.header; seenRevision = choice.revision; }

    Choice read(MessagePreviewMetadataEnvelope.Record expected) throws Unavailable {
        synchronized (FILE_LOCK) {
            try {
                Choice choice = existing(expected, key(expected)); require(choice != null && header(choice.authenticated.header, expected.header));
                require(choice.revision >= floor(expected.header)); current(); remember(choice); return choice;
            } catch (Exception refused) { throw new Unavailable(); }
        }
    }
    boolean write(MessagePreviewMetadataEnvelope.Record expected, String level, String publicKey, long revision) {
        return write(expected, level, publicKey, revision, () -> {});
    }
    // Native lifecycle check only; caller still owns authenticated head/server-choice authority.
    boolean write(MessagePreviewMetadataEnvelope.Record expected, String level, String publicKey, long revision, Runnable beforeWrite) {
        synchronized (FILE_LOCK) {
            byte[] plain = null, blob = null;
            try {
                require(beforeWrite != null);
                input(level, publicKey, revision); SecretKey key = key(expected); Choice old = existing(expected, key);
                long floor = floor(expected.header);
                if (old != null && header(old.authenticated.header, expected.header)) floor = Math.max(floor, old.revision);
                if (revision <= floor) return false;
                plain = ByteBuffer.allocate(PURPOSE.length + 11 + publicKey.length()).put(PURPOSE).putLong(revision)
                    .put((byte) level(level)).putShort((short) publicKey.length()).put(publicKey.getBytes(StandardCharsets.US_ASCII)).array();
                // MetadataEnvelope authenticates payload; the inner purpose-separated GCM provides confidentiality.
                blob = encrypt(plain, key); current();
                beforeWrite.run();
                if (journal.write(MessagePreviewMetadataEnvelope.seal(expected.header, blob, key), expected.header.installation, key)
                        != MessagePreviewJournalIO.Result.CHECKED) return false;
                Choice saved = read(expected);
                return saved.revision == revision && saved.level.equals(level) && saved.publicKey.equals(publicKey);
            } catch (Exception refused) { return false; }
            finally { clear(plain); clear(blob); }
        }
    }
    boolean isCurrent(MessagePreviewMetadataEnvelope.Record expected, Choice choice) {
        byte[] left = null, right = null;
        try {
            if (choice == null) return false; Choice actual = read(expected);
            if (!header(choice.authenticated.header, expected.header)) return false;
            left = actual.authenticated.credentialBytes(); right = choice.authenticated.credentialBytes(); return Arrays.equals(left, right);
        } catch (Unavailable refused) { return false; }
        finally { clear(left); clear(right); }
    }
    private final class Backend implements MessagePreviewJournalIO.Backend {
        private final AtomicFile atomic = new AtomicFile(file);
        private FileOutputStream active;
        private void checked() throws IOException { try { current(); } catch (Exception refused) { throw new IOException("UNAVAILABLE", (Throwable) null); } }
        private void owned(OutputStream stream) throws IOException { if (active == null || active != stream) throw new IOException("UNAVAILABLE"); checked(); }
        public InputStream openRead() throws IOException { checked(); return atomic.openRead(); }
        public OutputStream startWrite() throws IOException { checked(); if (active != null) throw new IOException("UNAVAILABLE"); active = atomic.startWrite(); return active; }
        public void sync(OutputStream stream) throws IOException { owned(stream); active.getFD().sync(); }
        private void complete(OutputStream stream, boolean commit) throws IOException {
            if (active == null || active != stream) throw new IOException("UNAVAILABLE"); FileOutputStream closing = active;
            try { checked(); if (commit) atomic.finishWrite(closing); else atomic.failWrite(closing); }
            finally { active = null; closing.close(); }
        }
        public void finishWrite(OutputStream stream) throws IOException { complete(stream, true); }
        public void failWrite(OutputStream stream) throws IOException { complete(stream, false); }
    }
}
