package com.serchtube.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
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
import android.widget.Toast;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.json.JSONObject;

/**
 * Contenedor Android de SerchTube Remote.
 *
 * La primera vez busca el host de SerchTube en la red local (puerto 3000).
 * Si lo encuentra, abre el mando a pantalla completa. Si no, permite escribir
 * la IP manualmente. Guarda el host para abrir directo las próximas veces.
 */
public class MainActivity extends Activity {
    private static final int PORT = 3000;
    private static final int REQ_QR_SCAN = 4101;
    private static final int REQ_QR_STORAGE = 4102;
    private static final String PREFS = "serchtube_remote";
    private static final String KEY_HOST = "host";
    private static final String VERSION_URL =
            "https://raw.githubusercontent.com/blooderscrew1-alt/SerchTube-PC/main/public/android-version.json";
    private static final int BG = Color.rgb(13, 11, 18);
    private static final int FG = Color.rgb(248, 243, 255);
    private static final int MUTED = Color.rgb(180, 170, 200);

    private WebView webView;
    private SharedPreferences prefs;
    private LinearLayout root;
    private Uri qrOutputUri;

    /** Puente que usa el menú de tres puntos del mando para cambiar de host. */
    private class HostBridge {
        @JavascriptInterface
        public void searchAnotherHost() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    prefs.edit().remove(KEY_HOST).apply();
                    discoverHosts(false, null);
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

        @JavascriptInterface
        public void scanHostQr() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.scanHostQr();
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
            checkSavedHost(saved);
        } else {
            discoverHosts(true, null);
        }

