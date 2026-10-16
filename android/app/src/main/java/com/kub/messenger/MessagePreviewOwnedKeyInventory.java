package com.kub.messenger;

import java.util.Enumeration;

// Pure supplied-enumeration scan; no Keystore/UID, admission or pristine-state authority.
final class MessagePreviewOwnedKeyInventory {
    private static final String PREFIX = "letscube.nmpv.";
    private static final int MAX_ENTRIES = 256;
    private static final int MAX_ALIAS_CHARS = 256;

    interface CurrentCheck { boolean isCurrent() throws Exception; }
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }

    private MessagePreviewOwnedKeyInventory() { }

    private static void requireCurrent(CurrentCheck current) throws Exception {
        if (!current.isCurrent()) throw new Unavailable();
    }

    static void requireNoOwnedAlias(Enumeration<String> aliases, CurrentCheck current) throws Unavailable {
        if (aliases == null || current == null) throw new Unavailable();
        int count = 0;
        try {
            while (true) {
                requireCurrent(current);
                boolean more = aliases.hasMoreElements();
                if (!more) {
                    requireCurrent(current);
                    return;
                }
                if (count >= MAX_ENTRIES) throw new Unavailable();
                requireCurrent(current);
                String alias = aliases.nextElement();
                count++;
                if (alias == null || alias.length() > MAX_ALIAS_CHARS || alias.startsWith(PREFIX)) throw new Unavailable();
            }
        } catch (Exception refused) { throw new Unavailable(); }
    }
}
