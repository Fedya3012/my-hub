// xs-audio: bit-perfect music output for the Windows app (WASAPI Exclusive mode).
// The Electron main process starts it and talks to it over stdin / stdout, one command per line:
//   open <path>\t<startSec>   load a file (paused), opening the device in exclusive mode at the file's own format
//   next <path>               queue the next file: played gaplessly when the format matches, else the device reopens
//   nextclear | play | pause | seek <sec> | volume <0..1> | device <id or "default"> | list | quit
// It answers with lines: ready, format <rate> <fileBits> <containerBits> <validBits> <channels>,
//   state playing|paused, pos <sec> <duration>, transition, ended, devices <json>, error <code> <message>.
// Decoding: FLAC, WAV (also from the app's DSD / ALAC decoder) and MP3 via dr_libs (public domain / MIT-0).
// At volume 1 the samples reach the DAC untouched (16-bit files may sit in a 24/32-bit container, zero padded).
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <propsys.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>

#define DR_FLAC_IMPLEMENTATION
#include "dr_flac.h"
#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"
#define DR_MP3_IMPLEMENTATION
#include "dr_mp3.h"

static const CLSID XS_CLSID_MMDeviceEnumerator = { 0xbcde0395, 0xe52f, 0x467c, { 0x8e, 0x3d, 0xc4, 0x57, 0x92, 0x91, 0x69, 0x2e } };
static const IID XS_IID_IMMDeviceEnumerator = { 0xa95664d2, 0x9614, 0x4f35, { 0xa7, 0x46, 0xde, 0x8d, 0xb6, 0x36, 0x17, 0xe6 } };
static const IID XS_IID_IAudioClient = { 0x1cb9ad4c, 0xdbfa, 0x4c32, { 0xb1, 0x78, 0xc2, 0xf5, 0x68, 0xa7, 0x03, 0xb2 } };
static const IID XS_IID_IAudioRenderClient = { 0xf294acfc, 0x3146, 0x4483, { 0xa7, 0xbf, 0xad, 0xdc, 0xa7, 0xc2, 0x60, 0xe2 } };
static const GUID XS_SUBTYPE_PCM = { 0x00000001, 0x0000, 0x0010, { 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71 } };
static const PROPERTYKEY XS_PKEY_FriendlyName = { { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } }, 14 };

// ── Output lines (stdout, shared by both threads) ───────────────
static CRITICAL_SECTION outLock;
static void say(const char *fmt, ...) {
  va_list a;
  EnterCriticalSection(&outLock);
  va_start(a, fmt); vfprintf(stdout, fmt, a); va_end(a);
  fputc('\n', stdout); fflush(stdout);
  LeaveCriticalSection(&outLock);
}

// ── Decoders ────────────────────────────────────────────────────
enum { K_NONE, K_FLAC, K_WAV, K_MP3 };
typedef struct {
  int kind;
  drflac *fl; drwav wv; drmp3 mp;
  uint32_t rate, ch, bits;
  uint64_t total, cursor;
  float *fbuf; size_t fcap;
} Dec;

static wchar_t *widen(const char *s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
  wchar_t *w = (wchar_t *) malloc(sizeof(wchar_t) * (n > 0 ? n : 1));
  if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n); else w[0] = 0;
  return w;
}

static void dec_close(Dec *d) {
  if (d->kind == K_FLAC && d->fl) drflac_close(d->fl);
  if (d->kind == K_WAV) drwav_uninit(&d->wv);
  if (d->kind == K_MP3) drmp3_uninit(&d->mp);
  free(d->fbuf);
  memset(d, 0, sizeof(*d));
}

static int dec_open(Dec *d, const char *path) {
  memset(d, 0, sizeof(*d));
  wchar_t *w = widen(path);
  unsigned char magic[4] = { 0 };
  FILE *f = _wfopen(w, L"rb");
  if (!f) { free(w); return 0; }
  fread(magic, 1, 4, f); fclose(f);
  if (!memcmp(magic, "fLaC", 4)) {
    d->fl = drflac_open_file_w(w, NULL);
    if (d->fl) { d->kind = K_FLAC; d->rate = d->fl->sampleRate; d->ch = d->fl->channels; d->bits = d->fl->bitsPerSample; d->total = d->fl->totalPCMFrameCount; }
  } else if (!memcmp(magic, "RIFF", 4) || !memcmp(magic, "RF64", 4) || !memcmp(magic, "riff", 4) || !memcmp(magic, "FORM", 4)) {
    if (drwav_init_file_w(&d->wv, w, NULL)) {
      d->kind = K_WAV; d->rate = d->wv.sampleRate; d->ch = d->wv.channels;
      d->bits = d->wv.translatedFormatTag == DR_WAVE_FORMAT_IEEE_FLOAT ? 32 : d->wv.bitsPerSample;
      d->total = d->wv.totalPCMFrameCount;
    }
  } else if (drmp3_init_file_w(&d->mp, w, NULL)) {
    d->kind = K_MP3; d->rate = d->mp.sampleRate; d->ch = d->mp.channels; d->bits = 24;
    d->total = drmp3_get_pcm_frame_count(&d->mp);
  }
  free(w);
  return d->kind != K_NONE && d->rate && d->ch;
}

