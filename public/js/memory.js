export let ariaMemory = {};

export function loadMemory() {
  const saved = localStorage.getItem("aria_memory");
  if (saved) {
    try {
      ariaMemory = JSON.parse(saved);
    } catch {
      ariaMemory = {};
    }
  }
}

export function saveMemory() {
  localStorage.setItem("aria_memory", JSON.stringify(ariaMemory));
}

export function remember(key, value) {
  ariaMemory[key] = value;
  saveMemory();
}

export function recall(key) {
  return ariaMemory[key] || null;
}

loadMemory();
