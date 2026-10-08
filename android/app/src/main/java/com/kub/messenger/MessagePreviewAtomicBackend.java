package com.kub.messenger;

import android.content.Context;
import android.os.UserManager;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

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
}
