// SHA-256 of a file off the main thread: digesting a 30 MB song on the page itself froze it for ~150 ms
// per song while importing. Receives { id, blob }, answers { id, hex } (or { id, error }).
self.onmessage = async (e) => {
  const { id, blob } = e.data;
  try {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    self.postMessage({ id, hex: [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('') });
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
