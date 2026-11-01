// The models Penny for Chrome offers, and its default settings (shared by the worker and the options page).

export const MODELS = {
  // With an API key, called straight from the browser.
  claude: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  openai: ["gpt-6.1-terra"],
  gemini: ["gemini-3.8-flash"],
  // With an account signed in through the Penny app ("default" is the ChatGPT plan's own model).
  chatgpt: ["default"],
  "claude-account": ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  "google-account": ["gemini-3.8-flash-low", "gemini-3.8-flash-medium", "gemini-3.8-flash-high"],
};

/** Which saved key each API-key provider uses. */
export const KEY_FOR = { claude: "anthropic", openai: "openai", gemini: "google" };

/** Account providers: the Penny app's sign-in each one uses, and the prefix of its model ids there. */
export const ACCOUNTS = {
  chatgpt: { account: "chatgpt", prefix: "codex" },
  "claude-account": { account: "claude", prefix: "claude" },
  "google-account": { account: "google", prefix: "agy" },
};

export const DEFAULTS = {
  provider: "claude",
  models: Object.fromEntries(Object.entries(MODELS).map(([p, list]) => [p, list[0]])),
  effort: "off",
  speak: true,
  captions: true,
};

/** Settings as saved, filled in with the defaults. Keys stay in this browser (storage.local, never synced). */
export async function loadSettings() {
  const s = await chrome.storage.local.get(null);
  return { ...DEFAULTS, ...s, models: { ...DEFAULTS.models, ...s.models }, keys: s.keys || {} };
}
