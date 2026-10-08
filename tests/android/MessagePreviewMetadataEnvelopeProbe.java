package com.kub.messenger;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import com.kub.messenger.MessagePreviewMetadataEnvelope.Record;
import static com.kub.messenger.MessagePreviewMetadataEnvelope.*;

// Fictional metadata/ciphertext only. Real JCA, not Android Keystore or credential decryption.
public final class MessagePreviewMetadataEnvelopeProbe {
    private static final String INSTALL = "11111111111111111111111111111111";
    private static final String OTHER = "22222222222222222222222222222222";
    private static final String OP = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String ALIAS = "letscube.nmpv.credential.v1." + INSTALL + ".bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final byte[] DOMAIN = "LETSCUBE-NMPV-META-v1".getBytes(StandardCharsets.US_ASCII);
    private static final SecretKey KEY = new SecretKeySpec(new byte[32], "AES");
    interface Checked { void run() throws Exception; }
    private static void require(boolean condition, String name) {
        if (!condition) throw new AssertionError(name);
    }
    private static void unavailable(Checked action, String name) throws Exception {
        try { action.run(); }
        catch (Unavailable error) {
            require("UNAVAILABLE".equals(error.getMessage()) && error.getCause() == null, "FIXED_REFUSAL");
            return;
        }
        throw new AssertionError(name);
    }
    private static Header header(Kind kind) {
        return new Header(INSTALL, 8, kind, kind == Kind.EMPTY ? "" : ALIAS,
            kind == Kind.COMMITTED ? 2_000_000 : 0, 1_000_000, OP, 7, 10);
    }
    private static byte[] blob() {
        byte[] bytes = new byte[60]; Arrays.fill(bytes, (byte) 91); return bytes;
    }
    private static byte[] sealKind(Kind kind) throws Exception {
        return seal(header(kind), kind == Kind.COMMITTED ? blob() : new byte[0], KEY);
    }
    private static void text(DataOutputStream out, String text) throws Exception {
        byte[] bytes = text.getBytes(StandardCharsets.US_ASCII); out.writeShort(bytes.length); out.write(bytes);
    }
    // Independent schema producer: never calls the production encoder/validator/AAD helper.
    private static byte[] externalHeader(Header h, int version, int kind) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeInt(version); text(out, h.installation); out.writeLong(h.generation); out.writeByte(kind);
        text(out, h.alias); out.writeLong(h.expiresWallMillis); out.writeLong(h.wallHighWaterMillis);
        text(out, h.operationId); out.writeLong(h.baseGeneration); out.writeLong(h.vaultRevision);
        return bytes.toByteArray();
    }
    private static byte[] fixture(byte[] header, byte[] credential, SecretKey key) throws Exception {
        return fixture(header, credential, key, new byte[0]);
    }
    private static byte[] fixture(byte[] header, byte[] credential, SecretKey key, byte[] metadataPlaintext) throws Exception {
        ByteArrayOutputStream aadBytes = new ByteArrayOutputStream();
        DataOutputStream aad = new DataOutputStream(aadBytes);
        aad.write(DOMAIN); aad.writeInt(header.length); aad.write(header);
        aad.writeInt(credential.length); aad.write(credential);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(aadBytes.toByteArray()); byte[] tag = cipher.doFinal(metadataPlaintext);
        ByteArrayOutputStream resultBytes = new ByteArrayOutputStream();
        DataOutputStream result = new DataOutputStream(resultBytes);
        result.write("LCNMPV01".getBytes(StandardCharsets.US_ASCII));
        result.writeInt(header.length); result.write(header);
        result.writeInt(credential.length); result.write(credential);
        result.write(cipher.getIV()); result.write(tag);
        return resultBytes.toByteArray();
    }
    private static byte[] fixture(Header h, int version, int kind, byte[] credential) throws Exception {
        return fixture(externalHeader(h, version, kind), credential, KEY);
    }
    private static void kinds() throws Exception {
        for (Kind kind : Kind.values()) {
            Record record = open(sealKind(kind), INSTALL, KEY);
            require(record.header.generation == 8 && record.header.baseGeneration == 7
                && record.header.vaultRevision == 10 && record.header.kind == kind
                && OP.equals(record.header.operationId), "ROUNDTRIP_METADATA");
            require(Arrays.equals(record.credentialBytes(), kind == Kind.COMMITTED ? blob() : new byte[0]), "OPAQUE_BLOB");
        }
        Header pristine = new Header(INSTALL, 0, Kind.EMPTY, "", 0, 0, "", 0, 0);
        require(open(seal(pristine, new byte[0], KEY), INSTALL, KEY).header.generation == 0, "PRISTINE_EMPTY");
        Header retiring = new Header(INSTALL, 8, Kind.RETIRING, "", 0, 1, OP, 7, 10);
        require(open(seal(retiring, new byte[0], KEY), INSTALL, KEY).header.alias.isEmpty(), "RETIRE_NO_PRIOR_KEY");
    }
    private static void external() throws Exception {
        Record record;
        try { record = open(fixture(header(Kind.COMMITTED), 1, 2, blob()), INSTALL, KEY); }
        catch (Unavailable refused) { throw new AssertionError("EXTERNAL_AUTH"); }
        require(record.header.kind == Kind.COMMITTED && record.header.generation == 8, "EXTERNAL_SCHEMA");
        byte[] encoded = sealKind(Kind.COMMITTED);
        int length = ByteBuffer.wrap(encoded, 8, 4).getInt();
        require(Arrays.equals(Arrays.copyOfRange(encoded, 12, 12 + length), externalHeader(header(Kind.COMMITTED), 1, 2)), "CANONICAL_HEADER");
        int credentialLength = ByteBuffer.wrap(encoded, 12 + length, 4).getInt();
        ByteArrayOutputStream aad = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(aad);
        out.write(DOMAIN); out.write(encoded, 8, 4 + length + 4 + credentialLength);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, KEY, new GCMParameterSpec(128, Arrays.copyOfRange(encoded, encoded.length - 28, encoded.length - 16)));
        cipher.updateAAD(aad.toByteArray());
        require(cipher.doFinal(Arrays.copyOfRange(encoded, encoded.length - 16, encoded.length)).length == 0, "EXTERNAL_EMPTY_TAG");
    }
    private static void tamper() throws Exception {
        for (Kind kind : Kind.values()) {
            byte[] encoded = sealKind(kind);
            for (int i = 0; i < encoded.length; i++) {
                byte[] changed = encoded.clone(); changed[i] ^= 1;
                unavailable(() -> open(changed, INSTALL, KEY), "ALTERED_BYTE_REFUSED");
            }
        }
    }
    private static void keys() throws Exception {
        byte[] bytes = sealKind(Kind.COMMITTED);
        byte[] keyBytes = new byte[32]; keyBytes[0] = 1;
        unavailable(() -> open(bytes, INSTALL, new SecretKeySpec(keyBytes, "AES")), "WRONG_KEY");
        unavailable(() -> open(bytes, INSTALL, null), "MISSING_KEY");
        unavailable(() -> seal(header(Kind.COMMITTED), blob(), null), "NO_IMPLICIT_KEY_CREATION");
    }
    private static void namespace() throws Exception {
        byte[] bytes = sealKind(Kind.COMMITTED);
        unavailable(() -> open(bytes, OTHER, KEY), "FOREIGN_INSTALLATION");
        unavailable(() -> open(bytes, null, KEY), "MISSING_INSTALLATION");
        Header foreignAlias = new Header(INSTALL, 8, Kind.COMMITTED, ALIAS.replace(INSTALL, OTHER), 2, 1, OP, 7, 10);
        unavailable(() -> seal(foreignAlias, blob(), KEY), "FOREIGN_ALIAS");
        unavailable(() -> open(fixture(foreignAlias, 1, 2, blob()), INSTALL, KEY), "AUTHENTICATED_FOREIGN_ALIAS");
    }
    private static void framing() throws Exception {
        byte[] bytes = sealKind(Kind.COMMITTED);
        for (int size = 0; size < bytes.length; size++) {
            byte[] shortened = Arrays.copyOf(bytes, size);
            unavailable(() -> open(shortened, INSTALL, KEY), "TRUNCATED_REFUSED");
        }
        unavailable(() -> open(Arrays.copyOf(bytes, bytes.length + 1), INSTALL, KEY), "TRAILING_BYTE");
        for (int value : new int[] { -1, 0, 16_385, Integer.MAX_VALUE }) {
            byte[] changed = bytes.clone(); ByteBuffer.wrap(changed, 8, 4).putInt(value);
            unavailable(() -> open(changed, INSTALL, KEY), "HEADER_LENGTH");
        }
        unavailable(() -> open(null, INSTALL, KEY), "NULL_RECORD");
    }
    private static void bounds() throws Exception {
        Header h = header(Kind.COMMITTED);
        int overhead = fixture(h, 1, 2, new byte[28]).length - 28;
        byte[] largest = new byte[16_384 - overhead];
        require(seal(h, largest, KEY).length == 16_384, "TOTAL_LIMIT_ALLOWED");
        require(open(fixture(h, 1, 2, largest), INSTALL, KEY).credentialBytes().length == largest.length, "MAX_READ_ALLOWED");
        unavailable(() -> seal(h, new byte[largest.length + 1], KEY), "TOTAL_LIMIT_WRITE");
        unavailable(() -> open(fixture(h, 1, 2, new byte[largest.length + 1]), INSTALL, KEY), "TOTAL_LIMIT_READ");
        Header unsafe = new Header(INSTALL, 8, Kind.COMMITTED, ALIAS, 2, 1, OP, 7, 9_007_199_254_740_992L);
        unavailable(() -> open(fixture(unsafe, 1, 2, blob()), INSTALL, KEY), "SAFE_INTEGER");
    }
    private static void ownership() throws Exception {
        byte[] credential = blob(); byte[] encoded = seal(header(Kind.COMMITTED), credential, KEY);
        credential[0] = 0;
        Record record = open(encoded, INSTALL, KEY);
        encoded[0] = 0;
        byte[] returned = record.credentialBytes(); returned[0] = 0;
        require(Arrays.equals(record.credentialBytes(), blob()), "IMMUTABLE_SNAPSHOT");
    }
    private static void ivs() throws Exception {
        Set<String> ivs = new HashSet<>();
        for (int i = 0; i < 32; i++) {
            byte[] bytes = sealKind(Kind.COMMITTED);
            byte[] iv = Arrays.copyOfRange(bytes, bytes.length - 28, bytes.length - 16);
            require(ivs.add(Arrays.toString(iv)) && !Arrays.equals(iv, Arrays.copyOf(blob(), 12)), "FRESH_METADATA_IV");
        }
    }
    private static void expired() throws Exception {
        Header old = new Header(INSTALL, 8, Kind.COMMITTED, ALIAS, 100, 1_000_000, OP, 7, 10);
        Record record = open(seal(old, blob(), KEY), INSTALL, KEY);
        require(record.header.expiresWallMillis == 100 && record.header.wallHighWaterMillis == 1_000_000, "DORMANT_NO_EXPIRY_EXTENSION");
    }
    private static void malformedAuthenticated() throws Exception {
        unavailable(() -> open(fixture(header(Kind.EMPTY), 2, 0, new byte[0]), INSTALL, KEY), "UNKNOWN_FORMAT");
        unavailable(() -> open(fixture(header(Kind.EMPTY), 1, 9, new byte[0]), INSTALL, KEY), "UNKNOWN_KIND");
        byte[] extra = externalHeader(header(Kind.EMPTY), 1, 0);
        unavailable(() -> open(fixture(Arrays.copyOf(extra, extra.length + 1), new byte[0], KEY), INSTALL, KEY), "EXTRA_HEADER_FIELD");
        Header[] invalid = {
            new Header(INSTALL, 9, Kind.COMMITTED, ALIAS, 2, 1, OP, 7, 10),
            new Header(INSTALL, 8, Kind.COMMITTED, ALIAS, 0, 1, OP, 7, 10),
            new Header(INSTALL, 8, Kind.COMMITTED, "", 2, 1, OP, 7, 10),
            new Header(INSTALL, 8, Kind.COMMITTED, ALIAS, 2, -1, OP, 7, 10),
            new Header(INSTALL, 8, Kind.COMMITTED, ALIAS, 2, 1, "", 7, 10),
            new Header(INSTALL, 0, Kind.COMMITTED, ALIAS, 2, 1, OP, 0, 10),
            new Header(INSTALL, 8, Kind.EMPTY, ALIAS, 0, 1, OP, 7, 10),
            new Header(INSTALL, 8, Kind.PENDING, "", 0, 1, OP, 7, 10),
        };
        for (Header h : invalid) {
            unavailable(() -> seal(h, h.kind == Kind.COMMITTED ? blob() : new byte[0], KEY), "INVALID_HEADER_WRITE");
            unavailable(() -> open(fixture(h, 1, h.kind.ordinal(), h.kind == Kind.COMMITTED ? blob() : new byte[0]), INSTALL, KEY), "INVALID_HEADER_READ");
        }
        unavailable(() -> open(fixture(header(Kind.EMPTY), 1, 0, blob()), INSTALL, KEY), "NONCOMMITTED_CIPHERTEXT");
        unavailable(() -> open(fixture(header(Kind.COMMITTED), 1, 2, new byte[27]), INSTALL, KEY), "SHORT_CREDENTIAL_BLOB");
        unavailable(() -> open(fixture(extra, new byte[0], KEY, new byte[] { 1 }), INSTALL, KEY), "NONEMPTY_METADATA_PLAINTEXT");
        Header malformedAlias = new Header(INSTALL, 8, Kind.COMMITTED, ALIAS + ".foreign", 2, 1, OP, 7, 10);
        unavailable(() -> open(fixture(malformedAlias, 1, 2, blob()), INSTALL, KEY), "NONCANONICAL_ALIAS");
        byte[] nonAscii = extra.clone(); nonAscii[6] = (byte) 0x80;
        unavailable(() -> open(fixture(nonAscii, new byte[0], KEY), INSTALL, KEY), "NONASCII_HEADER");
    }
    public static void main(String[] args) throws Exception {
        switch (args[0]) {
            case "kinds": kinds(); break; case "external": external(); break;
            case "tamper": tamper(); break; case "keys": keys(); break;
            case "namespace": namespace(); break; case "framing": framing(); break;
            case "bounds": bounds(); break; case "ownership": ownership(); break;
            case "ivs": ivs(); break; case "expired": expired(); break;
            case "malformed-authenticated": malformedAuthenticated(); break;
            default: throw new AssertionError("UNKNOWN_SCENARIO");
        }
        System.out.println("PASS " + args[0]);
    }
}
