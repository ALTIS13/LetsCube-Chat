package com.kub.messenger;

import static org.junit.Assert.*;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import org.junit.Before;
import org.junit.Test;

public class VoiceCallStateTest {
    static final String USER = "11111111-1111-1111-1111-111111111111";
    static final String SESSION = "22222222-2222-2222-2222-222222222222";
    static final String CALLER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    static final String CHAT = "33333333-3333-3333-3333-333333333333";
    static final String CHANNEL = "44444444-4444-4444-4444-444444444444";
    static final long START = 1_800_000_000_000L;
    Clock clock;
    VoiceCallState state;

    private Map<?, ?> storedEntries() throws ReflectiveOperationException {
        state.prune();
        java.lang.reflect.Field field = VoiceCallState.class.getDeclaredField("entries");
        field.setAccessible(true);
        return (Map<?, ?>) field.get(state);
    }

    static class Clock implements VoiceCallState.Clock {
        long wall = START + 100, elapsed = 100, boot = 1;
        public long wallTime() { return wall; }
        public long elapsedTime() { return elapsed; }
        public long bootCount() { return boot; }
        void advance(long ms) { wall += ms; elapsed += ms; }
    }

    static Map<String, String> wire(String event, long start) {
        Map<String, String> data = new HashMap<>();
        data.put("protocol_version", "1");
        data.put("type", "voice_call");
        data.put("event", event);
        data.put("ring_key", "voice:" + CHANNEL + ":" + start);
        data.put("chat_id", CHAT);
        data.put("channel_id", CHANNEL);
        data.put("caller_id", CALLER);
        data.put("recipient_id", USER);
        data.put("recipient_session_id", SESSION);
        data.put("route", "/chat/" + CHAT);
        data.put("ring_started_at", String.valueOf(start));
        data.put("expires_at", String.valueOf(start + 45_000));
        return data;
    }

    @Before public void setup() {
        clock = new Clock();
        state = new VoiceCallState(clock);
        String epoch = state.beginBinding(USER, SESSION);
        assertTrue(state.commitBinding(epoch, USER, SESSION));
    }

    @Test public void exactWireRoundTripsAndAcceptsBoundaries() {
        Map<String, String> data = wire("ring", START);
        assertEquals(data, VoiceCallNotificationContract.parse(data, START).toMap());
        assertNotNull(VoiceCallNotificationContract.parse(data, START + 44_999));
        assertNull(VoiceCallNotificationContract.parse(data, START + 45_000));
        assertNull(VoiceCallNotificationContract.parse(data, START - 1));
    }

    @Test public void rejectsEveryMissingAndAdditionalField() {
        for (String key : wire("ring", START).keySet()) {
            Map<String, String> data = wire("ring", START);
            data.remove(key);
            assertNull(key, VoiceCallNotificationContract.parse(data, START));
        }
        Map<String, String> data = wire("ring", START);
        data.put("title", "untrusted");
        assertNull(VoiceCallNotificationContract.parse(data, START));
    }

    @Test public void rejectsMalformedAndNoncanonicalValues() {
        String[][] invalid = {
            {"protocol_version", "2"}, {"protocol_version", "01"}, {"type", "message"},
            {"event", "accept"}, {"caller_id", USER}, {"caller_id", CALLER.toUpperCase()},
            {"chat_id", "3-3-3-3-3"}, {"recipient_session_id", "bad"},
            {"ring_key", "voice:" + CHANNEL + ":0"}, {"route", "/chat/" + CHAT + "/m/x"},
            {"route", "https://example.org/chat/" + CHAT}, {"ring_started_at", "01"},
            {"ring_started_at", "+1800000000000"}, {"ring_started_at", "1.8e12"},
            {"ring_started_at", "1800000000000\n"}, {"expires_at", "9007199254740992"},
            {"expires_at", "999999999999999999999999999999999999"},
            {"expires_at", "-1"}, {"expires_at", String.valueOf(START)},
            {"expires_at", String.valueOf(START + 45_001)}
        };
        for (String[] pair : invalid) {
            Map<String, String> data = wire("ring", START);
            data.put(pair[0], pair[1]);
            assertNull(pair[0] + " invalid case", VoiceCallNotificationContract.parse(data, START));
        }
    }

