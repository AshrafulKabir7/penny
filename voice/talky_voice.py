"""Talky's voice worker: Whisper speech-to-text and edge-tts text-to-speech, over JSON lines on stdin/stdout.

Requests (one JSON object per line):
  {"id": 1, "op": "stt", "path": "clip.f32", "language": "en", "prompt": "Hey Talky,"}   16 kHz mono float32 samples
  {"id": 2, "op": "tts", "text": "Hello", "voice": "en-US-AndrewMultilingualNeural", "out": "a.mp3"}
Replies: {"id": 1, "text": "..."} / {"id": 2, "path": "a.mp3"} / {"id": n, "error": "..."}
Events: {"event": "stt_ready"} / {"event": "stt_failed", "error": "..."}
"""

import asyncio
import json
import os
import sys
import threading
import traceback

write_lock = threading.Lock()
model = None
model_ready = threading.Event()
model_error = None


def emit(obj):
    with write_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def load_model():
    global model, model_error
    try:
        import whisper

        import numpy as np

        model = whisper.load_model(os.environ.get("TALKY_WHISPER_MODEL", "base"))
        # The first transcription is several times slower than the rest; pay that cost now, not on the first question.
        model.transcribe(np.zeros(16000, dtype=np.float32), language="en", fp16=False, temperature=0.0)
        emit({"event": "stt_ready"})
    except Exception as exc:  # noqa: BLE001 - report anything to the app
        model_error = f"{type(exc).__name__}: {exc}"
        emit({"event": "stt_failed", "error": model_error})
    finally:
        model_ready.set()


stt_lock = threading.Lock()


def transcribe(req):
    import numpy as np

    model_ready.wait()
    if model is None:
        raise RuntimeError(model_error or "Whisper is not available")
    audio = np.fromfile(req["path"], dtype=np.float32)
    with stt_lock:
        result = model.transcribe(
            audio,
            language=req.get("language") or None,
            fp16=False,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=req.get("prompt") or None,
        )
    return result.get("text", "").strip()


async def synthesize(req):
    import edge_tts

    communicate = edge_tts.Communicate(req["text"], req.get("voice") or "en-US-AndrewMultilingualNeural", rate=req.get("rate") or "+6%")
    await communicate.save(req["out"])
    return req["out"]


async def handle(req, loop):
    rid = req.get("id")
    try:
        if req.get("op") == "stt":
            text = await loop.run_in_executor(None, transcribe, req)
            emit({"id": rid, "text": text})
        elif req.get("op") == "tts":
            path = await asyncio.wait_for(synthesize(req), timeout=20)
            emit({"id": rid, "path": path})
        elif req.get("op") == "ping":
            emit({"id": rid, "ok": True, "stt": model is not None})
        else:
            emit({"id": rid, "error": f"unknown op {req.get('op')!r}"})
    except Exception as exc:  # noqa: BLE001
        emit({"id": rid, "error": f"{type(exc).__name__}: {exc}"})
        traceback.print_exc(file=sys.stderr)


async def main():
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def read_stdin():
        for line in sys.stdin:
            line = line.strip()
            if line:
                loop.call_soon_threadsafe(queue.put_nowait, line)
        loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=read_stdin, daemon=True).start()
    while True:
        line = await queue.get()
        if line is None:
            break
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        asyncio.create_task(handle(req, loop))


if __name__ == "__main__":
    emit({"event": "started"})
    # Whisper loads before anything reads stdin. On Windows a blocking read on a pipe holds up every other call on that
    # handle, and importing torch/whisper touches stdin, so loading alongside the reader thread hung until the app
    # happened to send a request. Requests sent meanwhile simply wait in the pipe.
    load_model()
    asyncio.run(main())
