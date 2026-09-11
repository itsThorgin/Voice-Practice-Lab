import { PITCH_DETECTOR_DEFAULTS } from "../config.js";

const MINIMUM_FRAME_SAMPLES = 32;
const OUT_OF_RANGE_SPECTRAL_ENERGY_RATIO = 0.995;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) {
    result *= 2;
  }
  return result;
}

function validatePositiveFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero.`);
  }
}

function resolveOptions(options = {}) {
  const resolved = {
    ...PITCH_DETECTOR_DEFAULTS,
    ...options,
  };

  validatePositiveFinite(resolved.minFrequencyHz, "Minimum frequency");
  validatePositiveFinite(resolved.maxFrequencyHz, "Maximum frequency");
  if (resolved.minFrequencyHz >= resolved.maxFrequencyHz) {
    throw new RangeError("Minimum frequency must be lower than maximum frequency.");
  }
  if (
    typeof resolved.minimumRms !== "number" ||
    !Number.isFinite(resolved.minimumRms) ||
    resolved.minimumRms < 0
  ) {
    throw new RangeError("Minimum RMS must be a finite number greater than or equal to zero.");
  }
  if (
    typeof resolved.confidenceThreshold !== "number" ||
    !Number.isFinite(resolved.confidenceThreshold) ||
    resolved.confidenceThreshold <= 0 ||
    resolved.confidenceThreshold > 1
  ) {
    throw new RangeError("Confidence threshold must be greater than zero and at most one.");
  }
  if (
    typeof resolved.harmonicImprovement !== "number" ||
    !Number.isFinite(resolved.harmonicImprovement) ||
    resolved.harmonicImprovement < 0 ||
    resolved.harmonicImprovement >= 1
  ) {
    throw new RangeError("Harmonic improvement must be at least zero and less than one.");
  }
  if (
    !Number.isInteger(resolved.minimumSamplesPerPeriod) ||
    resolved.minimumSamplesPerPeriod < 4
  ) {
    throw new RangeError("Minimum samples per period must be an integer of at least four.");
  }

  return Object.freeze(resolved);
}

export function deriveDetectionBounds(sampleRate, sampleCount, options = {}) {
  validatePositiveFinite(sampleRate, "Sample rate");
  if (!Number.isInteger(sampleCount) || sampleCount < MINIMUM_FRAME_SAMPLES) {
    throw new RangeError(`Sample count must be an integer of at least ${MINIMUM_FRAME_SAMPLES}.`);
  }

  const resolved = resolveOptions(options);
  const maximumUsefulPeriod = Math.floor(sampleCount / 2);
  const samplingLimitedMaxHz = sampleRate / resolved.minimumSamplesPerPeriod;
  const requestedMaxHz = Math.min(resolved.maxFrequencyHz, samplingLimitedMaxHz);
  const minimumPeriod = Math.max(2, Math.ceil(sampleRate / requestedMaxHz));
  const maximumPeriod = Math.min(
    maximumUsefulPeriod,
    Math.floor(sampleRate / resolved.minFrequencyHz),
  );

  if (minimumPeriod >= maximumPeriod) {
    throw new RangeError("The sample frame is too short for the requested detection bounds.");
  }

  return Object.freeze({
    maxFrequencyHz: sampleRate / minimumPeriod,
    maximumPeriod,
    minFrequencyHz: sampleRate / maximumPeriod,
    minimumPeriod,
    requestedMaxFrequencyHz: resolved.maxFrequencyHz,
    requestedMinFrequencyHz: resolved.minFrequencyHz,
    samplingLimitedMaxFrequencyHz: samplingLimitedMaxHz,
  });
}

function transform(real, imaginary, inverse) {
  const length = real.length;

  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }

  for (let width = 2; width <= length; width *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / width;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);

    for (let offset = 0; offset < length; offset += width) {
      let rotationReal = 1;
      let rotationImaginary = 0;
      const halfWidth = width / 2;

      for (let index = 0; index < halfWidth; index += 1) {
        const evenIndex = offset + index;
        const oddIndex = evenIndex + halfWidth;
        const oddReal =
          real[oddIndex] * rotationReal - imaginary[oddIndex] * rotationImaginary;
        const oddImaginary =
          real[oddIndex] * rotationImaginary + imaginary[oddIndex] * rotationReal;
        const evenReal = real[evenIndex];
        const evenImaginary = imaginary[evenIndex];

        real[evenIndex] = evenReal + oddReal;
        imaginary[evenIndex] = evenImaginary + oddImaginary;
        real[oddIndex] = evenReal - oddReal;
        imaginary[oddIndex] = evenImaginary - oddImaginary;

        const nextRotationReal =
          rotationReal * stepReal - rotationImaginary * stepImaginary;
        rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
        rotationReal = nextRotationReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

function ensureWorkspace(workspace, sampleCount, maximumPeriod) {
  const transformSize = nextPowerOfTwo(sampleCount * 2);
  if (workspace.real?.length !== transformSize) {
    workspace.real = new Float64Array(transformSize);
    workspace.imaginary = new Float64Array(transformSize);
  } else {
    workspace.real.fill(0);
    workspace.imaginary.fill(0);
  }
  if (!workspace.energyPrefix || workspace.energyPrefix.length < sampleCount + 1) {
    workspace.energyPrefix = new Float64Array(sampleCount + 1);
  }
  if (!workspace.normalizedCorrelation || workspace.normalizedCorrelation.length < maximumPeriod + 1) {
    workspace.normalizedCorrelation = new Float64Array(maximumPeriod + 1);
  }

  return workspace;
}

function isLocalMaximum(values, index, minimum, maximum) {
  const previous = index > minimum ? values[index - 1] : -1;
  const next = index < maximum ? values[index + 1] : -1;
  return values[index] >= previous && values[index] > next;
}

function findPeakNear(values, center, radius, minimum, maximum) {
  const start = Math.max(minimum, center - radius);
  const end = Math.min(maximum, center + radius);
  let bestIndex = start;

  for (let index = start + 1; index <= end; index += 1) {
    if (values[index] > values[bestIndex]) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

function refinePeak(values, index, minimum, maximum) {
  if (index <= minimum || index >= maximum) {
    return index;
  }

  const previous = values[index - 1];
  const current = values[index];
  const next = values[index + 1];
  const curvature = previous - 2 * current + next;
  if (Math.abs(curvature) < Number.EPSILON) {
    return index;
  }

  return index + clamp(0.5 * (previous - next) / curvature, -1, 1);
}

function unvoicedResult(reason, rms = 0, confidence = 0, bounds = null) {
  return Object.freeze({
    bounds,
    confidence: clamp(confidence, 0, 1),
    frequencyHz: null,
    periodSamples: null,
    reason,
    rms,
    voiced: false,
  });
}

function runDetection(samples, sampleRate, options, workspace) {
  if (!samples || typeof samples.length !== "number") {
    throw new TypeError("Samples must be an array-like collection of numbers.");
  }
  validatePositiveFinite(sampleRate, "Sample rate");
  const resolved = resolveOptions(options);

  if (!Number.isInteger(samples.length) || samples.length < MINIMUM_FRAME_SAMPLES) {
    return unvoicedResult("insufficient-samples");
  }

  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (typeof sample !== "number" || !Number.isFinite(sample)) {
      throw new RangeError("Every sample must be a finite number.");
    }
    mean += sample;
  }
  mean /= samples.length;

  const bounds = deriveDetectionBounds(sampleRate, samples.length, resolved);
  const buffers = ensureWorkspace(workspace, samples.length, bounds.maximumPeriod);
  const { energyPrefix, imaginary, normalizedCorrelation, real } = buffers;
  let sumOfSquares = 0;

  energyPrefix[0] = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centeredSample = samples[index] - mean;
    real[index] = centeredSample;
    sumOfSquares += centeredSample * centeredSample;
    energyPrefix[index + 1] = sumOfSquares;
  }

  const rms = Math.sqrt(sumOfSquares / samples.length);
  if (rms < resolved.minimumRms) {
    return unvoicedResult("below-level", rms, 0, bounds);
  }

  transform(real, imaginary, false);
  let outOfRangeSpectralEnergy = 0;
  let spectralEnergy = 0;
  const frequencyPerBin = sampleRate / real.length;
  for (let index = 0; index < real.length; index += 1) {
    const power = real[index] * real[index] + imaginary[index] * imaginary[index];
    real[index] = power;
    imaginary[index] = 0;
    if (index > 0 && index <= real.length / 2) {
      spectralEnergy += power;
      if (index * frequencyPerBin > bounds.maxFrequencyHz) {
        outOfRangeSpectralEnergy += power;
      }
    }
  }
  if (
    spectralEnergy > Number.EPSILON &&
    outOfRangeSpectralEnergy / spectralEnergy >= OUT_OF_RANGE_SPECTRAL_ENERGY_RATIO
  ) {
    return unvoicedResult("above-safe-range", rms, 0, bounds);
  }
  transform(real, imaginary, true);

  normalizedCorrelation[0] = 1;
  for (let period = 1; period <= bounds.maximumPeriod; period += 1) {
    const leadingEnergy = energyPrefix[samples.length - period];
    const trailingEnergy = energyPrefix[samples.length] - energyPrefix[period];
    const denominator = leadingEnergy + trailingEnergy;
    normalizedCorrelation[period] =
      denominator > Number.EPSILON ? clamp((2 * real[period]) / denominator, -1, 1) : 0;
  }

  let candidatePeriod = null;
  let strongestPeriod = bounds.minimumPeriod;
  for (let period = bounds.minimumPeriod; period <= bounds.maximumPeriod; period += 1) {
    if (normalizedCorrelation[period] > normalizedCorrelation[strongestPeriod]) {
      strongestPeriod = period;
    }
    if (
      candidatePeriod === null &&
      normalizedCorrelation[period] >= resolved.confidenceThreshold &&
      isLocalMaximum(
        normalizedCorrelation,
        period,
        1,
        bounds.maximumPeriod,
      )
    ) {
      candidatePeriod = period;
    }
  }

  if (candidatePeriod === null) {
    return unvoicedResult(
      "low-confidence",
      rms,
      normalizedCorrelation[strongestPeriod],
      bounds,
    );
  }

  candidatePeriod = findPeakNear(
    normalizedCorrelation,
    candidatePeriod,
    Math.max(1, Math.round(candidatePeriod * 0.03)),
    bounds.minimumPeriod,
    bounds.maximumPeriod,
  );
  let candidateConfidence = normalizedCorrelation[candidatePeriod];

  if (bounds.minimumPeriod > 2) {
    let excludedPeriod = null;
    for (let period = 2; period < bounds.minimumPeriod; period += 1) {
      if (
        isLocalMaximum(normalizedCorrelation, period, 1, bounds.minimumPeriod - 1) &&
        (excludedPeriod === null ||
          normalizedCorrelation[period] > normalizedCorrelation[excludedPeriod])
      ) {
        excludedPeriod = period;
      }
    }

    if (excludedPeriod !== null) {
      const excludedConfidence = normalizedCorrelation[excludedPeriod];
      let hasNegativeLeadIn = false;
      for (let period = 1; period < excludedPeriod; period += 1) {
        if (normalizedCorrelation[period] < 0) {
          hasNegativeLeadIn = true;
          break;
        }
      }
      if (
        excludedConfidence >= resolved.confidenceThreshold &&
        hasNegativeLeadIn
      ) {
        return unvoicedResult("above-safe-range", rms, candidateConfidence, bounds);
      }
    }
  }

  const initialPeriod = candidatePeriod;
  const maximumMultiple = Math.floor(bounds.maximumPeriod / initialPeriod);
  for (let multiple = 2; multiple <= maximumMultiple; multiple += 1) {
    const target = initialPeriod * multiple;
    const radius = Math.max(1, Math.round(initialPeriod * 0.03));
    const multiplePeriod = findPeakNear(
      normalizedCorrelation,
      target,
      radius,
      bounds.minimumPeriod,
      bounds.maximumPeriod,
    );
    const multipleConfidence = normalizedCorrelation[multiplePeriod];
    if (multipleConfidence >= candidateConfidence + resolved.harmonicImprovement) {
      candidatePeriod = multiplePeriod;
      candidateConfidence = multipleConfidence;
    }
  }

  if (candidateConfidence < resolved.confidenceThreshold) {
    return unvoicedResult("low-confidence", rms, candidateConfidence, bounds);
  }

  const refinedPeriod = refinePeak(
    normalizedCorrelation,
    candidatePeriod,
    bounds.minimumPeriod,
    bounds.maximumPeriod,
  );
  const frequencyHz = sampleRate / refinedPeriod;
  if (frequencyHz < bounds.minFrequencyHz || frequencyHz > bounds.maxFrequencyHz) {
    return unvoicedResult("outside-effective-range", rms, candidateConfidence, bounds);
  }

  return Object.freeze({
    bounds,
    confidence: clamp(candidateConfidence, 0, 1),
    frequencyHz,
    periodSamples: refinedPeriod,
    reason: null,
    rms,
    voiced: true,
  });
}

export function detectPitch(samples, sampleRate, options = {}) {
  return runDetection(samples, sampleRate, options, {});
}

export function createPitchDetector(defaultOptions = {}) {
  const resolvedDefaults = resolveOptions(defaultOptions);
  const workspace = {};

  return Object.freeze({
    detect(samples, sampleRate, options = {}) {
      return runDetection(samples, sampleRate, { ...resolvedDefaults, ...options }, workspace);
    },
  });
}
