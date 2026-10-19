package com.kub.messenger;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

public class AndroidUpdatePolicyProbe {
    private static int checks;
    private static void require(boolean value) { if (!value) throw new AssertionError("POLICY_ASSERT"); checks++; }
    private static void refuses(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { checks++; return; }
        throw new AssertionError("POLICY_MUST_REFUSE");
    }
    public static void main(String[] args) throws Exception {
        String version = "0.1.31", url = "https://api.letscube.ru/releases/files/android/0.1.31/letscube-0.1.31.apk";
        String signer = "ac8249647e3e32b32e7dba283c6c7bc835f293401a3cf82115901ce74f4a0839";
        byte[] bytes = "synthetic apk bytes".getBytes("UTF-8");
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        AndroidUpdatePolicy.Release release = new AndroidUpdatePolicy.Release(version, 32, bytes.length, hash, url);
        for (String bad : new String[] { url.replace("https:", "http:"), url + "?token=x", url + "#fragment",
            url.replace("api.letscube.ru", "api.letscube.ru.evil.invalid"), url.replace("https://", "https://user@"),
            url.replace("api.letscube.ru/", "api.letscube.ru:443/"), url.replace("0.1.31.apk", "other.apk"),
            url.replace("/0.1.31/", "/0.1.30/"), url.replace("/letscube-", "/../letscube-"),
            url.replace("/letscube-", "/%2e%2e/letscube-") })
            refuses(() -> new AndroidUpdatePolicy.Release(version, 32, bytes.length, hash, bad));
        refuses(() -> new AndroidUpdatePolicy.Release(version, 32, 0, hash, url));
        refuses(() -> new AndroidUpdatePolicy.Release(version, 32, 104857601, hash, url));
        refuses(() -> new AndroidUpdatePolicy.Release(version, 32, bytes.length, "0".repeat(63), url));
        var installed = new AndroidUpdatePolicy.Identity("com.kub.messenger", "0.1.30", 31, List.of(signer));
        var archive = new AndroidUpdatePolicy.Identity("com.kub.messenger", version, 32, List.of(signer));
        AndroidUpdatePolicy.verifyPackage(release, installed, archive); checks++;
        for (var bad : List.of(
            new AndroidUpdatePolicy.Identity("other.package", version, 32, List.of(signer)),
            new AndroidUpdatePolicy.Identity("com.kub.messenger", "0.1.32", 32, List.of(signer)),
            new AndroidUpdatePolicy.Identity("com.kub.messenger", version, 33, List.of(signer)),
            new AndroidUpdatePolicy.Identity("com.kub.messenger", version, 32, List.of("0".repeat(64))),
            new AndroidUpdatePolicy.Identity("com.kub.messenger", version, 32, List.of(signer, signer))))
            refuses(() -> AndroidUpdatePolicy.verifyPackage(release, installed, bad));
        refuses(() -> AndroidUpdatePolicy.verifyPackage(release, archive, archive));
        refuses(() -> AndroidUpdatePolicy.verifyPackage(release,
            new AndroidUpdatePolicy.Identity("com.kub.messenger", "0.1.30", 31, List.of("0".repeat(64))), archive));
        Path directory = Files.createTempDirectory("android-update-policy-");
        try {
            File apk = directory.resolve("candidate.apk").toFile(); Files.write(apk.toPath(), bytes);
            AndroidUpdatePolicy.verifyFile(apk, release); checks++;
            Files.write(apk.toPath(), "wrong".getBytes("UTF-8"));
            refuses(() -> AndroidUpdatePolicy.verifyFile(apk, release));
            byte[] other = bytes.clone(); other[0] ^= 1; Files.write(apk.toPath(), other);
            refuses(() -> AndroidUpdatePolicy.verifyFile(apk, release));
            File safe = AndroidUpdatePolicy.ownedFile(directory.toFile(), "candidate.apk");
            require(safe.equals(apk.getCanonicalFile()));
            refuses(() -> AndroidUpdatePolicy.ownedFile(directory.toFile(), "../escape.apk"));
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            AndroidUpdatePolicy.copy(new ByteArrayInputStream(bytes), out, 0, bytes.length, () -> true, n -> {});
            require(Arrays.equals(out.toByteArray(), bytes));
            try {
                AndroidUpdatePolicy.copy(new ByteArrayInputStream(new byte[21]), out, 0, 20, () -> true, n -> {});
                throw new AssertionError("OVERSIZE_COPY_ACCEPTED");
            } catch (IOException expected) { require(expected.getMessage().equals("SIZE")); }
            try {
                AndroidUpdatePolicy.copy(new ByteArrayInputStream(bytes), out, 0, bytes.length, () -> false, n -> {});
                throw new AssertionError("RETIRED_COPY_ACCEPTED");
            } catch (IOException expected) { require(expected.getMessage().equals("CANCELLED")); }
            require(AndroidUpdatePolicy.resumeOffset(206, "bytes 5-19/20", 5, 20) == 5);
            require(AndroidUpdatePolicy.resumeOffset(200, null, 5, 20) == 0);
            refuses(() -> AndroidUpdatePolicy.resumeOffset(206, "bytes 4-19/20", 5, 20));
            refuses(() -> AndroidUpdatePolicy.resumeOffset(302, null, 0, 20));
        } finally { Files.deleteIfExists(directory.resolve("candidate.apk")); Files.delete(directory); }
        System.out.println("PASS_ANDROID_UPDATE_POLICY " + checks);
    }
}
