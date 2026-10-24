package com.myhub.app;

import android.app.Activity;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.util.Arrays;

// Google Drive sign-in on Android without a client secret: Google Play services' Authorization API shows the
// account chooser and consent sheet, then hands out a short-lived access token. Google matches the app by its
// package name + signing SHA-1 (the Android OAuth client in Google Cloud), so nothing secret ships in the app.
// Later tokens come silently (interactive:false) as long as the permission stays granted.
@CapacitorPlugin(name = "GoogleAuth")
public class GoogleAuthPlugin extends Plugin {
  private static final String DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata";
  private static final String DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";

  private ActivityResultLauncher<IntentSenderRequest> launcher;
  private PluginCall pending;

  @Override
  public void load() {
    launcher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::onConsent);
  }

  private AuthorizationClient client() { return Identity.getAuthorizationClient(getActivity()); }

  @PluginMethod
  public void authorize(PluginCall call) {
    boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
    AuthorizationRequest req = AuthorizationRequest.builder()
      .setRequestedScopes(Arrays.asList(new Scope(DRIVE_APPDATA), new Scope(DRIVE_READONLY)))
      .build();
    client().authorize(req)
      .addOnSuccessListener(r -> {
        if (!r.hasResolution()) { resolve(call, r); return; }
        if (!interactive || r.getPendingIntent() == null) { call.reject("Cần đăng nhập lại Google Drive.", "consent"); return; }
        if (pending != null) pending.reject("Đã huỷ.", "cancelled");
        pending = call;
        launcher.launch(new IntentSenderRequest.Builder(r.getPendingIntent().getIntentSender()).build());
      })
      .addOnFailureListener(e -> call.reject(String.valueOf(e.getMessage()), "failed"));
  }

  private void onConsent(ActivityResult res) {
    PluginCall call = pending;
    pending = null;
    if (call == null) return;
    if (res.getResultCode() != Activity.RESULT_OK || res.getData() == null) { call.reject("Bạn chưa cho phép My Hub truy cập Google Drive.", "cancelled"); return; }
    try { resolve(call, client().getAuthorizationResultFromIntent(res.getData())); }
    catch (Exception e) { call.reject(String.valueOf(e.getMessage()), "failed"); }
  }

  private void resolve(PluginCall call, AuthorizationResult r) {
    if (r.getAccessToken() == null) { call.reject("Google không trả về quyền truy cập.", "failed"); return; }
    JSObject o = new JSObject();
    o.put("accessToken", r.getAccessToken());
    o.put("scopes", String.join(" ", r.getGrantedScopes()));
    call.resolve(o);
  }
}
