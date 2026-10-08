package com.kub.messenger;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Inactive supplied-key codec. Syntax and an authenticated record are not live provision authority.
final class MessagePreviewCredentialEnvelope {
    private static final int MAX_ACCESS = 8192, PLAIN_OVERHEAD = 132;
    private static final int IV_BYTES = 12, TAG_BYTES = 16, MAX_BLOB = 8352;
    private static final byte[] DOMAIN = "LETSCUBE-NMPV-CREDENTIAL-v1".getBytes(StandardCharsets.US_ASCII);
    private static final String ALIAS_PREFIX = "letscube.nmpv.credential.v1.";

    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    private static void require(boolean value) throws Unavailable { if (!value) throw new Unavailable(); }
    private static boolean hex32(String value) {
        if (value == null || value.length() != 32) return false;
        for (int i = 0; i < 32; i++) {
            char c = value.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }
    private static boolean uuid(String value) {
        return value != null && value.length() == 36 && MessagePreviewVerificationState.uuid(value);
    }
    private static void header(MessagePreviewMetadataEnvelope.Header h) throws Unavailable {
        require(h != null && h.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED && hex32(h.installation)
            && MessagePreviewVerificationState.safe(h.generation) && h.generation > 0
            && MessagePreviewVerificationState.safe(h.baseGeneration) && h.baseGeneration < 9007199254740991L
            && h.generation == h.baseGeneration + 1 && MessagePreviewVerificationState.safe(h.vaultRevision)
            && MessagePreviewVerificationState.safe(h.expiresWallMillis) && h.expiresWallMillis > 0
            && MessagePreviewVerificationState.safe(h.wallHighWaterMillis) && hex32(h.operationId));
        String prefix = ALIAS_PREFIX + h.installation + ".";
        require(h.alias != null && h.alias.length() == prefix.length() + 32 && h.alias.startsWith(prefix)
            && hex32(h.alias.substring(prefix.length())));
    }
    private static void inputs(MessagePreviewMetadataEnvelope.Header h, MessagePreviewVaultFence.Owner owner,
            String access, long expiry, SecretKey key) throws Unavailable {
        header(h);
        require(owner != null && uuid(owner.recipient) && uuid(owner.session) && uuid(owner.device)
            && MessagePreviewVerificationState.safe(owner.accountEpoch));
        require(access != null && access.length() > 0 && access.length() <= MAX_ACCESS);
        for (int i = 0; i < access.length(); i++) require(access.charAt(i) >= 33 && access.charAt(i) <= 126);
        require(MessagePreviewVerificationState.safe(expiry) && expiry > 0 && expiry == h.expiresWallMillis);
        require(key != null && "AES".equals(key.getAlgorithm()));
        // One outer journal budget, including this blob; all sizes are known before plaintext/provider work.
        require(44L + 83 + h.alias.length() + h.operationId.length() + PLAIN_OVERHEAD + access.length()
            + IV_BYTES + TAG_BYTES <= 16384);
    }
    private static void ascii(ByteBuffer output, String value) {
        for (int i = 0; i < value.length(); i++) output.put((byte) value.charAt(i));
    }
    private static void text(ByteBuffer output, String value) {
        output.putShort((short) value.length()); ascii(output, value);
    }
    private static byte[] aad(MessagePreviewMetadataEnvelope.Header h) {
        ByteBuffer output = ByteBuffer.allocate(83 + h.alias.length() + h.operationId.length());
        output.putInt(1); text(output, h.installation);
        output.putLong(h.generation).put((byte) 2); text(output, h.alias);
        output.putLong(h.expiresWallMillis).putLong(h.wallHighWaterMillis); text(output, h.operationId);
        output.putLong(h.baseGeneration).putLong(h.vaultRevision);
        return output.array();
    }
    private static void parameters(Cipher cipher, byte[] iv) throws GeneralSecurityException, Unavailable {
        require(iv != null && iv.length == IV_BYTES && cipher.getParameters() != null);
        GCMParameterSpec spec = cipher.getParameters().getParameterSpec(GCMParameterSpec.class);
        require(spec.getTLen() == 128 && Arrays.equals(spec.getIV(), iv));
    }
    private static void clear(byte[] bytes) { if (bytes != null) Arrays.fill(bytes, (byte) 0); }

    static byte[] seal(MessagePreviewMetadataEnvelope.Header committedHeader, MessagePreviewVaultFence.Owner expectedOwner,
            String access, long validatedExpiry, SecretKey suppliedCredentialKey) throws Unavailable {
        byte[] plaintext = null, aad = null, encrypted = null, iv = null;
        try {
            inputs(committedHeader, expectedOwner, access, validatedExpiry, suppliedCredentialKey);
            ByteBuffer output = ByteBuffer.allocate(PLAIN_OVERHEAD + access.length()); plaintext = output.array();
            output.putInt(1).putInt(access.length()); ascii(output, access);
            ascii(output, expectedOwner.recipient); ascii(output, expectedOwner.session); ascii(output, expectedOwner.device);
            output.putLong(expectedOwner.accountEpoch).putLong(validatedExpiry);
            aad = aad(committedHeader);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, suppliedCredentialKey);
            iv = cipher.getIV(); parameters(cipher, iv);
            cipher.updateAAD(DOMAIN); cipher.updateAAD(aad);
            encrypted = cipher.doFinal(plaintext);
            require(encrypted.length == plaintext.length + TAG_BYTES && iv.length + encrypted.length <= MAX_BLOB);
            return ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted).array();
        } catch (GeneralSecurityException | RuntimeException refused) { throw new Unavailable(); }
        finally { clear(plaintext); clear(aad); clear(encrypted); clear(iv); }
    }

    private static boolean sameHeader(MessagePreviewMetadataEnvelope.Header a, MessagePreviewMetadataEnvelope.Header b) {
        return a.installation.equals(b.installation) && a.generation == b.generation && a.kind == b.kind
            && a.alias.equals(b.alias) && a.expiresWallMillis == b.expiresWallMillis
            && a.wallHighWaterMillis == b.wallHighWaterMillis && a.operationId.equals(b.operationId)
            && a.baseGeneration == b.baseGeneration && a.vaultRevision == b.vaultRevision;
    }
    private static String decodedUuid(ByteBuffer input) throws Unavailable {
        byte[] bytes = new byte[36];
        try {
            input.get(bytes); String value = new String(bytes, StandardCharsets.US_ASCII); require(uuid(value)); return value;
        } finally { clear(bytes); }
    }

    static boolean verifyMatch(MessagePreviewMetadataEnvelope.Record authenticatedRecord,
            MessagePreviewMetadataEnvelope.Header expectedHeader, MessagePreviewVaultFence.Owner expectedOwner,
            String expectedAccess, long expectedExpiry, SecretKey suppliedCredentialKey) throws Unavailable {
        byte[] blob = null, plaintext = null, aad = null, iv = null, decodedAccess = null, expected = null;
        try {
            inputs(expectedHeader, expectedOwner, expectedAccess, expectedExpiry, suppliedCredentialKey);
            require(authenticatedRecord != null); header(authenticatedRecord.header);
            blob = authenticatedRecord.credentialBytes(); require(blob.length >= 161 && blob.length <= MAX_BLOB);
            aad = aad(authenticatedRecord.header); iv = Arrays.copyOfRange(blob, 0, IV_BYTES);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, suppliedCredentialKey, new GCMParameterSpec(128, iv));
            parameters(cipher, iv); cipher.updateAAD(DOMAIN); cipher.updateAAD(aad);
            plaintext = cipher.doFinal(blob, IV_BYTES, blob.length - IV_BYTES);
            require(plaintext.length >= 133 && plaintext.length <= 8324);
            ByteBuffer input = ByteBuffer.wrap(plaintext); require(input.getInt() == 1);
            int accessLength = input.getInt();
            require(accessLength >= 1 && accessLength <= MAX_ACCESS && plaintext.length == PLAIN_OVERHEAD + accessLength);
            decodedAccess = new byte[accessLength]; input.get(decodedAccess);
            for (byte value : decodedAccess) require(value >= 33 && value <= 126);
            String recipient = decodedUuid(input), session = decodedUuid(input), device = decodedUuid(input);
            long accountEpoch = input.getLong(), expiry = input.getLong();
            require(!input.hasRemaining() && MessagePreviewVerificationState.safe(accountEpoch)
                && MessagePreviewVerificationState.safe(expiry) && expiry > 0 && expiry == authenticatedRecord.header.expiresWallMillis);
            expected = expectedAccess.getBytes(StandardCharsets.US_ASCII);
            return sameHeader(authenticatedRecord.header, expectedHeader) && recipient.equals(expectedOwner.recipient)
                && session.equals(expectedOwner.session) && device.equals(expectedOwner.device)
                && accountEpoch == expectedOwner.accountEpoch && expiry == expectedExpiry
                && MessageDigest.isEqual(decodedAccess, expected);
        } catch (GeneralSecurityException | RuntimeException refused) { throw new Unavailable(); }
        finally { clear(blob); clear(plaintext); clear(aad); clear(iv); clear(decodedAccess); clear(expected); }
    }
}