// Reads up to n frames as left-justified signed 32-bit samples.
static uint64_t dec_read(Dec *d, int32_t *out, uint64_t n) {
  uint64_t got = 0;
  if (d->kind == K_FLAC) got = drflac_read_pcm_frames_s32(d->fl, n, out);
  else if (d->kind == K_WAV) got = drwav_read_pcm_frames_s32(&d->wv, n, out);
  else if (d->kind == K_MP3) {
    size_t need = (size_t) (n * d->ch);
    if (d->fcap < need) { free(d->fbuf); d->fbuf = (float *) malloc(sizeof(float) * need); d->fcap = need; }
    got = drmp3_read_pcm_frames_f32(&d->mp, n, d->fbuf);
    for (uint64_t i = 0; i < got * d->ch; i++) {
      double v = d->fbuf[i] * 2147483648.0;
      out[i] = v >= 2147483647.0 ? 2147483647 : v <= -2147483648.0 ? (int32_t) 0x80000000 : (int32_t) v;
    }
  }
  d->cursor += got;
  return got;
}

static void dec_seek(Dec *d, uint64_t frame) {
  if (d->total && frame >= d->total) frame = d->total - 1;
  int ok = 0;
  if (d->kind == K_FLAC) ok = drflac_seek_to_pcm_frame(d->fl, frame);
  else if (d->kind == K_WAV) ok = drwav_seek_to_pcm_frame(&d->wv, frame);
  else if (d->kind == K_MP3) ok = drmp3_seek_to_pcm_frame(&d->mp, frame);
  if (ok) d->cursor = frame;
}

// ── Device ──────────────────────────────────────────────────────
static IMMDeviceEnumerator *enumr = NULL;
static wchar_t *deviceId = NULL;           // NULL = default output
static IAudioClient *client = NULL;
static IAudioRenderClient *render = NULL;
static HANDLE evt = NULL;
static UINT32 bufFrames = 0;
static WAVEFORMATEXTENSIBLE fmt;
static int contBits = 0, validBits = 0;    // container / valid bits the device was opened with

static CRITICAL_SECTION lock;
static Dec cur, nxt;
static int hasNext = 0, playing = 0, opened = 0, quitting = 0;
static double volume = 1.0;
static int32_t *tmp = NULL; static size_t tmpCap = 0;

static void close_device(void) {
  if (client) IAudioClient_Stop(client);
  if (render) { IAudioRenderClient_Release(render); render = NULL; }
  if (client) { IAudioClient_Release(client); client = NULL; }
  opened = 0;
}

static IMMDevice *get_device(void) {
  IMMDevice *dev = NULL;
  if (deviceId) IMMDeviceEnumerator_GetDevice(enumr, deviceId, &dev);
  if (!dev) IMMDeviceEnumerator_GetDefaultAudioEndpoint(enumr, eRender, eConsole, &dev);
  return dev;
}

static void set_format(uint32_t rate, uint32_t ch, int cont, int valid) {
  memset(&fmt, 0, sizeof(fmt));
  fmt.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  fmt.Format.nChannels = (WORD) ch;
  fmt.Format.nSamplesPerSec = rate;
  fmt.Format.wBitsPerSample = (WORD) cont;
  fmt.Format.nBlockAlign = (WORD) (ch * cont / 8);
  fmt.Format.nAvgBytesPerSec = rate * fmt.Format.nBlockAlign;
  fmt.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  fmt.Samples.wValidBitsPerSample = (WORD) valid;
  fmt.dwChannelMask = ch == 1 ? SPEAKER_FRONT_CENTER : ch == 2 ? (SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT) : 0;
  fmt.SubFormat = XS_SUBTYPE_PCM;
}

