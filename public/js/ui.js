window.addEventListener("DOMContentLoaded", () => {
  const voiceSelect = document.getElementById("voiceSelect");
  const voiceRate = document.getElementById("voiceRate");
  const voicePitch = document.getElementById("voicePitch");

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

  // You can later wire these into TTS if you want
  voiceRate?.addEventListener("input", () => {
    // console.log("Rate:", voiceRate.value);
  });

  voicePitch?.addEventListener("input", () => {
    // console.log("Pitch:", voicePitch.value);
  });
});
