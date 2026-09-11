import { createVocalRange } from "./music/vocal-range.js";

export const MICROPHONE_STATUS = Object.freeze({
  ACTIVE: "active",
  ERROR: "error",
  IDLE: "idle",
  PAUSED: "paused",
  REQUESTING: "requesting",
  RESUME_REQUIRED: "resume-required",
  STOPPING: "stopping",
  UNSUPPORTED: "unsupported",
});

const INITIAL_MICROPHONE_STATE = Object.freeze({
  errorCode: null,
  message: "Microphone is off.",
  status: MICROPHONE_STATUS.IDLE,
  usingFallback: false,
});

function freezeState(state) {
  return Object.freeze({
    ...state,
    microphone: Object.isFrozen(state.microphone)
      ? state.microphone
      : Object.freeze({ ...state.microphone }),
    target:
      state.target === null || Object.isFrozen(state.target)
        ? state.target
        : Object.freeze({ ...state.target }),
  });
}

export function createAppState(initialState = {}) {
  let state = freezeState({
    ...initialState,
    microphone: {
      ...INITIAL_MICROPHONE_STATE,
      ...initialState.microphone,
    },
    target: initialState.target ?? null,
    vocalRange: createVocalRange(initialState.vocalRange),
  });
  const listeners = new Set();

  return Object.freeze({
    getState() {
      return state;
    },

    setMicrophone(microphone) {
      state = freezeState({ ...state, microphone });
      for (const listener of listeners) {
        listener(state);
      }
      return state;
    },

    setTarget(target) {
      if (target === null || typeof target !== "object") {
        throw new TypeError("Target state must be an object.");
      }
      state = freezeState({ ...state, target });
      for (const listener of listeners) {
        listener(state);
      }
      return state;
    },

    setVocalRange(value) {
      state = freezeState({ ...state, vocalRange: createVocalRange(value) });
      for (const listener of listeners) listener(state);
      return state;
    },

    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("State listener must be a function.");
      }

      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
