import { displayScore, displayPracticeBreakdown } from "./score-format.js";

// Presentation only: never infer completion or a grade from a numeric score.
export function resultOutcome(result) {
  if (!result || result.status === "idle") return { label: "Not attempted", tone: "neutral" };
  if (result.outcome === "skipped") return { label: "Skipped", tone: "partial" };
  if (result.status === "complete") return { label: "Matched", tone: "complete" };
  if (result.status === "running") return { label: "In progress", tone: "active" };
  if (!result.metrics.sampleCount) return { label: "No pitch detected", tone: "neutral" };
  if (result.scoring?.total === null) return { label: "Not enough pitch data", tone: "neutral" };
  const labels = { timeout: "Time is up", stopped: "Attempt stopped", interrupted: "Interrupted", "settings-changed": "Settings changed" };
  return { label: labels[result.reason] ?? "Attempt ended", tone: "partial" };
}

export function displayPoints(part) {
  return !part || part.points === null ? "-" : `${part.points.toFixed(1)} / ${Math.round(part.weight * 100)}`;
}

export function noteSummary(result, label = result?.target?.label ?? "Note") {
  const outcome = resultOutcome(result);
  return `${label} · ${outcome.label} · ${result?.scoring?.total == null ? "No score" : displayScore(result.scoring.total)}`;
}

const lists = new WeakMap();
// Reuse disclosure nodes during live updates to retain focus and open state.
export function renderNoteResults(container, results) {
  if (!container.ownerDocument) {
    container.textContent = results.map((row, i) => noteSummary(row, `${i + 1}. ${row.target.label}`)).join("\n");
    return;
  }
  let nodes = lists.get(container);
  if (!nodes) { nodes = []; lists.set(container, nodes); container.replaceChildren(); }
  while (nodes.length > results.length) nodes.pop().item.remove();
  results.forEach((row, index) => {
    if (!nodes[index]) {
      const doc = container.ownerDocument, item = doc.createElement("li"), details = doc.createElement("details");
      const summary = doc.createElement("summary"), text = doc.createElement("span"), score = doc.createElement("span"), body = doc.createElement("p");
      details.className = "note-result"; score.className = "note-result__score";
      summary.append(text, score); details.append(summary, body); item.append(details); container.append(item);
      nodes.push({ item, details, text, score, body });
    }
    const node = nodes[index], outcome = resultOutcome(row);
    const write = (element, text) => { if (element.textContent !== text) element.textContent = text; };
    node.details.dataset.outcome = outcome.tone;
    write(node.text, `${index + 1}. ${row.target.label} · ${outcome.label}`);
    write(node.score, row.scoring?.total == null ? "No score" : displayScore(row.scoring.total));
    write(node.body, displayPracticeBreakdown(row.scoring));
  });
}
