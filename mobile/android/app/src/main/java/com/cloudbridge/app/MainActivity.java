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
 * Fullscreen WebView shell. Each user enters their own panel URL.
 * Legacy plain http://IP:port is migrated away after TLS cutover.
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
    private String lastUrl = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
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
        serverUrl = findViewById(R.id.serverUrl);
        fabMenu = findViewById(R.id.fabMenu);
        cancelSetupBtn = findViewById(R.id.cancelSetupBtn);

        // Suggested HTTPS domain as field hint only (not forced)
        if (BuildConfig.SUGGESTED_URL != null && !BuildConfig.SUGGESTED_URL.isEmpty()) {
            serverUrl.setHint(BuildConfig.SUGGESTED_URL);
        }

        ViewCompat.setOnApplyWindowInsetsListener(setup, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(
                    v.getPaddingLeft(),
                    bars.top + dp(24),
                    v.getPaddingRight(),
                    bars.bottom + dp(16));
            return insets;
        });
        ViewCompat.setOnApplyWindowInsetsListener(fabMenu, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            applyFabMargin(v, bars.bottom + dp(18), bars.right + dp(12));
            return insets;
        });

        configureWebView();

        swipe.setColorSchemeColors(0xFF0EA5E9, 0xFF6366F1);
        swipe.setProgressBackgroundColorSchemeColor(0xFF1E293B);
        swipe.setOnRefreshListener(() -> {
            if (lastUrl != null && !lastUrl.isEmpty()) {
                webView.loadUrl(lastUrl);
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
            // Pre-fill suggested HTTPS domain for convenience (user can edit)
            if (BuildConfig.SUGGESTED_URL != null && !BuildConfig.SUGGESTED_URL.isEmpty()) {
                serverUrl.setText(BuildConfig.SUGGESTED_URL);
                serverUrl.setSelection(BuildConfig.SUGGESTED_URL.length());
            }
            return;
        }
        String url = normalizeUrl(saved.trim());
        if (isLegacyIpHttpUrl(url)) {
            // Auto-migrate known operator HTTPS domain if provided at build time
            if (BuildConfig.SUGGESTED_URL != null
                    && BuildConfig.SUGGESTED_URL.startsWith("https://")) {
                prefs.edit().putString(KEY_URL, BuildConfig.SUGGESTED_URL).apply();
                hasServer = true;
                Toast.makeText(this, R.string.migrated_to_https, Toast.LENGTH_LONG).show();
                openUrl(BuildConfig.SUGGESTED_URL);
                return;
            }
            prefs.edit().remove(KEY_URL).apply();
            hasServer = false;
            Toast.makeText(this, R.string.legacy_ip_cleared, Toast.LENGTH_LONG).show();
            showSetup(null, false);
            if (BuildConfig.SUGGESTED_URL != null && !BuildConfig.SUGGESTED_URL.isEmpty()) {
                serverUrl.setText(BuildConfig.SUGGESTED_URL);
            }
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
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
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
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                swipe.setRefreshing(false);
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
                    showErrorPage(failingUrl, description);
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                swipe.setRefreshing(false);
                progress.setVisibility(View.GONE);
                String msg = getString(R.string.ssl_error);
                if (error != null) {
                    msg = msg + "\n(" + error.toString() + ")";
                }
                showErrorPage(lastUrl, msg);
                // Do not proceed with invalid cert blindly
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
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });

        webView.addJavascriptInterface(
                new Object() {
                    @android.webkit.JavascriptInterface
                    public void changeServer() {
                        runOnUiThread(
                                () -> showSetup(prefs.getString(KEY_URL, ""), true));
                    }

                    @android.webkit.JavascriptInterface
                    public void openSuggested() {
                        runOnUiThread(
                                () -> {
                                    String sug =
                                            BuildConfig.SUGGESTED_URL == null
                                                            || BuildConfig.SUGGESTED_URL.isEmpty()
                                                    ? "https://drive.dongwen.cc"
                                                    : BuildConfig.SUGGESTED_URL;
                                    prefs.edit().putString(KEY_URL, sug).apply();
                                    hasServer = true;
                                    openUrl(sug);
                                });
                    }
                },
                "CB");
    }

    private void showErrorPage(String url, String detail) {
        String safeUrl = url == null ? "" : url.replace("&", "&amp;").replace("'", "&#39;");
        String safeDetail =
                detail == null ? "" : detail.replace("&", "&amp;").replace("<", "&lt;");
        String sug =
                (BuildConfig.SUGGESTED_URL == null || BuildConfig.SUGGESTED_URL.isEmpty())
                        ? "https://drive.dongwen.cc"
                        : BuildConfig.SUGGESTED_URL;
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
                        + "<p>请使用 <b>HTTPS 域名</b>。公网已关闭明文端口，请填写：</p>"
                        + "<code>"
                        + sug
                        + "</code>"
                        + "<p class='hint'>当前尝试："
                        + safeUrl
                        + "</p>"
                        + (safeDetail.isEmpty()
                                ? ""
                                : "<p class='hint'>详情：" + safeDetail + "</p>")
                        + "<button onclick=\"CB.openSuggested()\">打开推荐地址</button>"
                        + "<button class='secondary' onclick=\"CB.changeServer()\">更换服务器</button>"
                        + "</div></body></html>";
        showBrowser();
        webView.loadDataWithBaseURL(sug + "/", html, "text/html", "utf-8", null);
    }

    private void showMenu() {
        final String current = prefs.getString(KEY_URL, "");
        String[] items =
                new String[] {
                    getString(R.string.menu_reload),
                    getString(R.string.menu_change_server),
                    getString(R.string.menu_open_suggested),
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
                                if (!lastUrl.isEmpty() && !lastUrl.startsWith("data:")) {
                                    webView.loadUrl(lastUrl);
                                } else if (current != null && !current.isEmpty()) {
                                    openUrl(current);
                                } else {
                                    webView.reload();
                                }
                            } else if (which == 1) {
                                showSetup(current, true);
                            } else if (which == 2) {
                                String sug = BuildConfig.SUGGESTED_URL;
                                if (sug == null || sug.isEmpty()) {
                                    sug = "https://drive.dongwen.cc";
                                }
                                prefs.edit().putString(KEY_URL, sug).apply();
                                hasServer = true;
                                openUrl(sug);
                            } else if (which == 3) {
                                webView.clearCache(true);
                                CookieManager.getInstance().removeAllCookies(null);
                                Toast.makeText(this, R.string.menu_clear_cache, Toast.LENGTH_SHORT)
                                        .show();
                                if (current != null && !current.isEmpty()) openUrl(current);
                            } else if (which == 4) {
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
        cancelSetupBtn.setVisibility(canCancel && hasServer ? View.VISIBLE : View.GONE);
        if (current != null && !current.isEmpty() && !isLegacyIpHttpUrl(current)) {
            serverUrl.setText(current);
            serverUrl.setSelection(current.length());
        } else if (BuildConfig.SUGGESTED_URL != null && !BuildConfig.SUGGESTED_URL.isEmpty()) {
            serverUrl.setText(BuildConfig.SUGGESTED_URL);
            serverUrl.setSelection(BuildConfig.SUGGESTED_URL.length());
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
                            R.string.use_suggested,
                            (d, w) -> {
                                String sug =
                                        BuildConfig.SUGGESTED_URL.isEmpty()
                                                ? "https://drive.dongwen.cc"
                                                : BuildConfig.SUGGESTED_URL;
                                serverUrl.setText(sug);
                                prefs.edit().putString(KEY_URL, sug).apply();
                                hasServer = true;
                                openUrl(sug);
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
        webView.loadUrl(url);
    }

    private static String normalizeUrl(String raw) {
        String u = raw.trim().replace('\u3000', ' ').trim();
        // strip trailing spaces / fullwidth slash
        while (u.endsWith(" ") || u.endsWith("\u3000")) {
            u = u.substring(0, u.length() - 1);
        }
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
