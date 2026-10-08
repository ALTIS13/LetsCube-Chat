package com.kub.messenger;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

final class MessagePreviewVerificationRuntime {
    interface TokenSource { String token(long deadline) throws Exception; }
    interface Transport { Object request(boolean user, String access, String key, String hash, long deadline) throws Exception; void cancel(); }
    interface JwtDecoder { Map<String,Object> decode(String value) throws Exception; }
    private final MessagePreviewVerificationState state;
    private final TokenSource tokens;
    private final Transport transport;
    private final JwtDecoder decoder;
    private final AtomicBoolean busy = new AtomicBoolean();
    private boolean closed;

    MessagePreviewVerificationRuntime(MessagePreviewVerificationState state, TokenSource tokens, Transport transport, JwtDecoder decoder) {
        this.state = state; this.tokens = tokens; this.transport = transport; this.decoder = decoder;
    }
    synchronized String beginBinding(long revision, String user, String session, long accountEpoch) {
        if (closed) return null;
        String epoch = state.begin(revision, user, session, accountEpoch);
        // Cancel only a newer transition, never a stale begin against a live worker.
        if (epoch != null) transport.cancel();
        return epoch;
    }
    synchronized boolean clearBinding(long revision) {
        if (closed || !state.clear(revision)) return false;
        transport.cancel(); return true;
    }
    boolean verifyBinding(long revision, String epoch, String user, String session, long accountEpoch, String device, String access, String key) {
        MessagePreviewVerificationState.Ticket ticket;
        synchronized (this) {
            if (closed) return false;
            ticket = state.start(revision, epoch, user, session, accountEpoch, device);
            if (ticket == null) return false;
            if (!busy.compareAndSet(false, true)) { state.fail(ticket); return false; }
        }
        boolean verified = false;
        try {
            if (!header(access, 8192) || !header(key, 4096)) return false;
            long expires = MessagePreviewResponseParser.accessExpiry(decoder.decode(access), user, session, state.now());
            Map<String,Object> keyClaims = key.startsWith("sb_publishable_") ? null : decoder.decode(key);
            if (expires == 0 || !MessagePreviewResponseParser.publicKey(key, keyClaims) || !state.authorizeTime(ticket, expires)) return false;
            Object auth = transport.request(true, access, key, null, ticket.deadline);
            if (!state.active(ticket) || !MessagePreviewResponseParser.authUser(auth, user)) return false;
            String first = tokens.token(ticket.deadline);
            if (!state.active(ticket) || !sdkToken(first)) return false;
            String hash = hash(first);
            Object response = transport.request(false, access, key, hash, ticket.deadline);
            if (!state.active(ticket) || !MessagePreviewResponseParser.binding(response, user, session, device)) return false;
            String second = tokens.token(ticket.deadline);
            if (!state.active(ticket) || !first.equals(second)) return false;
            verified = state.finish(ticket, expires);
            return verified;
        } catch (Exception refused) { return false; }
        finally {
            if (!verified) state.fail(ticket);
            busy.set(false);
        }
    }
    static boolean header(String value, int cap) {
        if (value == null || value.isEmpty() || value.length() > cap) return false;
        for (int i = 0; i < value.length(); i++) if (value.charAt(i) < 33 || value.charAt(i) > 126) return false;
        return true;
    }
    static boolean sdkToken(String value) { return header(value, 4096); }
    private static String hash(String token) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(64);
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    synchronized boolean hasVerifiedBinding(String expectedRecipientId) { return !closed && state.hasVerifiedBinding(expectedRecipientId); }
    synchronized boolean matchesVerified(long revision, String epoch, String user, String session, long accountEpoch, String device) {
        return !closed && state.matchesVerified(revision, epoch, user, session, accountEpoch, device);
    }
    synchronized void rejectBinding(long revision, String epoch, String user, String session, long accountEpoch, String device) {
        MessagePreviewVerificationState.Ticket ticket = state.start(revision, epoch, user, session, accountEpoch, device);
        if (ticket != null) state.fail(ticket);
    }
    synchronized void cancelBinding(long revision, String epoch, String user, String session, long accountEpoch, String device) {
        if (state.invalidate(revision, epoch, user, session, accountEpoch, device)) transport.cancel();
    }
    synchronized void retire() { state.reset(); transport.cancel(); }
    synchronized void close() { closed = true; state.reset(); transport.cancel(); }
}
