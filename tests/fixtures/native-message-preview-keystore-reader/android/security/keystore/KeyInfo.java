package android.security.keystore;

import java.security.spec.KeySpec;

// Only getters consumed by the reader. Public fixture fields are NOT Android API.
public final class KeyInfo implements KeySpec {
    public String alias;
    public int size = 256, origin = 1, purposes = 3;
    public String[] modes = { "GCM" }, paddings = { "NoPadding" };
    public boolean authentication;
    public String getKeystoreAlias() { return alias; }
    public int getKeySize() { return size; }
    public int getOrigin() { return origin; }
    public int getPurposes() { return purposes; }
    public String[] getBlockModes() { return modes; }
    public String[] getEncryptionPaddings() { return paddings; }
    public boolean isUserAuthenticationRequired() { return authentication; }
}
