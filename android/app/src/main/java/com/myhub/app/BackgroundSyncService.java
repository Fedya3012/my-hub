package com.myhub.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

// Keeps My Hub alive (and on the network) while a folder sync imports in the background: a foreground service
// with a progress notification, a partial wake lock and a Wi-Fi lock. Started and stopped by BackgroundSyncPlugin.
public class BackgroundSyncService extends Service {
  static final String CHANNEL = "hub-sync";
  static final int NOTE_ID = 7302;
  private PowerManager.WakeLock wake;
  private WifiManager.WifiLock wifi;

  @Override public IBinder onBind(Intent i) { return null; }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    String title = intent != null && intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "Đang đồng bộ thư mục";
    String text = intent != null && intent.getStringExtra("text") != null ? intent.getStringExtra("text") : "";
    int done = intent != null ? intent.getIntExtra("done", 0) : 0, total = intent != null ? intent.getIntExtra("total", 0) : 0;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
      nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Đồng bộ thư mục", NotificationManager.IMPORTANCE_LOW));
    Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle(title).setContentText(text)
      .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(pi).setProgress(total, done, total <= 0);
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    else startForeground(NOTE_ID, b.build());
    if (wake == null) {
      wake = ((PowerManager) getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "myhub:sync");
      wake.acquire(6 * 60 * 60 * 1000L);   // never longer than 6 h, whatever happens to the page
    }
    if (wifi == null) {
      WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
      if (wm != null) { wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "myhub:sync"); wifi.acquire(); }
    }
    return START_NOT_STICKY;
  }

  @Override public void onDestroy() {
    if (wake != null && wake.isHeld()) wake.release();
    if (wifi != null && wifi.isHeld()) wifi.release();
    wake = null; wifi = null;
    super.onDestroy();
  }
}
