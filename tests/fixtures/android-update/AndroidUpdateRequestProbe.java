package com.kub.messenger;

import android.os.SystemClock;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.*;
import java.net.*;
import java.util.concurrent.*;

public final class AndroidUpdateRequestProbe {
    private static void require(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static Field field(Class<?> owner, String name) throws Exception {
        Field field = owner.getDeclaredField(name); field.setAccessible(true); return field;
    }
    private static Method method(Class<?> owner, String name, Class<?>... arguments) throws Exception {
        Method method = owner.getDeclaredMethod(name, arguments); method.setAccessible(true); return method;
    }
    public static void main(String[] arguments) throws Exception {
        String scenario = arguments[0];
        AndroidUpdateDeadlineProbe.Connection first = new AndroidUpdateDeadlineProbe.Connection("complete");
        AndroidUpdateRequest request = new AndroidUpdateRequest(first, 100000);
        try {
            ScheduledFuture<?> alarm = (ScheduledFuture<?>) field(AndroidUpdateRequest.class, "alarm").get(request);
            if (scenario.equals("close")) {
                request.close(); request.close();
                require(alarm.isCancelled(), "ALARM_NOT_CANCELLED");
                method(AndroidUpdateRequest.class, "expire").invoke(request);
                require(first.disconnects == 1, "CANCELLED_REQUEST_DISCONNECTED_AGAIN");
                try { request.check(); throw new AssertionError("CANCELLED_REQUEST_ACCEPTED"); }
                catch (IOException expected) { require(expected.getMessage().equals("CANCELLED"), "CANCEL_REASON"); }
            } else if (scenario.equals("elapsed")) {
                SystemClock.advance = 100001;
                try { request.check(); throw new AssertionError("LATE_EOF_ACCEPTED"); }
                catch (SocketTimeoutException expected) { require(first.closed, "ELAPSED_REQUEST_NOT_CLOSED"); }
            } else if (scenario.equals("ownership")) {
                request.close();
                AndroidUpdateDeadlineProbe.Connection second = new AndroidUpdateDeadlineProbe.Connection("complete");
                URL.setURLStreamHandlerFactory(protocol -> protocol.equals("https") ? new URLStreamHandler() {
                    @Override protected URLConnection openConnection(URL ignored) { return second; }
                } : null);
                AndroidUpdateRuntime runtime = AndroidUpdateDeadlineProbe.transport(new File("unused"));
                field(AndroidUpdateRuntime.class, "generation").setLong(runtime, 1);
                Method open = method(AndroidUpdateRuntime.class, "open", long.class, String.class, long.class);
                AndroidUpdateRequest current = (AndroidUpdateRequest) open.invoke(runtime, 1L, "https://api.letscube.ru/", 100000L);
                try {
                    method(AndroidUpdateRuntime.class, "closeRequest", AndroidUpdateRequest.class).invoke(runtime, request);
                    require(field(AndroidUpdateRuntime.class, "connection").get(runtime) == current, "NEW_REQUEST_LOST");
                    method(AndroidUpdateRequest.class, "expire").invoke(request);
                    require(second.disconnects == 0 && current.isOpen(), "OLD_ALARM_CLOSED_NEW_REQUEST");
                    try { open.invoke(runtime, 0L, "https://api.letscube.ru/", 100000L); throw new AssertionError("RETIRED_OWNER_OPENED"); }
                    catch (InvocationTargetException expected) { require(expected.getCause() instanceof IOException, "OWNER_REFUSAL"); }
                } finally { method(AndroidUpdateRuntime.class, "closeRequest", AndroidUpdateRequest.class).invoke(runtime, current); }
            } else throw new AssertionError("UNKNOWN_SCENARIO");
        } finally { request.close(); SystemClock.advance = 0; }
        ScheduledThreadPoolExecutor timer = (ScheduledThreadPoolExecutor) field(AndroidUpdateRequest.class, "WATCHDOG").get(null);
        require(timer.getQueue().isEmpty(), "RETIRED_TIMER_RETAINED");
        System.out.println("PASS_REQUEST_DEADLINE " + scenario);
    }
}
