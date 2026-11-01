# Penny

Real-time graphics for AI on Windows. Press a key and ask out loud about whatever is on your screen. Penny answers
with a few spoken sentences while it draws on top of your screen: loops and labels on the real content, paper
explainer cards, sticky notes, and interactive 3D scenes you can drag around. There is no chat window.

Penny ships with no account of its own: each user brings theirs (see [Accounts](#accounts)). See [PLAN.md](PLAN.md) for
the design and how it maps to the demo it is based on.

## Download

- **Windows app:** [Penny-Setup.exe](https://github.com/AshrafulKabir7/penny/releases/latest/download/Penny-Setup.exe) from the
  [latest release](https://github.com/AshrafulKabir7/penny/releases/latest). It isn't code-signed yet, so Windows SmartScreen may
  warn: choose **More info → Run anyway**.
- **Penny for Chrome:** [penny-chrome.zip](https://github.com/AshrafulKabir7/penny/releases/latest/download/penny-chrome.zip), see
  [Penny for Chrome](#penny-for-chrome).
- **Website:** [penny-website-sepia.vercel.app](https://penny-website-sepia.vercel.app), from [website/](website/) (static, no build
  step; Vercel redeploys it on every push to main).

## Requirements

- Windows 10 or 11, Node.js 20 or newer
- One way to reach a model (see [Accounts](#accounts)):
  - a **Claude**, **OpenAI** or **Gemini** API key, or **Sign in with Claude** (a Claude API account, through Anthropic's `ant` CLI)
  - a **ChatGPT account** (through the Codex app or CLI) or a **Google account** (through Antigravity)
  - **Command Code** (`npm i -g command-code`, then `command-code login`) or **Antigravity** (`agy`)
- Python 3 with Whisper (speech to text) and edge-tts (natural voice):
  `py -m pip install -U openai-whisper edge-tts numpy`

## Accounts

Open the tray menu → **Accounts and API keys…**, set up one option, and press **Use** (or pick the model under Model
in the tray).

| Option | How you sign in | Notes |
| --- | --- | --- |
| Claude (Opus 5.5, Sonnet 5.5, Haiku 5.5) | **Sign in with Claude** (runs Anthropic's `ant auth login` in your browser), or paste an API key from the [Claude Console](https://console.anthropic.com/settings/keys) | Streams, so drawing starts at once. Billed to that Claude API account. Claude Pro/Max chat subscriptions can't be used: Anthropic doesn't allow third-party apps to use claude.ai logins. |
| OpenAI (GPT-6.1 Terra, or any model you type) | Paste an API key from the [OpenAI platform](https://platform.openai.com/api-keys) | Streams. Billed to that OpenAI account. |
| ChatGPT account | **Sign in with ChatGPT** runs `codex login`, which opens your browser | Uses your ChatGPT plan through OpenAI's Codex app/CLI. Codex returns the answer in one piece, so drawing starts later (~12 s). |
| Gemini (Gemini 3.8 Flash, or any model you type) | Paste an API key from [Google AI Studio](https://aistudio.google.com/apikey) | Streams. Google's free allowance first, then billed to that Google Cloud account. |
| Google account | **Sign in with Google** opens Antigravity, which signs in with your Google account | Gemini through Antigravity, with no key (~8 s per answer). |
| Command Code / Antigravity | Their own CLI login | The original options; pick their models in the tray. |

Keys are encrypted with Windows' per-user data protection and kept in `%APPDATA%\Penny\credentials.json`. Penny
sends them only to their own provider, never writes them to the log, and the Accounts window only ever shows a masked
hint (`sk-ant…9xQz`). **Test** makes one tiny request with the key, and **Remove** deletes it from the computer.

## Penny for Chrome

The same drawings, on any web page. Two ways to reach a model, both your own:

- **An API key** (Claude, OpenAI or Gemini). The model is called straight from the browser; the key stays in the
  browser's extension storage (not synced).
- **An account you sign in to**: ChatGPT (your ChatGPT plan, through Codex), Claude (a Claude API account, through
  Anthropic's `ant` CLI) or Google (Gemini, through Antigravity). This goes through the Penny app for Windows: the app
  registers itself as a Chrome/Edge native messaging host (`app.penny.host`, per-user registry keys, rewritten at each
  start) and runs [src/native/host.js](src/native/host.js), which uses the same sign-ins as the app. Install the app and
  open it once. Claude Pro/Max chat subscriptions can't be used: Anthropic doesn't allow third-party apps to use them.

A page is only captured when you ask about it there.

1. Unzip `penny-chrome.zip`, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the folder.
2. On the settings page that opens, add an API key or sign in with ChatGPT, Claude or Google.
3. On any page press **Alt+Shift+P** (or click Penny's toolbar button), then type your question or press the mic and
   talk. Say "this" while pointing, or circle something as you talk. **Esc** clears the drawings.

The extension reuses the app's drawing engine (`src/renderer`), prompt and API providers; its own code is in
[extension/](extension/). Its ID is fixed by the public `key` in its manifest (`mnpcmhoideneafghojodngbcomangdbg`), which
the app's host allows; if you installed an earlier build, remove it and load the new one. Build it with `npm run build:extension` (writes `dist/penny-chrome/` and `dist/penny-chrome.zip`).

## Run

```bash
npm install
```

```bash
npm start
```

Penny lives in the system tray. The first start takes 10–15 s while the model process and Whisper load.

| Key | What it does |
| --- | --- |
| `Ctrl+Alt+Space` | Talk. **Hold** it while you speak and let go to send (push-to-talk), or **tap** it, speak, and Penny stops when you pause. |
| `Ctrl+Alt+T` | Type a question instead |
| `Esc` | Clear the screen and start a new topic (only taken while Penny has something on screen) |

If another app already owns a shortcut, Penny uses the next free one: `Ctrl+Shift+Space`, `Alt+Shift+Space`, then
`Ctrl+Alt+K` for talking, and `Ctrl+Shift+Y` for typing. The tray tooltip and the log show which keys you got.

**Point while you ask.** While Penny listens, a yellow ink trail follows your mouse and a small sound-level badge rides
next to the cursor. Circle the thing you mean, or rest the pointer on it, and say "what is this?" or "explain this".
Penny draws your gesture onto the screenshot and sends the model a 2× close-up. A circle means "what's inside", and a
resting pointer means "this, right here". Loops and arrows drawn near the spot snap exactly onto it.

Questions asked while the drawings are still on screen, or within 5 minutes, are follow-ups in the same
conversation ("how do I attach a camera to it?").

The tray menu has:

- Model: the suggested models, plus every model both CLIs report
- Thinking: Off is the default and the fastest
- Voice: Natural (edge-tts), Windows voice, or Silent
- Show captions
- Listen for "Hey Penny": no key needed; it checks short utterances while idle
- Hide Penny from screen recordings
- Open log

## Models

The model has to be able to read a screenshot. Measured on this laptop, with Thinking off:

| Model | First words | Whole answer |
| --- | --- | --- |
| `cmd:deepseek/deepseek-v4.1-flash` (default) | ~3.4 s | 4–9 s |
| `agy:gemini-3.8-flash-low` | ~8 s | ~10 s |

Command Code only offers some models on some plans. If a model is not on yours, Penny says so; pick another in the tray.

## Your accounts and your data

- **Bring your own login.** Penny ships with no keys or accounts. Each user adds their own API key (encrypted on
  their machine) or signs in with their own ChatGPT, Command Code or Antigravity account, and those logins stay in
  each tool's own settings. Penny never sees a password.
- **Nothing personal goes in this repo.** Settings, the log and debug captures live in `%APPDATA%\Penny`, outside the
  project folder, and `.gitignore` also blocks `.env` files, keys, credential files and screenshots. Before pushing,
  run `npm run check-secrets`, which scans every file and every past commit for anything that looks like a credential.
- **What leaves your machine.**
  - When you ask, the screenshot and your question go to the model you picked (its API or its CLI).
  - Spoken answers go to Microsoft's edge-tts service to be turned into speech (switch the tray to Windows voice to
    keep them local).
  - Speech recognition (Whisper) runs entirely on your computer.

## How it works

1. **Hotkey.** The screen is captured (Penny's own drawings hidden for that moment) and the microphone opens.
2. **Speech to text.** A Python worker keeps Whisper `base` loaded and transcribes the clip (~2.5 s for 7 s of speech).
3. **Model.** The question and the screenshot go to a CLI process that is already running:
   - Command Code (`cmd acp`, JSON-RPC over stdio) gets the image inline. Its sessions run in plan mode in an empty
     folder, and every tool permission is refused.
   - `agy --input-format stream-json` gets the screenshot as a file to open.
4. **Scene ops.** The model replies with JSON lines (the language is in `src/main/prompt.js`). The overlay parses them
   as they stream in. Each sentence is voiced as soon as it is parsed, and each drawing appears while the sentence
   before it is being spoken.
5. **Rendering.** A transparent, click-through, always-on-top window covers the screen:
   - 2D: Rough.js strokes in the Kalam hand
   - 3D: Three.js scenes on a paper panel, built from primitives (box, cylinder, cone, fan, extrude, lathe…) and
     ready-made objects (posable person, car, rocket, skateboard, table, wheel, gear, spring, floor). They have tags,
     spinning parts, animated moves, flow arrows and labelled force arrows, so a physics question becomes a small
     experiment rather than abstract blobs.

## Development

- `npm run dev` also starts a local control server on `127.0.0.1:8791`:
  - `POST /ask` with `{"text": "...", "pointer": [x, y]}`: ask about the current screen, optionally pointing at a screen point
  - `POST /ops`: play a JSONL reply
  - `POST /clear`
  - `POST /listen`
  - `POST /talkkey`: one talk-hotkey event, for testing tap and hold
  - `POST /accounts`: open Accounts; `POST /accounts/call` with `{"fn", "args"}`: run one of its calls
  - `POST /stt` with raw 16 kHz float32: transcribe
  - `GET /snap`: PNG of the screen, drawings included
  - `GET /state`

  Each question's screenshot and raw reply are also saved to `%APPDATA%\Penny\debug`.
- `node tools/serve.mjs` serves the overlay to a browser without Electron, with demo buttons for the saved replies
  in `tools/demo`. Open `http://127.0.0.1:5199/src/renderer/overlay.html?mute=1&bg=<screenshot url>`.
- `node tools/probe-models.mjs <model id> <screenshot.jpg> "<question>" [out.jsonl]` asks a model directly and saves
  its reply as a demo.
- `npm run dist` builds the Windows installer (`dist/Penny-Setup.exe`); `npm run build:extension` builds Penny for Chrome.
  Pushing a `v*` tag runs [.github/workflows/release.yml](.github/workflows/release.yml), which builds both and publishes
  them as a GitHub release.
- `npx electron tools/capture-shots.cjs [out dir] [demo ...]` renders saved demos offscreen as PNGs (website, README).

```
src/main/        main process: main.js (windows, hotkeys, tray, ask loop), capture, settings, voice worker client
src/main/providers/  acp.js (Command Code), agy.js (Antigravity), anthropic.js (Claude API), openai.js (OpenAI API),
                     codex.js (ChatGPT via Codex), cli.js (finding/stopping the CLIs)
src/main/credentials.js  the user's API keys, encrypted with Windows' per-user protection
src/main/prompt.js   the scene language the model writes
src/main/gesture.js  what pointing and mouse gestures mean (shared with the extension)
src/main/native-host.js  registers the app as Penny for Chrome's native messaging host
src/native/host.js   that host: status, sign-in and asks with the accounts signed in on this PC
src/renderer/    overlay page: engine/ (parser, stage, card, marks, scene3d, sketch, icons), voice.js
voice/penny_voice.py Whisper + edge-tts worker
tools/           preview server, model probe, demo replies, extension build, shot capture
extension/       Penny for Chrome: background worker, page overlay frame, ask bar, settings page
website/         the landing page (static, deployed on Vercel)
```

## Troubleshooting

- **"Command Code stopped" or a sign-in message**: run `command-code logout`, then `command-code login`.
  `login` alone can keep an expired key.
- **No voice, or a robotic voice**: edge-tts needs internet and a current version (`py -m pip install -U edge-tts`).
  After three failures Penny switches to the Windows voice.
- **"Microphone unavailable"**: check Windows Settings → Privacy → Microphone → "Let desktop apps access your microphone".
- **Everything is slow**: Whisper and the model process need about 1 GB between them. Close heavy apps, or set
  `"whisperModel": "tiny"` in `%APPDATA%\Penny\settings.json`.
- The log is at `%APPDATA%\Penny\penny.log` (tray → Open log).
