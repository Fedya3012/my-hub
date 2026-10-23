package com.myhub.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import android.os.SystemClock;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FolderPickerPlugin.class);
    registerPlugin(NativeMediaPlugin.class);
    registerPlugin(DlnaPlugin.class);
    registerPlugin(UsbAudioPlugin.class);
    super.onCreate(savedInstanceState);
    // When the system takes the page's memory back (render process gone), the app used to close. Start the page again
    // instead; if that keeps failing within seconds, close like before rather than loop.
    getBridge().addWebViewListener(new WebViewListener() {
      @Override
      public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
        long now = SystemClock.elapsedRealtime();
        if (now - lastRestart < 10_000) { runOnUiThread(() -> finish()); return true; }
        lastRestart = now;
        runOnUiThread(() -> recreate());
        return true;
      }
    });
  }

  private static long lastRestart = -100_000;

  // Hide the system navigation bar while the app is in use; a swipe from the bottom edge shows it briefly.
  private void hideNavigationBar() {
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    controller.hide(WindowInsetsCompat.Type.navigationBars());
  }

  @Override
  public void onResume() {
    super.onResume();
    hideNavigationBar();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideNavigationBar();
  }
}
