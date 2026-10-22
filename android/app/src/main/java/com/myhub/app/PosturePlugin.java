package com.myhub.app;

import android.app.Activity;
import android.graphics.Rect;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.View;
import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Foldables (Galaxy Z Flip): tells the web side how the device is held. Jetpack WindowManager reports the hinge
// (flat or half-open, where the crease is) and the display id says whether the app runs on the cover screen.
// js/core/posture.js turns this into <body data-posture="open|flex|cover|compact">. Values are in dp, which are
// CSS px inside the WebView; winW/winH let the web side rescale if the page is zoomed.
@CapacitorPlugin(name = "Posture")
public class PosturePlugin extends Plugin {
  private WindowInfoTrackerCallbackAdapter tracker;
  private final Consumer<WindowLayoutInfo> listener = this::onLayout;
  private JSObject last = new JSObject();

  @Override
  public void load() {
    tracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(getActivity()));
  }

  @Override
  protected void handleOnStart() {
    if (tracker != null) tracker.addWindowLayoutInfoListener(getActivity(), ContextCompat.getMainExecutor(getContext()), listener);
  }

  @Override
  protected void handleOnStop() {
    if (tracker != null) tracker.removeWindowLayoutInfoListener(listener);
  }

  @PluginMethod
  public void getState(PluginCall call) {
    JSObject r = base();
    copyFold(last, r);
    call.resolve(r);
  }

  private void onLayout(WindowLayoutInfo info) {
    JSObject r = base();
    float d = density();
    for (DisplayFeature f : info.getDisplayFeatures()) {
      if (!(f instanceof FoldingFeature)) continue;
      FoldingFeature ff = (FoldingFeature) f;
      Rect b = ff.getBounds();
      r.put("fold", ff.getState() == FoldingFeature.State.HALF_OPENED ? "half" : "flat");
      r.put("orientation", ff.getOrientation() == FoldingFeature.Orientation.HORIZONTAL ? "horizontal" : "vertical");
      r.put("separating", ff.isSeparating());
      r.put("top", b.top / d);
      r.put("bottom", b.bottom / d);
      r.put("left", b.left / d);
      r.put("right", b.right / d);
      break;
    }
    last = r;
    notifyListeners("change", r);
  }

  private JSObject base() {
    JSObject r = new JSObject();
    Activity a = getActivity();
    Display disp = a.getWindowManager().getDefaultDisplay();
    // Galaxy Z Flip: display 0 is the main screen, 1 the cover screen (Flex Window).
    r.put("displayId", disp.getDisplayId());
    r.put("cover", disp.getDisplayId() != Display.DEFAULT_DISPLAY);
    View decor = a.getWindow().getDecorView();
    float d = density();
    r.put("winW", decor.getWidth() / d);
    r.put("winH", decor.getHeight() / d);
    r.put("fold", "none");
    return r;
  }

  private static void copyFold(JSObject from, JSObject to) {
    for (String k : new String[] { "fold", "orientation", "separating", "top", "bottom", "left", "right" }) {
      if (from.has(k)) to.put(k, from.opt(k));
    }
  }

  private float density() {
    DisplayMetrics m = getContext().getResources().getDisplayMetrics();
    return m.density > 0 ? m.density : 1f;
  }
}
