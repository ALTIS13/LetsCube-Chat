package com.kub.messenger;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.fail;

import android.content.ContentResolver;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MediaExportGalleryTest {
    @Test public void savesPhotoIntoLetcubeAlbumWithoutDocumentPicker() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        ContentResolver resolver = InstrumentationRegistry.getInstrumentation()
            .getTargetContext().getContentResolver();
        Bitmap bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
        bitmap.recycle();
        MediaExportSource source = MediaExportSource.parse(
            "https://core.letscube.ru/storage/v1/object/public/media/qa/photo.png",
            "letscube-export-qa.png"
        );

        Uri saved = MediaExportGallery.save(resolver, source, new ByteArrayInputStream(bytes.toByteArray()));
        assertNotNull(saved);
        try {
            try (Cursor row = resolver.query(saved, new String[] {
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.RELATIVE_PATH,
                MediaStore.MediaColumns.IS_PENDING
            }, null, null, null)) {
                assertNotNull(row);
                assertEquals(true, row.moveToFirst());
                assertEquals("letscube-export-qa.png", row.getString(0));
                assertEquals("Pictures/LETSCUBE/", row.getString(1));
                assertEquals(0, row.getInt(2));
            }
            try (InputStream input = resolver.openInputStream(saved)) {
                assertNotNull(input);
                ByteArrayOutputStream copied = new ByteArrayOutputStream();
                byte[] buffer = new byte[1024];
                int count;
                while ((count = input.read(buffer)) != -1) copied.write(buffer, 0, count);
                assertArrayEquals(bytes.toByteArray(), copied.toByteArray());
            }
        } finally {
            resolver.delete(saved, null, null);
        }
    }

    @Test public void removesPendingPhotoWhenTheDownloadFails() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        ContentResolver resolver = InstrumentationRegistry.getInstrumentation()
            .getTargetContext().getContentResolver();
        String fileName = "letscube-failed-export-" + System.nanoTime() + ".png";
        MediaExportSource source = MediaExportSource.parse(
            "https://core.letscube.ru/storage/v1/object/public/media/qa/photo.png", fileName
        );
        InputStream failing = new InputStream() {
            @Override public int read() throws IOException { throw new IOException("Download interrupted"); }
            @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                throw new IOException("Download interrupted");
            }
        };

        try {
            MediaExportGallery.save(resolver, source, failing);
            fail("An interrupted download was published");
        } catch (IOException expected) {
            assertEquals("Download interrupted", expected.getMessage());
        }
        try (Cursor rows = resolver.query(
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
            new String[] { MediaStore.MediaColumns._ID },
            MediaStore.MediaColumns.DISPLAY_NAME + " = ?",
            new String[] { fileName }, null
        )) {
            assertNotNull(rows);
            assertEquals(0, rows.getCount());
        }
    }
}
