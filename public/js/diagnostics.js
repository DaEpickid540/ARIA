// diagnostics.js — ARIA Voice System Checker

export function runDiagnostics() {
  console.log("=== ARIA DIAGNOSTICS ===");

  const ids = [
    "callModeBtn",
    "pushToTalkBtn",
    "vttBtn",
    "ttsBtn",
    "callModeOverlay",
    "callWaveform",
    "callSpectrogram",
    "userInput",
    "sendBtn",
  ];

  ids.forEach((id) => {
    console.log(id, document.getElementById(id) ? "OK" : "MISSING");
  });
}
