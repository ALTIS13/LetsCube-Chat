package fixture;

import android.os.Looper;
import java.util.ArrayDeque;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Finite, separately owned queues. Every task runs on its real owner thread. */
public final class Queues {
    private static final Map<Looper, ArrayDeque<Runnable>> pending = new IdentityHashMap<>();
    private static final Map<Looper, ExecutorService> threads = new IdentityHashMap<>();
    static {
        for (Looper looper : new Looper[] { Looper.MAIN, Looper.PLUGINS, Looper.IO }) {
            pending.put(looper, new ArrayDeque<>());
            String name = looper == Looper.MAIN ? "main" : looper == Looper.PLUGINS ? "CapacitorPlugins" : "native-update-io";
            threads.put(looper, Executors.newSingleThreadExecutor(work -> {
                Thread thread = new Thread(work, name); thread.setDaemon(true); return thread;
            }));
        }
    }
    public static void require(Looper owner, String message) {
        if (Looper.myLooper() != owner) throw new AssertionError(message);
    }
    public static void post(Looper owner, Runnable work) { pending.get(owner).add(work); }
    public static void run(Looper owner, Runnable work) throws Exception {
        threads.get(owner).submit(() -> {
            Looper.CURRENT.set(owner);
            try { work.run(); } finally { Looper.CURRENT.remove(); }
        }).get(2, TimeUnit.SECONDS);
    }
    public static boolean step(Looper owner) throws Exception {
        Runnable work = pending.get(owner).poll();
        if (work == null) return false;
        run(owner, work); return true;
    }
    public static void drain() throws Exception {
        for (int i = 0; i < 40; i++) {
            boolean work = step(Looper.MAIN);
            work |= step(Looper.PLUGINS); work |= step(Looper.IO);
            if (!work) return;
        }
        throw new AssertionError("UNBOUNDED_PLUGIN_QUEUE");
    }
    public static void close() { for (ExecutorService thread : threads.values()) thread.shutdownNow(); }
}
