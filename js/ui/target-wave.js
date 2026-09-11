import { TARGET_DEFAULTS } from "../config.js";
import { resizeCanvas } from "./canvas.js";

function validatePositiveFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero.`);
  }
}

export function buildTargetSinePoints(frequencyHz, {
  durationMs = TARGET_DEFAULTS.targetWaveDurationMs,
  height,
  pointCount,
  width,
} = {}) {
  validatePositiveFinite(frequencyHz, "Target-sine frequency");
  validatePositiveFinite(durationMs, "Target-sine duration");
  validatePositiveFinite(width, "Target-sine width");
  validatePositiveFinite(height, "Target-sine height");
  const resolvedPointCount = pointCount ?? Math.min(
    TARGET_DEFAULTS.targetWaveMaximumPointCount,
    Math.max(
      TARGET_DEFAULTS.targetWavePointCount,
      Math.ceil(
        frequencyHz * (durationMs / 1000) *
          TARGET_DEFAULTS.targetWaveMinimumPointsPerCycle,
      ) + 1,
    ),
  );
  if (
    !Number.isInteger(resolvedPointCount) ||
    resolvedPointCount < 2 ||
    resolvedPointCount > TARGET_DEFAULTS.targetWaveMaximumPointCount
  ) {
    throw new RangeError(
      `Target-sine point count must be an integer from 2 to ${TARGET_DEFAULTS.targetWaveMaximumPointCount}.`,
    );
  }

  const centerY = height / 2;
  const amplitude = height * 0.34;
  const durationSeconds = durationMs / 1000;
  const points = new Array(resolvedPointCount);
  for (let index = 0; index < resolvedPointCount; index += 1) {
    const progress = index / (resolvedPointCount - 1);
    points[index] = Object.freeze({
      x: progress * width,
      y: centerY - Math.sin(2 * Math.PI * frequencyHz * durationSeconds * progress) * amplitude,
    });
  }
  return Object.freeze({
    centerY,
    durationMs,
    frequencyHz,
    height,
    points: Object.freeze(points),
    width,
  });
}

export function buildSineComparison(targetHz, detectedHz, geometry = {}) {
  if (detectedHz !== null) validatePositiveFinite(detectedHz, "Detected-pitch frequency");
  const sampling = buildTargetSinePoints(Math.max(targetHz, detectedHz ?? targetHz), geometry);
  const options = { ...geometry, pointCount: sampling.points.length };
  return Object.freeze({
    target: targetHz === sampling.frequencyHz ? sampling : buildTargetSinePoints(targetHz, options),
    detected: detectedHz === null ? null : detectedHz === sampling.frequencyHz ? sampling : buildTargetSinePoints(detectedHz, options),
  });
}

export function drawTargetSine(context, plot, styles = {}, detectedPlot = null) {
  if (!context || !plot || !Array.isArray(plot.points)) {
    throw new TypeError("A drawing context and target-sine plot are required.");
  }
  context.clearRect(0, 0, plot.width, plot.height);
  context.save();
  context.strokeStyle = styles.grid || "#777";
  context.lineWidth = 1;
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(0, plot.centerY);
  context.lineTo(plot.width, plot.centerY);
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = styles.trace || "currentColor";
  context.lineWidth = detectedPlot ? 3 : 2;
  context.beginPath();
  for (const [index, point] of plot.points.entries()) {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  }
  context.stroke();
  if (detectedPlot) {
    context.setLineDash([7, 5]);
    context.strokeStyle = styles.detected || "#176b4d";
    context.lineWidth = 2;
    context.beginPath();
    for (const [index, point] of detectedPlot.points.entries()) {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
  context.restore();
  return plot;
}

export function createTargetWaveRenderer({
  canvas,
  emptyState,
  getDevicePixelRatio = () => 1,
  getStyles = () => ({}),
  ResizeObserverClass = globalThis.ResizeObserver,
  windowTarget = globalThis.window,
} = {}) {
  if (!canvas || typeof canvas.getContext !== "function" || !emptyState) {
    throw new TypeError("Target-wave canvas and empty state are required.");
  }
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("A two-dimensional target-wave context is unavailable.");
  }
  let target = null;
  let detectedHz = null;
  let size = null;
  let destroyed = false;
  canvas.dataset.overlay = "none";

  const render = () => {
    if (destroyed) {
      return null;
    }
    size = resizeCanvas(canvas, context, getDevicePixelRatio());
    if (!target) {
      context.clearRect(0, 0, size.cssWidth, size.cssHeight);
      emptyState.hidden = false;
      return null;
    }
    const comparison = buildSineComparison(target.frequencyHz, detectedHz, {
      height: size.cssHeight,
      width: size.cssWidth,
    });
    drawTargetSine(context, comparison.target, getStyles(), comparison.detected);
    emptyState.hidden = true;
    return comparison.target;
  };
  const onResize = () => render();
  const resizeObserver = ResizeObserverClass
    ? new ResizeObserverClass(onResize)
    : null;
  resizeObserver?.observe(canvas);
  windowTarget?.addEventListener?.("resize", onResize);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      target = null;
      detectedHz = null;
      canvas.dataset.overlay = "none";
      context.clearRect(0, 0, size?.cssWidth ?? 1, size?.cssHeight ?? 1);
      resizeObserver?.disconnect();
      windowTarget?.removeEventListener?.("resize", onResize);
    },
    render,
    setDetectedFrequency(frequencyHz) {
      if (destroyed) return null;
      if (frequencyHz !== null) validatePositiveFinite(frequencyHz, "Detected-pitch frequency");
      const next = target ? frequencyHz : null;
      if (detectedHz === next) return null;
      detectedHz = next;
      canvas.dataset.overlay = detectedHz === null ? "none" : "active";
      return render();
    },
    setTarget(nextTarget) {
      if (destroyed) return null;
      if (nextTarget !== null) {
        if (!nextTarget || typeof nextTarget.label !== "string") {
          throw new TypeError("Target wave requires a labeled target.");
        }
        validatePositiveFinite(nextTarget.frequencyHz, "Target-wave frequency");
      }
      if (target?.frequencyHz !== nextTarget?.frequencyHz || target?.label !== nextTarget?.label) {
        detectedHz = null; canvas.dataset.overlay = "none";
      }
      target = nextTarget;
      canvas.dataset.target = nextTarget ? "active" : "none";
      canvas.setAttribute(
        "aria-label",
        nextTarget
          ? `Target tone shape for ${nextTarget.label} at ${nextTarget.frequencyHz.toFixed(2)} hertz.`
          : "Target tone shape. No target selected.",
      );
      return render();
    },
  });
}
