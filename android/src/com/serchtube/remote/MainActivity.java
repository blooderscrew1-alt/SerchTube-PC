package com.serchtube.remote;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Contenedor Android de SerchTube Remote.
 *
 * La primera vez busca el host de SerchTube en la red local (puerto 3000).
 * Si lo encuentra, abre el mando a pantalla completa. Si no, permite escribir
 * la IP manualmente. Guarda el host para abrir directo las próximas veces.
 */
public class MainActivity extends Activity {
    private static final int PORT = 3000;
    private static final String PREFS = "serchtube_remote";
    private static final String KEY_HOST = "host";
    private static final int BG = Color.rgb(13, 11, 18);
    private static final int FG = Color.rgb(248, 243, 255);
    private static final int MUTED = Color.rgb(180, 170, 200);

    private WebView webView;
    private SharedPreferences prefs;
    private LinearLayout root;

    /** Puente que usa el menú de tres puntos del mando para cambiar de host. */
    private class HostBridge {
        @JavascriptInterface
        public void searchAnotherHost() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    prefs.edit().remove(KEY_HOST).apply();
                    showSetup("Buscando SerchTube en tu red local…", true);
                    discoverHost();
                }
            });
        }

        @JavascriptInterface
        public void enterHostManually() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showSetup("Escribe la dirección del host de SerchTube.", false);
                }
            });
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        hideSystemUi();

        String saved = prefs.getString(KEY_HOST, "");
        if (saved != null && saved.length() > 0) {
            showWeb(saved);
        } else {
            showSetup("Buscando SerchTube en tu red local…", true);
            discoverHost();
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    private void showSetup(String message, boolean searching) {
        if (webView != null) {
            View parent = (View) webView.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(webView);
            }
            webView.destroy();
            webView = null;
        }

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(26), dp(40), dp(26), dp(28));

        TextView brand = new TextView(this);
        brand.setText("SerchTube");
        brand.setTextColor(FG);
        brand.setTextSize(31);
        brand.setGravity(Gravity.CENTER);
        brand.setTypeface(brand.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(brand);

        TextView remote = new TextView(this);
        remote.setText("REMOTE");
        remote.setTextColor(Color.rgb(220, 38, 38));
        remote.setTextSize(12);
        remote.setLetterSpacing(0.35f);
        remote.setGravity(Gravity.CENTER);
        remote.setPadding(0, 0, 0, dp(26));
        root.addView(remote);

        TextView info = new TextView(this);
        info.setText(message);
        info.setTextColor(MUTED);
        info.setTextSize(14);
        info.setGravity(Gravity.CENTER);
        info.setPadding(0, 0, 0, dp(22));
        root.addView(info);

        EditText input = new EditText(this);
        input.setHint("http://192.168.1.100:3000");
        input.setTextColor(FG);
        input.setHintTextColor(Color.rgb(120, 112, 138));
        input.setTextSize(15);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        String saved = prefs.getString(KEY_HOST, "");
        if (saved != null) input.setText(saved);
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        inputParams.bottomMargin = dp(14);
        root.addView(input, inputParams);

        Button connect = new Button(this);
        connect.setText("Conectar");
        connect.setAllCaps(false);
        connect.setTextSize(15);
        connect.setTextColor(Color.WHITE);
        connect.setBackgroundColor(Color.rgb(23, 21, 29));
        connect.setPadding(dp(18), dp(12), dp(18), dp(12));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        buttonParams.bottomMargin = dp(10);
        root.addView(connect, buttonParams);

        Button search = new Button(this);
        search.setText(searching ? "Buscando…" : "Buscar automáticamente");
        search.setAllCaps(false);
        search.setTextSize(13);
        search.setTextColor(FG);
        search.setBackgroundColor(Color.rgb(45, 37, 60));
        search.setEnabled(!searching);
        root.addView(search, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView hint = new TextView(this);
        hint.setText("El teléfono y la PC deben estar en la misma red Wi-Fi.");
        hint.setTextColor(Color.rgb(135, 127, 155));
        hint.setTextSize(11);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, dp(18), 0, 0);
        root.addView(hint);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.addView(root);
        setContentView(scroll);

        View.OnClickListener doConnect = new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String host = normalizeHost(input.getText().toString());
                if (host == null) {
                    info.setText("Escribe una dirección válida, por ejemplo http://192.168.1.100:3000");
                    return;
                }
                prefs.edit().putString(KEY_HOST, host).apply();
                showWeb(host);
            }
        };
        connect.setOnClickListener(doConnect);
        search.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showSetup("Buscando SerchTube en tu red local…", true);
                discoverHost();
            }
        });
    }

    private String normalizeHost(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.length() == 0) return null;
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        try {
            URL url = new URL(value);
            if (url.getHost() == null || url.getHost().length() == 0) return null;
            if (url.getPort() == -1) {
                value = url.getProtocol() + "://" + url.getHost() + ":" + PORT;
            }
            return value;
        } catch (Exception e) {
            return null;
        }
    }

    private void showWeb(String origin) {
        hideSystemUi();
        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        webView.addJavascriptInterface(new HostBridge(), "SerchTubeHost");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.equals(view.getUrl())) {
                    prefs.edit().remove(KEY_HOST).apply();
                    showSetup("No pude conectar con el host. Verifica la IP y que SerchTube esté abierto.", false);
                }
            }
        });

        String url = origin + (origin.contains("?") ? "&" : "?") + "role=satellite&room=serchtube-master&source=apk";
        webView.loadUrl(url);
        setContentView(webView);
    }

    private void discoverHost() {
        final String localIp = getLocalIp();
        if (localIp == null) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showSetup("No encontré una red Wi-Fi. Escribe la IP del host manualmente.", false);
                }
            });
            return;
        }

        final String base = localIp.substring(0, localIp.lastIndexOf('.') + 1);
        new Thread(new Runnable() {
            @Override
            public void run() {
                ExecutorService pool = Executors.newFixedThreadPool(32);
                List<Future<String>> futures = new ArrayList<>();
                for (int i = 1; i <= 254; i++) {
                    final String candidate = base + i;
                    futures.add(pool.submit(new Callable<String>() {
                        @Override
                        public String call() {
                            return probe(candidate) ? candidate : null;
                        }
                    }));
                }

                String found = null;
                for (Future<String> future : futures) {
                    try {
                        String result = future.get(1400, TimeUnit.MILLISECONDS);
                        if (result != null && found == null) found = result;
                    } catch (Exception ignored) {
                    }
                }
                pool.shutdownNow();

                final String host = found;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (host != null) {
                            String origin = "http://" + host + ":" + PORT;
                            prefs.edit().putString(KEY_HOST, origin).apply();
                            showWeb(origin);
                        } else {
                            showSetup("No pude encontrar el host automáticamente. Escribe su IP.", false);
                        }
                    }
                });
            }
        }).start();
    }

    private boolean probe(String ip) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL("http://" + ip + ":" + PORT + "/manifest.json");
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(320);
            connection.setReadTimeout(320);
            connection.setRequestMethod("GET");
            connection.setInstanceFollowRedirects(false);
            int code = connection.getResponseCode();
            if (code != 200) return false;
            byte[] buffer = new byte[320];
            int read = connection.getInputStream().read(buffer);
            if (read <= 0) return false;
            String body = new String(buffer, 0, read, "UTF-8");
            return body.contains("SerchTube");
        } catch (Exception e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String getLocalIp() {
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
