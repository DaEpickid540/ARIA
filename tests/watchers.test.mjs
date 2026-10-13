// Run: npm test   (or node --test tests/watchers.test.mjs)
// lib/watchers.js with a fake page fetcher, a fake model and a fake GitHub:
// what counts as a target, when a check asks the model, when it alerts, and
// when a watcher gives up.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-watch-"));
const W = await import("../lib/watchers.js");

// ── fakes ──
let pages = {}; // url → text, or an Error to throw
let verdicts = []; // queued { met, summary } (or Error) for each model call
let aiCalls = 0;
let alerts = [];
let ghResponses = {};

function setup() {
  W._reset();
  fs.rmSync(path.join(process.env.ARIA_DATA_DIR, "watchers.json"), { force: true });
  pages = {};
  verdicts = [];
  aiCalls = 0;
  alerts = [];
  ghResponses = {};
  W.init(
    {
      fetchPage: async (url) => {
        const p = pages[url];
        if (p instanceof Error) return { ok: false, error: p.message };
        if (p == null) return { ok: false, error: "HTTP 404" };
        return { ok: true, title: `Title of ${url}`, text: p };
      },
      ai: async () => {
        aiCalls++;
        const v = verdicts.shift();
        if (v instanceof Error) throw v;
        if (!v) throw new Error("no verdict queued");
        return JSON.stringify(v);
      },
      notify: (a) => alerts.push(a),
      fetch: async (url) => {
        const body = ghResponses[url];
        if (body?.status) return { ok: false, status: body.status, headers: new Headers(body.headers || {}), json: async () => ({}) };
        if (!body) return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
        return { ok: true, status: 200, headers: new Headers(), json: async () => body };
      },
    },
    { start: false },
  );
}

const URL1 = "https://shop.example.com/item";

test("targets: URLs, GitHub links and owner/repo#N", () => {
  assert.deepEqual(W.parseTarget("https://github.com/DaEpickid540/ARIA/pull/7"), { kind: "github", repo: "DaEpickid540/ARIA", number: 7 });
  assert.deepEqual(W.parseTarget("github.com/a/b/issues/3"), { kind: "github", repo: "a/b", number: 3 });
  assert.deepEqual(W.parseTarget("DaEpickid540/ARIA#12"), { kind: "github", repo: "DaEpickid540/ARIA", number: 12 });
  assert.deepEqual(W.parseTarget("github nodejs/node"), { kind: "github", repo: "nodejs/node" });
  assert.deepEqual(W.parseTarget("https://github.com/nodejs/node"), { kind: "github", repo: "nodejs/node" });
  assert.deepEqual(W.parseTarget("example.com/blog"), { kind: "page", url: "https://example.com/blog" });
  assert.equal(W.parseTarget("https://x.com/a").kind, "page");
  assert.equal(W.parseTarget("not a target"), null);
  assert.equal(W.parseTarget("javascript:alert(1)"), null);
});

test("intervals: units, words, clamped to 5m…7d", () => {
  assert.equal(W.parseEvery("30m"), 30);
  assert.equal(W.parseEvery("2h"), 120);
  assert.equal(W.parseEvery("1 day"), 1440);
  assert.equal(W.parseEvery("hourly"), 60);
  assert.equal(W.parseEvery("1m"), 5);
  assert.equal(W.parseEvery("30d"), 7 * 1440);
  assert.equal(W.parseEvery("soon"), null);
});

