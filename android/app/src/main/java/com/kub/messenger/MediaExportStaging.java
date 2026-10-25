package com.kub.messenger;

import java.io.File;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;
import java.util.function.LongSupplier;

/** One bounded local transfer in app-private cache, never a caller-supplied path. */
final class MediaExportStaging implements AutoCloseable {
    private static final long MAX_BYTES = 32L * 1024 * 1024;
    private static final int CHUNK_BYTES = 256 * 1024;
    private static final long TTL_MS = 120_000;
    private static final String UUID_PATTERN = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
    private final Path directory;
    private final LongSupplier now;
    private FileChannel lockChannel;
    private FileLock lock;
    private Session active;
    private Completed completed;
    private boolean closed;

    MediaExportStaging(File cacheRoot, LongSupplier now) throws IOException {
        if (cacheRoot == null || now == null) throw new IllegalArgumentException("Invalid staging owner");
        Path root = cacheRoot.toPath().toAbsolutePath().normalize();
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS) || !root.equals(root.toRealPath())) throw new IOException("Unsafe staging owner");
        this.now = now;
        directory = root.resolve("letscube-media-export");
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) {
            if (root.getFileSystem().supportedFileAttributeViews().contains("posix")) Files.createDirectory(directory, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            else Files.createDirectory(directory);
        }
        if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS) || !directory.equals(directory.toRealPath())) throw new IOException("Unsafe staging directory");
        if (directory.getFileSystem().supportedFileAttributeViews().contains("posix")) Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
        try {
            lockChannel = FileChannel.open(directory.resolve("owner.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS);
            try { lock = lockChannel.tryLock(); } catch (OverlappingFileLockException busy) { throw new IOException("Staging owner busy", busy); }
            if (lock == null) throw new IOException("Staging owner busy");
            try (DirectoryStream<Path> files = Files.newDirectoryStream(directory)) {
                for (Path file : files) if (file.getFileName().toString().matches(UUID_PATTERN + "\\.part")) {
                    if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Unsafe stale staging file");
                    Files.delete(file);
                }
            }
        } catch (IOException | RuntimeException error) {
            try { releaseLock(); } catch (IOException cleanup) { error.addSuppressed(cleanup); }
            throw error;
        }
    }

    synchronized String begin(MediaExportSource source, long size, String sha256) throws IOException {
        requireOpen();
        if (source == null || source.uri() != null || size <= 0 || size > MAX_BYTES || sha256 == null || !sha256.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid staging declaration");
        if (active != null) { requireLive(active); throw new IllegalStateException("Staging transfer busy"); }
        if (completed != null) throw new IllegalStateException("Staging input still held");
        long started = now.getAsLong(); if (started < 0) throw new IOException("Invalid staging clock");
        String id = UUID.randomUUID().toString(); Path file = directory.resolve(id + ".part");
        OutputStream output = Channels.newOutputStream(FileChannel.open(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS));
        Path witness = null;
        try {
            Object key = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS).fileKey();
            // Some Windows providers omit fileKey. A second private hardlink
            // retains identity without trusting timestamps; at most two entries.
            if (key == null) { witness = directory.resolve(UUID.randomUUID().toString() + ".part"); Files.createLink(witness, file); }
            active = new Session(id, file, witness, key, source, size, sha256, started, output);
        } catch (IOException | RuntimeException error) {
            try { output.close(); Files.delete(file); if (witness != null) Files.deleteIfExists(witness); } catch (IOException cleanup) { error.addSuppressed(cleanup); }
            throw error;
        }
        return id;
    }

    synchronized void append(String id, long offset, byte[] chunk) throws IOException {
        Session session = owned(id); requireLive(session);
        try {
            if (chunk == null || chunk.length == 0 || chunk.length > CHUNK_BYTES || offset != session.written || chunk.length > session.size - session.written) throw new IOException("Invalid staging chunk");
            checkFile(session);
            session.output.write(chunk); session.written += chunk.length;
        } catch (IOException | RuntimeException error) { discardAfterFailure(session, error); throw error; }
    }

    synchronized Completed finish(String id) throws IOException {
        Session session = owned(id); requireLive(session);
        try {
            closeOutput(session); checkFile(session);
            if (session.written != session.size || Files.size(session.file) != session.size) throw new IOException("Incomplete staging input");
            MessageDigest digest = sha256();
            try (InputStream in = Files.newInputStream(session.file, LinkOption.NOFOLLOW_LINKS)) {
                byte[] buffer = new byte[8192]; long total = 0; int count;
                while ((count = in.read(buffer)) != -1) { total += count; if (total > session.size) throw new IOException("Changed staging input"); digest.update(buffer, 0, count); }
                if (total != session.size || !MessageDigest.isEqual(digest.digest(), unhex(session.digest))) throw new IOException("Staging digest mismatch");
            }
            checkFile(session); completed = new Completed(session); active = null; return completed;
        } catch (IOException | RuntimeException error) { discardAfterFailure(session, error); throw error; }
    }

    synchronized void abort(String id) throws IOException {
        Session session = owned(id); discard(session);
    }

    @Override public synchronized void close() {
        closed = true;
        Exception failure = null;
        try {
            try { if (active != null) discard(active); }
            catch (IOException | RuntimeException error) { failure = error; }
            try { if (completed != null) completed.closeFile(); }
            catch (IOException | RuntimeException error) { failure = collectFailure(failure, error); }
        } finally {
            try { releaseLock(); }
            catch (IOException | RuntimeException error) { failure = collectFailure(failure, error); }
        }
        if (failure instanceof IOException) throw new UncheckedIOException("Staging cleanup failed", (IOException) failure);
        if (failure != null) throw (RuntimeException) failure;
    }

    private static Exception collectFailure(Exception first, Exception next) {
        if (first == null) return next;
        first.addSuppressed(next); return first;
    }

    private void requireOpen() { if (closed) throw new IllegalStateException("Staging is closed"); }
    private Session owned(String id) {
        requireOpen();
        if (id == null || !id.matches(UUID_PATTERN) || active == null || !active.id.equals(id)) throw new IllegalArgumentException("Unknown staging token");
        return active;
    }
    private void requireLive(Session session) throws IOException {
        long current;
        try { current = now.getAsLong(); } catch (RuntimeException error) { discardAfterFailure(session, error); throw new IOException("Staging clock unavailable", error); }
        if (current < session.lastObserved || current - session.started >= TTL_MS) {
            IOException error = new IOException("Staging session expired"); discardAfterFailure(session, error); throw error;
        }
        session.lastObserved = current;
    }
    private static void checkFile(Session session) throws IOException {
        BasicFileAttributes attributes = Files.readAttributes(session.file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        boolean same = session.key != null ? session.key.equals(attributes.fileKey()) :
            session.witness != null && Files.isRegularFile(session.witness, LinkOption.NOFOLLOW_LINKS) && Files.isSameFile(session.file, session.witness);
        if (!attributes.isRegularFile() || !same) throw new IOException("Staging file identity changed");
    }
    private static void closeOutput(Session session) throws IOException {
        if (session.output != null) { OutputStream held = session.output; session.output = null; held.close(); }
    }
    private static void deleteOwned(Session session) throws IOException {
        if (!Files.notExists(session.file, LinkOption.NOFOLLOW_LINKS)) { checkFile(session); Files.delete(session.file); }
        if (session.witness != null && !Files.notExists(session.witness, LinkOption.NOFOLLOW_LINKS)) {
            if (!Files.isRegularFile(session.witness, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Staging witness changed");
            Files.delete(session.witness);
        }
    }
    private void discard(Session session) throws IOException {
        IOException error = null;
        try { closeOutput(session); } catch (IOException failed) { error = failed; }
        try { deleteOwned(session); } catch (IOException failed) { if (error == null) error = failed; else error.addSuppressed(failed); }
        if (error != null) throw error;
        if (active == session) active = null;
    }
    private void discardAfterFailure(Session session, Throwable error) {
        try { discard(session); } catch (IOException failed) { error.addSuppressed(failed); }
    }
    private void releaseLock() throws IOException {
        try { if (lock != null) { lock.release(); lock = null; } }
        finally { if (lockChannel != null) { lockChannel.close(); lockChannel = null; } }
    }
    private static MessageDigest sha256() {
        try { return MessageDigest.getInstance("SHA-256"); } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static byte[] unhex(String text) {
        byte[] out = new byte[32]; for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(text.substring(i * 2, i * 2 + 2), 16); return out;
    }
    private static final class Session {
        final String id, digest; final Path file, witness; final Object key; final MediaExportSource source; final long size, started;
        long written, lastObserved; OutputStream output;
        Session(String id, Path file, Path witness, Object key, MediaExportSource source, long size, String digest, long started, OutputStream output) {
            this.id = id; this.file = file; this.witness = witness; this.key = key; this.source = source; this.size = size; this.digest = digest; this.started = started; this.lastObserved = started; this.output = output;
        }
    }

    final class Completed implements AutoCloseable {
        private final Session session; private InputStream input; private boolean removed;
        private Completed(Session session) { this.session = session; }
        MediaExportSource source() { return session.source; }
        InputStream openInput() throws IOException {
            synchronized (MediaExportStaging.this) {
                if (removed || closed || completed != this || input != null) throw new IOException("Staging input unavailable");
                checkFile(session);
                input = new FilterInputStream(Files.newInputStream(session.file, LinkOption.NOFOLLOW_LINKS)) {
                    @Override public void close() throws IOException {
                        synchronized (MediaExportStaging.this) { try { super.close(); } finally { if (input == this) input = null; } }
                    }
                };
                return input;
            }
        }
        private void closeFile() throws IOException {
            if (removed) return;
            Exception failure = null;
            try { if (input != null) input.close(); }
            catch (IOException | RuntimeException error) { failure = error; }
            try { deleteOwned(session); }
            catch (IOException | RuntimeException error) { failure = collectFailure(failure, error); }
            if (failure instanceof IOException) throw (IOException) failure;
            if (failure != null) throw (RuntimeException) failure;
            removed = true; if (completed == this) completed = null;
        }
        @Override public void close() {
            synchronized (MediaExportStaging.this) {
                try { closeFile(); } catch (IOException error) { throw new UncheckedIOException("Completed input cleanup failed", error); }
            }
        }
    }
}
