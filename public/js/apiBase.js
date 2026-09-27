// apiBase.js — lets ARIA's page run from a static host (Firebase Hosting)
//
// A classic script loaded first in <head>, before anything calls the API.
// Served by an ARIA server, it does nothing: /api is same-origin.
//
// On the Firebase site there is no server behind /api, so this picks a
// "brain" from window.ARIA_SITE.brains (site-config.js), in order: your PC's
// desktop app when it answers, otherwise the cloud (Render). Your choice
// from the lock screen is remembered. Then every fetch("/api/…") and
// EventSource("/api/…") in the app goes there, carrying your Firebase ID
// token: as a Bearer header, or ?access_token= for EventSource, which can't
// set headers. Cookies aren't used: they wouldn't cross sites reliably.
(function () {
  const site = window.ARIA_SITE;
  if (!site || !Array.isArray(site.brains) || !site.brains.length) return;

  const PREF = "aria_brain"; // base URL, or absent for automatic
  const origFetch = window.fetch.bind(window);
  const OrigES = window.EventSource;
  let current = null;
  let lastToken = null;

  const readPref = () => {
    try {
      return localStorage.getItem(PREF);
    } catch {
      return null;
    }
  };

  async function reachable(b) {
    try {
      const r = await origFetch(`${b.url}/api/health`, { signal: AbortSignal.timeout(2500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  const ready = (async () => {
    const pref = readPref();
    const picked = site.brains.find((b) => b.url === pref);
    if (picked) return (current = picked); // chosen by hand: use it even if down
    for (const b of site.brains) if (await reachable(b)) return (current = b);
    return (current = site.brains[site.brains.length - 1]);
  })();

  async function token() {
    try {
      lastToken = (await window.ARIA_getIdToken?.()) || null;
    } catch {
      lastToken = null;
    }
    return lastToken;
  }

  const apiPath = (input) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : null;
    return u && u.startsWith("/api/") ? u : null;
  };

  window.fetch = async (input, init = {}) => {
    const path = apiPath(input);
    if (!path) return origFetch(input, init);
    const b = await ready;
    const headers = new Headers(init.headers || {});
    const t = await token();
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
    return origFetch(b.url + path, { ...init, headers, mode: "cors", credentials: "omit" });
  };

  function RoutedEventSource(url, cfg) {
    const path = apiPath(url);
    if (!path || !current) return new OrigES(url, cfg);
    const u = new URL(current.url + path);
    if (lastToken) u.searchParams.set("access_token", lastToken);
    return new OrigES(u.href, cfg);
  }
  RoutedEventSource.prototype = OrigES.prototype;
  Object.assign(RoutedEventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
  window.EventSource = RoutedEventSource;

  window.ARIA_brain = {
    ready,
    list: site.brains,
    get current() {
      return current;
    },
    /** Pin a brain (or null for automatic) and reload into it. */
    choose(url) {
      try {
        if (url) localStorage.setItem(PREF, url);
        else localStorage.removeItem(PREF);
      } catch {}
      location.reload();
    },
    get pinned() {
      return !!readPref();
    },
  };
})();
