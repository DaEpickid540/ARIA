// lock.js

// ── AUTHORISED USERS ─────────────────────────────────────────
// Add more users here as { id, password } if needed later.
// userId is case-insensitive. Password is exact match.
const USERS = [{ id: "sarvin", password: "727846" }];
// ─────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  const lockScreen = document.getElementById("lockScreen");
  const homepageScreen = document.getElementById("homepageScreen");
  const layout = document.getElementById("layout");

  const userIdInput = document.getElementById("userIdInput");
  const passwordInput = document.getElementById("passwordInput");
  const unlockBtn = document.getElementById("unlockBtn");
  const lockError = document.getElementById("lockError");

  // Start locked
  lockScreen.style.display = "flex";
  homepageScreen.style.display = "none";
  layout.style.display = "none";

  // Track failed attempts for lockout
  let failedAttempts = 0;
  let lockedUntil = 0;

  async function unlock() {
    // Lockout check
    const now = Date.now();
    if (now < lockedUntil) {
      const secs = Math.ceil((lockedUntil - now) / 1000);
      lockError.textContent = `SYSTEM LOCKED — retry in ${secs}s`;
      return;
    }

    const enteredId = userIdInput.value.trim().toLowerCase();
    const enteredPass = passwordInput.value.trim();

    // Blank field checks
    if (!enteredId) {
      lockError.textContent = "USER ID REQUIRED";
      shakeInput(userIdInput);
      return;
    }
    if (!enteredPass) {
      lockError.textContent = "ACCESS CODE REQUIRED";
      shakeInput(passwordInput);
      return;
    }

    // Find matching user (case-insensitive ID)
    const user = USERS.find((u) => u.id.toLowerCase() === enteredId);

    if (!user) {
      failedAttempts++;
      lockError.textContent = `UNKNOWN USER: "${enteredId.toUpperCase()}" — ACCESS DENIED`;
      shakeBox();
      checkLockout();
      return;
    }

    if (user.password !== enteredPass) {
      failedAttempts++;
      lockError.textContent = "INVALID ACCESS CODE — ACCESS DENIED";
      shakeBox();
      checkLockout();
      passwordInput.value = "";
      return;
    }

    // ── SUCCESS ──
    failedAttempts = 0;
    lockError.textContent = "";

    // Store active userId globally so chat.js and server sync use it
    window.ARIA_userId = user.id;

    // Flash the lock box green briefly before hiding
    const lockBox = document.getElementById("lockBox");
    if (lockBox) {
      lockBox.style.borderColor = "#00ff88";
      lockBox.style.boxShadow = "0 0 24px #00ff88";
    }

    await new Promise((r) => setTimeout(r, 350));

    lockScreen.style.display = "none";
    layout.style.display = "none";
    passwordInput.value = "";
    userIdInput.value = "";

    const { initHomepage } = await import("./homepage.js");
    initHomepage();
  }

  function checkLockout() {
    if (failedAttempts >= 5) {
      lockedUntil = Date.now() + 30_000; // 30 second lockout
      failedAttempts = 0;
      lockError.textContent = "TOO MANY FAILED ATTEMPTS — LOCKED FOR 30s";
    }
  }

  function shakeBox() {
    const lockBox = document.getElementById("lockBox");
    if (!lockBox) return;
    lockBox.style.animation = "none";
    lockBox.offsetHeight; // reflow
    lockBox.style.animation = "lockShake 0.4s ease";
    setTimeout(() => {
      lockBox.style.animation = "";
    }, 400);
  }

  function shakeInput(el) {
    el.style.animation = "none";
    el.offsetHeight;
    el.style.animation = "lockShake 0.3s ease";
    setTimeout(() => {
      el.style.animation = "";
    }, 300);
  }

  // ── WIRE CONTROLS ──
  unlockBtn.addEventListener("click", unlock);

  // Enter on either field moves to next or submits
  userIdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") passwordInput.focus();
  });
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlock();
  });

  // Focus user ID field on load
  setTimeout(() => userIdInput.focus(), 100);
});
