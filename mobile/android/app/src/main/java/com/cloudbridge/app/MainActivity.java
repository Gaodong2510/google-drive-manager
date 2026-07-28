package com.cloudbridge.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.material.appbar.MaterialToolbar;

/**
 * Modern WebView shell (targetSdk 35) for CloudBridge self-hosted panel.
 * Avoids Chrome WebAPK "built for older Android" warnings.
 */
public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "cloudbridge";
    private static final String KEY_URL = "server_url";

    private WebView webView;
    private SwipeRefreshLayout swipe;
    private ProgressBar progress;
    private View setup;
    private EditText serverUrl;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        webView = findViewById(R.id.webview);
        swipe = findViewById(R.id.swipe);
        progress = findViewById(R.id.progress);
        setup = findViewById(R.id.setup);
        serverUrl = findViewById(R.id.serverUrl);

        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        setSupportActionBar(toolbar);
        toolbar.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.action_reload) {
                webView.reload();
                return true;
            }
            if (id == R.id.action_change_server) {
                showSetup(prefs.getString(KEY_URL, BuildConfig.DEFAULT_SERVER_URL));
                return true;
            }
            return false;
        });

        configureWebView();

        swipe.setOnRefreshListener(() -> webView.reload());
        findViewById(R.id.saveBtn).setOnClickListener(v -> saveAndOpen());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (setup.getVisibility() != View.VISIBLE && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        String saved = prefs.getString(KEY_URL, null);
        String url = (saved != null && !saved.trim().isEmpty())
                ? saved.trim()
                : BuildConfig.DEFAULT_SERVER_URL;
        if (url == null || url.trim().isEmpty()
                || "http://127.0.0.1:8787".equals(url.trim())
                || "http://localhost:8787".equals(url.trim())) {
            showSetup(url);
        } else {
            openUrl(normalizeUrl(url));
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Desktop-ish user agent not needed; keep default mobile for responsive UI
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            try {
                WebSettingsCompat.setForceDark(s, WebSettingsCompat.FORCE_DARK_OFF);
            } catch (Throwable ignored) {
            }
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progress.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                swipe.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    swipe.setRefreshing(false);
                    progress.setVisibility(View.GONE);
                    Toast.makeText(MainActivity.this, R.string.load_error, Toast.LENGTH_LONG).show();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep navigations inside the shell
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) {
                    progress.setVisibility(View.GONE);
                } else {
                    progress.setVisibility(View.VISIBLE);
                }
            }
        });
    }

    private void showSetup(String current) {
        setup.setVisibility(View.VISIBLE);
        swipe.setVisibility(View.GONE);
        String hint = (current == null || current.isEmpty())
                ? BuildConfig.DEFAULT_SERVER_URL
                : current;
        serverUrl.setText(hint);
    }

    private void saveAndOpen() {
        String raw = serverUrl.getText() != null ? serverUrl.getText().toString().trim() : "";
        if (raw.isEmpty()) {
            Toast.makeText(this, R.string.server_url_hint, Toast.LENGTH_SHORT).show();
            return;
        }
        String url = normalizeUrl(raw);
        prefs.edit().putString(KEY_URL, url).apply();
        openUrl(url);
    }

    private void openUrl(String url) {
        setup.setVisibility(View.GONE);
        swipe.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
    }

    private static String normalizeUrl(String raw) {
        String u = raw.trim();
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            u = "http://" + u;
        }
        // strip trailing slash for cleaner prefs; WebView handles paths fine
        while (u.endsWith("/") && u.length() > 8) {
            u = u.substring(0, u.length() - 1);
        }
        return u;
    }

}
