package com.kub.messenger;

// Inactive per-instance memory admission only; a trusted UID owner/lifecycle adapter is still required.
final class MessagePreviewInitializationGate {
    private static final long BUDGET_MILLIS = 10_000;

    interface ForegroundAuthority {
        Object capture() throws Exception;
        boolean isCurrent(Object capturedSnapshot) throws Exception;
    }
    interface MonotonicClock { long nowMillis() throws Exception; }
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    static final class ForegroundHandle {
        private final MessagePreviewInitializationGate issuer;
        private final Object epoch;
        private final Object snapshot;
        private ForegroundHandle(MessagePreviewInitializationGate issuer, Object epoch, Object snapshot) {
            this.issuer = issuer; this.epoch = epoch; this.snapshot = snapshot;
        }
    }
    static final class Permit {
        private final MessagePreviewInitializationGate issuer;
        private final ForegroundHandle handle;
        private final Thread worker;
        private final long deadline;
        private boolean consumed, effectAttempted, retired;
        private Permit(MessagePreviewInitializationGate issuer, ForegroundHandle handle, Thread worker, long deadline) {
            this.issuer = issuer; this.handle = handle; this.worker = worker; this.deadline = deadline;
        }
    }

    private final ForegroundAuthority authority;
    private final MonotonicClock clock;
    private final Thread worker;
    private Object epoch = new Object();
    private Permit active;
    private boolean closed, terminal, clockUnsafe;
    private long lastMillis = -1;

    MessagePreviewInitializationGate(ForegroundAuthority authority, MonotonicClock clock,
                                    Thread mainThread, Thread worker) throws Unavailable {
        if (authority == null || clock == null || mainThread != Thread.currentThread()
            || worker == null || worker == mainThread) throw new Unavailable();
        this.authority = authority; this.clock = clock; this.worker = worker;
    }

    private void requireOpen() throws Unavailable {
        if (closed || terminal || clockUnsafe) throw new Unavailable();
    }
    private void retire(Permit permit) {
        permit.retired = true;
        if (permit.effectAttempted) terminal = true;
    }
    private void invalidateMemory() {
        epoch = new Object();
        if (active != null) retire(active);
    }
    private long now() throws Unavailable {
        if (clockUnsafe) throw new Unavailable();
        try {
            long value = clock.nowMillis();
            if (value < 0 || value < lastMillis) throw new Unavailable();
            lastMillis = value;
            return value;
        } catch (Exception refused) {
            clockUnsafe = true; invalidateMemory(); throw new Unavailable();
        }
    }
    private void requireHandle(ForegroundHandle handle) throws Unavailable {
        if (handle == null || handle.issuer != this || handle.epoch != epoch) throw new Unavailable();
    }
    private void requireAuthority(Object snapshot) throws Unavailable {
        try {
            if (snapshot == null || !authority.isCurrent(snapshot)) throw new Unavailable();
        } catch (Exception refused) { invalidateMemory(); throw new Unavailable(); }
    }
    private void requireWorkerActive(Permit permit) throws Unavailable {
        if (permit == null || permit.issuer != this || active != permit || permit.worker != worker) throw new Unavailable();
        if (Thread.currentThread() != worker) throw new Unavailable();
    }
    private void requireConsumed(Permit permit) throws Unavailable {
        requireWorkerActive(permit);
        if (!permit.consumed) throw new Unavailable();
    }
    private void requireCurrent(Permit permit) throws Unavailable {
        try {
            if (closed || terminal || permit.retired || permit.handle.epoch != epoch) throw new Unavailable();
            requireAuthority(permit.handle.snapshot);
            long value = now();
            if (closed || terminal || permit.retired || permit.handle.epoch != epoch
                || value >= permit.deadline) throw new Unavailable();
        } catch (Unavailable refused) { retire(permit); throw new Unavailable(); }
    }

    synchronized ForegroundHandle capture() throws Unavailable {
        requireOpen(); now();
        Object snapshot;
        try { snapshot = authority.capture(); }
        catch (Exception refused) { invalidateMemory(); throw new Unavailable(); }
        requireAuthority(snapshot);
        return new ForegroundHandle(this, epoch, snapshot);
    }
    synchronized Permit admit(ForegroundHandle handle) throws Unavailable {
        requireOpen();
        if (active != null) throw new Unavailable();
        requireHandle(handle);
        requireAuthority(handle.snapshot);
        long value = now();
        if (value > Long.MAX_VALUE - BUDGET_MILLIS) throw new Unavailable();
        active = new Permit(this, handle, worker, value + BUDGET_MILLIS);
        return active;
    }
    synchronized void consume(Permit permit) throws Unavailable {
        requireWorkerActive(permit);
        if (permit.consumed) throw new Unavailable();
        requireCurrent(permit);
        permit.consumed = true;
    }
    synchronized void currentBeforeEffect(Permit permit) throws Unavailable {
        requireConsumed(permit); requireCurrent(permit);
    }
    synchronized void markEffectAttempted(Permit permit) throws Unavailable {
        requireConsumed(permit); requireCurrent(permit);
        permit.effectAttempted = true;
    }
    synchronized void finishInitialized(Permit permit) throws Unavailable {
        requireConsumed(permit);
        if (!permit.effectAttempted) throw new Unavailable();
        requireCurrent(permit);
        terminal = true; permit.retired = true; active = null; invalidateMemory();
    }
    synchronized void settleFailure(Permit permit) throws Unavailable {
        requireWorkerActive(permit);
        retire(permit); active = null; invalidateMemory();
    }
    synchronized void invalidate() { invalidateMemory(); }
    synchronized void close() { closed = true; invalidateMemory(); }
}
