package com.kub.messenger;

import android.content.Context;
import android.os.UserManager;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;

// Inactive load-only reader. No namespace initialization, key repair, cache or public export.
final class MessagePreviewKeystoreReader {
    private static final String METADATA_PREFIX = "letscube.nmpv.metadata.v1.";
    private static final String CREDENTIAL_PREFIX = "letscube.nmpv.credential.v1.";
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    private final Context context;
    private final String installation;

    MessagePreviewKeystoreReader(Context context, String installation) throws Unavailable {
        this.context = context;
        this.installation = installation;
        if (!hex32(installation)) throw new Unavailable();
        requireContext();
    }

    private static boolean hex32(String value) {
        if (value == null || value.length() != 32) return false;
        for (int i = 0; i < 32; i++) {
            char c = value.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }
    private void requireContext() throws Unavailable {
        try {
            if (context == null || context.isDeviceProtectedStorage()) throw new Unavailable();
            UserManager manager = context.getSystemService(UserManager.class);
            if (manager == null || !manager.isUserUnlocked()) throw new Unavailable();
        } catch (RuntimeException refused) {
            throw new Unavailable();
        }
    }

    SecretKey loadMetadata() throws Unavailable {
        return load(METADATA_PREFIX + installation);
    }
    SecretKey loadCredential(String alias) throws Unavailable {
        String prefix = CREDENTIAL_PREFIX + installation + ".";
        if (alias == null || alias.length() != prefix.length() + 32
            || !alias.startsWith(prefix) || !hex32(alias.substring(prefix.length()))) throw new Unavailable();
        return load(alias);
    }
    private SecretKey load(String alias) throws Unavailable {
        try {
            requireContext(); // Before lookup.
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            Key key = store.getKey(alias, null);
            if (!(key instanceof SecretKey) || !KeyProperties.KEY_ALGORITHM_AES.equals(key.getAlgorithm())) throw new Unavailable();
            SecretKeyFactory factory = SecretKeyFactory.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            KeyInfo info = (KeyInfo) factory.getKeySpec((SecretKey) key, KeyInfo.class);
            if (info == null || !alias.equals(info.getKeystoreAlias())
                || info.getKeySize() != 256 || info.getOrigin() != KeyProperties.ORIGIN_GENERATED
                || info.getPurposes() != (KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                || !Arrays.equals(info.getBlockModes(), new String[] { KeyProperties.BLOCK_MODE_GCM })
                || !Arrays.equals(info.getEncryptionPaddings(), new String[] { KeyProperties.ENCRYPTION_PADDING_NONE })
                || info.isUserAuthenticationRequired()) throw new Unavailable();
            requireContext(); // Before returning the borrowed key.
            return (SecretKey) key;
        } catch (GeneralSecurityException | IOException | RuntimeException refused) {
            throw new Unavailable();
        }
    }
}
