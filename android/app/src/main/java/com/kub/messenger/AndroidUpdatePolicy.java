package com.kub.messenger;

import java.io.*;
import java.security.MessageDigest;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.LongConsumer;

/** Pure native guards shared by the downloader and the final installer handoff. */
final class AndroidUpdatePolicy {
    static final String PACKAGE = "com.kub.messenger";
    static final String SIGNER = "ac8249647e3e32b32e7dba283c6c7bc835f293401a3cf82115901ce74f4a0839";
    static final long MAX_BYTES = 100L * 1024 * 1024;
    static final class Release {
        final String version, sha256, url;
        final long build, size;
        Release(String version, long build, long size, String sha256, String url) {
            require(version != null && version.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)"), "CATALOG");
            require(build > 0 && build <= Integer.MAX_VALUE && size > 0 && size <= MAX_BYTES, "CATALOG");
            require(sha256 != null && sha256.matches("[a-f0-9]{64}"), "CATALOG");
            require(("https://api.letscube.ru/releases/files/android/" + version + "/letscube-" + version + ".apk").equals(url), "SOURCE");
            this.version = version; this.build = build; this.size = size; this.sha256 = sha256; this.url = url;
        }
        boolean same(Release other) {
            return other != null && build == other.build && size == other.size && version.equals(other.version)
                && sha256.equals(other.sha256) && url.equals(other.url);
        }
    }
    static final class Identity {
        final String packageName, version;
        final long build;
        final List<String> signers;
        Identity(String packageName, String version, long build, List<String> signers) {
            this.packageName = packageName; this.version = version; this.build = build; this.signers = signers;
        }
    }
    static void require(boolean value, String code) { if (!value) throw new IllegalArgumentException(code); }
    static void verifyInstalled(Identity installed) {
        require(PACKAGE.equals(installed.packageName) && installed.signers.equals(java.util.Collections.singletonList(SIGNER)), "SIGNER");
    }
    static boolean newer(Release release, Identity installed) {
        verifyInstalled(installed);
        if (release.build <= installed.build) return false;
        String[] a = release.version.split("\\."), b = installed.version.split("\\.");
        require(b.length == 3, "VERSION");
        for (int i = 0; i < 3; i++) {
            int comparison = new java.math.BigInteger(a[i]).compareTo(new java.math.BigInteger(b[i]));
            if (comparison != 0) return comparison > 0;
        }
        return true;
    }
    static void verifyPackage(Release release, Identity installed, Identity archive) {
        require(newer(release, installed), "VERSION");
        require(PACKAGE.equals(archive.packageName) && release.version.equals(archive.version)
            && release.build == archive.build, "PACKAGE");
        require(archive.signers.equals(installed.signers), "SIGNER");
    }
    static File ownedFile(File directory, String name) {
        try {
            File root = directory.getCanonicalFile(), file = new File(directory, name).getCanonicalFile();
            require(file.getParentFile().equals(root) && file.getName().equals(name), "PATH");
            return file;
        } catch (IOException error) { throw new IllegalArgumentException("PATH"); }
    }
    static void verifyFile(File file, Release release) {
        require(file.isFile() && file.length() == release.size, "SIZE");
        try (InputStream input = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[32768]; int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
            require(hex(digest.digest()).equals(release.sha256), "HASH");
        } catch (Exception error) {
            if (error instanceof IllegalArgumentException) throw (IllegalArgumentException) error;
            throw new IllegalArgumentException("FILE");
        }
    }
    static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte value : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return out.toString();
    }
    static long resumeOffset(int status, String range, long offset, long total) {
        if (status == 200) return 0;
        require(status == 206 && offset > 0 && ("bytes " + offset + "-" + (total - 1) + "/" + total).equals(range), "RANGE");
        return offset;
    }
    static void copy(InputStream input, OutputStream output, long offset, long total,
                     BooleanSupplier current, LongConsumer progress) throws IOException {
        byte[] buffer = new byte[32768]; long copied = offset; int count;
        while (true) {
            if (!current.getAsBoolean()) throw new IOException("CANCELLED");
            count = input.read(buffer, 0, (int) Math.min(buffer.length, total - copied + 1));
            if (count == -1) break;
            if (copied + count > total) throw new IOException("SIZE");
            output.write(buffer, 0, count); copied += count; progress.accept(copied);
        }
        if (copied != total) throw new IOException("INCOMPLETE");
    }
}