test("tool input: condition and interval in either order, 'repeat' flag", () => {
  const a = W.parseWatchInput("https://x.com/p | price below $50 | every 2h");
  assert.equal(a.condition, "price below $50");
  assert.equal(a.everyMin, 120);
  const b = W.parseWatchInput("a/b#1 | 15m | it's merged | repeat");
  assert.equal(b.condition, "it's merged");
  assert.equal(b.everyMin, 15);
  assert.equal(b.repeat, true);
  const c = W.parseWatchInput("https://x.com | any change");
  assert.equal(c.condition, "");
  assert.throws(() => W.parseWatchInput("hello there"), /isn't a URL/);
});

test("private and local addresses are refused up front", async () => {
  setup();
  for (const t of ["http://127.0.0.1:3000/", "http://192.168.1.1/admin", "http://localhost/"])
    await assert.rejects(W.createWatcher({ target: t }), /public web pages/);
});

test("change watcher: baseline first, quiet when unchanged, alerts on a meaningful change only", async () => {
  setup();
  pages[URL1] = "Price: $80. In stock.";
  const { watcher, first } = await W.createWatcher({ target: URL1 });
  assert.equal(first.status, "baseline");
  assert.equal(aiCalls, 0, "nothing to compare against yet");

  // Same page: no model call.
  assert.equal((await W.checkWatcher(watcher.id)).status, "quiet");
  assert.equal(aiCalls, 0);

  // Changed, but the model says it's noise.
  pages[URL1] = "Price: $80. In stock. 12 people viewing";
  verdicts.push({ met: false, summary: "Only the viewer count changed." });
  assert.equal((await W.checkWatcher(watcher.id)).status, "changed-unmet");
  assert.equal(alerts.length, 0);

  pages[URL1] = "Price: $45. In stock.";
  verdicts.push({ met: true, summary: "The price dropped from $80 to $45." });
  assert.equal((await W.checkWatcher(watcher.id)).status, "met");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /\$45/);
  assert.equal(alerts[0].link, URL1);
  assert.equal(W.getWatcher(watcher.id).active, true, "change watchers keep going");
});

test("condition watcher: already true at creation → reported, not left running, no alert", async () => {
  setup();
  pages[URL1] = "Price: $40";
  verdicts.push({ met: true, summary: "It's $40, under $50." });
  const out = await W.runWatchTool("watch", `${URL1} | price under $50`);
  assert.match(out, /ALREADY true/);
  assert.equal(alerts.length, 0);
  assert.equal(W.listWatchers().length, 0, "nothing left to wait for, so it isn't kept");
});

test("condition watcher: false, then true once → one alert and it retires", async () => {
  setup();
  pages[URL1] = "Price: $80";
  verdicts.push({ met: false, summary: "Still $80." });
  const { watcher, first } = await W.createWatcher({ target: URL1, condition: "price under $50" });
  assert.equal(first.status, "baseline");
  assert.equal((await W.checkWatcher(watcher.id)).status, "quiet", "unchanged → no second question");
  pages[URL1] = "Price: $45";
  verdicts.push({ met: true, summary: "Now $45." });
  assert.equal((await W.checkWatcher(watcher.id)).status, "met");
  assert.equal(alerts.length, 1);
  assert.equal(W.getWatcher(watcher.id).active, false);
});

test("a model failure on a condition is retried next time instead of going quiet", async () => {
  setup();
  pages[URL1] = "Price: $80";
  verdicts.push(new Error("provider down"));
  const { watcher, first } = await W.createWatcher({ target: URL1, condition: "under $50" });
  assert.equal(first.status, "error");
  verdicts.push({ met: false, summary: "Still $80." });
  assert.equal((await W.checkWatcher(watcher.id)).status, "baseline", "asked again on the same page");
  assert.equal(aiCalls, 2);
});

test("five failed checks in a row: stops and says so once", async () => {
  setup();
  pages[URL1] = new Error("timed out");
  const { watcher } = await W.createWatcher({ target: URL1 });
  for (let i = 0; i < 4; i++) await W.checkWatcher(watcher.id);
  const w = W.getWatcher(watcher.id);
  assert.equal(w.active, false);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /Stopped watching/);
  // Resuming clears the failures.
  W.setActive(watcher.id, true);
  assert.equal(W.getWatcher(watcher.id).errors, 0);
});

