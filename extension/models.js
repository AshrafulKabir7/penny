// The models Penny for Chrome offers, and its default settings (shared by the worker and the options page).

export const MODELS = {
  claude: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  openai: ["gpt-6.1-terra"],
  gemini: ["gemini-3.8-flash"],
};

/** Which saved key each provider uses. */
export const KEY_FOR = { claude: "anthropic", openai: "openai", gemini: "google" };

export const DEFAULTS = {
  provider: "claude",
  models: { claude: MODELS.claude[0], openai: MODELS.openai[0], gemini: MODELS.gemini[0] },
  effort: "off",
  speak: true,
  captions: true,
};

/** Settings as saved, filled in with the defaults. Keys stay in this browser (storage.local, never synced). */
export async function loadSettings() {
  const s = await chrome.storage.local.get(null);
  return { ...DEFAULTS, ...s, models: { ...DEFAULTS.models, ...s.models }, keys: s.keys || {} };
}
