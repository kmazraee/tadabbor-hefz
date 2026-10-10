package ir.tadabbor.hefz;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.PermissionRequest;
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
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

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
    /** Up to three download jobs at once, so a long one (a lesson video) never holds the recitations back. */
    private final ExecutorService jobs = Executors.newFixedThreadPool(3);
    private final Set<String> cancelled = Collections.newSetFromMap(new ConcurrentHashMap<>());
    // cancelAll() bumps this; jobs queued before the bump stop at their next file
    private final AtomicInteger generation = new AtomicInteger();

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

    @Override
    protected void onResume() {
        super.onResume();
        // back from "allow installs from this app": continue the update that was waiting for it
        if (pendingApk != null && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            File f = pendingApk; pendingApk = null; openInstaller(f);
        }
    }

    private volatile File pendingApk = null;
    private final AtomicInteger updGen = new AtomicInteger();

    /** Hand the downloaded APK to Android's installer (asks once for "install unknown apps" on Android 8+). */
    private void openInstaller(File apk) {
        runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                    pendingApk = apk;
                    js("window.__upd && __upd('perm',0,0,'')");
                    startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                    return;
                }
                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                js("window.__upd && __upd('install',0,0,'')");
            } catch (Exception e) {
                js("window.__upd && __upd('error',0,0," + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
            }
        });
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
                        if (!(out.exists() && out.length() > 0)) download(QCF_CDN + name, out, null);
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

        /** Download a new version of the app inside the app (with progress), then open the installer. */
        @JavascriptInterface
        public void downloadUpdate(String url, String name) {
            final int gen = updGen.incrementAndGet();
            new Thread(() -> {
                File dir = new File(getCacheDir(), "update");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) if (!f.getName().equals(name)) f.delete();
                dir.mkdirs();
                File out = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
                try {
                    if (!(out.exists() && out.length() > 0)) {
                        final long[] last = {0};
                        downloadRetry(url, out, (got, size) -> {
                            if (gen != updGen.get()) throw new RuntimeException("cancelled");
                            long now = System.currentTimeMillis();
                            if (now - last[0] < 300) return;
                            last[0] = now;
                            js("window.__upd && __upd('run'," + got + "," + size + ",'')");
                        });
                    }
                    if (gen != updGen.get()) return;
                    js("window.__upd && __upd('done'," + out.length() + "," + out.length() + ",'')");
                    openInstaller(out);
                } catch (Exception e) {
                    out.delete();
                    if (gen == updGen.get()) js("window.__upd && __upd('error',0,0," + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
                }
            }).start();
        }

        @JavascriptInterface
        public void cancelUpdate() { updGen.incrementAndGet(); }

        /** Recitations on the phone: {reciter: {s: {surah folder: file count}, b: bytes}} for the reciters list. */
        @JavascriptInterface
        public String audioSummary() {
            JSONObject o = new JSONObject();
            try {
                File[] rs = safe("audio").listFiles();
                if (rs != null) for (File r : rs) {
                    if (!r.isDirectory()) continue;
                    if (r.getName().equals("translations")) {
                        File[] ts = r.listFiles();
                        if (ts != null) for (File t : ts) if (t.isDirectory()) o.put("translations/" + t.getName(), reciterJson(t));
                    } else o.put(r.getName(), reciterJson(r));
                }
            } catch (Exception e) { /* return what we have */ }
            return o.toString();
        }

        /** Where downloads live and how much each folder takes, for the downloads page. */
        @JavascriptInterface
        public String storageInfo() {
            JSONObject o = new JSONObject();
            try {
                File base = getFilesDir();
                o.put("base", base.getAbsolutePath());
                JSONObject sz = new JSONObject();
                File[] fs = base.listFiles();
                if (fs != null) for (File f : fs) sz.put(f.getName(), sizeOf(f));
                o.put("sizes", sz);
                o.put("free", base.getUsableSpace());
                o.put("backup", Build.VERSION.SDK_INT >= 29 ? Environment.DIRECTORY_DOWNLOADS + "/HefzTadabbori"
                        : "Android/data/" + getPackageName() + "/files/backups");
            } catch (Exception e) { /* return what we have */ }
            return o.toString();
        }

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
        public void cancelJob(String id) { cancelled.add(id); }

        @JavascriptInterface
        public void cancelAll() { generation.incrementAndGet(); }

        /**
         * Queue a download job. files = JSON array of {url, path}; paths are relative to app storage.
         * Progress goes back to the page as window.__dl(id, done, total, state) with state run|done|error|cancel.
         */
        @JavascriptInterface
        public void downloadList(String id, String filesJson) {
            cancelled.remove(id);
            final int gen = generation.get();
            final String qid = JSONObject.quote(id);
            js("window.__dl && __dl(" + qid + ",0,0,'queued')");
            jobs.submit(() -> {
                int done = 0, total = 0, failed = 0, streak = 0;
                String reason = "";
                try {
                    JSONArray arr = new JSONArray(filesJson);
                    total = arr.length();
                    js("window.__dl && __dl(" + qid + ",0," + total + ",'run')");
                    for (int i = 0; i < arr.length(); i++) {
                        if (cancelled.remove(id) || gen != generation.get()) {
                            js("window.__dl && __dl(" + qid + "," + done + "," + total + ",'cancel')");
                            return;
                        }
                        JSONObject o = arr.getJSONObject(i);
                        File out = safe(o.getString("path"));
                        if (!(out.exists() && out.length() > 0)) {
                            out.getParentFile().mkdirs();
                            try {
                                final long[] last = {0};
                                downloadRetry(o.getString("url"), out, (got, size) -> {
                                    long now = System.currentTimeMillis();
                                    if (now - last[0] < 700) return;
                                    last[0] = now;
                                    js("window.__dlb && __dlb(" + qid + "," + got + "," + size + ")");
                                });
                                streak = 0;
                            } catch (Exception e) {
                                failed++; streak++;
                                reason = String.valueOf(e.getMessage());
                                // nothing gets through (network down or site blocked): stop instead of failing every file
                                if ((streak >= 4 && failed == done + 1) || streak >= 8) { done++; break; }
                            }
                        }
                        done++;
                        if (done == total || done % 3 == 0)
                            js("window.__dl && __dl(" + qid + "," + (done - failed) + "," + total + ",'run')");
                    }
                    if (failed == 0 && done == total) js("window.__dl && __dl(" + qid + "," + total + "," + total + ",'done')");
                    else js("window.__dl && __dl(" + qid + "," + (done - failed) + "," + total + ",'error'," + JSONObject.quote(reason) + ")");
                } catch (Exception e) {
                    js("window.__dl && __dl(" + qid + "," + (done - failed) + "," + total + ",'error'," + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
                }
            });
        }

        @JavascriptInterface
        public void qcfDelete() {
            for (String f : QCF_FILES) new File(qcfDir(), f).delete();
        }

        /** Daily reminder at hour:minute; asks for the notification permission on Android 13+. */
        @JavascriptInterface
        public void setReminder(boolean on, int hour, int minute, String title, String text) {
            if (on && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 51));
            Reminder.save(MainActivity.this, on, hour, minute, title, text);
        }

        /** Fill the home-screen widget. */
        @JavascriptInterface
        public void setWidget(String title, String line, String verse, String meaning) { Widget.save(MainActivity.this, title, line, verse, meaning); }

        /** Daily automatic backup into Downloads/HefzTadabbori (overwritten each day). Returns where it went, or "". */
        @JavascriptInterface
        public String autoBackup(String name, String content) {
            byte[] data = content.getBytes(StandardCharsets.UTF_8);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = getContentResolver();
                    String dir = Environment.DIRECTORY_DOWNLOADS + "/HefzTadabbori/";
                    Uri uri = null;
                    try (Cursor c = cr.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, new String[]{MediaStore.MediaColumns._ID},
                            MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?", new String[]{name, dir}, null)) {
                        if (c != null && c.moveToFirst()) uri = Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, String.valueOf(c.getLong(0)));
                    }
                    if (uri == null) {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                        v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                        v.put(MediaStore.MediaColumns.RELATIVE_PATH, dir);
                        uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    }
                    if (uri == null) return "";
                    try (OutputStream o = cr.openOutputStream(uri, "wt")) { o.write(data); }
                    return "Download/HefzTadabbori/" + name;
                }
                File d = new File(getExternalFilesDir(null), "backups");
                d.mkdirs();
                try (FileOutputStream o = new FileOutputStream(new File(d, name))) { o.write(data); }
                return "Android/data/" + getPackageName() + "/files/backups/" + name;
            } catch (Exception e) {
                return "";
            }
        }

        /** Share plain text (a verse with its translation) through the share sheet. */
        @JavascriptInterface
        public void shareText(String text) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(send, "اشتراک آیه")));
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
    private static JSONObject reciterJson(File r) throws Exception {
        JSONObject j = new JSONObject(), c = new JSONObject();
        long bytes = 0;
        File[] ss = r.listFiles();
        if (ss != null) for (File s : ss) {
            if (!s.isDirectory()) continue;
            int n = 0;
            File[] fs = s.listFiles();
            if (fs != null) for (File f : fs) if (f.isFile() && f.length() > 0 && !f.getName().endsWith(".part")) { n++; bytes += f.length(); }
            if (n > 0) c.put(s.getName(), n);
        }
        j.put("s", c);
        j.put("b", bytes);
        return j;
    }

    private static long sizeOf(File f) {
        if (f.isFile()) return f.length();
        long n = 0;
        File[] c = f.listFiles();
        if (c != null) for (File x : c) n += sizeOf(x);
        return n;
    }

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

    /** Bytes received so far for the file being downloaded (size is -1 when the server does not say). */
    interface Progress { void on(long got, long size); }

    /** Three tries per file, with a short pause between them (mobile networks drop often). */
    private static void downloadRetry(String url, File out, Progress p) throws Exception {
        Exception last = null;
        for (int t = 0; t < 3; t++) {
            try { download(url, out, p); return; }
            catch (Exception e) {
                last = e;
                if (e.getMessage() != null && (e.getMessage().startsWith("HTTP 404") || e.getMessage().equals("cancelled"))) break;
                try { Thread.sleep(t == 0 ? 1500 : 4000); } catch (InterruptedException ie) { break; }
            }
        }
        throw last;
    }

    private static void download(String url, File out, Progress p) throws Exception {
        File part = new File(out.getPath() + ".part");
        HttpURLConnection c = null;
        // follow redirects by hand, including http <-> https, which HttpURLConnection will not do
        for (int hop = 0; ; hop++) {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + ") HefzTadabbori");
            c.setRequestProperty("Accept", "*/*");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && hop < 5) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("HTTP " + code);
                url = new URL(new URL(url), loc).toString();
                continue;
            }
            break;
        }
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            long size = c.getContentLength(), got = 0;
            try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(part)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) { o.write(buf, 0, n); got += n; if (p != null) p.on(got, size); }
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

    private PermissionRequest pendingMic;

    class Chrome extends WebChromeClient {
        // Microphone for recording your own recitation
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                boolean audio = false;
                for (String r : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                if (!audio) { request.deny(); return; }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingMic = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 52);
                }
            });
        }

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
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == 52 && pendingMic != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else { pendingMic.deny(); js("toast('برای ضبط صدا، اجازه میکروفون لازم است')"); }
            pendingMic = null;
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
