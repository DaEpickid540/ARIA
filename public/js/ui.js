window.addEventListener("DOMContentLoaded", () => {
  const voiceWave = document.getElementById("voiceWave");

  if (voiceWave && voiceWave.children.length === 0) {
    for (let i = 0; i < 6; i++) {
      const bar = document.createElement("span");
      voiceWave.appendChild(bar);
    }
  }
});
