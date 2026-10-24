package com.myhub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import androidx.media.MediaSessionManager;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.session.MediaButtonReceiver;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// Background playback, lock screen / notification controls and Android Auto for the Trình phát nhạc.
// The music itself still plays in the WebView; this service mirrors it in a MediaSession (what Android Auto,
// Bluetooth, watches and the lock screen talk to), keeps the app alive as a media foreground service while
// playing, and passes every command back to the web player through NativeMediaPlugin.
// The browse tree for Android Auto (Đang phát, Danh sách phát, Album, Nghệ sĩ…) is built on the web side and
// handed over as JSON: { parentId: [ { id, title, subtitle, playable, browsable } ] }.
public class MediaPlaybackService extends MediaBrowserServiceCompat {
  static final String ROOT = "root";
  private static final String CHANNEL = "playback";
  private static final int NOTE_ID = 7301;

  // Last state from the web side (kept across service restarts within the process).
  static MediaMetadataCompat metadata = null;
  static boolean playing = false;
  static long position = 0, updatedAt = 0;
  static float rate = 1f;
  static JSONObject tree = new JSONObject();
  static MediaPlaybackService instance = null;

  interface Commands { void onCommand(String action, Bundle args); }
  static Commands commands = null;
  static final List<Object[]> pending = new ArrayList<>();   // commands that arrived before the web side was ready

  private MediaSessionCompat session;
  private boolean foreground = false;
  private final android.os.Handler tick = new android.os.Handler(android.os.Looper.getMainLooper());
  // While a song plays the home-screen widget's progress bar is redrawn every few seconds.
  private final Runnable widgetTick = new Runnable() {
    @Override public void run() {
      if (!playing || !MusicWidgetProvider.any(MediaPlaybackService.this)) return;
      MusicWidgetProvider.refresh(MediaPlaybackService.this);
      tick.postDelayed(this, 4000);
    }
  };

  static void send(String action, Bundle args) {
    if (commands != null) commands.onCommand(action, args);
    else synchronized (pending) { pending.add(new Object[] { action, args }); }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    instance = this;
    session = new MediaSessionCompat(this, "MyHubMusic");
    Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    session.setCallback(new MediaSessionCompat.Callback() {
      @Override public void onPlay() { send("play", null); }
      @Override public void onPause() { send("pause", null); }
      @Override public void onStop() { send("pause", null); }
      @Override public void onSkipToNext() { send("next", null); }
      @Override public void onSkipToPrevious() { send("prev", null); }
      @Override public void onSeekTo(long pos) { Bundle b = new Bundle(); b.putDouble("position", pos / 1000.0); send("seek", b); }
      @Override public void onPlayFromMediaId(String mediaId, Bundle extras) { Bundle b = new Bundle(); b.putString("mediaId", mediaId); send("playId", b); }
      @Override public void onPlayFromSearch(String query, Bundle extras) { Bundle b = new Bundle(); b.putString("query", query == null ? "" : query); send("search", b); }
    });
    setSessionToken(session.getSessionToken());
    session.setActive(true);
    apply();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    MediaButtonReceiver.handleIntent(session, intent);
    apply();
    return START_NOT_STICKY;
  }

  @Override
  public void onDestroy() {
    instance = null;
    tick.removeCallbacks(widgetTick);
    session.setActive(false);
    session.release();
    super.onDestroy();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    if (!playing) stopSelf();
    super.onTaskRemoved(rootIntent);
  }

  // ── State from the web side ──────────────────────────────────
  static void update(Context ctx) {
    if (instance != null) { instance.apply(); return; }
    if (!playing) return;
    Intent i = new Intent(ctx, MediaPlaybackService.class);
    ContextCompat.startForegroundService(ctx, i);
  }

  static void treeChanged() {
    if (instance == null) return;
    for (java.util.Iterator<String> it = tree.keys(); it.hasNext(); ) instance.notifyChildrenChanged(it.next());
  }

