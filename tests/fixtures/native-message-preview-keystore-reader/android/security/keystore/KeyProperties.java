package android.security.keystore;

// Literal values checked against installed Android36 android.jar, not production policy.
public final class KeyProperties {
    public static final String KEY_ALGORITHM_AES = "AES";
    public static final String BLOCK_MODE_GCM = "GCM";
    public static final String ENCRYPTION_PADDING_NONE = "NoPadding";
    public static final int ORIGIN_GENERATED = 1;
    public static final int PURPOSE_ENCRYPT = 1;
    public static final int PURPOSE_DECRYPT = 2;
    private KeyProperties() {}
}
