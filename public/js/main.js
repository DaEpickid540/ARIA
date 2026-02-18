import "./lock.js";
// import "./homepage.js";
// import "./personality.js";
// import "./settings.js";
// import "./chat.js";
// import "./ui.js";
// import "./tts.js";
// import "./vtt.js";
// import "./tools.js";

// HOMEPAGE → CHAT TRANSITION WITH ANIMATION
window.addEventListener("DOMContentLoaded", () => {
  const enterBtn = document.getElementById("enterConsoleBtn");
  const homepage = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");

  if (enterBtn) {
    enterBtn.addEventListener("click", () => {
      enterBtn.classList.add("enterToChat");

      setTimeout(() => {
        homepage.style.opacity = "0";
      }, 300);

      setTimeout(() => {
        homepage.style.display = "none";
        layout.style.display = "flex";
      }, 700);
    });
  }
});

document.getElementById("goHomeBtn").addEventListener("click", () => {
  document.getElementById("layout").style.display = "none";
  document.getElementById("homepageScreen").style.display = "flex";
});

document.getElementById("goLockBtn").addEventListener("click", () => {
  document.getElementById("layout").style.display = "none";
  document.getElementById("homepageScreen").style.display = "none";
  document.getElementById("lockScreen").style.display = "flex";
});

enterBtn.addEventListener("click", () => {
  enterBtn.classList.add("enterToChat");

  setTimeout(() => {
    homepage.style.opacity = "0";
  }, 300);

  setTimeout(() => {
    homepage.style.display = "none";
    layout.style.display = "flex";
  }, 700);
});
