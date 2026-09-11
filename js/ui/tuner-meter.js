import { TUNER_DEFAULTS } from "../config.js";
import { centsDeviation, frequencyToNote } from "../music/tuning.js";

const REQUIRED_SELECTORS = Object.freeze({
  cents: "[data-tuner-cents]",
  confidence: "[data-tuner-confidence]",
  frequency: "[data-tuner-frequency]",
  guidance: "[data-tuner-guidance]",
  guidanceTerm: "[data-tuner-guidance-term]",
  held: "[data-tuner-held]",
  heldDuration: "[data-tuner-held-duration]",
  liveStatus: "[data-tuner-live-status]",
  marker: "[data-tuner-marker]",
  meter: "[data-tuner-meter]",
  note: "[data-tuner-note]",
  precision: "[data-tuner-precision]",
  stability: "[data-tuner-stability]",
  state: "[data-tuner-state]",
  target: "[data-tuner-target]",
  targetFrequency: "[data-tuner-target-frequency]",
  targetNote: "[data-tuner-target-note]",
  voiced: "[data-tuner-voiced]",
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number.`);
  }
}

function validatePositiveFinite(value, label) {
  validateFinite(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
}

function validateConfidence(confidence) {
  validateFinite(confidence, "Confidence");
  if (confidence < 0 || confidence > 1) {
    throw new RangeError("Confidence must be from zero to one.");
  }
}

function pluralizeCents(value) {
  return value === 1 ? "cent" : "cents";
}

function roundedCents(value) {
  return Math.round(Math.abs(value));
}

function formatFrequency(frequencyHz) {
  return `${frequencyHz < 100 ? frequencyHz.toFixed(2) : frequencyHz.toFixed(1)} Hz`;
}

function formatSignedCents(cents) {
  const rounded = Math.round(cents);
  if (rounded > 0) {
    return `+${rounded}¢`;
  }
  if (rounded < 0) {
    return `−${Math.abs(rounded)}¢`;
  }
  return "0¢";
}

function resolveMeterOptions(options = {}) {
  const resolved = { ...TUNER_DEFAULTS, ...options };
  validatePositiveFinite(resolved.inTuneCents, "In-tune threshold");
  validatePositiveFinite(resolved.slightlyOutCents, "Slight-deviation threshold");
  validatePositiveFinite(resolved.meterRangeCents, "Meter range");
  if (resolved.inTuneCents >= resolved.slightlyOutCents) {
    throw new RangeError("The in-tune threshold must be lower than the slight-deviation threshold.");
  }
  if (resolved.slightlyOutCents >= resolved.meterRangeCents) {
    throw new RangeError("The slight-deviation threshold must be lower than the meter range.");
  }
  return resolved;
}

export function classifyTuning(cents, options = {}) {
  validateFinite(cents, "Cents deviation");
  const resolved = resolveMeterOptions(options);
  let state;
  let guidance;
  let secondaryTerm;

  if (cents < -resolved.slightlyOutCents) {
    state = "too-low";
    guidance = "Too low: raise your pitch.";
    secondaryTerm = "Flat";
  } else if (cents < -resolved.inTuneCents) {
    state = "slightly-low";
    guidance = "A little low: raise your pitch slightly.";
    secondaryTerm = "Slightly flat";
  } else if (cents <= resolved.inTuneCents) {
    state = "on-note";
    guidance = "On the note: hold it steady.";
    secondaryTerm = "In tune";
  } else if (cents <= resolved.slightlyOutCents) {
    state = "slightly-high";
    guidance = "A little high: lower your pitch slightly.";
    secondaryTerm = "Slightly sharp";
  } else {
    state = "too-high";
    guidance = "Too high: lower your pitch.";
    secondaryTerm = "Sharp";
  }

  const outOfRange =
    cents < -resolved.meterRangeCents
      ? "low"
      : cents > resolved.meterRangeCents
        ? "high"
        : null;
  const meterValueCents = clamp(
    cents,
    -resolved.meterRangeCents,
    resolved.meterRangeCents,
  );

  return Object.freeze({
    guidance,
    meterPositionPercent:
      ((meterValueCents + resolved.meterRangeCents) / (resolved.meterRangeCents * 2)) *
      100,
    meterValueCents,
    outOfRange,
    secondaryTerm,
    state,
  });
}

export function createUnavailableTunerView({
  confidence = null,
  message = "Start the microphone to begin tuning.",
  status = "idle",
  target = null,
} = {}) {
  if (confidence !== null) {
    validateConfidence(confidence);
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new TypeError("Unavailable tuner message must be a non-empty string.");
  }

  const resolvedTarget = validateTarget(target);
  return Object.freeze({
    announcement: message,
    available: false,
    cents: null,
    centsText: "-",
    confidenceText: confidence === null ? "-" : `${Math.round(confidence * 100)}%`,
    detectedNote: "-",
    frequencyText: "-",
    guidance: message,
    heldDurationText: "-",
    heldVisible: false,
    meter: Object.freeze({
      ariaValueText: message,
      meterPositionPercent: 50,
      meterValueCents: 0,
      outOfRange: null,
      state: "unavailable",
    }),
    precision: "No reliable pitch is available yet.",
    secondaryTerm: "Waiting",
    stabilityText: "-",
    status,
    target: resolvedTarget
      ? Object.freeze({
          frequencyText: formatFrequency(resolvedTarget.frequencyHz),
          label: resolvedTarget.label,
        })
      : null,
    voicedText: "No pitch detected",
  });
}

function unavailableMessageForReason(reason) {
  switch (reason) {
    case "below-level":
      return "No pitch detected.";
    case "above-safe-range":
    case "outside-effective-range":
      return "No reliable pitch detected at this frequency.";
    case "paused":
      return "Pitch analysis is paused.";
    default:
      return "No reliable pitch detected. Try a steady note.";
  }
}

function validateTarget(target) {
  if (target === null || target === undefined) {
    return null;
  }
  if (typeof target !== "object") {
    throw new TypeError("Target must be an object when provided.");
  }
  validatePositiveFinite(target.frequencyHz, "Target frequency");
  if (typeof target.label !== "string" || !target.label.trim()) {
    throw new TypeError("Target label must be a non-empty string.");
  }
  return Object.freeze({ frequencyHz: target.frequencyHz, label: target.label.trim() });
}

export function createTunerViewModel(
  pitchFrame,
  { a4Hz, heldState = null, meterOptions, target = null } = {},
) {
  if (!pitchFrame || typeof pitchFrame !== "object") {
    throw new TypeError("Pitch frame must be an object.");
  }
  if (typeof pitchFrame.voiced !== "boolean") {
    throw new TypeError("Pitch frame voiced state must be boolean.");
  }
  validateConfidence(pitchFrame.confidence);

  if (!pitchFrame.voiced) {
    return createUnavailableTunerView({
      confidence: pitchFrame.confidence,
      message: unavailableMessageForReason(pitchFrame.reason),
      status: "listening",
      target,
    });
  }

  validatePositiveFinite(pitchFrame.frequencyHz, "Pitch frequency");
  if (
    pitchFrame.stabilityCents !== null &&
    pitchFrame.stabilityCents !== undefined
  ) {
    validateFinite(pitchFrame.stabilityCents, "Pitch stability");
    if (pitchFrame.stabilityCents < 0) {
      throw new RangeError("Pitch stability must not be negative.");
    }
  }
  const resolvedTarget = validateTarget(target);
  const detected = frequencyToNote(pitchFrame.frequencyHz, a4Hz);
  const comparisonFrequencyHz = resolvedTarget?.frequencyHz ?? detected.frequencyHz;
  const comparisonLabel = resolvedTarget?.label ?? detected.name;
  const cents = centsDeviation(pitchFrame.frequencyHz, comparisonFrequencyHz);
  const meter = classifyTuning(cents, meterOptions);
  const absoluteRoundedCents = roundedCents(cents);
  const relationship =
    absoluteRoundedCents === 0
      ? `Centered on ${comparisonLabel}.`
      : `${absoluteRoundedCents} ${pluralizeCents(absoluteRoundedCents)} ${
          cents < 0 ? "below" : "above"
        } ${comparisonLabel}.`;
  const heldDurationMs = resolvedTarget ? heldState?.heldDurationMs ?? 0 : 0;
  if (resolvedTarget) {
    validateFinite(heldDurationMs, "Held duration");
    if (heldDurationMs < 0) {
      throw new RangeError("Held duration must not be negative.");
    }
  }

  return Object.freeze({
    announcement: `${detected.name}. ${meter.guidance}`,
    available: true,
    cents,
    centsText: formatSignedCents(cents),
    confidenceText: `${Math.round(pitchFrame.confidence * 100)}%`,
    detectedNote: detected.name,
    frequencyText: formatFrequency(pitchFrame.frequencyHz),
    guidance: meter.guidance,
    heldDurationText: resolvedTarget ? `${(heldDurationMs / 1000).toFixed(1)} s` : "-",
    heldVisible: resolvedTarget !== null,
    meter: Object.freeze({
      ...meter,
      ariaValueText: `${formatSignedCents(cents)}. ${meter.guidance}`,
    }),
    precision: relationship,
    secondaryTerm: meter.secondaryTerm,
    stabilityText:
      pitchFrame.stabilityCents === null || pitchFrame.stabilityCents === undefined
        ? "Gathering…"
        : `±${Math.round(pitchFrame.stabilityCents)} cents`,
    status: "active",
    target: resolvedTarget
      ? Object.freeze({
          frequencyText: formatFrequency(resolvedTarget.frequencyHz),
          label: resolvedTarget.label,
        })
      : null,
    voicedText: "Pitch detected",
  });
}

function setText(element, value) {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

export function renderTunerView(elements, view) {
  if (!elements || typeof elements !== "object" || !elements.root) {
    throw new TypeError("Tuner elements are required.");
  }
  if (!view || typeof view !== "object") {
    throw new TypeError("A tuner view model is required.");
  }

  elements.root.dataset.status = view.status;
  elements.root.dataset.tuning = view.meter.state;
  elements.root.dataset.outOfRange = view.meter.outOfRange ?? "false";
  setText(elements.state, view.available ? "Listening live" : view.guidance);
  setText(elements.note, view.detectedNote);
  setText(elements.frequency, view.frequencyText);
  setText(elements.cents, view.centsText);
  setText(elements.precision, view.precision);
  setText(elements.guidance, view.guidance);
  setText(elements.guidanceTerm, view.secondaryTerm);
  setText(elements.confidence, view.confidenceText);
  setText(elements.stability, view.stabilityText);
  setText(elements.voiced, view.voicedText);

  elements.marker.hidden = !view.available;
  elements.marker.style.setProperty(
    "--meter-position",
    `${view.meter.meterPositionPercent}%`,
  );
  elements.meter.setAttribute("aria-valuetext", view.meter.ariaValueText);
  elements.meter.setAttribute("aria-hidden", String(!view.available));
  if (view.available) {
    elements.meter.setAttribute("aria-valuenow", String(view.meter.meterValueCents));
  } else {
    elements.meter.removeAttribute("aria-valuenow");
  }

  elements.target.hidden = view.target === null;
  setText(elements.targetNote, view.target?.label ?? "-");
  setText(elements.targetFrequency, view.target?.frequencyText ?? "-");
  // Keep the statistics grid stable across voice/silence transitions.
  elements.held.hidden = false;
  setText(elements.heldDuration, view.heldDurationText);
  setText(elements.liveStatus, view.announcement);
  return view;
}

export function createTunerPresenter(root) {
  if (!root || typeof root.querySelector !== "function") {
    throw new TypeError("A tuner root element is required.");
  }
  const elements = { root };
  for (const [name, selector] of Object.entries(REQUIRED_SELECTORS)) {
    const element = root.querySelector(selector);
    if (!element) {
      throw new Error(`Missing tuner element: ${selector}`);
    }
    elements[name] = element;
  }

  return Object.freeze({
    render(view) {
      return renderTunerView(elements, view);
    },
  });
}
