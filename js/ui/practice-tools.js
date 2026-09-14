import { createPracticeOutput } from "../audio/practice-output.js";
import { rhythmSettings, volumeGain } from "../practice/rhythm.js";
import { preserveControlFocus } from "./accessibility.js";

export function createPracticeTools({ root, AudioContextClass, canStart = () => true,
  windowTarget = window, documentTarget = document, createOutput = createPracticeOutput }) {
  const find = (name) => root.querySelector(`[data-${name}]`);
  const metroCard = find("metronome");
  const noiseCard = find("noise");
  const listeners = [];
  const listen = (element, event, fn) => {
    element.addEventListener(event, fn);
    listeners.push(() => element.removeEventListener(event, fn));
  };
  const initial = new Map([...metroCard.querySelectorAll("input, select"),
    ...noiseCard.querySelectorAll("input, select")].map((input) => [input, { value: input.value, checked: input.checked }]));
  const noiseDefaults = { white: "0.50", pink: "0.50", brown: "2.00" };
  const noiseVolumes = { ...noiseDefaults };
  let selectedNoise = "white", pulseSerial = 0;
  const motion = windowTarget.matchMedia?.("(prefers-reduced-motion: reduce)");
  const pulseCards = () => find("metro-extend").checked
    ? [...root.querySelectorAll("[data-practice-panel]")]
    : [metroCard];
  const clearPulse = () => {
    for (const card of root.querySelectorAll("[data-practice-glow]")) {
      delete card.dataset.practiceGlow; delete card.dataset.practicePulse;
    }
  };
  const beat = (event) => {
    if (!find("metro-visual").checked) return;
    find("metro-beat").textContent = String(find("metro-mode").value === "speech" ? (event.count - 1) % 4 + 1 : event.beat);
    if (motion?.matches || find("metro-reduced").checked) return;
    // A narrow edge and outer halo pulse once per main beat. Reduced motion
    // keeps only the beat label; high-tempo cues are not decimated.
    for (const card of pulseCards()) {
      card.dataset.practiceGlow = find("metro-intensity").value;
      card.dataset.practicePulse = String(pulseSerial % 2);
    }
    pulseSerial++;
  };
  const paintState = (kind, state) => {
    const restoreFocus = preserveControlFocus(kind === "metro" ? metroCard : noiseCard,
      [find(`${kind}-stop`), find(`${kind}-start`), find(`${kind}-status`)]);
    const busy = ["starting", "playing"].includes(state);
    find(`${kind}-start`).disabled = busy;
    find(`${kind}-stop`).disabled = !busy;
    find(`${kind}-status`).textContent = {
      idle: "Stopped.", starting: "Starting…", playing: "Playing.",
      error: "Audio could not start. Try Start again or use visual cues only.",
      interrupted: "Stopped by the browser. Press Start when ready.",
    }[state];
    if (kind === "noise" && state === "error") find("noise-status").textContent = "Noise could not start. Try Start again in a current browser over HTTPS or localhost.";
    if (kind === "metro" && !busy) { clearPulse(); find("metro-beat").textContent = "Ready"; }
    restoreFocus();
  };
  const make = (kind) => createOutput({ AudioContextClass,
    isVisible: () => !documentTarget.hidden,
    onState: (state) => paintState(kind, state), onBeat: beat });
  const metro = make("metro"), noise = make("noise");
  const rhythm = () => rhythmSettings({
    mode: find("metro-mode").value, bpm: find("metro-bpm").value,
    groups: find("metro-pattern").value === "custom" ? find("metro-groups").value : find("metro-pattern").value,
    subdivision: find("metro-subdivision").value, accents: find("metro-accent").checked,
    preset: find("metro-preset").value, pace: find("metro-pace").value,
  });
  const updateMode = () => {
    const speech = find("metro-mode").value === "speech";
    find("metro-music").hidden = speech;
    find("metro-speech").hidden = !speech;
    find("metro-custom").hidden = find("metro-pattern").value !== "custom";
    const settings = rhythm();
    find("metro-summary").textContent = settings ? speech
      ? `Target pace: ${settings.wpm} WPM · One pulse per target word.`
      : `${settings.bpm} BPM · ${settings.groups.join(" + ")} beats · ${settings.subdivision} ${settings.subdivision === 1 ? "pulse" : "pulses"} per beat.`
      : "Use 20–300 BPM and beat groups from 1 to 16, with at most 16 beats in total.";
    find("metro-bpm").setAttribute("aria-invalid", String(!speech && (!Number.isFinite(Number(find("metro-bpm").value)) || Number(find("metro-bpm").value) < 20 || Number(find("metro-bpm").value) > 300)));
    find("metro-groups").setAttribute("aria-invalid", String(!settings && !speech));
    return settings;
  };
  const startMetro = () => {
    if (!canStart()) return;
    const settings = updateMode();
    const volume = volumeGain(find("metro-volume").value);
    if (!settings || volume === null) { metro.stop(); find("metro-status").textContent = "Check the tempo, beat groups, and volume."; return; }
    if (!find("metro-sound").checked && !find("metro-visual").checked) {
      metro.stop(); find("metro-status").textContent = "Turn on sound or visual cues first."; return;
    }
    void metro.start({ kind: "metronome", rhythm: settings, volume,
      sound: find("metro-sound").checked, voice: find("metro-voice").value });
  };
  const startNoise = () => {
    if (!canStart()) return;
    const volume = volumeGain(find("noise-volume").value);
    if (volume === null) { noise.stop(); find("noise-status").textContent = "Enter a volume from 0 to 100 with up to two decimal places."; return; }
    void noise.start({ kind: "noise", noise: selectedNoise, volume, sound: !find("noise-mute").checked });
  };
  const running = (output) => ["starting", "playing"].includes(output.getState());
  const volumeControls = (kind, output) => {
    const number = find(`${kind}-volume`), slider = find(`${kind}-volume-range`);
    const apply = (source) => {
      const gain = volumeGain(source.value);
      number.setAttribute("aria-invalid", String(gain === null));
      if (gain === null) {
        output.stop(); find(`${kind}-status`).textContent = "Enter a volume from 0 to 100 with up to two decimal places.";
        return;
      }
      const formatted = (gain * 100).toFixed(2);
      if (source !== number) number.value = formatted;
      slider.value = formatted;
      if (kind === "noise") noiseVolumes[selectedNoise] = formatted;
      output.setLevel(gain, kind === "metro" ? find("metro-sound").checked : !find("noise-mute").checked);
    };
    listen(number, "input", () => apply(number)); listen(slider, "input", () => apply(slider));
    listen(number, "change", () => { const gain = volumeGain(number.value); if (gain !== null) number.value = (gain * 100).toFixed(2); });
  };
  volumeControls("metro", metro); volumeControls("noise", noise);
  listen(find("metro-start"), "click", startMetro);
  listen(find("metro-stop"), "click", () => metro.stop());
  listen(find("noise-start"), "click", startNoise);
  listen(find("noise-stop"), "click", () => noise.stop());
  for (const name of ["mode", "pattern", "groups", "subdivision", "accent", "preset", "pace", "voice", "bpm"]) {
    listen(find(`metro-${name}`), "change", () => { updateMode(); if (running(metro)) startMetro(); });
  }
  listen(find("metro-bpm-range"), "input", () => {
    find("metro-bpm").value = find("metro-bpm-range").value;
    updateMode();
  });
  listen(find("metro-bpm-range"), "change", () => { if (running(metro)) startMetro(); });
  listen(find("metro-bpm"), "change", () => { if (rhythm()) find("metro-bpm-range").value = find("metro-bpm").value; });
  listen(find("metro-sound"), "change", () => {
    if (find("metro-sound").checked && running(metro)) { startMetro(); return; }
    metro.setLevel(volumeGain(find("metro-volume").value) ?? 0, find("metro-sound").checked);
    if (!find("metro-sound").checked && !find("metro-visual").checked) metro.stop();
  });
  listen(find("noise-mute"), "change", () => noise.setLevel(volumeGain(find("noise-volume").value) ?? 0, !find("noise-mute").checked));
  listen(find("metro-visual"), "change", () => {
    clearPulse(); find("metro-cue").hidden = !find("metro-visual").checked;
    if (!find("metro-visual").checked && !find("metro-sound").checked) metro.stop();
  });
  for (const name of ["extend", "reduced", "intensity"]) listen(find(`metro-${name}`), "change", clearPulse);
  if (motion?.addEventListener) listen(motion, "change", clearPulse);
  const tabs = [...noiseCard.querySelectorAll("[data-noise-tab]")];
  const selectNoise = (tab) => {
    selectedNoise = tab.dataset.noiseTab;
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected)); item.tabIndex = selected ? 0 : -1;
      find(`noise-${item.dataset.noiseTab}-panel`).hidden = !selected;
    }
    find("noise-volume").value = noiseVolumes[selectedNoise];
    find("noise-volume-range").value = noiseVolumes[selectedNoise];
    find("noise-volume").setAttribute("aria-invalid", "false");
    find("noise-active-label").textContent = `${selectedNoise[0].toUpperCase()}${selectedNoise.slice(1)} noise`;
  };
  for (const [index, tab] of tabs.entries()) {
    const change = () => { const wasPlaying = running(noise); selectNoise(tab); if (wasPlaying) startNoise(); };
    listen(tab, "click", change);
    listen(tab, "keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); tabs[next].focus(); tabs[next].click();
    });
  }
  const stop = () => { metro.stop({ immediate: true }); noise.stop({ immediate: true }); clearPulse(); };
  listen(documentTarget, "visibilitychange", () => { if (documentTarget.hidden) stop(); });
  listen(windowTarget, "pagehide", stop);
  const resetSettings = () => {
    stop();
    for (const [input, value] of initial) { input.value = value.value; input.checked = value.checked; input.removeAttribute("aria-invalid"); }
    Object.assign(noiseVolumes, noiseDefaults);
    selectNoise(tabs[0]); updateMode(); find("metro-cue").hidden = false;
  };
  updateMode(); paintState("metro", "idle"); paintState("noise", "idle");
  return Object.freeze({ stop, resetSettings,
    destroy() { stop(); metro.destroy(); noise.destroy(); for (const remove of listeners) remove(); },
  });
}
