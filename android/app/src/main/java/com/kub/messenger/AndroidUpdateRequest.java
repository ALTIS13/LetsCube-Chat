package com.kub.messenger;

import android.os.SystemClock;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;

/** One deadline owns one connection, including connect, headers and the final body read. */
final class AndroidUpdateRequest implements AutoCloseable {
    private static final ScheduledThreadPoolExecutor WATCHDOG = new ScheduledThreadPoolExecutor(1, task -> {
        Thread thread = new Thread(task, "letscube-update-deadline");
        thread.setDaemon(true);
        return thread;
    });
    static { WATCHDOG.setRemoveOnCancelPolicy(true); }

    final HttpsURLConnection connection;
    private final long deadline;
    private final ScheduledFuture<?> alarm;
    private boolean closed, expired;

    AndroidUpdateRequest(HttpsURLConnection connection, long timeoutMillis) {
        this.connection = connection;
        deadline = SystemClock.elapsedRealtime() + timeoutMillis;
        alarm = WATCHDOG.schedule(this::expire, timeoutMillis, TimeUnit.MILLISECONDS);
    }
    private synchronized void expire() {
        if (closed) return;
        expired = true;
        closed = true;
        connection.disconnect();
    }
    synchronized boolean isOpen() {
        return !closed && SystemClock.elapsedRealtime() < deadline;
    }
    synchronized void check() throws IOException {
        if (expired || SystemClock.elapsedRealtime() >= deadline) {
            expire();
            throw new SocketTimeoutException("NETWORK");
        }
        if (closed) throw new IOException("CANCELLED");
    }
    @Override public synchronized void close() {
        alarm.cancel(false);
        if (closed) return;
        closed = true;
        connection.disconnect();
    }
}
