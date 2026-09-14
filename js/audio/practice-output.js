import { beatAt, NOISE_TYPES, SOUNDS } from "../practice/rhythm.js";

// Output only. No microphone node or stream enters this controller.
export function createPracticeOutput({ AudioContextClass, isVisible = () => true,
  AudioWorkletNodeClass = globalThis.AudioWorkletNode,
  onState = () => {}, onBeat = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  now = () => performance.now() / 1000,
} = {}) {
  let active = null, state = "idle", destroyed = false;
  const sessions = new Set();
  const publish = (value) => { state = value; onState(value); };
  const clean = (s) => {
    if (s.cleaned) return;
    s.cleaned = true;
    clearTimer(s.timer); clearTimer(s.closeTimer);
    s.context?.removeEventListener("statechange", s.changed);
    if (s.noiseNode) {
      s.noiseNode.onprocessorerror = null;
      try { s.noiseNode.port.postMessage("stop"); s.noiseNode.port.close(); } catch { /* Context may be closed. */ }
      try { s.noiseNode.disconnect(); } catch { /* Continue cleanup. */ }
    }
    for (const source of s.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      try { source.disconnect(); } catch { /* Continue cleanup. */ }
    }
    s.sources.clear(); s.queue.length = 0;
    try { s.gain?.disconnect(); } catch { /* Still close context. */ }
    try { Promise.resolve(s.context?.close()).catch(() => {}); } catch { /* Nodes disconnected. */ }
    s.buffers.clear(); sessions.delete(s);
  };
  const gainTo = (s, value) => {
    if (!s.gain) return;
    const time = s.context.currentTime;
    const elapsed = Math.max(0, Math.min(1, (time - s.gainAt) / 0.025));
    const level = s.gainFrom + (s.gainTarget - s.gainFrom) * elapsed;
    s.gain.gain.cancelScheduledValues(time);
    s.gain.gain.setValueAtTime(level, time);
    s.gain.gain.linearRampToValueAtTime(value, time + 0.025);
    s.gainFrom = level; s.gainTarget = value; s.gainAt = time;
  };
  const stop = ({ immediate = false } = {}) => {
    const s = active; active = null;
    if (s) {
      clearTimer(s.timer); s.queue.length = 0;
      if (!immediate && s.started && s.context?.state === "running") {
        gainTo(s, 0);
        for (const source of s.sources) { try { source.stop(s.context.currentTime + 0.03); } catch { /* Ended. */ } }
        s.closeTimer = setTimer(() => clean(s), 70);
      } else clean(s);
    }
    if (immediate) for (const pending of sessions) clean(pending);
    publish("idle");
  };
  const addSource = (s, source, gain = null) => {
    s.sources.add(source);
    source.onended = () => {
      s.sources.delete(source);
      source.disconnect(); gain?.disconnect();
    };
  };
  const makeClick = (s, time, beat) => {
    if (!s.options.sound || !s.options.volume) return;
    const context = s.context;
    const shape = s.options.voice;
    const gain = context.createGain();
    const source = context.createBufferSource();
    const key = `${shape}:${beat.strong}`;
    if (!s.buffers.has(key)) {
      const duration = shape === "hihat" ? 0.045 : 0.065;
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
      const data = buffer.getChannelData(0);
      const pitch = (beat.strong ? 1200 : 800) * (shape === "woodblock" ? 0.7 : 1);
      let previous = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / context.sampleRate;
        const sine = Math.sin(2 * Math.PI * pitch * t);
        const white = Math.random() * 2 - 1;
        const high = (white - previous) / 2; previous = white;
        const signal = shape === "hihat" ? high : shape === "click" ? white
          : shape === "rimshot" ? sine * 0.55 + high * 0.45
          : shape === "woodblock" ? (sine + Math.sin(2 * Math.PI * pitch * 1.47 * t)) / 2 : sine;
        data[i] = signal * Math.min(1, t / 0.001, (data.length - 1 - i) / (context.sampleRate * 0.005))
          * Math.exp(-t / (shape === "click" ? 0.004 : 0.012)) * 0.3;
      }
      s.buffers.set(key, buffer);
    }
    source.buffer = s.buffers.get(key);
    gain.gain.value = beat.main ? (beat.strong ? 1 : s.options.rhythm.accents ? 0.65 : 1) : 0.4;
    source.connect(gain); gain.connect(s.gain);
    addSource(s, source, gain);
    source.start(time);
  };
  const clock = (s) => s.context ? s.context.currentTime : now();
  const schedule = (s) => {
    if (active !== s || s.cleaned) return;
    if (!isVisible()) { stop({ immediate: true }); return; }
    const time = clock(s);
    if (time - s.next > 0.25) { s.next = time + 0.03; s.queue.length = 0; }
    const rhythm = s.options.rhythm;
    const step = 60 / rhythm.bpm / rhythm.subdivision;
    if (s.next < time) {
      const skipped = Math.ceil((time - s.next) / step);
      s.next += skipped * step; s.index += skipped;
    }
    while (s.next < time + 0.1) {
      const beat = beatAt(s.index++, rhythm);
      if (s.context) makeClick(s, s.next, beat);
      if (beat.main) s.queue.push({ ...beat, at: s.next });
      s.next += step;
    }
    let latest = null;
    while (s.queue.length && s.queue[0].at <= time) latest = s.queue.shift();
    if (latest && time - latest.at < 0.15) onBeat(latest);
    s.timer = setTimer(() => {
      try { schedule(s); } catch { stop({ immediate: true }); publish("error"); }
    }, 20);
  };
  const valid = (o) => Number.isFinite(o.volume) && o.volume >= 0 && o.volume <= 1 &&
    (o.kind === "noise" ? NOISE_TYPES.includes(o.noise) : o.kind === "metronome" &&
      SOUNDS.includes(o.voice) && Number.isFinite(o.rhythm?.bpm) && o.rhythm.bpm >= 20 &&
      o.rhythm.bpm <= 300 && [1, 2, 3, 4].includes(o.rhythm.subdivision) &&
      Array.isArray(o.rhythm.groups) && o.rhythm.groups.length > 0 &&
      o.rhythm.groups.every((n) => Number.isInteger(n) && n > 0) &&
      o.rhythm.groups.reduce((a, b) => a + b, 0) <= 16);
  const start = async (options) => {
    if (destroyed || !isVisible() || !valid(options)) return false;
    stop();
    // At most one fading predecessor, even during rapid preset changes.
    for (const pending of [...sessions].slice(0, -1)) clean(pending);
    const s = { options, sources: new Set(), buffers: new Map(), queue: [], index: 0,
      gainAt: 0, gainFrom: 0, gainTarget: 0 };
    active = s; sessions.add(s); publish("starting");
    try {
      if (typeof AudioContextClass === "function" && (options.kind === "noise" || options.sound)) {
        s.context = new AudioContextClass();
        s.changed = () => {
          if (active === s && s.started && s.context.state !== "running") {
            stop({ immediate: true }); publish("interrupted");
          }
        };
        s.context.addEventListener("statechange", s.changed);
        if (s.context.state !== "running") await s.context.resume();
        if (active !== s || s.cleaned) return false;
        if (!isVisible() || s.context.state !== "running") throw new Error("Audio unavailable");
        s.gain = s.context.createGain(); s.gain.gain.value = 0;
        s.gain.connect(s.context.destination);
      } else if (options.kind === "noise" || options.sound) throw new Error("Audio unsupported");
      if (options.kind === "noise") {
        if (!s.context.audioWorklet || typeof AudioWorkletNodeClass !== "function") throw new Error("Continuous audio unsupported");
        await s.context.audioWorklet.addModule(new URL("./noise-processor.js", import.meta.url));
        if (active !== s || s.cleaned) return false;
        if (!isVisible() || s.context.state !== "running") throw new Error("Audio unavailable");
        s.noiseNode = new AudioWorkletNodeClass(s.context, "practice-noise", {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { noise: options.noise },
        });
        s.noiseNode.onprocessorerror = () => {
          if (active === s) { stop({ immediate: true }); publish("error"); }
        };
        s.noiseNode.connect(s.gain);
        gainTo(s, s.options.sound ? s.options.volume : 0);
      }
      s.started = true; publish("playing");
      if (options.kind === "metronome") {
        gainTo(s, s.options.sound ? s.options.volume : 0);
        s.next = clock(s) + 0.03; schedule(s);
      }
      return true;
    } catch {
      clean(s);
      if (active === s) { active = null; publish("error"); }
      return false;
    }
  };
  const setLevel = (volume, sound) => {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) return;
    if (active) {
      active.options = { ...active.options, volume, sound: Boolean(sound) };
      gainTo(active, sound ? volume : 0);
    }
  };
  return Object.freeze({ start, stop, setLevel, getState: () => state,
    destroy() { destroyed = true; stop({ immediate: true }); },
  });
}
