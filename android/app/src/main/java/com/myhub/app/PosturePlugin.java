package com.myhub.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
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
import com.getcapacitor.JSArray;
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
  private String pendingRoute = null;   // set when the cover-screen widget opened the app

  @Override
  public void load() {
    tracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(getActivity()));
    pendingRoute = routeOf(getActivity().getIntent());
  }

  @Override
  protected void handleOnNewIntent(Intent intent) {
    super.handleOnNewIntent(intent);
    String r = routeOf(intent);
    if (r == null) return;
    JSObject o = new JSObject();
    o.put("route", r);
    notifyListeners("route", o);
  }

  private static String routeOf(Intent i) {
    if (i == null || !i.hasExtra(CoverWidgetProvider.EXTRA_ROUTE)) return null;
    String r = i.getStringExtra(CoverWidgetProvider.EXTRA_ROUTE);
    i.removeExtra(CoverWidgetProvider.EXTRA_ROUTE);
    return r == null ? "" : r;
  }

  // The page the widget asked for at cold start (js/core/cover.js asks once after boot).
  @PluginMethod
  public void takeRoute(PluginCall call) {
    JSObject o = new JSObject();
    if (pendingRoute != null) o.put("route", pendingRoute);
    pendingRoute = null;
    call.resolve(o);
  }

  // Rows for the Flex Window widget: [{ app, title, sub, percent?, route }], at most 2.
  @PluginMethod
  public void setCoverWidget(PluginCall call) {
    JSArray rows = call.getArray("rows", new JSArray());
    getContext().getSharedPreferences(CoverWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
      .putString(CoverWidgetProvider.KEY, rows.toString()).apply();
    CoverWidgetProvider.refreshAll(getContext());
    call.resolve();
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
