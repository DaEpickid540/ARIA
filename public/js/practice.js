// practice.js — the Practice panel: a tuner, a metronome, a tempo check
// that listens to you play, and the practice log (lib/practice.js).
// The sums are in practiceAudio.js. Audio stays in this browser: the mic is
// read here and nothing is recorded or uploaded; only the log entry is sent.
// Closing the panel stops the mic and the metronome.

import { detectPitch, noteOf, detectOnsets, tempoFrom, tapTempo } from "./practiceAudio.js";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const toast = (msg, icon) => window.ARIA_showNotification?.(`${icon ? icon + " " : ""}${msg}`);
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── audio plumbing ──────────────────────────────────────────── */
let ctx = null;
const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

let mic = null; // { stream, source }
async function openMic() {
  if (mic) return mic;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the microphone here.");
  // Raw sound: echo cancelling and noise suppression bend pitch and eat note starts.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ac = audio();
  await ac.resume();
  mic = { stream, source: ac.createMediaStreamSource(stream) };
  return mic;
}
function closeMic() {
  mic?.stream.getTracks().forEach((t) => t.stop());
  mic?.source.disconnect();
  mic = null;
}

/* ── tuner ───────────────────────────────────────────────────── */
let tuner = null; // { analyser, raf, recent }
async function startTuner() {
  const { source } = await openMic();
  const analyser = audio().createAnalyser();
  analyser.fftSize = 4096; // ~93 ms: enough for a cello's low C
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  tuner = { analyser, raf: 0, recent: [], last: 0 };
  const tick = (t) => {
    if (!tuner) return;
    tuner.raf = requestAnimationFrame(tick);
    if (t - tuner.last < 60) return; // ~15 readings a second is plenty
    tuner.last = t;
    analyser.getFloatTimeDomainData(buf);
    const hz = detectPitch(buf, audio().sampleRate);
    if (hz) tuner.recent = [...tuner.recent.slice(-4), hz];
    else if (tuner.recent.length) tuner.recent.shift();
    showPitch();
  };
  tuner.raf = requestAnimationFrame(tick);
}
function stopTuner() {
  if (!tuner) return;
  cancelAnimationFrame(tuner.raf);
  tuner.analyser.disconnect();
  tuner = null;
  if (!checking) closeMic();
  showPitch();
}
function showPitch() {
  const el = $("tunerNote");
  if (!el) return;
  const a4 = Number($("tunerA4")?.value) || 440;
  const r = tuner?.recent || [];
  // The median of the last few readings: steady, and one wild one can't jump it.
  const hz = r.length >= 2 ? [...r].sort((a, b) => a - b)[Math.floor(r.length / 2)] : null;
  const n = hz ? noteOf(hz, a4) : null;
  el.textContent = n ? `${n.name}${n.octave}` : tuner ? "…" : "—";
  $("tunerHz").textContent = n ? `${hz.toFixed(1)} Hz · ${n.cents > 0 ? "+" : ""}${n.cents}¢` : tuner ? "play a note" : "";
  const needle = $("tunerNeedle");
  needle.style.left = `${50 + (n ? Math.max(-50, Math.min(50, n.cents)) : 0)}%`;
  needle.className = !n ? "" : Math.abs(n.cents) <= 5 ? "in" : Math.abs(n.cents) <= 15 ? "near" : "off";
  $("tunerBtn").textContent = tuner ? "Stop tuner" : "Start tuner";
}

