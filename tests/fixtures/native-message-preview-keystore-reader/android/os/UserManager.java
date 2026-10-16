package android.os;

// Narrow Android API fixture. Mutable state is only a fictional unlocked-user oracle.
public class UserManager {
    public boolean unlocked = true;
    public boolean fail;
    public boolean isUserUnlocked() {
        if (fail) throw new IllegalStateException("FIXTURE");
        return unlocked;
    }
}
