// Small line icons for card rows, drawn in the same ink as everything else (24×24 viewBox, strokes only).

const ICONS = {
  network:
    "M5 6a2 2 0 1 0 0.01 0 M5 18a2 2 0 1 0 0.01 0 M19 12a2 2 0 1 0 0.01 0 M12 4a2 2 0 1 0 0.01 0 M12 20a2 2 0 1 0 0.01 0 M7 7l3 -2 M7 17l3 2 M7 7l10 4 M7 17l10 -4 M14 5l4 5 M14 19l4 -5",
  layers: "M12 3l9 5l-9 5l-9 -5z M3 12l9 5l9 -5 M3 16l9 5l9 -5",
  chip: "M7 7h10v10h-10z M10 10h4v4h-4z M9 3v4 M12 3v4 M15 3v4 M9 17v4 M12 17v4 M15 17v4 M3 9h4 M3 12h4 M3 15h4 M17 9h4 M17 12h4 M17 15h4",
  check: "M4 12.5l5 5l11 -11",
  cross: "M5 5l14 14 M19 5l-14 14",
  gear: "M12 8.5a3.5 3.5 0 1 0 0.01 0 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1l2.1 -2.1 M17 7l2.1 -2.1",
  bulb: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0 -4 10.5c1 1 1 2 1 3.5h6c0 -1.5 0 -2.5 1 -3.5a6 6 0 0 0 -4 -10.5z",
  eye: "M2 12c3 -5 7 -7 10 -7s7 2 10 7c-3 5 -7 7 -10 7s-7 -2 -10 -7z M12 9a3 3 0 1 0 0.01 0",
  person: "M12 4a4 4 0 1 0 0.01 0 M4 21c0 -4 4 -7 8 -7s8 3 8 7",
  doc: "M6 3h8l4 4v14h-12z M14 3v4h4 M9 12h6 M9 16h6",
  db: "M4 6c0 -2 16 -2 16 0s-16 2 -16 0 M4 6v12c0 2 16 2 16 0v-12 M4 12c0 2 16 2 16 0",
  cloud: "M7 18h10a4 4 0 0 0 0 -8a6 6 0 0 0 -11.5 1.5a3.5 3.5 0 0 0 1.5 6.5z",
  warning: "M12 3l10 18h-20z M12 10v5 M12 18v0.5",
  clock: "M12 3a9 9 0 1 0 0.01 0 M12 7v5l3 3",
  bolt: "M13 2l-8 12h6l-1 8l8 -12h-6z",
  heart: "M12 20s-8 -5 -8 -11a4.5 4.5 0 0 1 8 -2.5a4.5 4.5 0 0 1 8 2.5c0 6 -8 11 -8 11z",
  star: "M12 3l2.7 5.6l6.1 0.9l-4.4 4.3l1 6.1l-5.4 -2.9l-5.4 2.9l1 -6.1l-4.4 -4.3l6.1 -0.9z",
  fan: "M12 10.5a1.5 1.5 0 1 0 0.01 0 M12 10c-1 -4 1 -7 3 -6s0 4 -3 6 M13.5 12.5c4 -1 7 1 6 3s-4 0 -6 -3 M10.5 12.5c-3 2 -4 5 -2 6s3 -2 2 -6 M12 2a10 10 0 1 0 0.01 0",
  stack: "M5 5h12v12h-12z M8 8h12v12h-12z",
  arrowUp: "M12 20v-15 M6 11l6 -6l6 6",
  arrowDown: "M12 4v15 M6 13l6 6l6 -6",
  play: "M7 4l13 8l-13 8z",
  wifi: "M2 9a15 15 0 0 1 20 0 M5 12.5a10 10 0 0 1 14 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5v0.5",
  battery: "M3 8h16v8h-16z M19 10.5h2v3h-2 M6 11v2 M9 11v2",
  lock: "M6 11h12v10h-12z M8.5 11v-3a3.5 3.5 0 0 1 7 0v3",
  globe: "M12 3a9 9 0 1 0 0.01 0 M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3 -3 15 0 18",
  money: "M3 7h18v10h-18z M12 9.5a2.5 2.5 0 1 0 0.01 0 M6 10v4 M18 10v4",
  camera: "M3 8h4l2 -3h6l2 3h4v12h-18z M12 10a3.5 3.5 0 1 0 0.01 0",
  code: "M8 7l-5 5l5 5 M16 7l5 5l-5 5 M14 4l-4 16",
  search: "M10.5 4a6.5 6.5 0 1 0 0.01 0 M15.5 15.5l5 5",
};

const ALIASES = { brain: "network", neural: "network", weights: "network", cpu: "chip", processor: "chip", ok: "check", yes: "check",
  no: "cross", x: "cross", settings: "gear", idea: "bulb", user: "person", file: "doc", database: "db", time: "clock", power: "bolt",
  energy: "bolt", alert: "warning", love: "heart", data: "db", model: "layers" };

export function iconSvg(name) {
  const key = String(name || "").replace(/[^a-z]/gi, "").toLowerCase();
  const found = Object.keys(ICONS).find((k) => k.toLowerCase() === key) || ALIASES[key];
  const d = ICONS[found] || ICONS.star;
  return `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#2d2b28" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}
