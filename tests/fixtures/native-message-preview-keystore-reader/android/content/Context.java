package android.content;

// Narrow Android API fixture, not a platform/storage/user-isolation implementation.
public abstract class Context {
    public abstract boolean isDeviceProtectedStorage();
    public abstract Object getSystemService(String name);
    public final <T> T getSystemService(Class<T> type) {
        return type.cast(getSystemService("user"));
    }
}