// Opens the device exclusively at the decoder's rate and channel count, with the smallest container that holds
// the file's bits (16 → 16/24/32, 24 → 24/32). Returns an HRESULT.
static HRESULT open_device(Dec *d) {
  close_device();
  IMMDevice *dev = get_device();
  if (!dev) return E_FAIL;
  static const int c16[][2] = { { 16, 16 }, { 24, 24 }, { 32, 24 }, { 32, 32 } };
  static const int c24[][2] = { { 24, 24 }, { 32, 24 }, { 32, 32 } };
  static const int c32[][2] = { { 32, 32 }, { 32, 24 }, { 24, 24 } };
  const int (*list)[2] = d->bits <= 16 ? c16 : d->bits <= 24 ? c24 : c32;
  int count = d->bits <= 16 ? 4 : 3;
  HRESULT hr = E_FAIL;
  for (int i = 0; i < count; i++) {
    if (!client && FAILED(hr = IMMDevice_Activate(dev, &XS_IID_IAudioClient, CLSCTX_ALL, NULL, (void **) &client))) break;
    set_format(d->rate, d->ch, list[i][0], list[i][1]);
    hr = IAudioClient_IsFormatSupported(client, AUDCLNT_SHAREMODE_EXCLUSIVE, (WAVEFORMATEX *) &fmt, NULL);
    if (hr != S_OK) continue;
    REFERENCE_TIME def = 0, min = 0;
    IAudioClient_GetDevicePeriod(client, &def, &min);
    REFERENCE_TIME period = def > 0 ? def : min;
    hr = IAudioClient_Initialize(client, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, (WAVEFORMATEX *) &fmt, NULL);
    if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
      UINT32 frames = 0;
      IAudioClient_GetBufferSize(client, &frames);
      period = (REFERENCE_TIME) (10000.0 * 1000.0 * frames / d->rate + 0.5);
      IAudioClient_Release(client); client = NULL;
      if (FAILED(hr = IMMDevice_Activate(dev, &XS_IID_IAudioClient, CLSCTX_ALL, NULL, (void **) &client))) break;
      hr = IAudioClient_Initialize(client, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, (WAVEFORMATEX *) &fmt, NULL);
    }
    if (FAILED(hr)) { IAudioClient_Release(client); client = NULL; if (hr == AUDCLNT_E_DEVICE_IN_USE) break; continue; }
    contBits = list[i][0]; validBits = list[i][1];
    break;
  }
  if (SUCCEEDED(hr) && client) {
    IAudioClient_SetEventHandle(client, evt);
    IAudioClient_GetBufferSize(client, &bufFrames);
    hr = IAudioClient_GetService(client, &XS_IID_IAudioRenderClient, (void **) &render);
  } else if (SUCCEEDED(hr)) hr = AUDCLNT_E_UNSUPPORTED_FORMAT;
  IMMDevice_Release(dev);
  if (FAILED(hr)) { close_device(); return hr; }
  opened = 1;
  say("format %u %u %d %d %u", d->rate, d->bits, contBits, validBits, d->ch);
  return S_OK;
}

static int same_format(Dec *a, Dec *b) { return a->rate == b->rate && a->ch == b->ch && (a->bits <= 16) == (b->bits <= 16) && (a->bits <= 24) == (b->bits <= 24); }

static void report_error(const char *code, HRESULT hr) {
  const char *msg = hr == AUDCLNT_E_DEVICE_IN_USE ? "Thiết bị đang được app khác dùng độc quyền"
    : hr == AUDCLNT_E_UNSUPPORTED_FORMAT ? "Thiết bị không hỗ trợ định dạng này ở chế độ độc quyền"
    : hr == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED ? "Windows đang chặn chế độ độc quyền (Sound → thiết bị → Advanced → Allow applications to take exclusive control)"
    : hr == AUDCLNT_E_DEVICE_INVALIDATED ? "Thiết bị âm thanh đã bị rút hoặc thay đổi" : "Không mở được thiết bị âm thanh";
  say("error %s 0x%08lx %s", code, (unsigned long) hr, msg);
}

// Writes frames (left-justified s32) into the device buffer in its container format.
static void put(BYTE *dst, const int32_t *src, UINT32 frames, uint32_t ch) {
  size_t n = (size_t) frames * ch;
  int scale = volume < 0.9999;
  for (size_t i = 0; i < n; i++) {
    int32_t v = src[i];
    if (scale) v = (int32_t) ((double) v * volume);
    if (contBits == 16) ((int16_t *) dst)[i] = (int16_t) (v >> 16);
    else if (contBits == 24) { BYTE *p = dst + i * 3; int32_t x = v >> 8; p[0] = (BYTE) x; p[1] = (BYTE) (x >> 8); p[2] = (BYTE) (x >> 16); }
    else ((int32_t *) dst)[i] = validBits == 24 ? (v & (int32_t) 0xFFFFFF00) : v;
  }
}