test("GitHub PR snapshot: merge state reaches the judge", async () => {
  setup();
  const api = "https://api.github.com/repos/o/r";
  ghResponses[`${api}/issues/7`] = { title: "Add watchers", state: "open", comments: 2, labels: [], pull_request: {} };
  ghResponses[`${api}/pulls/7`] = { merged: false, draft: false, mergeable_state: "clean" };
  verdicts.push({ met: false, summary: "Open, not merged." });
  const { watcher } = await W.createWatcher({ target: "o/r#7", condition: "it's merged" });
  assert.equal(W.getWatcher(watcher.id).lastSummary, "o/r#7 isn't merged yet.");
  ghResponses[`${api}/issues/7`] = { ...ghResponses[`${api}/issues/7`], state: "closed", closed_at: "2026-10-12T10:00:00Z" };
  ghResponses[`${api}/pulls/7`] = { merged: true, merged_at: "2026-10-12T10:00:00Z", draft: false };
  verdicts.push({ met: true, summary: "PR #7 was merged." });
  assert.equal((await W.checkWatcher(watcher.id)).status, "met");
  assert.equal(alerts[0].link, "https://github.com/o/r/issues/7");
});

test("tick checks only what's due, and duplicates are refused", async () => {
  setup();
  pages[URL1] = "A";
  pages["https://b.example.com/"] = "B";
  const { watcher: a } = await W.createWatcher({ target: URL1, everyMin: 60 });
  await W.createWatcher({ target: "https://b.example.com/", everyMin: 5 });
  await assert.rejects(W.createWatcher({ target: URL1 }), /Already watching/);
  const before = W.getWatcher(a.id).checks;
  await W.tick(Date.now() + 6 * 60_000); // 6 minutes on: only the 5-minute one
  assert.equal(W.getWatcher(a.id).checks, before);
  assert.equal(W.listWatchers().find((w) => w.id !== a.id).checks, 2);
});

test("tool: list and stop; list shows no snapshot text", async () => {
  setup();
  pages[URL1] = "Headline\nsecret page body";
  await W.runWatchTool("watch", `${URL1} | every 1h`);
  const list = await W.runWatchTool("watch list", "");
  assert.match(list, /w1 \[watching\]/);
  assert.match(list, /every 1h/);
  assert.ok(!list.includes("secret page body"));
  assert.ok(!("lastText" in W.listWatchers()[0]));
  assert.match(await W.runWatchTool("watch stop", "w1"), /removed w1/);
  assert.equal(await W.runWatchTool("watch list", ""), "Not watching anything.");
});

test("watchers survive a restart (saved to the data folder)", async () => {
  setup();
  pages[URL1] = "A";
  await W.createWatcher({ target: URL1, condition: "" });
  W.flushSync();
  W._reset();
  W.init({ fetchPage: async () => ({ ok: true, text: "A" }), ai: async () => "{}", notify() {} }, { start: false });
  assert.equal(W.listWatchers().length, 1);
});

test("quick verdicts: PR merged/closed and quoted text need no model", async () => {
  const pr = { kind: "github", repo: "o/r", number: 7 };
  const open = { title: "o/r#7", text: "Pull request #7: x\nState: open\nMerged: no" };
  const done = { title: "o/r#7", text: "Pull request #7: x\nState: closed\nMerged: yes (2026-10-12)" };
  assert.equal(W.quickVerdict("it's merged", open, pr).met, false);
  assert.equal(W.quickVerdict("when it merges", done, pr).met, true);
  assert.equal(W.quickVerdict("it gets closed", done, pr).met, true);
  assert.equal(W.quickVerdict("someone approves it", done, pr), null, "anything else goes to the model");
  const page = { kind: "page", url: "https://x.com" };
  assert.equal(W.quickVerdict('says "In stock"', { text: "Status: in stock now" }, page).met, true);
  assert.equal(W.quickVerdict('no longer says "Sold out"', { text: "Sold out" }, page).met, false);
  assert.equal(W.quickVerdict('no longer says "Sold out"', { text: "Available" }, page).met, true);

  // And through a watcher, with no model at all.
  setup();
  const api = "https://api.github.com/repos/o/r";
  ghResponses[`${api}/issues/7`] = { title: "x", state: "open", comments: 0, labels: [], pull_request: {} };
  ghResponses[`${api}/pulls/7`] = { merged: false };
  const { watcher } = await W.createWatcher({ target: "o/r#7", condition: "it's merged" });
  ghResponses[`${api}/issues/7`].state = "closed";
  ghResponses[`${api}/pulls/7`] = { merged: true, merged_at: "2026-10-12" };
  assert.equal((await W.checkWatcher(watcher.id)).status, "met");
  assert.equal(aiCalls, 0);
  assert.equal(alerts.length, 1);
});

