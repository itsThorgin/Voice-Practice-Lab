import {
  DEFAULT_ANALYSIS_SAMPLE_COUNT,
  SPECTRUM_DEFAULTS,
} from "../config.js";

export const DEFAULT_ANALYSER_FFT_SIZE = DEFAULT_ANALYSIS_SAMPLE_COUNT;
export const DEFAULT_LEVEL_FLOOR_DB = -60;

export function computeRms(samples) {
  if (!samples || typeof samples.length !== "number") {
    throw new TypeError("Samples must be an array-like collection of numbers.");
  }
  if (samples.length === 0) {
    return 0;
  }

  let sumOfSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (typeof sample !== "number" || !Number.isFinite(sample)) {
      throw new RangeError("Every sample must be a finite number.");
    }
    sumOfSquares += sample * sample;
  }

  return Math.sqrt(sumOfSquares / samples.length);
}

export function rmsToDecibels(rms, floorDb = DEFAULT_LEVEL_FLOOR_DB) {
  if (typeof rms !== "number" || !Number.isFinite(rms) || rms < 0) {
    throw new RangeError("RMS must be a finite number greater than or equal to zero.");
  }
  if (typeof floorDb !== "number" || !Number.isFinite(floorDb) || floorDb >= 0) {
    throw new RangeError("The decibel floor must be a finite negative number.");
  }
  if (rms === 0) {
    return floorDb;
  }

  return Math.max(floorDb, Math.min(0, 20 * Math.log10(rms)));
}

export function rmsToLevel(rms, floorDb = DEFAULT_LEVEL_FLOOR_DB) {
  const decibels = rmsToDecibels(rms, floorDb);
  return (decibels - floorDb) / -floorDb;
}

function validateFftSize(fftSize) {
  const isPowerOfTwo = Number.isInteger(fftSize) && (fftSize & (fftSize - 1)) === 0;
  if (!isPowerOfTwo || fftSize < 32 || fftSize > 32768) {
    throw new RangeError("Analyser FFT size must be a power of two from 32 to 32768.");
  }
}

export function createAnalyserSession({
  audioContext,
  fftSize = DEFAULT_ANALYSER_FFT_SIZE,
  sourceNode,
} = {}) {
  if (!audioContext || typeof audioContext.createAnalyser !== "function") {
    throw new TypeError("An AudioContext with createAnalyser is required.");
  }
  if (!sourceNode || typeof sourceNode.connect !== "function") {
    throw new TypeError("A connectable microphone source node is required.");
  }
  validateFftSize(fftSize);

  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = fftSize;
  analyserNode.minDecibels = SPECTRUM_DEFAULTS.floorDb;
  analyserNode.maxDecibels = SPECTRUM_DEFAULTS.ceilingDb;
  analyserNode.smoothingTimeConstant = SPECTRUM_DEFAULTS.smoothingTimeConstant;
  const samples = new Float32Array(analyserNode.fftSize);
  const supportsFloatSamples = typeof analyserNode.getFloatTimeDomainData === "function";
  const byteSamples = supportsFloatSamples ? null : new Uint8Array(analyserNode.fftSize);
  const frequencyBinCount = analyserNode.frequencyBinCount || analyserNode.fftSize / 2;
  const frequencySamples = new Float32Array(frequencyBinCount);
  const supportsFloatFrequency = typeof analyserNode.getFloatFrequencyData === "function";
  const byteFrequencySamples = supportsFloatFrequency
    ? null
    : new Uint8Array(frequencyBinCount);
  let disconnected = false;

  sourceNode.connect(analyserNode);

  return Object.freeze({
    analyserNode,

    disconnect() {
      if (disconnected) {
        return;
      }
      disconnected = true;

      try {
        sourceNode.disconnect(analyserNode);
      } catch {
        // The microphone may already have disconnected every output during teardown.
      }
      try {
        analyserNode.disconnect();
      } catch {
        // A detached analyser has no remaining resource to release.
      }
      samples.fill(0);
      frequencySamples.fill(SPECTRUM_DEFAULTS.floorDb);
    },

    readFrequencyDomainSamples() {
      if (disconnected) {
        return frequencySamples;
      }

      if (supportsFloatFrequency) {
        analyserNode.getFloatFrequencyData(frequencySamples);
      } else if (typeof analyserNode.getByteFrequencyData === "function") {
        analyserNode.getByteFrequencyData(byteFrequencySamples);
        const decibelRange = SPECTRUM_DEFAULTS.ceilingDb - SPECTRUM_DEFAULTS.floorDb;
        for (let index = 0; index < byteFrequencySamples.length; index += 1) {
          frequencySamples[index] =
            SPECTRUM_DEFAULTS.floorDb +
            (byteFrequencySamples[index] / 255) * decibelRange;
        }
      } else {
        frequencySamples.fill(SPECTRUM_DEFAULTS.floorDb);
      }

      return frequencySamples;
    },

    readTimeDomainSamples() {
      if (disconnected) {
        return samples;
      }

      if (supportsFloatSamples) {
        analyserNode.getFloatTimeDomainData(samples);
      } else if (typeof analyserNode.getByteTimeDomainData === "function") {
        analyserNode.getByteTimeDomainData(byteSamples);
        for (let index = 0; index < byteSamples.length; index += 1) {
          samples[index] = (byteSamples[index] - 128) / 128;
        }
      } else {
        samples.fill(0);
      }

      return samples;
    },
  });
}
