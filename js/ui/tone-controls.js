import { createToneGenerator } from "../audio/tone-generator.js";
import { formatTargetFrequency } from "../practice/target-note.js";

export function createToneControls({
  root,
  extraButtons = [],
  AudioContextClass,
  getTarget,
  canStart = () => true,
  onStateChange = () => {},
  documentTarget = document,
  windowTarget = window,
  createGenerator = createToneGenerator,
} = {}) {
  const buttons = [root.querySelector("[data-tone-hold]"), ...extraButtons];
  const status = root.querySelector("[data-tone-status]");
  const headphones = root.querySelector("[data-tone-headphones]");
  const listeners = [];
  let held = null;
  let frequencyHz = null;
  let microphoneActive = false;
  let toneState = "idle";
  let destroyed = false;

  const paint = () => {
    for (const button of buttons) {
      button.disabled = destroyed || toneState === "unsupported" || frequencyHz === null;
      button.dataset.toneActive = String(held?.button === button && ["starting", "playing"].includes(toneState));
    }
    root.dataset.state = toneState;
    headphones.hidden = !(toneState === "playing" && microphoneActive);
    const messages = {
      error: "Reference unavailable. Release and try again.",
      interrupted: "Reference stopped. Release, then hold again.",
      "invalid-frequency": "Target exceeds playback range. Choose another target.",
      playing: `Playing ${formatTargetFrequency(frequencyHz ?? 440)}: release to stop.`,
      starting: "Starting reference tone: keep holding to play.",
      unsupported: "Reference tones are unavailable in this browser.",
    };
    const message = messages[toneState] ?? (frequencyHz === null
      ? "Choose a target to play a reference."
      : `Ready: ${formatTargetFrequency(frequencyHz)}. Hold to listen.`);
    if (status.textContent !== message) status.textContent = message;
    for (const button of buttons) button.title = message;
  };

  const generator = createGenerator({
    AudioContextClass,
    isPageVisible: () => !documentTarget.hidden,
    onStateChange(next) { toneState = next; paint(); onStateChange(next); },
  });
  toneState = generator.getState();

  const cancel = (options) => {
    const previous = held;
    held = null;
    generator.stop(options);
    if (previous?.type === "pointer") {
      try { previous.button.releasePointerCapture?.(previous.id); } catch { /* Capture may already be lost. */ }
    }
    paint();
  };
  const begin = (owner) => {
    if (destroyed || held || owner.button.disabled || documentTarget.hidden || !canStart()) return false;
    held = owner;
    void generator.start(frequencyHz);
    return true;
  };
  const listen = (target, type, callback, options) => {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  };
  const keyName = (event) => event.code || event.key;
  const isPlayKey = (event) => event.key === " " || event.key === "Enter";
  const releasePointer = (event) => {
    if (held?.type === "pointer" && held.id === event.pointerId) cancel();
  };
  const releaseTouch = (event) => {
    if (held?.type === "touch" && Array.from(event.changedTouches).some(
      (touch) => touch.identifier === held.id,
    )) cancel();
  };
  for (const button of buttons) {
    listen(button, "keydown", (event) => {
      if (!isPlayKey(event)) return;
      event.preventDefault();
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      begin({ button, type: "keyboard", id: keyName(event) });
    });
    // Native click activation must never turn a momentary control into a toggle.
    listen(button, "click", (event) => event.preventDefault());
    listen(button, "contextmenu", (event) => { event.preventDefault(); cancel(); });
    listen(button, "dragstart", (event) => { event.preventDefault(); cancel(); });
  
    if (typeof windowTarget.PointerEvent === "function") {
      listen(button, "pointerdown", (event) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault();
        if (held) return;
        button.focus({ preventScroll: true });
        if (begin({ button, type: "pointer", id: event.pointerId })) {
          try { button.setPointerCapture(event.pointerId); } catch { /* Window release remains a fallback. */ }
        }
      });
      listen(button, "lostpointercapture", (event) => { if (held?.button === button) releasePointer(event); });
      listen(button, "pointerleave", (event) => {
        if (held?.button === button && !button.hasPointerCapture?.(event.pointerId)) releasePointer(event);
      });
    } else {
      // Legacy browsers retain both touch and mouse support without Pointer Events.
      listen(button, "mousedown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (held) return;
        button.focus({ preventScroll: true });
        begin({ button, type: "mouse" });
      });
      listen(button, "mouseleave", () => { if (held?.type === "mouse" && held.button === button) cancel(); });
      listen(button, "touchstart", (event) => {
        event.preventDefault();
        const touch = event.changedTouches[0];
        if (touch) begin({ button, type: "touch", id: touch.identifier });
      }, { passive: false });
    }
    listen(button, "blur", () => { if (held?.button === button) cancel(); });
  }
  listen(windowTarget, "keyup", (event) => {
    if (held?.type === "keyboard" && held.id === keyName(event)) {
      event.preventDefault(); cancel();
    }
  }, true);
  if (typeof windowTarget.PointerEvent === "function") {
    listen(windowTarget, "pointerup", releasePointer, true);
    listen(windowTarget, "pointercancel", releasePointer, true);
    listen(windowTarget, "pointermove", (event) => { if (event.buttons === 0) releasePointer(event); }, true);
  } else {
    listen(windowTarget, "mouseup", () => { if (held?.type === "mouse") cancel(); }, true);
    listen(windowTarget, "touchend", releaseTouch, true);
    listen(windowTarget, "touchcancel", releaseTouch, true);
  }
  listen(windowTarget, "blur", () => cancel());
  listen(windowTarget, "keydown", (event) => { if (event.key === "Escape") cancel(); }, true);
  listen(documentTarget, "visibilitychange", () => { if (documentTarget.hidden) cancel(); });
  listen(windowTarget, "pagehide", () => cancel({ immediate: true }));

  const render = ({ analysisActive = microphoneActive } = {}) => {
    const nextFrequency = getTarget()?.frequencyHz ?? null;
    if (frequencyHz !== nextFrequency) {
      cancel();
      frequencyHz = nextFrequency;
      if (toneState !== "unsupported") toneState = "idle";
    }
    microphoneActive = analysisActive;
    paint();
  };
  render();
  return Object.freeze({
    cancel,
    cancelWithin(element) { if (held && element.contains(held.button)) cancel(); },
    render,
    destroy() {
      destroyed = true;
      cancel({ immediate: true });
      generator.destroy();
      for (const remove of listeners) remove();
    },
  });
}
