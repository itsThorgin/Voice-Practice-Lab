import { computeRms, rmsToLevel } from "../audio/analyser.js";
import { resizeCanvas } from "./canvas.js";

export { calculateCanvasSize, resizeCanvas } from "./canvas.js";

function positiveFinite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function drawWaveform(context, samples, width, height, strokeStyle = "currentColor") {
  const safeWidth = positiveFinite(width, 1);
  const safeHeight = positiveFinite(height, 1);
  const centerY = safeHeight / 2;
  const amplitude = safeHeight * 0.46;
  const horizontalStep = samples.length > 1 ? safeWidth / (samples.length - 1) : safeWidth;

  context.clearRect(0, 0, safeWidth, safeHeight);
  context.beginPath();
  context.moveTo(0, centerY - (samples[0] ?? 0) * amplitude);
  for (let index = 1; index < samples.length; index += 1) {
    context.lineTo(index * horizontalStep, centerY - samples[index] * amplitude);
  }
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.strokeStyle = strokeStyle;
  context.stroke();
}

export function createWaveformRenderer({
  analyserSession,
  cancelFrame,
  canvas,
  getDevicePixelRatio = () => 1,
  getStrokeStyle = () => "currentColor",
  isPageVisible = () => true,
  onLevel = () => {},
  onSamples = () => {},
  requestFrame,
  ResizeObserverClass,
  windowTarget,
} = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("A canvas is required for waveform rendering.");
  }
  if (!analyserSession || typeof analyserSession.readTimeDomainSamples !== "function") {
    throw new TypeError("An analyser session is required for waveform rendering.");
  }
  if (typeof requestFrame !== "function" || typeof cancelFrame !== "function") {
    throw new TypeError("Animation frame scheduling functions are required.");
  }
  if (typeof onLevel !== "function" || typeof onSamples !== "function") {
    throw new TypeError("Waveform callbacks must be functions.");
  }

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("A 2D canvas context is unavailable.");
  }

  let frameId = null;
  let running = false;
  let started = false;
  let stopped = false;
  let size = null;
  let resizeObserver = null;
  let removeWindowResize = null;

  const updateSize = () => {
    if (stopped) {
      return size;
    }
    size = resizeCanvas(canvas, context, getDevicePixelRatio());
    return size;
  };

  const renderFrame = (timestampMs = 0) => {
    frameId = null;
    if (!running || stopped || !isPageVisible()) {
      running = false;
      return;
    }

    const samples = analyserSession.readTimeDomainSamples();
    const currentSize = size ?? updateSize();
    drawWaveform(
      context,
      samples,
      currentSize.cssWidth,
      currentSize.cssHeight,
      getStrokeStyle(),
    );
    const rms = computeRms(samples);
    onLevel(rmsToLevel(rms), rms);
    onSamples(samples, timestampMs);
    frameId = requestFrame(renderFrame);
  };

  const pause = () => {
    running = false;
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
  };

  const resume = () => {
    if (stopped || running || !isPageVisible()) {
      return;
    }
    running = true;
    frameId = requestFrame(renderFrame);
  };

  const start = () => {
    if (started || stopped) {
      return;
    }
    started = true;
    updateSize();

    if (typeof ResizeObserverClass === "function") {
      resizeObserver = new ResizeObserverClass(updateSize);
      resizeObserver.observe(canvas);
    }
    if (windowTarget?.addEventListener) {
      windowTarget.addEventListener("resize", updateSize);
      removeWindowResize = () => windowTarget.removeEventListener("resize", updateSize);
    }

    resume();
  };

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    pause();
    resizeObserver?.disconnect();
    removeWindowResize?.();
    analyserSession.disconnect?.();
    context.clearRect(0, 0, size?.cssWidth ?? 1, size?.cssHeight ?? 1);
    onLevel(0, 0);
  };

  return Object.freeze({
    isRunning: () => running,
    pause,
    resize: updateSize,
    resume,
    start,
    stop,
  });
}