test("intervals written as words are intervals, not conditions", () => {
  for (const [p, min] of [["every hour", 60], ["every day", 1440], ["each week", 10080], ["twice a day", 720], ["once a day", 1440], ["every 2 hours", 120]]) {
    const w = W.parseWatchInput(`https://x.com | ${p}`);
    assert.equal(w.everyMin, min, p);
    assert.equal(w.condition, "", p);
  }
  assert.equal(W.parseEvery("price under 50"), null);
  assert.equal(W.parseEvery("50"), null, "a bare number isn't an interval");
});

test("GitHub pages that aren't a repo, PR or issue are watched as pages", () => {
  assert.equal(W.parseTarget("https://github.com/o/r/blob/main/CHANGELOG.md").kind, "page");
  assert.equal(W.parseTarget("https://github.com/orgs/x/repositories").kind, "page");
  assert.deepEqual(W.parseTarget("https://github.com/o/r/releases"), { kind: "github", repo: "o/r" });
  assert.deepEqual(W.parseTarget("https://github.com/o/r/pull/9/files"), { kind: "github", repo: "o/r", number: 9 });
});

test("the merge shortcut only answers 'is it merged', the model gets the rest", () => {
  const pr = { kind: "github", repo: "o/r", number: 7 };
  const snap = { title: "o/r#7", text: "State: open\nMerged: no" };
  for (const c of ["it has merge conflicts", "it's approved and ready to merge", "someone comments", "the merge is blocked"])
    assert.equal(W.quickVerdict(c, snap, pr), null, c);
  for (const c of ["it's merged", "when it merges", "the PR is merged", "merged", "once it gets merged"])
    assert.equal(W.quickVerdict(c, snap, pr)?.met, false, c);
  assert.equal(W.quickVerdict("merged or closed", { title: "x", text: "State: closed\nMerged: no" }, pr).met, true);
});

test("repeating condition: alerts when it turns true, not on every change while true", async () => {
  setup();
  pages[URL1] = "Price $80 ad1";
  verdicts.push({ met: false, summary: "$80" });
  const { watcher } = await W.createWatcher({ target: URL1, condition: "price below $50", repeat: true });
  pages[URL1] = "Price $45 ad2";
  verdicts.push({ met: true, summary: "$45" });
  await W.checkWatcher(watcher.id);
  for (const ad of ["ad3", "ad4"]) {
    pages[URL1] = `Price $45 ${ad}`;
    verdicts.push({ met: true, summary: "$45" });
    await W.checkWatcher(watcher.id);
  }
  assert.equal(alerts.length, 1, "still true: no more alerts");
  pages[URL1] = "Price $90 ad5";
  verdicts.push({ met: false, summary: "$90" });
  await W.checkWatcher(watcher.id);
  pages[URL1] = "Price $40 ad6";
  verdicts.push({ met: true, summary: "$40" });
  await W.checkWatcher(watcher.id);
  assert.equal(alerts.length, 2, "true again after going false");
  assert.equal(W.getWatcher(watcher.id).active, true);
});

test("model down: a change-watcher alerts once, not on every change", async () => {
  setup();
  pages[URL1] = "t=1";
  const { watcher } = await W.createWatcher({ target: URL1 });
  for (let i = 2; i < 6; i++) {
    pages[URL1] = `t=${i}`;
    verdicts.push(new Error("provider down"));
    await W.checkWatcher(watcher.id);
  }
  assert.equal(alerts.length, 1);
});

