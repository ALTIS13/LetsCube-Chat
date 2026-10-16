// New minimal Android API doubles, not an Android/UID/Keystore implementation.
// KeyInfo/KeyProperties/UserManager are reused read-only from the accepted reader fixture.
export const custodyStubs = {
  "android/content/pm/ApplicationInfo.java": `package android.content.pm;
public class ApplicationInfo { public int uid; }`,
  "android/content/Context.java": `package android.content;
import android.content.pm.ApplicationInfo;
public abstract class Context {
  public abstract Context getApplicationContext();
  public abstract ApplicationInfo getApplicationInfo();
  public abstract boolean isDeviceProtectedStorage();
  public abstract <T> T getSystemService(Class<T> type);
}`,
  "android/app/Application.java": `package android.app;
public abstract class Application extends android.content.Context { }`,
  "android/os/Process.java": `package android.os;
public final class Process { public static int uid = 10500; public static int myUid() { return uid; } }`,
  "android/os/SystemClock.java": `package android.os;
public final class SystemClock { public static long now = 100; public static long elapsedRealtime() { return now; } }`,
  "android/security/keystore/KeyGenParameterSpec.java": `package android.security.keystore;
import java.security.spec.AlgorithmParameterSpec;
// Public fields below are fixture observations only, NOT Android API.
public final class KeyGenParameterSpec implements AlgorithmParameterSpec {
  public final String alias; public final int purposes, size;
  public final String[] modes, paddings; public final boolean randomized, authentication;
  private KeyGenParameterSpec(Builder b) {
    alias=b.alias; purposes=b.purposes; size=b.size; modes=b.modes; paddings=b.paddings;
    randomized=b.randomized; authentication=b.authentication;
  }
  public static final class Builder {
    private final String alias; private final int purposes; private int size;
    private String[] modes, paddings; private boolean randomized=true, authentication;
    public Builder(String alias, int purposes) { this.alias=alias; this.purposes=purposes; }
    public Builder setKeySize(int value) { size=value; return this; }
    public Builder setBlockModes(String... value) { modes=value; return this; }
    public Builder setEncryptionPaddings(String... value) { paddings=value; return this; }
    public Builder setRandomizedEncryptionRequired(boolean value) { randomized=value; return this; }
    public Builder setUserAuthenticationRequired(boolean value) { authentication=value; return this; }
    public KeyGenParameterSpec build() { return new KeyGenParameterSpec(this); }
  }
}`,
};