// Fills one device buffer. Returns 0 normally, 1 when the song (and any queued one) ran out.
static int fill(void) {
  BYTE *buf = NULL;
  if (FAILED(IAudioRenderClient_GetBuffer(render, bufFrames, &buf))) return 0;
  uint32_t ch = cur.ch;
  size_t need = (size_t) bufFrames * ch;
  if (tmpCap < need) { free(tmp); tmp = (int32_t *) malloc(sizeof(int32_t) * need); tmpCap = need; }
  uint64_t got = dec_read(&cur, tmp, bufFrames);
  int over = 0;
  if (got < bufFrames && hasNext && same_format(&cur, &nxt)) {   // gapless: continue straight into the next song
    dec_close(&cur); cur = nxt; memset(&nxt, 0, sizeof(nxt)); hasNext = 0;
    got += dec_read(&cur, tmp + got * ch, bufFrames - got);
    say("transition");
  } else if (got < bufFrames) over = 1;
  if (got < bufFrames) memset(tmp + got * ch, 0, sizeof(int32_t) * (bufFrames - got) * ch);
  put(buf, tmp, bufFrames, ch);
  IAudioRenderClient_ReleaseBuffer(render, bufFrames, 0);
  return over;
}

static double now_pos(void) { return cur.rate ? (double) cur.cursor / cur.rate : 0; }
static double dur(void) { return cur.rate ? (double) cur.total / cur.rate : 0; }

static DWORD WINAPI render_thread(LPVOID arg) {
  (void) arg;
  CoInitializeEx(NULL, COINIT_MULTITHREADED);
  DWORD lastPos = 0;
  int tail = 0;
  while (!quitting) {
    DWORD r = WaitForSingleObject(evt, 200);
    EnterCriticalSection(&lock);
    if (playing && opened && r == WAIT_OBJECT_0) {
      if (tail) {
        // The last real samples were written; one more period of silence lets them reach the DAC.
        if (++tail > 2) {
          tail = 0;
          if (hasNext) {   // different format: reopen the device for the next song
            dec_close(&cur); cur = nxt; memset(&nxt, 0, sizeof(nxt)); hasNext = 0;
            HRESULT hr = open_device(&cur);
            if (FAILED(hr)) { playing = 0; report_error("open", hr); say("state paused"); }
            else { say("transition"); fill(); IAudioClient_Start(client); }
          } else { IAudioClient_Stop(client); playing = 0; say("ended"); say("state paused"); }
        } else fill();
      } else if (fill()) tail = 1;
    }
    if (playing && GetTickCount() - lastPos > 100) { lastPos = GetTickCount(); say("pos %.3f %.3f", now_pos(), dur()); }
    LeaveCriticalSection(&lock);
  }
  CoUninitialize();
  return 0;
}

static void cmd_play(void) {
  if (!cur.kind) return;
  if (!opened) { HRESULT hr = open_device(&cur); if (FAILED(hr)) { report_error("open", hr); return; } }
  if (!playing) {
    fill();
    HRESULT hr = IAudioClient_Start(client);
    if (FAILED(hr)) { report_error("start", hr); return; }
    playing = 1;
  }
  say("state playing");
}

static void cmd_pause(void) {
  if (playing && client) IAudioClient_Stop(client);
  playing = 0;
  say("state paused");
  say("pos %.3f %.3f", now_pos(), dur());
}

static void list_devices(void) {
  IMMDeviceCollection *col = NULL;
  char *out = (char *) malloc(65536); size_t len = 0;
  len += sprintf(out + len, "devices [");
  if (SUCCEEDED(IMMDeviceEnumerator_EnumAudioEndpoints(enumr, eRender, DEVICE_STATE_ACTIVE, &col))) {
    UINT n = 0; IMMDeviceCollection_GetCount(col, &n);
    for (UINT i = 0; i < n && len < 60000; i++) {
      IMMDevice *dev = NULL; LPWSTR id = NULL; IPropertyStore *ps = NULL; PROPVARIANT pv; PropVariantInit(&pv);
      if (FAILED(IMMDeviceCollection_Item(col, i, &dev))) continue;
      IMMDevice_GetId(dev, &id);
      if (SUCCEEDED(IMMDevice_OpenPropertyStore(dev, STGM_READ, &ps))) IPropertyStore_GetValue(ps, &XS_PKEY_FriendlyName, &pv);
      char idu[512] = { 0 }, nameu[512] = { 0 };
      if (id) WideCharToMultiByte(CP_UTF8, 0, id, -1, idu, sizeof(idu), NULL, NULL);
      if (pv.vt == VT_LPWSTR) WideCharToMultiByte(CP_UTF8, 0, pv.pwszVal, -1, nameu, sizeof(nameu), NULL, NULL);
      for (char *c = nameu; *c; c++) if (*c == '"' || *c == '\\') *c = '\'';
      for (char *c = idu; *c; c++) if (*c == '"' || *c == '\\') *c = '_';
      len += sprintf(out + len, "%s{\"id\":\"%s\",\"name\":\"%s\"}", i ? "," : "", idu, nameu);
      PropVariantClear(&pv);
      if (ps) IPropertyStore_Release(ps);
      if (id) CoTaskMemFree(id);
      IMMDevice_Release(dev);
    }
    IMMDeviceCollection_Release(col);
  }
  len += sprintf(out + len, "]");
  say("%s", out);
  free(out);
}

