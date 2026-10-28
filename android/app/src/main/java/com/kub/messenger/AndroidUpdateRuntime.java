package com.kub.messenger;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.function.Consumer;
import java.util.function.BiConsumer;
import javax.net.ssl.HttpsURLConnection;

/** App-owned state; the WebView can request actions, never supply an APK or a path. */
final class AndroidUpdateRuntime {
    private static AndroidUpdateRuntime instance;
    static synchronized AndroidUpdateRuntime get(Context context) throws Exception {
        if (instance == null) instance = new AndroidUpdateRuntime(context.getApplicationContext());
        return instance;
    }
    private static final String CATALOG = "https://api.letscube.ru/releases/v1/android/stable.json";
    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final File partial, ready;
    private final AtomicFile record;
    private AndroidUpdatePolicy.Release release;
    private String phase = "idle", error;
    private long bytes, generation;
    private boolean busy;
    private AndroidUpdateRequest connection;

    private AndroidUpdateRuntime(Context context) throws Exception {
        this.context = context;
        File directory = new File(context.getFilesDir(), "android-updates");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("FILE");
        File readyDirectory = new File(directory, "ready");
        if (!readyDirectory.isDirectory() && !readyDirectory.mkdirs()) throw new IOException("FILE");
        partial = AndroidUpdatePolicy.ownedFile(directory, "download.part");
        ready = AndroidUpdatePolicy.ownedFile(readyDirectory, "update.apk");
        record = new AtomicFile(AndroidUpdatePolicy.ownedFile(directory, "state.json"));
        try (InputStream input = record.openRead()) {
            JSONObject saved = new JSONObject(new String(readBounded(input, 16384), "UTF-8"));
            release = parse(saved.getJSONObject("release"));
            phase = saved.getString("phase");
            if (!AndroidUpdatePolicy.newer(release, installed())) {
                phase = "current"; partial.delete(); ready.delete(); release = null;
            } else if (ready.isFile()) {
                phase = "verifying"; busy = true;
                worker.execute(() -> {
                    try { verify(ready, release); finish(0, "ready", null); }
                    catch (Exception failure) { finish(0, "failed", code(failure)); }
                });
            } else { phase = partial.isFile() ? "paused" : "available"; bytes = partial.length(); }
        } catch (FileNotFoundException empty) { /* First launch has no update intent. */ }
        catch (Exception invalid) { phase = "failed"; error = "STATE"; release = null; }
    }
    private AndroidUpdatePolicy.Identity identity(PackageInfo info) throws Exception {
        AndroidUpdatePolicy.require(info != null, "PACKAGE");
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
            ? info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners() : info.signatures;
        AndroidUpdatePolicy.require(signatures != null && signatures.length == 1, "SIGNER");
        List<String> hashes = new ArrayList<>();
        for (Signature signature : signatures)
            hashes.add(AndroidUpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        return new AndroidUpdatePolicy.Identity(info.packageName, info.versionName,
            Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode, hashes);
    }
    // Some OEM archive parsers only populate modern signingInfo when legacy collection is also requested.
    private int signatureFlags() { return Build.VERSION.SDK_INT >= 28
        ? PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES : PackageManager.GET_SIGNATURES; }
    private AndroidUpdatePolicy.Identity installed() throws Exception {
        return identity(context.getPackageManager().getPackageInfo(context.getPackageName(), signatureFlags()));
    }
    private void verify(File file, AndroidUpdatePolicy.Release expected) throws Exception {
        AndroidUpdatePolicy.verifyFile(file, expected);
        AndroidUpdatePolicy.verifyPackage(expected, installed(),
            identity(context.getPackageManager().getPackageArchiveInfo(file.getPath(), signatureFlags())));
    }
    private static long number(JSONObject value, String key) throws Exception {
        Object raw = value.get(key);
        AndroidUpdatePolicy.require(raw instanceof Number && ((Number) raw).doubleValue() == ((Number) raw).longValue(), "CATALOG");
        return ((Number) raw).longValue();
    }
    private static AndroidUpdatePolicy.Release parse(JSONObject value) throws Exception {
        AndroidUpdatePolicy.require(number(value, "schemaVersion") == 1 && "android".equals(value.get("platform"))
            && "stable".equals(value.get("channel")) && Boolean.TRUE.equals(value.get("available")), "CATALOG");
        JSONObject artifact = value.getJSONObject("artifact");
        return new AndroidUpdatePolicy.Release(value.getString("version"), number(value, "build"),
            number(artifact, "size"), artifact.getString("sha256"), artifact.getString("url"));
    }
    private AndroidUpdateRequest open(long owner, String url, long timeoutMillis) throws Exception {
        if (!current(owner)) throw new IOException("CANCELLED");
        HttpsURLConnection result = (HttpsURLConnection) new URL(url).openConnection();
        result.setInstanceFollowRedirects(false);
        result.setConnectTimeout(15000); result.setReadTimeout(15000);
        result.setRequestProperty("Accept-Encoding", "identity");
        result.setUseCaches(false);
        AndroidUpdateRequest request = new AndroidUpdateRequest(result, timeoutMillis);
        synchronized (this) {
            if (!current(owner)) { request.close(); throw new IOException("CANCELLED"); }
            connection = request;
        }
        return request;
    }
    private void closeRequest(AndroidUpdateRequest request) {
        try { request.close(); }
        finally { synchronized (this) { if (connection == request) connection = null; } }
    }
    private byte[] readBounded(InputStream input, int maximum) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
        while ((count = input.read(buffer, 0, Math.min(buffer.length, maximum - out.size() + 1))) != -1) {
            if (out.size() + count > maximum) throw new IOException("CATALOG");
            out.write(buffer, 0, count);
        }
        return out.toByteArray();
    }
    private AndroidUpdatePolicy.Release catalog(long owner) throws Exception {
        AndroidUpdateRequest owned = open(owner, CATALOG, 20000);
        HttpsURLConnection request = owned.connection;
        try {
            owned.check();
            AndroidUpdatePolicy.require(request.getResponseCode() == 200, "NETWORK");
            try (InputStream input = request.getInputStream()) {
                AndroidUpdatePolicy.Release fresh = parse(new JSONObject(new String(readBounded(input, 16384), "UTF-8")));
                owned.check();
                return fresh;
            }
        } finally { closeRequest(owned); }
    }
    private synchronized void persist() throws Exception {
        if (release == null) { record.delete(); return; }
        JSONObject value = new JSONObject().put("schemaVersion", 1).put("platform", "android").put("channel", "stable")
            .put("available", true).put("version", release.version).put("build", release.build)
            .put("artifact", new JSONObject().put("url", release.url).put("size", release.size).put("sha256", release.sha256));
        FileOutputStream output = record.startWrite();
        try {
            output.write(new JSONObject().put("release", value).put("phase", phase).toString().getBytes("UTF-8"));
            record.finishWrite(output);
        } catch (Exception failure) { record.failWrite(output); throw failure; }
    }
    synchronized JSObject status() {
        boolean allowed = Build.VERSION.SDK_INT < 26 || context.getPackageManager().canRequestPackageInstalls();
        return new JSObject().put("phase", phase).put("error", error == null ? JSONObject.NULL : error)
            .put("version", release == null ? JSONObject.NULL : release.version)
            .put("bytes", bytes).put("total", release == null ? 0 : release.size).put("canInstall", allowed);
    }
    private synchronized boolean current(long owner) { return generation == owner; }
    private synchronized void finish(long owner, String next, String failure) {
        if (!current(owner)) return;
        phase = next; error = failure; busy = false;
        if ("ready".equals(next)) bytes = release.size;
        try { persist(); } catch (Exception refused) { phase = "failed"; error = "STATE"; }
    }
    void begin(boolean download, Consumer<JSObject> callback) {
        final long owner;
        synchronized (this) {
            if (busy || "ready".equals(phase) || "installing".equals(phase)) { callback.accept(status()); return; }
            owner = ++generation; busy = true; phase = "checking"; error = null;
        }
        worker.execute(() -> {
            try {
                AndroidUpdatePolicy.Release fresh = catalog(owner);
                AndroidUpdatePolicy.Identity own = installed();
                if (!current(owner)) return;
                if (!AndroidUpdatePolicy.newer(fresh, own)) {
                    synchronized (this) {
                        if (!current(owner)) return;
                        partial.delete(); ready.delete(); release = null; bytes = 0;
                        finish(owner, "current", null);
                    }
                    return;
                }
                synchronized (this) {
                    if (!current(owner)) return;
                    if (!download && partial.isFile() && release != null && !fresh.same(release)) {
                        finish(owner, "paused", "STALE_RELEASE"); return;
                    }
                    if (download && !fresh.same(release)) { partial.delete(); ready.delete(); }
                    release = fresh;
                    if (!download) { finish(owner, partial.isFile() ? "paused" : "available", null); return; }
                    phase = "downloading"; bytes = partial.length(); persist();
                }
                download(owner, fresh);
                synchronized (this) { if (!current(owner)) return; phase = "verifying"; }
                verify(partial, fresh);
                synchronized (this) {
                    if (!current(owner)) return;
                    if (!partial.renameTo(ready)) throw new IOException("FILE");
                    finish(owner, "ready", null);
                }
            } catch (Exception failure) {
                String code = code(failure);
                synchronized (this) {
                    if (current(owner) && ("HASH".equals(code) || "SIZE".equals(code) || "PACKAGE".equals(code) || "SIGNER".equals(code))) partial.delete();
                }
                finish(owner, "failed", code);
            } finally { callback.accept(status()); }
        });
    }
    private void download(long owner, AndroidUpdatePolicy.Release expected) throws Exception {
        long offset = partial.length();
        if (offset >= expected.size) {
            if (offset == expected.size) return;
            if (!partial.delete()) throw new IOException("FILE"); offset = 0;
        }
        AndroidUpdateRequest owned = open(owner, expected.url, 15 * 60 * 1000);
        HttpsURLConnection request = owned.connection;
        try {
            owned.check();
            if (offset > 0) request.setRequestProperty("Range", "bytes=" + offset + "-");
            long start = AndroidUpdatePolicy.resumeOffset(request.getResponseCode(), request.getHeaderField("Content-Range"), offset, expected.size);
            String encoding = request.getContentEncoding();
            AndroidUpdatePolicy.require(encoding == null || "identity".equalsIgnoreCase(encoding), "SIZE");
            long length = request.getContentLengthLong();
            AndroidUpdatePolicy.require(length < 0 || length == expected.size - start, "SIZE");
            try (InputStream input = request.getInputStream(); FileOutputStream output = new FileOutputStream(partial, start > 0)) {
                AndroidUpdatePolicy.copy(input, output, start, expected.size,
                    () -> current(owner) && owned.isOpen(),
                    count -> { synchronized (this) { if (current(owner)) bytes = count; } });
                output.getFD().sync();
                owned.check();
            }
        } finally { closeRequest(owned); }
    }
    synchronized JSObject cancel() {
        ++generation; busy = false;
        AndroidUpdateRequest request = connection; connection = null; if (request != null) request.close();
        boolean deleted = (!partial.exists() || partial.delete()) & (!ready.exists() || ready.delete());
        release = null; bytes = 0; phase = deleted ? "idle" : "failed"; error = deleted ? null : "FILE";
        record.delete(); return status();
    }
    void prepareInstall(BiConsumer<File, Long> accepted, Consumer<JSObject> refused) {
        final long owner; final AndroidUpdatePolicy.Release expected;
        synchronized (this) {
            if (busy || !"ready".equals(phase) || release == null) { refused.accept(status()); return; }
            owner = generation; expected = release; phase = "verifying"; busy = true;
        }
        worker.execute(() -> {
            try {
                AndroidUpdatePolicy.Release fresh = catalog(owner);
                if (!expected.same(fresh)) {
                    synchronized (this) {
                        if (!current(owner)) { refused.accept(status()); return; }
                        boolean available = AndroidUpdatePolicy.newer(fresh, installed());
                        boolean deleted = (!partial.exists() || partial.delete()) & (!ready.exists() || ready.delete());
                        if (!deleted) throw new IOException("FILE");
                        release = available ? fresh : null; bytes = 0;
                        finish(owner, available ? "available" : "current", available ? "STALE_RELEASE" : null);
                        refused.accept(status()); return;
                    }
                }
                verify(ready, expected);
                synchronized (this) {
                    if (!current(owner)) { refused.accept(status()); return; }
                    phase = "installing"; busy = false; error = null; persist();
                    accepted.accept(ready, owner);
                }
            } catch (Exception failure) {
                String reason = code(failure);
                boolean invalid = Arrays.asList("HASH", "SIZE", "PACKAGE", "SIGNER", "VERSION", "FILE").contains(reason);
                synchronized (this) { if (invalid && current(owner)) ready.delete(); }
                finish(owner, invalid ? "failed" : "ready", reason); refused.accept(status());
            }
        });
    }
    synchronized boolean handoff(long owner, Runnable launch) {
        if (!current(owner) || !"installing".equals(phase) || release == null || !ready.isFile()) return false;
        launch.run(); return true;
    }
    synchronized void installerReturned(long owner, String failure) {
        if (current(owner) && "installing".equals(phase)) finish(owner, "ready", failure);
    }
    void finishInstaller(long owner, String failure, Consumer<JSObject> completed) {
        // The Activity/Bridge queue can be gone while app-owned preparation completes.
        worker.execute(() -> {
            installerReturned(owner, failure);
            completed.accept(status());
        });
    }
    private static String code(Exception failure) {
        String message = failure.getMessage();
        return message != null && Arrays.asList("SOURCE", "CATALOG", "PACKAGE", "SIGNER", "HASH", "SIZE", "RANGE", "FILE", "VERSION", "STALE_RELEASE").contains(message)
            ? message : "NETWORK";
    }
}
