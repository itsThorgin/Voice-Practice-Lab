// Keep only the latest summary; fast visual updates must not queue spoken frames.
export function createSummaryWriter({ write, now = () => performance.now(),
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, intervalMs = 1500 }) {
  let lastAt = -Infinity, lastText = "", pending = "", timer = null, destroyed = false;
  const flush = () => {
    timer = null;
    if (destroyed || pending === lastText) return;
    lastText = pending; lastAt = now(); write(pending);
  };
  return Object.freeze({
    update(text) {
      if (destroyed) return;
      pending = text;
      if (pending === lastText) {
        if (timer !== null) clearTimeoutFn(timer);
        timer = null; return;
      }
      if (timer !== null) return;
      const delay = intervalMs - (now() - lastAt);
      if (delay <= 0) flush();
      else timer = setTimeoutFn(flush, delay);
    },
    clear() {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null; pending = lastText = ""; write("");
    },
    destroy() { destroyed = true; if (timer !== null) clearTimeoutFn(timer); timer = null; pending = ""; },
  });
}

// Capture before disabling a focused control: browsers may blur it immediately.
// Never move focus if the person has already moved elsewhere.
export function preserveControlFocus(root, candidates) {
  const doc = root.ownerDocument, previous = doc?.activeElement;
  return () => {
    if (!previous || !root.contains(previous) || doc.hidden
      || (doc.activeElement !== previous && doc.activeElement !== doc.body)
      || (!previous.disabled && !previous.closest("[hidden]"))) return;
    candidates.find((node) => node && !node.disabled && !node.closest("[hidden]"))?.focus();
  };
}

export function createAccessibleSummaries({ root, documentTarget = document, windowTarget = window }) {
  const find = (name) => root.querySelector(`[data-${name}]`);
  const tuner = find("tuner"), practice = find("match-controls");
  const output = find("accessible-summary");
  const writer = createSummaryWriter({ write: (text) => { if (output.textContent !== text) output.textContent = text; } });
  const visible = (node) => node && !node.closest("[hidden]");
  let practiceChanged = false, suspended = false;
  const refresh = () => {
    if (suspended || documentTarget.hidden) { writer.clear(); return; }
    if (visible(practice) && visible(find("match-status")) && (practice.dataset.status === "running" || practiceChanged)) {
      const target = find("match-target").textContent;
      writer.update(`${target} ${find("match-status").textContent}`);
    } else if (visible(tuner) && visible(find("tuner-live-status"))) {
      const steady = visible(find("live-status")) && find("live-status").textContent === "Steady hold";
      writer.update(`${find("tuner-live-status").textContent}${steady ? " Steady hold." : ""}`);
    } else writer.clear();
  };
  const observer = new windowTarget.MutationObserver((records) => {
    practiceChanged = records.some(({ target }) => find("match-status").contains(target) || find("match-target").contains(target));
    refresh();
  });
  for (const name of ["tuner-live-status", "match-status", "match-target", "live-status"]) {
    observer.observe(find(name), { childList: true, characterData: true, subtree: true });
  }
  // Closing a card also cancels any pending speech from its now-hidden body.
  const visibilityObserver = new windowTarget.MutationObserver(refresh);
  visibilityObserver.observe(root, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  documentTarget.addEventListener("visibilitychange", refresh);
  const clear = () => { suspended = true; writer.clear(); };
  const resume = () => { suspended = false; practiceChanged = false; };
  windowTarget.addEventListener("pagehide", clear);
  windowTarget.addEventListener("pageshow", resume);
  return Object.freeze({ destroy() {
    observer.disconnect(); visibilityObserver.disconnect(); writer.destroy();
    documentTarget.removeEventListener("visibilitychange", refresh); windowTarget.removeEventListener("pagehide", clear);
    windowTarget.removeEventListener("pageshow", resume);
  } });
}