int main(void) {
  InitializeCriticalSection(&outLock);
  InitializeCriticalSection(&lock);
  setvbuf(stdin, NULL, _IONBF, 0);
  if (FAILED(CoInitializeEx(NULL, COINIT_MULTITHREADED))) { say("error init 0 COM"); return 1; }
  if (FAILED(CoCreateInstance(&XS_CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, &XS_IID_IMMDeviceEnumerator, (void **) &enumr))) { say("error init 0 Không có thiết bị âm thanh"); return 1; }
  evt = CreateEvent(NULL, FALSE, FALSE, NULL);
  HANDLE th = CreateThread(NULL, 0, render_thread, NULL, 0, NULL);
  SetThreadPriority(th, THREAD_PRIORITY_TIME_CRITICAL);
  say("ready");
  static char line[8192];
  while (fgets(line, sizeof(line), stdin)) {
    size_t n = strlen(line);
    while (n && (line[n - 1] == '\n' || line[n - 1] == '\r')) line[--n] = 0;
    EnterCriticalSection(&lock);
    if (!strncmp(line, "open ", 5)) {
      char *tab = strchr(line + 5, '\t');
      double start = 0;
      if (tab) { *tab = 0; start = atof(tab + 1); }
      int wasOpen = opened;
      Dec d;
      if (!dec_open(&d, line + 5)) say("error decode 0 Không đọc được tệp này");
      else {
        int reopen = !wasOpen || !same_format(&cur, &d);
        if (playing && client) IAudioClient_Stop(client);
        playing = 0;
        dec_close(&cur); cur = d;
        if (hasNext) { dec_close(&nxt); hasNext = 0; }
        if (start > 0) dec_seek(&cur, (uint64_t) (start * cur.rate));
        HRESULT hr = reopen ? open_device(&cur) : (IAudioClient_Reset(client), S_OK);
        if (FAILED(hr)) report_error("open", hr);
        else say("loaded %.3f", dur());
      }
    } else if (!strncmp(line, "next ", 5)) {
      Dec d;
      if (hasNext) { dec_close(&nxt); hasNext = 0; }
      if (dec_open(&d, line + 5)) { nxt = d; hasNext = 1; }
    } else if (!strcmp(line, "nextclear")) { if (hasNext) { dec_close(&nxt); hasNext = 0; } }
    else if (!strcmp(line, "play")) cmd_play();
    else if (!strcmp(line, "pause")) cmd_pause();
    else if (!strncmp(line, "seek ", 5)) {
      if (cur.kind) {
        int was = playing;
        if (playing && client) { IAudioClient_Stop(client); playing = 0; }
        dec_seek(&cur, (uint64_t) (atof(line + 5) * cur.rate));
        if (client) IAudioClient_Reset(client);
        if (was) cmd_play(); else say("pos %.3f %.3f", now_pos(), dur());
      }
    } else if (!strncmp(line, "volume ", 7)) { volume = atof(line + 7); if (volume < 0) volume = 0; if (volume > 1) volume = 1; }
    else if (!strncmp(line, "device ", 7)) {
      free(deviceId); deviceId = NULL;
      if (strcmp(line + 7, "default")) deviceId = widen(line + 7);
      if (opened) { int was = playing; playing = 0; close_device(); if (was) cmd_play(); }
    } else if (!strcmp(line, "list")) list_devices();
    else if (!strcmp(line, "stop")) { if (playing && client) IAudioClient_Stop(client); playing = 0; close_device(); say("state paused"); }
    else if (!strcmp(line, "quit")) { LeaveCriticalSection(&lock); break; }
    LeaveCriticalSection(&lock);
  }
  quitting = 1;
  EnterCriticalSection(&lock);
  close_device();
  LeaveCriticalSection(&lock);
  WaitForSingleObject(th, 1000);
  return 0;
}
