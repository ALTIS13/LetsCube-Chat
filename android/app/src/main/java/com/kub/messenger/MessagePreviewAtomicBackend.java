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
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.Arrays;

// Inactive platform I/O only. The future single storage owner supplies an existing CE namespace.
final class MessagePreviewAtomicBackend implements MessagePreviewJournalIO.Backend {
    private final Context context;
    private final File root;
    private final File namespace;
    private final File base;
    private final AtomicFile atomic;
    private FileOutputStream active;

    MessagePreviewAtomicBackend(Context supplied) throws IOException {
        try {
            if (supplied == null || supplied.isDeviceProtectedStorage()) throw unavailable();
            context = supplied.getApplicationContext();
            if (context == null) throw unavailable();
            storageAvailable();
            root = platformRoot();
            namespace = new File(root, "native-message-previews-v1");
            base = new File(namespace, "journal-v1.bin");
            validate();
            atomic = new AtomicFile(base);
        } catch (IOException | RuntimeException refused) {
            throw unavailable();
        }
    }

    private static IOException unavailable() { return new IOException("UNAVAILABLE", (Throwable) null); }

    private void storageAvailable() throws IOException {
        if (context.isDeviceProtectedStorage()) throw unavailable();
        Object service = context.getSystemService(Context.USER_SERVICE);
        if (!(service instanceof UserManager) || !((UserManager) service).isUserUnlocked()) throw unavailable();
    }

    private File platformRoot() throws IOException {
        return platformRoot(context);
    }

    private static File platformRoot(Context context) throws IOException {
        File raw = context.getNoBackupFilesDir();
        if (raw == null || !raw.isAbsolute()) throw unavailable();
        for (File part = raw; part != null; part = part.getParentFile()) {
            if (".".equals(part.getName()) || "..".equals(part.getName())) throw unavailable();
        }
        // Android may alias a parent directory; the supplied root leaf must still be a real directory.
        try {
            if (!OsConstants.S_ISDIR(Os.lstat(raw.getPath()).st_mode)) throw unavailable();
        } catch (ErrnoException refused) { throw unavailable(); }
        return raw.getCanonicalFile();
    }

    private static void canonical(File path) throws IOException {
        if (!path.equals(path.getCanonicalFile())) throw unavailable();
    }

    private static void directory(File path) throws IOException {
        canonical(path);
        try {
            StructStat stat = Os.lstat(path.getPath());
            if (!OsConstants.S_ISDIR(stat.st_mode)) throw unavailable();
        } catch (ErrnoException refused) { throw unavailable(); }
    }

    private static void target(File path) throws IOException {
        canonical(path);
        try {
            StructStat stat = Os.lstat(path.getPath());
            if (!OsConstants.S_ISREG(stat.st_mode)) throw unavailable();
        } catch (ErrnoException refused) {
            // lstat, unlike exists(), also refuses dangling symlinks rather than treating them as absent.
            if (refused.errno != OsConstants.ENOENT) throw unavailable();
        }
    }

    private void validate() throws IOException {
        storageAvailable();
        if (!root.equals(platformRoot())) throw unavailable();
        directory(root);
        directory(namespace);
        target(base);
        target(new File(base.getPath() + ".new"));
        target(new File(base.getPath() + ".bak"));
    }

    private void idle() throws IOException {
        if (active != null) throw unavailable();
    }

    private FileOutputStream owned(OutputStream borrowed) throws IOException {
        if (active == null || borrowed != active) throw unavailable();
        return active;
    }

    @Override public synchronized InputStream openRead() throws IOException {
        try {
            idle();
            validate();
            return atomic.openRead();
        } catch (IOException | RuntimeException refused) { throw unavailable(); }
    }

    @Override public synchronized OutputStream startWrite() throws IOException {
        try {
            idle();
            validate();
            FileOutputStream stream = atomic.startWrite();
            if (stream == null) throw unavailable();
            active = stream;
            return stream;
        } catch (IOException | RuntimeException refused) { throw unavailable(); }
    }

