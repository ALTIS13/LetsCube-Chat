package com.kub.messenger;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebSettings;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        allowSystemDarkTheme();
        markNightModeInUserAgent();
        publishNightMode();
    }

    /**
     * Lets the page see the phone's dark theme.
     *
     * Android's WebView does not pass the system night mode through to
     * `prefers-color-scheme` unless the app asks it to. Measured on two phones
     * running Android 15 with night mode on, the page reported
     * `prefers-color-scheme: dark` as false and LETSCUBE rendered light on a
     * dark phone.
     *
     * The activity theme is already `DayNight`, so with this opt-in the WebView
     * reports dark and the app styles itself. Nothing is auto-darkened: the
     * platform only applies its own darkening to content that has no dark
     * styles of its own, and this app has them.
     */
    private void allowSystemDarkTheme() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebSettings settings = getBridge().getWebView().getSettings();
        WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, true);
    }

    /**
     * Puts the phone's night mode where the page can read it synchronously.
     *
     * Publishing it by script is a race: the page reads the value when it
     * starts, the shell writes it when it has a page, and either can be first.
     * Measured on two phones, the same build came out dark on one and light on
     * the other for that reason alone. The user agent is set before anything
     * loads, so there is no order to get wrong; the script below still fires
     * for a change made while the app is open.
     */
    private void markNightModeInUserAgent() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebSettings settings = getBridge().getWebView().getSettings();
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        String token = mode == Configuration.UI_MODE_NIGHT_YES ? " letscube-night/1" : " letscube-night/0";
        String agent = settings.getUserAgentString().replaceAll(" letscube-night/[01]", "");
        settings.setUserAgentString(agent + token);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Published here as well as at creation: the script evaluated during
        // `onCreate` runs against whatever document exists at that moment, and
        // Capacitor then loads the app over it, taking the value with it. By
        // `onResume` the page is the app's own.
        publishNightMode();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        publishNightMode();
    }

    /**
     * Tells the page whether the phone is in night mode.
     *
     * The WebView's own `prefers-color-scheme` cannot be relied on here:
     * measured on two Android 15 phones with night mode on, a DayNight theme
     * reporting `isLightTheme` false and algorithmic darkening confirmed
     * applied, the page still saw light. The activity knows the truth from its
     * own configuration, so it publishes it and the page prefers that answer.
     */
    private void publishNightMode() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        final boolean night = mode == Configuration.UI_MODE_NIGHT_YES;
        // Written to storage as well as to the window.
        //
        // The window flag and the user agent both depend on arriving before the
        // page reads them, and neither reliably does: the user agent is set
        // after Capacitor has begun loading, and the script can land on a
        // document that is about to be replaced. Storage survives the
        // navigation, so the next document reads the answer synchronously at
        // startup with no ordering to get wrong.
        final String script =
            "try { localStorage.setItem('letscube:night', '" + (night ? "1" : "0") + "'); } catch (e) {}"
                + "window.__letscubeNightMode = " + night + ";"
                + "window.dispatchEvent(new CustomEvent('letscube:night-mode'));";
        // Published now and again shortly after. Capacitor may still be loading
        // the app's own document, and a script evaluated against the document
        // being replaced goes with it.
        // Published repeatedly over the first few seconds rather than once.
        // The user agent is set after Capacitor has already begun loading the
        // page, so the first document does not carry the marker — measured, a
        // fresh launch came up light while a reload came up dark. The page
        // applies whichever answer reaches it, so arriving more than once is
        // harmless and arriving late is what matters.
        final android.webkit.WebView webView = getBridge().getWebView();
        for (int delay : new int[] {0, 250, 600, 1200, 2000, 3200, 5000}) {
            webView.postDelayed(() -> webView.evaluateJavascript(script, null), delay);
        }
    }
}
