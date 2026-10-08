package com.kub.messenger;

import java.util.Arrays;

// Literal fictional markers. No namespace, key, generation or authentication authority.
public final class MessagePreviewInstallationMarkerProbe {
    private static final byte[] NONCE = {
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
        (byte) 0x88, (byte) 0x99, (byte) 0xaa, (byte) 0xbb,
        (byte) 0xcc, (byte) 0xdd, (byte) 0xee, (byte) 0xff
    };
    // Independent format oracle: no production encoder/constants produce these bytes.
    private static final byte[] MARKER = {
        0x4c, 0x43, 0x4e, 0x4d, 0x50, 0x56, 0x49, 0x31,
        0x00, 0x00, 0x00, 0x01,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
        (byte) 0x88, (byte) 0x99, (byte) 0xaa, (byte) 0xbb,
        (byte) 0xcc, (byte) 0xdd, (byte) 0xee, (byte) 0xff
    };
    interface Checked { void run() throws Exception; }
    private static void require(boolean condition, String oracle) {
        if (!condition) throw new AssertionError(oracle);
    }
    private static MessagePreviewInstallationMarker.Unavailable refused(Checked action, String oracle) throws Exception {
        try { action.run(); }
        catch (MessagePreviewInstallationMarker.Unavailable unavailable) { return unavailable; }
        throw new AssertionError(oracle);
    }
    private static void scenario(String name) throws Exception {
        switch (name) {
            case "literal-encode":
                require(Arrays.equals(MessagePreviewInstallationMarker.encode(NONCE), MARKER), "MARKER_LITERAL_ENCODE");
                break;
            case "literal-decode":
                require("00112233445566778899aabbccddeeff".equals(MessagePreviewInstallationMarker.decode(MARKER)), "LOWERCASE_INSTALLATION");
                byte[] high = MARKER.clone(); Arrays.fill(high, 12, 28, (byte) 0xff);
                require("ffffffffffffffffffffffffffffffff".equals(MessagePreviewInstallationMarker.decode(high)), "UNSIGNED_NONCE");
                byte[] zero = MARKER.clone(); Arrays.fill(zero, 12, 28, (byte) 0);
                require("00000000000000000000000000000000".equals(MessagePreviewInstallationMarker.decode(zero)), "ZERO_NONCE_CODEC_ONLY");
                break;
            case "nonce-bounds":
                refused(() -> MessagePreviewInstallationMarker.encode(null), "NULL_NONCE");
                for (int n = 0; n <= 32; n++) {
                    if (n == 16) continue;
                    final byte[] input = new byte[n];
                    refused(() -> MessagePreviewInstallationMarker.encode(input), "EXACT_NONCE_SIZE");
                }
                require(MessagePreviewInstallationMarker.encode(new byte[16]).length == 28, "EXACT_MARKER_SIZE_WRITE");
                break;
            case "frame-bounds":
                refused(() -> MessagePreviewInstallationMarker.decode(null), "NULL_MARKER");
                for (int n = 0; n < 28; n++) {
                    final byte[] input = Arrays.copyOf(MARKER, n);
                    refused(() -> MessagePreviewInstallationMarker.decode(input), "TRUNCATED_MARKER");
                }
                for (int n = 29; n <= 32; n++) {
                    final byte[] input = Arrays.copyOf(MARKER, n);
                    refused(() -> MessagePreviewInstallationMarker.decode(input), "EXACT_SIZE_READ");
                }
                break;
            case "magic":
                for (int n = 0; n < 8; n++) {
                    final byte[] input = MARKER.clone(); input[n] ^= 1;
                    refused(() -> MessagePreviewInstallationMarker.decode(input), "MAGIC_REFUSED");
                }
                break;
            case "version":
                for (int n = 8; n < 12; n++) {
                    final byte[] input = MARKER.clone(); input[n] ^= 2;
                    refused(() -> MessagePreviewInstallationMarker.decode(input), "VERSION_REFUSED");
                }
                byte[] little = MARKER.clone(); little[8] = 1; little[11] = 0;
                refused(() -> MessagePreviewInstallationMarker.decode(little), "LITTLE_ENDIAN_VERSION_REFUSED");
                byte[] negative = MARKER.clone(); Arrays.fill(negative, 8, 12, (byte) 0xff);
                refused(() -> MessagePreviewInstallationMarker.decode(negative), "NEGATIVE_VERSION_REFUSED");
                break;
            case "ownership":
                byte[] nonce = NONCE.clone(), untouched = nonce.clone();
                byte[] first = MessagePreviewInstallationMarker.encode(nonce);
                require(Arrays.equals(nonce, untouched), "INPUT_UNCHANGED");
                Arrays.fill(nonce, (byte) 0);
                require(Arrays.equals(first, MARKER), "ENCODE_SNAPSHOT");
                first[0] = 0; first[12] = 1;
                byte[] second = MessagePreviewInstallationMarker.encode(NONCE);
                require(first != second && Arrays.equals(second, MARKER), "OUTPUT_INDEPENDENT");
                String installation = MessagePreviewInstallationMarker.decode(second);
                Arrays.fill(second, (byte) 0);
                require("00112233445566778899aabbccddeeff".equals(installation), "DECODE_VALUE_INDEPENDENT");
                break;
            case "refusal":
                MessagePreviewInstallationMarker.Unavailable error = refused(
                    () -> MessagePreviewInstallationMarker.encode(null), "REFUSAL_PRESENT");
                require("UNAVAILABLE".equals(error.getMessage()), "REFUSAL_FIXED_MESSAGE");
                require(error.getCause() == null, "REFUSAL_NO_CAUSE");
                require(error.getStackTrace().length == 0, "REFUSAL_NO_STACK");
                error.addSuppressed(new Exception("FICTIONAL"));
                require(error.getSuppressed().length == 0, "REFUSAL_NO_SUPPRESSED");
                error.fillInStackTrace();
                error.setStackTrace(new StackTraceElement[] {new StackTraceElement("Fixture", "probe", "Fixture.java", 1)});
                require(error.getStackTrace().length == 0, "REFUSAL_STACK_IMMUTABLE");
                boolean causeRefused = false;
                try { error.initCause(new Exception("FICTIONAL")); }
                catch (IllegalStateException expected) { causeRefused = true; }
                require(causeRefused && error.getCause() == null, "REFUSAL_CAUSE_IMMUTABLE");
                break;
            default: throw new AssertionError("UNKNOWN_SCENARIO");
        }
    }
    public static void main(String[] args) throws Exception {
        require(args.length == 1, "ONE_SCENARIO");
        scenario(args[0]);
        System.out.println("PASS " + args[0]);
    }
}
