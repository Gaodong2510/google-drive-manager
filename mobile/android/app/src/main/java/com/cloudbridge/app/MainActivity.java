package com.cloudbridge.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.floatingactionbutton.FloatingActionButton;
import com.google.android.material.textfield.TextInputEditText;

/**
 * Fullscreen WebView shell — no title bar.
 * Each user enters their own self-hosted panel URL (not bound to a fixed server).
 */
public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "cloudbridge";
    private static final String KEY_URL = "server_url";

    private WebView webView;
    private SwipeRefreshLayout swipe;
    private ProgressBar progress;
    private View setup;
    private TextInputEditText serverUrl;
    private FloatingActionButton fabMenu;
    private MaterialButton cancelSetupBtn;
    private SharedPreferences prefs;
    private boolean hasServer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (c != null) {
            c.setAppearanceLightStatusBars(false);
            c.setAppearanceLightNavigationBars(false);
        }

        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        webView = findViewById(R.id.webview);
        swipe = findViewById(R.id.swipe);
        progress = findViewById(R.id.progress);
        setup = findViewById(R.id.setup);
        serverUrl = findViewById(R.id.serverUrl);
        fabMenu = findViewById(R.id.fabMenu);
        cancelSetupBtn = findViewById(R.id.cancelSetupBtn);

        // Keep setup content away from notches / nav bars
        ViewCompat.setOnApplyWindowInsetsListener(setup, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(v.getPaddingLeft(), bars.top + dp(24), v.getPaddingRight(), bars.bottom + dp(16));
            return insets;
        });
        ViewCompat.setOnApplyWindowInsetsListener(fabMenu, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            FrameLayoutParamsMargin(v, bars.bottom + dp(18), bars.right + dp(12));
            return insets;
        });

        configureWebView();

        swipe.setColorSchemeColors(0xFF0EA5E9, 0xFF6366F1);
        swipe.setProgressBackgroundColorSchemeColor(0xFF1E293B);
        swipe.setOnRefreshListener(() -> webView.reload());

        findViewById(R.id.saveBtn).setOnClickListener(v -> saveAndOpen());
        cancelSetupBtn.setOnClickListener(v -> {
            if (hasServer) {
                showBrowser();
            }
        });
        fabMenu.setOnClickListener(v -> showMenu());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (setup.getVisibility() == View.VISIBLE) {
                    if (hasServer) {
                        showBrowser();
                    } else {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                    }
                    return;
                }
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        String saved = prefs.getString(KEY_URL, null);
        if (saved != null && !saved.trim().isEmpty()) {
            hasServer = true;
            openUrl(normalizeUrl(saved.trim()));
        } else {
            hasServer = false;
            showSetup(null, false);
        }
    }

    private void FrameLayoutParamsMargin(View v, int bottom, int end) {
        if (!(v.getLayoutParams() instanceof android.widget.FrameLayout.LayoutParams)) return;
        android.widget.FrameLayout.LayoutParams lp = (android.widget.FrameLayout.LayoutParams) v.getLayoutParams();
        lp.bottomMargin = bottom;
        lp.setMarginEnd(end);
        v.setLayoutParams(lp);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
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
        s.setAllowFileAccess(false);
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
                if (request != null && request.isForMainFrame()) {
                    swipe.setRefreshing(false);
                    progress.setVisibility(View.GONE);
                    Toast.makeText(MainActivity.this, R.string.load_error, Toast.LENGTH_LONG).show();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
    }

    private void showMenu() {
        String[] items = new String[]{
                getString(R.string.menu_reload),
                getString(R.string.menu_change_server),
                getString(R.string.menu_clear_cache)
        };
        new AlertDialog.Builder(this, com.google.android.material.R.style.ThemeOverlay_Material3_MaterialAlertDialog)
                .setItems(items, (d, which) -> {
                    if (which == 0) {
                        webView.reload();
                    } else if (which == 1) {
                        showSetup(prefs.getString(KEY_URL, ""), true);
                    } else if (which == 2) {
                        webView.clearCache(true);
                        webView.reload();
                        Toast.makeText(this, R.string.menu_clear_cache, Toast.LENGTH_SHORT).show();
                    }
                })
                .show();
    }

    private void showSetup(String current, boolean canCancel) {
        setup.setVisibility(View.VISIBLE);
        swipe.setVisibility(View.GONE);
        fabMenu.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        cancelSetupBtn.setVisibility(canCancel && hasServer ? View.VISIBLE : View.GONE);
        // Never force someone else's server: empty unless user already saved one
        if (current != null && !current.isEmpty()) {
            serverUrl.setText(current);
            serverUrl.setSelection(current.length());
        } else {
            serverUrl.setText("");
        }
        serverUrl.requestFocus();
    }

    private void showBrowser() {
        setup.setVisibility(View.GONE);
        swipe.setVisibility(View.VISIBLE);
        fabMenu.setVisibility(View.VISIBLE);
    }

    private void saveAndOpen() {
        String raw = serverUrl.getText() != null ? serverUrl.getText().toString().trim() : "";
        if (raw.isEmpty()) {
            Toast.makeText(this, R.string.url_required, Toast.LENGTH_SHORT).show();
            return;
        }
        String url = normalizeUrl(raw);
        prefs.edit().putString(KEY_URL, url).apply();
        hasServer = true;
        Toast.makeText(this, R.string.url_saved, Toast.LENGTH_SHORT).show();
        openUrl(url);
    }

    private void openUrl(String url) {
        showBrowser();
        progress.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
    }

    private static String normalizeUrl(String raw) {
        String u = raw.trim();
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            u = "http://" + u;
        }
        while (u.endsWith("/") && u.length() > 8) {
            u = u.substring(0, u.length() - 1);
        }
        return u;
    }
}
