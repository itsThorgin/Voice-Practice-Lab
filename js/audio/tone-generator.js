import { TARGET_DEFAULTS } from "../config.js";
import { MAX_A4_HZ, MIN_A4_HZ, noteToFrequency } from "../music/tuning.js";

export const TONE_ENVELOPE = Object.freeze({
  attackSeconds: 0.02,
  releaseSeconds: 0.04,
  peakGain: 0.06,
});

const minimumHz = noteToFrequency(`C${TARGET_DEFAULTS.minimumNoteOctave}`, MIN_A4_HZ);
const maximumHz = Math.max(TARGET_DEFAULTS.exactMaximumFrequencyHz,
  noteToFrequency(`B${TARGET_DEFAULTS.maximumNoteOctave}`, MAX_A4_HZ));

// This controller owns only its output graph. It never receives microphone nodes.
export function createToneGenerator({
  AudioContextClass,
  isPageVisible = () => true,
  onStateChange = () => {},
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  const supported = typeof AudioContextClass === "function";
  let state = supported ? "idle" : "unsupported";
  let current = null;
  let destroyed = false;
  const sessions = new Set();

  const publish = (next) => {
    state = next;
    try { onStateChange(next); } catch { /* UI failure must not interrupt cleanup. */ }
  };

  const clean = (session) => {
    if (session.cleaned) return;
    session.cleaned = true;
    sessions.delete(session);
    clearTimer(session.timer);
    session.context?.removeEventListener?.("statechange", session.onContextState);
    if (session.oscillator) {
      session.oscillator.onended = null;
      try { session.oscillator.stop(); } catch { /* Already stopped or not started. */ }
      try { session.oscillator.disconnect(); } catch { /* Still close the context. */ }
    }
    try { session.gain?.disconnect(); } catch { /* Still close the context. */ }
    try {
      if (session.context && session.context.state !== "closed") {
        Promise.resolve(session.context.close()).catch(() => {});
      }
    } catch { /* Nodes have already been disconnected. */ }
  };

  const stop = ({ immediate = false } = {}) => {
    const session = current;
    current = null; // Invalidate a pending resume before any asynchronous work completes.
    if (session) {
      if (immediate || !session.started || session.context.state !== "running") {
        clean(session);
      } else {
        try {
          const now = session.context.currentTime;
          const level = TONE_ENVELOPE.peakGain * Math.min(
            1, Math.max(0, (now - session.startedAt) / TONE_ENVELOPE.attackSeconds),
          );
          const gain = session.gain.gain;
          // Rebuild the interrupted attack's endpoint to preserve its past ramp,
          // including in browsers without cancelAndHoldAtTime.
          gain.cancelScheduledValues(now);
          gain.linearRampToValueAtTime(level, now);
          gain.linearRampToValueAtTime(0, now + TONE_ENVELOPE.releaseSeconds);
          session.oscillator.stop(now + TONE_ENVELOPE.releaseSeconds);
          session.timer = setTimer(() => clean(session), 160);
        } catch {
          clean(session);
        }
      }
      publish("idle");
    }
    if (immediate) {
      for (const pending of sessions) clean(pending);
    }
  };

  const start = async (frequencyHz) => {
    if (destroyed || !supported || current || !isPageVisible()) return false;
    if (!Number.isFinite(frequencyHz) || frequencyHz < minimumHz ||
        frequencyHz > maximumHz) {
      publish("invalid-frequency");
      return false;
    }
    const session = { cleaned: false, started: false, timer: null };
    current = session;
    sessions.add(session);
    publish("starting");
    try {
      // One short-lived context per hold keeps output independent of permission,
      // microphone suspension, and an older hold's delayed resume or close.
      session.context = new AudioContextClass();
      const context = session.context;
      if (!Number.isFinite(context.sampleRate) || frequencyHz >= context.sampleRate / 2) {
        clean(session);
        current = null;
        publish("invalid-frequency");
        return false;
      }
      session.onContextState = () => {
        if (session.started && context.state !== "running") {
          if (current === session) {
            current = null;
            clean(session);
            publish("interrupted");
          } else {
            clean(session);
          }
        }
      };
      context.addEventListener?.("statechange", session.onContextState);
      if (context.state !== "running") await context.resume();
      if (current !== session || session.cleaned || destroyed || !isPageVisible()) {
        clean(session);
        if (current === session) { current = null; publish("idle"); }
        return false;
      }
      if (context.state !== "running") throw new Error("Audio is suspended.");
      session.oscillator = context.createOscillator();
      session.gain = context.createGain();
      session.startedAt = context.currentTime;
      session.oscillator.type = "sine";
      session.oscillator.frequency.setValueAtTime(frequencyHz, session.startedAt);
      session.gain.gain.setValueAtTime(0, session.startedAt);
      session.oscillator.connect(session.gain);
      session.gain.connect(context.destination);
      session.oscillator.onended = () => {
        clean(session);
        if (current === session) { current = null; publish("idle"); }
      };
      session.gain.gain.linearRampToValueAtTime(
        TONE_ENVELOPE.peakGain, session.startedAt + TONE_ENVELOPE.attackSeconds,
      );
      session.oscillator.start(session.startedAt);
      session.started = true;
      publish("playing");
      return true;
    } catch {
      clean(session);
      if (current === session) { current = null; publish("error"); }
      return false;
    }
  };

  return Object.freeze({
    getState: () => state,
    start,
    stop,
    destroy() { destroyed = true; stop({ immediate: true }); },
  });
}
