// Builds Penny for Chrome into dist/penny-chrome (load it unpacked from chrome://extensions) and zips it into
// dist/penny-chrome.zip (for the Chrome Web Store and the GitHub release).
//   npm run build:extension

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "extension");
const OUT = join(ROOT, "dist", "penny-chrome");
const ZIP = join(ROOT, "dist", "penny-chrome.zip");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const common = {
  bundle: true,
  platform: "browser",
  target: "chrome120",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
};
await build({ ...common, entryPoints: [join(SRC, "background.js")], outfile: join(OUT, "background.js"), format: "esm" });
await build({ ...common, entryPoints: [join(SRC, "overlay-entry.js")], outfile: join(OUT, "overlay.js"), format: "iife" });
await build({ ...common, entryPoints: [join(SRC, "options.js")], outfile: join(OUT, "options.js"), format: "iife" });

// The manifest carries the app's version.
const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const f of ["content.js", "overlay.html", "options.html", "askbar.css"]) copyFileSync(join(SRC, f), join(OUT, f));
copyFileSync(join(ROOT, "src", "renderer", "overlay.css"), join(OUT, "overlay.css"));
cpSync(join(SRC, "icons"), join(OUT, "icons"), { recursive: true });

// The handwriting font, regular and bold.
const fonts = join(ROOT, "node_modules", "@fontsource", "kalam");
mkdirSync(join(OUT, "fonts", "files"), { recursive: true });
for (const w of ["400", "700"]) copyFileSync(join(fonts, `${w}.css`), join(OUT, "fonts", `${w}.css`));
for (const f of readdirSync(join(fonts, "files"))) if (/-(400|700)-normal\.woff2?$/.test(f)) copyFileSync(join(fonts, "files", f), join(OUT, "fonts", "files", f));

// Zip the folder's contents (Windows 10+ and macOS ship bsdtar, which writes zips; Linux uses zip).
rmSync(ZIP, { force: true });
const entries = readdirSync(OUT);
if (process.platform === "linux") execFileSync("zip", ["-qr", ZIP, ...entries], { cwd: OUT });
else {
  // Windows' own tar: from a Git Bash shell, plain "tar" would be GNU tar, which can't write zips.
  const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-a", "-cf", ZIP, ...entries], { cwd: OUT });
}
if (!existsSync(ZIP)) throw new Error("zip was not written");

const size = (p) => (readFileSync(p).length / 1024).toFixed(0);
console.log(`dist/penny-chrome (background ${size(join(OUT, "background.js"))} KB, overlay ${size(join(OUT, "overlay.js"))} KB), dist/penny-chrome.zip ${size(ZIP)} KB`);
