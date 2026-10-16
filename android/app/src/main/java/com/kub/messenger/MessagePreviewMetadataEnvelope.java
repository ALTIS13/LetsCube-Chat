package com.kub.messenger;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Inactive binary codec: supplied metadata key only, no storage or credential decryption.
final class MessagePreviewMetadataEnvelope {
    private static final int MAX_BYTES = 16_384;
    private static final int FORMAT = 1;
    private static final int IV_BYTES = 12, TAG_BYTES = 16;
    private static final int FRAMING_BYTES = 8 + 4 + 4 + IV_BYTES + TAG_BYTES;
    private static final String ALIAS_PREFIX = "letscube.nmpv.credential.v1.";
    private static final int MAX_ALIAS_BYTES = ALIAS_PREFIX.length() + 32 + 1 + 32;
    private static final int BASE_HEADER_BYTES = 83;
    private static final int MAX_HEADER_BYTES = BASE_HEADER_BYTES + MAX_ALIAS_BYTES + 32;
    private static final byte[] MAGIC = "LCNMPV01".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] DOMAIN = "LETSCUBE-NMPV-META-v1".getBytes(StandardCharsets.US_ASCII);

    enum Kind { EMPTY, PENDING, COMMITTED, RETIRING }

    static final class Header {
        final String installation, alias, operationId;
        final long generation, expiresWallMillis, wallHighWaterMillis, baseGeneration, vaultRevision;
        final Kind kind;
        Header(String installation, long generation, Kind kind, String alias, long expiresWallMillis,
               long wallHighWaterMillis, String operationId, long baseGeneration, long vaultRevision) {
            this.installation = installation; this.generation = generation; this.kind = kind;
            this.alias = alias; this.expiresWallMillis = expiresWallMillis;
            this.wallHighWaterMillis = wallHighWaterMillis; this.operationId = operationId;
            this.baseGeneration = baseGeneration; this.vaultRevision = vaultRevision;
        }
    }
    static final class Record {
        final Header header;
        private final byte[] credential;
        private Record(Header header, byte[] credential) {
            this.header = header; this.credential = credential.clone();
        }
        byte[] credentialBytes() { return credential.clone(); }
    }
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }

    private static boolean safe(long value) { return MessagePreviewVerificationState.safe(value); }
    private static boolean hex32(String value) {
        if (value == null || value.length() != 32) return false;
        for (int i = 0; i < 32; i++) {
            char c = value.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }
    private static boolean ownedAlias(String alias, String installation) {
        String prefix = ALIAS_PREFIX + installation + ".";
        return alias.length() == prefix.length() + 32 && alias.startsWith(prefix)
            && hex32(alias.substring(prefix.length()));
    }
    private static boolean valid(Header h, int credentialLength) {
        if (h == null || h.kind == null || !hex32(h.installation)
            || h.alias == null || h.alias.length() > MAX_ALIAS_BYTES
            || h.operationId == null || h.operationId.length() > 32
            || !safe(h.generation) || !safe(h.baseGeneration) || !safe(h.vaultRevision)
            || !safe(h.expiresWallMillis) || !safe(h.wallHighWaterMillis)) return false;
        if (h.generation == 0) {
            if (h.kind != Kind.EMPTY || !h.operationId.isEmpty() || h.baseGeneration != 0
                || h.vaultRevision != 0 || h.expiresWallMillis != 0) return false;
        } else if (!hex32(h.operationId) || h.generation != h.baseGeneration + 1) return false;
        if (h.kind == Kind.COMMITTED) {
            return h.expiresWallMillis > 0 && credentialLength >= 28 && ownedAlias(h.alias, h.installation);
        }
        if (credentialLength != 0 || h.expiresWallMillis != 0) return false;
        switch (h.kind) {
            case EMPTY: return h.alias.isEmpty();
            case PENDING: return ownedAlias(h.alias, h.installation);
            case RETIRING: return h.alias.isEmpty() || ownedAlias(h.alias, h.installation);
            default: return false;
        }
    }
    private static void text(ByteBuffer output, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.US_ASCII);
        output.putShort((short) bytes.length).put(bytes);
    }
    private static String text(ByteBuffer input, int maximum) throws Unavailable {
        int length = input.getShort() & 0xffff;
        if (length > maximum || length > input.remaining()) throw new Unavailable();
        byte[] bytes = new byte[length];
        input.get(bytes);
        for (byte value : bytes) {
            if (value < 32 || value > 126) throw new Unavailable();
        }
        return new String(bytes, StandardCharsets.US_ASCII);
    }
    private static void writeHeader(ByteBuffer output, Header h) {
        output.putInt(FORMAT); text(output, h.installation);
        output.putLong(h.generation).put((byte) h.kind.ordinal()); text(output, h.alias);
        output.putLong(h.expiresWallMillis).putLong(h.wallHighWaterMillis); text(output, h.operationId);
        output.putLong(h.baseGeneration).putLong(h.vaultRevision);
    }
    private static Header readHeader(ByteBuffer input) throws Unavailable {
        if (input.getInt() != FORMAT) throw new Unavailable();
        String installation = text(input, 32);
        long generation = input.getLong();
        int kind = input.get() & 0xff;
        if (kind > 3) throw new Unavailable();
        String alias = text(input, MAX_ALIAS_BYTES);
        long expires = input.getLong(), wall = input.getLong();
        String operation = text(input, 32);
        long base = input.getLong(), revision = input.getLong();
        if (input.hasRemaining()) throw new Unavailable();
        return new Header(installation, generation, Kind.values()[kind], alias, expires, wall, operation, base, revision);
    }
    private static void key(SecretKey supplied) throws Unavailable {
        if (supplied == null || !"AES".equals(supplied.getAlgorithm())) throw new Unavailable();
    }

    static byte[] seal(Header header, byte[] credentialBytes, SecretKey suppliedKey) throws Unavailable {
        try {
            if (credentialBytes == null || credentialBytes.length > MAX_BYTES
                || !valid(header, credentialBytes.length)) throw new Unavailable();
            int headerLength = BASE_HEADER_BYTES + header.alias.length() + header.operationId.length();
            long total = (long) FRAMING_BYTES + headerLength + credentialBytes.length;
            if (total > MAX_BYTES) throw new Unavailable();
            key(suppliedKey);
            // Whole-record bounds precede copying input or asking the provider to do crypto.
            byte[] credential = credentialBytes.clone();
            ByteBuffer output = ByteBuffer.allocate((int) total);
            output.put(MAGIC).putInt(headerLength); writeHeader(output, header);
            output.putInt(credential.length).put(credential);
            int aadEnd = output.position();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, suppliedKey);
            cipher.updateAAD(DOMAIN); cipher.updateAAD(output.array(), MAGIC.length, aadEnd - MAGIC.length);
            byte[] tag = cipher.doFinal(new byte[0]), iv = cipher.getIV();
            if (iv == null || iv.length != IV_BYTES || tag.length != TAG_BYTES) throw new Unavailable();
            output.put(iv).put(tag);
            if (output.hasRemaining()) throw new Unavailable();
            return output.array();
        } catch (GeneralSecurityException | RuntimeException refused) {
            throw new Unavailable();
        }
    }
    static Record open(byte[] encoded, String expectedInstallation, SecretKey suppliedKey) throws Unavailable {
        try {
            if (encoded == null || encoded.length > MAX_BYTES || encoded.length < FRAMING_BYTES + BASE_HEADER_BYTES
                || !hex32(expectedInstallation)) throw new Unavailable();
            key(suppliedKey);
            byte[] snapshot = encoded.clone();
            ByteBuffer framing = ByteBuffer.wrap(snapshot);
            for (byte value : MAGIC) if (framing.get() != value) throw new Unavailable();
            int headerLength = framing.getInt();
            if (headerLength < BASE_HEADER_BYTES || headerLength > MAX_HEADER_BYTES
                || headerLength > framing.remaining() - 4 - IV_BYTES - TAG_BYTES) throw new Unavailable();
            framing.position(MAGIC.length + 4 + headerLength);
            int credentialLength = framing.getInt();
            if (credentialLength < 0 || credentialLength != framing.remaining() - IV_BYTES - TAG_BYTES) throw new Unavailable();
            int credentialStart = framing.position();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, suppliedKey,
                new GCMParameterSpec(128, snapshot, snapshot.length - IV_BYTES - TAG_BYTES, IV_BYTES));
            cipher.updateAAD(DOMAIN);
            cipher.updateAAD(snapshot, MAGIC.length, credentialStart + credentialLength - MAGIC.length);
            // Authenticate only the empty metadata payload; the credential blob is opaque AAD.
            if (cipher.doFinal(snapshot, snapshot.length - TAG_BYTES, TAG_BYTES).length != 0) throw new Unavailable();
            Header header = readHeader(ByteBuffer.wrap(snapshot, MAGIC.length + 4, headerLength).slice());
            if (!valid(header, credentialLength) || !header.installation.equals(expectedInstallation)) throw new Unavailable();
            return new Record(header, Arrays.copyOfRange(snapshot, credentialStart, credentialStart + credentialLength));
        } catch (GeneralSecurityException | RuntimeException refused) {
            throw new Unavailable();
        }
    }
}
