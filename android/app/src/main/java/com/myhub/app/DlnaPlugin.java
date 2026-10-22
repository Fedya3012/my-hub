package com.myhub.app;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.DatagramPacket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// DLNA / UPnP: finds speakers, receivers and TVs on the Wi-Fi (SSDP), and plays a song on one of them
// (AVTransport + RenderingControl over SOAP). The renderer fetches the audio from a small HTTP server in the app:
// the web side copies the song into the app cache in pieces (stage) and gets back a LAN URL to hand over.
@CapacitorPlugin(name = "Dlna")
public class DlnaPlugin extends Plugin {
  private static final String AVT = "urn:schemas-upnp-org:service:AVTransport:1";
  private static final String RC = "urn:schemas-upnp-org:service:RenderingControl:1";
  private final ExecutorService io = Executors.newCachedThreadPool();
  private ServerSocket server;
  private File dir;
  private final Map<String, String> mimes = new HashMap<>();

  @Override
  public void load() {
    dir = new File(getContext().getCacheDir(), "dlna");
    dir.mkdirs();
  }

  // ── Discovery ────────────────────────────────────────────────
  @PluginMethod
  public void discover(PluginCall call) {
    final int wait = call.getInt("timeout", 3500);
    io.execute(() -> {
      WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
      WifiManager.MulticastLock lock = wm == null ? null : wm.createMulticastLock("myhub-dlna");
      JSArray out = new JSArray();
      try {
        if (lock != null) { lock.setReferenceCounted(false); lock.acquire(); }
        Set<String> locations = new HashSet<>();
        try (MulticastSocket s = new MulticastSocket()) {
          s.setSoTimeout(400);
          InetAddress group = InetAddress.getByName("239.255.255.250");
          String msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
          byte[] m = msg.getBytes(StandardCharsets.US_ASCII);
          for (int k = 0; k < 2; k++) s.send(new DatagramPacket(m, m.length, group, 1900));
          long end = System.currentTimeMillis() + wait;
          byte[] buf = new byte[4096];
          while (System.currentTimeMillis() < end) {
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            try { s.receive(p); } catch (SocketTimeoutException e) { continue; }
            String r = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
            Matcher lm = Pattern.compile("(?im)^location:\\s*(\\S+)").matcher(r);
            if (lm.find()) locations.add(lm.group(1).trim());
          }
        }
        for (String loc : locations) {
          try { JSObject d = describe(loc); if (d != null) out.put(d); } catch (Exception ignored) { }
        }
        JSObject res = new JSObject();
        res.put("devices", out);
        call.resolve(res);
      } catch (Exception e) {
        call.reject("Không dò được thiết bị: " + e.getMessage());
      } finally {
        if (lock != null && lock.isHeld()) lock.release();
      }
    });
  }

  private JSObject describe(String location) throws Exception {
    String xml = http("GET", location, null, null);
    String name = tag(xml, "friendlyName");
    String avt = control(xml, AVT, location), rc = control(xml, RC, location);
    if (avt == null) return null;
    JSObject d = new JSObject();
    d.put("id", location);
    d.put("name", name == null ? location : name);
    d.put("model", tag(xml, "modelName"));
    d.put("avt", avt);
    d.put("rc", rc);
    return d;
  }

  private static String tag(String xml, String t) {
    Matcher m = Pattern.compile("<(?:\\w+:)?" + t + ">([^<]*)</(?:\\w+:)?" + t + ">").matcher(xml);
    return m.find() ? unescape(m.group(1).trim()) : null;
  }

  private static String control(String xml, String type, String base) throws Exception {
    Matcher m = Pattern.compile("<service>(.*?)</service>", Pattern.DOTALL).matcher(xml);
    while (m.find()) {
      String s = m.group(1);
      if (!s.contains(type)) continue;
      String url = tag(s, "controlURL");
      if (url == null) return null;
      return new URL(new URL(base), url).toString();
    }
    return null;
  }

  // ── Serving the song ─────────────────────────────────────────
  // { name, mime, data (base64), append } → { url } once the server is up.
  @PluginMethod
  public void stage(PluginCall call) {
    String name = safe(call.getString("name", "track"));
    String data = call.getString("data", "");
    boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
    io.execute(() -> {
      try {
        if (!append) for (File f : dir.listFiles()) if (!f.getName().equals(name)) f.delete();
        try (FileOutputStream o = new FileOutputStream(new File(dir, name), append)) { o.write(Base64.decode(data, Base64.DEFAULT)); }
        mimes.put(name, call.getString("mime", "audio/mpeg"));
        startServer();
        String ip = localIp();
        if (ip == null) { call.reject("Máy chưa kết nối Wi-Fi"); return; }
        JSObject r = new JSObject();
        r.put("url", "http://" + ip + ":" + server.getLocalPort() + "/" + name);
        call.resolve(r);
      } catch (Exception e) { call.reject("Không chuẩn bị được bài hát: " + e.getMessage()); }
    });
  }

