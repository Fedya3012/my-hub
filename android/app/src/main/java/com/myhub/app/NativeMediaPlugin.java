package com.myhub.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.util.Base64;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

// Web side of MediaPlaybackService (see there). js/modules/music/lib/native.js sends the song, the play state
// and the Android Auto browse tree, and listens for "command" events (play, pause, next, prev, seek, playId, search).
@CapacitorPlugin(name = "NativeMedia")
public class NativeMediaPlugin extends Plugin {
  @Override
  public void load() {
    MediaPlaybackService.commands = (action, args) -> {
      JSObject o = new JSObject();
      o.put("action", action);
      if (args != null) for (String k : args.keySet()) o.put(k, args.get(k));
      notifyListeners("command", o, true);
    };
  }

  @PluginMethod
  public void ready(PluginCall call) {
    synchronized (MediaPlaybackService.pending) {
      for (Object[] c : MediaPlaybackService.pending) MediaPlaybackService.commands.onCommand((String) c[0], (Bundle) c[1]);
      MediaPlaybackService.pending.clear();
    }
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
      ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7302);
    call.resolve();
  }

  // { title, artist, album, duration (s), art: data URL or base64 (optional) }
  @PluginMethod
  public void setTrack(PluginCall call) {
    MediaMetadataCompat.Builder b = new MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, call.getString("id", ""))
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, call.getString("title", ""))
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, call.getString("artist", ""))
      .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, call.getString("album", ""))
      .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, call.getString("title", ""))
      .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, call.getString("artist", ""))
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (long) (call.getDouble("duration", 0d) * 1000));
    String art = call.getString("art", "");
    if (art != null && !art.isEmpty()) {
      try {
        int comma = art.indexOf(',');
        byte[] bytes = Base64.decode(comma >= 0 ? art.substring(comma + 1) : art, Base64.DEFAULT);
        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp != null) { b.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bmp); b.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, bmp); }
      } catch (Exception ignored) { }
    }
    MediaPlaybackService.metadata = b.build();
    MediaPlaybackService.update(getContext());
    call.resolve();
  }

  // { playing, position (s), rate }
  @PluginMethod
  public void setState(PluginCall call) {
    MediaPlaybackService.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
    MediaPlaybackService.position = (long) (call.getDouble("position", 0d) * 1000);
    MediaPlaybackService.rate = call.getFloat("rate", 1f);
    MediaPlaybackService.updatedAt = SystemClock.elapsedRealtime();
    MediaPlaybackService.update(getContext());
    call.resolve();
  }

  // { lines: [ { t (s), text, tr } ] } for the current song; [] when it has no synced lyrics. Shown on the widget.
  @PluginMethod
  public void setLyrics(PluginCall call) {
    org.json.JSONArray a = call.getArray("lines", new com.getcapacitor.JSArray());
    int n = a == null ? 0 : Math.min(a.length(), 600);
    long[] t = new long[n]; String[] x = new String[n], tr = new String[n];
    for (int i = 0; i < n; i++) {
      JSONObject l = a.optJSONObject(i);
      t[i] = l == null ? 0 : (long) (l.optDouble("t", 0) * 1000);
      x[i] = l == null ? "" : l.optString("text", "");
      tr[i] = l == null ? "" : l.optString("tr", "");
    }
    MusicWidgetProvider.setLyrics(t, x, tr);
    MusicWidgetProvider.refresh(getContext());
    call.resolve();
  }

  // { tree: { parentId: [ { id, title, subtitle, playable, browsable } ] } }
  @PluginMethod
  public void setTree(PluginCall call) {
    JSObject t = call.getObject("tree", new JSObject());
    MediaPlaybackService.tree = t == null ? new JSONObject() : t;
    MediaPlaybackService.treeChanged();
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    MediaPlaybackService.playing = false;
    if (MediaPlaybackService.instance != null) MediaPlaybackService.instance.stopSelf();
    call.resolve();
  }
}
