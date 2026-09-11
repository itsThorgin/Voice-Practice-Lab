import { RECORDING_LIMITS } from "../audio/recorder.js";
import { createTakeComparison } from "../audio/take-comparison.js";
import { createTakeComparisonGraph } from "./take-comparison-graph.js";
import { preserveControlFocus } from "./accessibility.js";

export function createRecordingControls({ root, getStream, canStart = () => true,
  MediaRecorderClass = globalThis.MediaRecorder, windowTarget = window, documentTarget = document,
  createComparison = createTakeComparison, createGraph = createTakeComparisonGraph,
}) {
  const find = (name) => root.querySelector(`[data-record-${name}]`), listeners = [];
  const limit = find("limit");
  let snapshot, controller, graph = null, graphFailed = false;
  try { graph = createGraph(find("graph")); } catch { graphFailed = true; }
  const write = (name, value) => { const node = find(name); if (node.textContent !== value) node.textContent = value; };
  const render = () => {
    if (!snapshot?.comparison || !snapshot?.reference) return;
    const restoreFocus = preserveControlFocus(root, [find("start"), find("stop"), find("play"), find("status")]);
    const take = snapshot.comparison, reference = snapshot.reference;
    const busy = ["recording", "processing"].includes(take.status), allowed = canStart();
    find("start").disabled = take.status === "unsupported" || busy || !getStream() || !allowed;
    write("start", reference.hasTake ? "Record comparison B" : take.hasTake ? "Record new take" : "Record first take");
    find("stop").disabled = take.status !== "recording";
    find("play").disabled = !take.hasTake || busy || !allowed;
    find("reference-play").disabled = !reference.hasTake || busy || !allowed;
    find("both").disabled = !reference.hasTake || !take.hasTake || busy || !allowed;
    find("pause").disabled = !snapshot.mode;
    find("delete").disabled = !take.hasTake && !busy;
    find("reference-delete").disabled = !reference.hasTake;
    find("keep").disabled = !take.hasTake || busy || !allowed;
    write("keep", reference.hasTake ? "Replace reference A with B" : "Keep as reference A");
    limit.disabled = busy || take.status === "unsupported";
    find("offset").disabled = !reference.hasTake || !take.hasTake || busy;
    if (documentTarget.activeElement !== find("offset")) find("offset").value = String(snapshot.offset);
    find("seek").min = String(snapshot.bounds.start); find("seek").max = String(snapshot.bounds.end || 0.1);
    find("seek").value = String(snapshot.position); find("seek").disabled = busy || (!take.hasTake && !reference.hasTake);
    find("seek").setAttribute?.("aria-valuetext", `${snapshot.position.toFixed(2)} seconds`);
    find("restart").disabled = busy || (!take.hasTake && !reference.hasTake);
    for (const key of ["reference", "comparison"]) find(`${key}-level`).value = String(snapshot.levels[key]);
    for (const key of ["reference", "comparison"]) find(`${key}-level`).setAttribute?.("aria-valuetext", `${Math.round(snapshot.levels[key] * 100)} percent`);
    root.dataset.status = take.status; root.dataset.playback = snapshot.mode ?? "paused";
    write("time", `${(busy ? take.elapsedSeconds : take.durationSeconds).toFixed(1)} s`);
    write("reference-time", reference.hasTake ? `${reference.durationSeconds.toFixed(1)} s retained` : "No reference yet");
    write("position", `${snapshot.position.toFixed(2)} s`);
    write("alignment", snapshot.offset === 0 ? "A and B start together." : `B starts ${Math.abs(snapshot.offset).toFixed(2)} s ${snapshot.offset > 0 ? "later" : "earlier"} than A.`);
    const messages = {
      unsupported: "Recording is unavailable in this browser. The tuner still works.",
      idle: getStream() ? "Ready to record a short take." : "Start the microphone to record a short take.",
      recording: "Recording comparison B: stop when you are finished.", processing: "Finishing your take…",
      ready: "Take B ready. Keep it as reference A, or compare it with your existing reference.",
      playing: "Playing comparison B.", error: "Recording is unavailable. Please try again.",
    };
    write("status", snapshot.message || (snapshot.playback?.status === "starting" ? "Preparing both playback positions…" : snapshot.mode ? `Playing ${snapshot.mode === "both" ? "A and B together" : snapshot.mode === "reference" ? "reference A" : "comparison B"}. Switch A/B at this timeline position.` : take.message || reference.message || messages[take.status]));
    const analysisSummary = ["reference", "comparison"].map((key) => {
      const label = key === "reference" ? "A" : "B", data = snapshot.analysis[key];
      if (data) {
        const voiced = data.points.filter((point) => point.hz), peaks = data.points.map((point) => point.peak);
        return `${label}: ${data.duration.toFixed(2)} s; ${Math.round(voiced.length / data.points.length * 100)}% voiced; peak ${Math.round(Math.max(0, ...peaks) * 100)}% of full scale.`;
      }
      if (snapshot.analysisStatus[key] === "processing") return `${label}: preparing comparison…`;
      if (snapshot.analysisStatus[key] === "unavailable") return `${label}: visual analysis unavailable; playback is still available.`;
      return "";
    }).filter(Boolean).join(" ") + (graphFailed ? " Graph unavailable; audio controls remain usable." : "");
    write("analysis", analysisSummary.trim());
    find("analysis").hidden = !analysisSummary.trim();
    if (graph) { try { graph.render(snapshot); } catch { graph.destroy(); graph = null; graphFailed = true; } }
    restoreFocus();
  };
  controller = createComparison({ players: { comparison: find("player"), reference: find("reference-player") },
    MediaRecorderClass, getStream, canStart, isPageVisible: () => !documentTarget.hidden,
    onStateChange(next) { snapshot = next; render(); } });
  snapshot = controller.getState();
  const listen = (node, type, fn) => { node.addEventListener(type, fn); listeners.push(() => node.removeEventListener(type, fn)); };
  const click = (name, fn) => listen(find(name), "click", fn);
  click("start", () => controller.start(Number(limit.value))); click("stop", () => controller.stop());
  click("play", () => controller.play("comparison")); click("reference-play", () => controller.play("reference"));
  click("both", () => controller.play("both")); click("pause", () => controller.pause());
  click("keep", () => controller.keepReference());
  click("delete", () => controller.deleteTake("comparison")); click("reference-delete", () => controller.deleteTake("reference"));
  click("restart", () => controller.seek(snapshot.bounds.start));
  listen(find("offset"), "focus", () => controller.pause());
  listen(find("offset"), "change", () => { if (!controller.setOffset(Number(find("offset").value))) find("offset").value = String(snapshot.offset); render(); });
  listen(find("seek"), "input", () => { controller.seek(Number(find("seek").value)); render(); });
  for (const key of ["reference", "comparison"]) listen(find(`${key}-level`), "input", () => controller.setLevel(key, Number(find(`${key}-level`).value)));
  listen(documentTarget, "visibilitychange", () => { if (documentTarget.hidden) controller.stop(); });
  listen(windowTarget, "pagehide", () => controller.clear()); render();
  return Object.freeze({ render, stop: () => controller.stop(),
    clear() { limit.value = String(RECORDING_LIMITS.defaultSeconds); controller.clear(); },
    destroy() { controller.destroy(); graph?.destroy(); for (const remove of listeners) remove(); },
  });
}