test("GitHub rate limit: not counted as a failure, everyone waits for the reset", async () => {
  setup();
  const api = "https://api.github.com/repos/o/r";
  const reset = Math.floor(Date.now() / 1000) + 600;
  ghResponses[`${api}/issues/1`] = { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } };
  const { watcher, first } = await W.createWatcher({ target: "o/r#1" });
  assert.match(first.summary, /rate limit/);
  for (let i = 0; i < 6; i++) await W.checkWatcher(watcher.id);
  const w = W.getWatcher(watcher.id);
  assert.equal(w.active, true, "rate limits never stop a watcher");
  assert.equal(w.errors, 0);
  assert.ok(w.nextCheck >= reset * 1000, "next check waits for the reset");
  // Another GitHub watcher doesn't spend a request while blocked.
  let calls = 0;
  const realFetch = ghResponses;
  ghResponses = new Proxy(realFetch, { get: (o, k) => (calls++, o[k]) });
  await W.createWatcher({ target: "o/other#2" });
  assert.equal(calls, 0);
  assert.equal(alerts.length, 0);
});

test("expiry says so, and finished watchers are cleared after two weeks", async () => {
  setup();
  pages[URL1] = "A";
  const { watcher } = await W.createWatcher({ target: URL1 });
  const w = W.getWatcher(watcher.id);
  await W.tick(w.expiresAt + 1);
  assert.equal(w.active, false);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /30 days/);
  assert.ok(!("lastText" in w), "no snapshot kept once stopped");
  await W.tick(w.stoppedAt + 15 * 24 * 3600_000);
  assert.equal(W.listWatchers().length, 0);
  // A watcher the user paused is theirs to delete.
  pages[URL1] = "B";
  const { watcher: p } = await W.createWatcher({ target: URL1 });
  W.setActive(p.id, false);
  await W.tick(Date.now() + 60 * 24 * 3600_000);
  assert.equal(W.listWatchers().length, 1);
});

test("two long URLs on one site aren't duplicates", async () => {
  setup();
  const long = "https://shop.example.com/" + "c/".repeat(40);
  pages[long + "item-a"] = "A";
  pages[long + "item-b"] = "B";
  await W.createWatcher({ target: long + "item-a" });
  await W.createWatcher({ target: long + "item-b" });
  assert.equal(W.listWatchers().length, 2);
});

test("creation reply reads cleanly", async () => {
  setup();
  pages[URL1] = "Big Sale\nmore";
  const out = await W.runWatchTool("watch", `${URL1} | every hour`);
  assert.match(out, /every 1h for any meaningful change\. Right now: Big Sale/);
  assert.ok(!/Right now: .*Right now/.test(out));
});

test("intervals ARIA can't do are refused, not judged as conditions", () => {
  for (const p of ["every 30 seconds", "every other day", "weekdays"])
    assert.throws(() => W.parseWatchInput(`https://x.com | ${p}`), /can't check/, p);
  assert.equal(W.parseWatchInput("https://x.com | every time it restocks").condition, "every time it restocks");
  assert.equal(W.quickVerdict("this PR is merged", { title: "x", text: "Merged: yes" }, { kind: "github", repo: "o/r", number: 1 }).met, true);
});

test("a change held back while the model is down still alerts after the gap", async () => {
  setup();
  pages[URL1] = "v1";
  const { watcher } = await W.createWatcher({ target: URL1 });
  pages[URL1] = "v2";
  verdicts.push(new Error("down"));
  await W.checkWatcher(watcher.id); // fallback alert #1
  pages[URL1] = "v3";
  verdicts.push(new Error("down"));
  await W.checkWatcher(watcher.id); // held back
  assert.equal(alerts.length, 1);
  W.getWatcher(watcher.id).lastFallbackAlert -= 7 * 3600_000; // the gap has passed
  verdicts.push({ met: true, summary: "v2 -> v3" }); // and the model is back
  assert.equal((await W.checkWatcher(watcher.id)).status, "met", "same page, but the change wasn't forgotten");
  assert.equal(alerts.length, 2);
});
