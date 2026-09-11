import { MICROPHONE_STATUS } from "../state.js";
import { createCleanupStack } from "../util/lifecycle.js";

export const PREFERRED_AUDIO_CONSTRAINTS = Object.freeze({
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
});

const MESSAGES = Object.freeze({
  active: "Microphone is on. Audio stays on this device and is not saved by the app.",
  activeFallback: "Microphone is on using basic device settings. Audio stays on this device.",
  denied: "Microphone permission was denied. You can keep using the page or try again.",
  ended: "The microphone disconnected or stopped unexpectedly. You can try again.",
  failed: "The microphone could not start. You can keep using the page or try again.",
  idle: "Microphone is off.",
  paused: "Microphone and analysis are paused while this page is hidden.",
  requesting: "Waiting for microphone permission…",
  resumeRequired: "Microphone is paused. Choose Resume microphone to continue.",
  stopping: "Stopping microphone…",
  unavailable: "No available microphone was found. You can still use the rest of the page.",
  unsupported: "Microphone access is unavailable in this browser or context.",
});

const CONSTRAINT_ERROR_NAMES = new Set(["ConstraintNotSatisfiedError", "OverconstrainedError"]);
const DENIED_ERROR_NAMES = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);
const UNAVAILABLE_ERROR_NAMES = new Set([
  "AbortError",
  "DevicesNotFoundError",
  "NotFoundError",
  "NotReadableError",
  "TrackStartError",
]);

function createState(status, message, options = {}) {
  return Object.freeze({
    errorCode: options.errorCode ?? null,
    message,
    status,
    usingFallback: options.usingFallback ?? false,
  });
}

export function classifyMicrophoneError(error) {
  const name = typeof error?.name === "string" ? error.name : "UnknownError";

  if (DENIED_ERROR_NAMES.has(name)) {
    return Object.freeze({ code: "permission-denied", message: MESSAGES.denied });
  }
  if (UNAVAILABLE_ERROR_NAMES.has(name)) {
    return Object.freeze({ code: "device-unavailable", message: MESSAGES.unavailable });
  }
  return Object.freeze({ code: "start-failed", message: MESSAGES.failed });
}

function canRetryWithoutPreferredConstraints(error) {
  return CONSTRAINT_ERROR_NAMES.has(error?.name);
}

