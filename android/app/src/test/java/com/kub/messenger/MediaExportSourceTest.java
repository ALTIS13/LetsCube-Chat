package com.kub.messenger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;
import java.lang.reflect.Method;
import java.lang.reflect.InvocationTargetException;
import static org.junit.Assert.assertNull;

public class MediaExportSourceTest {
    private MediaExportSource local(String name, String mime) {
        try {
            return (MediaExportSource) MediaExportSource.class.getDeclaredMethod("local", String.class, String.class).invoke(null, name, mime);
        } catch (NoSuchMethodException error) {
            throw new AssertionError("Local media metadata API is missing", error);
        } catch (InvocationTargetException error) {
            throw (RuntimeException) error.getCause();
        } catch (IllegalAccessException error) {
            throw new AssertionError(error);
        }
    }

    @Test public void localMetadataHasNoUriAndExactMimeExtension() {
        for (String[] row : new String[][] {
            {"photo.JPG", "image/jpeg"}, {"photo.jpeg", "image/jpeg"}, {"photo.png", "image/png"},
            {"photo.webp", "image/webp"}, {"photo.gif", "image/gif"}, {"photo.avif", "image/avif"},
            {"photo.heic", "image/heic"}, {"clip.mp4", "video/mp4"}, {"clip.webm", "video/webm"}, {"clip.mov", "video/quicktime"}
        }) {
            MediaExportSource source = local(row[0], row[1]);
            assertNull(source.uri()); assertEquals(row[0], source.fileName()); assertEquals(row[1], source.mimeType());
        }
    }

    @Test public void localMetadataRefusesUnsafeNamesAndInexactMime() {
        for (String name : new String[] {null, "", "../photo.png", "a/b.png", "a\\b.png", "a\n.png", "photo.exe", ".png", "photo.svg", "photo.wav", "\u0444\u043e\u0442\u043e.png"}) {
            try { local(name, "image/png"); fail("Unsafe local metadata accepted"); } catch (IllegalArgumentException expected) { }
        }
        for (String mime : new String[] {null, "", "image/jpeg", "IMAGE/PNG", "image/png; charset=utf-8", "application/octet-stream"}) {
            try { local("photo.png", mime); fail("Inexact local MIME accepted"); } catch (IllegalArgumentException expected) { }
        }
    }

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
