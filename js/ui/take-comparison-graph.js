import { resizeCanvas } from "./canvas.js";

export function createTakeComparisonGraph(canvas, { ResizeObserverClass = globalThis.ResizeObserver,
  getPixelRatio = () => globalThis.devicePixelRatio ?? 1 } = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Comparison canvas unavailable.");
  let snapshot = null, destroyed = false;
  const draw = () => {
    if (destroyed || !snapshot) return;
    const { cssWidth: width, cssHeight: height } = resizeCanvas(canvas, ctx, getPixelRatio());
    ctx.clearRect(0, 0, width, height);
    const styles = getComputedStyle(canvas), color = (name) => styles.getPropertyValue(name).trim();
    const foreground = color("--color-muted"), grid = color("--color-line");
    const left = 50, right = width - 12, top = height * 0.58, bottom = height - 30;
    const start = snapshot.bounds.start, end = Math.max(start + 0.1, snapshot.bounds.end);
    const x = (time) => left + (time - start) / (end - start) * (right - left);
    const frequencies = Object.values(snapshot.analysis).flatMap((take) => take?.points.filter((p) => p.hz).map((p) => p.hz) ?? []);
    const midi = (hz) => 69 + 12 * Math.log2(hz / 440);
    const low = frequencies.length ? Math.floor(Math.min(...frequencies.map(midi))) - 1 : 48;
    const high = frequencies.length ? Math.max(low + 4, Math.ceil(Math.max(...frequencies.map(midi))) + 1) : 72;
    const y = (hz) => bottom - (midi(hz) - low) / (high - low) * (bottom - top);
    ctx.font = "11px sans-serif"; ctx.fillStyle = foreground;
    ctx.fillText("Waveform envelope · same scale", 8, 16);
    ctx.fillText("Pitch · Hz (log); gaps = unvoiced", 8, top - 16);
    for (let i = 0; i <= 4; i++) {
      const time = start + (end - start) * i / 4, px = x(time);
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(px, 24); ctx.lineTo(px, bottom); ctx.stroke();
      ctx.fillStyle = foreground; ctx.textAlign = i === 4 ? "right" : "center";
      ctx.fillText(`${time.toFixed(1)}s`, px, height - 8);
    }
    ctx.textAlign = "left";
    for (let i = 0; i <= 3; i++) {
      const note = low + (high - low) * i / 3, hz = 440 * 2 ** ((note - 69) / 12), py = y(hz);
      ctx.fillStyle = foreground; ctx.fillText(String(Math.round(hz)), 4, py + 4);
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
    }
    for (const [index, key] of ["reference", "comparison"].entries()) {
      const take = snapshot.analysis[key], shift = key === "comparison" ? snapshot.offset : 0;
      const center = height * (0.17 + index * 0.21), amplitudeHeight = height * 0.075;
      const stroke = color(index ? "--color-positive" : "--color-accent-strong");
      ctx.fillStyle = stroke; ctx.fillText(index ? "B" : "A", 8, center + 3);
      ctx.fillStyle = foreground; ctx.fillText("+1", 27, center - amplitudeHeight + 4); ctx.fillText("−1", 27, center + amplitudeHeight + 4);
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(left, center); ctx.lineTo(right, center); ctx.stroke();
      if (!take) continue;
      ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.beginPath();
      for (const point of take.points) {
        const px = x(point.time + shift), amplitude = point.peak * amplitudeHeight;
        ctx.moveTo(px, center - amplitude); ctx.lineTo(px, center + amplitude);
      }
      ctx.stroke(); ctx.lineWidth = 2; ctx.setLineDash(index ? [5, 3] : []);
      ctx.beginPath(); let previous = null;
      for (const point of take.points) {
        if (!point.hz) { previous = null; continue; }
        const px = x(point.time + shift), py = y(point.hz);
        if (!previous || point.time - previous.time > 0.075) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        previous = point;
      }
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    ctx.strokeStyle = color("--color-ink"); ctx.beginPath();
    ctx.moveTo(x(snapshot.position), 24); ctx.lineTo(x(snapshot.position), bottom); ctx.stroke();
  };
  const observer = typeof ResizeObserverClass === "function" ? new ResizeObserverClass(() => {
    try { draw(); } catch { /* Text and playback remain available. */ }
  }) : null;
  observer?.observe(canvas);
  return { render(value) { snapshot = value; draw(); }, destroy() { destroyed = true; snapshot = null; observer?.disconnect(); ctx.clearRect(0, 0, canvas.width, canvas.height); } };
}
