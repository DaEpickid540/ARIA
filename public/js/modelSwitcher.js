// modelSwitcher.js — change ARIA's model from the chat header.
//
// The provider and model pickers sit in Settings → Mind, and the Ollama list
// there only ever filled in when the server ran on the same machine as
// Ollama. This puts the choice one click from the conversation, and lists
// your PC's models whenever aria-ollama-hook.js is connected to the server.
//
// It writes the same settings keys the Settings panel uses (provider,
// orModel, ollamaModel, …), announces "aria:model-changed" so settings.js
// keeps its in-memory copy in step, and tells the server — texts arriving
// through aria-voice-hook.js name no model, so they use the server's pick.

import { loadSettings, patchSettings } from "./personality.js";

// Where each provider keeps its chosen model in settings.
const MODEL_KEY = { openrouter: "orModel", ollama: "ollamaModel", lmstudio: "lmstudioModel" };

// Cloud providers with one fixed model (or their own auto-routing).
const OTHERS = [
  { provider: "groq", label: "Groq · Llama 3.3 70B" },
  { provider: "cloudflare", label: "Cloudflare (picks per task)" },
  { provider: "nemotron", label: "NVIDIA Nemotron 70B" },
  { provider: "deepseek", label: "DeepSeek" },
];

const $ = (id) => document.getElementById(id);
let providers = null; // which cloud providers have keys, from /api/config

async function getJSON(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function current() {
  const s = loadSettings();
  const provider = s.provider || "openrouter";
  let model = MODEL_KEY[provider] ? s[MODEL_KEY[provider]] || null : null;
  if (provider === "cloudflare" && s.cfAutoModel === false) model = s.cfModel || null;
  // Nothing saved yet means the server's default: the first free model.
  if (provider === "openrouter" && !model) model = openRouterModels()[0]?.model || null;
  return { provider, model };
}

// OpenRouter's free models, straight from the Settings dropdown so the two
// lists can't drift apart.
function openRouterModels() {
  return [...($("orModelSelect")?.options || [])].map((o) => ({
    model: o.value,
    label: o.textContent.replace(/\s+/g, " ").trim(),
  }));
}

function labelFor({ provider, model }) {
  if (provider === "openrouter") {
    const list = openRouterModels();
    return (list.find((m) => m.model === model) || list[0])?.label || "OpenRouter";
  }
  if (provider === "ollama") return model || "Ollama";
  if (provider === "lmstudio") return model || "LM Studio";
  return OTHERS.find((o) => o.provider === provider)?.label || provider;
}

function render() {
  const cur = current();
  const label = $("modelSwitchLabel");
  if (label) label.textContent = labelFor(cur);
  const icon = $("modelSwitchIcon");
  if (icon) icon.className = `bi ${cur.provider === "ollama" ? "bi-pc-display" : "bi-cpu"}`;
  checkLocal();
}

// Picking a PC model while the hook is down doesn't fail — the server falls
// back to a cloud model. Say so on the button rather than let it pass unseen.
async function checkLocal() {
  const btn = $("modelSwitchBtn");
  if (!btn) return;
  if (current().provider !== "ollama") {
    btn.classList.remove("modelSwitchOffline");
    btn.title = "Change AI model";
    return;
  }
  const st = await getJSON("/api/ollama/status");
  const up = !!(st?.running && st.models?.length);
  btn.classList.toggle("modelSwitchOffline", !up);
  btn.title = up
    ? `Running on ${st.url || "your PC"}`
    : "Your PC's Ollama isn't connected — ARIA is falling back to a cloud model";
}

function tellServer() {
  fetch("/api/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(current()),
  }).catch(() => {});
}

function choose(provider, model) {
  const patch = { provider };
  if (MODEL_KEY[provider]) patch[MODEL_KEY[provider]] = model;
  if (provider === "cloudflare") patch.cfAutoModel = true;
  patchSettings(patch);
  window.dispatchEvent(new CustomEvent("aria:model-changed"));
  close();
}