/* ── metronome ───────────────────────────────────────────────── */
let metro = null; // { timer, next, beat }
const bpmNow = () => Math.max(20, Math.min(400, Number($("metroBpm")?.value) || 80));
function click(time, accent) {
  const ac = audio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.35, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(gain).connect(ac.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}
async function startMetro() {
  const ac = audio();
  await ac.resume();
  metro = { next: ac.currentTime + 0.1, beat: 0, timer: 0 };
  // Schedule a little ahead on the audio clock: timers drift, it doesn't.
  const schedule = () => {
    if (!metro) return;
    const perBar = Number($("metroBeats")?.value) || 4;
    while (metro.next < ac.currentTime + 0.15) {
      const accent = metro.beat % perBar === 0;
      click(metro.next, accent && perBar > 1);
      const at = metro.next;
      const beat = metro.beat % perBar;
      setTimeout(() => flash(beat), Math.max(0, (at - ac.currentTime) * 1000));
      metro.next += 60 / bpmNow();
      metro.beat++;
    }
  };
  schedule();
  metro.timer = setInterval(schedule, 25);
  $("metroBtn").textContent = "Stop";
}
function stopMetro() {
  if (!metro) return;
  clearInterval(metro.timer);
  metro = null;
  const b = $("metroBtn");
  if (b) b.textContent = "Start";
  flash(-1);
}
function flash(beat) {
  const dots = $("metroDots");
  if (!dots) return;
  const perBar = Number($("metroBeats")?.value) || 4;
  if (dots.children.length !== perBar) dots.innerHTML = "<i></i>".repeat(perBar);
  [...dots.children].forEach((d, i) => d.classList.toggle("on", i === beat));
}
let taps = [];
function onTap() {
  const now = performance.now();
  if (taps.length && now - taps.at(-1) > 2500) taps = []; // a pause starts over
  taps.push(now);
  const bpm = tapTempo(taps);
  if (bpm) setBpm(bpm);
}
function setBpm(v) {
  const b = Math.max(20, Math.min(400, Math.round(v)));
  $("metroBpm").value = b;
  $("metroSlider").value = b;
  store.set("aria_metro_bpm", b);
}

/* ── tempo check ─────────────────────────────────────────────── */
let checking = false;
async function tempoCheck() {
  if (checking) return;
  const secs = 12;
  const out = $("tempoOut");
  const btn = $("tempoBtn");
  const target = metro ? bpmNow() : Number($("metroBpm").value) || null;
  checking = true;
  btn.disabled = true;
  try {
    const { source } = await openMic();
    const ac = audio();
    // A ScriptProcessor is old but everywhere, and 12 s of mono is small.
    const proc = ac.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(proc);
    proc.connect(ac.destination); // some browsers only run it when connected
    for (let s = secs; s > 0; s--) {
      out.innerHTML = `<p class="watchHint">Listening… play at a steady tempo (${s}s)${metro ? ". The mic hears the metronome too, so use headphones" : ""}.</p>`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    proc.disconnect();
    source.disconnect(proc);
    const all = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of chunks) all.set(c, (o += c.length) - c.length);
    const r = tempoFrom(detectOnsets(all, ac.sampleRate), target);
    if (!r) {
      out.innerHTML = `<p class="watchErr">Heard too few clear notes. Play detached notes a bit louder, or get closer to the mic.</p>`;
    } else {
      const off = target ? r.bpm - target : 0;
      const verdict = [
        target ? (Math.abs(off) <= 2 ? `on tempo (${target})` : `${Math.abs(off)} ${off > 0 ? "faster" : "slower"} than ${target}`) : "",
        Math.abs(r.drift) >= 4 ? (r.drift > 0 ? `rushing (+${r.drift} by the end)` : `dragging (${r.drift} by the end)`) : "steady pace",
      ].filter(Boolean);
      out.innerHTML = `<div class="tempoResult"><b>${r.bpm} BPM</b> · steadiness <b>${r.steadiness}</b>/100 · ${r.notes} notes<br><span class="watchHint">${esc(verdict.join(" · "))}</span></div>`;
      $("logBpm").value ||= r.bpm;
    }
  } catch (e) {
    out.innerHTML = `<p class="watchErr">✗ ${esc(micError(e))}</p>`;
  } finally {
    checking = false;
    btn.disabled = false;
    if (!tuner) closeMic();
  }
}
const micError = (e) => (e?.name === "NotAllowedError" ? "Microphone blocked. Allow it for this site and try again." : e?.message || String(e));

/* ── session timer + log ─────────────────────────────────────── */
// Module state, so closing the panel mid-practice doesn't lose the time.
const timer = { startedAt: 0, banked: 0 };
const elapsedMin = () => Math.round((timer.banked + (timer.startedAt ? Date.now() - timer.startedAt : 0)) / 60000);
function showTimer() {
  const el = $("practiceTimer");
  if (!el) return;
  const ms = timer.banked + (timer.startedAt ? Date.now() - timer.startedAt : 0);
  const s = Math.floor(ms / 1000);
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  $("timerBtn").textContent = timer.startedAt ? "Pause" : ms ? "Resume" : "Start practising";
}
function toggleTimer() {
  if (timer.startedAt) {
    timer.banked += Date.now() - timer.startedAt;
    timer.startedAt = 0;
    const m = elapsedMin();
    if (m) $("logMinutes").value = m;
  } else timer.startedAt = Date.now();
  showTimer();
}

let _data = { sessions: [], summary: "", pieces: [] };
async function refresh() {
  try {
    _data = await api("/api/practice");
  } catch (e) {
    const el = $("practiceLog");
    if (el) el.innerHTML = `<p class="watchErr">Couldn't load the log: ${esc(e.message)}</p>`;
    return;
  }
  const list = $("practicePieces");
  if (list) list.innerHTML = _data.pieces.map((p) => `<option value="${esc(p.piece)}">`).join("");
  const el = $("practiceLog");
  if (!el) return;
  const st = _data.stats;
  el.innerHTML = !_data.sessions.length
    ? `<p class="watchEmpty">Nothing logged yet. Or tell ARIA: <i>"practised the Bach for 30 minutes at 72"</i>.</p>`
    : `<div class="practiceStats"><span><b>${st.todayMin}m</b> today</span><span><b>${st.weekMin}m</b> this week</span><span><b>${st.streak}</b>-day streak</span></div>` +
      _data.sessions
        .slice(0, 12)
        .map(
          (s) => `<div class="watchRow" data-id="${esc(s.id)}"><div class="watchMain">
            <div class="watchTitle">${esc(s.piece)} <span class="watchHint">${s.minutes}m${s.bpm ? ` · ${s.bpm} BPM` : ""}${s.instrument ? ` · ${esc(s.instrument)}` : ""}</span></div>
            <div class="watchMeta">${new Date(s.at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${s.note ? ` — ${esc(s.note)}` : ""}</div>
          </div><div class="watchBtns"><button class="memBtn" data-del="${esc(s.id)}" title="Delete">✕</button></div></div>`,
        )
        .join("");
}

async function onLog(e) {
  e.preventDefault();
  const f = e.target;
  const body = {
    piece: f.piece.value.trim(),
    minutes: f.minutes.value || elapsedMin(),
    bpm: f.bpm.value,
    instrument: f.instrument.value.trim(),
    note: f.note.value.trim(),
  };
  try {
    const { text } = await api("/api/practice", { method: "POST", body: JSON.stringify(body) });
    toast(text, "🎻");
    store.set("aria_practice_instrument", body.instrument);
    f.piece.value = "";
    f.note.value = "";
    f.minutes.value = "";
    f.bpm.value = "";
    timer.startedAt = 0;
    timer.banked = 0;
    showTimer();
  } catch (err) {
    return toast(err.message, "✗");
  }
  refresh();
}

/* ── the panel ───────────────────────────────────────────────── */
let watchClose = 0;
function stopAll() {
  stopTuner();
  stopMetro();
  closeMic();
  clearInterval(watchClose);
}

export function showPractice() {
  const show = window.ARIA_showQuickModal;
  if (!show) return;
  const a4 = store.get("aria_tuner_a4", "440");
  const bpm = store.get("aria_metro_bpm", "80");
  show(
    "Practice",
    `<div id="practicePanel">
      <section class="practiceBox">
        <div class="practiceHead">Tuner <label class="watchHint">A4 = <input id="tunerA4" type="number" min="415" max="466" value="${esc(a4)}" style="width:60px" /> Hz</label></div>
        <div class="tunerNote" id="tunerNote">—</div>
        <div class="tunerHz watchHint" id="tunerHz"></div>
        <div class="tunerScale"><span>−50¢</span><i id="tunerNeedle"></i><b></b><span>+50¢</span></div>
        <div class="watchFormRow"><button class="memBtn" id="tunerBtn">Start tuner</button></div>
      </section>
      <section class="practiceBox">
        <div class="practiceHead">Metronome</div>
        <div class="watchFormRow">
          <input id="metroBpm" type="number" min="20" max="400" value="${esc(bpm)}" style="width:70px" /> BPM
          <select id="metroBeats" title="Beats per bar">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === 4 ? "selected" : ""}>${n}</option>`).join("")}</select>
          <button class="memBtn" id="metroTap" title="Tap the beat">Tap</button>
          <button class="memBtn" id="metroBtn">Start</button>
        </div>
        <input id="metroSlider" type="range" min="30" max="240" value="${esc(bpm)}" style="width:100%" />
        <div id="metroDots" class="metroDots"></div>
      </section>
      <section class="practiceBox">
        <div class="practiceHead">Tempo check</div>
        <p class="watchHint">Listens for 12 seconds and tells you the tempo you actually played and how even it was (against the BPM above). Detached notes read best.</p>
        <div class="watchFormRow"><button class="memBtn" id="tempoBtn">Listen</button></div>
        <div id="tempoOut"></div>
      </section>
      <section class="practiceBox">
        <div class="practiceHead">Session <span class="practiceTimer" id="practiceTimer">0:00</span> <button class="memBtn" id="timerBtn">Start practising</button></div>
        <form id="practiceForm" class="watchForm" autocomplete="off">
          <div class="watchFormRow">
            <input name="piece" list="practicePieces" placeholder="Piece (or Scales, Technique…)" required maxlength="80" style="flex:1" />
            <input name="instrument" placeholder="Instrument" maxlength="30" value="${esc(store.get("aria_practice_instrument", ""))}" style="width:110px" />
          </div>
          <div class="watchFormRow">
            <input name="minutes" id="logMinutes" type="number" min="1" max="600" placeholder="min (timer)" style="width:100px" />
            <input name="bpm" id="logBpm" type="number" min="20" max="400" placeholder="BPM" style="width:80px" />
            <input name="note" placeholder="How it went (optional)" maxlength="300" style="flex:1" />
            <button type="submit" class="memBtn">Log it</button>
          </div>
          <datalist id="practicePieces"></datalist>
        </form>
        <div id="practiceLog"><p class="watchEmpty">Loading…</p></div>
      </section>
    </div>`,
  );
  $("tunerBtn").onclick = async () => {
    if (tuner) return stopTuner();
    try {
      await startTuner();
    } catch (e) {
      $("tunerHz").textContent = micError(e);
    }
  };
  $("tunerA4").onchange = (e) => store.set("aria_tuner_a4", e.target.value);
  $("metroBtn").onclick = () => (metro ? stopMetro() : startMetro());
  $("metroTap").onclick = onTap;
  $("metroBpm").onchange = (e) => setBpm(e.target.value);
  $("metroSlider").oninput = (e) => setBpm(e.target.value);
  $("metroBeats").onchange = () => flash(-1);
  $("tempoBtn").onclick = tempoCheck;
  $("timerBtn").onclick = toggleTimer;
  $("practiceForm").addEventListener("submit", onLog);
  $("practiceLog").addEventListener("click", async (e) => {
    const id = e.target.closest("button[data-del]")?.dataset.del;
    if (!id) return;
    try {
      await api(`/api/practice/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (err) {
      toast(err.message, "✗");
    }
    refresh();
  });
  flash(-1);
  showTimer();
  showPitch();
  refresh();
  // The quick modal has no close hook: stop the mic and clicks when the
  // panel is gone (closed, or replaced by another panel).
  clearInterval(watchClose);
  watchClose = setInterval(() => {
    const modal = document.getElementById("ariaQuickModal");
    if (!$("practicePanel") || modal?.style.display === "none") stopAll();
    else showTimer();
  }, 500);
}

export function initPractice() {
  window.ARIA_showPractice = showPractice;
  document.getElementById("tool_practice")?.addEventListener("click", () => {
    document.getElementById("toolsDropdown")?.style.setProperty("display", "none");
    showPractice();
  });
}
