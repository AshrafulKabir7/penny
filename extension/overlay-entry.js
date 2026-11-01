// The overlay page of the Chrome extension: the desktop overlay (stage, voice, trail) on top of the extension bridge,
// plus the ask bar. Bundled into overlay.js by tools/build-extension.mjs; imports run in this order.

import "./bridge.js";
import "../src/renderer/overlay.js";
import "./askbar.js";
