package com.kub.messenger;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

// Fictional foreground/clock authority, real controlled JVM threads; no Android/storage effects.
public final class MessagePreviewInitializationGateProbe {
    private interface Attempt { void run() throws Exception; }
    private static void check(boolean value, String oracle) {
        if (!value) throw new AssertionError(oracle);
    }
    private static void refused(Attempt action, String oracle) throws Exception {
        try { action.run(); }
        catch (MessagePreviewInitializationGate.Unavailable failure) {
            check("UNAVAILABLE".equals(failure.getMessage()), "FIXED_STATUS");
            check(failure.getCause() == null, "REFUSAL_NO_CAUSE");
            check(failure.getStackTrace().length == 0, "REFUSAL_NO_STACK");
            failure.addSuppressed(new Exception("FICTIONAL_PRIVATE"));
            check(failure.getSuppressed().length == 0, "REFUSAL_NO_SUPPRESSED");
            return;
        } catch (Exception wrong) { throw new AssertionError("CHECKED_REFUSAL_REQUIRED"); }
        throw new AssertionError(oracle);
    }
    private static final class Authority implements MessagePreviewInitializationGate.ForegroundAuthority {
        volatile Object snapshot = new Object();
        volatile boolean captureFails, checkFails, returnsNull, returnsUnknown;
        volatile Runnable onCheck;
        @Override public Object capture() throws Exception {
            if (captureFails) throw new Exception("FICTIONAL_PRIVATE");
            return returnsNull ? null : returnsUnknown ? new Object() : snapshot;
        }
        @Override public boolean isCurrent(Object captured) throws Exception {
            if (checkFails) throw new Exception("FICTIONAL_PRIVATE");
            if (onCheck != null) onCheck.run();
            return captured != null && captured == snapshot;
        }
    }
    private static final class Clock implements MessagePreviewInitializationGate.MonotonicClock {
        volatile long value;
        volatile boolean fails;
        @Override public long nowMillis() throws Exception {
            if (fails) throw new Exception("FICTIONAL_PRIVATE");
            return value;
        }
    }
    private static final class Job {
        final Attempt action;
        final CountDownLatch done = new CountDownLatch(1);
        Throwable failure;
        Job(Attempt action) { this.action = action; }
        void await() throws Exception {
            check(done.await(3, TimeUnit.SECONDS), "FINITE_WORKER_TIMEOUT");
            if (failure instanceof AssertionError) throw (AssertionError) failure;
            if (failure instanceof Exception) throw (Exception) failure;
            if (failure != null) throw new AssertionError("UNEXPECTED_WORKER_FAILURE");
        }
    }
    private static final class Worker implements AutoCloseable {
        final LinkedBlockingQueue<Job> jobs = new LinkedBlockingQueue<>();
        final Job stop = new Job(null);
        final Thread thread = new Thread(() -> {
            try {
                while (true) {
                    Job job = jobs.take();
                    if (job == stop) return;
                    try { job.action.run(); } catch (Throwable failure) { job.failure = failure; }
                    finally { job.done.countDown(); }
                }
            } catch (InterruptedException failure) { throw new AssertionError("WORKER_INTERRUPTED"); }
        }, "fictional-init-worker");
        Worker() { thread.start(); }
        Job start(Attempt action) { Job job = new Job(action); jobs.add(job); return job; }
        void on(Attempt action) throws Exception { start(action).await(); }
        @Override public void close() throws Exception {
            jobs.add(stop); thread.join(3_000);
            check(!thread.isAlive(), "FINITE_WORKER_CLOSED");
        }
    }
    private static final class Fixture implements AutoCloseable {
        final Authority authority = new Authority();
        final Clock clock = new Clock();
        final Worker worker = new Worker();
        final MessagePreviewInitializationGate gate;
        Fixture() throws Exception {
            gate = new MessagePreviewInitializationGate(authority, clock, Thread.currentThread(), worker.thread);
        }
        MessagePreviewInitializationGate.Permit admit() throws Exception { return gate.admit(gate.capture()); }
        void initialize(MessagePreviewInitializationGate.Permit permit) throws Exception {
            worker.on(() -> {
                gate.consume(permit); gate.currentBeforeEffect(permit); gate.markEffectAttempted(permit);
                gate.currentBeforeEffect(permit); gate.finishInitialized(permit);
            });
        }
        @Override public void close() throws Exception { worker.close(); }
    }
    private static void healthy() throws Exception {
        try (Fixture f = new Fixture()) {
            refused(() -> new MessagePreviewInitializationGate(f.authority, f.clock,
                Thread.currentThread(), Thread.currentThread()), "NON_MAIN_WORKER_REQUIRED");
            refused(() -> new MessagePreviewInitializationGate(f.authority, f.clock,
                f.worker.thread, Thread.currentThread()), "CREATION_MAIN_IDENTITY_REQUIRED");
            refused(() -> new MessagePreviewInitializationGate(null, f.clock,
                Thread.currentThread(), f.worker.thread), "AUTHORITY_REQUIRED");
            refused(() -> new MessagePreviewInitializationGate(f.authority, null,
                Thread.currentThread(), f.worker.thread), "CLOCK_REQUIRED");
            refused(() -> new MessagePreviewInitializationGate(f.authority, f.clock,
                Thread.currentThread(), null), "WORKER_REQUIRED");
            MessagePreviewInitializationGate.ForegroundHandle handle = f.gate.capture();
            MessagePreviewInitializationGate.Permit p = f.gate.admit(handle);
            refused(() -> f.gate.admit(handle), "IDLE_ADMISSION_REQUIRED");
            f.initialize(p);
            refused(f.gate::capture, "INITIALIZED_TERMINAL");
            refused(() -> f.gate.admit(handle), "INITIALIZED_TERMINAL");
        }
    }
    private static void budget() throws Exception {
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> f.gate.consume(p));
            f.clock.value = 9_999;
            f.worker.on(() -> f.gate.currentBeforeEffect(p));
            f.clock.value = 10_000;
            f.worker.on(() -> refused(() -> f.gate.currentBeforeEffect(p), "DEADLINE_10000_REFUSED"));
            f.clock.value = 9_999;
            f.worker.on(() -> refused(() -> f.gate.currentBeforeEffect(p), "EXPIRED_NEVER_CURRENT_AGAIN"));
            f.worker.on(() -> f.gate.settleFailure(p));
        }
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> { f.gate.consume(p); f.gate.markEffectAttempted(p); });
            f.clock.value = 9_999;
            f.worker.on(() -> f.gate.finishInitialized(p));
        }
        try (Fixture f = new Fixture()) {
            f.clock.value = Long.MAX_VALUE - 10_000;
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.clock.value = Long.MAX_VALUE - 1;
            f.initialize(p);
        }
        try (Fixture f = new Fixture()) {
            f.clock.value = Long.MAX_VALUE - 9_999;
            MessagePreviewInitializationGate.ForegroundHandle h = f.gate.capture();
            refused(() -> f.gate.admit(h), "ADMISSION_HEADROOM_REQUIRED");
        }
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> { f.gate.consume(p); f.gate.markEffectAttempted(p); });
            f.clock.value = 9_999;
            f.authority.onCheck = () -> f.clock.value = 10_000;
            f.worker.on(() -> refused(() -> f.gate.finishInitialized(p), "AUTHORITY_CHECK_SPENT_BUDGET_REFUSED"));
            f.worker.on(() -> f.gate.settleFailure(p));
        }
    }
    private static void handles() throws Exception {
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate other = new MessagePreviewInitializationGate(
                f.authority, f.clock, Thread.currentThread(), f.worker.thread);
            MessagePreviewInitializationGate.ForegroundHandle foreign = other.capture();
            refused(() -> f.gate.admit(foreign), "HANDLE_ISSUER_REQUIRED");
            refused(() -> f.gate.admit(null), "NULL_HANDLE_REFUSED");
            MessagePreviewInitializationGate.ForegroundHandle old = f.gate.capture();
            f.gate.invalidate();
            refused(() -> f.gate.admit(old), "INVALIDATED_HANDLE_REFUSED");
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.gate.invalidate();
            f.worker.on(() -> refused(() -> f.gate.consume(p), "INVALIDATED_UNCONSUMED_REFUSED"));
            refused(() -> f.admit(), "INVALIDATED_SLOT_REMAINS_BUSY");
            f.worker.on(() -> f.gate.settleFailure(p));
            f.initialize(f.admit());
        }
    }
    private static void permits() throws Exception {
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate other = new MessagePreviewInitializationGate(
                f.authority, f.clock, Thread.currentThread(), f.worker.thread);
            MessagePreviewInitializationGate.Permit foreign = other.admit(other.capture());
            MessagePreviewInitializationGate.Permit own = f.admit();
            f.worker.on(() -> {
                other.consume(foreign); other.markEffectAttempted(foreign);
                refused(() -> f.gate.consume(foreign), "FOREIGN_PERMIT_REFUSED");
                refused(() -> f.gate.settleFailure(foreign), "PRIVATE_PERMIT_OWNER_REQUIRED");
                refused(() -> f.gate.consume(null), "NULL_PERMIT_REFUSED");
                f.gate.consume(own); f.gate.markEffectAttempted(own); f.gate.finishInitialized(own);
                other.settleFailure(foreign);
            });
        }
    }
    private static void oneUse() throws Exception {
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            refused(() -> f.gate.consume(p), "EXACT_WORKER_REQUIRED");
            refused(() -> f.gate.settleFailure(p), "EXACT_WORKER_REQUIRED");
            f.worker.on(() -> {
                refused(() -> f.gate.currentBeforeEffect(p), "CONSUMED_BEFORE_EFFECT_REQUIRED");
                refused(() -> f.gate.markEffectAttempted(p), "CONSUMED_BEFORE_EFFECT_REQUIRED");
                refused(() -> f.gate.finishInitialized(p), "CONSUMED_BEFORE_FINISH_REQUIRED");
                f.gate.consume(p);
                refused(() -> f.gate.consume(p), "ONE_USE_CONSUME_REQUIRED");
                refused(() -> f.gate.finishInitialized(p), "EFFECT_MARK_BEFORE_FINISH_REQUIRED");
                f.gate.currentBeforeEffect(p); f.gate.markEffectAttempted(p); f.gate.finishInitialized(p);
            });
        }
    }
    private static void stale() throws Exception {
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit(); Object captured = f.authority.snapshot;
            f.authority.snapshot = new Object();
            f.worker.on(() -> refused(() -> f.gate.consume(p), "STALE_CONSUME_REFUSED"));
            f.authority.snapshot = captured;
            f.worker.on(() -> refused(() -> f.gate.consume(p), "STALE_PERMIT_NEVER_REVIVES"));
            f.worker.on(() -> f.gate.settleFailure(p));
            f.initialize(f.admit());
        }
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> f.gate.consume(p)); f.authority.snapshot = new Object();
            f.worker.on(() -> refused(() -> f.gate.markEffectAttempted(p), "STALE_EFFECT_REFUSED"));
            f.worker.on(() -> f.gate.settleFailure(p)); f.initialize(f.admit());
        }
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> { f.gate.consume(p); f.gate.markEffectAttempted(p); });
            f.authority.snapshot = new Object();
            f.worker.on(() -> refused(() -> f.gate.finishInitialized(p), "CURRENT_FINAL_ACK_REQUIRED"));
            f.worker.on(() -> f.gate.settleFailure(p));
            refused(f.gate::capture, "STALE_AFTER_EFFECT_TERMINAL");
        }
    }
    private static void heldWorker() throws Exception {
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit a = f.admit();
            CountDownLatch held = new CountDownLatch(1), release = new CountDownLatch(1);
            Job old = f.worker.start(() -> {
                f.gate.consume(a); held.countDown();
                check(release.await(3, TimeUnit.SECONDS), "FINITE_HELD_TIMEOUT");
                f.gate.settleFailure(a);
            });
            try {
                check(held.await(3, TimeUnit.SECONDS), "ACTUAL_WORKER_CONSUMED");
                long before = System.nanoTime(); f.gate.invalidate();
                check(System.nanoTime() - before < TimeUnit.SECONDS.toNanos(1), "MEMORY_INVALIDATION_NO_WAIT");
                MessagePreviewInitializationGate.ForegroundHandle b = f.gate.capture();
                refused(() -> f.gate.admit(b), "BUSY_HELD_UNTIL_SETTLED");
                check(old.done.getCount() == 1, "OLD_WORKER_STILL_HELD");
            } finally { release.countDown(); }
            old.await();
            MessagePreviewInitializationGate.Permit b = f.admit();
            f.worker.on(() -> {
                refused(() -> f.gate.finishInitialized(a), "LATE_A_FINISH_REFUSED");
                refused(() -> f.gate.settleFailure(a), "LATE_A_SETTLEMENT_REFUSED");
                f.gate.consume(b); f.gate.markEffectAttempted(b); f.gate.finishInitialized(b);
            });
        }
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> f.gate.consume(p)); f.gate.close();
            refused(f.gate::capture, "CLOSED_CAPTURE_REFUSED");
            f.worker.on(() -> {
                refused(() -> f.gate.currentBeforeEffect(p), "CLOSED_PERMIT_REFUSED");
                f.gate.settleFailure(p);
            });
            refused(() -> f.admit(), "CLOSE_PERMANENT");
        }
    }
    private static void retry() throws Exception {
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.ForegroundHandle oldHandle = f.gate.capture();
            MessagePreviewInitializationGate.Permit a = f.gate.admit(oldHandle);
            f.worker.on(() -> { f.gate.consume(a); f.gate.settleFailure(a); });
            refused(() -> f.gate.admit(oldHandle), "FRESH_HANDLE_AFTER_SETTLED_FAILURE");
            MessagePreviewInitializationGate.Permit b = f.admit();
            f.worker.on(() -> {
                refused(() -> f.gate.currentBeforeEffect(a), "LATE_A_CHECK_REFUSED");
                refused(() -> f.gate.markEffectAttempted(a), "LATE_A_MARK_REFUSED");
                refused(() -> f.gate.finishInitialized(a), "LATE_A_FINISH_REFUSED");
                refused(() -> f.gate.settleFailure(a), "LATE_A_SETTLEMENT_REFUSED");
                f.gate.consume(b); f.gate.currentBeforeEffect(b); f.gate.markEffectAttempted(b); f.gate.finishInitialized(b);
            });
        }
    }
    private static void effectTerminal() throws Exception {
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> { f.gate.consume(p); f.gate.markEffectAttempted(p); f.gate.settleFailure(p); });
            refused(f.gate::capture, "EFFECT_FAILURE_TERMINAL");
        }
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> { f.gate.consume(p); f.gate.markEffectAttempted(p); });
            f.clock.value = 10_000;
            f.worker.on(() -> {
                refused(() -> f.gate.finishInitialized(p), "EFFECT_TIMEOUT_NO_ACK"); f.gate.settleFailure(p);
            });
            refused(f.gate::capture, "EFFECT_TIMEOUT_TERMINAL");
        }
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> { f.gate.consume(p); f.gate.markEffectAttempted(p); });
            f.gate.invalidate(); f.worker.on(() -> f.gate.settleFailure(p));
            refused(f.gate::capture, "EFFECT_INVALIDATION_TERMINAL");
        }
    }
    private static void clock() throws Exception {
        try (Fixture f = new Fixture()) {
            f.clock.value = -1; refused(f.gate::capture, "NEGATIVE_MONOTONIC_REFUSED");
            f.clock.value = 0; refused(f.gate::capture, "UNSAFE_CLOCK_NEVER_REVIVES");
        }
        try (Fixture f = new Fixture()) {
            f.clock.value = 100; MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> f.gate.consume(p)); f.clock.value = 99;
            f.worker.on(() -> refused(() -> f.gate.currentBeforeEffect(p), "BACKWARD_MONOTONIC_REFUSED"));
            f.clock.value = 100;
            f.worker.on(() -> refused(() -> f.gate.currentBeforeEffect(p), "REGRESSED_PERMIT_NEVER_REVIVES"));
            f.worker.on(() -> f.gate.settleFailure(p));
            refused(f.gate::capture, "REGRESSED_GATE_NEVER_REVIVES");
        }
        try (Fixture f = new Fixture()) {
            f.clock.fails = true; refused(f.gate::capture, "CLOCK_LOOKUP_REFUSED");
        }
    }
    private static void authority() throws Exception {
        try (Fixture f = new Fixture()) {
            f.authority.returnsNull = true; refused(f.gate::capture, "NULL_SNAPSHOT_REFUSED");
            f.authority.returnsNull = false; f.authority.returnsUnknown = true;
            refused(f.gate::capture, "UNKNOWN_SNAPSHOT_REFUSED");
            f.authority.returnsUnknown = false; f.authority.captureFails = true;
            refused(f.gate::capture, "CAPTURE_LOOKUP_REFUSED");
            f.authority.captureFails = false; f.authority.checkFails = true;
            refused(f.gate::capture, "CURRENCY_LOOKUP_REFUSED");
            f.authority.checkFails = false;
            MessagePreviewInitializationGate.ForegroundHandle h = f.gate.capture();
            f.authority.snapshot = new Object();
            refused(() -> f.gate.admit(h), "STALE_ADMISSION_REFUSED");
            f.initialize(f.admit());
        }
        try (Fixture f = new Fixture()) {
            MessagePreviewInitializationGate.Permit p = f.admit();
            f.worker.on(() -> f.gate.consume(p)); f.authority.checkFails = true;
            f.worker.on(() -> refused(() -> f.gate.currentBeforeEffect(p), "ACTIVE_CURRENCY_LOOKUP_REFUSED"));
            f.authority.checkFails = false;
            f.worker.on(() -> refused(() -> f.gate.currentBeforeEffect(p), "FAILED_CURRENCY_NEVER_REVIVES"));
            f.worker.on(() -> f.gate.settleFailure(p)); f.initialize(f.admit());
        }
    }
    private static void refusal() throws Exception {
        try (Fixture f = new Fixture()) { refused(() -> f.gate.admit(null), "NULL_HANDLE_REFUSED"); }
    }
    public static void main(String[] args) throws Exception {
        switch (args[0]) {
            case "healthy": healthy(); break;
            case "budget": budget(); break;
            case "handles": handles(); break;
            case "permits": permits(); break;
            case "one-use": oneUse(); break;
            case "stale": stale(); break;
            case "held-worker": heldWorker(); break;
            case "retry": retry(); break;
            case "effect-terminal": effectTerminal(); break;
            case "clock": clock(); break;
            case "authority": authority(); break;
            case "refusal": refusal(); break;
            default: throw new AssertionError("UNKNOWN_CASE");
        }
        System.out.println("PASS " + args[0]);
    }
}
