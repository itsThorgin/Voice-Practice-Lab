import { createScaleSequence, SCALE_LABELS } from "../music/scales.js";
import { midiToNote } from "../music/notes.js";
import { displayScore, displayPracticeAverage } from "./score-format.js";
import { renderNoteResults } from "./result-presentation.js";

export function createScaleControls({ root, session, getContext, editable, onConfigure, onNavigate }) {
  const find = (name) => root.querySelector(`[data-scale-${name}]`);
  const fields = Object.fromEntries(["root", "type", "direction"].map((name) => [name, find(name)]));
  const next = find("next"), back = find("back"), sequenceList = find("sequence");
  let error = "", painted = "";
  if (root.ownerDocument) {
    fields.root.replaceChildren(...Array.from({ length: 108 }, (_, i) => {
      const option = root.ownerDocument.createElement("option"); option.value = String(i + 12); option.textContent = midiToNote(i + 12); return option;
    }));
  }
  const warning = () => {
    try { createScaleSequence(session.getSettings(), getContext().range); return error; }
    catch (failure) { return failure.message; }
  };
  const configure = () => {
    if (!editable() || session.getState().status === "running") { onConfigure(); return; }
    try {
      session.configure({ rootMidi: Number(fields.root.value), type: fields.type.value, direction: fields.direction.value }); error = "";
    } catch (failure) { error = failure.message; }
    onConfigure();
  };
  const moveNext = () => onNavigate(1), moveBack = () => onNavigate(-1);
  for (const field of Object.values(fields)) field.addEventListener("change", configure);
  next.addEventListener("click", moveNext); back.addEventListener("click", moveBack);
  return Object.freeze({
    warning, clearError() { error = ""; },
    render(active, referenceBlocked) {
      find("options").hidden = !active; find("results").hidden = !active;
      find("score-details").hidden = !active;
      const state = session.getState(), settings = session.getSettings();
      for (const [key, field] of Object.entries(fields)) {
        field.value = String(settings[key === "root" ? "rootMidi" : key]);
        field.disabled = !editable() || state.status === "running";
      }
      const unavailable = !editable() || !getContext().microphoneActive || referenceBlocked || Boolean(warning());
      next.disabled = unavailable || !session.canNavigate(1, getContext());
      back.disabled = unavailable || !session.canNavigate(-1, getContext());
      next.textContent = state.sequence && state.index === state.sequence.length - 1 ? "Finish without matching" : "Next note (skip)";
      if (!active) { renderNoteResults(find("score-list"), []); return; }
      if (find("error").textContent !== warning()) find("error").textContent = warning();
      const direction = { ascending: "Ascending", descending: "Descending", "up-down": "Up then down" }[settings.direction];
      find("description").textContent = `${SCALE_LABELS[settings.type]} · ${direction}. Lower tonic ${midiToNote(settings.rootMidi)}; descending starts one octave above it.`;
      let notes = [];
      try { notes = state.sequence ?? createScaleSequence(settings, getContext().range); } catch { /* Visible range warning. */ }
      const statuses = notes.map((_, index) => state.results[index]?.outcome ?? "waiting");
      const signature = JSON.stringify([notes, statuses, state.index, state.traversalFinished]);
      if (painted !== signature && root.ownerDocument) {
        painted = signature;
        sequenceList.replaceChildren(...notes.map((name, index) => {
          const item = root.ownerDocument.createElement("li");
          const current = index === state.index && !state.traversalFinished;
          item.textContent = `${index + 1}. ${name} · ${current ? "current" : statuses[index]}`;
          item.className = current ? "is-current" : `is-${statuses[index]}`;
          if (current) item.setAttribute("aria-current", "step");
          return item;
        }));
      }
      const summaryText = state.sequence
        ? `${state.traversalFinished ? state.allMatched ? "Every note matched" : "Scale finished with skipped notes" : `Note ${state.index + 1} of ${state.sequence.length}`}`
        : "No scale result yet. Start begins at the first note.";
      if (find("summary").textContent !== summaryText) find("summary").textContent = summaryText;
      find("average").textContent = `Practice average: ${displayScore(state.practiceScores.average)}`;
      find("count").textContent = `${state.matched} matched · ${state.skipped} skipped`;
      find("average-details").textContent = `Average accuracy: ${displayScore(state.averageScore)} (${state.scoredCount} measured notes). ${displayPracticeAverage(state.practiceScores)} Current measured notes are included; notes not attempted are excluded.`;
      renderNoteResults(find("score-list"), state.results);
      if (state.sequence && state.status === "running") {
        root.querySelector("[data-match-target]").textContent = `Note ${state.index + 1}/${state.sequence.length}: ${state.target.label} · ${state.target.frequencyHz.toFixed(2)} Hz`;
      } else {
        const label = root.querySelector("[data-match-target]"); label.textContent = label.textContent.replace("Selected target:", state.sequence ? "Scale reference:" : "First scale note:");
      }
      if (state.traversalFinished) root.querySelector("[data-match-status]").textContent = state.allMatched
        ? "Scale complete! Every note matched steadily."
        : "Scale finished with skipped notes. Back lets you revisit notes; Retry starts the whole scale again.";
    },
    destroy() {
      for (const field of Object.values(fields)) field.removeEventListener("change", configure);
      next.removeEventListener("click", moveNext); back.removeEventListener("click", moveBack);
    },
  });
}
