// ariaLoader.js — ARIA animated 3D loader (Mark 1.5)
// ================================================================
// Replaces the old three-dot typing indicator with a 3D rotating
// cube that adapts to the current task type.
//
// Usage:
//   import { showARIALoader, removeARIALoader, updateLoaderTask } from "./ariaLoader.js";
//   const id = showARIALoader(container, { task: "search", detail: "neural networks" });
//   updateLoaderTask(id, "thinking");
//   removeARIALoader(id);
// ================================================================

/* ── Task configs ─────────────────────────────────────────────
   Each task has:
     label      — shown above the status text
     statuses   — cycling messages while loading
     faceIcons  — what shows on the 6 cube faces
     spinClass  — added to .ariaLoader for task-specific spin + color
     clickLines — what ARIA says when you click the loader
*/
const TASK_CONFIGS = {
  thinking: {
    label: "NEURAL PROCESSING",
    statuses: [
      "Loading inference engine…",
      "Tokenizing input…",
      "Running forward pass…",
      "Attention heads active…",
      "Decoding tokens…",
      "Sampling distribution…",
      "Beam search active…",
      "Cross-entropy minimized…",
      "Logits computed…",
      "Softmax layer engaged…",
    ],
    faceIcons: ["⬡", "∑", "⊕", "⊗", "∇", "λ"],
    spinClass: "",
    clickLines: [
      "Still thinking. Neural weights are heavy.",
      "Patience — running a 70B parameter model here.",
      "I'm processing. Give me a moment.",
      "The tokens are coming. Trust the process.",
      "Beam width: 4. Temperature: 0.7. Working on it.",
      "Attention mechanism engaged. Don't interrupt.",
    ],
  },

  search: {
    label: "QUERYING NETWORK",
    statuses: [
      "Resolving DNS…",
      "Fetching search index…",
      "Crawling results…",
      "Ranking documents…",
      "Extracting entities…",
      "Cross-referencing sources…",
      "Vectorizing snippets…",
      "Deduplicating results…",
    ],
    faceIcons: ["🌐", "↗", "◎", "⊛", "⟳", "◈"],
    spinClass: "search",
    clickLines: [
      "Scanning the web for you. Hang on.",
      "DNS resolved. Fetching results now.",
      "The internet is big. Almost there.",
      "Cross-referencing 14 sources.",
      "Ranking by relevance. Won't be long.",
    ],
  },

  claw: {
    label: "CLAW — RELAY ACTIVE",
    statuses: [
      "Queuing HID commands…",
      "Sending keystrokes…",
      "Executing mouse path…",
      "Awaiting relay ACK…",
      "BLE packet dispatched…",
      "USB HID report sent…",
      "Injecting input…",
      "Relay synchronized…",
    ],
    faceIcons: ["🦾", "⌨", "🖱", "⚡", "▶", "↯"],
    spinClass: "claw",
    clickLines: [
      "Relaying commands to your machine right now.",
      "HID packets in flight. Don't touch the keyboard.",
      "BLE link active. Claw is executing.",
      "Your PC is listening. Commands queued.",
      "Relay confirmed. Running your action.",
    ],
  },

  image: {
    label: "RENDERING IMAGE",
    statuses: [
      "Initializing diffusion model…",
      "Encoding text prompt…",
      "Sampling noise…",
      "Denoising step 1/20…",
      "Running U-Net forward…",
      "Classifier-free guidance…",
      "Decoding latents…",
      "VAE upscaling…",
      "Rendering final pass…",
    ],
    faceIcons: ["🎨", "✦", "◇", "◈", "⬡", "★"],
    spinClass: "image",
    clickLines: [
      "Diffusion model is running. Almost painted.",
      "Sampling latent space. Be patient.",
      "20 denoising steps. I'm on step 12.",
      "Your image is taking shape.",
      "VAE decoding. Almost done.",
    ],
  },

  files: {
    label: "FILE OPERATION",
    statuses: [
      "Reading filesystem…",
      "Parsing document…",
      "Extracting content…",
      "Chunking text…",
      "Indexing vectors…",
      "Scanning structure…",
      "Processing attachment…",
    ],
    faceIcons: ["📄", "⊡", "≡", "∷", "▤", "⊞"],
    spinClass: "files",
    clickLines: [
      "Reading your document. Give me a second.",
      "Parsing file structure. Almost done.",
      "Chunking and indexing. Won't take long.",
      "File loaded. Building context.",
    ],
  },

  math: {
    label: "COMPUTING",
    statuses: [
      "Parsing expression…",
      "Building AST…",
      "Applying transformations…",
      "Symbolic differentiation…",
      "Evaluating integral…",
      "Solving linear system…",
      "Eigenvalue decomposition…",
      "Gradient descent step…",
      "Numerical precision: 64-bit…",
    ],
    faceIcons: ["∑", "∫", "∂", "∇", "∞", "π"],
    spinClass: "math",
    clickLines: [
      "Running numerical computation. Hold on.",
      "Evaluating expression with 64-bit precision.",
      "Matrix operations in progress.",
      "Solving the system. Almost there.",
    ],
  },

  code: {
    label: "COMPILING RESPONSE",
    statuses: [
      "Parsing syntax tree…",
      "Resolving imports…",
      "Type-checking…",
      "Analyzing control flow…",
      "Generating code…",
      "Formatting output…",
      "Running linter…",
      "Checking edge cases…",
    ],
    faceIcons: ["{ }", "</>" , "fn", "⊕", "∷", "≡"],
    spinClass: "code",
    clickLines: [
      "Still generating your code. Almost compiled.",
      "Writing clean code takes a moment.",
      "Running the linter in my head. Hang on.",
      "No bugs so far. Still checking.",
    ],
  },

  rag: {
    label: "MEMORY RETRIEVAL",
    statuses: [
      "Embedding query…",
      "Scanning vector store…",
      "Cosine similarity search…",
      "Ranking memories…",
      "Fetching context chunks…",
      "Building recall context…",
    ],
    faceIcons: ["◎", "⊛", "∿", "◈", "⟳", "⬡"],
    spinClass: "rag",
    clickLines: [
      "Scanning your knowledge base. One sec.",
      "Finding relevant memories in the vector store.",
      "Cosine similarity search in progress.",
      "Pulling context from your past conversations.",
    ],
  },

  default: {
    label: "ARIA PROCESSING",
    statuses: [
      "Thinking…",
      "Reasoning through context…",
      "Formulating response…",
      "Checking memory…",
      "Cross-referencing knowledge…",
      "Selecting output tokens…",
    ],
    faceIcons: ["▲", "■", "●", "◆", "★", "⬡"],
    spinClass: "",
    clickLines: [
      "I'm working on it.",
      "Processing your request.",
      "Give me a moment.",
      "Almost there.",
      "Running inference.",
    ],
  },
};

