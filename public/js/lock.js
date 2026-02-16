window.addEventListener("DOMContentLoaded", () => {
  const PASSWORD = "727846";

  const lockScreen = document.getElementById("lockScreen");
  const homepage = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");

  const unlockBtn = document.getElementById("unlockBtn");
  const passwordInput = document.getElementById("passwordInput");
  const lockError = document.getElementById("lockError");
  const enterConsoleBtn = document.getElementById("enterConsoleBtn");

  function tryUnlock() {
    const input = passwordInput.value.trim();
    if (input === PASSWORD) {
      lockScreen.style.display = "none";
      homepage.style.display = "flex";
    } else {
      lockError.textContent = "Incorrect password";
    }
  }

  unlockBtn?.addEventListener("click", tryUnlock);
  passwordInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });

  enterConsoleBtn?.addEventListener("click", () => {
    homepage.style.display = "none";
    layout.style.display = "flex";
  });

  // Initial visibility
  lockScreen.style.display = "flex";
  homepage.style.display = "none";
  layout.style.display = "none";
});
