package com.kub.messenger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;
import java.lang.reflect.Method;

public class MediaExportSourceTest {
    @Test public void acceptsOnlyFirstPartyStorageHttps() {
        MediaExportSource source = MediaExportSource.parse(
            "https://core.letscube.ru/storage/v1/object/sign/chat-media/u/a.jpg?token=abc",
            "letscube-photo.jpg"
        );
        assertEquals("image/jpeg", source.mimeType());
        assertEquals("letscube-photo.jpg", source.fileName());

        for (String url : new String[] {
            "http://core.letscube.ru/storage/v1/object/public/chat-media/a.jpg",
            "https://core.letscube.ru.evil.test/storage/v1/object/public/chat-media/a.jpg",
            "https://core.letscube.ru@evil.test/storage/v1/object/public/chat-media/a.jpg",
            "https://core.letscube.ru:444/storage/v1/object/public/chat-media/a.jpg",
            "https://core.letscube.ru/admin",
            "https://127.0.0.1/storage/v1/object/public/chat-media/a.jpg"
        }) {
            try {
                MediaExportSource.parse(url, "photo.jpg");
                fail("Accepted " + url);
            } catch (IllegalArgumentException expected) {
                // The native bridge must not fetch an arbitrary URL from a message.
            }
        }
    }

    @Test public void refusesUnsafeNamesAndRecognizesMediaTypes() {
        for (String name : new String[] { "../photo.jpg", "photo/other.jpg", "photo.exe", "a\\b.jpg", "" }) {
            try {
                MediaExportSource.parse("https://core.letscube.ru/storage/v1/object/public/chat-media/a.jpg", name);
                fail("Accepted " + name);
            } catch (IllegalArgumentException expected) {
                // The system picker receives a single media filename only.
            }
        }
        assertEquals("video/mp4", MediaExportSource.parse(
            "https://core.letscube.ru/storage/v1/object/public/chat-media/a.mp4", "clip.mp4"
        ).mimeType());
        assertEquals("image/webp", MediaExportSource.parse(
            "https://core.letscube.ru/storage/v1/object/public/chat-media/a.webp", "photo.webp"
        ).mimeType());
    }

    @Test public void galleryDestinationMatchesMediaKind() throws Exception {
        MediaExportSource photo = MediaExportSource.parse(
            "https://core.letscube.ru/storage/v1/object/public/chat-media/a.webp", "photo.webp"
        );
        MediaExportSource video = MediaExportSource.parse(
            "https://core.letscube.ru/storage/v1/object/public/chat-media/a.mp4", "clip.mp4"
        );
        Method folder = MediaExportSource.class.getDeclaredMethod("galleryFolder");
        Method isImage = MediaExportSource.class.getDeclaredMethod("isImage");
        assertEquals("Pictures/LETSCUBE", folder.invoke(photo));
        assertEquals("Movies/LETSCUBE", folder.invoke(video));
        assertTrue((Boolean) isImage.invoke(photo));
        assertFalse((Boolean) isImage.invoke(video));
    }

    @Test public void anHtmlResponseIsNeverSavedAsAPhoto() throws Exception {
        MediaExportSource photo = MediaExportSource.parse(
            "https://core.letscube.ru/storage/v1/object/public/chat-media/a.jpg", "photo.jpg"
        );
        Method accepts = MediaExportSource.class.getDeclaredMethod("acceptsContentType", String.class);
        assertFalse((Boolean) accepts.invoke(photo, "text/html; charset=utf-8"));
        assertFalse((Boolean) accepts.invoke(photo, "application/json"));
        assertFalse((Boolean) accepts.invoke(photo, "video/mp4"));
        assertTrue((Boolean) accepts.invoke(photo, "image/jpeg"));
        assertTrue((Boolean) accepts.invoke(photo, "application/octet-stream"));
    }
}