  private static String safe(String s) { return s.replaceAll("[^A-Za-z0-9._-]", "_"); }

  private synchronized void startServer() throws Exception {
    if (server != null && !server.isClosed()) return;
    server = new ServerSocket();
    server.setReuseAddress(true);
    server.bind(new InetSocketAddress(0));
    io.execute(() -> {
      while (server != null && !server.isClosed()) {
        try { Socket c = server.accept(); io.execute(() -> serve(c)); } catch (Exception e) { break; }
      }
    });
  }

  private void serve(Socket c) {
    try (Socket s = c) {
      s.setSoTimeout(30000);
      BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.ISO_8859_1));
      String first = in.readLine();
      if (first == null) return;
      String[] parts = first.split(" ");
      String method = parts[0], path = parts.length > 1 ? URLDecoder.decode(parts[1], "UTF-8") : "/";
      long from = 0, to = -1;
      for (String h; (h = in.readLine()) != null && !h.isEmpty(); ) {
        Matcher m = Pattern.compile("(?i)^range:\\s*bytes=(\\d*)-(\\d*)").matcher(h);
        if (m.find()) { if (!m.group(1).isEmpty()) from = Long.parseLong(m.group(1)); if (!m.group(2).isEmpty()) to = Long.parseLong(m.group(2)); }
      }
      String name = safe(path.substring(path.lastIndexOf('/') + 1));
      File f = new File(dir, name);
      OutputStream out = s.getOutputStream();
      if (!f.exists()) { out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes()); return; }
      long len = f.length();
      if (to < 0 || to >= len) to = len - 1;
      boolean partial = from > 0 || to < len - 1;
      String head = (partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n")
        + "Content-Type: " + mimes.getOrDefault(name, "audio/mpeg") + "\r\n"
        + "Content-Length: " + (to - from + 1) + "\r\n"
        + (partial ? "Content-Range: bytes " + from + "-" + to + "/" + len + "\r\n" : "")
        + "Accept-Ranges: bytes\r\ntransferMode.dlna.org: Streaming\r\ncontentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\nConnection: close\r\n\r\n";
      out.write(head.getBytes(StandardCharsets.ISO_8859_1));
      if (method.equals("HEAD")) return;
      try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
        r.seek(from);
        byte[] buf = new byte[64 * 1024];
        long left = to - from + 1;
        while (left > 0) {
          int n = r.read(buf, 0, (int) Math.min(buf.length, left));
          if (n < 0) break;
          out.write(buf, 0, n);
          left -= n;
        }
      }
      out.flush();
    } catch (Exception ignored) { }
  }

  private static String localIp() throws Exception {
    for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
      if (!ni.isUp() || ni.isLoopback()) continue;
      String n = ni.getName();
      if (!(n.startsWith("wlan") || n.startsWith("eth") || n.startsWith("ap") || n.startsWith("swlan"))) continue;
      for (InetAddress a : Collections.list(ni.getInetAddresses())) if (a instanceof Inet4Address && !a.isLoopbackAddress()) return a.getHostAddress();
    }
    return null;
  }

  // ── Control ──────────────────────────────────────────────────
  // { device, url, title, artist, album, mime }
  @PluginMethod
  public void play(PluginCall call) {
    JSObject d = call.getObject("device");
    io.execute(() -> {
      try {
        String avt = d.getString("avt");
        String url = call.getString("url", "");
        String mime = call.getString("mime", "audio/mpeg");
        String meta = "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
          + "<item id=\"1\" parentID=\"0\" restricted=\"1\"><dc:title>" + escape(call.getString("title", "")) + "</dc:title>"
          + "<upnp:artist>" + escape(call.getString("artist", "")) + "</upnp:artist><upnp:album>" + escape(call.getString("album", "")) + "</upnp:album>"
          + "<upnp:class>object.item.audioItem.musicTrack</upnp:class>"
          + "<res protocolInfo=\"http-get:*:" + mime + ":DLNA.ORG_OP=01\">" + escape(url) + "</res></item></DIDL-Lite>";
        try { soap(avt, AVT, "Stop", ""); } catch (Exception ignored) { }
        soap(avt, AVT, "SetAVTransportURI", "<CurrentURI>" + escape(url) + "</CurrentURI><CurrentURIMetaData>" + escape(meta) + "</CurrentURIMetaData>");
        soap(avt, AVT, "Play", "<Speed>1</Speed>");
        call.resolve();
      } catch (Exception e) { call.reject("Thiết bị không nhận lệnh phát: " + e.getMessage()); }
    });
  }

  // { device, action: pause | resume | stop | seek, position (s) }
  @PluginMethod
  public void control(PluginCall call) {
    JSObject d = call.getObject("device");
    String action = call.getString("action", "");
    io.execute(() -> {
      try {
        String avt = d.getString("avt");
        switch (action) {
          case "pause": soap(avt, AVT, "Pause", ""); break;
          case "resume": soap(avt, AVT, "Play", "<Speed>1</Speed>"); break;
          case "stop": soap(avt, AVT, "Stop", ""); break;
          case "seek": soap(avt, AVT, "Seek", "<Unit>REL_TIME</Unit><Target>" + hms(call.getDouble("position", 0d)) + "</Target>"); break;
          default: call.reject("Lệnh không hợp lệ"); return;
        }
        call.resolve();
      } catch (Exception e) { call.reject(e.getMessage()); }
    });
  }

  // { device, volume 0…100 }
  @PluginMethod
  public void setVolume(PluginCall call) {
    JSObject d = call.getObject("device");
    io.execute(() -> {
      try {
        String rc = d.getString("rc");
        if (rc == null || rc.isEmpty()) { call.reject("Thiết bị không cho chỉnh âm lượng"); return; }
        soap(rc, RC, "SetVolume", "<Channel>Master</Channel><DesiredVolume>" + call.getInt("volume", 30) + "</DesiredVolume>");
        call.resolve();
      } catch (Exception e) { call.reject(e.getMessage()); }
    });
  }

  // → { position, duration (s), state: PLAYING | PAUSED_PLAYBACK | STOPPED | TRANSITIONING | NO_MEDIA_PRESENT }
  @PluginMethod
  public void status(PluginCall call) {
    JSObject d = call.getObject("device");
    io.execute(() -> {
      try {
        String avt = d.getString("avt");
        String pos = soap(avt, AVT, "GetPositionInfo", "");
        String st = soap(avt, AVT, "GetTransportInfo", "");
        JSObject r = new JSObject();
        r.put("position", secs(tag(pos, "RelTime")));
        r.put("duration", secs(tag(pos, "TrackDuration")));
        r.put("state", tag(st, "CurrentTransportState"));
        call.resolve(r);
      } catch (Exception e) { call.reject(e.getMessage()); }
    });
  }

  private String soap(String url, String service, String action, String args) throws Exception {
    String body = "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
      + "<u:" + action + " xmlns:u=\"" + service + "\"><InstanceID>0</InstanceID>" + args + "</u:" + action + "></s:Body></s:Envelope>";
    Map<String, String> h = new HashMap<>();
    h.put("Content-Type", "text/xml; charset=\"utf-8\"");
    h.put("SOAPACTION", "\"" + service + "#" + action + "\"");
    return http("POST", url, body, h);
  }

  private static String http(String method, String url, String body, Map<String, String> headers) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(4000);
    c.setReadTimeout(6000);
    c.setRequestMethod(method);
    if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) c.setRequestProperty(e.getKey(), e.getValue());
    if (body != null) { c.setDoOutput(true); try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); } }
    int code = c.getResponseCode();
    InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
    StringBuilder sb = new StringBuilder();
    if (is != null) try (BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) { for (String l; (l = r.readLine()) != null; ) sb.append(l).append('\n'); }
    if (code >= 400) throw new Exception("HTTP " + code);
    return sb.toString();
  }

  private static String escape(String s) {
    return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
  }
  private static String unescape(String s) {
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&amp;", "&");
  }
  private static String hms(double t) {
    long s = (long) t;
    return String.format(java.util.Locale.US, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60);
  }
  private static double secs(String v) {
    if (v == null || !v.contains(":")) return 0;
    String[] p = v.split(":");
    try { return Integer.parseInt(p[0]) * 3600 + Integer.parseInt(p[1]) * 60 + Double.parseDouble(p[2]); } catch (Exception e) { return 0; }
  }
}
