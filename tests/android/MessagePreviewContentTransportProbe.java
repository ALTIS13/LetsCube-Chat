package com.kub.messenger;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

public final class MessagePreviewContentTransportProbe {
    static final String DEVICE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    static final String NOTIFICATION = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    static final String ACCESS = "fictional-access", KEY = "fictional-public-key";
    static void check(boolean value, String label) { if (!value) throw new AssertionError(label); }
    static final class Clock implements MessagePreviewContentLookup.Clock {
        long now = 100;
        public long wallTime() { return 1_792_108_800_000L; }
        public long elapsedTime() { return now; }
    }
    static final class Connection extends HttpsURLConnection {
        byte[] body = "[]".getBytes(StandardCharsets.UTF_8);
        final ByteArrayOutputStream sent = new ByteArrayOutputStream();
        boolean disconnected, inputClosed, outputClosed;
        int status = 200, responseCalls, inputCalls, streamingLength = -1;
        long length = -1;
        String type = "application/json; charset=utf-8";
        Runnable afterStatus = () -> {}, afterWrite = () -> {}, onRead = () -> {};
        Connection(URL url) { super(url); }
        public String getCipherSuite() { return "fictional"; }
        public Certificate[] getLocalCertificates() { return null; }
        public Certificate[] getServerCertificates() { return null; }
        public void disconnect() { disconnected = true; }
        public boolean usingProxy() { return false; }
        public void connect() {}
        public int getResponseCode() { responseCalls++; afterStatus.run(); return status; }
        public String getContentType() { return type; }
        public long getContentLengthLong() { return length; }
        public void setFixedLengthStreamingMode(int count) { super.setFixedLengthStreamingMode(count); streamingLength = count; }
        public OutputStream getOutputStream() {
            return new OutputStream() {
                public void write(int value) { sent.write(value); }
                public void write(byte[] b, int off, int len) { sent.write(b, off, len); afterWrite.run(); }
                public void close() { outputClosed = true; }
            };
        }
        public InputStream getInputStream() {
            inputCalls++;
            return new ByteArrayInputStream(body) {
                public synchronized int read(byte[] b, int off, int len) { onRead.run(); return super.read(b, off, len); }
                public void close() { inputClosed = true; }
            };
        }
    }
    static Object preview(MessagePreviewHttpTransport transport, String access, String key,
            String device, String notification, long deadline) throws Exception {
        final Method method;
        try { method = MessagePreviewHttpTransport.class.getDeclaredMethod("preview", String.class,
            String.class, String.class, String.class, long.class); }
        catch (NoSuchMethodException absent) { throw new AssertionError("CONTENT_PREVIEW_ENTRY_REQUIRED"); }
        try { return method.invoke(transport, access, key, device, notification, deadline); }
        catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw (Error) cause;
        }
    }
    static void fixed() throws Exception {
        Clock clock = new Clock(); Connection[] current = { null }; int[] opens = { 0 };
        MessagePreviewHttpTransport transport = new MessagePreviewHttpTransport(() -> clock.now, url -> {
            opens[0]++; return current[0] = new Connection(url);
        });
        JSONTokener.fixture("[]", new JSONArray());
        Object value = preview(transport, ACCESS, KEY, DEVICE, NOTIFICATION, 8100);
        check(value instanceof List && ((List<?>) value).isEmpty(), "CONTENT_EMPTY_REFUSAL");
        Connection c = current[0];
        check(opens[0] == 1 && c.disconnected, "CONTENT_ONE_REQUEST_CLOSED");
        check(c.getURL().toString().equals("https://core.letscube.ru/rest/v1/rpc/native_message_notification_preview")
            && c.getRequestMethod().equals("POST"), "CONTENT_FIXED_RPC");
        check(c.sent.toString("UTF-8").equals("{\"p_device_id\":\"cccccccc-cccc-4ccc-8ccc-ccccccccccc1\","
            + "\"p_notification_id\":\"dddddddd-dddd-4ddd-8ddd-ddddddddddd1\"}"), "CONTENT_EXACT_BODY");
        check(c.getRequestProperty("Authorization").equals("Bearer fictional-access")
            && c.getRequestProperty("apikey").equals("fictional-public-key")
            && c.getRequestProperty("Accept").equals("application/json")
            && c.getRequestProperty("Accept-Encoding").equals("identity")
            && c.getRequestProperty("Content-Type").equals("application/json")
            && c.getRequestProperty("Connection").equals("close"), "CONTENT_FIXED_HEADERS");
        check(!c.getInstanceFollowRedirects() && !c.getUseCaches() && c.getDoOutput(), "CONTENT_NO_REDIRECT_CACHE");
        check(c.getConnectTimeout() == 2000 && c.getReadTimeout() == 2000, "CONTENT_TIMEOUT_LITERAL");
        check(c.streamingLength == 113 && c.sent.size() == 113 && c.inputClosed && c.outputClosed, "CONTENT_STREAMS_CLOSED");
    }
    static final class Fixture {
        final Clock clock = new Clock();
        final List<Connection> opened = new ArrayList<>();
        java.util.function.Consumer<Connection> configure = c -> {};
        final MessagePreviewHttpTransport transport = new MessagePreviewHttpTransport(() -> clock.now, url -> {
            Connection c = new Connection(url); opened.add(c); configure.accept(c); return c;
        });
        Fixture() { JSONTokener.fixture("[]", new JSONArray()); }
        Object content() throws Exception { return preview(transport, ACCESS, KEY, DEVICE, NOTIFICATION, 8100); }
        Connection last() { return opened.get(opened.size() - 1); }
    }
    interface Call { Object run() throws Exception; }
    static void refused(Call call, String label) throws Exception {
        boolean no = false;
        try { call.run(); } catch (Exception expected) { no = true; }
        check(no, label);
    }
    static void invalid(String scenario) throws Exception {
        Fixture f = new Fixture();
        String access = ACCESS, key = KEY, device = DEVICE, notification = NOTIFICATION;
        switch (scenario) {
            case "device-null": device = null; break;
            case "device-malformed": device = "not-a-device"; break;
            case "device-uppercase": device = DEVICE.toUpperCase(java.util.Locale.ROOT); break;
            case "notification-null": notification = null; break;
            case "notification-malformed": notification = "not-a-notification"; break;
            case "notification-injection": notification = NOTIFICATION + "\"}"; break;
            case "access-null": access = null; break;
            case "access-empty": access = ""; break;
            case "access-crlf": access = "fictional\r\nX: injected"; break;
            case "access-space": access = "fictional access"; break;
            case "access-unicode": access = "fictional-\u042f"; break;
            case "access-large": access = "a".repeat(8193); break;
            case "key-null": key = null; break;
            case "key-empty": key = ""; break;
            case "key-control": key = "fictional\u007f"; break;
            case "key-large": key = "k".repeat(4097); break;
            default: throw new AssertionError("KNOWN_INVALID_CASE");
        }
        final String a = access, k = key, d = device, n = notification;
        refused(() -> preview(f.transport, a, k, d, n, 8100), "CONTENT_INVALID_" + scenario);
        check(f.opened.isEmpty(), "CONTENT_INVALID_ZERO_IO");
    }
    static void response(String scenario) throws Exception {
        Fixture f = new Fixture();
        Map<String,Object> row = new HashMap<>();
        row.put("preview_v", 1); row.put("recipient_id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
        row.put("session_id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"); row.put("device_id", DEVICE);
        row.put("notification_id", NOTIFICATION); row.put("chat_id", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1");
        row.put("message_id", "ffffffff-ffff-4fff-8fff-fffffffffff1"); row.put("preview_level", "message");
        row.put("sender_name", "Fictional sender"); row.put("title", "Fictional sender");
        row.put("body", "\u0422\u0435\u0441\u0442"); row.put("expires_at", "2026-10-16T00:00:15Z");
        String text = "[{\"preview_v\":1,\"body\":\"\u0422\u0435\u0441\u0442\"}]";
        Object decoded = new JSONArray(new JSONObject(row));
        boolean accepted = true;
        if (scenario.equals("multirow")) { text = "[{},{}]"; decoded = new JSONArray(new JSONObject(row), new JSONObject(row)); }
        if (scenario.equals("not-array")) { text = "{}"; decoded = new JSONObject(); accepted = false; }
        if (scenario.equals("not-object")) { text = "[1]"; decoded = new JSONArray(1); accepted = false; }
        if (scenario.equals("declared-limit")) { text = " ".repeat(32768 - text.getBytes(StandardCharsets.UTF_8).length) + text; }
        if (scenario.equals("stream-large")) { text = " ".repeat(32769 - text.getBytes(StandardCharsets.UTF_8).length) + text; accepted = false; }
        if (scenario.equals("depth16") || scenario.equals("depth17")) {
            int arrays = scenario.equals("depth16") ? 14 : 15;
            text = "[{\"nested\":" + "[".repeat(arrays) + "0" + "]".repeat(arrays) + "}]";
            decoded = new JSONArray(new JSONObject(Map.of("nested", new JSONArray(0))));
            accepted = arrays == 14;
        }
        final String body = text;
        JSONTokener.fixture(text, decoded);
        JSONTokener.fixture("[{\"body\":\"\ufffd(\"}]", new JSONArray(new JSONObject(row)));
        if (scenario.equals("decode-error")) accepted = false;
        f.configure = c -> {
            c.body = body.getBytes(StandardCharsets.UTF_8);
            if (scenario.equals("declared-limit")) c.length = 32768;
            if (scenario.equals("declared-large")) c.length = 32769;
            if (scenario.equals("utf8")) {
                ByteArrayOutputStream invalid = new ByteArrayOutputStream();
                invalid.writeBytes("[{\"body\":\"".getBytes(StandardCharsets.UTF_8));
                invalid.write(0xc3); invalid.write(0x28);
                invalid.writeBytes("\"}]".getBytes(StandardCharsets.UTF_8)); c.body = invalid.toByteArray();
            }
            if (scenario.equals("decode-error")) c.body = "not registered JSON".getBytes(StandardCharsets.UTF_8);
            if (scenario.equals("wrong-type")) c.type = "text/html";
            if (scenario.equals("missing-type")) c.type = null;
            if (scenario.equals("json-type")) c.type = "Application/JSON; charset=UTF-8";
            if (scenario.startsWith("status-")) c.status = Integer.parseInt(scenario.substring(7));
        };
        if (scenario.equals("declared-large") || scenario.equals("utf8") || scenario.equals("wrong-type")
            || scenario.equals("missing-type") || scenario.startsWith("status-")) accepted = false;
        if (accepted) {
            Object value = f.content();
            check(value instanceof List, "CONTENT_LIST_OF_MAPS");
            List<?> rows = (List<?>) value;
            check(rows.size() == (scenario.equals("multirow") ? 2 : 1) && rows.get(0) instanceof Map, "CONTENT_ROWS_FOR_PARENT_PARSER");
            if (!scenario.equals("depth16")) {
                check(row.equals(rows.get(0)) && "\u0422\u0435\u0441\u0442".equals(((Map<?,?>) rows.get(0)).get("body")), "CONTENT_CURRENT_ROW_FIELDS");
            }
        } else refused(f::content, "CONTENT_RESPONSE_REFUSAL_" + scenario);
        check(f.opened.size() == 1 && f.last().disconnected && !f.last().getInstanceFollowRedirects(), "CONTENT_REFUSAL_NO_RETRY");
        if (scenario.startsWith("status-") || scenario.equals("declared-large")
            || scenario.equals("wrong-type") || scenario.equals("missing-type")) check(f.last().inputCalls == 0, "CONTENT_NO_ERROR_BODY_READ");
        else check(f.last().inputClosed, "CONTENT_INPUT_CLOSED");
        check(f.last().outputClosed, "CONTENT_OUTPUT_CLOSED");
    }
    static void deadline(String scenario) throws Exception {
        Fixture f = new Fixture();
        if (scenario.equals("expired") || scenario.equals("negative")) {
            refused(() -> preview(f.transport, ACCESS, KEY, DEVICE, NOTIFICATION,
                scenario.equals("negative") ? Long.MIN_VALUE : 100), "CONTENT_DEADLINE_BEFORE_OPEN");
            check(f.opened.isEmpty(), "CONTENT_EXPIRED_ZERO_IO"); return;
        }
        if (scenario.equals("short")) {
            preview(f.transport, ACCESS, KEY, DEVICE, NOTIFICATION, 101);
            check(f.last().getConnectTimeout() == 1 && f.last().getReadTimeout() == 1, "CONTENT_ORIGINAL_SHORT_DEADLINE"); return;
        }
        f.configure = c -> {
            if (scenario.equals("write")) c.afterWrite = () -> { f.clock.now = 8100; };
            if (scenario.equals("headers")) c.afterStatus = () -> { f.clock.now = 8100; };
            if (scenario.equals("read")) c.onRead = () -> { f.clock.now = 8100; };
            if (scenario.equals("eof")) c.body = new byte[0];
            if (scenario.equals("eof")) c.onRead = () -> { f.clock.now = 8100; };
        };
        refused(f::content, "CONTENT_DEADLINE_" + scenario);
        check(f.opened.size() == 1 && f.last().disconnected, "CONTENT_DEADLINE_CLOSED");
        if (scenario.equals("write")) check(f.last().responseCalls == 0, "CONTENT_NO_STATUS_AFTER_EXPIRY");
        if (scenario.equals("headers")) check(f.last().inputCalls == 0, "CONTENT_NO_INPUT_AFTER_EXPIRY");
    }
    static void cancel(String scenario) throws Exception {
        Fixture f = new Fixture();
        if (scenario.equals("idle")) {
            f.transport.cancel(); check(((List<?>) f.content()).isEmpty(), "CONTENT_IDLE_CANCEL_NOT_TERMINAL"); return;
        }
        f.configure = c -> c.onRead = () -> {
            c.onRead = () -> {};
            if (scenario.equals("busy")) {
                try { refused(f::content, "CONTENT_CONCURRENT_REFUSED"); } catch (Exception error) { throw new AssertionError(error); }
            } else {
                f.transport.cancel();
                check(c.disconnected, "CONTENT_CANCEL_DISCONNECT_NOW");
                if (scenario.equals("successor")) {
                    f.configure = next -> {};
                    try { check(((List<?>) f.content()).isEmpty(), "CONTENT_SUCCESSOR_POSITIVE"); }
                    catch (Exception error) { throw new AssertionError(error); }
                }
            }
        };
        if (scenario.equals("busy")) check(((List<?>) f.content()).isEmpty(), "CONTENT_BUSY_KEEPS_FIRST");
        else refused(f::content, "CONTENT_CANCELLED_RESPONSE_REFUSED");
        for (Connection c : f.opened) check(c.disconnected, "CONTENT_CANCEL_CONNECTION_CLOSED");
        f.configure = c -> {};
        check(((List<?>) f.content()).isEmpty(), "CONTENT_NEXT_REQUEST_AFTER_RELEASE");
    }
    static void headerBoundary() throws Exception {
        Fixture f = new Fixture();
        preview(f.transport, "a".repeat(8192), "k".repeat(4096), DEVICE, NOTIFICATION, 8100);
        check(f.last().getRequestProperty("Authorization").length() == 8199
            && f.last().getRequestProperty("apikey").length() == 4096, "CONTENT_EXACT_HEADER_BOUNDS");
    }
    static void integration() throws Exception {
        Fixture f = new Fixture();
        String wire = "[{\"preview_v\":1,\"recipient_id\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1\","
            + "\"session_id\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1\","
            + "\"device_id\":\"cccccccc-cccc-4ccc-8ccc-ccccccccccc1\","
            + "\"notification_id\":\"dddddddd-dddd-4ddd-8ddd-ddddddddddd1\","
            + "\"chat_id\":\"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1\","
            + "\"message_id\":\"ffffffff-ffff-4fff-8fff-fffffffffff1\","
            + "\"preview_level\":\"message\",\"sender_name\":\"Fictional sender\","
            + "\"title\":\"Fictional sender\",\"body\":\"Fictional message\",\"expires_at\":\"2026-10-16T00:00:15Z\"}]";
        Map<String,Object> row = new HashMap<>();
        row.put("preview_v", 1); row.put("recipient_id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
        row.put("session_id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"); row.put("device_id", DEVICE);
        row.put("notification_id", NOTIFICATION); row.put("chat_id", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1");
        row.put("message_id", "ffffffff-ffff-4fff-8fff-fffffffffff1"); row.put("preview_level", "message");
        row.put("sender_name", "Fictional sender"); row.put("title", "Fictional sender");
        row.put("body", "Fictional message"); row.put("expires_at", "2026-10-16T00:00:15Z");
        JSONTokener.fixture(wire, new JSONArray(new JSONObject(row)));
        f.configure = c -> c.body = wire.getBytes(StandardCharsets.UTF_8);
        MessagePreviewHttpTransport http = f.transport;
        Clock clock = f.clock;
        MessagePreviewContentLookup lookup = new MessagePreviewContentLookup(http::preview, http::cancel, clock, request -> true);
        MessagePreviewContentLookup.Request request = new MessagePreviewContentLookup.Request(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", DEVICE, NOTIFICATION,
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", "ffffffff-ffff-4fff-8fff-fffffffffff1", 1, 7, "message");
        int[] callbacks = { 0 };
        MessagePreviewContentLookup.Outcome outcome = lookup.consume(request, ACCESS, KEY, content -> {
            callbacks[0]++;
            check(content.title.equals("Fictional sender") && content.body.equals("Fictional message")
                && content.level.equals("message") && content.expiresAt == 1_792_108_815_000L, "CONTENT_REAL_CALLBACK_FIELDS");
        });
        check(outcome == MessagePreviewContentLookup.Outcome.CONSUMED && callbacks[0] == 1, "CONTENT_REAL_LOOKUP_CONSUMED");
        Connection c = f.last();
        check(f.opened.size() == 1 && c.disconnected && c.inputClosed && c.outputClosed, "CONTENT_INTEGRATION_ONE_CLOSED_REQUEST");
        check(c.getURL().toString().equals("https://core.letscube.ru/rest/v1/rpc/native_message_notification_preview")
            && c.getRequestMethod().equals("POST") && !c.getInstanceFollowRedirects(), "CONTENT_INTEGRATION_FIXED_RPC");
        check(c.sent.toString("UTF-8").equals("{\"p_device_id\":\"cccccccc-cccc-4ccc-8ccc-ccccccccccc1\","
            + "\"p_notification_id\":\"dddddddd-dddd-4ddd-8ddd-ddddddddddd1\"}"), "CONTENT_INTEGRATION_FIXED_BODY");
    }
    static void legacy(boolean auth) throws Exception {
        Connection[] current = { null };
        String text = auth ? "{\"id\":\"fictional\",\"is_anonymous\":false}"
            : "[{\"binding_v\":1,\"device_id\":\"fictional\"}]";
        Map<String,Object> row = auth ? Map.of("id", "fictional", "is_anonymous", false)
            : Map.of("binding_v", 1, "device_id", "fictional");
        JSONTokener.fixture(text, auth ? new JSONObject(row) : new JSONArray(new JSONObject(row)));
        MessagePreviewHttpTransport real = new MessagePreviewHttpTransport(() -> 100, url -> {
            current[0] = new Connection(url); current[0].body = text.getBytes(StandardCharsets.UTF_8); return current[0];
        });
        Object value = real.request(auth, ACCESS, KEY, "0".repeat(64), 8100);
        check(auth ? value instanceof Map && row.equals(value) : value instanceof List && List.of(row).equals(value), "LEGACY_PROJECTION");
        check(current[0].getURL().toString().equals(auth ? "https://core.letscube.ru/auth/v1/user"
            : "https://core.letscube.ru/rest/v1/rpc/native_push_device_binding"), "LEGACY_FIXED_ROUTE");
        check(current[0].getRequestMethod().equals(auth ? "GET" : "POST"), "LEGACY_METHOD");
        check(current[0].sent.toString("UTF-8").equals(auth ? "" : "{\"p_token_hash\":\"" + "0".repeat(64) + "\"}"), "LEGACY_BODY");
        check(current[0].disconnected, "LEGACY_CLOSED");
    }
    public static void main(String[] args) throws Exception {
        String scenario = args[0];
        if (scenario.equals("fixed")) fixed();
        else if (scenario.startsWith("invalid-")) invalid(scenario.substring(8));
        else if (scenario.startsWith("response-")) response(scenario.substring(9));
        else if (scenario.startsWith("deadline-")) deadline(scenario.substring(9));
        else if (scenario.startsWith("cancel-")) cancel(scenario.substring(7));
        else if (scenario.equals("header-boundary")) headerBoundary();
        else if (scenario.equals("integration")) integration();
        else if (scenario.equals("legacy-auth")) legacy(true);
        else if (scenario.equals("legacy-binding")) legacy(false);
        else throw new AssertionError("KNOWN_SCENARIO_REQUIRED");
        System.out.println("PASS " + scenario);
    }
}
