import { SPECTRUM_DEFAULTS } from "../config.js";
import { resizeCanvas } from "./canvas.js";

const FREQUENCY_TICKS_HZ = Object.freeze([
  50,
  100,
  200,
  500,
  1000,
  2000,
  5000,
  10000,
]);

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

function resolveOptions(options = {}) {
  const resolved = { ...SPECTRUM_DEFAULTS, ...options };
  validateFinite(resolved.floorDb, "Spectrum decibel floor");
  validateFinite(resolved.ceilingDb, "Spectrum decibel ceiling");
  if (resolved.floorDb >= resolved.ceilingDb || resolved.ceilingDb > 0) {
    throw new RangeError("Spectrum decibel bounds must increase toward a ceiling at or below 0 dB.");
  }
  validatePositiveFinite(resolved.minimumFrequencyHz, "Spectrum minimum frequency");
  validatePositiveFinite(resolved.maximumFrequencyHz, "Spectrum maximum frequency");
  if (resolved.minimumFrequencyHz >= resolved.maximumFrequencyHz) {
    throw new RangeError("Spectrum minimum frequency must be below its maximum frequency.");
  }
  validatePositiveFinite(resolved.renderIntervalMs, "Spectrum render interval");
  validateFinite(resolved.smoothingTimeConstant, "Spectrum smoothing constant");
  if (resolved.smoothingTimeConstant < 0 || resolved.smoothingTimeConstant > 1) {
    throw new RangeError("Spectrum smoothing constant must be from zero to one.");
  }
  return Object.freeze(resolved);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function frequencyToLogPosition(frequencyHz, minimumFrequencyHz, maximumFrequencyHz) {
  validatePositiveFinite(frequencyHz, "Frequency");
  validatePositiveFinite(minimumFrequencyHz, "Minimum frequency");
  validatePositiveFinite(maximumFrequencyHz, "Maximum frequency");
  if (minimumFrequencyHz >= maximumFrequencyHz) {
    throw new RangeError("Minimum frequency must be below maximum frequency.");
  }
  const position =
    Math.log(frequencyHz / minimumFrequencyHz) /
    Math.log(maximumFrequencyHz / minimumFrequencyHz);
  return clamp(position, 0, 1);
}

function formatFrequency(frequencyHz) {
  if (frequencyHz >= 1000) {
    return `${Number((frequencyHz / 1000).toFixed(1))} kHz`;
  }
  return `${Math.round(frequencyHz)} Hz`;
}

function resolveMagnitudeWorkspace(workspace, columnCount, floorDb) {
  const magnitudesDb =
    workspace instanceof Float32Array && workspace.length >= columnCount
      ? workspace
      : new Float32Array(columnCount);
  magnitudesDb.fill(floorDb, 0, columnCount);
  return magnitudesDb;
}

export function buildSpectrumPlot(frequencyData, {
  ceilingDb = SPECTRUM_DEFAULTS.ceilingDb,
  fftSize,
  floorDb = SPECTRUM_DEFAULTS.floorDb,
  height,
  magnitudeWorkspace,
  maximumFrequencyHz = SPECTRUM_DEFAULTS.maximumFrequencyHz,
  minimumFrequencyHz = SPECTRUM_DEFAULTS.minimumFrequencyHz,
  sampleRate,
  width,
} = {}) {
  if (!frequencyData || typeof frequencyData.length !== "number" || frequencyData.length === 0) {
    throw new TypeError("Spectrum frequency data must be a non-empty array-like collection.");
  }
  validatePositiveFinite(sampleRate, "Spectrum sample rate");
  if (!Number.isInteger(fftSize) || fftSize < 2 || fftSize !== frequencyData.length * 2) {
    throw new RangeError("Spectrum FFT size must be twice the frequency-bin count.");
  }
  validatePositiveFinite(width, "Spectrum plot width");
  validatePositiveFinite(height, "Spectrum plot height");
  const resolved = resolveOptions({
    ceilingDb,
    floorDb,
    maximumFrequencyHz,
    minimumFrequencyHz,
  });
  const effectiveMaximumFrequencyHz = Math.min(
    resolved.maximumFrequencyHz,
    sampleRate / 2,
  );
  if (effectiveMaximumFrequencyHz <= resolved.minimumFrequencyHz) {
    throw new RangeError("The sample rate does not cover the configured spectrum range.");
  }

  const left = width < 360 ? 40 : 48;
  const right = 8;
  const top = 10;
  const bottom = 28;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);
  const columnCount = Math.max(1, Math.floor(plotWidth));
  const magnitudesDb = resolveMagnitudeWorkspace(
    magnitudeWorkspace,
    columnCount,
    resolved.floorDb,
  );
  const binWidthHz = sampleRate / fftSize;
  const firstBin = Math.max(1, Math.ceil(resolved.minimumFrequencyHz / binWidthHz));
  const lastBin = Math.min(
    frequencyData.length - 1,
    Math.floor(effectiveMaximumFrequencyHz / binWidthHz),
  );

  for (let bin = firstBin; bin <= lastBin; bin += 1) {
    const frequencyHz = bin * binWidthHz;
    const position = frequencyToLogPosition(
      frequencyHz,
      resolved.minimumFrequencyHz,
      effectiveMaximumFrequencyHz,
    );
    const column = Math.min(columnCount - 1, Math.floor(position * columnCount));
    const rawMagnitude = frequencyData[bin];
    const magnitudeDb = Number.isFinite(rawMagnitude)
      ? clamp(rawMagnitude, resolved.floorDb, resolved.ceilingDb)
      : resolved.floorDb;
    magnitudesDb[column] = Math.max(magnitudesDb[column], magnitudeDb);
  }

  const xForFrequency = (frequencyHz) =>
    left +
    frequencyToLogPosition(
      frequencyHz,
      resolved.minimumFrequencyHz,
      effectiveMaximumFrequencyHz,
    ) *
      plotWidth;
  const yForDecibels = (magnitudeDb) =>
    top +
    ((resolved.ceilingDb - clamp(magnitudeDb, resolved.floorDb, resolved.ceilingDb)) /
      (resolved.ceilingDb - resolved.floorDb)) *
      plotHeight;
  const frequencyTicks = FREQUENCY_TICKS_HZ.filter(
    (frequencyHz) =>
      frequencyHz >= resolved.minimumFrequencyHz &&
      frequencyHz <= effectiveMaximumFrequencyHz,
  ).map((frequencyHz) => Object.freeze({
    frequencyHz,
    label: formatFrequency(frequencyHz),
    x: xForFrequency(frequencyHz),
  }));
  const decibelTicks = [resolved.ceilingDb, -40, -60, -80, resolved.floorDb]
    .filter(
      (value, index, values) =>
        value >= resolved.floorDb &&
        value <= resolved.ceilingDb &&
        values.indexOf(value) === index,
    )
    .sort((leftValue, rightValue) => rightValue - leftValue)
    .map((value) => Object.freeze({ label: `${value} dB`, value, y: yForDecibels(value) }));

  return Object.freeze({
    binWidthHz,
    bounds: Object.freeze({ bottom, left, plotHeight, plotWidth, right, top }),
    ceilingDb: resolved.ceilingDb,
    columnCount,
    decibelTicks: Object.freeze(decibelTicks),
    effectiveMaximumFrequencyHz,
    floorDb: resolved.floorDb,
    frequencyTicks: Object.freeze(frequencyTicks),
    magnitudesDb,
    minimumFrequencyHz: resolved.minimumFrequencyHz,
    yForDecibels,
  });
}

