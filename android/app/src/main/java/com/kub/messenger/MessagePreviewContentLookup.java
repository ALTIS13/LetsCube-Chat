package com.kub.messenger;

import java.util.function.Consumer;

/** Inactive content consumer; the caller must supply native owner/card authority. */
final class MessagePreviewContentLookup {
    interface Reader { Object request(String access, String key, String device, String notification, long deadline) throws Exception; }
    interface Clock { long wallTime(); long elapsedTime(); }
    interface Owner { boolean isCurrent(Request request); }
    enum Outcome { REFUSED, CONSUMED, UNKNOWN }

    static final class Request {
        final String recipient, session, device, notification, chat, message, maximumLevel;
        final long accountEpoch, cardGeneration;
        Request(String recipient, String session, String device, String notification, String chat, String message,
                long accountEpoch, long cardGeneration, String maximumLevel) {
            this.recipient = recipient; this.session = session; this.device = device;
            this.notification = notification; this.chat = chat; this.message = message;
            this.accountEpoch = accountEpoch; this.cardGeneration = cardGeneration; this.maximumLevel = maximumLevel;
        }
        boolean valid() {
            return MessagePreviewContent.uuid(recipient) && MessagePreviewContent.uuid(session) && MessagePreviewContent.uuid(device)
                && MessagePreviewContent.uuid(notification) && MessagePreviewContent.uuid(chat) && MessagePreviewContent.uuid(message)
                && safe(accountEpoch) && safe(cardGeneration)
                && ("sender".equals(maximumLevel) || "message".equals(maximumLevel));
        }
    }
    private static final class Attempt {
        final Request request;
        final long wallStart, elapsedStart, deadline;
        long lastWall, lastElapsed;
        Attempt(Request request, long wall, long elapsed) {
            this.request = request; wallStart = lastWall = wall; elapsedStart = lastElapsed = elapsed;
            deadline = elapsed + 2_000;
        }
    }
    private final Reader reader;
    private final Runnable disconnect;
    private final Clock clock;
    private final Owner owner;
    private Attempt active;
    private boolean busy, closed;

    MessagePreviewContentLookup(Reader reader, Runnable disconnect, Clock clock, Owner owner) {
        this.reader = java.util.Objects.requireNonNull(reader); this.disconnect = java.util.Objects.requireNonNull(disconnect);
        this.clock = java.util.Objects.requireNonNull(clock); this.owner = java.util.Objects.requireNonNull(owner);
    }

    Outcome consume(Request request, String access, String publicKey, Consumer<MessagePreviewContent> sink) {
        Attempt attempt;
        synchronized (this) {
            try {
                if (closed || busy || request == null || !request.valid() || sink == null
                    || !header(access, 8192) || !header(publicKey, 4096) || !owner.isCurrent(request)) return Outcome.REFUSED;
                long wall = clock.wallTime(), elapsed = clock.elapsedTime();
                if (!safe(wall) || !safe(elapsed) || wall > 9007199254725991L || elapsed > 9007199254738991L) return Outcome.REFUSED;
                active = attempt = new Attempt(request, wall, elapsed); busy = true;
            } catch (RuntimeException refused) { return Outcome.REFUSED; }
        }
        try {
            Object response = reader.request(access, publicKey, request.device, request.notification, attempt.deadline);
            synchronized (this) {
                long now = currentTime(attempt);
                if (now < 0) return Outcome.REFUSED;
                MessagePreviewContent content = MessagePreviewContent.parse(response, request.recipient, request.session,
                    request.device, request.notification, request.chat, request.message, request.maximumLevel, now);
                if (content == null) return Outcome.REFUSED;
                now = currentTime(attempt);
                if (now < 0 || content.expiresAt <= now) return Outcome.REFUSED;
                // No response escapes across another asynchronous boundary before this check.
                try { sink.accept(content); return Outcome.CONSUMED; }
                catch (RuntimeException unknown) { return Outcome.UNKNOWN; }
            }
        } catch (Exception refused) { return Outcome.REFUSED; }
        finally {
            synchronized (this) { if (active == attempt) active = null; busy = false; }
        }
    }

    private long currentTime(Attempt attempt) {
        if (closed || active != attempt || !owner.isCurrent(attempt.request) || active != attempt) return -1;
        long wall = clock.wallTime(), elapsed = clock.elapsedTime();
        if (!safe(wall) || !safe(elapsed) || wall < attempt.lastWall || elapsed < attempt.lastElapsed
            || elapsed >= attempt.deadline) return -1;
        attempt.lastWall = wall; attempt.lastElapsed = elapsed;
        return Math.max(wall, attempt.wallStart + (elapsed - attempt.elapsedStart));
    }

    synchronized void cancel() {
        if (active == null) return;
        active = null;
        try { disconnect.run(); } catch (RuntimeException unavailable) { /* Cancellation still retires admission. */ }
    }
    synchronized void close() { closed = true; cancel(); }
    private static boolean safe(long value) { return value >= 0 && value <= 9007199254740991L; }
    private static boolean header(String value, int maximum) {
        if (value == null || value.isEmpty() || value.length() > maximum) return false;
        for (int i = 0; i < value.length(); i++) if (value.charAt(i) < 33 || value.charAt(i) > 126) return false;
        return true;
    }
}