  private void apply() {
    if (metadata != null) session.setMetadata(metadata);
    long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
      | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO
      | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH | PlaybackStateCompat.ACTION_STOP;
    session.setPlaybackState(new PlaybackStateCompat.Builder()
      .setActions(actions)
      .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, position, playing ? rate : 0f, updatedAt)
      .build());
    MusicWidgetProvider.refresh(this);
    tick.removeCallbacks(widgetTick);
    if (playing) tick.postDelayed(widgetTick, 4000);
    Notification n = buildNotification();
    if (playing) {
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
      else startForeground(NOTE_ID, n);
      foreground = true;
    } else {
      if (foreground) { stopForeground(false); foreground = false; }
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      if (metadata != null) nm.notify(NOTE_ID, n);
    }
  }

  private Notification buildNotification() {
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      NotificationChannel ch = new NotificationChannel(CHANNEL, "Trình phát nhạc", NotificationManager.IMPORTANCE_LOW);
      ch.setShowBadge(false);
      nm.createNotificationChannel(ch);
    }
    MediaDescriptionCompat d = metadata != null ? metadata.getDescription() : null;
    Bitmap art = metadata != null ? metadata.getBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART) : null;
    NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(d != null ? d.getTitle() : "Trình phát nhạc")
      .setContentText(d != null ? d.getSubtitle() : "")
      .setLargeIcon(art)
      .setContentIntent(session.getController().getSessionActivity())
      .setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .addAction(android.R.drawable.ic_media_previous, "Bài trước", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
      .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Tạm dừng" : "Phát",
        MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY_PAUSE))
      .addAction(android.R.drawable.ic_media_next, "Bài sau", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
      .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
        .setMediaSession(session.getSessionToken())
        .setShowActionsInCompactView(0, 1, 2));
    return b.build();
  }

  // ── Android Auto browsing ────────────────────────────────────
  @Nullable
  @Override
  public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
    if (!trusted(clientPackageName, clientUid)) return null;   // the service is exported: only Android Auto, the system and this app may browse
    Bundle extras = new Bundle();
    extras.putBoolean("android.media.browse.SEARCH_SUPPORTED", true);
    extras.putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", 2);   // grid
    extras.putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1);    // list
    return new BrowserRoot(ROOT, extras);
  }

  // Callers allowed to browse the library and send commands: this app, the system, Android Auto, the Google
  // Assistant, System UI, or any app the system itself grants media control (MEDIA_CONTENT_CONTROL).
  private static final String[] TRUSTED = {
    "com.google.android.projection.gearhead", "com.google.android.googlequicksearchbox", "com.android.systemui",
    "com.google.android.autosimulator", "com.google.android.carassistant", "com.android.bluetooth", "com.google.android.wearable.app",
  };
  private boolean trusted(String pkg, int uid) {
    if (uid == Process.myUid() || uid == Process.SYSTEM_UID || uid == 0) return true;
    String[] owned = getPackageManager().getPackagesForUid(uid);
    boolean ownsPkg = false;
    if (owned != null) for (String o : owned) if (o.equals(pkg)) ownsPkg = true;
    if (!ownsPkg) return false;   // a caller cannot claim another app's package name
    for (String t : TRUSTED) if (t.equals(pkg)) return true;
    return getPackageManager().checkPermission("android.permission.MEDIA_CONTENT_CONTROL", pkg) == android.content.pm.PackageManager.PERMISSION_GRANTED;
  }
  private boolean callerOk() {
    MediaSessionManager.RemoteUserInfo c = getCurrentBrowserInfo();
    return c != null && trusted(c.getPackageName(), c.getUid());
  }

  @Override
  public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
    List<MediaBrowserCompat.MediaItem> out = new ArrayList<>();
    if (!callerOk()) { result.sendResult(out); return; }
    JSONArray list = tree.optJSONArray(parentId);
    if (list != null) for (int i = 0; i < list.length(); i++) {
      JSONObject o = list.optJSONObject(i);
      if (o == null) continue;
      MediaDescriptionCompat.Builder db = new MediaDescriptionCompat.Builder()
        .setMediaId(o.optString("id"))
        .setTitle(o.optString("title"))
        .setSubtitle(o.optString("subtitle", ""));
      String icon = o.optString("icon", "");
      if (!icon.isEmpty()) db.setIconUri(Uri.parse(icon));
      int flags = (o.optBoolean("browsable") ? MediaBrowserCompat.MediaItem.FLAG_BROWSABLE : 0)
        | (o.optBoolean("playable") ? MediaBrowserCompat.MediaItem.FLAG_PLAYABLE : 0);
      out.add(new MediaBrowserCompat.MediaItem(db.build(), flags == 0 ? MediaBrowserCompat.MediaItem.FLAG_PLAYABLE : flags));
    }
    result.sendResult(out);
  }

  @Override
  public void onSearch(@NonNull String query, Bundle extras, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
    List<MediaBrowserCompat.MediaItem> out = new ArrayList<>();
    if (!callerOk()) { result.sendResult(out); return; }
    String q = query.toLowerCase();
    JSONArray all = tree.optJSONArray("tracks");
    if (all != null) for (int i = 0; i < all.length() && out.size() < 50; i++) {
      JSONObject o = all.optJSONObject(i);
      if (o == null) continue;
      String hay = (o.optString("title") + " " + o.optString("subtitle")).toLowerCase();
      if (!hay.contains(q)) continue;
      out.add(new MediaBrowserCompat.MediaItem(new MediaDescriptionCompat.Builder().setMediaId(o.optString("id"))
        .setTitle(o.optString("title")).setSubtitle(o.optString("subtitle", "")).build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
    }
    result.sendResult(out);
  }
}
