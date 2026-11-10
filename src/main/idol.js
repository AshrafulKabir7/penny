// Idol (speridlabs/idol, Apache-2.0): one picture of an object in, a 3D Gaussian splat (.ply) out, including the sides
// the picture never showed. It needs a big NVIDIA GPU (7 GB), so Penny calls it on Hugging Face: by default its public
// Space, on free shared GPUs with a daily quota per user (a free Hugging Face token gives the user their own quota), or
// any copy of that Space ("space" is a Space id like "you/idol" or its URL). Used by the app's main process and by the
// Chrome extension's worker.

const { Client } = require("@gradio/client");

const DEFAULT_SPACE = "speridlabs/idol";
// Small enough to fetch quickly (65,536 splats, ~4.5 MB) and plenty for an object in a Penny panel.
const SETTINGS = { steps: 30, cfg_scale: 3, rescale_t: 3, seed: 42, randomize: false, gaussians: "65,536" };

/** Sculpts the object in `image` (a Blob); `photo` is true for photographs, false for renders and drawings. */
async function sculpt({ image, photo = false, token, space }) {
  const options = token ? { token } : {};
  let client;
  try {
    client = await Client.connect(space || DEFAULT_SPACE, options);
  } catch (err) {
    throw explain(err, space);
  }
  let file;
  try {
    const res = await client.predict("/run", { image, mode: photo ? "Real photo" : "Synthetic", ...SETTINGS });
    file = res.data?.[0];
  } catch (err) {
    throw explain(err, space);
  }
  if (!file?.url) throw new Error("Idol didn't send back a 3D object.");
  const res = await fetch(file.url, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  if (!res.ok) throw new Error(`Couldn't download the 3D object (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Gradio rejects with status objects rather than errors; turn the common ones into something a user can act on. */
function explain(err, space) {
  const m = String(err?.message || err?.title || err || "");
  if (/quota/i.test(m)) {
    return Object.assign(new Error("Free GPU time for 3D is used up for now. A free Hugging Face token in settings gives you your own."), { quota: true });
  }
  if (/could not be accessed|not found|404/i.test(m)) return new Error(`Can't reach the Idol Space ${space || DEFAULT_SPACE}. Check it in settings.`);
  if (/401|403|unauthori[sz]ed|invalid.*token/i.test(m)) return new Error("Hugging Face didn't accept your token. Check it in settings.");
  if (/could not resolve|space.*(sleeping|paused)|runtime error/i.test(m)) {
    return new Error("The Idol Space isn't running right now. Try again later.");
  }
  return new Error(`Couldn't sculpt it${m ? `: ${m.slice(0, 70)}` : "."}`);
}

module.exports = { sculpt, DEFAULT_SPACE };
