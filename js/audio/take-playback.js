const keys = ["reference", "comparison"];
export const PLAYBACK_LIMITS = Object.freeze({ sampleRate: 48000, maximumSeconds: 61, maximumChannels: 2 });

// Only completed recordings reach this output graph. It never accepts a live input stream.
export function createTakePlayback({
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  OfflineContextClass = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext,
  onChange = () => {}, isPageVisible = () => true,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const takes = {}, pending = new Map(), levels = { reference: 0.5, comparison: 0.5 };
  let decoding = false, destroyed = false, context = null, contextListener = null;
  let request = null, sources = [], generation = 0, timer = null, timeout = null;
  let position = 0, origin = 0, epoch = 0, end = 0, status = "idle", message = "";
  let unavailable = typeof AudioContextClass !== "function";
  const readPosition = () => status === "playing"
    ? Math.min(end, origin + Math.max(0, context.currentTime - epoch)) : position;
  const state = () => ({ status, message, unavailable, position: readPosition(),
    ready: Object.fromEntries(keys.map((key) => [key, takes[key]?.status ?? "empty"])),
    activeKeys: sources.filter((source) => !source.ended && context.currentTime >= source.startAt).map((source) => source.key),
  });
  const publish = () => { if (!destroyed) { try { onChange(state()); } catch { /* Never block cleanup. */ } } };
  const stopSources = () => {
    clearTimer(timer); clearTimer(timeout); timer = null; timeout = null;
    for (const { source, gain } of sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      try { source.disconnect(); gain.disconnect(); } catch { /* Continue disposing both. */ }
      source.buffer = null;
    }
    sources = [];
  };
  const pause = () => {
    position = readPosition(); generation++; request = null; stopSources(); status = "idle"; publish();
  };
  const fail = (text) => { pause(); status = "error"; message = text; publish(); };
  const tick = () => {
    if (status !== "playing" || destroyed) return;
    if (!isPageVisible() || context.state !== "running") { fail("Playback was interrupted. Press Play to continue."); return; }
    position = readPosition();
    if (position >= end) { pause(); return; }
    publish(); timer = setTimer(tick, 30);
  };
  const schedule = () => {
    if (!request?.resumed || destroyed || !context || context.state !== "running") return;
    const job = request;
    if (!isPageVisible()) { pause(); return; }
    if (job.keys.some((key) => takes[key]?.status === "unavailable")) {
      fail("Synchronized playback is unavailable for this take. Individual fallback playback is available."); return;
    }
    if (job.keys.some((key) => takes[key]?.status !== "ready")) return;
    try {
      origin = position; epoch = context.currentTime + 0.04;
      end = Math.max(...job.keys.map((key) => (key === "comparison" ? job.offset : 0) + takes[key].buffer.duration));
      if (position >= end) { fail("This take has ended. Use Return to start to listen again."); return; }
      // Allocate and connect every source before scheduling any of them.
      for (const key of job.keys) {
        const shift = key === "comparison" ? job.offset : 0, local = Math.max(0, position - shift);
        if (local >= takes[key].buffer.duration) continue;
        const source = context.createBufferSource(), gain = context.createGain();
        const node = { key, source, gain, local, startAt: epoch + Math.max(0, shift - position), ended: false };
        sources.push(node);
        source.buffer = takes[key].buffer; gain.gain.value = levels[key];
        source.connect(gain); gain.connect(context.destination);
        source.onended = () => {
          if (job.generation !== generation || destroyed) return;
          node.ended = true;
          if (sources.every((item) => item.ended)) { position = end; pause(); }
        };
      }
      for (const node of sources) node.source.start(node.startAt, node.local);
      clearTimer(timeout); timeout = null; request = null; status = "playing"; tick();
    } catch { fail("Playback could not start. Press Play to try again."); }
  };
  const pump = async () => {
    if (decoding || destroyed) return;
    decoding = true;
    try {
      while (pending.size && !destroyed) {
        const [key, take] = pending.entries().next().value; pending.delete(key);
        const current = () => !destroyed && takes[key] === take;
        try {
          if (typeof OfflineContextClass !== "function") throw new Error("No decoder");
          const decoder = new OfflineContextClass(1, 1, PLAYBACK_LIMITS.sampleRate);
          const encoded = await take.blob.arrayBuffer();
          if (!current()) continue;
          const buffer = await decoder.decodeAudioData(encoded);
          if (!current()) continue;
          if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 61
            || buffer.sampleRate !== 48000 || buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2
            || buffer.length > 61 * 48000) throw new Error("Decoded recording exceeds playback bounds");
          take.buffer = buffer; take.status = "ready";
        } catch { if (current()) take.status = "unavailable"; }
        if (current()) { publish(); schedule(); }
      }
    } finally { decoding = false; }
  };
  const closeContext = () => {
    const old = context; context = null;
    if (old) {
      old.removeEventListener("statechange", contextListener);
      try { void old.close().catch(() => {}); } catch { /* Already closed. */ }
    }
  };
  return Object.freeze({
    getState: state,
    setTake(key, blob) {
      if (destroyed || !keys.includes(key) || takes[key]?.blob === blob) return;
      pause(); pending.delete(key);
      takes[key] = blob ? { blob, buffer: null, status: "preparing" } : null;
      if (blob) { pending.set(key, takes[key]); void pump(); }
      publish();
    },
    play(selection, at, offset) {
      if (destroyed || !isPageVisible() || ![...keys, "both"].includes(selection)
        || !Number.isFinite(at) || at < -5 || at > 66 || !Number.isFinite(offset) || Math.abs(offset) > 5) return false;
      const selected = selection === "both" ? keys : [selection];
      if (selected.some((key) => !takes[key])) return false;
      pause(); position = at; message = ""; status = "starting";
      const token = generation;
      request = { keys: selected, offset, generation: token, resumed: false };
      timeout = setTimer(() => { if (token === generation) fail("Playback preparation timed out. Press Play to try again."); }, 10000);
      try {
        // Construction/resume happens synchronously within the explicit Play gesture.
        if (!context || context.state === "closed") {
          if (typeof AudioContextClass !== "function") throw new Error("No audio output");
          context = new AudioContextClass();
          contextListener = () => {
            if (status === "playing" && context?.state !== "running") fail("Playback was interrupted. Press Play to continue.");
          };
          context.addEventListener("statechange", contextListener);
        }
        Promise.resolve(context.resume()).then(() => {
          if (token === generation && !destroyed && request) { request.resumed = true; schedule(); }
        }, () => { if (token === generation && !destroyed) fail("Playback could not start. Press Play to try again."); });
        publish(); return true;
      } catch { unavailable = true; fail("Synchronized playback is unavailable in this browser. Use individual playback."); return false; }
    },
    pause,
    seek(value) { pause(); position = value; message = ""; publish(); },
    setLevel(key, value) {
      if (!keys.includes(key) || !Number.isFinite(value) || value < 0 || value > 1) return false;
      levels[key] = value;
      for (const node of sources) if (node.key === key) node.gain.gain.value = value;
      return true;
    },
    clear() { pause(); pending.clear(); for (const key of keys) takes[key] = null; position = 0; message = ""; closeContext(); publish(); },
    destroy() { this.clear(); destroyed = true; },
  });
}