export function createMicrophoneController({
  AudioContextClass,
  getUserMedia,
  isPageVisible = () => true,
  onStateChange = () => {},
} = {}) {
  const supported = typeof AudioContextClass === "function" && typeof getUserMedia === "function";
  let state = supported
    ? createState(MICROPHONE_STATUS.IDLE, MESSAGES.idle)
    : createState(MICROPHONE_STATUS.UNSUPPORTED, MESSAGES.unsupported, {
        errorCode: "unsupported",
      });
  let activeResources = null;
  let requestGeneration = 0;
  let startPromise = null;
  let startingContext = null;
  let stopPromise = null;
  let visibilityGeneration = 0;

  const updateState = (nextState) => {
    state = nextState;
    try {
      onStateChange(state);
    } catch {
      // UI failures must never prevent microphone resource cleanup.
    }
    return state;
  };

  const releaseResources = async (resources) => {
    if (!resources) {
      return [];
    }
    return resources.cleanup.dispose();
  };

  const handleUnexpectedEnd = async (resources) => {
    if (activeResources !== resources) {
      return;
    }

    requestGeneration += 1;
    visibilityGeneration += 1;
    const generation = requestGeneration;
    activeResources = null;
    await releaseResources(resources);

    if (generation !== requestGeneration) {
      return;
    }

    updateState(
      createState(MICROPHONE_STATUS.ERROR, MESSAGES.ended, {
        errorCode: "stream-ended",
      }),
    );
  };

  const requestStream = async (generation) => {
    try {
      return {
        stream: await getUserMedia({ audio: PREFERRED_AUDIO_CONSTRAINTS }),
        usingFallback: false,
      };
    } catch (error) {
      if (generation !== requestGeneration || !canRetryWithoutPreferredConstraints(error)) {
        throw error;
      }

      return {
        stream: await getUserMedia({ audio: true }),
        usingFallback: true,
      };
    }
  };

  const setTracksEnabled = (resources, enabled) => {
    const tracks = resources.stream.getAudioTracks?.() ?? resources.stream.getTracks();
    for (const track of tracks) {
      track.enabled = enabled;
    }
  };

  const requireResume = (resources) => {
    setTracksEnabled(resources, false);
    return updateState(
      createState(MICROPHONE_STATUS.RESUME_REQUIRED, MESSAGES.resumeRequired, {
        errorCode: "resume-required",
        usingFallback: resources.usingFallback,
      }),
    );
  };

  const setPageVisible = (visible) => {
    if (typeof visible !== "boolean") {
      return Promise.reject(new TypeError("Page visibility must be a boolean."));
    }

    const resources = activeResources;
    const canChangeVisibility = [
      MICROPHONE_STATUS.ACTIVE,
      MICROPHONE_STATUS.PAUSED,
      MICROPHONE_STATUS.REQUESTING,
      MICROPHONE_STATUS.RESUME_REQUIRED,
    ].includes(state.status);
    if (!resources || !canChangeVisibility) {
      return Promise.resolve(state);
    }

    visibilityGeneration += 1;
    const generation = visibilityGeneration;

    if (!visible) {
      setTracksEnabled(resources, false);
      updateState(
        createState(MICROPHONE_STATUS.PAUSED, MESSAGES.paused, {
          usingFallback: resources.usingFallback,
        }),
      );

      let operation;
      try {
        operation =
          !["suspended", "closed"].includes(resources.audioContext.state) &&
          typeof resources.audioContext.suspend === "function"
            ? resources.audioContext.suspend()
            : undefined;
      } catch {
        operation = undefined;
      }
      return Promise.resolve(operation)
        .catch(() => undefined)
        .then(() => state);
    }

    return (async () => {
      try {
        if (
          resources.audioContext.state !== "running" &&
          typeof resources.audioContext.resume === "function"
        ) {
          await resources.audioContext.resume();
        }

        if (
          generation !== visibilityGeneration ||
          resources !== activeResources ||
          !isPageVisible()
        ) {
          return state;
        }

        if (resources.audioContext.state !== "running") {
          return requireResume(resources);
        }
        setTracksEnabled(resources, true);
        return updateState(
          createState(
            MICROPHONE_STATUS.ACTIVE,
            resources.usingFallback ? MESSAGES.activeFallback : MESSAGES.active,
            { usingFallback: resources.usingFallback },
          ),
        );
      } catch {
        if (generation !== visibilityGeneration || resources !== activeResources) {
          return state;
        }

        return requireResume(resources);
      }
    })();
  };

  const performStart = async (generation) => {
    const cleanup = createCleanupStack();

    try {
      const audioContext = new AudioContextClass();
      startingContext = { audioContext, generation };
      cleanup.add(() => {
        if (audioContext.state !== "closed") {
          return audioContext.close();
        }
        return undefined;
      });

      if (audioContext.state !== "running") {
        await audioContext.resume();
      }

      if (generation !== requestGeneration) {
        await cleanup.dispose();
        return state;
      }

      const streamResult = await requestStream(generation);
      const stream = streamResult.stream;
      const tracks = stream.getTracks();
      for (const track of tracks) {
        cleanup.add(() => track.stop());
      }

      if (generation !== requestGeneration) {
        await cleanup.dispose();
        return state;
      }

      const sourceNode = audioContext.createMediaStreamSource(stream);
      cleanup.add(() => sourceNode.disconnect());

      const resources = {
        audioContext,
        cleanup,
        sourceNode,
        stream,
        usingFallback: streamResult.usingFallback,
      };
      const onEnded = () => {
        void handleUnexpectedEnd(resources);
      };

      for (const track of tracks) {
        track.addEventListener?.("ended", onEnded);
        cleanup.add(() => track.removeEventListener?.("ended", onEnded));
      }
      stream.addEventListener?.("inactive", onEnded);
      cleanup.add(() => stream.removeEventListener?.("inactive", onEnded));
      const onContextStateChange = () => {
        if (activeResources !== resources) return;
        if (audioContext.state === "closed") {
          void handleUnexpectedEnd(resources);
        } else if (audioContext.state === "running" && !isPageVisible()) {
          // A delayed browser/OS recovery must not keep a hidden context running.
          void setPageVisible(false);
        } else if (state.status === MICROPHONE_STATUS.ACTIVE && audioContext.state !== "running") {
          // OS/device interruptions can happen while the page remains visible.
          // A later running event must not restart recording or analysis by itself.
          visibilityGeneration += 1;
          if (isPageVisible()) requireResume(resources);
          else void setPageVisible(false);
        }
      };
      audioContext.addEventListener?.("statechange", onContextStateChange);
      cleanup.add(() => audioContext.removeEventListener?.("statechange", onContextStateChange));

      if (generation !== requestGeneration) {
        await cleanup.dispose();
        return state;
      }

      activeResources = resources;
      if (!isPageVisible()) {
        return setPageVisible(false);
      }
      // A permission prompt can outlive the initial gesture-based resume.
      if (audioContext.state !== "running") {
        return requireResume(resources);
      }
      return updateState(
        createState(
          MICROPHONE_STATUS.ACTIVE,
          streamResult.usingFallback ? MESSAGES.activeFallback : MESSAGES.active,
          { usingFallback: streamResult.usingFallback },
        ),
      );
    } catch (error) {
      if (activeResources?.cleanup === cleanup) {
        activeResources = null;
      }
      await cleanup.dispose();

      if (generation !== requestGeneration) {
        return state;
      }

      const failure = classifyMicrophoneError(error);
      return updateState(
        createState(MICROPHONE_STATUS.ERROR, failure.message, {
          errorCode: failure.code,
        }),
      );
    } finally {
      if (startingContext?.generation === generation) startingContext = null;
    }
  };

  const start = () => {
    if (!supported || activeResources) {
      return Promise.resolve(state);
    }
    if (startPromise) {
      return startPromise;
    }
    if (stopPromise) {
      return stopPromise;
    }

    requestGeneration += 1;
    visibilityGeneration += 1;
    const generation = requestGeneration;
    updateState(createState(MICROPHONE_STATUS.REQUESTING, MESSAGES.requesting));
    const operation = performStart(generation);
    startPromise = operation;
    const clearStartPromise = () => {
      if (startPromise === operation) {
        startPromise = null;
      }
    };
    void operation.then(clearStartPromise, clearStartPromise);
    return operation;
  };

  const stop = () => {
    if (stopPromise) {
      return stopPromise;
    }
    if (state.status === MICROPHONE_STATUS.UNSUPPORTED || state.status === MICROPHONE_STATUS.IDLE) {
      return Promise.resolve(state);
    }

    requestGeneration += 1;
    visibilityGeneration += 1;
    updateState(createState(MICROPHONE_STATUS.STOPPING, MESSAGES.stopping));
    const resources = activeResources;
    activeResources = null;
    const pendingContext = startingContext?.audioContext;
    startingContext = null;
    // getUserMedia has no cancellation API. Invalidate the old request and
    // release its context now; a late grant is stopped by performStart.
    startPromise = null;

    const operation = (async () => {
      const pending = [releaseResources(resources)];
      if (pendingContext && pendingContext !== resources?.audioContext && pendingContext.state !== "closed") {
        try { pending.push(Promise.resolve(pendingContext.close())); } catch { /* A late start still owns cleanup. */ }
      }
      await Promise.allSettled(pending);
      return updateState(createState(MICROPHONE_STATUS.IDLE, MESSAGES.idle));
    })();

    stopPromise = operation;
    const clearStopPromise = () => {
      if (stopPromise === operation) {
        stopPromise = null;
      }
    };
    void operation.then(clearStopPromise, clearStopPromise);
    return operation;
  };

  return Object.freeze({
    getResources() {
      if (!activeResources) {
        return null;
      }
      return Object.freeze({
        audioContext: activeResources.audioContext,
        sourceNode: activeResources.sourceNode,
        stream: activeResources.stream,
      });
    },
    getState() {
      return state;
    },
    setPageVisible,
    start,
    stop,
  });
}
