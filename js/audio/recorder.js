export const RECORDING_LIMITS = Object.freeze({ defaultSeconds: 30, maximumSeconds: 60, maximumBytes: 16 * 1024 * 1024 });
const mimeCandidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

export function validateRecordingLimit(seconds) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > RECORDING_LIMITS.maximumSeconds) {
    throw new RangeError("Recording limit must be an integer from 1 to 60 seconds.");
  }
  return seconds;
}

export function createRecorderController({
  MediaRecorderClass = globalThis.MediaRecorder,
  BlobClass = globalThis.Blob,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  player,
  getStream,
  canStart = () => true,
  isPageVisible = () => true,
  onStateChange = () => {},
  now = () => performance.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  const supported = typeof MediaRecorderClass === "function" && typeof BlobClass === "function";
  let state = supported ? "idle" : "unsupported";
  let message = "";
  let elapsedSeconds = 0;
  let current = null;
  let take = null;
  let destroyed = false;
  let playGeneration = 0;
  let playIntent = false;
  const listeners = [];
  const snapshot = () => Object.freeze({
    status: state, message, elapsedSeconds, hasTake: take !== null,
    durationSeconds: take?.durationSeconds ?? 0, mimeType: take?.mimeType ?? "",
  });
  const publish = (next = state, detail = "") => {
    state = next; message = detail;
    try { onStateChange(snapshot()); } catch { /* Rendering must not prevent cleanup. */ }
  };
  const pause = () => {
    playGeneration += 1; playIntent = false;
    try { player.pause(); } catch { /* Source removal remains available on deletion. */ }
    if (state === "playing") publish(take ? "ready" : "idle");
  };
  const clearTake = () => {
    pause();
    const previous = take; take = null;
    try { player.removeAttribute("src"); player.load(); }
    finally { if (previous) revokeObjectURL(previous.url); }
  };
  const detach = (session) => {
    clearTimer(session.deadline); clearTimer(session.tick); clearTimer(session.fallback);
    for (const [type, handler] of session.listeners) session.recorder.removeEventListener(type, handler);
    session.chunks.length = 0;
  };
  const abort = (session, detail) => {
    if (current !== session) return;
    current = null;
    detach(session);
    try { if (session.recorder.state !== "inactive") session.recorder.stop(); } catch { /* No retained chunks or callbacks. */ }
    publish("error", detail);
  };
  const stop = () => {
    const session = current;
    if (!session || state === "processing") return;
    elapsedSeconds = Math.min(session.limit, Math.max(0, (now() - session.startedAt) / 1000));
    clearTimer(session.deadline); clearTimer(session.tick);
    publish("processing");
    session.fallback = setTimer(() => abort(session, "Recording could not be finalized. Please try another take."), 5000);
    try { if (session.recorder.state !== "inactive") session.recorder.stop(); }
    catch { abort(session, "Recording could not be stopped safely. Please try again."); }
  };
  const finish = (session) => {
    if (current !== session) return;
    // Track-ended events can finish without an explicit stop request.
    if (state === "recording") elapsedSeconds = Math.min(session.limit, Math.max(0, (now() - session.startedAt) / 1000));
    current = null;
    try {
      if (session.failed || !session.bytes) throw new Error("Empty or failed take.");
      const mimeType = session.recorder.mimeType || session.chunks[0]?.type || "";
      const blob = new BlobClass(session.chunks, { type: mimeType });
      if (!blob.size || blob.size > RECORDING_LIMITS.maximumBytes) throw new Error("Invalid take size.");
      const url = createObjectURL(blob);
      take = { url, blob, mimeType, durationSeconds: elapsedSeconds };
      player.src = url;
      player.load();
      publish("ready");
    } catch {
      try { clearTake(); } catch { /* Continue clearing chunks and listeners. */ }
      publish("error", "No playable take was produced. Please try recording again.");
    } finally { detach(session); }
  };
  const start = (limitSeconds = RECORDING_LIMITS.defaultSeconds) => {
    if (!supported || destroyed || current || !canStart() || !isPageVisible()) return false;
    let stream;
    try {
      validateRecordingLimit(limitSeconds);
      stream = getStream();
      const tracks = stream?.getAudioTracks?.();
      if (!tracks?.length || tracks.some((track) => track.readyState === "ended" || track.enabled === false) || stream.active === false) {
        throw new Error("No active input.");
      }
    } catch { publish(take ? "ready" : "error", "Start the microphone and choose a valid recording limit first."); return false; }
    pause();
    const choices = [];
    for (const mimeType of mimeCandidates) {
      try { if (MediaRecorderClass.isTypeSupported?.(mimeType)) choices.push(mimeType); } catch { /* Try browser default. */ }
    }
    choices.push(null);
    let recorder = null;
    for (const mimeType of choices) {
      try { recorder = mimeType ? new MediaRecorderClass(stream, { mimeType }) : new MediaRecorderClass(stream); break; }
      catch { /* Some devices reject a reported supported type. */ }
    }
    if (!recorder) { publish(take ? "ready" : "error", "Recording is unavailable for this microphone/browser."); return false; }
    const session = { recorder, chunks: [], bytes: 0, listeners: [], limit: limitSeconds, startedAt: now(), failed: false };
    current = session;
    const listen = (type, handler) => { recorder.addEventListener(type, handler); session.listeners.push([type, handler]); };
    listen("dataavailable", (event) => {
      if (current !== session || !event.data?.size) return;
      if (session.bytes + event.data.size > RECORDING_LIMITS.maximumBytes || session.chunks.length >= 1000) {
        abort(session, "The take exceeded the memory limit and was discarded. Try a shorter recording."); return;
      }
      session.chunks.push(event.data); session.bytes += event.data.size;
      if (now() - session.startedAt >= limitSeconds * 1000) stop();
    });
    listen("stop", () => finish(session));
    listen("error", () => { session.failed = true; stop(); });
    try {
      recorder.start(250);
      clearTake();
      elapsedSeconds = 0;
      publish("recording");
      const tick = () => {
        if (current !== session || state !== "recording") return;
        elapsedSeconds = Math.min(limitSeconds, Math.max(0, (now() - session.startedAt) / 1000));
        if (elapsedSeconds >= limitSeconds) { stop(); return; }
        publish();
        session.tick = setTimer(tick, 250);
      };
      session.deadline = setTimer(stop, limitSeconds * 1000);
      session.tick = setTimer(tick, 250);
      return true;
    } catch { abort(session, "Recording could not start. Please try again."); return false; }
  };
  const clear = () => {
    const session = current; current = null; // Invalidate queued final data/stop events first.
    if (session) {
      detach(session);
      try { if (session.recorder.state !== "inactive") session.recorder.stop(); } catch { /* Take remains discarded. */ }
    }
    elapsedSeconds = 0;
    try { clearTake(); }
    finally { publish(supported ? "idle" : "unsupported"); }
  };
  const play = async () => {
    if (!take || current || destroyed || !canStart() || !isPageVisible() || playIntent) return false;
    const selected = take;
    const generation = ++playGeneration;
    playIntent = true;
    try {
      if (player.ended) player.currentTime = 0;
      await player.play();
      if (generation !== playGeneration || take !== selected || !playIntent || !isPageVisible()) return false;
      publish("playing");
      return true;
    } catch {
      if (generation === playGeneration && take === selected) {
        playIntent = false;
        publish("ready", "Playback could not start. Press Play to try again.");
      }
      return false;
    }
  };
  const listenPlayer = (type, handler) => {
    player.addEventListener(type, handler);
    listeners.push(() => player.removeEventListener(type, handler));
  };
  listenPlayer("play", () => {
    if (!playIntent || !take || !isPageVisible()) { pause(); return; }
    publish("playing");
  });
  listenPlayer("pause", () => { if (player.paused && state === "playing") pause(); });
  listenPlayer("ended", () => { if (player.ended && take && state === "playing") { playIntent = false; publish("ready"); } });
  listenPlayer("error", () => {
    if (!take || !player.error) return;
    pause(); publish("ready", "This take cannot be played in this browser. Delete it or try another take.");
  });
  return Object.freeze({
    getState: snapshot, start, stop, play, pause, clear,
    // Internal comparison ownership only; never serialized or exposed in UI snapshots.
    getBlob: () => take?.blob ?? null,
    replaceBlob(blob, durationSeconds) {
      if (destroyed || current || !(blob instanceof BlobClass) || !blob.size
        || blob.size > RECORDING_LIMITS.maximumBytes || !Number.isFinite(durationSeconds)
        || durationSeconds < 0 || durationSeconds > RECORDING_LIMITS.maximumSeconds) return false;
      try {
        clearTake();
        take = { blob, url: createObjectURL(blob), mimeType: blob.type, durationSeconds };
        player.src = take.url; player.load(); publish("ready"); return true;
      } catch {
        try { clearTake(); } catch { /* Still report failure. */ }
        publish("error", "The reference could not be kept. Your comparison take is still available.");
        return false;
      }
    },
    destroy() { destroyed = true; try { clear(); } finally { for (const remove of listeners) remove(); } },
  });
}
