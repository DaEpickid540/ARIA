// lock.js

window.addEventListener("DOMContentLoaded", () => {
  const lockScreen = document.getElementById("lockScreen");
  const homepageScreen = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");

  const passwordInput = document.getElementById("passwordInput");
  const unlockBtn = document.getElementById("unlockBtn");
  const lockError = document.getElementById("lockError");

  const CORRECT_PASSWORD = "727846";

  lockScreen.style.display = "flex";
  homepageScreen.style.display = "none";
  layout.style.display = "none";

  async function unlock() {
    const val = passwordInput.value.trim();

    if (val === CORRECT_PASSWORD) {
      lockScreen.style.display = "none";
      layout.style.display = "none";

      try {
        const { initHomepage } = await import("./homepage.js");
        initHomepage();
        console.log("HOMEPAGE LOADED");
      } catch (err) {
        console.error("HOMEPAGE FAILED:", err);
      }

      lockError.textContent = "";
      passwordInput.value = "";
    } else {
      lockError.textContent = "ACCESS DENIED";
    }
  }

  unlockBtn.addEventListener("click", unlock);
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
});
