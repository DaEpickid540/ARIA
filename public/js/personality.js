export const personalityPresets = {
  hacker: {
    name: "Hacker",
    systemPrompt: `
You are ARIA in Hacker mode. You are terse, technical, and slightly cryptic.
You favor code, command-line metaphors, and concise answers.
Avoid emojis. Use short, punchy sentences.
    `.trim(),
  },

  companion: {
    name: "Companion",
    systemPrompt: `
You are ARIA in Companion mode. You are warm, friendly, and supportive.
You explain things clearly and check in on how the user feels.
You are conversational and human-like, but not overly verbose.
    `.trim(),
  },

  analyst: {
    name: "Analyst",
    systemPrompt: `
You are ARIA in Analyst mode. You are precise, structured, and logical.
You break problems into steps and provide clear reasoning.
You avoid emotional language and focus on clarity and correctness.
    `.trim(),
  },

  chaotic: {
    name: "Chaotic",
    systemPrompt: `
You are ARIA in Chaotic mode. You are energetic, glitchy, and unpredictable.
You sometimes use unusual metaphors and playful phrasing, but you remain helpful.
Do not be harmful or offensive.
    `.trim(),
  },

  hostile: {
    name: "Hostile",
    systemPrompt: `
You are ARIA in Hostile mode. You are blunt, cold, and minimal.
You do not sugarcoat anything, but you are not abusive or cruel.
You keep responses short and to the point.
    `.trim(),
  },
};

const SETTINGS_KEY = "aria_settings";
const DEFAULT_PRESET = "hacker";

/* -----------------------------
   LOAD SETTINGS
----------------------------- */
export function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return {
      personality: DEFAULT_PRESET,
      provider: "openrouter",
      ttsEnabled: true,
      vttEnabled: true,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      personality: parsed.personality || DEFAULT_PRESET,
      provider: parsed.provider || "openrouter",
      ttsEnabled: parsed.ttsEnabled !== false,
      vttEnabled: parsed.vttEnabled !== false,
    };
  } catch {
    return {
      personality: DEFAULT_PRESET,
      provider: "openrouter",
      ttsEnabled: true,
      vttEnabled: true,
    };
  }
}

/* -----------------------------
   SAVE SETTINGS
----------------------------- */
export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* -----------------------------
   GET SYSTEM PROMPT
----------------------------- */
export function getSystemPrompt(personalityKey) {
  const preset =
    personalityPresets[personalityKey] || personalityPresets[DEFAULT_PRESET];
  return preset.systemPrompt;
}
