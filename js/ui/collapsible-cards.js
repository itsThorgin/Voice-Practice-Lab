import { createFrequencyHelpController } from "./target-controls.js";

const cardSelector = ".tuner-card, .target-card, .match-card, .target-wave-card, .pitch-history-card, .waveform-card, .spectrum-card, .recording-card, .settings-card, .metronome-card, .noise-card";

// Move existing nodes so presentation controllers keep their elements and listeners.
export function createCollapsibleCards({ root, onCollapse = () => {}, windowTarget = window }) {
  const document = root.ownerDocument;
  const disposers = [];
  for (const card of root.querySelectorAll(cardSelector)) {
    card.dataset.practicePanel = "";
    const title = card.querySelector("h2");
    const eyebrow = card.querySelector(".eyebrow");
    const oldParents = [title.parentElement, eyebrow.parentElement];
    const heading = document.createElement("header");
    heading.className = "panel-heading";
    const label = document.createElement("div");
    label.className = "panel-heading__title";
    label.append(eyebrow, title);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button-secondary panel-toggle";
    toggle.setAttribute("aria-describedby", title.id);
    const chevron = document.createElement("span");
    chevron.className = "panel-chevron";
    chevron.setAttribute("aria-hidden", "true");
    toggle.append(chevron);
    const actions = document.createElement("div");
    actions.className = "panel-heading__actions";
    let helpButton = card.querySelector("[data-frequency-help-button]");
    let helpPanel = card.querySelector("[data-frequency-help]");
    const existingHelp = Boolean(helpButton);
    const helpContent = [...card.querySelectorAll("[data-help-content]")];
    if (!existingHelp && helpContent.length) {
      helpButton = document.createElement("button");
      helpButton.type = "button";
      helpButton.textContent = "?";
      helpPanel = document.createElement("aside");
      helpPanel.id = `${title.id}-help`;
      helpPanel.tabIndex = -1;
      helpPanel.hidden = true;
      card.append(helpPanel);
    }
    if (helpButton) {
      helpButton.className = "button-secondary help-button panel-help-toggle";
      helpButton.setAttribute("aria-label", `Help for ${eyebrow.textContent.trim()}`);
      helpButton.setAttribute("aria-controls", helpPanel.id);
      helpPanel.classList.add("panel-help");
      helpPanel.setAttribute("aria-label", `${eyebrow.textContent.trim()} help`);
      helpPanel.append(...helpContent);
      actions.append(helpButton);
      if (!existingHelp) {
        const help = createFrequencyHelpController({ button: helpButton, panel: helpPanel });
        disposers.push(() => help.destroy());
      }
    }
    actions.append(toggle);
    heading.append(label, actions);
    const body = document.createElement("div");
    body.className = "panel-body";
    body.id = `${title.id}-content`;
    toggle.setAttribute("aria-controls", body.id);
    body.append(...card.childNodes);
    const shortcut = body.querySelector("[data-tone-shortcut]");
    if (shortcut) {
      const toolbar = document.createElement("div");
      toolbar.className = "panel-reference";
      toolbar.append(shortcut);
      body.append(toolbar);
    }
    // Strip emptied presentation wrappers after moving help, titles and shortcuts.
    for (const parent of [...oldParents, ...body.querySelectorAll(".card-title-row, header, .waveform-card__header")]) {
      let empty = parent;
      while (empty && empty !== body && empty !== card && !empty.textContent.trim()
        && !empty.querySelector("button, input, select, canvas, [data-tuner-state]")) {
        const next = empty.parentElement; empty.remove(); empty = next;
      }
    }
    if (helpPanel) helpPanel.remove();
    card.append(heading);
    if (helpPanel) card.append(helpPanel);
    card.append(body);
    const paint = () => {
      toggle.setAttribute("aria-expanded", String(!body.hidden));
      toggle.setAttribute("aria-label", `${body.hidden ? "Expand" : "Collapse"} ${eyebrow.textContent.trim()}`);
      toggle.title = body.hidden ? "Expand card" : "Collapse card";
      card.dataset.collapsed = String(body.hidden);
    };
    const change = () => {
      if (!body.hidden) {
        onCollapse(card);
        if (helpPanel && !helpPanel.hidden) helpButton.click();
      }
      body.hidden = !body.hidden;
      paint();
      if (!body.hidden) windowTarget.dispatchEvent(new windowTarget.Event("resize"));
    };
    paint();
    toggle.addEventListener("click", change);
    disposers.push(() => toggle.removeEventListener("click", change));
  }
  return Object.freeze({ destroy() { for (const dispose of disposers) dispose(); } });
}
