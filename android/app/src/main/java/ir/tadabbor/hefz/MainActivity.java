package ir.tadabbor.hefz;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import org.json.JSONArray;
import org.json.JSONObject;

/** Hosts the bundled app (assets/index.html) in a full-screen WebView. */
public class MainActivity extends Activity {
    private static final int PICK_FILE = 41;
    private static final String APP_URL = "file:///android_asset/index.html";

    /** Uthman Taha (QCF4) mushaf fonts: downloaded once after install and kept in app storage. */
    private static final String QCF_CDN = "https://cdn.jsdelivr.net/npm/quran-qcf4@1.1.0/fonts-woff2/";
    private static final String[] QCF_FILES = buildQcfList();

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private View fullscreenView;
    private volatile boolean downloading = false;
    /** One download job at a time (translations, recitations), in the order they were asked for. */
    private final ExecutorService jobs = Executors.newSingleThreadExecutor();
    private final AtomicReference<String> cancelled = new AtomicReference<>("");

    private static String[] buildQcfList() {
        String[] list = new String[48];
        for (int i = 1; i <= 47; i++) list[i - 1] = String.format("QCF4_Hafs_%02d_W.woff2", i);
        list[47] = "QCF4_QBSML.woff2";
        return list;
    }

    private File qcfDir() {
        File d = new File(getFilesDir(), "qcf");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private int qcfCount() {
        int n = 0;
        for (String f : QCF_FILES) {
            File x = new File(qcfDir(), f);
            if (x.exists() && x.length() > 0) n++;
        }
        return n;
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                   // progress, notes and settings
        s.setAllowFileAccess(true);                     // bundled pages and the stored mushaf fonts
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);    // lessons from alisaboohi.com
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        setContentView(web);
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(APP_URL);
    }

    private void js(String code) {
        runOnUiThread(() -> web.evaluateJavascript(code, null));
    }

    /** Methods the page can call through window.Android. */
    class Bridge {
        @JavascriptInterface
        public boolean qcfReady() { return qcfCount() == QCF_FILES.length; }

        @JavascriptInterface
        public String qcfBase() { return Uri.fromFile(qcfDir()).toString() + "/"; }

        @JavascriptInterface
        public int qcfDone() { return qcfCount(); }

        @JavascriptInterface
        public void qcfStart() {
            if (downloading) return;
            downloading = true;
            new Thread(() -> {
                int total = QCF_FILES.length;
                try {
                    for (String name : QCF_FILES) {
                        File out = new File(qcfDir(), name);
                        if (!(out.exists() && out.length() > 0)) download(QCF_CDN + name, out);
                        js("window.__qcfProgress && __qcfProgress(" + qcfCount() + "," + total + ",'run')");
                    }
                    js("window.__qcfProgress && __qcfProgress(" + total + "," + total + ",'done')");
                } catch (Exception e) {
                    js("window.__qcfProgress && __qcfProgress(" + qcfCount() + "," + total + ",'error')");
                } finally {
                    downloading = false;
                }
            }).start();
        }

        /** Root of the app's private storage as a file:// URL, e.g. file:///data/user/0/…/files/ */
        @JavascriptInterface
        public String fileBase() { return Uri.fromFile(getFilesDir()).toString() + "/"; }

        /** Number of non-empty files inside a folder of app storage (e.g. "audio/Muhammad_Ayyoub_64kbps/002"). */
        @JavascriptInterface
        public int countFiles(String rel) {
            File[] fs = safe(rel).listFiles();
            int n = 0;
            if (fs != null) for (File f : fs) if (f.isFile() && f.length() > 0 && !f.getName().endsWith(".part")) n++;
            return n;
        }

        @JavascriptInterface
        public boolean exists(String rel) { File f = safe(rel); return f.exists() && f.length() > 0; }

        @JavascriptInterface
        public void deletePath(String rel) { deleteTree(safe(rel)); }

        @JavascriptInterface
        public void cancelJob(String id) { cancelled.set(id); }

