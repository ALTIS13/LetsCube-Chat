package com.kub.messenger;

import android.content.Context;
import android.os.UserManager;
import android.util.AtomicFile;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

// Executes the real adapter against scripted API doubles, not real Android storage.
public final class MessagePreviewAtomicBackendProbe {
    private interface Attempt { void run() throws Exception; }
    private static void check(boolean value, String oracle) {
        if (!value) throw new AssertionError(oracle);
    }
    private static void refused(Attempt attempt, String oracle) throws Exception {
        try { attempt.run(); }
        catch (IOException failure) {
            check("UNAVAILABLE".equals(failure.getMessage()) && failure.getCause() == null
                && failure.getSuppressed().length == 0, "FIXED_REFUSAL");
            return;
        }
        throw new AssertionError(oracle);
    }
    private static final class App extends Context {
        File root;
        boolean protectedStorage;
        int rootReads;
        Object user = new UserManager();
        App(File root) { this.root = root; }
        @Override public boolean isDeviceProtectedStorage() { return protectedStorage; }
        @Override public Context getApplicationContext() { return this; }
        @Override public File getNoBackupFilesDir() { rootReads++; return root; }
        @Override public Object getSystemService(String name) { return USER_SERVICE.equals(name) ? user : null; }
    }
    private static final class Foreign extends OutputStream {
        int closed;
        @Override public void write(int value) { }
        @Override public void close() { closed++; }
    }
    private static Path namespace(Path root) { return root.resolve("native-message-previews-v1"); }
    private static Path base(Path root) { return namespace(root).resolve("journal-v1.bin"); }
    private static App ready(Path root) throws Exception {
        Files.createDirectories(namespace(root)); return new App(root.toFile());
    }
    private static MessagePreviewAtomicBackend backend(App app) throws Exception {
        return new MessagePreviewAtomicBackend(app);
    }
    private static void healthy(Path root) throws Exception {
        App app = ready(root);
        MessagePreviewAtomicBackend backend = backend(app);
        byte[] expected = new byte[] { 4, 2, 9 };
        OutputStream owned = backend.startWrite(); owned.write(expected);
        backend.sync(owned);
        check(AtomicFile.last.flushes == 1, "SYNC_EXPLICIT_FLUSH");
        backend.finishWrite(owned);
        check(AtomicFile.last.closes >= 1, "FINISH_RELEASES_STREAM");
        try (InputStream input = backend.openRead()) {
            check(Arrays.equals(expected, new byte[] { (byte) input.read(), (byte) input.read(), (byte) input.read() })
                && input.read() == -1, "HEALTHY_BYTES");
        }
        OutputStream next = backend.startWrite(); next.write(8); backend.failWrite(next);
        check(!Files.exists(Path.of(base(root) + ".new")), "FAIL_DISCARDS_OWN_WRITE");
        check(Files.readAllBytes(base(root))[0] == 4, "FAIL_PRESERVES_PRIOR_BYTES");
    }
    private static void policy(Path root) throws Exception {
        App app = ready(root); app.protectedStorage = true;
        refused(() -> backend(app), "CE_ONLY");
        check(app.rootReads == 0 && AtomicFile.starts == 0, "CE_REFUSES_BEFORE_IO");
        app.protectedStorage = false; app.user = null;
        refused(() -> backend(app), "USER_MANAGER_REQUIRED");
        app.user = "wrong type";
        refused(() -> backend(app), "USER_MANAGER_REQUIRED");
        UserManager user = new UserManager(); user.unlocked = false; app.user = user;
        refused(() -> backend(app), "UNLOCK_REQUIRED");
        user.unlocked = true;
        MessagePreviewAtomicBackend backend = backend(app);
        user.unlocked = false;
        refused(backend::startWrite, "UNLOCK_RECHECKED");
        refused(backend::openRead, "UNLOCK_RECHECKED");
        check(AtomicFile.starts == 0 && AtomicFile.reads == 0, "LOCKED_NO_IO");
        user.unlocked = true; app.protectedStorage = true;
        refused(backend::startWrite, "CE_RECHECKED");
        check(AtomicFile.starts == 0, "CE_RECHECKED_BEFORE_IO");
    }
    private static void missing(Path root) throws Exception {
        App app = new App(root.toFile());
        refused(() -> backend(app), "MISSING_NAMESPACE_REFUSES");
        check(!Files.exists(namespace(root)), "NO_IMPLICIT_NAMESPACE");
        ready(root); MessagePreviewAtomicBackend backend = backend(app);
        Files.delete(namespace(root));
        refused(backend::startWrite, "MISSING_NAMESPACE_RECHECKED");
        check(AtomicFile.starts == 0 && !Files.exists(namespace(root)), "NO_IMPLICIT_NAMESPACE");
    }
    private static void paths(Path root) throws Exception {
        App app = ready(root);
        app.root = root.resolve("..").resolve(root.getFileName()).toFile();
        refused(() -> backend(app), "CANONICAL_PATH_REQUIRED");
        app.root = root.toFile();
        for (String suffix : new String[] { "", ".new", ".bak" }) {
            Path target = Path.of(base(root) + suffix);
            Files.createDirectory(target);
            refused(() -> backend(app), "NO_DIRECTORY_TARGET");
            Files.delete(target);
        }
        MessagePreviewAtomicBackend backend = backend(app);
        app.root = root.resolve("foreign").toFile();
        refused(backend::startWrite, "ROOT_IDENTITY_PINNED");
        app.root = root.toFile();
        Files.createDirectory(Path.of(base(root) + ".new"));
        refused(backend::startWrite, "TARGETS_RECHECKED");
        check(AtomicFile.starts == 0, "PATH_REFUSAL_BEFORE_IO");
    }
    private static void symlinks(Path root) throws Exception {
        App app = ready(root);
        Path foreign = root.resolve("foreign"); Files.createDirectory(foreign);
        Path ns = namespace(root); Files.delete(ns); Files.createSymbolicLink(ns, foreign);
        refused(() -> backend(app), "NO_SYMLINK_NAMESPACE");
        Files.delete(ns); Files.createDirectory(ns);
        for (String suffix : new String[] { "", ".new", ".bak" }) {
            Path target = Path.of(base(root) + suffix);
            Files.createSymbolicLink(target, root.resolve("absent"));
            refused(() -> backend(app), "NO_DANGLING_SYMLINK_TARGET");
            Files.delete(target);
        }
        MessagePreviewAtomicBackend backend = backend(app);
        Path next = Path.of(base(root) + ".new"); Files.createSymbolicLink(next, root.resolve("absent"));
        refused(backend::startWrite, "SYMLINKS_RECHECKED");
        check(AtomicFile.starts == 0 && !Files.exists(root.resolve("absent")), "NO_SYMLINK_WRITE");
    }
    private static void ownership(Path root) throws Exception {
        App app = ready(root); MessagePreviewAtomicBackend backend = backend(app);
        OutputStream owned = backend.startWrite();
        refused(backend::startWrite, "ONE_WRITER");
        refused(backend::openRead, "NO_READ_DURING_WRITE");
        Foreign foreign = new Foreign();
        int rootReads = app.rootReads;
        app.root = root.resolve("foreign").toFile();
        refused(() -> backend.sync(foreign), "FOREIGN_STREAM_REFUSED");
        refused(() -> backend.finishWrite(foreign), "FOREIGN_STREAM_REFUSED");
        refused(() -> backend.failWrite(foreign), "FOREIGN_STREAM_REFUSED");
        refused(() -> backend.finishWrite(null), "MISSING_STREAM_REFUSED");
        check(foreign.closed == 0 && app.rootReads == rootReads && AtomicFile.starts == 1
            && AtomicFile.reads == 0 && AtomicFile.finishes == 0 && AtomicFile.fails == 0, "FOREIGN_BEFORE_IO_OR_CLOSE");
        app.root = root.toFile(); backend.failWrite(owned);
        refused(() -> backend.failWrite(owned), "CONSUMED_STREAM_REFUSED");
        refused(() -> backend.finishWrite(owned), "CONSUMED_STREAM_REFUSED");
        check(AtomicFile.fails == 1 && AtomicFile.finishes == 0, "LATE_NO_ROLLBACK");
    }
    private static void finalization(Path root) throws Exception {
        MessagePreviewAtomicBackend backend = backend(ready(root));
        OutputStream first = backend.startWrite(); first.write(3);
        AtomicFile.finishThrows = true;
        refused(() -> backend.finishWrite(first), "FINISH_FAILURE_FIXED");
        check(AtomicFile.last.closes >= 1 && !AtomicFile.last.getFD().valid(), "FINISH_FAILURE_CLOSES");
        check(AtomicFile.fails == 0, "NO_ROLLBACK_AFTER_FINISH");
        refused(() -> backend.failWrite(first), "CONSUMED_STREAM_REFUSED");
        AtomicFile.finishThrows = false;
        OutputStream second;
        try { second = backend.startWrite(); }
        catch (IOException failure) { throw new AssertionError("FAILED_OWNER_RELEASED"); }
        AtomicFile.failThrows = true;
        refused(() -> backend.failWrite(second), "FAIL_FAILURE_FIXED");
        check(AtomicFile.last.closes >= 1 && !AtomicFile.last.getFD().valid(), "FAIL_FAILURE_CLOSES");
        AtomicFile.failThrows = false;
        OutputStream third;
        try { third = backend.startWrite(); }
        catch (IOException failure) { throw new AssertionError("FAILED_OWNER_RELEASED"); }
        backend.failWrite(third);
    }
    private static void completionPolicy(Path root) throws Exception {
        App app = ready(root); MessagePreviewAtomicBackend backend = backend(app);
        UserManager user = (UserManager) app.user;
        OutputStream first = backend.startWrite(); user.unlocked = false;
        refused(() -> backend.finishWrite(first), "FINALIZATION_POLICY_REQUIRED");
        check(AtomicFile.last.closes >= 1 && !AtomicFile.last.getFD().valid()
            && AtomicFile.finishes == 0 && AtomicFile.fails == 0, "REFUSED_FINISH_RELEASES");
        user.unlocked = true;
        OutputStream second = backend.startWrite(); user.unlocked = false;
        refused(() -> backend.failWrite(second), "FINALIZATION_POLICY_REQUIRED");
        check(!AtomicFile.last.getFD().valid() && AtomicFile.fails == 0, "REFUSED_FAIL_RELEASES");
        user.unlocked = true;
        OutputStream third = backend.startWrite(); backend.failWrite(third);
    }
    private static void syncFault(Path root) throws Exception {
        MessagePreviewAtomicBackend backend = backend(ready(root));
        OutputStream owned = backend.startWrite(); owned.close();
        refused(() -> backend.sync(owned), "REAL_FD_SYNC_REQUIRED");
        backend.failWrite(owned);
        AtomicFile.startThrows = true;
        refused(backend::startWrite, "START_FAILURE_FIXED");
        AtomicFile.startThrows = false;
        OutputStream next = backend.startWrite(); backend.failWrite(next);
        refused(backend::openRead, "MISSING_READ_FIXED");
    }
    public static void main(String[] args) throws Exception {
        String scenario = args[0]; Path root = Path.of(args[1]);
        switch (scenario) {
            case "healthy": healthy(root); break;
            case "policy": policy(root); break;
            case "missing": missing(root); break;
            case "paths": paths(root); break;
            case "symlinks": symlinks(root); break;
            case "ownership": ownership(root); break;
            case "finalization": finalization(root); break;
            case "completion-policy": completionPolicy(root); break;
            case "sync-fault": syncFault(root); break;
            default: throw new AssertionError("UNKNOWN_CASE");
        }
        System.out.println("PASS " + scenario);
    }
}
