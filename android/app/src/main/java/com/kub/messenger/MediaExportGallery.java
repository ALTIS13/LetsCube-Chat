package com.kub.messenger;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.provider.MediaStore;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

final class MediaExportGallery {
    private MediaExportGallery() {}

    static Uri save(ContentResolver resolver, MediaExportSource source, InputStream input) throws IOException {
        ContentValues pending = new ContentValues();
        pending.put(MediaStore.MediaColumns.DISPLAY_NAME, source.fileName());
        pending.put(MediaStore.MediaColumns.MIME_TYPE, source.mimeType());
        pending.put(MediaStore.MediaColumns.RELATIVE_PATH, source.galleryFolder() + "/");
        pending.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri collection = source.isImage()
            ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            : MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri destination = resolver.insert(collection, pending);
        if (destination == null) throw new IOException("Gallery unavailable");

        boolean saved = false;
        try {
            try (OutputStream output = resolver.openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("Gallery item unavailable");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(destination, ready, null, null) != 1) {
                throw new IOException("Gallery item unavailable");
            }
            saved = true;
            return destination;
        } finally {
            if (!saved) {
                try {
                    resolver.delete(destination, null, null);
                } catch (Exception ignored) {
                    // A media provider may refuse cleanup after a failed write.
                }
            }
        }
    }
}
