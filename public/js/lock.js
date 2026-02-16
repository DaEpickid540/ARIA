window.addEventListener("DOMContentLoaded", () => {
  const lockScreen = document.getElementById("lockScreen");
  const passwordInput = document.getElementById("passwordInput");
  const unlockBtn = document.getElementById("unlockBtn");
  const lockError = document.getElementById("lockError");
  const homepageScreen = document.getElementById("homepageScreen");

  const CORRECT_PASSWORD = "aria";

  function unlock() {
    const val = passwordInput.value.trim();
    if (val === CORRECT_PASSWORD) {
      lockScreen.style.display = "none";
      homepageScreen.style.display = "flex";
    } else {
      lockError.textContent = "ACCESS DENIED";
    }
  }

  unlockBtn.addEventListener("click", unlock);

  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });
});
