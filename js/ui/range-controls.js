import { midiToNote } from "../music/notes.js";
import {
  createVocalRange, vocalRangeFromPreset, VOCAL_RANGE_MIN_MIDI,
  VOCAL_RANGE_MAX_MIDI, VOCAL_RANGE_PRESETS,
} from "../music/vocal-range.js";

export function createRangeControls({ root, getRange, onChange, canChange = () => true }) {
  const find = (name) => root.querySelector(`[data-range-${name}]`);
  const low = find("low");
  const high = find("high");
  const preset = find("preset");
  const summary = find("summary");
  const error = find("error");
  const listeners = [];
  const addOption = (select, value, label) => {
    const option = root.ownerDocument.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  };
  for (const select of [low, high]) {
    select.replaceChildren();
    for (let midi = VOCAL_RANGE_MIN_MIDI; midi <= VOCAL_RANGE_MAX_MIDI; midi += 1) {
      const note = midiToNote(midi);
      addOption(select, note, note);
    }
    select.disabled = false;
  }
  preset.replaceChildren();
  addOption(preset, "", "Exact range (manual or saved)");
  for (const entry of VOCAL_RANGE_PRESETS) addOption(preset, entry.id, entry.label);
  preset.disabled = false;

  const clearFeedback = () => { error.textContent = ""; };
  const render = (value = getRange()) => {
    const range = createVocalRange(value);
    low.value = range.lowNote;
    high.value = range.highNote;
    preset.value = "";
    summary.textContent = `Exercise range: ${range.lowNote}–${range.highNote}, inclusive. Free tuner listens outside this range too.`;
  };
  const commit = (makeRange, presetId = "") => {
    if (!canChange()) {
      render();
      error.textContent = "Session cleanup is in progress. Try again when it finishes.";
      return;
    }
    try {
      const next = makeRange();
      onChange(next);
      render();
      preset.value = presetId;
      clearFeedback();
    } catch (failure) {
      render();
      error.textContent = `${failure.message} Your previous range is unchanged.`;
    }
  };
  const listen = (element, callback) => {
    element.addEventListener("change", callback);
    listeners.push(() => element.removeEventListener("change", callback));
  };
  for (const select of [low, high]) {
    listen(select, () => commit(() => createVocalRange({ lowNote: low.value, highNote: high.value })));
  }
  listen(preset, () => {
    const id = preset.value;
    if (id) commit(() => vocalRangeFromPreset(id), id);
  });
  render();
  return Object.freeze({ render, clearFeedback, destroy() { for (const remove of listeners) remove(); } });
}
