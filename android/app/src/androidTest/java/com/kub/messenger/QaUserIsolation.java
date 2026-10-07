package com.kub.messenger;

final class QaUserIsolation {
    static boolean matches(String requested, int uid) {
        if (requested == null || !requested.matches("[1-9][0-9]*")) return false;
        try {
            int user = Integer.parseInt(requested);
            return user > 0 && user == uid / 100000;
        } catch (NumberFormatException invalid) { return false; }
    }
}
