export const SPEECH_PRESETS = Object.freeze({
  audiobook: { label: "Audiobook", wpm: 155 },
  radio: { label: "Radio / Podcast", wpm: 160 },
  ad: { label: "TV / Radio ad", wpm: 175 },
  fast: { label: "Fast disclaimer / Retail ad", wpm: 220 },
  documentary: { label: "Documentary / Corporate", wpm: 140 },
});
export const SOUNDS = Object.freeze(["beep", "click", "woodblock", "rimshot", "hihat"]);
export const NOISE_TYPES = Object.freeze(["white", "pink", "brown"]);

export function volumeGain(value) {
  const text = String(value).trim().replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return null;
  const percent = Number(text);
  return percent <= 100 ? percent / 100 : null;
}

export function parseGroups(value) {
  const text = String(value).trim();
  if (!/^\d{1,2}(?:\s*\+\s*\d{1,2}){0,15}$/.test(text)) return null;
  const groups = text.split("+").map(Number);
  if (groups.some((n) => n < 1 || n > 16) || groups.reduce((a, b) => a + b, 0) > 16) return null;
  return groups;
}

export function rhythmSettings({ mode, bpm, groups, subdivision, preset, pace, accents }) {
  if (mode === "speech") {
    const entry = SPEECH_PRESETS[preset];
    const factor = { relaxed: 0.85, typical: 1, brisk: 1.15 }[pace];
    if (!entry || !factor) return null;
    const wpm = Math.round(entry.wpm * factor / 5) * 5;
    // One pulse per target word. This is a pace reference, not measured speech.
    return { bpm: wpm, groups: [1], subdivision: 1, accents: false, wpm };
  }
  const rate = Number(bpm);
  const divided = Number(subdivision);
  const parsed = parseGroups(groups);
  if (mode !== "music" || !Number.isFinite(rate) || rate < 20 || rate > 300 ||
      ![1, 2, 3, 4].includes(divided) || !parsed) return null;
  return { bpm: rate, groups: parsed, subdivision: divided, accents: Boolean(accents) };
}

export function beatAt(index, settings) {
  const beat = Math.floor(index / settings.subdivision);
  const position = beat % settings.groups.reduce((a, b) => a + b, 0);
  let offset = 0;
  const strong = settings.groups.some((group) => {
    const match = position === offset;
    offset += group;
    return match;
  });
  return { beat: position + 1, count: beat + 1, main: index % settings.subdivision === 0,
    strong: settings.accents && strong && index % settings.subdivision === 0 };
}
