import { createTargetState } from "./target-note.js";
import { createVocalRange } from "../music/vocal-range.js";

// Current transient cleanup lives in clearSession. Future exercise phases
// must extend that callback when they introduce additional in-memory resources.
export function createSessionActions({ preferences, stopAudio, clearSession, setTarget, setVocalRange = () => {}, resetToolSettings = () => {} }) {
  let busy = false;
  const reset = async (deletePreferences) => {
    if (busy) return { status: "busy" };
    busy = true;
    const pending = [];
    const attempt = (action) => {
      try { pending.push(Promise.resolve(action())); }
      catch (error) { pending.push(Promise.reject(error)); }
    };
    let storage = null;
    try {
      // Invoke every cleanup immediately, even if an earlier one fails. Do not
      // postpone defaults/removal until an old microphone stop promise settles.
      attempt(stopAudio);
      attempt(clearSession);
      if (deletePreferences) {
        attempt(resetToolSettings);
        attempt(() => setTarget(createTargetState()));
        attempt(() => setVocalRange(createVocalRange()));
        try { storage = preferences.clear(); }
        catch { storage = { status: "unavailable" }; }
      }
      const settled = await Promise.allSettled(pending);
      const cleanupFailed = settled.some((result) => result.status === "rejected");
      return { status: cleanupFailed ? "cleanup-failed" : "complete", storage };
    } finally { busy = false; }
  };
  return Object.freeze({
    isBusy: () => busy,
    clearSavedSettings: () => busy ? { status: "busy" } : preferences.clear(),
    resetSession: () => reset(false),
    deleteAll({ confirmed = false } = {}) {
      return confirmed === true ? reset(true) : Promise.resolve({ status: "confirmation-required" });
    },
  });
}