export function summarizeSpectrumPlot(plot) {
  let peak = plot.floorDb, column = -1;
  for (let index = 0; index < plot.magnitudesDb.length; index++) {
    if (plot.magnitudesDb[index] > peak) { peak = plot.magnitudesDb[index]; column = index; }
  }
  if (column < 0) return "Frequency spectrum. No energy above the displayed noise floor.";
  const frequency = plot.minimumFrequencyHz * (plot.effectiveMaximumFrequencyHz / plot.minimumFrequencyHz)
    ** ((column + .5) / plot.columnCount);
  return `Frequency spectrum. Strongest displayed band near ${Math.round(frequency)} Hz, ${Math.round(peak)} dB. This may be a harmonic, not the detected fundamental.`;
}

export function drawSpectrum(context, plot, styles = {}) {
  if (!context || typeof context.clearRect !== "function") {
    throw new TypeError("A 2D context is required to draw the spectrum.");
  }
  if (!plot || typeof plot !== "object") {
    throw new TypeError("A spectrum plot is required.");
  }
  const width = plot.bounds.left + plot.bounds.plotWidth + plot.bounds.right;
  const height = plot.bounds.top + plot.bounds.plotHeight + plot.bounds.bottom;
  const gridStyle = styles.grid ?? "#ccd1ca";
  const labelStyle = styles.label ?? "#59645f";
  const traceStyle = styles.trace ?? "#87321f";
  const fillStyle = styles.fill ?? traceStyle;

  context.clearRect(0, 0, width, height);
  context.save?.();
  context.font = "10px ui-sans-serif, system-ui, sans-serif";
  context.fillStyle = labelStyle;
  context.strokeStyle = gridStyle;
  context.lineWidth = 1;
  context.setLineDash?.([3, 4]);
  context.textBaseline = "middle";
  for (const tick of plot.decibelTicks) {
    context.beginPath();
    context.moveTo(plot.bounds.left, tick.y);
    context.lineTo(plot.bounds.left + plot.bounds.plotWidth, tick.y);
    context.stroke();
    context.fillText?.(tick.label, 2, tick.y);
  }
  context.textBaseline = "alphabetic";
  context.textAlign = "center";
  for (const tick of plot.frequencyTicks) {
    context.beginPath();
    context.moveTo(tick.x, plot.bounds.top);
    context.lineTo(tick.x, plot.bounds.top + plot.bounds.plotHeight);
    context.stroke();
    context.fillText?.(tick.label, tick.x, height - 4);
  }

  const horizontalStep =
    plot.columnCount > 1 ? plot.bounds.plotWidth / (plot.columnCount - 1) : 0;
  const bottomY = plot.bounds.top + plot.bounds.plotHeight;
  context.setLineDash?.([]);
  context.beginPath();
  context.moveTo(plot.bounds.left, bottomY);
  for (let index = 0; index < plot.columnCount; index += 1) {
    context.lineTo(
      plot.bounds.left + index * horizontalStep,
      plot.yForDecibels(plot.magnitudesDb[index]),
    );
  }
  context.lineTo(plot.bounds.left + plot.bounds.plotWidth, bottomY);
  context.closePath?.();
  context.globalAlpha = 0.16;
  context.fillStyle = fillStyle;
  context.fill?.();

  context.globalAlpha = 1;
  context.beginPath();
  for (let index = 0; index < plot.columnCount; index += 1) {
    const x = plot.bounds.left + index * horizontalStep;
    const y = plot.yForDecibels(plot.magnitudesDb[index]);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.strokeStyle = traceStyle;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.stroke();
  context.restore?.();
  return plot;
}

function defaultStyles() {
  return Object.freeze({
    fill: "#87321f",
    grid: "#ccd1ca",
    label: "#59645f",
    trace: "#87321f",
  });
}

export function createSpectrumRenderer({
  analyserSession,
  canvas,
  fftSize,
  getDevicePixelRatio = () => 1,
  getStyles = defaultStyles,
  options,
  ResizeObserverClass,
  sampleRate,
  windowTarget,
} = {}) {
  if (!analyserSession || typeof analyserSession.readFrequencyDomainSamples !== "function") {
    throw new TypeError("An analyser session with frequency data is required.");
  }
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("A canvas is required for spectrum rendering.");
  }
  validatePositiveFinite(sampleRate, "Spectrum sample rate");
  const validFftSize =
    Number.isInteger(fftSize) &&
    fftSize >= 32 &&
    fftSize <= 32768 &&
    (fftSize & (fftSize - 1)) === 0;
  if (!validFftSize) {
    throw new RangeError("Spectrum FFT size must be a power of two from 32 to 32768.");
  }
  if (typeof getDevicePixelRatio !== "function" || typeof getStyles !== "function") {
    throw new TypeError("Spectrum style and pixel-ratio readers must be functions.");
  }
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("A 2D canvas context is unavailable for the spectrum.");
  }
  const resolved = resolveOptions(options);
  let destroyed = false;
  let lastRenderedAt = null;
  let magnitudeWorkspace = null;
  let resizeObserver = null;
  let removeWindowResize = null;
  let size = resizeCanvas(canvas, context, getDevicePixelRatio());

  const render = (timestampMs, force = false) => {
    if (destroyed) {
      return false;
    }
    validateFinite(timestampMs, "Spectrum render timestamp");
    if (timestampMs < 0 || (lastRenderedAt !== null && timestampMs < lastRenderedAt)) {
      throw new RangeError("Spectrum render timestamps must be monotonic and non-negative.");
    }
    if (
      !force &&
      lastRenderedAt !== null &&
      timestampMs - lastRenderedAt < resolved.renderIntervalMs
    ) {
      return false;
    }
    const frequencyData = analyserSession.readFrequencyDomainSamples();
    const plot = buildSpectrumPlot(frequencyData, {
      ...resolved,
      fftSize,
      height: size.cssHeight,
      magnitudeWorkspace,
      sampleRate,
      width: size.cssWidth,
    });
    magnitudeWorkspace = plot.magnitudesDb;
    drawSpectrum(context, plot, getStyles());
    canvas.setAttribute?.("aria-label", summarizeSpectrumPlot(plot));
    lastRenderedAt = timestampMs;
    return true;
  };

  const resize = () => {
    if (destroyed) {
      return false;
    }
    size = resizeCanvas(canvas, context, getDevicePixelRatio());
    return render(lastRenderedAt ?? 0, true);
  };

  if (typeof ResizeObserverClass === "function") {
    resizeObserver = new ResizeObserverClass(resize);
    resizeObserver.observe(canvas);
  }
  if (windowTarget?.addEventListener) {
    windowTarget.addEventListener("resize", resize);
    removeWindowResize = () => windowTarget.removeEventListener("resize", resize);
  }
  render(0, true);

  return Object.freeze({
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      resizeObserver?.disconnect();
      removeWindowResize?.();
      context.clearRect(0, 0, size.cssWidth, size.cssHeight);
      canvas.setAttribute?.("aria-label", "Frequency spectrum. No live spectrum available.");
      magnitudeWorkspace = null;
    },
    render,
    resize,
  });
}
