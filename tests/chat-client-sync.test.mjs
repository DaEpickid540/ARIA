// Run: npm test   (or node --test tests/chat-client-sync.test.mjs)
// The page side of chat sync (public/js/chat.js, a browser script with no
// exports): syncToServer and loadFromServer are pulled out of the source and
// run against a fake server, localStorage and network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../public/js/chat.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
function grab(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
}
const FUNCS = ["pendingDeletes", "setPendingDeletes", "syncToServer", "loadFromServer", "jsSafeId", "escapeHtml"];
const CODE = FUNCS.map(grab).join("\n");

/** A page: chat.js's sync functions plus the globals they use. */
function page(server, net = { up: true }) {
  const storage = new Map();
  const env = {
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    window: { ARIA_userId: "sarvin" },
    fetch: async (url, init) => {
      if (!net.up) throw new TypeError("Failed to fetch");
      if (url.startsWith("/api/saveChats")) {
        server.save(JSON.parse(init.body));
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url.startsWith("/api/loadChats")) return { ok: true, json: async () => server.load() };
      throw new Error("unexpected " + url);
    },
  };
  const make = new Function(
    "env",
    `const { localStorage, window, fetch } = env;
     let chats = [], currentChatId = null, isGenerating = false, _syncReady = Promise.resolve();
     const _synced = new Map();
     const chatSig = ({ updatedAt, ...rest }) => JSON.stringify(rest);
     const PENDING_DELETES_KEY = "aria_chat_pending_deletes";
     const saveChats = () => {}, renderChatList = () => {}, renderMessages = () => {}, createNewChat = () => {};
     const getDeviceId = () => "dev_test";
     ${CODE}
     return {
       get chats() { return chats; }, set chats(v) { chats = v; },
       syncToServer, loadFromServer, pendingDeletes, jsSafeId, escapeHtml,
       first: () => (_syncReady = loadFromServer({ first: true })),
     };`,
  );
  // Object.assign keeps the chats getter/setter live (a spread would copy
  // its value once).
  return Object.assign(make(env), { storage, net });
}

/** The server's merge, as far as these tests need it. */
function fakeServer() {
  const chats = new Map();
  const deleted = new Set();
  return {
    saves: 0,
    save({ chats: cs, deleted: ds }) {
      this.saves++;
      for (const d of ds) (chats.delete(d.id), deleted.add(d.id));
      for (const c of cs) if (!deleted.has(c.id) && (!chats.has(c.id) || c.updatedAt > chats.get(c.id).updatedAt)) chats.set(c.id, structuredClone(c));
    },
    load: () => ({ chats: [...chats.values()].map((c) => structuredClone(c)), deleted: [...deleted] }),
    chats,
    deleted,
  };
}

test("an edit made while offline is sent once the network is back", async () => {
  const server = fakeServer();
  const p = page(server);
  await p.first();
  p.chats = [{ id: "chat_1", title: "hi", messages: [] }];
  await p.syncToServer();
  assert.equal(server.chats.get("chat_1").title, "hi");

  p.net.up = false;
  p.chats[0].title = "edited offline";
  await p.syncToServer(); // fails
  assert.equal(server.chats.get("chat_1").title, "hi");

  p.net.up = true;
  await p.syncToServer(); // nothing changed since, but the edit is still unsent
  assert.equal(server.chats.get("chat_1").title, "edited offline");
});

test("a deletion made offline survives, and the server's copy can't bring it back", async () => {
  const server = fakeServer();
  const p = page(server);
  await p.first();
  p.chats = [{ id: "chat_1", title: "a", messages: [] }, { id: "chat_2", title: "b", messages: [] }];
  await p.syncToServer();

  p.net.up = false;
  p.chats = p.chats.filter((c) => c.id !== "chat_2");
  await p.syncToServer();
  assert.deepEqual(p.pendingDeletes().map((d) => d.id), ["chat_2"]);

  // Back online: a pull happens before the retry (reconnect order).
  p.net.up = true;
  await p.loadFromServer();
  assert.deepEqual(p.chats.map((c) => c.id), ["chat_1"], "server copy came back");
  await p.syncToServer();
  assert.equal(server.chats.has("chat_2"), false);
  assert.deepEqual(p.pendingDeletes(), []);
});

test("pending deletions persist across a reload (localStorage)", async () => {
  const server = fakeServer();
  server.chats.set("chat_9", { id: "chat_9", title: "x", messages: [], updatedAt: 1 });
  const p = page(server);
  await p.first();
  p.net.up = false;
  p.chats = [];
  await p.syncToServer();
  const stored = p.storage.get("aria_chat_pending_deletes");
  assert.match(stored, /chat_9/);
  // A fresh page with the same storage.
  const p2 = page(server);
  p2.storage.set("aria_chat_pending_deletes", stored);
  await p2.first();
  assert.equal(p2.chats.length, 0, "a reload must not resurrect it");
  await p2.syncToServer();
  assert.equal(server.chats.has("chat_9"), false);
});

test("two saves in the same millisecond both reach the server", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 }); // the clock stands still
  const server = fakeServer();
  const p = page(server);
  await p.first();
  p.chats = [{ id: "chat_1", title: "t", messages: [{ role: "aria", content: "bubble 1" }] }];
  await p.syncToServer();
  p.chats[0].messages.push({ role: "aria", content: "bubble 2" });
  await p.syncToServer();
  assert.equal(server.chats.get("chat_1").messages.length, 2);
});

test("nothing changed: no request at all", async () => {
  const server = fakeServer();
  const p = page(server);
  await p.first();
  await p.syncToServer();
  await p.syncToServer();
  assert.equal(server.saves, 0);
});

test("a newer copy from another device replaces ours on pull", async () => {
  const server = fakeServer();
  const p = page(server);
  await p.first();
  p.chats = [{ id: "chat_1", title: "mine", messages: [] }];
  await p.syncToServer();
  const theirs = { ...server.chats.get("chat_1"), title: "theirs", updatedAt: server.chats.get("chat_1").updatedAt + 10 };
  server.chats.set("chat_1", theirs);
  await p.loadFromServer();
  assert.equal(p.chats[0].title, "theirs");
});

test("jsSafeId keeps ARIA's ids and strips anything that could leave a quoted handler", () => {
  const { jsSafeId, escapeHtml } = page(fakeServer());
  assert.equal(jsSafeId("chat_1791756958971_sms"), "chat_1791756958971_sms");
  assert.equal(jsSafeId("x');alert(1);//"), "xalert1");
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;");
});
