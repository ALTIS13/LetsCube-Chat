package com.kub.messenger;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Pure state machine; the runtime persists each transition before external effects. */
final class VoiceCallState {
    interface Clock {
        long wallTime();
        long elapsedTime();
        long bootCount();
    }

    static final int MAX_BYTES = 131_072;
    private static final int MAX_ENTRIES = 128;
    private static final int FORMAT = 0x56430102;
    private final Clock clock;
    private String epoch, user, session, pendingKey, consumedKey;
    private boolean bound, callsAllowed = true, resumed;
    private String foregroundRing;
    private long blockedUntil, lastNow, lastElapsed, lastBoot;
    private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>();

    private static final class Entry {
        VoiceCallNotificationContract.Event event;
        boolean cancelled, active;
        String tapToken;
        Entry(VoiceCallNotificationContract.Event event) { this.event = event; }
    }

    VoiceCallState(Clock clock) {
        this.clock = clock;
        lastNow = clock.wallTime();
        lastElapsed = clock.elapsedTime();
        lastBoot = clock.bootCount();
    }

    long now() {
        long elapsed = clock.elapsedTime();
        long boot = clock.bootCount();
        // A wall-clock rollback must not extend a generation, including after process death.
        long advance = boot == lastBoot && elapsed >= lastElapsed ? elapsed - lastElapsed : 0;
        lastNow = Math.max(clock.wallTime(), lastNow + advance);
        lastElapsed = elapsed;
        lastBoot = boot;
        return lastNow;
    }

    String beginBinding(String recipientId, String recipientSessionId) {
        requireUuid(recipientId);
        requireUuid(recipientSessionId);
        prune();
        if (!recipientId.equals(user) || !recipientSessionId.equals(session)) {
            entries.clear();
            pendingKey = null;
            consumedKey = null;
            blockedUntil = 0;
            callsAllowed = true;
        }
        user = recipientId;
        session = recipientSessionId;
        bound = false;
        epoch = UUID.randomUUID().toString();
        foregroundRing = null;
        cancelCards();
        return epoch;
    }

    boolean commitBinding(String candidateEpoch, String recipientId, String recipientSessionId) {
        requireUuid(candidateEpoch);
        requireUuid(recipientId);
        requireUuid(recipientSessionId);
        if (!candidateEpoch.equals(epoch) || !recipientId.equals(user) || !recipientSessionId.equals(session)) return false;
        bound = true;
        prune();
        return true;
    }

    void clearBinding() {
        epoch = user = session = pendingKey = consumedKey = foregroundRing = null;
        bound = false;
        callsAllowed = true;
        blockedUntil = 0;
        entries.clear();
    }

    void setCallsAllowed(boolean allowed) {
        callsAllowed = allowed;
        if (!allowed) {
            cancelCards();
            pendingKey = null;
            consumedKey = null;
            for (Entry entry : entries.values()) entry.tapToken = null;
        }
    }

    void setResumed(boolean value) {
        resumed = value;
        foregroundRing = null;
    }

    void setForegroundRing(String key) {
        if (key != null && !VoiceCallNotificationContract.isRingKey(key)) throw new IllegalArgumentException("Invalid ring key");
        foregroundRing = resumed ? key : null;
        if (foregroundRing != null) {
            Entry entry = entries.get(foregroundRing);
            if (entry != null) entry.active = false;
        }
    }

    VoiceCallNotificationContract.Event receive(Map<String, String> data) {
        prune();
        VoiceCallNotificationContract.Event event = VoiceCallNotificationContract.parse(data, now());
        if (event == null || !event.matches(user, session)) return null;
        Entry previous = entries.get(event.ringKey);
        if ("cancel".equals(event.event)) {
            if (previous == null) {
                if (entries.size() >= MAX_ENTRIES) {
                    // No room to remember this cancellation: deny all rings until its expiry.
                    blockedUntil = Math.max(blockedUntil, event.expiresAt);
                    cancelCards();
                    pendingKey = null;
                    consumedKey = null;
                    return null;
                }
                previous = new Entry(event);
                entries.put(event.ringKey, previous);
            }
            if (event.expiresAt > previous.event.expiresAt) previous.event = event;
            previous.cancelled = true;
            previous.active = false;
            previous.tapToken = null;
            if (event.ringKey.equals(pendingKey)) pendingKey = null;
            if (event.ringKey.equals(consumedKey)) consumedKey = null;
            return null;
        }
        if (!bound || !callsAllowed || blockedUntil > now() || previous != null || entries.size() >= MAX_ENTRIES) return null;
        Entry entry = new Entry(event);
        entry.active = !(resumed && event.ringKey.equals(foregroundRing));
        entry.tapToken = entry.active ? UUID.randomUUID().toString() : null;
        entries.put(event.ringKey, entry);
        return entry.active ? event : null;
    }

    boolean captureTap(String token) {
        prune();
        if (!VoiceCallNotificationContract.isUuid(token) || !callsAllowed || blockedUntil > now()) return false;
        for (Entry entry : entries.values()) {
            if (token.equals(entry.tapToken) && !entry.cancelled && entry.event.matches(user, session)) {
                pendingKey = entry.event.ringKey;
                consumedKey = null;
                entry.active = false;
                entry.tapToken = null;
                return true;
            }
        }
        return false;
    }

    VoiceCallNotificationContract.Event consumePendingAction() {
        prune();
        Entry entry = entries.get(pendingKey);
        if (entry == null || entry.cancelled || !callsAllowed || blockedUntil > now() || !entry.event.matches(user, session)) {
            pendingKey = null;
            return null;
        }
        if (!bound) return null;
        consumedKey = pendingKey;
        pendingKey = null;
        return entry.event;
    }

    String tapToken(String key) {
        Entry entry = entries.get(key);
        return entry == null ? null : entry.tapToken;
    }