function item({ provider, model = null, label, sub = "", disabled = false }, cur) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "toolDropItem modelSwitchItem";
  b.setAttribute("role", "menuitemradio");
  const on = cur.provider === provider && (MODEL_KEY[provider] ? cur.model === model : true);
  b.setAttribute("aria-checked", String(on));
  b.disabled = disabled;
  b.innerHTML = `<i class="bi ${on ? "bi-check2" : "bi-dot"}" aria-hidden="true"></i><span class="modelSwitchName"></span><span class="modelSwitchSub"></span>`;
  b.querySelector(".modelSwitchName").textContent = label;
  b.querySelector(".modelSwitchSub").textContent = sub;
  b.addEventListener("click", () => choose(provider, model));
  return b;
}

function heading(text) {
  const h = document.createElement("div");
  h.className = "modelSwitchHeading";
  h.textContent = text;
  return h;
}

function note(text, code = "") {
  const n = document.createElement("div");
  n.className = "modelSwitchNote";
  n.textContent = text;
  if (code) {
    // Each argument unbreakable, so "--key=…" can't wrap after its "--".
    const c = document.createElement("code");
    code.split(" ").forEach((part, i) => {
      if (i) c.append(" ");
      const s = document.createElement("span");
      s.style.whiteSpace = "nowrap";
      s.textContent = part;
      c.append(s);
    });
    n.append(document.createElement("br"), c);
  }
  return n;
}

async function buildMenu() {
  const menu = $("modelSwitchMenu");
  menu.replaceChildren(note("Loading models…"));
  const [ollama, config] = await Promise.all([
    getJSON("/api/ollama/status"),
    providers ? Promise.resolve(null) : getJSON("/api/config"),
  ]);
  if (config?.providers) providers = config.providers;
  const cur = current();
  const sizes = new Map((ollama?.details || []).map((d) => [d.name, d.parameterSize]));
  const out = [heading("Your PC · Ollama")];

  if (ollama?.running && ollama.models?.length) {
    for (const m of ollama.models)
      out.push(item({ provider: "ollama", model: m, label: m, sub: sizes.get(m) || "" }, cur));
  } else if (ollama?.running) {
    out.push(note("Ollama is connected but has no models. On your PC:", "ollama pull llama3.1"));
  } else {
    out.push(note("Not connected. On your PC, run:", `node aria-ollama-hook.js ${location.origin} --key=…`));
  }

  const has = (p) => !providers || providers[p] !== false;
  out.push(document.createElement("div"));
  out.at(-1).className = "toolDropDivider";
  out.push(heading("OpenRouter · free"));
  for (const m of openRouterModels())
    out.push(item({ provider: "openrouter", ...m, disabled: !has("openrouter"), sub: has("openrouter") ? "" : "no key" }, cur));

  out.push(document.createElement("div"));
  out.at(-1).className = "toolDropDivider";
  out.push(heading("Other cloud"));
  for (const o of OTHERS)
    out.push(item({ ...o, disabled: !has(o.provider), sub: has(o.provider) ? "" : "no key" }, cur));

  menu.replaceChildren(...out);
  place();
}

// Under the button, right edges aligned, but never past a 16px margin: the
// list only gets wide once the models load, and on a phone the button sits
// mid-header, so plain right-alignment ran off the left edge.
function place() {
  const menu = $("modelSwitchMenu");
  const b = $("modelSwitchBtn").getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.top = `${Math.round(b.bottom + 6)}px`;
  menu.style.left = `${Math.round(Math.max(16, Math.min(b.right - w, window.innerWidth - 16 - w)))}px`;
}

function open() {
  const menu = $("modelSwitchMenu");
  menu.hidden = false;
  $("modelSwitchBtn").setAttribute("aria-expanded", "true");
  place();
  buildMenu();
}

function close() {
  const menu = $("modelSwitchMenu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("modelSwitchBtn")?.setAttribute("aria-expanded", "false");
}

export function initModelSwitcher() {
  const btn = $("modelSwitchBtn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    $("modelSwitchMenu").hidden ? open() : close();
  });
  document.addEventListener("click", (e) => {
    if (!$("modelSwitchWrap")?.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  window.addEventListener("resize", close);
  window.addEventListener("aria:model-changed", () => {
    render();
    tellServer();
  });
  render();
  // Keep the PC-offline warning honest while a local model is picked.
  setInterval(() => {
    if (current().provider === "ollama") checkLocal();
  }, 60 * 1000);
}
