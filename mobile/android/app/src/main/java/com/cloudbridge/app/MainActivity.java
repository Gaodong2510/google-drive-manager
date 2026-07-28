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
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.ScrollView;
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
 * Generic WebView shell. No operator domain baked in.
 * Loading uses a thin top bar only (no blocking full-screen overlay).
 */
public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "cloudbridge";
    private static final String KEY_URL = "server_url";
    private static final long LOAD_TIMEOUT_MS = 20_000L;

    private WebView webView;
    private SwipeRefreshLayout swipe;
    private ProgressBar progress;
    private ScrollView setup;
    private View loading; // kept for layout id; never used as blocker
    private TextInputEditText serverUrl;
    private FloatingActionButton fabMenu;
    private MaterialButton cancelSetupBtn;
    private SharedPreferences prefs;
    private boolean hasServer;
    private String lastUrl = "";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable loadTimeout;
    private boolean pageReady;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.Theme_CloudBridge);
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        // Soft keyboard: resize content via IME insets (edge-to-edge breaks default adjustResize)
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN);

        boolean night = isNightMode();
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (c != null) {
            c.setAppearanceLightStatusBars(!night);
            c.setAppearanceLightNavigationBars(!night);
        }

        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        webView = findViewById(R.id.webview);
        swipe = findViewById(R.id.swipe);
        progress = findViewById(R.id.progress);
        setup = findViewById(R.id.setup);
        loading = findViewById(R.id.loading);
        serverUrl = findViewById(R.id.serverUrl);
        fabMenu = findViewById(R.id.fabMenu);
        cancelSetupBtn = findViewById(R.id.cancelSetupBtn);

        // Never block UI with full-screen loader
        if (loading != null) loading.setVisibility(View.GONE);

        int windowBg = getColorCompat(R.color.gdm_window_bg);
        webView.setBackgroundColor(windowBg);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        findViewById(R.id.root).setBackgroundColor(windowBg);

        // System bars + IME so the URL field scrolls above the keyboard
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root), (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            int imeBottom = ime.bottom;

            // Setup form padding
            int setupTop = bars.top + dp(16);
            int setupBottom = Math.max(bars.bottom, imeBottom) + dp(20);
            setup.setPadding(setup.getPaddingLeft(), setupTop, setup.getPaddingRight(), setupBottom);

            // FAB above nav / keyboard
            applyFabMargin(
                    fabMenu,
                    Math.max(bars.bottom, imeBottom) + dp(16),
                    Math.max(bars.right, dp(8)) + dp(12));

            // When keyboard opens, scroll input into view
            if (imeBottom > 0 && setup.getVisibility() == View.VISIBLE) {
                setup.post(() -> {
                    View card = findViewById(R.id.setupCard);
                    if (card != null) {
                        setup.smoothScrollTo(0, Math.max(0, card.getTop() - dp(24)));
                    } else {
                        setup.smoothScrollTo(0, serverUrl.getTop());
                    }
                });
            }
            return insets;
        });

        configureWebView();

        swipe.setColorSchemeColors(0xFF0EA5E9, 0xFF6366F1);
        swipe.setProgressBackgroundColorSchemeColor(
                isNightMode() ? 0xFF1E293B : 0xFFE2E8F0);
        swipe.setOnRefreshListener(() -> {
            String u = prefs.getString(KEY_URL, lastUrl);
            if (u != null && !u.isEmpty()) openUrl(u);
            else webView.reload();
        });

        findViewById(R.id.saveBtn).setOnClickListener(v -> saveAndOpen());
        cancelSetupBtn.setOnClickListener(v -> {
            hideKeyboard();
            if (hasServer) showBrowser();
        });
        fabMenu.setOnClickListener(v -> showMenu());

        // Focus → ensure keyboard + scroll
        serverUrl.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) {
                v.postDelayed(() -> {
                    ViewCompat.requestApplyInsets(findViewById(R.id.root));
                    setup.smoothScrollTo(0, Math.max(0, findViewById(R.id.setupCard).getTop() - dp(16)));
                }, 120);
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (setup.getVisibility() == View.VISIBLE) {
                    if (hasServer) {
                        hideKeyboard();
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

    @Override
    protected void onDestroy() {
        cancelLoadTimeout();
        super.onDestroy();
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

    private int getColorCompat(int resId) {
        return getResources().getColor(resId, getTheme());
    }

    private boolean isNightMode() {
        int mask = getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return mask == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    private void hideKeyboard() {
        View focus = getCurrentFocus();
        if (focus == null) focus = serverUrl;
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null && focus != null) {
            imm.hideSoftInputFromWindow(focus.getWindowToken(), 0);
        }
    }

    private void scheduleLoadTimeout() {
        cancelLoadTimeout();
        pageReady = false;
        loadTimeout = () -> {
            if (!pageReady && swipe.getVisibility() == View.VISIBLE) {
                // Force-hide any residual chrome and show error if still blank-ish
                progress.setVisibility(View.GONE);
                swipe.setRefreshing(false);
                String u = lastUrl.isEmpty() ? prefs.getString(KEY_URL, "") : lastUrl;
                showErrorPage(u, getString(R.string.load_timeout));
            }
        };
        mainHandler.postDelayed(loadTimeout, LOAD_TIMEOUT_MS);
    }

    private void cancelLoadTimeout() {
        if (loadTimeout != null) {
            mainHandler.removeCallbacks(loadTimeout);
            loadTimeout = null;
        }
    }

    private void markPageReady() {
        pageReady = true;
        cancelLoadTimeout();
        progress.setVisibility(View.GONE);
        swipe.setRefreshing(false);
    }

    private void injectStatusBarCss(WebView view) {
        int px = 0;
        try {
            WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(findViewById(R.id.root));
            if (wi != null) {
                px = wi.getInsets(WindowInsetsCompat.Type.statusBars()).top;
            }
        } catch (Exception ignored) {
        }
        if (px <= 0) px = dp(28);
        float density = getResources().getDisplayMetrics().density;
        String js =
                "(function(){"
                        + "var d=document.documentElement;"
                        + "d.style.setProperty('--gdm-sat','"
                        + (px / density)
                        + "px');"
                        + "var dark=d.classList.contains('dark');"
                        + "if(window.CB&&CB.setNativeChrome){CB.setNativeChrome(dark?1:0);}"
                        + "})();";
        view.evaluateJavascript(js, null);
    }

    private void applyNativeChrome(boolean dark) {
        int bg = dark ? 0xFF0B1220 : 0xFFF1F5F9;
        webView.setBackgroundColor(bg);
        findViewById(R.id.root).setBackgroundColor(bg);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setNavigationBarColor(bg);
        }
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (c != null) {
            c.setAppearanceLightStatusBars(!dark);
            c.setAppearanceLightNavigationBars(!dark);
        }
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
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        // Faster first paint
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
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
                // Ignore intermediate about:blank
                if (url != null && (url.startsWith("about:") || url.startsWith("data:"))) return;
                progress.setVisibility(View.VISIBLE);
                progress.setIndeterminate(false);
                progress.setProgress(10);
                scheduleLoadTimeout();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("about:")) return;
                // SPA: hide progress quickly — content may still hydrate JS
                progress.setProgress(100);
                markPageReady();
                injectStatusBarCss(view);
                if (url != null && !url.startsWith("data:") && !url.startsWith("about:")) {
                    lastUrl = url;
                }
            }

            @Override
            public void onReceivedError(
                    WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    markPageReady();
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
                    markPageReady();
                    showErrorPage(failingUrl, description);
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                markPageReady();
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
                    markPageReady();
                } else if (newProgress > 0) {
                    progress.setVisibility(View.VISIBLE);
                    progress.setIndeterminate(false);
                    progress.setProgress(Math.max(10, newProgress));
                    // SPA often sits at high progress while JS runs — reveal page early
                    if (newProgress >= 70) {
                        progress.setVisibility(View.GONE);
                    }
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

                    @android.webkit.JavascriptInterface
                    public void setNativeChrome(int dark) {
                        runOnUiThread(() -> applyNativeChrome(dark == 1));
                    }
                },
                "CB");
    }

    private void showErrorPage(String url, String detail) {
        String safeUrl = url == null ? "" : url.replace("&", "&amp;").replace("'", "&#39;");
        String safeDetail =
                detail == null ? "" : detail.replace("&", "&amp;").replace("<", "&lt;");
        boolean night = isNightMode();
        String bg = night ? "#0b1220" : "#f1f5f9";
        String card = night ? "#111827" : "#ffffff";
        String border = night ? "#1e293b" : "#e2e8f0";
        String text = night ? "#e2e8f0" : "#1e293b";
        String muted = night ? "#94a3b8" : "#64748b";
        String codeBg = night ? "#0f172a" : "#f8fafc";
        String codeFg = night ? "#7dd3fc" : "#0369a1";
        String secBtn = night ? "#1e293b" : "#e2e8f0";
        String secFg = night ? "#cbd5e1" : "#334155";
        String html =
                "<!DOCTYPE html><html><head><meta charset='utf-8'/>"
                        + "<meta name='viewport' content='width=device-width,initial-scale=1'/>"
                        + "<style>"
                        + "body{margin:0;font-family:sans-serif;background:"
                        + bg
                        + ";color:"
                        + text
                        + ";display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;}"
                        + ".card{max-width:420px;background:"
                        + card
                        + ";border:1px solid "
                        + border
                        + ";border-radius:20px;padding:28px;}"
                        + "h1{font-size:20px;margin:0 0 8px;}p{color:"
                        + muted
                        + ";font-size:14px;line-height:1.55;}"
                        + "code{display:block;background:"
                        + codeBg
                        + ";padding:10px;border-radius:10px;font-size:12px;word-break:break-all;margin:12px 0;color:"
                        + codeFg
                        + ";}"
                        + "button{width:100%;margin-top:10px;padding:14px;border:0;border-radius:12px;"
                        + "background:#0ea5e9;color:#fff;font-size:15px;font-weight:600;}"
                        + "button.secondary{background:"
                        + secBtn
                        + ";color:"
                        + secFg
                        + ";}"
                        + "</style></head><body><div class='card'>"
                        + "<h1>无法打开面板</h1>"
                        + "<p>请检查地址是否为可访问的 HTTPS 域名，以及手机网络是否正常。</p>"
                        + "<code>"
                        + safeUrl
                        + "</code>"
                        + (safeDetail.isEmpty() ? "" : "<p>" + safeDetail + "</p>")
                        + "<button onclick=\"CB.retry()\">重试</button>"
                        + "<button class='secondary' onclick=\"CB.changeServer()\">更换服务器</button>"
                        + "</div></body></html>";
        showBrowser();
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
        cancelLoadTimeout();
        setup.setVisibility(View.VISIBLE);
        swipe.setVisibility(View.GONE);
        fabMenu.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        if (loading != null) loading.setVisibility(View.GONE);
        cancelSetupBtn.setVisibility(canCancel && hasServer ? View.VISIBLE : View.GONE);
        if (current != null && !current.isEmpty() && !isLegacyIpHttpUrl(current)) {
            serverUrl.setText(current);
            serverUrl.setSelection(current.length());
        } else {
            serverUrl.setText("");
        }
        serverUrl.requestFocus();
        // Request IME after layout
        serverUrl.postDelayed(() -> {
            InputMethodManager imm =
                    (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.showSoftInput(serverUrl, InputMethodManager.SHOW_IMPLICIT);
            }
            ViewCompat.requestApplyInsets(findViewById(R.id.root));
        }, 200);
    }

    private void showBrowser() {
        setup.setVisibility(View.GONE);
        swipe.setVisibility(View.VISIBLE);
        fabMenu.setVisibility(View.VISIBLE);
        hideKeyboard();
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
                                hideKeyboard();
                                openUrl(url);
                            })
                    .setNegativeButton(android.R.string.cancel, null)
                    .show();
            return;
        }
        prefs.edit().putString(KEY_URL, url).apply();
        hasServer = true;
        hideKeyboard();
        Toast.makeText(this, R.string.url_saved, Toast.LENGTH_SHORT).show();
        openUrl(url);
    }

    private void openUrl(String url) {
        lastUrl = url;
        pageReady = false;
        showBrowser();
        progress.setVisibility(View.VISIBLE);
        progress.setProgress(8);
        if (loading != null) loading.setVisibility(View.GONE); // never block
        scheduleLoadTimeout();
        webView.stopLoading();
        webView.loadUrl(url);
    }

    private static String normalizeUrl(String raw) {
        String u = raw.trim().replace('\u3000', ' ').trim();
        // strip accidental whitespace in middle of copy-paste
        u = u.replaceAll("\\s+", "");
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
