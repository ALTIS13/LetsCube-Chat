package com.kub.messenger;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/** Test-only stdin adapter: exercises the same parser compiled into the APK. */
public final class VoiceCallWireProbe {
    public static void main(String[] args) throws Exception {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = input.readLine()) != null) {
            String[] parts = line.split("\t", -1);
            long now = Long.parseLong(parts[0]);
            Map<String, String> fields = new HashMap<>();
            for (int index = 1; index < parts.length; index += 2) {
                String key = new String(Base64.getDecoder().decode(parts[index]), StandardCharsets.UTF_8);
                String value = new String(Base64.getDecoder().decode(parts[index + 1]), StandardCharsets.UTF_8);
                fields.put(key, value);
            }
            VoiceCallNotificationContract.Event event = VoiceCallNotificationContract.parse(fields, now);
            System.out.println(event != null && event.toMap().equals(fields) ? "accepted" : "rejected");
        }
    }
}