    @Test public void reservedMalformedVoiceCannotFallThrough() {
        assertTrue(VoiceCallNotificationContract.isReserved(Map.of("type", "voice_call")));
        assertTrue(VoiceCallNotificationContract.isReserved(Map.of("ring_key", "broken")));
        assertTrue(VoiceCallNotificationContract.isReserved(Map.of("protocol_version", "99")));
        assertTrue(VoiceCallNotificationContract.isReserved(Map.of("event", "cancel")));
        assertFalse(VoiceCallNotificationContract.isReserved(Map.of("type", "message", "chat_id", CHAT)));
    }

    @Test public void candidateDoesNotConferEligibility() {
        state.beginBinding(USER, SESSION);
        assertNull(state.receive(wire("ring", START)));
        assertEquals(0, state.activeEvents().size());
    }

    @Test public void checksBothBindingIds() {
        Map<String, String> data = wire("ring", START);
        data.put("recipient_id", CHAT);
        assertNull(state.receive(data));
        data = wire("ring", START);
        data.put("recipient_session_id", CHAT);
        assertNull(state.receive(data));
        assertNotNull(state.receive(wire("ring", START)));
    }

    @Test public void staleEpochAndWrongCandidatesCannotCommit() {
        String old = state.beginBinding(USER, SESSION);
        String fresh = state.beginBinding(USER, SESSION);
        assertNotEquals(old, fresh);
        assertFalse(state.commitBinding(old, USER, SESSION));
        assertFalse(state.commitBinding(fresh, USER, CHAT));
        assertFalse(state.commitBinding(fresh, CHAT, SESSION));
        assertTrue(state.commitBinding(fresh, USER, SESSION));
        state.clearBinding();
        assertFalse(state.commitBinding(fresh, USER, SESSION));
    }

    @Test public void malformedBridgeInputDoesNotDestroyValidBinding() {
        assertThrows(IllegalArgumentException.class, () -> state.beginBinding("BAD", SESSION));
        assertThrows(IllegalArgumentException.class, () -> state.commitBinding("BAD", USER, SESSION));
        assertThrows(IllegalArgumentException.class, () -> state.setForegroundRing("voice:broken"));
        assertNotNull(state.receive(wire("ring", START)));
    }

    @Test public void duplicateRingDoesNotAlertAfterRestart() throws IOException {
        assertNotNull(state.receive(wire("ring", START)));
        state = VoiceCallState.decode(state.encode(), clock);
        assertNull(state.receive(wire("ring", START)));
        assertEquals(1, state.activeEvents().size());
    }

    @Test public void cancelBeforeRingSurvivesRestartAndExpires() throws Exception {
        state.receive(wire("cancel", START));
        assertEquals(0, state.activeEvents().size());
        state = VoiceCallState.decode(state.encode(), clock);
        assertNull(state.receive(wire("ring", START)));
        assertEquals(1, storedEntries().size());
        clock.advance(44_900);
        state.prune();
        assertEquals(0, storedEntries().size());
        assertNull(state.receive(wire("ring", START)));
    }

    @Test public void olderCancelCannotRemoveNewerGeneration() {
        state.receive(wire("ring", START));
        clock.advance(1_000);
        state.receive(wire("ring", START + 1_000));
        state.receive(wire("cancel", START));
        state.receive(wire("cancel", START));
        assertEquals(1, state.activeEvents().size());
        assertEquals("voice:" + CHANNEL + ":" + (START + 1_000), state.activeEvents().get(0).ringKey);
    }

    @Test public void cancelRetainsItsOwnLongerAbsoluteExpiry() throws IOException {
        Map<String, String> shortRing = wire("ring", START);
        shortRing.put("expires_at", String.valueOf(START + 10_000));
        assertNotNull(state.receive(shortRing));
        state.receive(wire("cancel", START));
        clock.advance(11_000);
        state = VoiceCallState.decode(state.encode(), clock);
        assertNull(state.receive(wire("ring", START)));
        assertEquals(0, state.activeEvents().size());
    }

