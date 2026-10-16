package com.kub.messenger;

import static com.kub.messenger.MessagePreviewVerificationProbe.USER;
import static com.kub.messenger.MessagePreviewVerificationProbe.SESSION;
import static com.kub.messenger.MessagePreviewVerificationProbe.DEVICE;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

@SuppressWarnings("unchecked")
public final class MessagePreviewBridgeProbe {
    static void check(boolean value, String label) { MessagePreviewVerificationProbe.check(value, label); }
    static final String AUTH = "{\"id\":\"fictional\",\"is_anonymous\":false}";
    static final String RESOLVER = "[{\"binding_v\":1}]";
    static class Connection extends HttpsURLConnection {
        byte[] body = AUTH.getBytes(StandardCharsets.UTF_8);
        int status = 200; long length = -1; int reads; boolean disconnected;
        final ByteArrayOutputStream sent = new ByteArrayOutputStream();
        final MessagePreviewVerificationProbe.Clock clock;
        boolean expire;
        Connection(URL url, MessagePreviewVerificationProbe.Clock clock) { super(url); this.clock = clock; }
        public String getCipherSuite() { return "fictional"; }
        public Certificate[] getLocalCertificates() { return null; }
        public Certificate[] getServerCertificates() { return null; }
        public void disconnect() { disconnected = true; }
        public boolean usingProxy() { return false; }
        public void connect() {}
        public int getResponseCode() { return status; }
        public String getContentType() { return "application/json; charset=utf-8"; }
        public long getContentLengthLong() { return length; }
        public OutputStream getOutputStream() { return sent; }
        public InputStream getInputStream() {
            reads++;
            return new ByteArrayInputStream(body) {
                public synchronized int read(byte[] b, int off, int len) { if (expire) clock.advance(8000); return super.read(b, off, len); }
            };
        }
    }
    static void transport(String kind) throws Exception {
        MessagePreviewVerificationProbe.Clock clock = new MessagePreviewVerificationProbe.Clock();
        Connection[] connection = { null }; int[] opens = { 0 };
        MessagePreviewHttpTransport http = new MessagePreviewHttpTransport(clock::elapsedTime, url -> {
            opens[0]++; Connection c = new Connection(url, clock); connection[0] = c;
            if ("redirect".equals(kind)) c.status = 302;
            if ("declared-large".equals(kind)) c.length = 32769;
            if ("stream-large".equals(kind)) c.body = (" ".repeat(32769 - AUTH.length()) + AUTH).getBytes(StandardCharsets.UTF_8);
            if ("depth".equals(kind)) c.body = ("[".repeat(17) + "0" + "]".repeat(17)).getBytes(StandardCharsets.UTF_8);
            if ("utf8".equals(kind)) c.body = new byte[] { (byte) 0xff };
            if ("deadline".equals(kind)) c.expire = true;
            if ("resolver".equals(kind)) c.body = RESOLVER.getBytes(StandardCharsets.UTF_8);
            return c;
        });
        JSONTokener.fixture(AUTH, new JSONObject(MessagePreviewVerificationProbe.object("id", MessagePreviewVerificationProbe.USER, "is_anonymous", false)));
        JSONTokener.fixture(" ".repeat(32769 - AUTH.length()) + AUTH, new JSONObject(MessagePreviewVerificationProbe.object("id", MessagePreviewVerificationProbe.USER, "is_anonymous", false)));
        JSONTokener.fixture(RESOLVER, new JSONArray(new JSONObject((Map<String,Object>) ((java.util.List<?>) MessagePreviewVerificationProbe.row()).get(0))));
        boolean allowed = Arrays.asList("normal", "resolver").contains(kind);
        Object value = null; boolean refused = false;
        try { value = http.request(!"resolver".equals(kind), "fictional-access", "fictional-public", "0".repeat(64), clock.elapsed + 8000); }
        catch (Exception error) { refused = true; }
        check(refused != allowed, "TRANSPORT_REFUSAL_" + kind);
        Connection c = connection[0];
        check(opens[0] == 1 && c.disconnected && !c.getInstanceFollowRedirects(), "ONE_FIXED_REQUEST_NO_REDIRECT");
        check(c.getConnectTimeout() <= 2000 && c.getReadTimeout() <= 2000, "BOUNDED_IO_LITERAL");
        if (allowed) {
            if ("resolver".equals(kind)) {
                check(c.getURL().toString().equals("https://core.letscube.ru/rest/v1/rpc/native_push_device_binding") && c.getRequestMethod().equals("POST"), "FIXED_RPC");
                check(c.sent.toString("UTF-8").equals("{\"p_token_hash\":\"" + "0".repeat(64) + "\"}"), "HASH_ONLY_RPC_BODY");
                check(MessagePreviewResponseParser.binding(value, MessagePreviewVerificationProbe.USER, MessagePreviewVerificationProbe.SESSION, MessagePreviewVerificationProbe.DEVICE), "ACTUAL_TRANSPORT_DTO");
            } else {
                check(c.getURL().toString().equals("https://core.letscube.ru/auth/v1/user") && c.getRequestMethod().equals("GET"), "FIXED_AUTH");
                check(MessagePreviewResponseParser.authUser(value, MessagePreviewVerificationProbe.USER), "ACTUAL_AUTH_DTO");
            }
        }
    }
    static void jwt(String kind) throws Exception {
        String head = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}", body = "{\"role\":\"authenticated\"}";
        JSONTokener.fixture(head, new JSONObject(MessagePreviewVerificationProbe.object("alg", "none".equals(kind) ? "none" : "HS256", "typ", "JWT")));
        JSONTokener.fixture(body, new JSONObject(MessagePreviewVerificationProbe.claims(new MessagePreviewVerificationProbe.Clock())));
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(head.getBytes(StandardCharsets.UTF_8)) + "."
            + Base64.getUrlEncoder().withoutPadding().encodeToString(body.getBytes(StandardCharsets.UTF_8)) + ".ZmljdGlvbmFs";
        if ("malformed".equals(kind)) token = "a.b";
        if ("padded".equals(kind)) token = token + "=";
        MessagePreviewHttpTransport http = new MessagePreviewHttpTransport(() -> 0, url -> { throw new AssertionError("DECODING_IS_NOT_NETWORK_AUTH"); });
        boolean refused = false; Map<String,Object> claims = null;
        try { claims = http.decode(token); } catch (Exception expected) { refused = true; }
        check("normal".equals(kind) ? claims != null && !refused : refused, "JWT_DECODER_" + kind);
    }
    static String verifiedPlugin(MessagePreviewsPlugin plugin, MessagePreviewVerificationProbe.Fixture f,
                                 long revision, String user, long account) throws Exception {
        f.jwt.put("sub", user);
        f.auth = MessagePreviewVerificationProbe.object("id", user, "is_anonymous", false);
        f.resolver = Arrays.asList(MessagePreviewVerificationProbe.object("binding_v", 1, "recipient_id", user,
            "session_id", SESSION, "device_id", DEVICE));
        PluginCall begin = new PluginCall(new JSObject().put("revision", revision).put("recipientId", user)
            .put("recipientSessionId", SESSION).put("accountEpoch", account));
        plugin.beginBinding(begin);
        check(begin.result.opt("epoch") instanceof String, "MALFORMED_BEGIN_POSITIVE_TICKET");
        String epoch = (String) begin.result.opt("epoch");
        PluginCall verify = new PluginCall(new JSObject().put("revision", revision).put("epoch", epoch)
            .put("recipientId", user).put("recipientSessionId", SESSION).put("accountEpoch", account)
            .put("deviceId", DEVICE).put("accessToken", "access").put("publicApiKey", "public-key"));
        plugin.verifyBinding(verify);
        check(verify.done.await(2000, TimeUnit.MILLISECONDS) && Boolean.TRUE.equals(verify.result.opt("verified"))
            && plugin.hasVerifiedBinding(user), "MALFORMED_BEGIN_VERIFIED_CONTROL");
        return epoch;
    }
    static void malformedBegin(String kind) throws Exception {
        MessagePreviewsPlugin plugin = new MessagePreviewsPlugin(); plugin.load();
        try {
            MessagePreviewVerificationProbe.Fixture f = new MessagePreviewVerificationProbe.Fixture();
            Field runtime = MessagePreviewsPlugin.class.getDeclaredField("runtime");
            runtime.setAccessible(true); runtime.set(plugin, f.runtime);
            verifiedPlugin(plugin, f, 1, USER, 1);
            boolean stale = kind.startsWith("stale-");
            String accountKind = stale ? kind.substring(6) : kind;
            String newest = stale ? verifiedPlugin(plugin, f, 3, MessagePreviewVerificationProbe.OTHER, 2) : null;
            JSObject input = new JSObject().put("revision", 2).put("recipientId", MessagePreviewVerificationProbe.OTHER)
                .put("recipientSessionId", SESSION);
            switch (accountKind) {
                case "missing": break;
                case "string": input.put("accountEpoch", "1"); break;
                case "fractional": input.put("accountEpoch", 1.5d); break;
                case "negative": input.put("accountEpoch", -1); break;
                case "unsafe": input.put("accountEpoch", 9007199254740992d); break;
                default: throw new AssertionError("EXACT_MALFORMED_ACCOUNT_CASE");
            }
            PluginCall refused = new PluginCall(input); plugin.beginBinding(refused);
            check(refused.result.length() == 1 && refused.result.opt("epoch") == JSONObject.NULL, "MALFORMED_BEGIN_NULL_ACK");
            if (stale) {
                check(plugin.hasVerifiedBinding(MessagePreviewVerificationProbe.OTHER) && !plugin.hasVerifiedBinding(USER)
                    && f.runtime.matchesVerified(3, newest, MessagePreviewVerificationProbe.OTHER, SESSION, 2, DEVICE),
                    "STALE_MALFORMED_BEGIN_KEEPS_B");
            } else {
                check(!plugin.hasVerifiedBinding(USER) && !f.runtime.hasVerifiedBinding(USER), "MALFORMED_NEWER_BEGIN_RETIRES");
            }
            PluginCall replay = new PluginCall(new JSObject().put("revision", 2)
                .put("recipientId", MessagePreviewVerificationProbe.OTHER).put("recipientSessionId", SESSION).put("accountEpoch", 1));
            plugin.beginBinding(replay);
            check(replay.result.opt("epoch") == JSONObject.NULL, "MALFORMED_BEGIN_REVISION_CONSUMED");
            check(plugin.hasVerifiedBinding(MessagePreviewVerificationProbe.OTHER) == stale && !plugin.hasVerifiedBinding(USER),
                "MALFORMED_BEGIN_REPLAY_KEEPS_RETIREMENT");
        } finally { plugin.handleOnDestroy(); }
    }
    static void plugin(String kind) throws Exception {
        MessagePreviewsPlugin plugin = new MessagePreviewsPlugin(); plugin.load();
        try {
            MessagePreviewVerificationProbe.Fixture f = new MessagePreviewVerificationProbe.Fixture();
            Field runtime = MessagePreviewsPlugin.class.getDeclaredField("runtime"); runtime.setAccessible(true); runtime.set(plugin, f.runtime);
            PluginCall capability = new PluginCall(new JSObject()); plugin.getCapabilities(capability);
            check(capability.result.length() == 1 && Integer.valueOf(0).equals(capability.result.opt("protocol")), "CAPABILITIES_CLOSED_LITERAL");
            if ("logging".equals(kind)) {
                String old = f.begin(1); check(f.verify(1, old), "LOGGING_RETIRE_CONTROL");
                plugin.getBridge().getConfig().enabled = true;
                PluginCall refused = new PluginCall(new JSObject().put("revision", 2).put("recipientId", USER).put("recipientSessionId", SESSION).put("accountEpoch", 1));
                plugin.beginBinding(refused);
                check(refused.result.opt("epoch") == JSONObject.NULL && !plugin.hasVerifiedBinding(USER) && !f.runtime.hasVerifiedBinding(USER), "LOGGER_BEGIN_RETIRES_AND_REFUSES"); return;
            }
            PluginCall begin = new PluginCall(new JSObject().put("revision", 1).put("recipientId", USER).put("recipientSessionId", SESSION).put("accountEpoch", 1));
            plugin.beginBinding(begin); String epoch = (String) begin.result.opt("epoch");
            check(epoch != null, "PLUGIN_BEGIN");
            Object account = "malformed".equals(kind) ? "1" : 1;
            if ("logging-verify".equals(kind)) plugin.getBridge().getConfig().enabled = true;
            CountDownLatch release = new CountDownLatch(1);
            if ("timeout".equals(kind)) f.afterAuth = () -> { try { release.await(); } catch (InterruptedException ignored) {} };
            PluginCall verify = new PluginCall(new JSObject().put("revision", 1).put("epoch", epoch).put("recipientId", USER)
                .put("recipientSessionId", SESSION).put("accountEpoch", account).put("deviceId", DEVICE).put("accessToken", "access").put("publicApiKey", "public-key"));
            plugin.verifyBinding(verify);
            check(!verify.getData().has("accessToken") && !verify.getData().has("publicApiKey"), "CALL_DROPS_CREDENTIALS");
            boolean expected = "normal".equals(kind);
            check(verify.done.await("timeout".equals(kind) ? 8500 : 2000, TimeUnit.MILLISECONDS), "PLUGIN_ACK_BOUNDED");
            release.countDown();
            check(Boolean.valueOf(expected).equals(verify.result.opt("verified")), "PLUGIN_VERIFIED_ACK");
            check(plugin.hasVerifiedBinding(USER) == expected && !plugin.hasVerifiedBinding(MessagePreviewVerificationProbe.OTHER), "INSTRUMENTATION_BOOLEAN_ONLY");
            plugin.getCapabilities(capability);
            check(Integer.valueOf(0).equals(capability.result.opt("protocol")), "VERIFIED_IS_NOT_CAPABILITY");
            PluginCall clear = new PluginCall(new JSObject().put("revision", 2)); plugin.clearBinding(clear);
            check(Boolean.TRUE.equals(clear.result.opt("applied")) && !plugin.hasVerifiedBinding(USER), "PLUGIN_CLEAR");
        } finally { plugin.handleOnDestroy(); }
    }
    public static void main(String[] args) throws Exception {
        String scenario = args[0];
        if (scenario.startsWith("transport-")) transport(scenario.substring(10));
        else if (scenario.startsWith("jwt-")) jwt(scenario.substring(4));
        else if (scenario.startsWith("plugin-begin-")) malformedBegin(scenario.substring(13));
        else plugin(scenario.substring(7));
        System.out.println("PASS " + scenario);
    }
}
