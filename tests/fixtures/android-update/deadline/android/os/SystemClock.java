package android.os;

/** JVM clock leaf; Android's SDK jar contains throwing stubs, not a runtime. */
public final class SystemClock {
    public static long advance;
    public static long elapsedRealtime() { return System.nanoTime() / 1000000 + advance; }
}