/* ── Internal state ─────────────────────────────────────────── */
const _activeLoaders = new Map(); // id → { el, timer, config, clickCount }

/* ── Detect task from message content ──────────────────────── */
export function detectTaskFromMessage(text = "") {
  const t = text.toLowerCase();
  if (/imagine|generate.*image|draw|paint|picture|illustration/.test(t)) return "image";
  if (/search|look up|find|google|web.*search|news|current|latest|today/.test(t)) return "search";
  if (/claw|control|click|type.*on|open.*app|navigate.*pc|relay/.test(t)) return "claw";
  if (/upload|file|pdf|document|read.*file|parse|attachment/.test(t)) return "files";
  if (/calc|math|solve|equation|integral|derivative|matrix|compute|formula/.test(t)) return "math";
  if (/code|write.*function|debug|refactor|program|script|implement|class/.test(t)) return "code";
  if (/remember|recall|memory|past.*conversation|what did|rag/.test(t)) return "rag";
  return "thinking";
}

/* ── Build cube HTML ─────────────────────────────────────────── */
function buildCubeHTML(icons) {
  const faces = icons.slice(0, 6);
  return faces.map(icon => `<div class="alFace"><span class="alFaceIcon">${icon}</span></div>`).join("");
}

/* ── Main: show loader ──────────────────────────────────────── */
export function showARIALoader(container, { task = "thinking", detail = "" } = {}) {
  const id = "al_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const cfg = TASK_CONFIGS[task] || TASK_CONFIGS.default;

  const el = document.createElement("div");
  el.id = id;
  el.className = "msg aria";
  el.innerHTML = `
    <div class="msgSender">ARIA</div>
    <div class="ariaLoader ${cfg.spinClass}" id="${id}_loader">
      <div class="alScene">
        <div class="alCube">${buildCubeHTML(cfg.faceIcons)}</div>
      </div>
      <div class="alText">
        <div class="alTaskLabel">${cfg.label}</div>
        <div class="alStatus" id="${id}_status">${cfg.statuses[0]}</div>
        <div class="alSubtext" id="${id}_detail">${detail || ""}</div>
        <div class="alDots">
          <div class="alDot"></div>
          <div class="alDot"></div>
          <div class="alDot"></div>
          <div class="alDot"></div>
          <div class="alDot"></div>
        </div>
      </div>
    </div>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;

  // Cycle status messages
  let statusIdx = 0;
  const statusTimer = setInterval(() => {
    statusIdx = (statusIdx + 1) % cfg.statuses.length;
    const statusEl = document.getElementById(id + "_status");
    if (!statusEl) { clearInterval(statusTimer); return; }
    statusEl.classList.remove("typing");
    void statusEl.offsetWidth; // force reflow for animation restart
    statusEl.textContent = cfg.statuses[statusIdx];
    statusEl.classList.add("typing");
  }, 2200);

  // Wire click interaction
  const loaderEl = document.getElementById(id + "_loader");
  let clickCount = 0;
  let popupTimer = null;
  if (loaderEl) {
    loaderEl.addEventListener("click", (e) => {
      e.stopPropagation();
      _handleLoaderClick(id, cfg, loaderEl, clickCount++);
      // Clear popup after a moment
      clearTimeout(popupTimer);
      popupTimer = setTimeout(() => {
        document.getElementById(id + "_popup")?.remove();
      }, 4000);
    });
  }

  _activeLoaders.set(id, { el, timer: statusTimer, config: cfg, clickCount: 0 });
  return id;
}

/* ── Update task mid-flight ──────────────────────────────────── */
export function updateLoaderTask(id, task, detail = "") {
  const entry = _activeLoaders.get(id);
  if (!entry) return;
  const cfg = TASK_CONFIGS[task] || TASK_CONFIGS.default;
  entry.config = cfg;

  const loaderEl = document.getElementById(id + "_loader");
  if (!loaderEl) return;

  // Update class (color + spin)
  loaderEl.className = "ariaLoader " + cfg.spinClass;

  // Update cube faces
  const cube = loaderEl.querySelector(".alCube");
  if (cube) cube.innerHTML = buildCubeHTML(cfg.faceIcons);

  // Update label
  const label = loaderEl.querySelector(".alTaskLabel");
  if (label) label.textContent = cfg.label;

  // Update status
  const status = loaderEl.querySelector(".alStatus");
  if (status) {
    status.textContent = cfg.statuses[0];
    status.classList.add("typing");
    setTimeout(() => status.classList.remove("typing"), 300);
  }

  // Update detail
  const detailEl = loaderEl.querySelector(".alSubtext");
  if (detailEl && detail) detailEl.textContent = detail;
}

/* ── Remove loader ───────────────────────────────────────────── */
export function removeARIALoader(id) {
  const entry = _activeLoaders.get(id);
  if (!entry) {
    // Fall back: try to remove by id directly
    document.getElementById(id)?.remove();
    return;
  }
  clearInterval(entry.timer);
  // Play a quick collapse animation then remove
  const loaderEl = document.getElementById(id + "_loader");
  if (loaderEl) {
    loaderEl.classList.add("done");
    const cube = loaderEl.querySelector(".alCube");
    if (cube) {
      cube.style.transition = "transform 0.3s ease-in, opacity 0.3s";
      cube.style.opacity = "0";
      cube.style.transform += " scale(0)";
    }
  }
  setTimeout(() => {
    entry.el.remove();
    _activeLoaders.delete(id);
  }, 350);
}

/* ── Click handler ───────────────────────────────────────────── */
function _handleLoaderClick(id, cfg, loaderEl, clickCount) {
  // Ripple
  const ripple = document.createElement("div");
  ripple.className = "alRipple";
  loaderEl.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);

  // Speed up cube on click
  const cube = loaderEl.querySelector(".alCube");
  if (cube) {
    loaderEl.classList.add("fast");
    setTimeout(() => loaderEl.classList.remove("fast"), 800);
  }

  // Show a popup message
  const existing = document.getElementById(id + "_popup");
  if (existing) existing.remove();

  const line = cfg.clickLines[clickCount % cfg.clickLines.length];
  const popup = document.createElement("div");
  popup.className = "alPopup";
  popup.id = id + "_popup";
  popup.textContent = line;
  loaderEl.appendChild(popup);
}

/* ── Expose globally for non-module callers ─────────────────── */
window._ARIALoader = { showARIALoader, removeARIALoader, updateLoaderTask, detectTaskFromMessage };