    @Test public void pendingExpiryDuringRebindCannotReviveAtCommit() {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        state.captureTap(state.tapToken(ring.ringKey));
        String epoch = state.beginBinding(USER, SESSION);
        clock.advance(45_000);
        assertNull(state.consumePendingAction());
        assertFalse(state.hasPendingAction());
        assertTrue(state.commitBinding(epoch, USER, SESSION));
        assertNull(state.consumePendingAction());
    }

    @Test public void exactForegroundOwnershipDoesNotSurviveProcessRecreation() throws IOException {
        state.setResumed(true);
        state.setForegroundRing(wire("ring", START).get("ring_key"));
        state = VoiceCallState.decode(state.encode(), clock);
        assertNotNull(state.receive(wire("ring", START)));
    }

    @Test public void pendingIntentCanBeConsumedOnlyOnceEvenIfReplayed() {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        String token = state.tapToken(ring.ringKey);
        assertTrue(state.captureTap(token));
        assertNotNull(state.consumePendingAction());
        assertFalse(state.captureTap(token));
        assertNull(state.consumePendingAction());
    }

    @Test public void parsedDtoCannotBeMutatedByCallerOrReturnedMap() {
        Map<String, String> data = wire("ring", START);
        VoiceCallNotificationContract.Event event = VoiceCallNotificationContract.parse(data, START);
        data.put("route", "/chat/" + CALLER);
        assertEquals("/chat/" + CHAT, event.toMap().get("route"));
        assertThrows(UnsupportedOperationException.class, () -> event.toMap().put("event", "cancel"));
    }

    @Test public void differentFullGenerationsHaveDifferentNotificationTags() {
        assertNotEquals(VoiceCallNotificationContract.notificationTag("voice:" + CHANNEL + ":1"),
            VoiceCallNotificationContract.notificationTag("voice:" + CHANNEL + ":2"));
    }

    @Test public void foregroundNeedsResumedAndExactDisplayedRing() {
        String key = wire("ring", START).get("ring_key");
        state.setForegroundRing(key);
        assertNotNull(state.receive(wire("ring", START)));
        state.setResumed(true);
        assertEquals(1, state.activeEvents().size());
        state.setForegroundRing(key);
        assertEquals(0, state.activeEvents().size());
        clock.advance(1_000);
        assertNotNull(state.receive(wire("ring", START + 1_000)));
        state.setForegroundRing(wire("ring", START + 2_000).get("ring_key"));
        state.setResumed(false);
        state.setResumed(true);
        clock.advance(1_000);
        assertNotNull(state.receive(wire("ring", START + 2_000)));
    }

    @Test public void exactForegroundSuppressionDoesNotCreateCancelTombstone() throws Exception {
        state.setResumed(true);
        state.setForegroundRing(wire("ring", START).get("ring_key"));
        assertNull(state.receive(wire("ring", START)));
        assertEquals(0, state.activeEvents().size());
        Object entry = storedEntries().get(wire("ring", START).get("ring_key"));
        java.lang.reflect.Field cancelled = entry.getClass().getDeclaredField("cancelled");
        cancelled.setAccessible(true);
        assertFalse(cancelled.getBoolean(entry));
    }

    @Test public void pendingTapWaitsForSameAccountVerifiedRebind() throws IOException {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        assertTrue(state.captureTap(state.tapToken(ring.ringKey)));
        String epoch = state.beginBinding(USER, SESSION);
        state = VoiceCallState.decode(state.encode(), clock);
        assertNull(state.consumePendingAction());
        assertTrue(state.commitBinding(epoch, USER, SESSION));
        assertEquals(ring.toMap(), state.consumePendingAction().toMap());
        assertNull(state.consumePendingAction());
    }

    @Test public void coldTapStillCapturesAfterSameAccountBegin() {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        String token = state.tapToken(ring.ringKey);
        String epoch = state.beginBinding(USER, SESSION);
        assertTrue(state.captureTap(token));
        assertNull(state.consumePendingAction());
        state.commitBinding(epoch, USER, SESSION);
        assertNotNull(state.consumePendingAction());
    }

