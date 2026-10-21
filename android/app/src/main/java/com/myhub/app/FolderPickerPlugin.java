package com.myhub.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.regex.Pattern;

// Android WebView has no folder picker, so this uses the system "open folder" screen (SAF),
// lists the music files inside, and copies them one at a time into the cache for the web side to import.
@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {
  private static final Pattern WANTED = Pattern.compile(
    "(?i).*\\.(mp3|flac|m4a|m4b|mp4|aac|alac|ogg|oga|opus|wav|wave|aif|aiff|aifc|wv|ape|dsf|dff|wma|lrc|ttml|srt|jpe?g|png|webp|m4v|webm|mov)$");
  private int seq = 0;

  @PluginMethod
  public void pickFolder(PluginCall call) {
    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(call, i, "onPicked");
  }

  @ActivityCallback
  private void onPicked(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
      JSObject r = new JSObject();
      r.put("cancelled", true);
      call.resolve(r);
      return;
    }
    final Uri tree = result.getData().getData();
    getBridge().execute(() -> {
      try {
        JSArray files = new JSArray();
        String rootId = DocumentsContract.getTreeDocumentId(tree);
        walk(tree, rootId, "", files);
        JSObject r = new JSObject();
        r.put("files", files);
        call.resolve(r);
      } catch (Exception e) {
        call.reject(e.getMessage() == null ? "Không đọc được thư mục" : e.getMessage());
      }
    });
  }

  private void walk(Uri tree, String docId, String prefix, JSArray out) {
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
    String[] cols = {
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE
    };
    try (Cursor c = getContext().getContentResolver().query(children, cols, null, null, null)) {
      if (c == null) return;
      while (c.moveToNext()) {
        String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
        if (name == null) continue;
        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
          walk(tree, id, prefix + name + "/", out);
        } else if (WANTED.matcher(name).matches()) {
          JSObject f = new JSObject();
          f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
          f.put("name", name);
          f.put("relPath", prefix + name);
          f.put("size", c.isNull(3) ? 0 : c.getLong(3));
          out.put(f);
        }
      }
    }
  }

  @PluginMethod
  public void copyToCache(PluginCall call) {
    final String uri = call.getString("uri");
    final String name = call.getString("name", "file");
    if (uri == null) { call.reject("Thiếu uri"); return; }
    getBridge().execute(() -> {
      try {
        File dir = new File(getContext().getCacheDir(), "folderimport");
        dir.mkdirs();
        File dest = new File(dir, (++seq) + "_" + name.replaceAll("[^A-Za-z0-9._-]", "_"));
        try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri));
             OutputStream out = new FileOutputStream(dest)) {
          if (in == null) throw new Exception("Không mở được tệp");
          byte[] buf = new byte[1 << 16];
          int n;
          while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        JSObject r = new JSObject();
        r.put("path", dest.getAbsolutePath());
        call.resolve(r);
      } catch (Exception e) {
        call.reject(e.getMessage() == null ? "Không sao chép được tệp" : e.getMessage());
      }
    });
  }

  // "Chỉ trên máy này": pick a folder once, keep read permission across restarts, then list its music/book files
  // without copying them. Playback and import read each file straight from its content:// uri.
  @PluginMethod
  public void pickRoot(PluginCall call) {
    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(call, i, "onRootPicked");
  }

  @ActivityCallback
  private void onRootPicked(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
      JSObject r = new JSObject();
      r.put("cancelled", true);
      call.resolve(r);
      return;
    }
    Uri tree = result.getData().getData();
    try {
      getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
    } catch (SecurityException e) {
      call.reject("Không giữ được quyền đọc thư mục này");
      return;
    }
    JSObject r = new JSObject();
    r.put("treeUri", tree.toString());
    call.resolve(r);
  }

  @PluginMethod
  public void listTree(PluginCall call) {
    final String treeStr = call.getString("treeUri");
    if (treeStr == null) { call.reject("Thiếu treeUri"); return; }
    getBridge().execute(() -> {
      try {
        Uri tree = Uri.parse(treeStr);
        JSArray files = new JSArray();
        walk(tree, DocumentsContract.getTreeDocumentId(tree), "", files);
        JSObject r = new JSObject();
        r.put("files", files);
        call.resolve(r);
      } catch (Exception e) {
        call.reject(e.getMessage() == null ? "Không đọc được thư mục" : e.getMessage());
      }
    });
  }

  @PluginMethod
  public void releaseRoot(PluginCall call) {
    final String treeStr = call.getString("treeUri");
    if (treeStr == null) { call.resolve(); return; }
    try {
      getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(treeStr), Intent.FLAG_GRANT_READ_URI_PERMISSION);
    } catch (Exception ignored) { }
    call.resolve();
  }

  @PluginMethod
  public void clearCache(PluginCall call) {
    File dir = new File(getContext().getCacheDir(), "folderimport");
    File[] list = dir.listFiles();
    if (list != null) for (File f : list) f.delete();
    call.resolve();
  }
}
