package qa.letscube.boot;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicInteger;

public final class BootActivity extends Activity {
    static final String URL = "https://boot.qa.invalid/chat/fixture/m/message?returnTo=%2Fchat%2Ffixture#retained";
    static final String COMMIT = "var r=document.getElementById('root');r.innerHTML='<main>QA committed surface</main>';"
        + "r.dataset.kubAppReady='true';window.dispatchEvent(new Event('letscube:app-rendered'));";
    private static boolean profileSet;
    WebView web;
    volatile String mode;
    final AtomicInteger navigations = new AtomicInteger();
    final AtomicInteger documents = new AtomicInteger();
    final AtomicInteger unexpectedRequests = new AtomicInteger();
    final AtomicInteger pageFinished = new AtomicInteger();
    int pauses;
    int resumes;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!profileSet) { WebView.setDataDirectorySuffix("d298-qa"); profileSet = true; }
        mode = getIntent().getStringExtra("mode");
        String asset = getIntent().getStringExtra("asset");
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                navigations.incrementAndGet();
            }
            @Override public void onPageFinished(WebView view, String url) { pageFinished.incrementAndGet(); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                boolean denied = !"https".equals(request.getUrl().getScheme())
                    || !"boot.qa.invalid".equals(request.getUrl().getHost());
                if (denied) unexpectedRequests.incrementAndGet();
                return denied;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!"https".equals(request.getUrl().getScheme()) || !"boot.qa.invalid".equals(request.getUrl().getHost())) {
                    unexpectedRequests.incrementAndGet();
                    return response("text/plain", "blocked", 403);
                }
                String path = request.getUrl().getPath();
                try {
                    if ("/chat/fixture/m/message".equals(path)) {
                        documents.incrementAndGet();
                        return new WebResourceResponse("text/html", "UTF-8", getAssets().open(asset + ".html"));
                    }
                    if ("/icons/icon-192.png".equals(path)) {
                        return new WebResourceResponse("image/png", null, getAssets().open("icon.png"));
                    }
                    if ("/favicon.ico".equals(path)) return response("image/x-icon", "", 404);
                    if ("/entry.js".equals(path)) {
                        if ("failed".equals(mode)) return response("text/javascript", "", 503);
                        String prefix = "window.__qa.entryStarted=true;";
                        if ("rejection".equals(mode)) return response("text/javascript", prefix
                            + "setTimeout(function(){Promise.reject(new Error('qa-rejection'));},200);", 200);
                        if ("stalled".equals(mode)) return response("text/javascript", prefix + "await new Promise(function(){});", 200);
                        if ("late".equals(mode)) return response("text/javascript", prefix
                            + "await new Promise(function(resolve){setTimeout(resolve,14500);});" + COMMIT, 200);
                        return response("text/javascript", prefix + COMMIT, 200);
                    }
                } catch (Exception ignored) {
                    unexpectedRequests.incrementAndGet();
                    return response("text/plain", "fixture asset unavailable", 500);
                }
                unexpectedRequests.incrementAndGet();
                return response("text/plain", "not allowed", 403);
            }
        });
        setContentView(web);
        web.loadUrl(URL);
    }

    private static WebResourceResponse response(String mime, String text, int status) {
        return new WebResourceResponse(mime, "UTF-8", status, status == 200 ? "OK" : "QA fault",
            Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }

    @Override public void onPause() { pauses++; if (web != null) web.onPause(); super.onPause(); }
    @Override public void onResume() { super.onResume(); resumes++; if (web != null) web.onResume(); }
    @Override public void onDestroy() {
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
}
