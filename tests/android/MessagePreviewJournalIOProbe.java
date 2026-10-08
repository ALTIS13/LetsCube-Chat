package com.kub.messenger;

import java.io.FilterInputStream;
import java.io.FilterOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import com.kub.messenger.MessagePreviewMetadataEnvelope.Header;
import com.kub.messenger.MessagePreviewMetadataEnvelope.Kind;
import com.kub.messenger.MessagePreviewJournalIO.Result;

// Actual owned JVM files + injected I/O faults, not Android AtomicFile/Keystore proof.
public final class MessagePreviewJournalIOProbe {
    private static final String INSTALL = "11111111111111111111111111111111";
    private static final SecretKey KEY = new SecretKeySpec(new byte[32], "AES");
    private static final class RevocableKey implements SecretKey {
        private static final long serialVersionUID = 1L;
        volatile boolean revoked;
        public String getAlgorithm() { if (revoked) throw new IllegalStateException("FIXTURE"); return "AES"; }
        public String getFormat() { return "RAW"; }
        public byte[] getEncoded() { return KEY.getEncoded(); }
    }
    private static Path root;
    private static void require(boolean condition, String oracle) {
        if (!condition) throw new AssertionError(oracle);
    }
    private static byte[] envelope(long generation) throws Exception {
        Header header = new Header(INSTALL, generation, Kind.EMPTY, "", 0, 1,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", generation - 1, generation);
        return MessagePreviewMetadataEnvelope.seal(header, new byte[0], KEY);
    }
    private static final class Disk implements MessagePreviewJournalIO.Backend {
        final Path base, pending;
        final StringBuilder order = new StringBuilder();
        String fault = "";
        int starts, rollsBack, finishes, readBytes, reads;
        boolean finished;
        byte[] replacement;
        RevocableKey revokeAfterFinish;
        CountDownLatch inSync, releaseSync;
        Disk(String name) throws Exception {
            Path dir = Files.createDirectory(root.resolve(name));
            base = dir.resolve("journal"); pending = dir.resolve("journal.new");
        }
        public InputStream openRead() throws IOException {
            order.append('R'); reads++;
            if (fault.equals("readback") && finished) throw new IOException("FIXTURE");
            return new FilterInputStream(Files.newInputStream(base)) {
                public int read(byte[] bytes, int offset, int length) throws IOException {
                    if (fault.equals("no-progress")) return 0;
                    int count = super.read(bytes, offset, length);
                    if (count > 0) readBytes += count;
                    return count;
                }
                public void close() throws IOException {
                    super.close(); if (fault.equals("read-close")) throw new IOException("FIXTURE");
                }
            };
        }
        public OutputStream startWrite() throws IOException {
            order.append('B'); starts++;
            if (fault.equals("start")) throw new IOException("FIXTURE");
            return new FilterOutputStream(Files.newOutputStream(pending)) {
                public void write(byte[] bytes, int offset, int length) throws IOException {
                    order.append('W'); out.write(bytes, offset, length);
                    if (fault.equals("write")) throw new IOException("FIXTURE");
                }
                public void flush() throws IOException {
                    order.append('L'); super.flush();
                    if (fault.equals("flush")) throw new IOException("FIXTURE");
                }
            };
        }
        public void sync(OutputStream stream) throws IOException {
            order.append('S');
            if (inSync != null) {
                inSync.countDown();
                try { if (!releaseSync.await(5, TimeUnit.SECONDS)) throw new IOException("FIXTURE_TIMEOUT"); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException("FIXTURE_INTERRUPTED"); }
            }
            if (fault.equals("sync")) throw new IOException("FIXTURE");
            try (FileChannel channel = FileChannel.open(pending, StandardOpenOption.WRITE)) { channel.force(true); }
        }
        public void finishWrite(OutputStream stream) throws IOException {
            order.append('F'); finishes++; finished = true;
            stream.close();
            if (fault.equals("finish")) throw new IOException("FIXTURE");
            if (fault.equals("finish-noop")) return;
            Files.move(pending, base, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            if (replacement != null) Files.write(base, replacement);
            if (revokeAfterFinish != null) revokeAfterFinish.revoked = true;
        }
        public void failWrite(OutputStream stream) throws IOException {
            order.append('X'); rollsBack++;
            stream.close(); Files.deleteIfExists(pending);
            if (fault.equals("rollback")) throw new IOException("FIXTURE");
        }
    }
    private static MessagePreviewJournalIO io(Disk disk) { return new MessagePreviewJournalIO(disk); }
    private static void unreadable(MessagePreviewJournalIO io, String oracle) throws Exception {
        try { io.read(INSTALL, KEY); }
        catch (MessagePreviewJournalIO.Unavailable error) {
            require("UNAVAILABLE".equals(error.getMessage()) && error.getCause() == null, "FIXED_IO_REFUSAL"); return;
        }
        throw new AssertionError(oracle);
    }
    private static void healthy() throws Exception {
        Disk disk = new Disk("healthy"); byte[] bytes = envelope(8);
        require(io(disk).write(bytes, INSTALL, KEY) == Result.CHECKED, "CHECKED_WRITE");
        require(disk.order.toString().startsWith("BWLSF") && disk.order.toString().endsWith("R")
            && disk.finishes == 1 && disk.rollsBack == 0, "CHECKED_ORDER");
        require(Arrays.equals(Files.readAllBytes(disk.base), bytes), "EXACT_BYTES");
        require(io(disk).read(INSTALL, KEY).header.generation == 8, "AUTHENTICATED_READ");
    }
    private static void invalidBeforeIo() throws Exception {
        Disk disk = new Disk("invalid"); MessagePreviewJournalIO io = io(disk);
        byte[] bad = envelope(8); bad[bad.length - 1] ^= 1;
        require(io.write(bad, INSTALL, KEY) == Result.UNAVAILABLE
            && io.write(new byte[16_385], INSTALL, KEY) == Result.UNAVAILABLE
            && io.write(null, INSTALL, KEY) == Result.UNAVAILABLE
            && io.write(envelope(8), INSTALL, null) == Result.UNAVAILABLE, "BAD_WRITE_REFUSED");
        require(disk.starts == 0 && disk.reads == 0 && disk.rollsBack == 0, "INVALID_BEFORE_IO");
    }
    private static void readBound() throws Exception {
        Disk disk = new Disk("bound"); Files.write(disk.base, new byte[32_768]);
        unreadable(io(disk), "OVERSIZE_READ_REFUSED");
        require(disk.readBytes == 16_385, "READ_OBSERVATION_CEILING");
    }
    private static void readClose() throws Exception {
        Disk disk = new Disk("close"); Files.write(disk.base, envelope(8)); disk.fault = "read-close";
        unreadable(io(disk), "READ_CLOSE_REFUSED");
    }
    private static void noProgress() throws Exception {
        Disk disk = new Disk("progress"); Files.write(disk.base, envelope(8)); disk.fault = "no-progress";
        unreadable(io(disk), "ZERO_READ_REFUSED");
    }
    private static void writeFaults() throws Exception {
        for (String fault : new String[] { "start", "write", "flush", "sync" }) {
            Disk disk = new Disk(fault); byte[] old = envelope(7); Files.write(disk.base, old); disk.fault = fault;
            require(io(disk).write(envelope(8), INSTALL, KEY) == Result.UNAVAILABLE, "FAILED_WRITE_UNKNOWN");
            require(disk.finishes == 0 && disk.rollsBack == (fault.equals("start") ? 0 : 1), "OWNED_ROLLBACK_ONLY");
            require(Arrays.equals(Files.readAllBytes(disk.base), old), "PREVIOUS_BYTES_PRESERVED");
        }
    }
    private static void finishUnknown() throws Exception {
        for (String fault : new String[] { "finish", "finish-noop" }) {
            Disk disk = new Disk(fault); Files.write(disk.base, envelope(7)); disk.fault = fault;
            require(io(disk).write(envelope(8), INSTALL, KEY) == Result.UNAVAILABLE, "FINISH_UNKNOWN");
            require(disk.finishes == 1 && disk.rollsBack == 0, "NO_ROLLBACK_AFTER_FINISH");
        }
    }
    private static void readbackFaults() throws Exception {
        Disk disk = new Disk("readback"); disk.fault = "readback";
        require(io(disk).write(envelope(8), INSTALL, KEY) == Result.UNAVAILABLE
            && disk.finishes == 1 && disk.rollsBack == 0, "READBACK_UNKNOWN");
        Disk mismatch = new Disk("mismatch"); mismatch.replacement = envelope(7);
        require(io(mismatch).write(envelope(8), INSTALL, KEY) == Result.UNAVAILABLE, "READBACK_EXACT_NOT_ANY_AUTH");
        require(mismatch.rollsBack == 0, "NO_ROLLBACK_READBACK");
    }
    private static void missingAuth() throws Exception {
        Disk missing = new Disk("missing"); unreadable(io(missing), "MISSING_IS_NOT_G0");
        Disk corrupt = new Disk("corrupt"); byte[] bad = envelope(8); bad[bad.length - 1] ^= 1;
        Files.write(corrupt.base, bad); unreadable(io(corrupt), "READ_AUTH_REQUIRED");
        require(corrupt.starts == 0 && corrupt.rollsBack == 0 && Arrays.equals(Files.readAllBytes(corrupt.base), bad), "READ_HAS_NO_RESET");
    }
    private static void readbackKey() throws Exception {
        Disk disk = new Disk("key"); RevocableKey key = new RevocableKey(); disk.revokeAfterFinish = key;
        require(io(disk).write(envelope(8), INSTALL, key) == Result.UNAVAILABLE, "READBACK_REAUTHENTICATES_KEY");
        require(disk.finishes == 1 && disk.rollsBack == 0, "KEY_LOSS_NO_ROLLBACK");
    }
    private static void locking() throws Exception {
        Disk disk = new Disk("locking"); Files.write(disk.base, envelope(7));
        disk.inSync = new CountDownLatch(1); disk.releaseSync = new CountDownLatch(1);
        MessagePreviewJournalIO journal = io(disk);
        AtomicReference<Result> written = new AtomicReference<>();
        AtomicReference<Long> generation = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        byte[] next = envelope(8);
        Thread writer = new Thread(() -> written.set(journal.write(next, INSTALL, KEY)));
        CountDownLatch readerStarted = new CountDownLatch(1);
        Thread reader = new Thread(() -> {
            readerStarted.countDown();
            try { generation.set(journal.read(INSTALL, KEY).header.generation); }
            catch (Throwable error) { failure.set(error); }
        });
        boolean serialized = false;
        try {
            writer.start(); require(disk.inSync.await(2, TimeUnit.SECONDS), "WRITER_HELD_CONTROL");
            reader.start(); require(readerStarted.await(2, TimeUnit.SECONDS), "READER_STARTED_CONTROL");
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (reader.getState() != Thread.State.BLOCKED && reader.isAlive() && System.nanoTime() < deadline) Thread.yield();
            serialized = reader.getState() == Thread.State.BLOCKED && disk.reads == 0;
        } finally {
            disk.releaseSync.countDown(); writer.join(5_000); reader.join(5_000);
        }
        require(!writer.isAlive() && !reader.isAlive(), "OWNED_THREADS_FINISHED");
        require(serialized && failure.get() == null && written.get() == Result.CHECKED && Long.valueOf(8).equals(generation.get()), "SERIALIZED_READ_WRITE");
    }
    public static void main(String[] args) throws Exception {
        root = Files.createDirectory(Paths.get(args[1]).resolve("files-" + args[0]));
        switch (args[0]) {
            case "healthy": healthy(); break; case "invalid-before-io": invalidBeforeIo(); break;
            case "read-bound": readBound(); break; case "read-close": readClose(); break;
            case "no-progress": noProgress(); break; case "write-faults": writeFaults(); break;
            case "finish-unknown": finishUnknown(); break; case "readback-faults": readbackFaults(); break;
            case "missing-auth": missingAuth(); break; default: throw new AssertionError("UNKNOWN_SCENARIO");
            case "readback-key": readbackKey(); break; case "locking": locking(); break;
        }
        System.out.println("PASS " + args[0]);
    }
}
