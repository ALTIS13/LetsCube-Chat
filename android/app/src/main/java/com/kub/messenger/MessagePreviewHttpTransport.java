package com.kub.messenger;

import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongSupplier;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Fixed, access-only read transport. No retries, redirects, storage or response logs. */
final class MessagePreviewHttpTransport implements MessagePreviewVerificationRuntime.Transport, MessagePreviewVerificationRuntime.JwtDecoder {
    interface Connections { HttpsURLConnection open(URL url) throws IOException; }
    static final int MAX_BODY = 32_768;
    private final LongSupplier elapsed;
    private final Connections connections;
    private final AtomicReference<HttpsURLConnection> active = new AtomicReference<>();
    MessagePreviewHttpTransport(LongSupplier elapsed) { this(elapsed, url -> (HttpsURLConnection) url.openConnection()); }
    MessagePreviewHttpTransport(LongSupplier elapsed, Connections connections) { this.elapsed = elapsed; this.connections = connections; }
    private int remaining(long deadline) throws IOException {
        long left = deadline - elapsed.getAsLong();
        if (left <= 0) throw new IOException("PREVIEW_REFUSED");
        return (int) Math.min(2_000, left);
    }
    @Override public Object request(boolean user, String access, String key, String hash, long deadline) throws Exception {
        remaining(deadline);
        if (!MessagePreviewVerificationRuntime.header(access, 8192) || !MessagePreviewVerificationRuntime.header(key, 4096)
            || (!user && (hash == null || !hash.matches("[0-9a-f]{64}")))) throw new IOException("PREVIEW_REFUSED");
        URL url = URI.create(user ? "https://core.letscube.ru/auth/v1/user" : "https://core.letscube.ru/rest/v1/rpc/native_push_device_binding").toURL();
        HttpsURLConnection connection = connections.open(url);
        if (!active.compareAndSet(null, connection)) { connection.disconnect(); throw new IOException("PREVIEW_REFUSED"); }
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(remaining(deadline));
            connection.setReadTimeout(remaining(deadline));
            connection.setRequestMethod(user ? "GET" : "POST");
            connection.setRequestProperty("Authorization", "Bearer " + access);
            connection.setRequestProperty("apikey", key);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Connection", "close");
            if (!user) {
                byte[] body = ("{\"p_token_hash\":\"" + hash + "\"}").getBytes(StandardCharsets.UTF_8);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) { remaining(deadline); output.write(body); }
            }
            connection.setReadTimeout(remaining(deadline));
            if (connection.getResponseCode() != 200) throw new IOException("PREVIEW_REFUSED");
            String type = connection.getContentType();
            if (type == null || !type.split(";", 2)[0].trim().equalsIgnoreCase("application/json")
                || connection.getContentLengthLong() > MAX_BODY) throw new IOException("PREVIEW_REFUSED");
            byte[] bytes;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024];
                for (;;) {
                    connection.setReadTimeout(remaining(deadline));
                    int count = input.read(buffer);
                    remaining(deadline);
                    if (count == -1) break;
                    if (output.size() + count > MAX_BODY) throw new IOException("PREVIEW_REFUSED");
                    output.write(buffer, 0, count);
                }
                bytes = output.toByteArray();
            }
            Object value = json(utf8(bytes));
            if (user) {
                if (!(value instanceof JSONObject)) return null;
                JSONObject row = (JSONObject) value;
                Map<String,Object> result = new HashMap<>();
                result.put("id", row.opt("id")); result.put("is_anonymous", row.opt("is_anonymous"));
                return result;
            }
            if (!(value instanceof JSONArray)) return null;
            JSONArray array = (JSONArray) value;
            if (array.length() != 1 || !(array.opt(0) instanceof JSONObject)) return null;
            JSONObject row = (JSONObject) array.opt(0);
            Map<String,Object> result = new HashMap<>();
            for (Iterator<String> keys = row.keys(); keys.hasNext();) { String name = keys.next(); result.put(name, row.opt(name)); }
            List<Object> rows = new ArrayList<>(); rows.add(result); return rows;
        } finally { active.compareAndSet(connection, null); connection.disconnect(); }
    }
    @Override public void cancel() { HttpsURLConnection connection = active.getAndSet(null); if (connection != null) connection.disconnect(); }
    @Override public Map<String,Object> decode(String token) throws Exception {
        if (!MessagePreviewVerificationRuntime.header(token, 8192)) throw new IOException("PREVIEW_REFUSED");
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3 || parts[0].length() > 1024) throw new IOException("PREVIEW_REFUSED");
        for (String part : parts) if (!part.matches("[A-Za-z0-9_-]+")) throw new IOException("PREVIEW_REFUSED");
        Object head = json(utf8(decodePart(parts[0]))), body = json(utf8(decodePart(parts[1])));
        if (!(head instanceof JSONObject) || !(body instanceof JSONObject)) throw new IOException("PREVIEW_REFUSED");
        JSONObject header = (JSONObject) head, payload = (JSONObject) body;
        String alg = String.valueOf(header.opt("alg"));
        if (!("HS256".equals(alg) || "RS256".equals(alg) || "ES256".equals(alg) || "EdDSA".equals(alg))
            || (header.has("typ") && !"JWT".equals(header.opt("typ")))) throw new IOException("PREVIEW_REFUSED");
        Map<String,Object> result = new HashMap<>();
        for (String name : new String[] {"role", "aud", "iss", "sub", "session_id", "exp", "is_anonymous"}) result.put(name, payload.opt(name));
        return result;
    }
    private static byte[] decodePart(String part) throws IOException {
        byte[] value = Base64.decode(part, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        if (!part.equals(Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING))) throw new IOException("PREVIEW_REFUSED");
        return value;
    }
    private static String utf8(byte[] value) throws Exception {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString();
    }
    private static Object json(String text) throws Exception {
        // Bound nesting before the platform decoder can recurse over untrusted data.
        int depth = 0; boolean quoted = false, escape = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (escape) escape = false;
                else if (c == '\\') escape = true;
                else if (c == '"') quoted = false;
            } else if (c == '"') quoted = true;
            else if (c == '{' || c == '[') { if (++depth > 16) throw new IOException("PREVIEW_REFUSED"); }
            else if (c == '}' || c == ']') { if (--depth < 0) throw new IOException("PREVIEW_REFUSED"); }
            else if (c == '\'' || c == '/') throw new IOException("PREVIEW_REFUSED");
        }
        if (quoted || depth != 0) throw new IOException("PREVIEW_REFUSED");
        JSONTokener reader = new JSONTokener(text); Object value = reader.nextValue();
        if (reader.nextClean() != 0) throw new IOException("PREVIEW_REFUSED");
        return value;
    }
}
