package com.pathkin.trail;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Thin host for the game. The game (rules core, content packs, screens) is the
 * web bundle in assets/www, served to the WebView from a private local origin.
 * This class adds only what the platform must provide: atomic file saves with
 * rolling backups, haptics, system-bar insets and the back button.
 */
public class MainActivity extends Activity {
    private static final String HOST = "pathkin.local";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int BACKUPS = 3;
    private static final Pattern KEY = Pattern.compile("[a-z0-9]{1,24}");

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.parseColor("#F6EFDF"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F6EFDF"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        frame.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(frame);

        // Edge-to-edge is enforced on current Android: keep the game clear of
        // system bars, cutouts and the keyboard.
        frame.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!HOST.equals(request.getUrl().getHost())) return notFound();
                return asset(request.getUrl().getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost());
            }
        });
        web.addJavascriptInterface(new Bridge(), "PathkinNative");
        web.setHapticFeedbackEnabled(false);
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        // Always a fresh load: the game restores itself from its own save,
        // which is written after every event.
        web.loadUrl(START);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    /** The game decides what Back means; it answers false when it has nothing to close. */
    private void handleBack() {
        web.evaluateJavascript("window.pathkinBack ? window.pathkinBack() : false", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    // ---- Asset serving ----------------------------------------------------

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
    }

    private WebResourceResponse asset(String path) {
        if (path == null || path.contains("..")) return notFound();
        String rel = path.startsWith("/") ? path.substring(1) : path;
        if (rel.isEmpty()) rel = "index.html";
        int dot = rel.lastIndexOf('.');
        String mime = dot < 0 ? null : MIME.get(rel.substring(dot + 1));
        if (mime == null) return notFound();
        try {
            InputStream in = getAssets().open("www/" + rel);
            WebResourceResponse res = new WebResourceResponse(mime, "utf-8", in);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            res.setResponseHeaders(headers);
            return res;
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    // ---- Native bridge ----------------------------------------------------

    private File file(String key, int backup) {
        if (key == null || !KEY.matcher(key).matches()) throw new IllegalArgumentException("bad key");
        File dir = new File(getFilesDir(), "saves");
        dir.mkdirs();
        return new File(dir, backup == 0 ? key + ".json" : key + ".bak" + backup + ".json");
    }

    private static String read(File f) {
        if (!f.isFile()) return null;
        try {
            return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    private final class Bridge {
        @JavascriptInterface
        public String load(String key) {
            return read(file(key, 0));
        }

        @JavascriptInterface
        public String loadBackup(String key, int n) {
            if (n < 1 || n > BACKUPS) return null;
            return read(file(key, n));
        }

        /** Atomic write: temp file, fsync, then rename over the live save. */
        @JavascriptInterface
        public synchronized boolean save(String key, String json) {
            try {
                File live = file(key, 0);
                File tmp = new File(live.getParentFile(), key + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                    out.getFD().sync();
                }
                if (live.isFile()) {
                    for (int n = BACKUPS; n > 1; n--) {
                        File older = file(key, n - 1);
                        if (older.isFile()) {
                            Files.move(older.toPath(), file(key, n).toPath(), StandardCopyOption.REPLACE_EXISTING);
                        }
                    }
                    Files.copy(live.toPath(), file(key, 1).toPath(), StandardCopyOption.REPLACE_EXISTING);
                }
                Files.move(tmp.toPath(), live.toPath(),
                        StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                return true;
            } catch (IOException | RuntimeException e) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized void remove(String key) {
            for (int n = 0; n <= BACKUPS; n++) file(key, n).delete();
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            Vibrator v = getSystemService(Vibrator.class);
            if (v != null && v.hasVibrator()) {
                v.vibrate(VibrationEffect.createOneShot(Math.max(1, Math.min(ms, 400)),
                        VibrationEffect.DEFAULT_AMPLITUDE));
            }
        }
    }
}
