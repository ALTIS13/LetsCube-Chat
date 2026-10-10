import { foregroundCompositionStubs, foregroundCompositionSourceNames, compositionPlatform }
  from './message-preview-genuine-composition.fixture.mjs';

// Reuse the accepted fictional framework ports, not a replacement native graph.
// These origin methods exist in the installed public Capacitor 8.3.4 sources.
export const userChoiceStubs = {
  ...foregroundCompositionStubs,
  'com/getcapacitor/CapConfig.java': `package com.getcapacitor; public class CapConfig {
    public boolean enabled; public String serverUrl;
    public boolean isLoggingEnabled() { return enabled; }
    public String getServerUrl() { return serverUrl; }
  }`,
  'com/getcapacitor/Bridge.java': foregroundCompositionStubs['com/getcapacitor/Bridge.java']
    .replace('public String getServerUrl() { return null; }','')
    .replace('public String getLocalUrl() { return null; }','')
    .replace('public android.webkit.WebView getWebView() { return null; }', `
  public final android.webkit.WebView webView=new android.webkit.WebView();
  public String localUrl="https://localhost";
  public String getServerUrl() { return config.getServerUrl(); }
  public String getLocalUrl() { return localUrl; }
  public android.webkit.WebView getWebView() { return webView; }`),
  'android/webkit/WebView.java': foregroundCompositionStubs['android/webkit/WebView.java']
    .replace('public String getUrl() { return null; }', 'public String url="https://localhost/login"; public String getUrl() { return url; }'),
};
export const userChoiceSourceNames = foregroundCompositionSourceNames;
export const userChoicePlatform = compositionPlatform;
