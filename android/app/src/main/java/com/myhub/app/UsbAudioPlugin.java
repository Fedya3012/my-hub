package com.myhub.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioMixerAttributes;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

// USB DAC mode (Android 14+): asks Android to open the USB DAC at the song's own sample rate (no resampling in
// the system mixer), or in bit-perfect mode where the DAC gets the samples untouched (no mixing, no system
// volume). Uses AudioManager.setPreferredMixerAttributes for media playback of this app.
@CapacitorPlugin(name = "UsbAudio")
public class UsbAudioPlugin extends Plugin {
  private AudioManager am;
  private final AudioAttributes media = new AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();

  @Override
  public void load() {
    am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    am.registerAudioDeviceCallback(new AudioDeviceCallback() {
      @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { changed(); }
      @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { changed(); }
    }, new Handler(Looper.getMainLooper()));
  }

  private void changed() { notifyListeners("change", new JSObject()); }

  private AudioDeviceInfo usb() {
    for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
      int t = d.getType();
      if (t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_USB_ACCESSORY) return d;
    }
    return null;
  }

  private static int bits(int enc) {
    switch (enc) {
      case AudioFormat.ENCODING_PCM_FLOAT: return 33;   // best
      case AudioFormat.ENCODING_PCM_32BIT: return 32;
      case AudioFormat.ENCODING_PCM_24BIT_PACKED: return 24;
      case AudioFormat.ENCODING_PCM_16BIT: return 16;
      default: return 0;
    }
  }

  // → { supported, device: { name, rates: [..], bitPerfect: bool } | null }
  @PluginMethod
  public void info(PluginCall call) {
    JSObject r = new JSObject();
    r.put("supported", Build.VERSION.SDK_INT >= 34);
    AudioDeviceInfo d = usb();
    if (d != null) {
      JSObject o = new JSObject();
      o.put("name", String.valueOf(d.getProductName()));
      JSArray rates = new JSArray();
      for (int s : d.getSampleRates()) rates.put(s);
      o.put("rates", rates);
      boolean bp = false;
      if (Build.VERSION.SDK_INT >= 34) {
        JSArray modes = new JSArray();
        for (AudioMixerAttributes m : am.getSupportedMixerAttributes(d)) {
          JSObject x = new JSObject();
          x.put("rate", m.getFormat().getSampleRate());
          x.put("bits", bits(m.getFormat().getEncoding()));
          x.put("bitPerfect", m.getMixerBehavior() == AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT);
          if (m.getMixerBehavior() == AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT) bp = true;
          modes.put(x);
        }
        o.put("modes", modes);
      }
      o.put("bitPerfect", bp);
      r.put("device", o);
    } else r.put("device", null);
    call.resolve(r);
  }

  // { sampleRate, bitPerfect } → { applied, rate, bits, bitPerfect }
  @PluginMethod
  public void apply(PluginCall call) {
    JSObject r = new JSObject();
    if (Build.VERSION.SDK_INT < 34) { r.put("applied", false); r.put("reason", "Cần Android 14 trở lên"); call.resolve(r); return; }
    AudioDeviceInfo d = usb();
    if (d == null) { r.put("applied", false); r.put("reason", "Chưa cắm USB DAC"); call.resolve(r); return; }
    int rate = call.getInt("sampleRate", 0);
    boolean wantBp = Boolean.TRUE.equals(call.getBoolean("bitPerfect", false));
    List<AudioMixerAttributes> all = am.getSupportedMixerAttributes(d);
    AudioMixerAttributes best = null;
    int bestScore = -1;
    for (AudioMixerAttributes m : all) {
      boolean bp = m.getMixerBehavior() == AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT;
      if (bp != wantBp) continue;
      AudioFormat f = m.getFormat();
      if (f.getChannelCount() != 2 && f.getChannelCount() != 0) continue;
      int score = (f.getSampleRate() == rate ? 1000 : f.getSampleRate() > 0 && rate > 0 && f.getSampleRate() % rate == 0 ? 400 : 0) + bits(f.getEncoding());
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (best == null) { r.put("applied", false); r.put("reason", wantBp ? "DAC này không hỗ trợ bit-perfect" : "Không có cấu hình phù hợp"); call.resolve(r); return; }
    boolean ok = am.setPreferredMixerAttributes(media, d, best);
    r.put("applied", ok);
    r.put("rate", best.getFormat().getSampleRate());
    r.put("bits", bits(best.getFormat().getEncoding()));
    r.put("bitPerfect", wantBp);
    call.resolve(r);
  }

  @PluginMethod
  public void clear(PluginCall call) {
    if (Build.VERSION.SDK_INT >= 34) { AudioDeviceInfo d = usb(); if (d != null) am.clearPreferredMixerAttributes(media, d); }
    call.resolve();
  }
}
