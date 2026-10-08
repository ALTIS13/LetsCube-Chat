package com.kub.messenger;

import java.util.List;
import java.util.Map;

final class MessagePreviewResponseParser {
    static long accessExpiry(Map<String,Object> claims, String user, String session, long now) {
        if (claims == null || !"authenticated".equals(claims.get("role")) || !"authenticated".equals(claims.get("aud"))
            || !Boolean.FALSE.equals(claims.get("is_anonymous")) || !"https://core.letscube.ru/auth/v1".equals(claims.get("iss"))
            || !user.equals(claims.get("sub")) || !session.equals(claims.get("session_id"))) return 0;
        Object value = claims.get("exp");
        if (!(value instanceof Number)) return 0;
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number <= 0 || number > MessagePreviewVerificationState.MAX_SAFE_INTEGER || number != Math.rint(number)) return 0;
        long expiry = ((Number) value).longValue() * 1000;
        return expiry > now ? expiry : 0;
    }
    static boolean publicKey(String key, Map<String,Object> claims) {
        return key != null && (key.matches("sb_publishable_[A-Za-z0-9_-]{10,128}")
            || (claims != null && "anon".equals(claims.get("role"))));
    }
    static boolean authUser(Object data, String user) {
        if (!(data instanceof Map)) return false;
        Map<?,?> value = (Map<?,?>) data;
        return user.equals(value.get("id")) && Boolean.FALSE.equals(value.get("is_anonymous"));
    }
    static boolean binding(Object data, String user, String session, String device) {
        if (!(data instanceof List) || ((List<?>) data).size() != 1 || !(((List<?>) data).get(0) instanceof Map)) return false;
        Map<?,?> row = (Map<?,?>) ((List<?>) data).get(0);
        Object version = row.get("binding_v");
        return row.size() == 4 && version instanceof Number && ((Number) version).doubleValue() == 1d
            && user.equals(row.get("recipient_id")) && session.equals(row.get("session_id")) && device.equals(row.get("device_id"));
    }
}
