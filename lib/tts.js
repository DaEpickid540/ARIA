// lib/tts.js — ARIA's own voice, generated on this PC (Kokoro-82M)
// ═══════════════════════════════════════════════════════════════════
//
// No cloud and no key: Kokoro is an 82M-parameter TTS model that runs on
// the CPU through onnxruntime (kokoro-js). The model (~90 MB) downloads on
// first use into <data>/models and loads once per server start.
//
// The page asks for one sentence at a time and plays it while the next one
// is generated (public/js/tts.js), so a long reply starts speaking after the
// first sentence instead of after the whole thing. Generation is serialized:
// two at once would only slow both down on the same CPU cores.
//
// Off on a public deploy unless ARIA_TTS=on. On Render the "local" voice
// would be Render's CPU, not yours, and loading the model takes a good part
// of a small instance's memory. The hosted page reaches the voice on your PC
// at http://127.0.0.1:<port> instead (see lib/auth.js ▸ local CORS).
// ═══════════════════════════════════════════════════════════════════

import path from "path";
import { DATA_DIR } from "./paths.js";
import { isPublicDeploy } from "./auth.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MAX_CHARS = 600; // per request: one or two sentences

/** Shown in Settings ▸ Voice. Kokoro v1.0 has 28; these are the clearest. */
export const VOICES = [
  { id: "af_heart", label: "Heart — US female" },
  { id: "af_bella", label: "Bella — US female" },
  { id: "af_nicole", label: "Nicole — US female, soft" },
  { id: "af_sarah", label: "Sarah — US female" },
  { id: "af_sky", label: "Sky — US female" },
  { id: "am_michael", label: "Michael — US male" },
  { id: "am_fenrir", label: "Fenrir — US male" },
  { id: "am_puck", label: "Puck — US male" },
  { id: "am_echo", label: "Echo — US male" },
  { id: "bf_emma", label: "Emma — British female" },
  { id: "bf_isabella", label: "Isabella — British female" },
  { id: "bm_george", label: "George — British male" },
  { id: "bm_fable", label: "Fable — British male" },
];
const VOICE_IDS = new Set(VOICES.map((v) => v.id));

export const enabled = () => !isPublicDeploy() || process.env.ARIA_TTS === "on";

let _model = null; // Promise<KokoroTTS>
function model() {
  if (!_model) {
    _model = (async () => {
      const [{ env }, { KokoroTTS }] = await Promise.all([
        import("@huggingface/transformers"),
        import("kokoro-js"),
      ]);
      // Inside the desktop app the package folder is read-only.
      env.cacheDir = path.join(DATA_DIR, "models");
      const t = Date.now();
      const m = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "cpu" });
      console.log(`[TTS] Kokoro ready in ${Date.now() - t}ms`);
      return m;
    })().catch((e) => {
      _model = null; // let the next request try again (e.g. after going online)
      throw e;
    });
  }
  return _model;
}

let _queue = Promise.resolve();

/**
 * @returns {Promise<Buffer>} a 24 kHz mono WAV
 */
export function synthesize(text, { voice = "af_heart", speed = 1 } = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!clean) return Promise.reject(new Error("Nothing to say."));
  const v = VOICE_IDS.has(voice) ? voice : "af_heart";
  const s = Math.min(2, Math.max(0.5, Number(speed) || 1));
  const job = _queue.then(async () => {
    const m = await model();
    const audio = await m.generate(clean, { voice: v, speed: s });
    return Buffer.from(audio.toWav());
  });
  _queue = job.catch(() => {});
  return job;
}

/** Mounts GET /api/tts/status and POST /api/tts. */
export function mountTtsRoutes(app) {
  app.get("/api/tts/status", (_req, res) => {
    res.json({ available: enabled(), voices: enabled() ? VOICES : [] });
  });

  app.post("/api/tts", async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: "local_only" });
    try {
      const wav = await synthesize(req.body?.text, req.body || {});
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "no-store");
      res.end(wav);
    } catch (e) {
      console.warn("[TTS]", e.message);
      res.status(/Cannot find (package|module)/.test(e.message) ? 501 : 500).json({ error: e.message });
    }
  });
}
