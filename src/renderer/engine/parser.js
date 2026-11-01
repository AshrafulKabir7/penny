// Pulls scene ops out of a model's reply while it is still being written.
//
// Models do not always write clean JSONL: there may be code fences, a sentence before the JSON, several objects on one
// line, one object spread over several lines, a wrapping {"ops":[...]} or a trailing comma. This scanner tracks brace
// depth outside of strings, so every complete top-level object is handed over the moment its closing brace arrives.

export class OpStream {
  constructor(onOp) {
    this.onOp = onOp;
    this.buf = "";
    this.depth = 0;
    this.inString = false;
    this.escaped = false;
    this.start = -1;
    this.pos = 0;
    this.count = 0;
  }

  push(text) {
    this.buf += text;
    for (; this.pos < this.buf.length; this.pos++) {
      const ch = this.buf[this.pos];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }
      if (ch === '"') {
        if (this.depth > 0) this.inString = true;
      } else if (ch === "{") {
        if (this.depth === 0) this.start = this.pos;
        this.depth++;
      } else if (ch === "}" && this.depth > 0) {
        this.depth--;
        if (this.depth === 0) this._emit(this.buf.slice(this.start, this.pos + 1));
      }
    }
    // Keep memory flat on long replies: drop everything already consumed.
    if (this.depth === 0 && this.pos > 4096) {
      this.buf = "";
      this.pos = 0;
    }
  }

  _emit(raw) {
    const obj = parseLoose(raw);
    if (!obj || typeof obj !== "object") return;
    if (typeof obj.op === "string") {
      this.count++;
      this.onOp(obj);
      return;
    }
    // {"ops":[...]} or {"steps":[...]}: unwrap any array of ops.
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item.op === "string") {
            this.count++;
            this.onOp(item);
          }
        }
      }
    }
  }
}

function parseLoose(raw) {
  try {
    return JSON.parse(raw);
  } catch {}
  const repaired = raw
    .replace(/,\s*([}\]])/g, "$1") // trailing commas
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":') // unquoted keys
    .replace(/:\s*'([^'\\]*)'/g, ': "$1"'); // single-quoted values
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}
