export const PITCH_DETECTOR_DEFAULTS = Object.freeze({
  confidenceThreshold: 0.82,
  harmonicImprovement: 0.04,
  maxFrequencyHz: 8372.02,
  minFrequencyHz: 16.35,
  minimumRms: 0.005,
  minimumSamplesPerPeriod: 8,
});

export const PITCH_VALIDATION_RANGE = Object.freeze({
  bestEffortMaxHz: 8372.02,
  intendedMaxHz: 4186.01,
  intendedMinHz: 16.35,
  strongestValidationMaxHz: 2000,
  strongestValidationMinHz: 25,
});

export const DEFAULT_ANALYSIS_SAMPLE_COUNT = 8192;

export const PITCH_SMOOTHING_DEFAULTS = Object.freeze({
  confidenceThreshold: PITCH_DETECTOR_DEFAULTS.confidenceThreshold,
  maximumHistorySize: 256,
  medianWindowSize: 3,
  minimumStabilitySamples: 3,
  noteChangeThresholdCents: 80,
  octaveConfirmationFrames: 2,
  octaveToleranceCents: 80,
  silenceResetMs: 250,
  smoothingFactor: 0.35,
  stabilityWindowMs: 1000,
  transitionConsistencyCents: 50,
});

export const HELD_NOTE_DEFAULTS = Object.freeze({
  confidenceThreshold: PITCH_DETECTOR_DEFAULTS.confidenceThreshold,
  gracePeriodMs: 120,
  toleranceCents: 20,
});

export const PITCH_TOLERANCE_OPTIONS_CENTS = Object.freeze([20, 10, 5]);

export const TUNER_DEFAULTS = Object.freeze({
  analysisIntervalMs: 50,
  inTuneCents: 5,
  meterRangeCents: 50,
  slightlyOutCents: 20,
});

export const PITCH_HISTORY_DEFAULTS = Object.freeze({
  durationMs: 8000,
  gapThresholdMs: 150,
  maximumSamples: 512,
  minimumNoteSpanSemitones: 4,
  targetRangeCents: 50,
});

export const SPECTRUM_DEFAULTS = Object.freeze({
  ceilingDb: -20,
  floorDb: -90,
  maximumFrequencyHz: 5000,
  minimumFrequencyHz: 50,
  renderIntervalMs: 50,
  smoothingTimeConstant: 0.65,
});

export const TARGET_DEFAULTS = Object.freeze({
  exactMaximumFrequencyHz: PITCH_VALIDATION_RANGE.bestEffortMaxHz,
  exactMinimumFrequencyHz: PITCH_VALIDATION_RANGE.intendedMinHz,
  maximumNoteOctave: 8,
  minimumNoteOctave: 0,
  targetWaveDurationMs: 20,
  targetWaveMaximumPointCount: 4096,
  targetWaveMinimumPointsPerCycle: 12,
  targetWavePointCount: 256,
});
