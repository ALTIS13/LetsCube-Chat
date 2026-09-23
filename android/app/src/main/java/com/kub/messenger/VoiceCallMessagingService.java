package com.kub.messenger;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class VoiceCallMessagingService extends MessagingService {
    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (VoiceCallNotificationContract.isReserved(data)) {
            VoiceCallRuntime.get(this).receive(data);
            return;
        }
        if (ChatPushNotificationContract.isReserved(data)) {
            try {
                ChatPushNotifications.receive(this, message);
            } catch (RuntimeException ignored) {
                // The in-app notification remains authoritative if Android display fails.
            }
            super.onMessageReceived(message);
            return;
        }
        super.onMessageReceived(message);
    }
    // Token refresh intentionally inherits Capacitor's unchanged implementation.
}
