package com.myhub.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

// In-app update of the Android app: downloads the release APK from GitHub (resuming after a drop, retrying,
// reporting progress as "progress" events) and hands it to the system installer. Obtainium stays a fallback.
@CapacitorPlugin(name = "ApkUpdate")
public class ApkUpdatePlugin extends Plugin {
  private static final int TRIES = 8, BUF = 256 * 1024;
  private final AtomicBoolean cancelled = new AtomicBoolean();
  private volatile boolean running;

  private File dir() { File d = new File(getContext().getCacheDir(), "updates"); d.mkdirs(); return d; }

  // download { url, name } → { path, size }. Keeps "<name>.part" so a retry (or a later call) continues where it stopped.
  @PluginMethod public void download(PluginCall call) {
    String url = call.getString("url"), name = call.getString("name", "update.apk");
    if (url == null || !name.matches("[\\w.-]+\\.apk")) { call.reject("Địa chỉ tệp cập nhật không hợp lệ"); return; }
    if (running) { call.reject("Đang tải bản cập nhật rồi"); return; }
    running = true; cancelled.set(false);
    new Thread(() -> {
      try {
        File d = dir();
        File[] old = d.listFiles();
        if (old != null) for (File f : old) if (!f.getName().equals(name) && !f.getName().equals(name + ".part")) f.delete();
        File done = new File(d, name), part = new File(d, name + ".part");
        done.delete();
        long total = fetch(url, part);
        if (!part.renameTo(done)) throw new IOException("Không lưu được tệp cập nhật");
        JSObject r = new JSObject(); r.put("path", done.getAbsolutePath()); r.put("size", total);
        call.resolve(r);
      } catch (Exception e) {
        call.reject(cancelled.get() ? "CANCELLED" : String.valueOf(e.getMessage()));
      } finally { running = false; }
    }, "apk-download").start();
  }

  private long fetch(String url, File part) throws IOException {
    IOException last = null;
    long total = -1;
    for (int attempt = 0; attempt < TRIES; attempt++) {
      if (cancelled.get()) throw new IOException("CANCELLED");
      HttpURLConnection c = null;
      try {
        long have = part.exists() ? part.length() : 0;
        c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(20000);
        c.setRequestProperty("Accept-Encoding", "identity");   // a gzip'd body would make resume offsets wrong
        if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
        int code = c.getResponseCode();
        if (code == 416 && have > 0) {   // the part is already complete (or stale): start over once
          part.delete(); continue;
        }
        if (code != 200 && code != 206) throw new IOException("Máy chủ trả về mã " + code);
        boolean resumed = code == 206;
        if (!resumed) have = 0;   // server ignored Range: the whole file comes again
        long len = c.getContentLengthLong();
        total = len > 0 ? have + len : -1;
        try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part, resumed)) {
          byte[] buf = new byte[BUF];
          long got = have, lastEmit = 0;
          int n;
          while ((n = in.read(buf)) > 0) {
            if (cancelled.get()) throw new IOException("CANCELLED");
            out.write(buf, 0, n); got += n;
            long t = System.currentTimeMillis();
            if (t - lastEmit > 250) { lastEmit = t; emit(got, total, attempt); }
          }
          out.getFD().sync();
        }
        if (total > 0 && part.length() != total) throw new IOException("Tệp tải về bị thiếu dữ liệu");
        emit(part.length(), total, attempt);
        return part.length();
      } catch (IOException e) {
        if (cancelled.get()) throw e;
        last = e;
        try { Thread.sleep(Math.min(8000, 1000L << Math.min(attempt, 3))); } catch (InterruptedException ie) { throw new IOException("CANCELLED"); }
      } finally { if (c != null) c.disconnect(); }
    }
    throw new IOException("Tải thất bại sau " + TRIES + " lần thử: " + (last == null ? "" : last.getMessage()));
  }

  private void emit(long done, long total, int attempt) {
    JSObject o = new JSObject(); o.put("done", done); o.put("total", total); o.put("retry", attempt);
    notifyListeners("progress", o);
  }

  @PluginMethod public void cancel(PluginCall call) { cancelled.set(true); call.resolve(); }

  // install { path } → opens the system installer. First time Android asks to allow installs from this app.
  @PluginMethod public void install(PluginCall call) {
    File f = new File(call.getString("path", ""));
    if (!f.exists() || !f.getAbsolutePath().startsWith(dir().getAbsolutePath())) { call.reject("Không thấy tệp cập nhật"); return; }
    if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
      Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
      s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(s);
      call.reject("NEED_PERMISSION");
      return;
    }
    try {
      Uri u = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
      Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
      call.resolve();
    } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
  }
}
