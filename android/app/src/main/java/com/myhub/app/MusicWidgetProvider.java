package com.myhub.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.widget.RemoteViews;
import androidx.media.session.MediaButtonReceiver;

// Home-screen widget for the Trình phát nhạc: song, cover, progress, previous / play-pause / next.
// It only draws the state MediaPlaybackService already holds; the buttons are the same media-button intents the
// notification uses, so they reach the web player through the service. Below ~110 dp of height it switches to a
// one-row layout (4×1); otherwise the 4×2 card is used.
public class MusicWidgetProvider extends AppWidgetProvider {
  private static MediaMetadataCompat artFor = null;   // the metadata whose cover is cached in `art`
  private static Bitmap art = null;

  @Override
  public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { for (int id : ids) draw(ctx, mgr, id); }

  @Override
  public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) { draw(ctx, mgr, id); }

  // Called by MediaPlaybackService whenever the song or the play state changes (and every few seconds while playing).
  static void refresh(Context ctx) {
    AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
    int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, MusicWidgetProvider.class));
    for (int id : ids) draw(ctx, mgr, id);
  }

  static boolean any(Context ctx) {
    return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, MusicWidgetProvider.class)).length > 0;
  }

  private static Bitmap cover() {
    MediaMetadataCompat m = MediaPlaybackService.metadata;
    if (m == null) return null;
    if (m != artFor) {
      artFor = m; art = null;
      Bitmap b = m.getBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART);
      if (b != null) {   // RemoteViews travel through a size-limited binder call, so keep the cover small
        int s = 192;
        art = Math.max(b.getWidth(), b.getHeight()) > s ? Bitmap.createScaledBitmap(b, s, s, true) : b;
      }
    }
    return art;
  }

  // The cover, softly blurred, behind the widget: scaled down to a few pixels and back up (bilinear), which
  // costs nothing and stays tiny for the binder call.
  private static MediaMetadataCompat blurFor;
  private static Bitmap blur;
  private static Bitmap blurred() {
    Bitmap c = cover();
    if (c == null) return null;
    if (blurFor != artFor || blur == null) {
      blurFor = artFor;
      Bitmap small = Bitmap.createScaledBitmap(c, 12, 12, true);
      blur = Bitmap.createScaledBitmap(small, 96, 96, true);
    }
    return blur;
  }

  private static void draw(Context ctx, AppWidgetManager mgr, int id) {
    Bundle o = mgr.getAppWidgetOptions(id);
    boolean compact = o != null && o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 140) < 110;
    RemoteViews v = new RemoteViews(ctx.getPackageName(), compact ? R.layout.music_widget_compact : R.layout.music_widget);

    MediaMetadataCompat m = MediaPlaybackService.metadata;
    MediaDescriptionCompat d = m != null ? m.getDescription() : null;
    v.setTextViewText(R.id.mw_title, d != null && d.getTitle() != null ? d.getTitle() : "Trình phát nhạc");
    v.setTextViewText(R.id.mw_artist, d != null && d.getSubtitle() != null ? d.getSubtitle() : "Chưa phát nhạc");
    Bitmap cover = cover();
    if (cover != null) v.setImageViewBitmap(R.id.mw_art, cover); else v.setImageViewResource(R.id.mw_art, R.mipmap.ic_launcher);
    Bitmap bg = blurred();
    if (bg != null) v.setImageViewBitmap(R.id.mw_bg, bg); else v.setImageViewBitmap(R.id.mw_bg, null);

    long dur = m != null ? m.getLong(MediaMetadataCompat.METADATA_KEY_DURATION) : 0;
    long pos = MediaPlaybackService.position;
    if (MediaPlaybackService.playing) pos += (long) ((SystemClock.elapsedRealtime() - MediaPlaybackService.updatedAt) * MediaPlaybackService.rate);
    v.setProgressBar(R.id.mw_progress, 1000, dur > 0 ? (int) Math.min(1000, pos * 1000 / dur) : 0, false);
    v.setImageViewResource(R.id.mw_play, MediaPlaybackService.playing ? R.drawable.ic_w_pause : R.drawable.ic_w_play);

    v.setOnClickPendingIntent(R.id.mw_prev, MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS));
    v.setOnClickPendingIntent(R.id.mw_play, MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, PlaybackStateCompat.ACTION_PLAY_PAUSE));
    v.setOnClickPendingIntent(R.id.mw_next, MediaButtonReceiver.buildMediaButtonPendingIntent(ctx, PlaybackStateCompat.ACTION_SKIP_TO_NEXT));
    Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent openPi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    v.setOnClickPendingIntent(R.id.mw_root, openPi);
    v.setOnClickPendingIntent(R.id.mw_art, openPi);
    mgr.updateAppWidget(id, v);
  }
}