    VoiceCallNotificationContract.Event revalidateConsumedAction(String ringKey) {
        prune();
        if (ringKey == null || !ringKey.equals(consumedKey) || !bound || !callsAllowed || blockedUntil > now()) return null;
        Entry entry = entries.get(consumedKey);
        if (entry == null || entry.cancelled || !entry.event.matches(user, session)) return null;
        return entry.event;
    }

    boolean hasPendingAction() {
        prune();
        return pendingKey != null;
    }

    List<VoiceCallNotificationContract.Event> activeEvents() {
        prune();
        List<VoiceCallNotificationContract.Event> active = new ArrayList<>();
        if (bound && callsAllowed && blockedUntil <= now()) {
            for (Entry entry : entries.values()) if (entry.active && !entry.cancelled) active.add(entry.event);
        }
        return active;
    }

    long nextExpiry() {
        prune();
        long next = blockedUntil > 0 ? blockedUntil : Long.MAX_VALUE;
        for (Entry entry : entries.values()) next = Math.min(next, entry.event.expiresAt);
        return next;
    }

    void prune() {
        long now = now();
        Iterator<Entry> iterator = entries.values().iterator();
        while (iterator.hasNext()) {
            Entry entry = iterator.next();
            if (entry.event.expiresAt <= now || entry.event.startedAt > now) iterator.remove();
        }
        if (!entries.containsKey(pendingKey)) pendingKey = null;
        if (!entries.containsKey(consumedKey)) consumedKey = null;
        if (blockedUntil <= now) blockedUntil = 0;
    }

    private void cancelCards() { for (Entry entry : entries.values()) entry.active = false; }

    private static void requireUuid(String value) {
        if (!VoiceCallNotificationContract.isUuid(value)) throw new IllegalArgumentException("Invalid binding");
    }

    byte[] encode() throws IOException {
        prune();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(bytes)) {
            out.writeInt(FORMAT);
            out.writeLong(lastNow);
            out.writeLong(lastElapsed);
            out.writeLong(lastBoot);
            writeNullable(out, epoch);
            writeNullable(out, user);
            writeNullable(out, session);
            out.writeBoolean(bound);
            out.writeBoolean(callsAllowed);
            out.writeLong(blockedUntil);
            writeNullable(out, pendingKey);
            writeNullable(out, consumedKey);
            out.writeInt(entries.size());
            for (Entry entry : entries.values()) {
                for (String key : VoiceCallNotificationContract.KEYS) out.writeUTF(entry.event.toMap().get(key));
                out.writeBoolean(entry.cancelled);
                out.writeBoolean(entry.active);
                writeNullable(out, entry.tapToken);
            }
        }
        if (bytes.size() > MAX_BYTES) throw new IOException("Invalid voice state");
        return bytes.toByteArray();
    }

    static VoiceCallState decode(byte[] bytes, Clock clock) throws IOException {
        if (bytes.length > MAX_BYTES) throw new IOException("Invalid voice state");
        VoiceCallState state = new VoiceCallState(clock);
        try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(bytes))) {
            if (in.readInt() != FORMAT) throw new IOException("Invalid voice state");
            state.lastNow = in.readLong();
            state.lastElapsed = in.readLong();
            state.lastBoot = in.readLong();
            if (state.lastNow < 0 || state.lastNow > VoiceCallNotificationContract.MAX_SAFE_INTEGER || state.lastElapsed < 0) {
                throw new IOException("Invalid voice clock");
            }
            state.epoch = readNullable(in);
            state.user = readNullable(in);
            state.session = readNullable(in);
            if (state.epoch != null) {
                requireUuid(state.epoch);
                requireUuid(state.user);
                requireUuid(state.session);
            } else if (state.user != null || state.session != null) throw new IOException("Invalid voice binding");
            state.bound = in.readBoolean();
            if (state.bound && state.epoch == null) throw new IOException("Invalid voice binding");
            state.callsAllowed = in.readBoolean();
            state.blockedUntil = in.readLong();
            state.pendingKey = readNullable(in);
            state.consumedKey = readNullable(in);
            long now = state.now();
            if (state.blockedUntil < 0 || state.blockedUntil > now + 45_000) throw new IOException("Invalid voice deadline");
            int count = in.readInt();
            if (count < 0 || count > MAX_ENTRIES) throw new IOException("Invalid voice count");
            for (int i = 0; i < count; i++) {
                Map<String, String> data = new LinkedHashMap<>();
                for (String key : VoiceCallNotificationContract.KEYS) data.put(key, in.readUTF());
                boolean cancelled = in.readBoolean(), active = in.readBoolean();
                String token = readNullable(in);
                if (token != null) requireUuid(token);
                VoiceCallNotificationContract.Event event = VoiceCallNotificationContract.parse(data, Long.parseLong(data.get("ring_started_at")));
                if (event == null) throw new IOException("Invalid voice entry");
                if (!event.matches(state.user, state.session) || state.entries.containsKey(event.ringKey)) {
                    throw new IOException("Invalid voice entry");
                }
                Entry entry = new Entry(event);
                entry.cancelled = cancelled;
                entry.active = active && !cancelled;
                entry.tapToken = cancelled ? null : token;
                state.entries.put(event.ringKey, entry);
            }
            if (in.available() != 0) throw new IOException("Invalid voice state");
            state.prune();
            return state;
        } catch (IllegalArgumentException e) {
            throw new IOException("Invalid voice state");
        }
    }

    private static void writeNullable(DataOutputStream out, String value) throws IOException {
        out.writeUTF(value == null ? "" : value);
    }

    private static String readNullable(DataInputStream in) throws IOException {
        String value = in.readUTF();
        return value.isEmpty() ? null : value;
    }
}
