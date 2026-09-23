package com.kub.messenger;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ChatPushChannelTest {
    @Test public void existingMessagesChannelKeepsItsSoundAndMuteChoice() {
        assertEquals("messages", ChatPushNotifications.channelIdFor(true, false));
    }

    @Test public void freshInstallSelectsTheVersionedMessageChannel() {
        assertEquals("messages_v2", ChatPushNotifications.channelIdFor(false, false));
    }

    @Test public void freshChoiceSurvivesLaterLegacyChannelCreation() {
        assertEquals("messages_v2", ChatPushNotifications.channelIdFor(true, true));
    }
}
