package com.kub.messenger;

import android.content.Context;
import android.content.pm.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import sun.misc.Unsafe;

/** Actual Runtime.verify with the archive metadata behavior measured on INONE/API33. */
public final class AndroidUpdateArchiveProbe {
    private static void check(boolean ok, String reason) { if (!ok) throw new AssertionError(reason); }
    public static void main(String[] args) throws Exception {
        String scenario = args[0];
        android.os.Build.VERSION.SDK_INT = scenario.equals("legacy") ? 26 : 33;
        byte[] certificate = Base64.getDecoder().decode(Files.readString(Path.of(args[1])).trim());
        check(AndroidUpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(certificate)).equals(
            "ac8249647e3e32b32e7dba283c6c7bc835f293401a3cf82115901ce74f4a0839"), "PUBLIC_CERTIFICATE_NOT_RELEASE_PIN");
        Signature valid = new Signature(certificate);
        byte[] changed = certificate.clone(); changed[changed.length - 1] ^= 1;
        Signature foreign = new Signature(changed);
        int[] archiveFlags = {0};
        PackageManager pm = new PackageManager() {
            private PackageInfo info(int build, Signature[] modern, Signature[] legacy) {
                PackageInfo p = new PackageInfo(); p.packageName = "com.kub.messenger";
                p.versionName = build == 40 ? "0.1.39" : "0.1.42"; p.versionCode = build;
                p.signingInfo = modern == null ? null : new SigningInfo(modern); p.signatures = legacy; return p;
            }
            @Override public PackageInfo getPackageInfo(String name, int flags) {
                return info(40, new Signature[]{valid}, new Signature[]{valid});
            }
            @Override public PackageInfo getPackageArchiveInfo(String path, int flags) {
                archiveFlags[0] = flags;
                // This OEM collects modern archive signingInfo only when GET_SIGNATURES is also requested.
                boolean collected = scenario.equals("normal") || (flags & 0x40) != 0;
                Signature[] modern = !collected || scenario.equals("missing-modern") ? null
                    : scenario.equals("multiple") ? new Signature[]{valid, foreign}
                    : new Signature[]{scenario.equals("foreign") ? foreign : valid};
                return info(43, modern, new Signature[]{valid});
            }
        };
        Context context = new Context() { @Override public PackageManager getPackageManager() { return pm; } };
        Field unsafeField = Unsafe.class.getDeclaredField("theUnsafe"); unsafeField.setAccessible(true);
        AndroidUpdateRuntime runtime = (AndroidUpdateRuntime)((Unsafe)unsafeField.get(null)).allocateInstance(AndroidUpdateRuntime.class);
        Field field = AndroidUpdateRuntime.class.getDeclaredField("context"); field.setAccessible(true); field.set(runtime, context);
        Path directory = Files.createTempDirectory("android-archive-identity-");
        Path apk = directory.resolve("download.part");
        try {
            byte[] bytes = {1, 2, 3}; Files.write(apk, bytes);
            AndroidUpdatePolicy.Release release = new AndroidUpdatePolicy.Release("0.1.42", 43, 3,
                AndroidUpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(bytes)),
                "https://api.letscube.ru/releases/files/android/0.1.42/letscube-0.1.42.apk");
            Method verify = AndroidUpdateRuntime.class.getDeclaredMethod("verify", java.io.File.class, AndroidUpdatePolicy.Release.class);
            verify.setAccessible(true);
            boolean refuse = Arrays.asList("missing-modern", "multiple", "foreign").contains(scenario);
            try {
                verify.invoke(runtime, apk.toFile(), release);
                check(!refuse, "UNTRUSTED_ARCHIVE_ACCEPTED");
            } catch (InvocationTargetException failure) {
                if (!refuse) throw new AssertionError("VALID_OEM_ARCHIVE_REFUSED", failure.getCause());
                check("SIGNER".equals(failure.getCause().getMessage()), "WRONG_REFUSAL_BOUNDARY");
            }
            check(archiveFlags[0] == (scenario.equals("legacy") ? 64 : 134217792), "ARCHIVE_COLLECTION_FLAGS_CHANGED");
            System.out.println("PASS_ARCHIVE_IDENTITY " + scenario);
        } finally { Files.deleteIfExists(apk); Files.delete(directory); }
    }
}
