package com.kub.messenger;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;
import org.json.JSONObject;

@CapacitorPlugin(name = "VoiceCalls")
public class VoiceCallsPlugin extends Plugin {
    private VoiceCallRuntime runtime;
    private final Runnable actionPending = () -> notifyListeners("actionPending", new JSObject(), true);

    @Override public void load() {
        runtime = VoiceCallRuntime.get(getContext());
        runtime.setActionListener(actionPending);
    }

    @PluginMethod public void getCapabilities(PluginCall call) {
        JSObject result = new JSObject();
        if (VoiceCallRuntime.supported()) result.put("protocol", 1);
        call.resolve(result);
    }

    @PluginMethod public void beginBinding(PluginCall call) {
        respond(call, () -> new JSObject().put("epoch", runtime.beginBinding(call.getString("recipientId"), call.getString("recipientSessionId"))));
    }

    @PluginMethod public void commitBinding(PluginCall call) {
        respond(call, () -> new JSObject().put("applied", runtime.commitBinding(call.getString("epoch"), call.getString("recipientId"), call.getString("recipientSessionId"))));
    }

    @PluginMethod public void clearBinding(PluginCall call) {
        respond(call, () -> { runtime.clearBinding(); return new JSObject(); });
    }

    @PluginMethod public void setCallsAllowed(PluginCall call) {
        respond(call, () -> {
            Boolean allowed = call.getBoolean("allowed");
            if (allowed == null) throw new IllegalArgumentException();
            runtime.setCallsAllowed(allowed);
            return new JSObject();
        });
    }

    @PluginMethod public void setForegroundRing(PluginCall call) {
        respond(call, () -> {
            Object value = call.getData().opt("ringKey");
            if (!call.getData().has("ringKey") || (value != JSONObject.NULL && !(value instanceof String))) throw new IllegalArgumentException();
            runtime.setForegroundRing(value == JSONObject.NULL ? null : (String) value);
            return new JSObject();
        });
    }

    @PluginMethod public void consumePendingAction(PluginCall call) {
        respond(call, () -> actionResult(runtime.consumePendingAction()));
    }

    @PluginMethod public void revalidateConsumedAction(PluginCall call) {
        respond(call, () -> {
            String ringKey = call.getString("ringKey");
            if (!VoiceCallNotificationContract.isRingKey(ringKey)) throw new IllegalArgumentException();
            return actionResult(runtime.revalidateConsumedAction(ringKey));
        });
    }

    private JSObject actionResult(VoiceCallNotificationContract.Event event) {
        JSObject result = new JSObject();
        if (event == null) return result.put("event", JSONObject.NULL);
        JSObject dto = new JSObject();
        for (Map.Entry<String, String> field : event.toMap().entrySet()) dto.put(field.getKey(), field.getValue());
        return result.put("event", dto);
    }

    @Override protected void handleOnDestroy() {
        if (runtime != null) runtime.removeActionListener(actionPending);
    }

    private interface Response { JSObject run(); }

    private void respond(PluginCall call, Response response) {
        try {
            call.resolve(response.run());
        } catch (IllegalArgumentException ignored) {
            call.reject("Invalid voice call arguments", "VOICE_ARGUMENTS");
        } catch (IllegalStateException | SecurityException ignored) {
            call.reject("Voice call state unavailable", "VOICE_STATE");
        }
    }
}
