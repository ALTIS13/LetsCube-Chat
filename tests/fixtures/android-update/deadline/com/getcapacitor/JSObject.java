package com.getcapacitor;

/** Transport probes never consume bridge JSON; retain only its compiled return type. */
public final class JSObject {
    public JSObject put(String key, Object value) { return this; }
}
