package com.kub.messenger;

import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.file.*;
import java.security.cert.Certificate;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;
import sun.misc.Unsafe;

/** Loads the complete production Runtime/Policy; only HTTPS and Android clock/bridge are leaves. */
public final class AndroidUpdateDeadlineProbe {
    private static void require(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    static final class Connection extends HttpsURLConnection {
        final String block;
        final CountDownLatch entered = new CountDownLatch(1);
        int disconnects;
        boolean closed;
        Connection(String block) throws Exception { super(new URL("https://api.letscube.ru/")); this.block = block; }
        private synchronized void held(String at) throws IOException {
            if (!block.equals(at)) return;
            entered.countDown();
            while (!closed) {
                try { wait(); } catch (InterruptedException failure) { throw new IOException(failure); }
            }
            throw new IOException("CLOSED_BY_OWNER");
        }
        @Override public int getResponseCode() throws IOException { connect(); held("headers"); return 200; }
        @Override public void connect() throws IOException { held("connect"); }
        @Override public long getContentLengthLong() { return 3; }
        @Override public String getContentEncoding() { return null; }
        @Override public InputStream getInputStream() {
            return new ByteArrayInputStream(new byte[] {1, 2, 3}) {
                @Override public synchronized int read(byte[] buffer, int offset, int length) {
                    try { held("body"); } catch (IOException failure) { throw new UncheckedIOException(failure); }
                    return super.read(buffer, offset, length);
                }
            };
        }
        @Override public synchronized void disconnect() { disconnects++; closed = true; notifyAll(); }
        @Override public boolean usingProxy() { return false; }
        @Override public String getCipherSuite() { return "synthetic"; }
        @Override public Certificate[] getLocalCertificates() { return null; }
        @Override public Certificate[] getServerCertificates() { return null; }
    }
    static AndroidUpdateRuntime transport(File partial) throws Exception {
        // Skip app/package/storage initialization, not any production transport method.
        Field field = Unsafe.class.getDeclaredField("theUnsafe"); field.setAccessible(true);
        AndroidUpdateRuntime runtime = (AndroidUpdateRuntime) ((Unsafe) field.get(null)).allocateInstance(AndroidUpdateRuntime.class);
        Field target = AndroidUpdateRuntime.class.getDeclaredField("partial"); target.setAccessible(true); target.set(runtime, partial);
        return runtime;
    }
    private static void invoke(AndroidUpdateRuntime runtime, String operation) throws Exception {
        Method selected = null;
        for (Method method : AndroidUpdateRuntime.class.getDeclaredMethods()) if (method.getName().equals(operation)) selected = method;
        require(selected != null, "TRANSPORT_METHOD_MISSING"); selected.setAccessible(true);
        Object[] arguments;
        if (operation.equals("catalog")) arguments = selected.getParameterCount() == 0 ? new Object[0] : new Object[] {0L};
        else arguments = new Object[] {0L, new AndroidUpdatePolicy.Release("0.1.31", 32, 3, "0".repeat(64),
            "https://api.letscube.ru/releases/files/android/0.1.31/letscube-0.1.31.apk")};
        try { selected.invoke(runtime, arguments); }
        catch (InvocationTargetException failure) {
            Throwable cause = failure.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw (Error) cause;
        }
    }
    public static void main(String[] arguments) throws Exception {
        String operation = arguments[0], boundary = arguments[1];
        boolean budget = arguments.length > 2 && arguments[2].equals("budget");
        Connection connection = new Connection(boundary);
        URL.setURLStreamHandlerFactory(protocol -> protocol.equals("https") ? new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL ignored) { return connection; }
        } : null);
        Path directory = Files.createTempDirectory("android-update-deadline-");
        File partial = directory.resolve("download.part").toFile();
        ExecutorService worker = Executors.newSingleThreadExecutor(task -> { Thread thread = new Thread(task); thread.setDaemon(true); return thread; });
        try {
            AndroidUpdateRuntime runtime = transport(partial);
            Future<Boolean> call = worker.submit(() -> {
                try { invoke(runtime, operation); return true; }
                catch (Exception refused) { return false; }
            });
            if (boundary.equals("complete")) {
                require(call.get(2, TimeUnit.SECONDS), "NORMAL_TRANSFER_REFUSED");
                require(Files.size(partial.toPath()) == 3, "NORMAL_BYTES_MISSING");
            } else {
                require(connection.entered.await(2, TimeUnit.SECONDS), "HELD_BOUNDARY_NOT_ENTERED");
                if (budget) {
                    Field active = AndroidUpdateRuntime.class.getDeclaredField("connection"); active.setAccessible(true);
                    Object request = active.get(runtime);
                    Field alarm = request.getClass().getDeclaredField("alarm"); alarm.setAccessible(true);
                    long remaining = ((ScheduledFuture<?>) alarm.get(request)).getDelay(TimeUnit.MILLISECONDS);
                    long expected = operation.equals("catalog") ? 20000 : 900000;
                    require(remaining > expected - 1000 && remaining <= expected, operation.toUpperCase() + "_DEADLINE_NOT_" + expected);
                    ((AutoCloseable) request).close();
                }
                try { require(!call.get(700, TimeUnit.MILLISECONDS), "EXPIRED_TRANSFER_ACCEPTED"); }
                catch (TimeoutException failure) { throw new AssertionError("TOTAL_" + boundary.toUpperCase() + "_DEADLINE_MISSING"); }
                require(connection.closed, "DEADLINE_DID_NOT_DISCONNECT");
            }
            require(connection.disconnects == 1, "CONNECTION_NOT_CLOSED_ONCE");
            Thread.sleep(250);
            require(connection.disconnects == 1, "COMPLETED_TIMER_STILL_FIRES");
            require(connection.getConnectTimeout() == 15000 && connection.getReadTimeout() == 15000, "SOCKET_LIMIT_CHANGED");
            require(!connection.getInstanceFollowRedirects(), "REDIRECTS_RELAXED");
            System.out.println("PASS_RUNTIME_DEADLINE " + operation + " " + boundary + (budget ? " budget" : ""));
        } finally {
            if (!connection.closed) connection.disconnect();
            worker.shutdownNow();
            Files.deleteIfExists(partial.toPath()); Files.delete(directory);
        }
    }
}
