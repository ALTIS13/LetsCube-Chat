package com.kub.messenger;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import javax.crypto.SecretKey;

// Inactive checked-byte primitive. The future platform owner supplies its sole owned backend.
final class MessagePreviewJournalIO {
    private static final int MAX_BYTES = 16_384;
    enum Result { CHECKED, UNAVAILABLE }
    interface Backend {
        InputStream openRead() throws IOException;
        OutputStream startWrite() throws IOException;
        void sync(OutputStream stream) throws IOException;
        // Finalization/rollback own and release the borrowed stream, including on failure.
        void finishWrite(OutputStream stream) throws IOException;
        void failWrite(OutputStream stream) throws IOException;
    }
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    private final Backend backend;
    MessagePreviewJournalIO(Backend backend) {
        if (backend == null) throw new IllegalArgumentException("UNAVAILABLE");
        this.backend = backend;
    }
    private byte[] bytes() throws IOException, Unavailable {
        try (InputStream stream = backend.openRead()) {
            ByteArrayOutputStream output = new ByteArrayOutputStream(1024);
            byte[] buffer = new byte[1024];
            while (true) {
                int count = stream.read(buffer, 0, Math.min(buffer.length, MAX_BYTES + 1 - output.size()));
                if (count < 0) break;
                if (count == 0) throw new Unavailable();
                output.write(buffer, 0, count);
                if (output.size() > MAX_BYTES) throw new Unavailable();
            }
            return output.toByteArray();
        }
    }
    synchronized MessagePreviewMetadataEnvelope.Record read(String installation, SecretKey metadataKey) throws Unavailable {
        try {
            return MessagePreviewMetadataEnvelope.open(bytes(), installation, metadataKey);
        } catch (IOException | RuntimeException | MessagePreviewMetadataEnvelope.Unavailable refused) {
            throw new Unavailable();
        }
    }
    // CHECKED is byte I/O evidence only, never an operation/access/retirement ACK.
    synchronized Result write(byte[] envelope, String installation, SecretKey metadataKey) {
        OutputStream stream = null;
        boolean finishAttempted = false;
        try {
            if (envelope == null || envelope.length > MAX_BYTES) return Result.UNAVAILABLE;
            byte[] snapshot = envelope.clone();
            MessagePreviewMetadataEnvelope.open(snapshot, installation, metadataKey);
            stream = backend.startWrite();
            stream.write(snapshot);
            stream.flush();
            backend.sync(stream);
            finishAttempted = true;
            backend.finishWrite(stream);
            stream = null;
            byte[] readback = bytes();
            if (!Arrays.equals(snapshot, readback)) return Result.UNAVAILABLE;
            MessagePreviewMetadataEnvelope.open(readback, installation, metadataKey);
            return Result.CHECKED;
        } catch (IOException | RuntimeException | Unavailable | MessagePreviewMetadataEnvelope.Unavailable refused) {
            return Result.UNAVAILABLE;
        } finally {
            // Never roll an uncertain completed/attempted commit back or replay it here.
            if (stream != null && !finishAttempted) {
                try { backend.failWrite(stream); }
                catch (IOException | RuntimeException refused) { /* The result remains unavailable. */ }
            }
        }
    }
}
