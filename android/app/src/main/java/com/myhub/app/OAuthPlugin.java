package com.myhub.app;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Google sign-in on Android: Google refuses to sign in inside a WebView, so the sign-in page opens in the system
// browser; it ends on oauth-google.html (GitHub Pages), which sends the browser back to com.myhub.app://oauth?code=…
// MainActivity hands that address here and the page gets it as the "result" event.
@CapacitorPlugin(name = "OAuth")
public class OAuthPlugin extends Plugin {
  @PluginMethod
  public void open(PluginCall call) {
    String url = call.getString("url");
    if (url == null || !url.startsWith("https://accounts.google.com/")) { call.reject("Địa chỉ không hợp lệ"); return; }
    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getActivity().startActivity(i);
    call.resolve();
  }

  static void deliver(OAuthPlugin plugin, String url) {
    if (plugin == null) return;   // app not ready: the sign-in is simply started again
    JSObject r = new JSObject();
    r.put("url", url);
    plugin.notifyListeners("result", r, true);
  }
}
