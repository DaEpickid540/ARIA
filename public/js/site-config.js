// site-config.js — where this copy of the page finds ARIA's server
//
// Served by an ARIA server (Render, npm start, the desktop app): nothing to
// set, since /api is on the same origin. `npm run build:web` overwrites this
// file in the static build for Firebase Hosting with the list of "brains"
// the page may use (see public/js/apiBase.js and scripts/build-web.js).
window.ARIA_SITE = null;
