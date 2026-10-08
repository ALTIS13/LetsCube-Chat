import { markerIOStubs } from "./message-preview-marker-io-stubs.fixture.mjs";

// Reused Android policy/FD doubles and real JVM files. NOT Android/Keystore/durability proof.
export const initializerStubs = {
  ...markerIOStubs,
  "android/content/Context.java": markerIOStubs["android/content/Context.java"].replace(
    "public abstract ApplicationInfo getApplicationInfo();",
    "public abstract ApplicationInfo getApplicationInfo();\n  public <T> T getSystemService(Class<T> type) { return type.cast(getSystemService(USER_SERVICE)); }"),
  "android/os/SystemClock.java": `package android.os;
public final class SystemClock {
  public static volatile long value = 100;
  public static long elapsedRealtime() { return value; }
}`,
  "android/security/keystore/KeyGenParameterSpec.java": `package android.security.keystore;
import java.security.spec.AlgorithmParameterSpec;
public final class KeyGenParameterSpec implements AlgorithmParameterSpec {
  public final String alias; public final int purposes, size;
  public final String[] modes, paddings; public final boolean random, auth;
  private KeyGenParameterSpec(Builder b) {
    alias=b.alias; purposes=b.purposes; size=b.size; modes=b.modes; paddings=b.paddings; random=b.random; auth=b.auth;
  }
  public static final class Builder {
    private final String alias; private final int purposes;
    private int size; private String[] modes, paddings; private boolean random, auth;
    public Builder(String alias, int purposes) { this.alias=alias; this.purposes=purposes; }
    public Builder setKeySize(int size) { this.size=size; return this; }
    public Builder setBlockModes(String... modes) { this.modes=modes; return this; }
    public Builder setEncryptionPaddings(String... paddings) { this.paddings=paddings; return this; }
    public Builder setRandomizedEncryptionRequired(boolean random) { this.random=random; return this; }
    public Builder setUserAuthenticationRequired(boolean auth) { this.auth=auth; return this; }
    public KeyGenParameterSpec build() { return new KeyGenParameterSpec(this); }
  }
}`,
  "android/util/AtomicFile.java": markerIOStubs["android/util/AtomicFile.java"]
    .replace("public static int reads", "public static java.util.function.Consumer<String> onEvent;\n  private static void event(String name) { if (onEvent != null) onEvent.accept(name); }\n  public static int reads")
    .replace("reads++; return", 'reads++; event("journal-read"); return')
    .replace("starts++;", 'starts++; event("journal-start");')
    .replace("finishes++;", 'finishes++; event("journal-finish");'),
};