        checkForUpdates();
    }

    /** Primer arranque con host guardado: probarlo antes de escanear toda la red. */
    private void checkSavedHost(final String saved) {
        showSetup("Conectando al último host conocido…", true);
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean reachable = probeOrigin(saved);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (reachable) {
                            showWeb(saved);
                        } else {
                            discoverHosts(true, null);
                        }
                    }
                });
            }
        }).start();
    }

    /** Consulta GitHub en segundo plano; solo muestra diálogo si hay versión nueva. */
    private void checkForUpdates() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                try {
                    URL url = new URL(VERSION_URL + "?t=" + System.currentTimeMillis());
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(3500);
                    connection.setReadTimeout(3500);
                    connection.setRequestMethod("GET");
                    connection.setInstanceFollowRedirects(true);
                    if (connection.getResponseCode() != 200) return;

                    InputStream input = connection.getInputStream();
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    byte[] buffer = new byte[1024];
                    int read;
                    while ((read = input.read(buffer)) > 0) {
                        output.write(buffer, 0, read);
                        if (output.size() > 16384) break;
                    }
                    input.close();

                    JSONObject json = new JSONObject(output.toString("UTF-8"));
                    final int latestCode = json.optInt("versionCode", 0);
                    final String latestName = json.optString("versionName", "");
                    final String apkUrl = json.optString("apkUrl", "");

                    PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                    int currentCode = Build.VERSION.SDK_INT >= 28
                            ? (int) info.getLongVersionCode()
                            : info.versionCode;

                    if (latestCode <= currentCode || !apkUrl.startsWith("https://")) return;
                    if (isFinishing()) return;

                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            new AlertDialog.Builder(MainActivity.this)
                                    .setTitle("Actualización disponible")
                                    .setMessage("Hay una nueva versión de SerchTube Remote"
                                            + (latestName.length() > 0 ? " (" + latestName + ")" : "")
                                            + ". ¿Quieres descargarla?")
                                    .setPositiveButton("Descargar", new DialogInterface.OnClickListener() {
                                        @Override
                                        public void onClick(DialogInterface dialog, int which) {
                                            try {
                                                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl)));
                                            } catch (Exception ignored) {
                                            }
                                        }
                                    })
                                    .setNegativeButton("Ahora no", null)
                                    .show();
                        }
                    });
                } catch (Exception ignored) {
                    // Sin internet o sin actualización: no se molesta al usuario.
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
        }).start();
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
        LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        searchParams.bottomMargin = dp(10);
        root.addView(search, searchParams);

        Button scanQr = new Button(this);
        scanQr.setText("Escanear QR del host");
        scanQr.setAllCaps(false);
        scanQr.setTextSize(13);
        scanQr.setTextColor(FG);
        scanQr.setBackgroundColor(Color.rgb(35, 50, 74));
        scanQr.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                scanHostQr();
            }
        });
        root.addView(scanQr, new LinearLayout.LayoutParams(
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
                discoverHosts(true, null);
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

    private void scanHostQr() {
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE,
                    android.Manifest.permission.READ_EXTERNAL_STORAGE
            }, REQ_QR_STORAGE);
            return;
        }
        launchQrCamera();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_QR_STORAGE) {
            if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                launchQrCamera();
            } else {
                Toast.makeText(this, "Permiso de almacenamiento necesario para escanear el QR.", Toast.LENGTH_LONG).show();
            }
        }
    }

    private void launchQrCamera() {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "serchtube-qr-" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            qrOutputUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (qrOutputUri == null) throw new IllegalStateException("No se pudo crear la foto");

            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, qrOutputUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(intent, REQ_QR_SCAN);
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo abrir la cámara para escanear el QR.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_QR_SCAN) return;

        Uri uri = qrOutputUri;
        qrOutputUri = null;
        if (resultCode == RESULT_OK && uri != null) {
            String text = decodeQrFromUri(uri);
            if (text != null && text.length() > 0) {
                applyQrText(text);
            } else {
                Toast.makeText(this, "No pude leer el QR. Acércalo más y vuelve a intentar.", Toast.LENGTH_LONG).show();
            }
        }
        if (uri != null) {
            try { getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
        }
    }

    private String decodeQrFromUri(Uri uri) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            InputStream first = getContentResolver().openInputStream(uri);
            BitmapFactory.decodeStream(first, null, bounds);
            if (first != null) first.close();

            int sample = 1;
            while (bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1600) {
                sample *= 2;
            }

            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            InputStream second = getContentResolver().openInputStream(uri);
            Bitmap bitmap = BitmapFactory.decodeStream(second, null, options);
            if (second != null) second.close();
            if (bitmap == null) return null;

            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            int[] pixels = new int[width * height];
            bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
            bitmap.recycle();

            RGBLuminanceSource source = new RGBLuminanceSource(width, height, pixels);
            BinaryBitmap binary = new BinaryBitmap(new HybridBinarizer(source));
            Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
            hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
            return new MultiFormatReader().decode(binary, hints).getText();
        } catch (Exception e) {
            return null;
        }
    }

    private void applyQrText(String text) {
        String origin = null;
        try {
            String raw = text.trim();
            if (raw.startsWith("serchtube://")) {
                Uri parsed = Uri.parse(raw);
                origin = normalizeHost(parsed.getQueryParameter("host"));
            } else if (raw.startsWith("http://") || raw.startsWith("https://")) {
                URL url = new URL(raw);
                int port = url.getPort();
                origin = url.getProtocol() + "://" + url.getHost() + (port > 0 ? ":" + port : "");
            } else {
                origin = normalizeHost(raw);
            }
        } catch (Exception ignored) {
        }

        if (origin == null || origin.length() == 0) {
            Toast.makeText(this, "El QR no contiene una dirección de host válida.", Toast.LENGTH_LONG).show();
            return;
        }

        prefs.edit().putString(KEY_HOST, origin).apply();
        Toast.makeText(this, "Conectando a " + origin, Toast.LENGTH_SHORT).show();
        showWeb(origin);
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

    /**
     * Escanea la red. Si autoConnect=true conecta al primer host disponible;
     * si es false muestra la lista para que el usuario elija.
     */
    private void discoverHosts(final boolean autoConnect, final String preferredOrigin) {
        showSetup("Buscando hosts de SerchTube en tu red…", true);

        final String localIp = getLocalIp();
        if (localIp == null && preferredOrigin == null) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (autoConnect) {
                        showSetup("No encontré una red Wi-Fi. Escribe la IP del host manualmente.", false);
                    } else {
                        showHostList(new ArrayList<String>(), "No encontré una red Wi-Fi. Revisa la conexión Wi‑Fi.");
                    }
                }
            });
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                final List<String> found = new ArrayList<>();

                if (preferredOrigin != null && probeOrigin(preferredOrigin) && !found.contains(preferredOrigin)) {
                    found.add(preferredOrigin);
                }

                if (localIp != null) {
                    final String base = localIp.substring(0, localIp.lastIndexOf('.') + 1);
                    ExecutorService pool = Executors.newFixedThreadPool(32);
                    List<Future<String>> futures = new ArrayList<>();
                    for (int i = 1; i <= 254; i++) {
                        final String candidate = base + i;
                        futures.add(pool.submit(new Callable<String>() {
                            @Override
                            public String call() {
                                return probe(candidate) ? "http://" + candidate + ":" + PORT : null;
                            }
                        }));
                    }

                    for (Future<String> future : futures) {
                        try {
                            String result = future.get(1400, TimeUnit.MILLISECONDS);
                            if (result != null && !found.contains(result)) found.add(result);
                        } catch (Exception ignored) {
                        }
                    }
                    pool.shutdownNow();
                }

                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (autoConnect) {
                            if (!found.isEmpty()) {
                                String origin = found.get(0);
                                prefs.edit().putString(KEY_HOST, origin).apply();
                                showWeb(origin);
                            } else {
                                showSetup("No pude encontrar el host automáticamente. Escribe su IP.", false);
                            }
                        } else {
                            String message = found.isEmpty()
                                    ? "No encontré ningún host de SerchTube en esta red."
                                    : "Toca el host al que quieres conectarte.";
                            showHostList(found, message);
                        }
                    }
                });
            }
        }).start();
    }

    /** Lista de hosts encontrados; no conecta hasta que el usuario toca uno. */
    private void showHostList(List<String> hosts, String message) {
        if (webView != null) {
            View parent = (View) webView.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(webView);
            }
            webView.destroy();
            webView = null;
        }

        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setBackgroundColor(BG);
        container.setPadding(dp(24), dp(34), dp(24), dp(24));

        TextView title = new TextView(this);
        title.setText("Hosts disponibles");
        title.setTextColor(FG);
        title.setTextSize(27);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        container.addView(title);

        TextView info = new TextView(this);
        info.setText(message);
        info.setTextColor(MUTED);
        info.setTextSize(13);
        info.setPadding(0, dp(8), 0, dp(18));
        container.addView(info);

        final String saved = prefs.getString(KEY_HOST, "");
        for (final String origin : hosts) {
            Button hostButton = new Button(this);
            String label = origin;
            if (saved != null && saved.equals(origin)) label += "   · último usado";
            hostButton.setText(label);
            hostButton.setAllCaps(false);
            hostButton.setTextSize(13);
            hostButton.setTextColor(FG);
            hostButton.setBackgroundColor(Color.rgb(35, 50, 74));
            hostButton.setPadding(dp(12), dp(10), dp(12), dp(10));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            params.bottomMargin = dp(8);
            hostButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    prefs.edit().putString(KEY_HOST, origin).apply();
                    showWeb(origin);
                }
            });
            container.addView(hostButton, params);
        }

        Button scanQr = new Button(this);
        scanQr.setText("Escanear QR del host");
        scanQr.setAllCaps(false);
        scanQr.setTextSize(13);
        scanQr.setTextColor(FG);
        scanQr.setBackgroundColor(Color.rgb(35, 50, 74));
        scanQr.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                scanHostQr();
            }
        });
        LinearLayout.LayoutParams scanParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        scanParams.bottomMargin = dp(8);
        container.addView(scanQr, scanParams);

        Button manual = new Button(this);
        manual.setText("Escribir IP manualmente");
        manual.setAllCaps(false);
        manual.setTextSize(13);
        manual.setTextColor(FG);
        manual.setBackgroundColor(Color.rgb(55, 45, 72));
        manual.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showSetup("Escribe la dirección del host de SerchTube.", false);
            }
        });
        container.addView(manual);

        Button rescan = new Button(this);
        rescan.setText("Volver a buscar");
        rescan.setAllCaps(false);
        rescan.setTextSize(12);
        rescan.setTextColor(MUTED);
        rescan.setBackgroundColor(Color.TRANSPARENT);
        rescan.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                discoverHosts(false, null);
            }
        });
        container.addView(rescan);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.addView(container);
        setContentView(scroll);
    }

    private boolean probe(String ip) {
        return probeUrl("http://" + ip + ":" + PORT + "/manifest.json");
    }

    private boolean probeOrigin(String origin) {
        try {
            URL url = new URL(origin);
            int port = url.getPort() == -1 ? PORT : url.getPort();
            String base = url.getProtocol() + "://" + url.getHost() + ":" + port + "/manifest.json";
            return probeUrl(base);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean probeUrl(String urlString) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(urlString);
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
