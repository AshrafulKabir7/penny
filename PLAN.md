# Penny: plan

Penny is a Windows desktop app that does what the HeyClicky "real-time graphics" demo shows. You ask a question out
loud about whatever is on your screen, and the answer comes back as a short spoken explanation while diagrams,
labels, sticky notes and interactive 3D scenes are drawn live on top of your screen. There is no chat window.

The model behind it is not an API key. It is the **Command Code CLI** (over its ACP mode) or the **Antigravity CLI**
(`agy`), which you are already signed in to.

## 1. What the demo shows

Source: `linkedin-video-735kbps.mp4` (2:27, 1280×720), frame-by-frame plus a Whisper transcript.

| Time | What happens | What it teaches us |
| --- | --- | --- |
| 0:00–0:16 | Intro: "real-time graphics … complex visuals directly on your screen using the context of whatever you're looking at … all you have to do is use your voice" | Voice in, screen context, visuals out |
| 0:19–0:38 | Karpathy's "Let's build GPT" on YouTube. "HeyClicky, I'm watching this video, but I'm still not understanding how this tensor thing makes training data." A cream paper card appears beside the video: *Make a question and its answer*, `[18] → 47`, `[18, 47] → 56`, "Both can be tensors", `Guess → Compare → Adjust`. The tensor line in the notebook gets circled in yellow. | Card built row by row, numbers taken **from the screen**, hand-drawn marks on the real content |
| 0:38–0:55 | Follow-up: "how does this lead to ChatGPT?" New card *One small task, enormous practice* with numbered rows ① `The sky is → blue`, ② stack → network → *Learned weights*, ③ *Helpful response ✓ → Assistant tuning*, ④ *Your question → The sky is blue* | Follow-ups keep context; numbered steps; tiny sketch icons |
| 0:57–1:18 | Tweet of an F-35 hovering. "Is this real?" Card *Push air down, lift up*, side view, arrows for *Lift fan*, *Engine*, *Swivel nozzle*, *Air down*, *Weight* | Pointing with arrows on a diagram; one-sentence verdict first |
| 1:18–1:32 | "Draw the full jet in 3D and explain how the engines work." A 3D F-35 floats over the tweet, then a cut-away engine with *Fan, Compressor, Burn fuel, Turbine* tags | 3D built on the fly, cut-away, pastel tags on leader lines, no card around it |
| 1:32–1:36 | "This is not pre-rendered … a rendering engine we built in-house" | The model writes a scene description and the engine renders it |
| 1:36–2:05 | Raspberry Pi product page. "How does a Raspberry Pi work?" 3D board with *USB ports, GPIO, Processor, RAM, microSD*. Follow-up: "How do I attach a camera?" The camera module and ribbon cable animate into the port, a sticky note says *Power off, unplug first* | Animated assembly (parts move), sticky notes, follow-ups |
| UI details | A pill under the notch reads **Listening** / **Speaking**. A small yellow pen cursor glides to wherever something is being drawn. Handwritten font, pastel blue/pink/green/yellow boxes, cream card with a faint grid. | Status pill, pen cursor, visual style |

## 2. How Penny does it

```
 hotkey / "Hey Penny"            Electron main process                         CLI model (warm, persistent)
 ┌──────────────┐  PCM 16 kHz  ┌──────────────────────────┐  text + JPEG   ┌──────────────────────────────┐
 │ overlay      │ ───────────► │ voice worker (Whisper)   │ ─────────────► │ Command Code ACP session     │
 │ (transparent,│              │ screen capture           │                │   (image sent inline)        │
 │  click-thru) │ ◄─────────── │ prompt builder           │ ◄───────────── │ or agy stream-json process   │
 │ pill, pen,   │  JSONL ops   │ provider manager         │  streamed text │   (image read from a file)   │
 │ 2D + 3D      │  as they     │ hotkeys, tray, settings  │                └──────────────────────────────┘
 │ engine, TTS  │  stream in   └──────────────────────────┘
 └──────────────┘
```

1. **Trigger**: `Ctrl+Alt+Space` starts listening (press again or stop talking to finish), `Ctrl+Alt+T` opens a
   one-line "type it" bar, and an optional "Hey Penny" wake word can be turned on from the tray.
2. **Context**: when you start talking, Penny hides its own overlay for one frame and captures the screen
   (downscaled to 1600 px JPEG).
3. **Speech to text**: a persistent Python worker keeps Whisper `base` loaded and transcribes the 16 kHz clip (~1–2 s on CPU).
4. **Model**: the question and the screenshot go to a CLI that is already running, so there is no start-up cost.
   - Command Code, `cmd acp` over JSON-RPC: the image goes inline in `session/prompt`, the session runs in plan
     mode in an empty folder, and every tool permission is refused. Measured: about 3.3 s to read a screenshot and
     answer with `deepseek/deepseek-v4.1-flash`.
   - Antigravity, `agy --input-format stream-json`: one process per topic, with the screenshot written as a file the
     model opens. Measured: about 8 s for the first turn, about 4 s for follow-ups.
