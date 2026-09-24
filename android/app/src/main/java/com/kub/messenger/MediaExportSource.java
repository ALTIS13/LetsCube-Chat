package com.kub.messenger;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

final class MediaExportSource {
    private static final String HOST = "core.letscube.ru";
    private static final String STORAGE_PATH = "/storage/v1/object/";

    private final URI uri;
    private final String fileName;
    private final String mimeType;

    private MediaExportSource(URI uri, String fileName, String mimeType) {
        this.uri = uri;
        this.fileName = fileName;
        this.mimeType = mimeType;
    }

    static MediaExportSource parse(String url, String name) {
        if (url == null || name == null || !name.matches("[A-Za-z0-9 ._()-]{1,120}")) {
            throw new IllegalArgumentException("Invalid media export input");
        }
        int dot = name.lastIndexOf('.');
        String mime = dot < 1 ? null : mimeTypeFor(name.substring(dot + 1).toLowerCase(Locale.ROOT));
        if (mime == null) throw new IllegalArgumentException("Unsupported media filename");

        try {
            URI uri = new URI(url);
            if (!"https".equalsIgnoreCase(uri.getScheme())
                || !HOST.equalsIgnoreCase(uri.getHost())
                || uri.getUserInfo() != null
                || uri.getPort() != -1
                || uri.getFragment() != null
                || uri.getRawPath() == null
                || !uri.getRawPath().startsWith(STORAGE_PATH)
                || !uri.getRawPath().equals(uri.normalize().getRawPath())) {
                throw new IllegalArgumentException("Media URL is not first-party storage");
            }
            return new MediaExportSource(uri, name, mime);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Invalid media URL", error);
        }
    }

    URI uri() { return uri; }
    String fileName() { return fileName; }
    String mimeType() { return mimeType; }

    private static String mimeTypeFor(String extension) {
        switch (extension) {
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "avif": return "image/avif";
            case "heic": return "image/heic";
            case "mp4": return "video/mp4";
            case "webm": return "video/webm";
            case "mov": return "video/quicktime";
            default: return null;
        }
    }
}
