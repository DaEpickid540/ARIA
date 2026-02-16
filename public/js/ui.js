window.addEventListener("DOMContentLoaded", () => {
  const voiceSelect = document.getElementById("voiceSelect");
  const voiceWave = document.getElementById("voiceWave");

  if (voiceSelect && voiceSelect.children.length === 0) {
    // Placeholder options; real voices come from tts.js
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "System default";
    voiceSelect.appendChild(placeholder);
  }

  if (voiceWave && voiceWave.children.length === 0) {
    for (let i = 0; i < 6; i++) {
      const bar = document.createElement("span");
      voiceWave.appendChild(bar);
    }
  }
});
