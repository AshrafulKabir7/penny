# Penny

Real-time graphics for AI on Windows. Press a key and ask out loud about whatever is on your screen. Penny answers
with a few spoken sentences while it draws on top of your screen: loops and labels on the real content, paper
explainer cards, sticky notes, and interactive 3D scenes you can drag around. There is no chat window.

The model is not an API key. Penny drives the **Command Code CLI** (through its ACP mode) or the **Antigravity CLI**
(`agy`), whichever you are signed in to. See [PLAN.md](PLAN.md) for the design and how it maps to the demo it is based on.

## Requirements

- Windows 10 or 11, Node.js 20 or newer
- At least one CLI, signed in:
  - Command Code: `npm i -g command-code`, then `command-code login`
  - Antigravity: `agy`
- Python 3 with Whisper (speech to text) and edge-tts (natural voice):
  `py -m pip install -U openai-whisper edge-tts numpy`

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

- **Bring your own login.** Penny ships with no keys or accounts. Each user signs in to the model CLI they use
  (`command-code login`, or `agy`), and that login stays in the CLI's own settings on their machine. Penny never sees
  a password and never writes a key anywhere.
- **Nothing personal goes in this repo.** Settings, the log and debug captures live in `%APPDATA%\Penny`, outside the
  project folder, and `.gitignore` also blocks `.env` files, keys, credential files and screenshots. Before pushing,
  run `npm run check-secrets`, which scans every file and every past commit for anything that looks like a credential.
- **What leaves your machine.**
  - When you ask, the screenshot and your question go to the model you picked, through its CLI.
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
  - `POST /stt` with raw 16 kHz float32: transcribe
  - `GET /snap`: PNG of the screen, drawings included
  - `GET /state`

  Each question's screenshot and raw reply are also saved to `%APPDATA%\Penny\debug`.
- `node tools/serve.mjs` serves the overlay to a browser without Electron, with demo buttons for the saved replies
  in `tools/demo`. Open `http://127.0.0.1:5199/src/renderer/overlay.html?mute=1&bg=<screenshot url>`.
- `node tools/probe-models.mjs <model id> <screenshot.jpg> "<question>" [out.jsonl]` asks a model directly and saves
  its reply as a demo.

```
src/main/        main process: main.js (windows, hotkeys, tray, ask loop), capture, settings, voice worker client
src/main/providers/  acp.js (Command Code), agy.js (Antigravity), cli.js (finding/stopping the CLIs)
src/main/prompt.js   the scene language the model writes
src/renderer/    overlay page: engine/ (parser, stage, card, marks, scene3d, sketch, icons), voice.js
voice/penny_voice.py Whisper + edge-tts worker
tools/           preview server, model probe, demo replies
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