5. **Answer format**: the model writes **JSONL scene ops** (section 3). They are parsed incrementally as tokens
   arrive, so the first sentence is spoken and the first stroke drawn before the reply is finished.
6. **Rendering**: a full-screen transparent overlay, click-through except over interactive bits:
   - 2D uses Rough.js strokes animated as if drawn, the Kalam handwriting font, paper cards laid out automatically
     in rows, and screen marks (circle, underline, highlight, arrow, label, sticky note).
   - 3D uses Three.js scenes built from primitives (box, cylinder, cone, sphere, capsule, torus, wedge, fan,
     extrude, lathe). It has metal/glass/glow materials, auto-framing, drag-to-orbit, spinning parts, animated part
     moves for assembly, flow particles, and pastel tags on leader lines that avoid each other.
   - A pen cursor travels to each element before it is drawn.
   - The status pill shows Listening (live level bars), Thinking, Speaking and Error.
7. **Voice out**: each `say` line is synthesised as soon as it is parsed and played in order. Drawings that follow a
   sentence are drawn while it is being spoken. The voice is edge-tts if it works, otherwise the best installed
   Windows voice.
8. **Follow-ups**: the same CLI session is reused while the visuals are on screen (and for up to 5 minutes), so
   "how do I attach a camera?" knows what "it" is. `Esc` clears the visuals and starts a new topic.

## 3. Scene language (what the model writes)

One JSON object per line. Coordinates are `[x, y]` in 0–1000 units of the screen, and boxes are `[x0, y0, x1, y1]`.
The full contract is in `src/main/prompt.js`, which is the text the model sees.

- Voice: `say`
- Screen marks: `circle`, `underline`, `highlight`, `arrow`, `label`, `point`, `note`
- Cards: `card`, `row` (items: `box` / `arrow` / `text` / `icon`, optional `step` number), `text`, `chart`
- 3D: `scene`, `part`, `tag`, `spin`, `move`, `flow`, `focus`
- Control: `wait`, `clear`

The renderer tolerates real model output: it handles code fences, prose around the JSON, several objects on one line,
pretty-printed objects split over several lines, missing ids, out-of-range coordinates and unknown ops (skipped).

## 4. Milestones

| # | Milestone | Done when |
| --- | --- | --- |
| M1 | Project skeleton: Electron, overlay window, tray, hotkeys, settings | Overlay sits over everything, clicks pass through |
| M2 | Providers: Command Code ACP + agy stream-json, warm start, cancel, new topic | `tools/probe-models.mjs` gets a streamed JSONL answer about a screenshot from both |
| M3 | Scene engine 2D: stream parser, timeline, pen, cards, screen marks | The demo scenes (tensor card, F-35 side view) render in the browser preview |
| M4 | Scene engine 3D: primitives, materials, tags, spin/move/flow, orbit | Demo F-35 and Raspberry Pi scenes render and animate |
| M5 | Voice: Whisper worker, mic capture + silence detection, TTS queue synced to drawing, wake word | A recorded question is transcribed and spoken answers play in order |
| M6 | End-to-end: hotkey → capture → model → live visuals + voice; follow-ups; Esc | A real question about the real screen produces a drawn answer |
| M7 | Polish: type bar, captions, model picker in the tray, error states, README | Someone else can install and use it from the README |

### Status (2026-11-01)

M1–M7 are built and were checked on this laptop with the real app on the real screen, through the dev control server:

- Real questions about the live screen were answered and drawn. First words came after about 3.4 s, and the whole
  answer took 4–9 s with `deepseek/deepseek-v4.1-flash` and Thinking off.
- Loops and arrows land on the right things. The model answers in screenshot pixels, which the overlay maps back to
  the display. An earlier 0–1000 grid was off; switching fixed it.
- 3D scenes rendered on screen: a jet-engine cut-away, a Raspberry Pi, and a follow-up showing the camera ribbon going
  into its port with a "Power off first" note.
- Follow-ups reuse the session.
- Microphone, silence detection and Whisper all work. The question from the demo video's audio is transcribed
  correctly in about 2.5 s once warm.
- The neural voice (edge-tts) speaks, in step with the drawings.
- The Antigravity provider works (Gemini 3.8 Flash Low, about 10 s per answer).

Not yet checked by a person: speaking a real question into the mic with the hotkey, the "Hey Penny" wake word in a
real room, and drag-to-orbit on a 3D scene.

What we learned while building it:

- DeepSeek naturally answers in the pixels of the image it sees, so the prompt now asks for exactly that.
- Fast models get parent-relative 3D maths wrong. Positions are always scene coordinates, spin axes are scene axes,
  and round parts take `"axis":"x"` instead of rotations.
- Command Code's `effort: off` is what makes it real-time. With thinking left on, the first word takes 15–20 s.
- `Ctrl+Alt+Space` is taken on this machine, so Penny falls back to `Ctrl+Shift+Space`.

