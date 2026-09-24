package com.kub.messenger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import org.junit.Test;

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
}
