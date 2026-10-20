package com.kub.messenger;

import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import sun.misc.Unsafe;

/** Executes the complete Runtime methods; no catalog, APK, Android service or network. */
public final class AndroidUpdateFinalizationProbe {
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    private static Field field(String name) throws Exception {
        Field field = AndroidUpdateRuntime.class.getDeclaredField(name); field.setAccessible(true); return field;
    }
    public static void main(String[] args) throws Exception {
        String scenario = args[0];
        ExecutorService worker = Executors.newSingleThreadExecutor(work -> new Thread(work, "runtime-owned-worker"));
        Path directory = Files.createTempDirectory("android-installer-finalization-");
        Path record = directory.resolve("state.json");
        CountDownLatch release = new CountDownLatch(1), blocked = new CountDownLatch(1), completed = new CountDownLatch(1);
        AtomicReference<JSObject> reply = new AtomicReference<>();
        AtomicReference<Throwable> callbackError = new AtomicReference<>();
        try {
            Field unsafeField = Unsafe.class.getDeclaredField("theUnsafe"); unsafeField.setAccessible(true);
            AndroidUpdateRuntime runtime = (AndroidUpdateRuntime)((Unsafe)unsafeField.get(null)).allocateInstance(AndroidUpdateRuntime.class);
            field("context").set(runtime, new android.content.Context());
            field("worker").set(runtime, worker);
            field("record").set(runtime, new AtomicFile(record.toFile()));
            field("release").set(runtime, new AndroidUpdatePolicy.Release("0.1.33", 34, 3, "0".repeat(64),
                "https://api.letscube.ru/releases/files/android/0.1.33/letscube-0.1.33.apk"));
            field("phase").set(runtime, "installing"); field("generation").setLong(runtime, 7);
            field("instance").set(null, runtime);
            AtomicFile.refuseWrite = scenario.equals("persist-refused");
            worker.execute(() -> {
                blocked.countDown();
                try { if (!release.await(2, TimeUnit.SECONDS)) throw new AssertionError("FINITE_QUEUE_TIMEOUT"); }
                catch (InterruptedException failure) { Thread.currentThread().interrupt(); }
            });
            check(blocked.await(2, TimeUnit.SECONDS), "OWNED_WORKER_NOT_HELD");
            runtime.finishInstaller(scenario.equals("wrong-owner") ? 6 : 7, "INSTALLER", status -> {
                try {
                    check(Thread.currentThread().getName().equals("runtime-owned-worker"), "CALLBACK_NOT_ON_OWNED_WORKER");
                    if (scenario.equals("complete")) {
                        check(Files.readString(record).contains("\"phase\":\"ready\""), "CALLBACK_BEFORE_DURABLE_FINALIZATION");
                    }
                    reply.set(status);
                } catch (Throwable failure) { callbackError.set(failure); }
                finally { completed.countDown(); }
            });
            check("installing".equals(field("phase").get(runtime)) && !Files.exists(record), "FINALIZATION_BYPASSED_RUNTIME_QUEUE");
            if (scenario.equals("superseded")) {
                field("generation").setLong(runtime, 8); field("phase").set(runtime, "checking");
            }
            release.countDown();
            check(completed.await(2, TimeUnit.SECONDS), "OWNED_FINALIZATION_NOT_COMPLETED");
            if (callbackError.get() != null) throw new AssertionError(callbackError.get());
            JSObject status = reply.get(); check(status != null, "FINALIZATION_STATUS_MISSING");
            if (scenario.equals("wrong-owner")) {
                check("installing".equals(status.get("phase")) && !Files.exists(record), "WRONG_INSTALL_OWNER_FINALIZED");
                check(field("generation").getLong(runtime) == 7, "WRONG_OWNER_CHANGED_GENERATION");
            } else if (scenario.equals("superseded")) {
                check("checking".equals(status.get("phase")) && !Files.exists(record), "SUPERSEDED_INSTALL_CHANGED_SUCCESSOR");
                check(field("generation").getLong(runtime) == 8, "SUCCESSOR_GENERATION_LOST");
            } else if (scenario.equals("persist-refused")) {
                check("failed".equals(status.get("phase")) && "STATE".equals(status.get("error")), "PERSIST_REFUSAL_CLAIMED_READY");
            } else {
                check("ready".equals(status.get("phase")), "RUNTIME_STILL_INSTALLING");
                check(((Number)status.get("bytes")).longValue() == 3, "READY_BYTES_NOT_RESTORED");
                check(AndroidUpdateRuntime.get(new android.content.Context()) == runtime, "ACTIVITY_RECREATION_REPLACED_APP_RUNTIME");
                check("ready".equals(runtime.status().get("phase")), "RECREATED_ACTIVITY_STILL_INSTALLING");
                check(field("generation").getLong(runtime) == 7, "FINALIZATION_CHANGED_OWNER");
            }
            System.out.println("PASS_RUNTIME_FINALIZATION " + scenario);
        } finally {
            release.countDown(); worker.shutdownNow(); check(worker.awaitTermination(2, TimeUnit.SECONDS), "OWNED_WORKER_NOT_STOPPED");
            field("instance").set(null, null);
            Files.deleteIfExists(record); Files.delete(directory);
        }
    }
}
