import { NOISE_TYPES } from "../practice/rhythm.js";

// State survives every audio block. No loop, block normalization or sample buffer.
export function createNoiseGenerator(type, sampleRate, random = Math.random) {
  if (!NOISE_TYPES.includes(type) || !Number.isFinite(sampleRate) || sampleRate < 8000 ||
      sampleRate > 192000 || typeof random !== "function") {
    throw new RangeError("Unsupported noise settings");
  }
  const filters = Array.from({ length: 11 }, (_, i) => {
    const a = Math.exp(-2 * Math.PI * (10 * 2 ** i) / sampleRate);
    return { a, value: 0, weight: 1 / Math.sqrt(1 - a) };
  });
  const brownA = Math.exp(-2 * Math.PI * 8 / sampleRate);
  let brown = 0;
  // Fixed expected RMS includes covariance: the pink filters share input.
  // Unlike per-buffer normalization, this cannot pump at a segment boundary.
  let variance = 1 / 3;
  if (type === "brown") variance /= 1 - brownA * brownA;
  if (type === "pink") {
    variance = 0;
    for (const f of filters) for (const g of filters) {
      variance += f.weight * g.weight * (1 - f.a) * (1 - g.a) / (3 * (1 - f.a * g.a));
    }
  }
  const scale = 0.18 / Math.sqrt(variance);
  return Object.freeze({
    fill(output) {
      for (let i = 0; i < output.length; i++) {
        const white = random() * 2 - 1;
        let value = white;
        if (type === "brown") {
          brown = brownA * brown + white;
          value = brown;
        } else if (type === "pink") {
          value = 0;
          for (const filter of filters) {
            filter.value = filter.a * filter.value + (1 - filter.a) * white;
            value += filter.value * filter.weight;
          }
        }
        value *= scale;
        // Smoothly contain rare peaks, with no hard clipping of ordinary noise.
        const magnitude = Math.abs(value);
        output[i] = magnitude <= 0.8 ? value
          : Math.sign(value) * (0.8 + 0.15 * Math.tanh((magnitude - 0.8) / 0.15));
      }
    },
  });
}
