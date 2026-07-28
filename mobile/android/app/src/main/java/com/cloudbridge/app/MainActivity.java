package com.cloudbridge.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
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
 * Generic WebView shell — no operator domain baked in.
 * Each self-hosted user enters their own panel URL on first launch.
 */
public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "cloudbridge";
    private static final String KEY_URL = "server_url";

    private WebView webView;
    private SwipeRefreshLayout swipe;
    private ProgressBar progress;
    private View setup;
    private View loading;
    private TextView loadingText;
    private TextInputEditText serverUrl;
    private FloatingActionButton fabMenu;
    private MaterialButton cancelSetupBtn;
    private SharedPreferences prefs;
    private boolean hasServer;
    private String lastUrl = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Switch from splash theme to main (keeps dark bg, no white flash)
        setTheme(R.style.Theme_CloudBridge);
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
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
        loading = findViewById(R.id.loading);
        loadingText = findViewById(R.id.loadingText);
        serverUrl = findViewById(R.id.serverUrl);
        fabMenu = findViewById(R.id.fabMenu);
        cancelSetupBtn = findViewById(R.id.cancelSetupBtn);

        // Dark WebView — prevent white flash while page paints
        webView.setBackgroundColor(0xFF0B1220);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        ViewCompat.setOnApplyWindowInsetsListener(setup, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(
                    v.getPaddingLeft(),
                    bars.top + dp(24),
                    v.getPaddingRight(),
                    bars.bottom + dp(16));
            return insets;
        });
        // Keep FAB near bottom (above nav bar / gesture area), never near status clock
        ViewCompat.setOnApplyWindowInsetsListener(fabMenu, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            applyFabMargin(v, Math.max(bars.bottom, dp(12)) + dp(20), Math.max(bars.right, dp(8)) + dp(16));
            return insets;
        });

        configureWebView();

        swipe.setColorSchemeColors(0xFF0EA5E9, 0xFF6366F1);
        swipe.setProgressBackgroundColorSchemeColor(0xFF1E293B);
        swipe.setOnRefreshListener(() -> {
            if (lastUrl != null && !lastUrl.isEmpty() && !lastUrl.startsWith("data:")) {
                openUrl(lastUrl);
            } else {
                webView.reload();
            }
        });

        findViewById(R.id.saveBtn).setOnClickListener(v -> saveAndOpen());
        cancelSetupBtn.setOnClickListener(v -> {
            if (hasServer) showBrowser();
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

        bootstrapServerUrl();
    }

    private void bootstrapServerUrl() {
        String saved = prefs.getString(KEY_URL, null);
        if (saved == null || saved.trim().isEmpty()) {
            hasServer = false;
            showSetup(null, false);
            return;
        }
        String url = normalizeUrl(saved.trim());
        if (isLegacyIpHttpUrl(url)) {
            // Clear only — do NOT inject any operator domain
            prefs.edit().remove(KEY_URL).apply();
            hasServer = false;
            Toast.makeText(this, R.string.legacy_ip_cleared, Toast.LENGTH_LONG).show();
            showSetup(null, false);
            return;
        }
        hasServer = true;
        openUrl(url);
    }

    static boolean isLegacyIpHttpUrl(String url) {
        try {
            Uri u = Uri.parse(url);
            if (u == null) return false;
            String scheme = u.getScheme();
            if (scheme == null || !scheme.equalsIgnoreCase("http")) return false;
            String host = u.getHost();
            if (host == null || !host.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")) return false;
            int port = u.getPort();
            return port == -1 || port == 80 || port == 8787;
        } catch (Exception e) {
            return false;
        }
    }

    private void applyFabMargin(View v, int bottom, int end) {
        if (!(v.getLayoutParams() instanceof android.widget.FrameLayout.LayoutParams)) return;
        android.widget.FrameLayout.LayoutParams lp =
                (android.widget.FrameLayout.LayoutParams) v.getLayoutParams();
        lp.bottomMargin = bottom;
        lp.setMarginEnd(end);
        v.setLayoutParams(lp);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void showLoading(boolean show) {
        if (loading == null) return;
        loading.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    /** Push real status-bar height into CSS so the web menu sits below the clock. */
    private void injectStatusBarCss(WebView view) {
        int px = 0;
        try {
            Insets bars =
                    ViewCompat.getRootWindowInsets(findViewById(R.id.root)) != null
                            ? ViewCompat.getRootWindowInsets(findViewById(R.id.root))
                                    .getInsets(WindowInsetsCompat.Type.statusBars())
                            : null;
            if (bars != null) px = bars.top;
        } catch (Exception ignored) {
        }
        if (px <= 0) {
            // Fallback ~24–28dp on most phones
            px = dp(28);
        }
        float density = getResources().getDisplayMetrics().density;
        int cssPx = Math.round(px / density); // convert to CSS px roughly via density
        // Actually WebView uses CSS pixels ≈ density-independent; pass physical/density
        String js =
                "(function(){var d=document.documentElement;"
                        + "d.style.setProperty('--gdm-sat','"
                        + (px / density)
                        + "px');"
                        + "})();";
        view.evaluateJavascript(js, null);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(webView, true);
        }

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
        // Prefer cache to speed up repeat opens
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false); // slightly faster first paint for self-hosted panels
        }
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
                progress.setIndeterminate(false);
                progress.setProgress(8);
                showLoading(true);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setProgress(100);
                progress.setVisibility(View.GONE);
                swipe.setRefreshing(false);
                showLoading(false);
                injectStatusBarCss(view);
                if (url != null && !url.startsWith("data:") && !url.startsWith("about:")) {
                    lastUrl = url;
                }
            }

            @Override
            public void onReceivedError(
                    WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    swipe.setRefreshing(false);
                    progress.setVisibility(View.GONE);
                    showLoading(false);
                    String desc = "";
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && error != null) {
                        desc = String.valueOf(error.getDescription());
                    }
                    String failUrl =
                            request.getUrl() != null ? request.getUrl().toString() : lastUrl;
                    showErrorPage(failUrl, desc);
                }
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(
                    WebView view, int errorCode, String description, String failingUrl) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                    swipe.setRefreshing(false);
                    progress.setVisibility(View.GONE);
                    showLoading(false);
                    showErrorPage(failingUrl, description);
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                swipe.setRefreshing(false);
                progress.setVisibility(View.GONE);
                showLoading(false);
                showErrorPage(lastUrl, getString(R.string.ssl_error));
                handler.cancel();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) {
                    progress.setVisibility(View.GONE);
                    // hide overlay a bit early once content is mostly ready
                    if (newProgress >= 90) showLoading(false);
                } else {
                    progress.setVisibility(View.VISIBLE);
                    progress.setIndeterminate(false);
                    progress.setProgress(Math.max(8, newProgress));
                    if (newProgress < 85) showLoading(true);
                    else showLoading(false);
                }
            }
        });

        webView.addJavascriptInterface(
                new Object() {
                    @android.webkit.JavascriptInterface
                    public void changeServer() {
                        runOnUiThread(() -> showSetup(prefs.getString(KEY_URL, ""), true));
                    }

                    @android.webkit.JavascriptInterface
                    public void retry() {
                        runOnUiThread(() -> {
                            String u = prefs.getString(KEY_URL, "");
                            if (u != null && !u.isEmpty()) openUrl(u);
                            else showSetup(null, false);
                        });
                    }
                },
                "CB");
    }

    private void showErrorPage(String url, String detail) {
        String safeUrl = url == null ? "" : url.replace("&", "&amp;").replace("'", "&#39;");
        String safeDetail =
                detail == null ? "" : detail.replace("&", "&amp;").replace("<", "&lt;");
        String html =
                "<!DOCTYPE html><html><head><meta charset='utf-8'/>"
                        + "<meta name='viewport' content='width=device-width,initial-scale=1'/>"
                        + "<style>"
                        + "body{margin:0;font-family:sans-serif;background:#0b1220;color:#e2e8f0;"
                        + "display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;}"
                        + ".card{max-width:420px;background:#111827;border:1px solid #1e293b;border-radius:20px;padding:28px;}"
                        + "h1{font-size:20px;margin:0 0 8px;}p{color:#94a3b8;font-size:14px;line-height:1.55;}"
                        + "code{display:block;background:#0f172a;padding:10px;border-radius:10px;font-size:12px;"
                        + "word-break:break-all;margin:12px 0;color:#7dd3fc;}"
                        + ".hint{font-size:12px;color:#64748b;margin-top:8px;}"
                        + "button{width:100%;margin-top:10px;padding:14px;border:0;border-radius:12px;"
                        + "background:#0ea5e9;color:#fff;font-size:15px;font-weight:600;}"
                        + "button.secondary{background:#1e293b;color:#cbd5e1;}"
                        + "</style></head><body><div class='card'>"
                        + "<h1>无法打开面板</h1>"
                        + "<p>请检查你填写的服务器地址是否正确，以及手机网络是否能访问该服务器。"
                        + " 自托管用户请填写自己的 HTTPS 域名。</p>"
                        + "<code>"
                        + safeUrl
                        + "</code>"
                        + (safeDetail.isEmpty()
                                ? ""
                                : "<p class='hint'>详情：" + safeDetail + "</p>")
                        + "<button onclick=\"CB.retry()\">重试</button>"
                        + "<button class='secondary' onclick=\"CB.changeServer()\">更换服务器</button>"
                        + "</div></body></html>";
        showBrowser();
        showLoading(false);
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void showMenu() {
        final String current = prefs.getString(KEY_URL, "");
        String[] items =
                new String[] {
                    getString(R.string.menu_reload),
                    getString(R.string.menu_change_server),
                    getString(R.string.menu_clear_cache),
                    getString(R.string.menu_show_server)
                };
        new AlertDialog.Builder(
                        this,
                        com.google.android.material.R.style
                                .ThemeOverlay_Material3_MaterialAlertDialog)
                .setItems(
                        items,
                        (d, which) -> {
                            if (which == 0) {
                                if (current != null && !current.isEmpty()) openUrl(current);
                                else webView.reload();
                            } else if (which == 1) {
                                showSetup(current, true);
                            } else if (which == 2) {
                                webView.clearCache(true);
                                CookieManager.getInstance().removeAllCookies(null);
                                Toast.makeText(this, R.string.menu_clear_cache, Toast.LENGTH_SHORT)
                                        .show();
                                if (current != null && !current.isEmpty()) openUrl(current);
                            } else if (which == 3) {
                                String msg =
                                        (current == null || current.isEmpty())
                                                ? getString(R.string.no_server_yet)
                                                : current;
                                new AlertDialog.Builder(this)
                                        .setTitle(R.string.menu_show_server)
                                        .setMessage(msg)
                                        .setPositiveButton(android.R.string.ok, null)
                                        .show();
                            }
                        })
                .show();
    }

    private void showSetup(String current, boolean canCancel) {
        setup.setVisibility(View.VISIBLE);
        swipe.setVisibility(View.GONE);
        fabMenu.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        showLoading(false);
        cancelSetupBtn.setVisibility(canCancel && hasServer ? View.VISIBLE : View.GONE);
        // Always empty for new users; only show existing if editing
        if (current != null && !current.isEmpty() && !isLegacyIpHttpUrl(current)) {
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
        if (isLegacyIpHttpUrl(url)) {
            new AlertDialog.Builder(this)
                    .setTitle(R.string.reject_ip_http_title)
                    .setMessage(R.string.reject_ip_http)
                    .setPositiveButton(
                            R.string.use_anyway,
                            (d, w) -> {
                                prefs.edit().putString(KEY_URL, url).apply();
                                hasServer = true;
                                openUrl(url);
                            })
                    .setNegativeButton(android.R.string.cancel, null)
                    .show();
            return;
        }
        prefs.edit().putString(KEY_URL, url).apply();
        hasServer = true;
        Toast.makeText(this, R.string.url_saved, Toast.LENGTH_SHORT).show();
        openUrl(url);
    }

    private void openUrl(String url) {
        lastUrl = url;
        showBrowser();
        progress.setVisibility(View.VISIBLE);
        progress.setProgress(5);
        showLoading(true);
        if (loadingText != null) loadingText.setText(R.string.loading);
        webView.loadUrl(url);
    }

    private static String normalizeUrl(String raw) {
        String u = raw.trim().replace('\u3000', ' ').trim();
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            if (u.matches("^\\d{1,3}(\\.\\d{1,3}){3}(:\\d+)?(/.*)?$")) {
                u = "http://" + u;
            } else {
                u = "https://" + u;
            }
        }
        while (u.endsWith("/") && u.length() > 8) {
            u = u.substring(0, u.length() - 1);
        }
        return u;
    }
}
