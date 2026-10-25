package com.myhub.app;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Folder sync in the background: start/update/stop the BackgroundSyncService, and tell the page whether the
// device is on Wi-Fi (or another unmetered network), where importing in the background is allowed.
@CapacitorPlugin(name = "BackgroundSync")
public class BackgroundSyncPlugin extends Plugin {
  @PluginMethod public void onWifi(PluginCall call) {
    ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    NetworkCapabilities c = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
    boolean wifi = c != null && (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
      || c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
    JSObject r = new JSObject(); r.put("wifi", wifi); call.resolve(r);
  }

  @PluginMethod public void start(PluginCall call) { send(call); }
  @PluginMethod public void update(PluginCall call) { send(call); }

  @PluginMethod public void stop(PluginCall call) {
    getContext().stopService(new Intent(getContext(), BackgroundSyncService.class));
    call.resolve();
  }

  private void send(PluginCall call) {
    Intent i = new Intent(getContext(), BackgroundSyncService.class);
    i.putExtra("title", call.getString("title", "Đang đồng bộ thư mục"));
    i.putExtra("text", call.getString("text", ""));
    i.putExtra("done", call.getInt("done", 0));
    i.putExtra("total", call.getInt("total", 0));
    try { ContextCompat.startForegroundService(getContext(), i); call.resolve(); }
    catch (Exception e) { call.reject(e.getMessage()); }   // Android 12+: not allowed to start from the background
  }
}
