package com.kub.messenger;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
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

    @PluginMethod public void save(PluginCall call) {
        final MediaExportSource source;
        try {
            source = MediaExportSource.parse(call.getString("url"), call.getString("fileName"));
        } catch (IllegalArgumentException error) {
            call.reject("This media file cannot be saved", "MEDIA_SOURCE");
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
        HttpsURLConnection connection = null;
        boolean saved = false;
        try {
            connection = (HttpsURLConnection) new URL(source.uri().toString()).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IOException("Media unavailable");
            try (InputStream input = connection.getInputStream();
                 OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("Document unavailable");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
            saved = true;
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception error) {
            call.reject("Could not save the media file", "MEDIA_TRANSFER");
        } finally {
            if (connection != null) connection.disconnect();
            if (!saved) deleteIncompleteDocument(destination);
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
        transfers.shutdown();
    }
}