    private String consumeFixture() {
        VoiceCallNotificationContract.Event event = state.receive(wire("ring", START));
        assertTrue(state.captureTap(state.tapToken(event.ringKey)));
        assertNotNull(state.consumePendingAction());
        return event.ringKey;
    }

    @Test public void consumedTapRevalidatesAfterSamePairReverificationAndRestart() throws IOException {
        String key = consumeFixture();
        String epoch = state.beginBinding(USER, SESSION);
        state = VoiceCallState.decode(state.encode(), clock);
        assertNull(state.revalidateConsumedAction(key));
        assertTrue(state.commitBinding(epoch, USER, SESSION));
        assertNotNull(state.revalidateConsumedAction(key));
        assertEquals(wire("ring", START), state.revalidateConsumedAction(key).toMap());
        assertNull(state.consumePendingAction());
    }

    @Test public void revalidationRequiresTheExactConsumedActionNotAnyReceivedRing() {
        String key = wire("ring", START).get("ring_key");
        assertNull(state.revalidateConsumedAction(key));
        state.receive(wire("ring", START));
        assertNull(state.revalidateConsumedAction(key));
        state.captureTap(state.tapToken(key));
        assertNull(state.revalidateConsumedAction(key));
        state.consumePendingAction();
        assertNotNull(state.revalidateConsumedAction(key));
        assertNull(state.revalidateConsumedAction(wire("ring", START + 1).get("ring_key")));
    }

    @Test public void cancelWhileRebindingInvalidatesAlreadyConsumedTap() {
        String key = consumeFixture();
        String epoch = state.beginBinding(USER, SESSION);
        state.receive(wire("cancel", START));
        state.commitBinding(epoch, USER, SESSION);
        assertNull(state.revalidateConsumedAction(key));
    }

    @Test public void muteReenableCannotRestoreAConsumedAction() {
        String key = consumeFixture();
        state.setCallsAllowed(false);
        state.setCallsAllowed(true);
        assertNull(state.revalidateConsumedAction(key));
    }

    @Test public void replacementSessionAndLogoutCannotRestoreAConsumedAction() {
        String key = consumeFixture();
        state.commitBinding(state.beginBinding(USER, CHAT), USER, CHAT);
        state.commitBinding(state.beginBinding(USER, SESSION), USER, SESSION);
        assertNull(state.revalidateConsumedAction(key));
        state.clearBinding();
        assertNull(state.revalidateConsumedAction(key));
    }

    @Test public void consumedActionExpiresAndANewerTapSupersedesIt() {
        String key = consumeFixture();
        clock.advance(1);
        VoiceCallNotificationContract.Event next = state.receive(wire("ring", START + 1));
        state.captureTap(state.tapToken(next.ringKey));
        assertNull(state.revalidateConsumedAction(key));
        state.consumePendingAction();
        assertNotNull(state.revalidateConsumedAction(next.ringKey));
        clock.advance(45000);
        assertNull(state.revalidateConsumedAction(next.ringKey));
    }

    @Test public void arbitraryIntentValueCannotCreateAnAction() {
        state.receive(wire("ring", START));
        assertFalse(state.captureTap(wire("ring", START).get("ring_key")));
        assertFalse(state.captureTap("00000000-0000-0000-0000-000000000000"));
        assertNull(state.consumePendingAction());
    }

    @Test public void cancelWhileAwaitingBindingInvalidatesPendingTap() {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        state.captureTap(state.tapToken(ring.ringKey));
        String epoch = state.beginBinding(USER, SESSION);
        state.receive(wire("cancel", START));
        state.commitBinding(epoch, USER, SESSION);
        assertNull(state.consumePendingAction());
        assertNull(state.receive(wire("ring", START)));
    }

    @Test public void accountOrSessionSwitchDropsPendingAndResetsPreference() {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        state.captureTap(state.tapToken(ring.ringKey));
        String epoch = state.beginBinding(USER, CHAT);
        state.commitBinding(epoch, USER, CHAT);
        assertNull(state.consumePendingAction());
        state.setCallsAllowed(false);
        epoch = state.beginBinding(CHAT, SESSION);
        state.commitBinding(epoch, CHAT, SESSION);
        Map<String, String> next = wire("ring", START);
        next.put("recipient_id", CHAT);
        assertNotNull(state.receive(next));
    }

