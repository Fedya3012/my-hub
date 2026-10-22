package com.myhub.app;

import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

// Galaxy Z Flip cover screen (Flex Window) widget: up to two "go on" rows (Đang đọc, Đang phát, Tiếp tục).
// The web side writes the rows with Posture.setCoverWidget (js/core/cover.js) only when they change, so the widget
// never polls: updatePeriodMillis is 0. A tap opens My Hub on the main screen at the row's page.
public class CoverWidgetProvider extends AppWidgetProvider {
  static final String PREFS = "cover_widget";
  static final String KEY = "rows";
  static final String EXTRA_ROUTE = "myhub.route";

  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
    RemoteViews views = build(context);
    for (int id : ids) manager.updateAppWidget(id, views);
  }

  static void refreshAll(Context context) {
    AppWidgetManager m = AppWidgetManager.getInstance(context);
    int[] ids = m.getAppWidgetIds(new ComponentName(context, CoverWidgetProvider.class));
    if (ids.length == 0) return;
    RemoteViews views = build(context);
    for (int id : ids) m.updateAppWidget(id, views);
  }

  private static RemoteViews build(Context context) {
    RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.cover_widget);
    JSONArray rows;
    try {
      rows = new JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"));
    } catch (Exception e) {
      rows = new JSONArray();
    }
    int[][] ids = {
      { R.id.row1, R.id.row1_app, R.id.row1_title, R.id.row1_sub, R.id.row1_bar },
      { R.id.row2, R.id.row2_app, R.id.row2_title, R.id.row2_sub, R.id.row2_bar },
    };
    v.setViewVisibility(R.id.cover_empty, rows.length() == 0 ? View.VISIBLE : View.GONE);
    v.setOnClickPendingIntent(R.id.cover_root, open(context, "", 0));
    for (int i = 0; i < ids.length; i++) {
      JSONObject r = rows.optJSONObject(i);
      if (r == null) { v.setViewVisibility(ids[i][0], View.GONE); continue; }
      v.setViewVisibility(ids[i][0], View.VISIBLE);
      v.setTextViewText(ids[i][1], r.optString("app"));
      v.setTextViewText(ids[i][2], r.optString("title"));
      String sub = r.optString("sub");
      v.setTextViewText(ids[i][3], sub);
      v.setViewVisibility(ids[i][3], sub.isEmpty() ? View.GONE : View.VISIBLE);
      if (r.has("percent")) {
        v.setViewVisibility(ids[i][4], View.VISIBLE);
        v.setProgressBar(ids[i][4], 100, (int) Math.round(r.optDouble("percent", 0)), false);
      } else {
        v.setViewVisibility(ids[i][4], View.GONE);
      }
      v.setOnClickPendingIntent(ids[i][0], open(context, r.optString("route"), i + 1));
    }
    return v;
  }

  // Opens the app on the main screen (display 0, Samsung's launchDisplayId) at #route.
  private static PendingIntent open(Context context, String route, int code) {
    Intent i = new Intent(context, MainActivity.class);
    i.setAction(Intent.ACTION_VIEW);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    i.putExtra(EXTRA_ROUTE, route);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ActivityOptions o = ActivityOptions.makeBasic();
      o.setLaunchDisplayId(0);
      return PendingIntent.getActivity(context, code, i, flags, o.toBundle());
    }
    return PendingIntent.getActivity(context, code, i, flags);
  }
}
