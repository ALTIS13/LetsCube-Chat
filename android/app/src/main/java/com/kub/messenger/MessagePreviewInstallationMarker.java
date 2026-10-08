package com.kub.messenger;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

// Plain reservation bytes only; not authenticated metadata or generation authority.
final class MessagePreviewInstallationMarker {
    private static final byte[] MAGIC = "LCNMPVI1".getBytes(StandardCharsets.US_ASCII);
    private static final int VERSION = 1;
    private static final String HEX = "0123456789abcdef";

    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }

    private MessagePreviewInstallationMarker() { }

    static byte[] encode(byte[] nonce) throws Unavailable {
        if (nonce == null || nonce.length != 16) throw new Unavailable();
        byte[] snapshot = nonce.clone();
        return ByteBuffer.allocate(28).order(ByteOrder.BIG_ENDIAN)
            .put(MAGIC).putInt(VERSION).put(snapshot).array();
    }

    static String decode(byte[] encoded) throws Unavailable {
        if (encoded == null || encoded.length != 28) throw new Unavailable();
        ByteBuffer input = ByteBuffer.wrap(encoded.clone()).order(ByteOrder.BIG_ENDIAN);
        byte[] magic = new byte[8];
        input.get(magic);
        if (!Arrays.equals(magic, MAGIC) || input.getInt() != VERSION) throw new Unavailable();
        char[] installation = new char[32];
        for (int i = 0; i < 16; i++) {
            int value = input.get() & 0xff;
            installation[2 * i] = HEX.charAt(value >>> 4);
            installation[2 * i + 1] = HEX.charAt(value & 15);
        }
        return new String(installation);
    }
}
