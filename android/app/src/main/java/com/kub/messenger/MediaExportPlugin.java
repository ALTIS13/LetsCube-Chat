package com.kub.messenger;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "MediaExport")
public class MediaExportPlugin extends Plugin {
    private final ExecutorService transfers = Executors.newSingleThreadExecutor();
    private MediaExportStaging localStaging;

    @PluginMethod public void localCapabilities(PluginCall call) {
        call.resolve(new JSObject().put("version", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? 1 : 0)
            .put("maxBytes", 33_554_432).put("chunkBytes", 262_144));
    }

    @PluginMethod public void beginLocal(PluginCall call) {
        localTransfer(call, () -> {
            requireLocalGallery();
            MediaExportSource source = MediaExportSource.local(call.getString("fileName"), call.getString("mimeType"));
            String id = staging().begin(source, exactNumber(call, "size"), call.getString("sha256"));
            return new JSObject().put("id", id);
        });
    }

    @PluginMethod public void appendLocal(PluginCall call) {
        localTransfer(call, () -> {
            requireLocalGallery();
            long offset = exactNumber(call, "offset");
            byte[] bytes = localChunk(call.getString("data"));
            staging().append(call.getString("id"), offset, bytes);
            return new JSObject().put("written", offset + bytes.length);
        });
    }

    @PluginMethod public void finishLocal(PluginCall call) {
        localTransfer(call, () -> {
            requireLocalGallery();
            try (MediaExportStaging.Completed completed = staging().finish(call.getString("id"));
                 InputStream input = completed.openInput()) {
                MediaExportSource source = completed.source();
                MediaExportGallery.save(getContext().getContentResolver(), source, input);
                return new JSObject().put("saved", true).put("location", source.galleryFolder());
            }
        });
    }

    @PluginMethod public void abortLocal(PluginCall call) {
        localTransfer(call, () -> {
            staging().abort(call.getString("id"));
            return new JSObject();
        });
    }

    private interface LocalTransfer { JSObject run() throws Exception; }

    private void localTransfer(PluginCall call, LocalTransfer action) {
        try {
            transfers.execute(() -> {
                try { call.resolve(action.run()); }
                catch (Exception error) { call.reject("Could not save the local media file", "MEDIA_LOCAL_TRANSFER"); }
            });
        } catch (RejectedExecutionException error) {
            call.reject("Could not save the local media file", "MEDIA_LOCAL_TRANSFER");
        }
    }

    private MediaExportStaging staging() throws IOException {
        if (localStaging == null) localStaging = new MediaExportStaging(getContext().getCacheDir().getCanonicalFile(), System::currentTimeMillis);
        return localStaging;
    }

    private static void requireLocalGallery() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new IllegalArgumentException("Local gallery unavailable");
    }

    private static long exactNumber(PluginCall call, String key) {
        Object value = call.getData().opt(key);
        if (!(value instanceof Number)) throw new IllegalArgumentException("Invalid local size");
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number < 0 || number > 33_554_432 || number != Math.rint(number)) {
            throw new IllegalArgumentException("Invalid local size");
        }
        return (long) number;
    }

    private static byte[] localChunk(String text) {
        if (text == null || text.length() == 0 || text.length() > 349_528 || text.length() % 4 != 0) {
            throw new IllegalArgumentException("Invalid local chunk");
        }
        int padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
        for (int i = 0; i < text.length() - padding; i++) {
            char c = text.charAt(i);
            if (!(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '+' && c != '/') {
                throw new IllegalArgumentException("Invalid local chunk");
            }
        }
        byte[] bytes = Base64.decode(text, Base64.NO_WRAP);
        if (bytes.length < 1 || bytes.length > 262_144) throw new IllegalArgumentException("Invalid local chunk");
        return bytes;
    }

    @PluginMethod public void save(PluginCall call) {
        final MediaExportSource source;
        try {
            source = MediaExportSource.parse(call.getString("url"), call.getString("fileName"));
        } catch (IllegalArgumentException error) {
            call.reject("This media file cannot be saved", "MEDIA_SOURCE");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                transfers.execute(() -> transferToGallery(call, source));
            } catch (RejectedExecutionException error) {
                call.reject("Could not save the media file", "MEDIA_TRANSFER");
            }
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(source.mimeType())
            .putExtra(Intent.EXTRA_TITLE, source.fileName());
        startActivityForResult(call, intent, "documentChosen");
    }

    @ActivityCallback private void documentChosen(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        Uri destination = result.getData().getData();
        if (destination == null || !"content".equals(destination.getScheme())) {
            call.reject("The chosen location is unavailable", "MEDIA_DESTINATION");
            return;
        }
        final MediaExportSource source;
        try {
            source = MediaExportSource.parse(call.getString("url"), call.getString("fileName"));
        } catch (IllegalArgumentException error) {
            call.reject("This media file cannot be saved", "MEDIA_SOURCE");
            return;
        }
        try {
            transfers.execute(() -> transfer(call, source, destination));
        } catch (RejectedExecutionException error) {
            deleteIncompleteDocument(destination);
            call.reject("Could not save the media file", "MEDIA_TRANSFER");
        }
    }

    private void transfer(PluginCall call, MediaExportSource source, Uri destination) {
        boolean saved = false;
        try {
            copySource(source, destination);
            saved = true;
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception error) {
            call.reject("Could not save the media file", "MEDIA_TRANSFER");
        } finally {
            if (!saved) deleteIncompleteDocument(destination);
        }
    }

    private void transferToGallery(PluginCall call, MediaExportSource source) {
        HttpsURLConnection connection = null;
        try {
            connection = openSource(source);
            try (InputStream input = connection.getInputStream()) {
                MediaExportGallery.save(getContext().getContentResolver(), source, input);
            }
            call.resolve(new JSObject().put("saved", true).put("location", source.galleryFolder()));
        } catch (Exception error) {
            call.reject("Could not save the media file", "MEDIA_TRANSFER");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void copySource(MediaExportSource source, Uri destination) throws IOException {
        HttpsURLConnection connection = openSource(source);
        try {
            try (InputStream input = connection.getInputStream();
                 OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("Destination unavailable");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
        } finally {
            connection.disconnect();
        }
    }

    private HttpsURLConnection openSource(MediaExportSource source) throws IOException {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(source.uri().toString()).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK
                || !source.acceptsContentType(connection.getContentType())) {
                throw new IOException("Media unavailable");
            }
            return connection;
        } catch (IOException error) {
            connection.disconnect();
            throw error;
        }
    }

    private void deleteIncompleteDocument(Uri destination) {
        try {
            DocumentsContract.deleteDocument(getContext().getContentResolver(), destination);
        } catch (Exception ignored) {
            // A provider may refuse cleanup; the save still reports failure.
        }
    }

    @Override protected void handleOnDestroy() {
        try {
            transfers.execute(() -> { if (localStaging != null) localStaging.close(); });
        } catch (RejectedExecutionException ignored) {
            // Already shut down; startup cleanup owns any expired temporary file.
        }
        transfers.shutdown();
    }
}
