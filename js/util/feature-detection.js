export function detectMicrophoneSupport(environment = globalThis) {
  const mediaDevices = environment.navigator?.mediaDevices;
  const AudioContextClass = environment.AudioContext ?? environment.webkitAudioContext;
  const secureContext = environment.isSecureContext !== false;
  const hasGetUserMedia = typeof mediaDevices?.getUserMedia === "function";
  const hasAudioContext = typeof AudioContextClass === "function";

  let reason = null;
  if (!secureContext) {
    reason = "insecure-context";
  } else if (!hasGetUserMedia) {
    reason = "media-devices-unavailable";
  } else if (!hasAudioContext) {
    reason = "audio-context-unavailable";
  }

  return Object.freeze({
    AudioContextClass: hasAudioContext ? AudioContextClass : null,
    getUserMedia: hasGetUserMedia ? mediaDevices.getUserMedia.bind(mediaDevices) : null,
    reason,
    supported: reason === null,
  });
}