    @Test public void callsDisabledDropsCardsAndActionsButTrueDoesNotBind() {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        state.captureTap(state.tapToken(ring.ringKey));
        state.setCallsAllowed(false);
        assertEquals(0, state.activeEvents().size());
        assertNull(state.consumePendingAction());
        String epoch = state.beginBinding(USER, SESSION);
        state.commitBinding(epoch, USER, SESSION);
        clock.advance(1_000);
        assertNull(state.receive(wire("ring", START + 1_000)));
        state.clearBinding();
        state.setCallsAllowed(true);
        assertNull(state.receive(wire("ring", START + 1_000)));
    }

    @Test public void expiryRemovesCardAndPendingAtAbsoluteDeadline() throws Exception {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        state.captureTap(state.tapToken(ring.ringKey));
        clock.advance(44_900);
        assertNull(state.consumePendingAction());
        assertEquals(0, state.activeEvents().size());
        assertEquals(0, storedEntries().size());
    }

    @Test public void wallRollbackCannotExtendLifetimeEvenAcrossProcessRestart() throws IOException {
        state.receive(wire("ring", START));
        byte[] disk = state.encode();
        clock.elapsed += 45_000;
        clock.wall = START + 1;
        state = VoiceCallState.decode(disk, clock);
        assertEquals(0, state.activeEvents().size());
        assertNull(state.receive(wire("ring", START)));
    }

    @Test public void rebootDoesNotReusePreviousBootElapsedClock() throws IOException {
        state.receive(wire("ring", START));
        byte[] disk = state.encode();
        clock.boot++;
        clock.elapsed = 1;
        clock.wall = START + 45_000;
        state = VoiceCallState.decode(disk, clock);
        assertEquals(0, state.activeEvents().size());
    }

    @Test public void capacityNeverEvictsLiveTombstonesForReplayedRings() throws Exception {
        for (int i = 0; i < 128; i++) state.receive(wire("cancel", START - i));
        for (int i = 0; i < 1_000; i++) state.receive(wire("ring", START - i));
        assertEquals(128, storedEntries().size());
        state = VoiceCallState.decode(state.encode(), clock);
        assertNull(state.receive(wire("ring", START)));
        assertEquals(0, state.activeEvents().size());
    }

    @Test public void overflowCancelFailsClosedWithoutLosingItsSuppression() throws IOException {
        for (int i = 0; i < 128; i++) state.receive(wire("ring", START - i - 1_000));
        state.receive(wire("cancel", START));
        assertEquals(0, state.activeEvents().size());
        state = VoiceCallState.decode(state.encode(), clock);
        clock.advance(43_901);
        assertNull(state.receive(wire("ring", START)));
        clock.advance(2_000);
        assertNotNull(state.receive(wire("ring", clock.wall)));
    }

    @Test public void clearBindingIsDurableAndInvalidatesCardsTombstonesAndTap() throws Exception {
        VoiceCallNotificationContract.Event ring = state.receive(wire("ring", START));
        String token = state.tapToken(ring.ringKey);
        state.captureTap(token);
        state.clearBinding();
        state = VoiceCallState.decode(state.encode(), clock);
        assertEquals(0, storedEntries().size());
        assertFalse(state.captureTap(token));
        assertNull(state.receive(wire("ring", START)));
        assertNull(state.consumePendingAction());
    }

    @Test public void corruptOrUnboundedPrivateStateIsRejected() throws IOException {
        assertThrows(IOException.class, () -> VoiceCallState.decode(new byte[131_073], clock));
        assertThrows(IOException.class, () -> VoiceCallState.decode(new byte[] {1, 2, 3}, clock));
        byte[] disk = state.encode();
        disk[0] ^= 1;
        assertThrows(IOException.class, () -> VoiceCallState.decode(disk, clock));
    }
}
