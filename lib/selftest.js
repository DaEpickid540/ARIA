// lib/selftest.js — "ARIA, check yourself": runs a list of checks (each
// model provider, the relays, sync, storage, scheduled jobs, recent errors,
// and optionally the test suite) and says plainly what's broken
// ═══════════════════════════════════════════════════════════════════
//
// A check is { id, group, name, run: async () => ({ status, detail, fix? }) }
// with status "ok" | "warn" | "fail" | "off" (not set up, nothing wrong).
// Checks run at once, each with its own time limit, so one hung provider
// can't stall the report. server.js builds the list (it knows the state);
// this file runs it and words the result.
// ═══════════════════════════════════════════════════════════════════

import { spawn } from "child_process";

export const STATUS_ICON = { ok: "✓", warn: "⚠", fail: "✗", off: "○" };

/** Runs the checks in parallel; a check that throws or takes too long fails, with the reason. */
export async function runChecks(checks, { timeoutMs = 20_000 } = {}) {
  return Promise.all(
    checks.map(async (c) => {
      const started = Date.now();
      let timer;
      try {
        const r = await Promise.race([
          Promise.resolve().then(() => c.run()),
          new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer in ${Math.round((c.timeoutMs || timeoutMs) / 1000)}s`)), c.timeoutMs || timeoutMs))),
        ]);
        const status = ["ok", "warn", "fail", "off"].includes(r?.status) ? r.status : "fail";
        return { id: c.id, group: c.group, name: c.name, status, detail: String(r?.detail || "").slice(0, 400), ...(r?.fix ? { fix: String(r.fix).slice(0, 300) } : {}), ms: Date.now() - started };
      } catch (e) {
        return { id: c.id, group: c.group, name: c.name, status: "fail", detail: String(e?.message || e).slice(0, 400), ...(c.fix ? { fix: c.fix } : {}), ms: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

/** The report in words: the headline, then what's wrong first. */
export function summarize(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const fail = count("fail");
  const warn = count("warn");
  const head = fail
    ? `✗ ${fail} thing${fail === 1 ? "" : "s"} broken${warn ? `, ${warn} to look at` : ""} (${count("ok")} fine).`
    : warn
      ? `⚠ Working, with ${warn} thing${warn === 1 ? "" : "s"} to look at (${count("ok")} fine).`
      : `✓ All ${count("ok")} checks passed.`;
  const order = { fail: 0, warn: 1, ok: 2, off: 3 };
  const lines = [...results]
    .sort((a, b) => order[a.status] - order[b.status])
    .map((r) => `${STATUS_ICON[r.status]} ${r.group} · ${r.name}: ${r.detail}${r.fix && r.status !== "ok" ? ` → ${r.fix}` : ""}`);
  return [head, ...lines].join("\n");
}

/**
 * Pass/fail counts and the failing tests' names from `node --test` output
 * (the spec reporter: "ℹ pass 12", "✖ name (3ms)").
 */
export function parseTestOutput(text) {
  const t = String(text || "");
  const num = (k) => {
    const m = t.match(new RegExp(`^\\s*ℹ ${k} (\\d+)`, "m"));
    return m ? +m[1] : null;
  };
  const failing = [];
  // Failing tests are listed again under "✖ failing tests:"; take that list when it's there.
  const tail = t.includes("✖ failing tests:") ? t.slice(t.indexOf("✖ failing tests:")) : t;
  for (const m of tail.matchAll(/^\s*✖ (.+?) \(\d+(?:\.\d+)?m?s\)\s*$/gm)) if (!failing.includes(m[1])) failing.push(m[1]);
  return { tests: num("tests"), pass: num("pass"), fail: num("fail"), failing };
}

/** Runs `node --test` in `cwd`; resolves its parsed output (never rejects). */
export function runTestSuite(cwd, { timeoutMs = 240_000, nodePath = process.execPath, env = process.env } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    // The suite starts servers of its own, on their own ports and data folders.
    // In the desktop app the server runs inside Electron, whose binary is
    // only Node with ELECTRON_RUN_AS_NODE set.
    const child = spawn(nodePath, ["--test", "tests/**/*.test.mjs"], {
      cwd,
      env: { ...env, ARIA_DESKTOP: "", PORT: "", ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...parseTestOutput(out), ...extra });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ error: `stopped after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => finish({ error: e.message }));
    child.on("close", (code) => finish({ code }));
  });
}
