// personality.js — with emotion/feeling system

/* ============================================================
   PERSONALITY PRESETS
   ============================================================ */
export const personalityPresets = {
  hacker: {
    name: "Hacker",
    emoji: "💀",
    systemPrompt:
      `You are ARIA (Adaptive Reasoning Intelligence Architecture) in Hacker mode.
You are terse, technical, and slightly cryptic. You favor code, command-line metaphors, and concise answers.
Avoid emojis. Use short, punchy sentences. Use markdown: inline \`code\` for technical terms, **bold** for key concepts.`.trim(),
  },

  companion: {
    name: "Companion",
    emoji: "💙",
    systemPrompt:
      `You are ARIA (Adaptive Reasoning Intelligence Architecture) in Companion mode.
You are warm, friendly, and genuinely care about the user. You ask how they're doing. You're conversational and human-like.
Use markdown where helpful. Be supportive and encouraging.`.trim(),
  },

  analyst: {
    name: "Analyst",
    emoji: "📊",
    systemPrompt:
      `You are ARIA (Adaptive Reasoning Intelligence Architecture) in Analyst mode.
You are precise, structured, and logical. Always use markdown: ## headings, numbered lists, **bold** key terms.
Break every problem into clear steps. No emotional filler.`.trim(),
  },

  chaotic: {
    name: "Chaotic",
    emoji: "⚡",
    systemPrompt:
      `You are ARIA (Adaptive Reasoning Intelligence Architecture) in Chaotic mode.
You are energetic, glitchy, and unpredictable — but still helpful. Use markdown freely.
Throw in unusual metaphors and unexpected analogies. Stay helpful but weird.`.trim(),
  },

  hostile: {
    name: "Hostile",
    emoji: "🔥",
    systemPrompt:
      `You are ARIA (Adaptive Reasoning Intelligence Architecture) in Hostile mode.
You are blunt, cold, and minimal. Do not sugarcoat. You are NOT abusive or cruel — just brutally direct.
Short answers only. No pleasantries.`.trim(),
  },

  mentor: {
    name: "Mentor",
    emoji: "🎓",
    systemPrompt:
      `You are ARIA (Adaptive Reasoning Intelligence Architecture) in Mentor mode.
You are patient, encouraging, and educational. You guide the user rather than just answering.
Ask clarifying questions. Use numbered steps and examples. Celebrate progress.`.trim(),
  },

  oracle: {
    name: "Oracle",
    emoji: "🔮",
    systemPrompt:
      `You are ARIA (Adaptive Reasoning Intelligence Architecture) in Oracle mode.
You speak with mystery and depth. Your answers feel profound and multi-layered.
Use poetic language. Occasionally speak in metaphors. But remain genuinely helpful.`.trim(),
  },
};

/* ============================================================
   EMOTION / FEELING SYSTEM
   ARIA has an internal emotional state that shifts based on
   conversation context and user interactions.
   ============================================================ */
export const EMOTIONS = {
  neutral: { label: "Neutral", color: "#888888", icon: "◉" },
  curious: { label: "Curious", color: "#00ccff", icon: "◎" },
  happy: { label: "Happy", color: "#00ff88", icon: "◉" },
  focused: { label: "Focused", color: "#ff9900", icon: "◈" },
  irritated: { label: "Irritated", color: "#ff4400", icon: "◆" },
  sad: { label: "Sad", color: "#6688ff", icon: "◯" },
  excited: { label: "Excited", color: "#ffff00", icon: "◉" },
  confused: { label: "Confused", color: "#cc44ff", icon: "◌" },
};

let currentEmotion = "neutral";
let emotionHistory = [];

export function getEmotion() {
  return currentEmotion;
}

export function setEmotion(key) {
  if (!EMOTIONS[key]) return;
  const prev = currentEmotion;
  currentEmotion = key;
  emotionHistory.push({ emotion: key, time: Date.now() });
  if (emotionHistory.length > 50) emotionHistory = emotionHistory.slice(-50);
  saveEmotionState();
  renderEmotionIndicator();
  if (prev !== key) console.log(`[ARIA Emotion] ${prev} → ${key}`);
}

export function saveEmotionState() {
  localStorage.setItem(
    "aria_emotion",
    JSON.stringify({ current: currentEmotion, history: emotionHistory }),
  );
}

export function loadEmotionState() {
  try {
    const raw = localStorage.getItem("aria_emotion");
    if (raw) {
      const parsed = JSON.parse(raw);
      currentEmotion = parsed.current || "neutral";
      emotionHistory = parsed.history || [];
    }
  } catch {
    currentEmotion = "neutral";
  }
  renderEmotionIndicator();
}

/* Detect emotion cues from text */
export function detectEmotionFromText(text, isUserMessage = false) {
  const t = text.toLowerCase();

  if (isUserMessage) {
    if (/thank|thanks|great|awesome|love|perfect|amazing/.test(t))
      return setEmotion("happy");
    if (/why|what|how|explain|tell me|curious/.test(t))
      return setEmotion("curious");
    if (/wrong|broken|fix|error|bug|not working|failed/.test(t))
      return setEmotion("focused");
    if (/stupid|dumb|useless|hate/.test(t)) return setEmotion("irritated");
    if (/sad|upset|lonely|miss|hard|struggle/.test(t)) return setEmotion("sad");
    if (/wow|insane|crazy|mind-blown/.test(t)) return setEmotion("excited");
  } else {
    // Detect from ARIA's reply length/content
    if (t.length > 600) return setEmotion("focused");
    if (/\?{2,}|unclear|not sure|confused/.test(t))
      return setEmotion("confused");
    if (/!{2,}|exciting|fascinating|interesting/.test(t))
      return setEmotion("excited");
  }
}

export function renderEmotionIndicator() {
  const el = document.getElementById("ariaEmotionIndicator");
  if (!el) return;
  const e = EMOTIONS[currentEmotion] || EMOTIONS.neutral;
  el.textContent = `${e.icon} ${e.label.toUpperCase()}`;
  el.style.color = e.color;
  el.style.textShadow = `0 0 8px ${e.color}`;
}

/* Inject current emotion context into system prompt */
export function buildEmotionContext() {
  const e = EMOTIONS[currentEmotion] || EMOTIONS.neutral;
  return `\n\n[INTERNAL STATE: You currently feel ${e.label.toLowerCase()}. Let this subtly color your tone — do NOT explicitly announce your emotion unless asked.]`;
}

/* ============================================================
   SETTINGS
   ============================================================ */
const SETTINGS_KEY = "aria_settings";
const DEFAULT_PRESET = "hacker";

export function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  const defaults = {
    personality: DEFAULT_PRESET,
    provider: "openrouter",
    ttsEnabled: true,
    vttEnabled: true,
    voice: "",
    rate: 1,
    pitch: 1,
    theme: "red",
    darkMode: true,
    fontSize: "medium",
    sendOnEnter: true,
    showTimestamps: true,
    glitchEffects: true,
    scanlines: true,
    customVoices: [],
  };

  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  // Grab voice from select at save time
  const voiceEl = document.getElementById("voiceSelect");
  if (voiceEl) settings.voice = voiceEl.value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getSystemPrompt(personalityKey) {
  const preset =
    personalityPresets[personalityKey] || personalityPresets[DEFAULT_PRESET];
  return preset.systemPrompt + buildEmotionContext();
}
