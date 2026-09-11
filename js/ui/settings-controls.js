import { preserveControlFocus } from "./accessibility.js";

const storageMessages = Object.freeze({
  empty: "Target, tuning, and exercise range changes are saved on this device. Audio and pitch history are never saved.",
  loaded: "",
  saved: "Target, tuning, and exercise range settings saved on this device.",
  invalid: "Saved settings could not be used. Defaults loaded; choose your settings again.",
  "invalid-save": "Settings could not be saved. Current session settings are still available.",
  "unsupported-version": "Saved settings use an unsupported version. Defaults loaded.",
  unavailable: "Browser storage is unavailable. Changes work for this session but may not survive a reload.",
  cleared: "Saved app settings removed. Current settings are unchanged; changing them again will save them.",
  busy: "Session cleanup is in progress.",
});

export function createSettingsControls({ root, actions, initialStorageStatus }) {
  const find = (name) => root.querySelector(`[data-${name}]`);
  const clear = find("settings-clear");
  const reset = find("session-reset");
  const open = find("data-delete");
  const panel = find("delete-confirmation");
  const confirm = find("delete-confirm");
  const cancel = find("delete-cancel");
  const status = find("settings-status");
  const buttons = [clear, reset, open, confirm, cancel];
  const listeners = [];
  let busy = false;
  const show = (message) => { status.textContent = message; };
  const reportStorage = ({ status: value }) => {
    const message = storageMessages[value] ?? storageMessages.unavailable;
    const helpStatus = find("settings-help-status");
    if (helpStatus && ["empty", "loaded", "saved"].includes(value)) {
      helpStatus.textContent = message;
      helpStatus.hidden = !message;
      show("");
    } else show(message);
  };
  const closeConfirmation = (restore = true) => {
    panel.hidden = true;
    open.setAttribute("aria-expanded", "false");
    if (restore) open.focus();
  };
  const setBusy = (value) => {
    busy = value;
    for (const button of buttons) button.disabled = value;
  };
  const execute = async (deleting) => {
    if (busy || (deleting && panel.hidden)) return;
    const restoreFocus = preserveControlFocus(root, [status]);
    setBusy(true);
    show(deleting ? "Deleting app data…" : "Resetting current session…");
    restoreFocus();
    try {
      const result = await (deleting ? actions.deleteAll({ confirmed: true }) : actions.resetSession());
      if (result.status !== "complete") {
        show("Some session cleanup could not be completed. Stop the microphone and reload before continuing.");
      } else if (deleting && result.storage?.status !== "cleared") {
        show("Session cleared and defaults restored, but saved settings could not be removed. Browser storage is unavailable.");
      } else {
        show(deleting
          ? "App session data and saved settings deleted. Defaults restored."
          : "Current session cleared and audio stopped. Your target and settings are unchanged.");
      }
    } catch {
      show("Cleanup could not be completed. Stop the microphone and reload before continuing.");
    } finally {
      setBusy(false);
      const doc = root.ownerDocument;
      const ownsFocus = !doc || doc.activeElement === status || panel.contains?.(doc.activeElement);
      if (deleting) closeConfirmation(ownsFocus && !doc?.hidden && !open.closest?.("[hidden]"));
      else if (doc?.activeElement === status && !doc.hidden && !reset.closest("[hidden]")) reset.focus();
    }
  };
  const listen = (element, type, handler) => {
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  };
  listen(clear, "click", () => {
    if (busy) return;
    reportStorage(actions.clearSavedSettings());
  });
  listen(reset, "click", () => { void execute(false); });
  listen(open, "click", () => {
    if (busy) return;
    panel.hidden = false;
    open.setAttribute("aria-expanded", "true");
    cancel.focus();
  });
  listen(cancel, "click", () => { if (!busy) closeConfirmation(); });
  listen(confirm, "click", () => { void execute(true); });
  listen(root, "keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden && !busy) {
      event.preventDefault();
      closeConfirmation();
    }
  });
  panel.hidden = true;
  open.setAttribute("aria-expanded", "false");
  reportStorage({ status: initialStorageStatus });
  return Object.freeze({
    reportStorage,
    destroy() { for (const remove of listeners) remove(); },
  });
}
