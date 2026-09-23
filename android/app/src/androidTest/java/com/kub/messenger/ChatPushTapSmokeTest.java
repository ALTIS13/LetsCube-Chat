package com.kub.messenger;

import static org.junit.Assert.assertNotNull;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Sends only an explicitly selected QA card's real Android tap intent. */
@RunWith(AndroidJUnit4.class)
public class ChatPushTapSmokeTest {
    @Test public void opensSelectedQaCard() throws PendingIntent.CanceledException {
        String tag = InstrumentationRegistry.getArguments().getString("qa_tag");
        Assume.assumeTrue(tag != null && tag.matches("message:chat:[0-9a-f-]{36}"));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull(manager);
        PendingIntent tap = null;
        for (StatusBarNotification card : manager.getActiveNotifications()) {
            if (tag.equals(card.getTag()) && card.getId() == 0) tap = card.getNotification().contentIntent;
        }
        assertNotNull("The selected QA notification card must still be active", tap);
        tap.send();
    }
}
