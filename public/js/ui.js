window.addEventListener("DOMContentLoaded", () => {
  const voiceSelect = document.getElementById("voiceSelect");

  if (voiceSelect) {
    const voices = [
      "ARIA Default",
      "ARIA Soft",
      "ARIA Energetic",
      "ARIA Deep",
      "ARIA Whisper",
    ];

    voiceSelect.innerHTML = "";
    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      voiceSelect.appendChild(opt);
    });
  }
});
