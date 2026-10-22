package com.myhub.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FolderPickerPlugin.class);
    registerPlugin(PosturePlugin.class);
    registerPlugin(NativeMediaPlugin.class);
    registerPlugin(DlnaPlugin.class);
    registerPlugin(UsbAudioPlugin.class);
    super.onCreate(savedInstanceState);
  }

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