    @Override public synchronized void sync(OutputStream borrowed) throws IOException {
        FileOutputStream owned = owned(borrowed);
        try {
            validate();
            owned.flush();
            owned.getFD().sync();
        } catch (IOException | RuntimeException refused) { throw unavailable(); }
    }

    private void complete(OutputStream borrowed, boolean finish) throws IOException {
        FileOutputStream owned = owned(borrowed);
        boolean refused = false;
        try {
            validate();
            if (finish) atomic.finishWrite(owned);
            else atomic.failWrite(owned);
        } catch (IOException | RuntimeException failure) {
            refused = true;
        } finally {
            active = null;
            try { owned.close(); }
            catch (IOException | RuntimeException failure) { refused = true; }
        }
        if (refused) throw unavailable();
    }

    @Override public synchronized void finishWrite(OutputStream stream) throws IOException {
        // Never follow an attempted finish with destructive rollback; the kernel checks fresh bytes.
        complete(stream, true);
    }

    @Override public synchronized void failWrite(OutputStream stream) throws IOException {
        complete(stream, false);
    }

    static final class MarkerUnavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private MarkerUnavailable() { super("UNAVAILABLE", null, false, false); }
    }

    static final class MarkerReservation {
        final String installation;
        private final MarkerIO issuer;
        private final MessagePreviewInitializationGate.Permit permit;
        private final Thread worker;
        private final StructStat rootIdentity, namespaceIdentity, markerIdentity;
        private MarkerReservation(MarkerIO issuer, String installation) {
            this.issuer = issuer; this.installation = installation;
            permit = issuer.permit; worker = issuer.worker;
            rootIdentity = issuer.rootIdentity; namespaceIdentity = issuer.namespaceIdentity;
            markerIdentity = issuer.markerIdentity;
        }
    }

    // Inactive create-only reservation. No key inventory/mint, journal initialization or recovery.
    static final class MarkerIO {
        private final Context supplied, context;
        private final MessagePreviewInitializationGate gate;
        private final MessagePreviewInitializationGate.Permit permit;
        private final Thread worker;
        private final int uid;
        private final File root, namespace, marker;
        private final StructStat rootIdentity;
        private StructStat namespaceIdentity, markerIdentity;
        private byte[] encoded;
        private MarkerReservation issued;
        private boolean attempted;

        MarkerIO(Context supplied, MessagePreviewInitializationGate gate,
                 MessagePreviewInitializationGate.Permit permit) throws MarkerUnavailable {
            try {
                if (supplied == null || gate == null || permit == null) throw new MarkerUnavailable();
                this.supplied = supplied; this.gate = gate; this.permit = permit;
                worker = Thread.currentThread(); uid = Process.myUid();
                context = supplied.getApplicationContext();
                currentMemory();
                root = platformRoot(context); rootIdentity = ownedStat(root, true, -1);
                namespace = new File(root, "native-message-previews-v1");
                marker = new File(namespace, "installation-v1.bin");
                currentRoot();
            } catch (Exception refused) { throw new MarkerUnavailable(); }
        }

        private void currentMemory() throws MarkerUnavailable {
            try {
                gate.currentBeforeEffect(permit);
                if (Thread.currentThread() != worker || Looper.getMainLooper() == null
                    || Looper.myLooper() == Looper.getMainLooper() || uid < 10000 || Process.myUid() != uid
                    || context == null || supplied.getApplicationContext() != context
                    || context.getApplicationContext() != context || supplied.isDeviceProtectedStorage()
                    || context.isDeviceProtectedStorage() || context.getApplicationInfo() == null
                    || context.getApplicationInfo().uid != uid) throw new MarkerUnavailable();
                Object service = context.getSystemService(Context.USER_SERVICE);
                if (!(service instanceof UserManager) || !((UserManager) service).isUserUnlocked()) throw new MarkerUnavailable();
                gate.currentBeforeEffect(permit);
            } catch (Exception refused) { throw new MarkerUnavailable(); }
        }

        private StructStat ownedStat(File path, boolean dir, int mode) throws Exception {
            canonical(path);
            StructStat stat = Os.lstat(path.getPath());
            if (stat.st_uid != uid || (dir ? !OsConstants.S_ISDIR(stat.st_mode) : !OsConstants.S_ISREG(stat.st_mode))
                || (mode >= 0 && (stat.st_mode & 07777) != mode)) throw new MarkerUnavailable();
            return stat;
        }

        private static void same(StructStat expected, StructStat actual) throws MarkerUnavailable {
            if (expected == null || actual == null || expected.st_dev != actual.st_dev
                || expected.st_ino != actual.st_ino || expected.st_uid != actual.st_uid
                || expected.st_mode != actual.st_mode) throw new MarkerUnavailable();
        }

        private void currentRoot() throws Exception {
            currentMemory();
            if (!root.equals(platformRoot(context))) throw new MarkerUnavailable();
            same(rootIdentity, ownedStat(root, true, -1));
            currentMemory();
        }

        private void currentNamespace() throws Exception {
            currentRoot(); same(namespaceIdentity, ownedStat(namespace, true, 0700)); currentMemory();
        }

        private void absentNamespace() throws Exception {
            currentRoot();
            try { Os.lstat(namespace.getPath()); }
            catch (ErrnoException refused) {
                if (refused.errno == OsConstants.ENOENT) { currentRoot(); return; }
                throw new MarkerUnavailable();
            }
            throw new MarkerUnavailable();
        }

        private FileDescriptor openDirectory(File path, StructStat identity) throws Exception {
            // Public Android API has no O_DIRECTORY; custody is checked on the opened no-follow FD.
            FileDescriptor fd = Os.open(path.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW, 0);
            try {
                StructStat opened = Os.fstat(fd);
                if (!OsConstants.S_ISDIR(opened.st_mode)) throw new MarkerUnavailable();
                same(identity, opened); return fd;
            }
            catch (Exception refused) { try { Os.close(fd); } catch (Exception ignored) { } throw refused; }
        }

        private void writeMarker() throws Exception {
            FileDescriptor fd = null;
            FileOutputStream stream = null;
            try {
                currentNamespace();
                fd = Os.open(marker.getPath(), OsConstants.O_WRONLY | OsConstants.O_CREAT | OsConstants.O_EXCL | OsConstants.O_NOFOLLOW, 0600);
                markerIdentity = ownedStat(marker, false, 0600);
                if (markerIdentity.st_size != 0) throw new MarkerUnavailable();
                StructStat opened = Os.fstat(fd); same(markerIdentity, opened);
                if (opened.st_size != 0) throw new MarkerUnavailable();
                currentNamespace();
                stream = new FileOutputStream(fd); fd = null;
                currentNamespace(); stream.write(encoded);
                currentNamespace(); stream.flush();
                currentNamespace(); stream.getFD().sync();
                currentNamespace();
                StructStat after = ownedStat(marker, false, 0600);
                same(markerIdentity, after); same(after, Os.fstat(stream.getFD()));
                if (after.st_size != 28) throw new MarkerUnavailable();
                markerIdentity = after;
            } finally {
                if (stream != null) stream.close();
                else if (fd != null) Os.close(fd);
            }
        }

        private String readMarker() throws Exception { return readMarker(false); }

        private String readMarker(boolean afterInitialJournal) throws Exception {
            FileDescriptor fd = null;
            FileInputStream stream = null;
            String installation;
            try {
                currentNamespace();
                StructStat before = ownedStat(marker, false, 0600);
                same(markerIdentity, before);
                if (before.st_size != 28) throw new MarkerUnavailable();
                fd = Os.open(marker.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW, 0);
                StructStat opened = Os.fstat(fd); same(before, opened);
                if (opened.st_size != 28) throw new MarkerUnavailable();
                stream = new FileInputStream(fd); fd = null;
                byte[] bytes = new byte[29];
                int total = 0;
                while (total < bytes.length) {
                    currentNamespace();
                    int count = stream.read(bytes, total, bytes.length - total);
                    currentNamespace();
                    if (count == -1) break;
                    if (count <= 0) throw new MarkerUnavailable();
                    total += count;
                }
                if (total != 28 || !Arrays.equals(encoded, Arrays.copyOf(bytes, total))) throw new MarkerUnavailable();
                installation = MessagePreviewInstallationMarker.decode(Arrays.copyOf(bytes, total));
                StructStat after = ownedStat(marker, false, 0600);
                same(markerIdentity, after);
                if (after.st_size != 28) throw new MarkerUnavailable();
            } finally {
                if (stream != null) stream.close();
                else if (fd != null) Os.close(fd);
            }
            currentNamespace();
            String[] children = namespace.list();
            if (!afterInitialJournal) {
                if (children == null || children.length != 1 || !"installation-v1.bin".equals(children[0])) throw new MarkerUnavailable();
            } else {
                if (children == null || children.length != 2
                    || !Arrays.asList(children).contains("installation-v1.bin")
                    || !Arrays.asList(children).contains("journal-v1.bin")) throw new MarkerUnavailable();
                File base = new File(namespace, "journal-v1.bin");
                StructStat before = ownedStat(base, false, -1);
                if (before.st_size <= 0 || before.st_size > 16_384) throw new MarkerUnavailable();
                currentNamespace();
                StructStat after = ownedStat(base, false, -1);
                same(before, after);
                if (before.st_size != after.st_size) throw new MarkerUnavailable();
            }
            currentNamespace();
            return installation;
        }

        MarkerReservation reserve() throws MarkerUnavailable {
            FileDescriptor rootFd = null, namespaceFd = null;
            try {
                gate.currentBeforeEffect(permit);
                if (Thread.currentThread() != worker) throw new MarkerUnavailable();
                if (attempted) throw new MarkerUnavailable();
                attempted = true;
                currentRoot();
                absentNamespace();
                rootFd = openDirectory(root, rootIdentity);
                byte[] nonce = new byte[16]; new SecureRandom().nextBytes(nonce);
                encoded = MessagePreviewInstallationMarker.encode(nonce);
                absentNamespace();
                gate.markEffectAttempted(permit);
                currentRoot(); Os.mkdir(namespace.getPath(), 0700);
                currentRoot(); namespaceIdentity = ownedStat(namespace, true, 0700);
                namespaceFd = openDirectory(namespace, namespaceIdentity);
                currentNamespace();
                String[] children = namespace.list();
                if (children == null || children.length != 0) throw new MarkerUnavailable();
                writeMarker();
                currentNamespace(); same(namespaceIdentity, Os.fstat(namespaceFd)); currentMemory(); Os.fsync(namespaceFd);
                currentNamespace();
                FileDescriptor closing = namespaceFd; namespaceFd = null; Os.close(closing);
                currentNamespace(); same(rootIdentity, Os.fstat(rootFd)); currentMemory(); Os.fsync(rootFd);
                currentNamespace(); closing = rootFd; rootFd = null; Os.close(closing);
                String installation = readMarker();
                currentNamespace();
                issued = new MarkerReservation(this, installation);
                return issued;
            } catch (Exception refused) { throw new MarkerUnavailable(); }
            finally {
                if (namespaceFd != null) try { Os.close(namespaceFd); } catch (Exception ignored) { }
                if (rootFd != null) try { Os.close(rootFd); } catch (Exception ignored) { }
            }
        }

        void requireCurrent(MarkerReservation reservation) throws MarkerUnavailable {
            requireCurrent(reservation, false);
        }

        void requireCurrentAfterInitialJournal(MarkerReservation reservation) throws MarkerUnavailable {
            requireCurrent(reservation, true);
        }

        private void requireCurrent(MarkerReservation reservation, boolean afterInitialJournal) throws MarkerUnavailable {
            try {
                if (reservation == null || reservation != issued || reservation.issuer != this
                    || reservation.permit != permit || reservation.worker != worker) throw new MarkerUnavailable();
                currentNamespace();
                same(reservation.rootIdentity, rootIdentity); same(reservation.namespaceIdentity, namespaceIdentity);
                same(reservation.markerIdentity, markerIdentity);
                if (!reservation.installation.equals(readMarker(afterInitialJournal))) throw new MarkerUnavailable();
                currentNamespace();
            } catch (Exception refused) { throw new MarkerUnavailable(); }
        }
    }
}
