// desktop/preload.cjs — the only part of Electron ARIA's page can see.
//
// `window.ariaDesktop` existing is how the page knows it runs in the desktop
// app (the proxvocx pattern: one page, and the host lights up what it can
// do). Every call is a fixed message to a named handler in main.js; nothing
// here takes a path, a command or a function from the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ariaDesktop", {
  /** PC control (the Claw relay): is it on? */
  getClaw: () => ipcRenderer.invoke("aria:getClaw"),
  /** Turn PC control on or off. Resolves the new state. */
  setClaw: (on) => ipcRenderer.invoke("aria:setClaw", !!on),
});
