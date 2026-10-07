package com.kub.messenger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class ChatNotificationCleanupTest {
    private static final String CHAT = "8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
    private static final String OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    private static final String NEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    private static final String USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    private static final String INSTANCE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    private static final ChatNotificationCleanup.IntentStore intents = new ChatNotificationCleanup.IntentStore() {
        private final Map<String, ChatNotificationCleanup.Posted> values = new HashMap<>();
        @Override public ChatNotificationCleanup.Posted read(String tag) { return values.get(tag); }
        @Override public boolean write(String tag, ChatNotificationCleanup.Posted value) { values.put(tag, value); return true; }
    };
    private ChatNotificationCleanup.Owner owner() {
        ChatNotificationCleanup.activate(INSTANCE);
        ChatNotificationCleanup.bind(INSTANCE, 1, USER, 1);
        return ChatNotificationCleanup.matches(INSTANCE, 1, USER, 1);
    }
    private static final class Cards implements ChatNotificationCleanup.Cards {
        ChatNotificationCleanup.Card card;
        Cards(String id) { ChatNotificationCleanup.post(intents, "message:chat:" + CHAT, id, id, generation ->
            card = new ChatNotificationCleanup.Card("message:chat:" + CHAT, 0, false, 1, CHAT, id, id, generation)); }
        @Override public List<ChatNotificationCleanup.Card> active() { return card == null ? List.of() : List.of(card); }
        @Override public void cancel(String tag, int id) { card = null; }
        @Override public ChatNotificationCleanup.IntentStore intents() { return intents; }
    }
    @Test public void exactReadRemovesOnlyConfirmedCard() {
        ChatNotificationCleanup.Owner owner = owner();
        Cards cards = new Cards(OLD);
        assertEquals(1, ChatNotificationCleanup.removeRead(owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD)), cards));
        assertNull(cards.card);
    }
    @Test public void sameChatNewerCardRemains() {
        ChatNotificationCleanup.Owner owner = owner();
        Cards cards = new Cards(NEW);
        assertEquals(0, ChatNotificationCleanup.removeRead(owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD)), cards));
        assertNotNull(cards.card);
    }
    @Test public void retiredEpochAndReloadCannotRemove() {
        ChatNotificationCleanup.Owner owner = owner();
        Cards cards = new Cards(OLD);
        ChatNotificationCleanup.bind(INSTANCE, 2, USER, 2);
        assertEquals(0, ChatNotificationCleanup.removeRead(owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD)), cards));
        ChatNotificationCleanup.activate(NEW);
        assertEquals(0, ChatNotificationCleanup.removeRead(owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD)), cards));
        assertNotNull(cards.card);
    }
    @Test public void missingLegacyIdentityRemains() {
        ChatNotificationCleanup.Owner owner = owner();
        Cards cards = new Cards(null);
        assertEquals(0, ChatNotificationCleanup.removeRead(owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD)), cards));
        assertNotNull(cards.card);
    }
}