        /**
         * Queue a download job. files = JSON array of {url, path}; paths are relative to app storage.
         * Progress goes back to the page as window.__dl(id, done, total, state) with state run|done|error|cancel.
         */
        @JavascriptInterface
        public void downloadList(String id, String filesJson) {
            jobs.submit(() -> {
                int done = 0, total = 0;
                try {
                    JSONArray arr = new JSONArray(filesJson);
                    total = arr.length();
                    js("window.__dl && __dl(" + JSONObject.quote(id) + ",0," + total + ",'run')");
                    for (int i = 0; i < arr.length(); i++) {
                        if (id.equals(cancelled.get())) {
                            js("window.__dl && __dl(" + JSONObject.quote(id) + "," + done + "," + total + ",'cancel')");
                            return;
                        }
                        JSONObject o = arr.getJSONObject(i);
                        File out = safe(o.getString("path"));
                        if (!(out.exists() && out.length() > 0)) {
                            out.getParentFile().mkdirs();
                            download(o.getString("url"), out);
                        }
                        done++;
                        if (done == total || done % 3 == 0)
                            js("window.__dl && __dl(" + JSONObject.quote(id) + "," + done + "," + total + ",'run')");
                    }
                    js("window.__dl && __dl(" + JSONObject.quote(id) + "," + total + "," + total + ",'done')");
                } catch (Exception e) {
                    js("window.__dl && __dl(" + JSONObject.quote(id) + "," + done + "," + total + ",'error')");
                }
            });
        }

        @JavascriptInterface
        public void qcfDelete() {
            for (String f : QCF_FILES) new File(qcfDir(), f).delete();
        }

        /** Hand a backup file to the share sheet (the user picks Google Drive). */
        @JavascriptInterface
        public void shareFile(String name, String content) {
            try {
                File dir = new File(getCacheDir(), "backups");
                dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("application/json");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_SUBJECT, name);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, "ذخیره پشتیبان در…")));
            } catch (Exception e) {
                js("toast('ساخت فایل پشتیبان ممکن نشد')");
            }
        }
    }

    /** A path inside app storage; refuses anything that would escape it. */
    private File safe(String rel) {
        File base = getFilesDir();
        File f = new File(base, rel);
        try {
            if (!f.getCanonicalPath().startsWith(base.getCanonicalPath())) return new File(base, "_invalid");
        } catch (Exception e) {
            return new File(base, "_invalid");
        }
        return f;
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    private static void download(String url, File out) throws Exception {
        File part = new File(out.getPath() + ".part");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(part)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
            }
            if (part.length() == 0 || !part.renameTo(out)) throw new Exception("write failed");
        } finally {
            c.disconnect();
            part.delete();
        }
    }

    /** Links that leave the app open outside it (browser, Aparat, Bazaar). */
    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            if (!req.isForMainFrame()) return false;
            return openOutside(req.getUrl().toString());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return openOutside(url);
        }
    }

    private boolean openOutside(String url) {
        if (url.startsWith("file:///android_asset/")) return false;
        try {
            if (url.startsWith("bazaar://")) {
                Intent rate = new Intent(Intent.ACTION_EDIT, Uri.parse(url));
                rate.setPackage("com.farsitel.bazaar");
                startActivity(rate);
            } else {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            }
        } catch (ActivityNotFoundException e) {
            if (url.startsWith("bazaar://")) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://cafebazaar.ir/app/" + getPackageName())));
                } catch (Exception ignored) { }
            }
        }
        return true;
    }

    class Chrome extends WebChromeClient {
        // File picker for restoring a backup (Google Drive appears in the system picker)
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(i, "انتخاب فایل پشتیبان"), PICK_FILE);
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        // Full-screen lesson videos
        @Override
        public void onShowCustomView(View view, CustomViewCallback cb) {
            fullscreenView = view;
            ((ViewGroup) getWindow().getDecorView()).addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        @Override
        public void onHideCustomView() {
            if (fullscreenView != null) {
                ((ViewGroup) getWindow().getDecorView()).removeView(fullscreenView);
                fullscreenView = null;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && fileCallback != null) {
            Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
            fileCallback.onReceiveValue(uri != null ? new Uri[]{uri} : null);
            fileCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (fullscreenView != null) { web.getWebChromeClient().onHideCustomView(); return; }
        web.evaluateJavascript("(window.__back && window.__back()) ? 'yes' : 'no'", result -> {
            if (!"\"yes\"".equals(result)) finish();
        });
    }
}