### Round 2 (after the first hands-on test)

What came up when it was used for real, and what changed:

- **3D was not meaningful** (Newton's third law came out as a blob pushing a wall). Scenes now have:
  - ready-made objects: a posable person with 13 poses, car, rocket, skateboard, table, wheel, gear, spring, and a
    floor that is left out of the camera fit
  - a `force` op for labelled 3D arrows, drawn on top of objects
  - `move` with `by` and `"wait":false` for simultaneous motion
  - a camera that follows moving parts
  - a paper panel behind each scene, with a title

  The prompt asks for physics as a small experiment and includes a worked third-law example. Checked with first
  law, third law and rocket questions.
- **Pointing at things.** The pointer is sampled while the user talks, and the spot where it last rested counts.
  When the question says this, that, here or there, the pointer is ringed on the screenshot, a 2× close-up of that spot
  goes along, `"pointer"` can stand in for coordinates, and marks near the pointer snap onto it. Tested on a CNN slide:
  "explain this" while pointing at the "Shared" bullet explains weight sharing and circles that word. Without the
  pointer, it explains the whole slide.
- **Holding the hotkey** caused a storm of captures and listens, because Windows repeats a held hotkey about 30 times a
  second. It is now push-to-talk: while listening, further events mean "held" and listening stops when they go quiet.
  This survives main-thread stalls where the repeats arrive in a burst. Tested by sending the exact event patterns to
  the control server.
- **Whisper only loaded when a request arrived.** On Windows, a blocking stdin read held up the PyTorch import in
  another thread. It now loads before the stdin reader starts, and is ready about 14 s after launch.

### Round 3: the cursor trail

The demo shows a fading yellow ink trail following the mouse while Clicky listens, with a sound-level badge riding next
to the cursor. Penny now does the same (`src/renderer/trail.js`). The traced path goes back with the recording and is
drawn onto the screenshot. A loop counts as "what's inside", a stroke as "where it ends", and both count as pointing.

Also fixed in this round:
- The overlay was clamped to the work area (1536×816 rather than 1536×864), so every mark landed up to ~45 px too high
  near the bottom. It is now stretched over the whole display after it is shown.
- A key-release timer that fires late (a stalled main thread) no longer ends push-to-talk early.
- Whisper transcripts that are a lone word or one sentence repeated (background TV) are ignored.

Checked in the real app with injected mouse movement while the key is held (`/talkkey`), and with `/overlay` reporting
the trail's state. The user's own circle gesture ("explain me this further") came through as a circle.

### Round 4: bring your own account

Penny now works for anyone, not only people with Command Code or Antigravity:

- **Claude API**: the user's own API key, through the official `@anthropic-ai/sdk`. Default Opus 5.5 with effort
  `low` for speed, the cached system prompt, and server-side refusal fallback (`fallbacks: "default"`). A Claude API
  sign-in the SDK finds by itself (env var, `ant auth login`) also works. Claude.ai subscription logins are not offered:
  Anthropic does not allow third-party apps to use them.
- **OpenAI API**: the user's own key, through the official `openai` SDK (Responses API, streaming, follow-ups chained
  with `previous_response_id`).
- **ChatGPT account**: through the Codex CLI (`codex exec --json`, read-only sandbox, threads resumed for follow-ups).
  Sign-in is `codex login` in the user's browser. The reply arrives in one piece (~12 s).
- **Keys**: encrypted with Electron `safeStorage` (Windows DPAPI) in `%APPDATA%\Penny\credentials.json`. The Accounts
  window only gets masked hints, and a missing or rejected key opens Accounts automatically.

Verified:
- Mock API servers checked both SDK streaming paths and the request shapes.
- The real Claude and OpenAI endpoints return the "key rejected" message for a fake key.
- A real Codex answer was drawn in the app.
- The encrypted key file holds no plaintext.

## 5. Risks and what we do about them

- **Latency**: CLI start-up takes 7–14 s, so the processes are started when the app opens and kept warm. Ops stream
  and draw as they arrive. A new standby agy process is started in the background after each topic.
- **Layout quality from the model**: the model never positions single boxes. Cards lay themselves out in rows, 3D
  scenes frame themselves, and tags lay themselves out. The model only picks a region and the content.
- **Model output drift**: the parser is tolerant, unknown ops are skipped, and there is an example in the prompt.
- **Vision availability**: on this Command Code plan only some vision models are allowed
  (`deepseek/deepseek-v4.1-flash` works; Haiku and Gemini are blocked by the plan). The tray lists both CLIs'
  models, and Antigravity's Gemini 3.8 Flash works through a screenshot file.
- **TTS**: edge-tts currently gets a 403 from Microsoft, so the app falls back to Windows SAPI voices.
- **RAM (8 GB)**: one Whisper model, one warm CLI process (plus one agy standby only when agy is selected), and
  Three.js scenes are disposed on clear.
