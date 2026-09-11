import { createPitchDetector } from "./pitch-detector.js";

export const TAKE_ANALYSIS_LIMITS = Object.freeze({ sampleRate: 16000, maximumSeconds: 61, maximumPoints: 1220 });

// Decode one bounded local Blob at a time. This offline context never renders or connects output.
export async function analyzeTake(blob, { isCurrent = () => true,
  OfflineContext = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext,
  yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  if (typeof OfflineContext !== "function") throw new Error("Decoding is unavailable.");
  const context = new OfflineContext(1, 1, TAKE_ANALYSIS_LIMITS.sampleRate);
  const encoded = await blob.arrayBuffer();
  if (!isCurrent()) return null;
  const audio = await context.decodeAudioData(encoded);
  if (!isCurrent()) return null;
  if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 61
    || audio.sampleRate !== 16000 || audio.numberOfChannels < 1 || audio.numberOfChannels > 2
    || audio.length > 61 * 16000) throw new Error("Decoded take exceeds comparison limits.");
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const detector = createPitchDetector({ minFrequencyHz: 50, maxFrequencyHz: 2000 });
  const frame = new Float32Array(2048), points = [];
  // 50 ms bins, centered 128 ms pitch windows; silence never gains a pitch from its neighbors.
  for (let start = 0; start < audio.length && points.length < TAKE_ANALYSIS_LIMITS.maximumPoints; start += 800) {
    if (!isCurrent()) return null;
    let peak = 0, square = 0;
    const end = Math.min(audio.length, start + 800);
    for (let i = start; i < end; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      peak = Math.max(peak, Math.abs(value)); square += value * value;
    }
    const rms = Math.sqrt(square / (end - start));
    const center = Math.floor((start + end) / 2);
    for (let i = 0; i < frame.length; i++) {
      const index = center - frame.length / 2 + i;
      frame[i] = 0;
      if (index >= 0 && index < audio.length) for (const channel of channels) frame[i] += channel[index] / channels.length;
    }
    const pitch = rms >= 0.005 ? detector.detect(frame, 16000) : null;
    points.push(Object.freeze({ time: center / 16000, peak: Math.min(1, peak), rms,
      hz: pitch?.voiced && pitch.confidence >= 0.82 ? pitch.frequencyHz : null }));
    if (points.length % 16 === 0) await yieldTask();
  }
  return isCurrent() ? Object.freeze({ duration: audio.duration, points: Object.freeze(points) }) : null;
}
