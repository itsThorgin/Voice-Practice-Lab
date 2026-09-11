const MAX_DEVICE_PIXEL_RATIO = 4;

function positiveFinite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function calculateCanvasSize(cssWidth, cssHeight, devicePixelRatio = 1) {
  const safeWidth = positiveFinite(cssWidth, 1);
  const safeHeight = positiveFinite(cssHeight, 1);
  const safePixelRatio = Math.min(
    MAX_DEVICE_PIXEL_RATIO,
    Math.max(1, positiveFinite(devicePixelRatio, 1)),
  );

  return Object.freeze({
    cssHeight: safeHeight,
    cssWidth: safeWidth,
    devicePixelRatio: safePixelRatio,
    pixelHeight: Math.max(1, Math.round(safeHeight * safePixelRatio)),
    pixelWidth: Math.max(1, Math.round(safeWidth * safePixelRatio)),
  });
}

export function resizeCanvas(canvas, context, devicePixelRatio = 1) {
  const bounds = canvas.getBoundingClientRect();
  const size = calculateCanvasSize(bounds.width, bounds.height, devicePixelRatio);
  const changed = canvas.width !== size.pixelWidth || canvas.height !== size.pixelHeight;

  if (changed) {
    canvas.width = size.pixelWidth;
    canvas.height = size.pixelHeight;
  }
  context.setTransform(size.devicePixelRatio, 0, 0, size.devicePixelRatio, 0, 0);

  return Object.freeze({ ...size, changed });
}
