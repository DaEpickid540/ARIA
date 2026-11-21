// End-to-end tests for the MCP tools: a real MCP client talking to the real
// server (src/tools.js) over an in-memory transport. Only the network is
// faked: Firebase's token exchange and ARIA's REST API.
//
//   npm test                         (fake ARIA)
//   ARIA_LIVE=http://localhost:3000 npm test   (also against a running local ARIA)

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { buildServer } from '../src/tools.js';
import { cleanReply } from '../src/aria.js';

const REAL_FETCH = globalThis.fetch;
const ARIA = 'https://aria.test';
const env = { ARIA_URL: ARIA, FIREBASE_API_KEY: 'k', FIREBASE_PROJECT: 'p' };
const props = { uid: 'u1', email: 'me@example.com', refreshToken: 'rt' };

// ── Fake network ─────────────────────────────────────────────────────────────

let calls;
let memory;
let chatReply; // (body) => Response
let owner;

function reply(body, status = 200, type = 'application/json') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

beforeEach(() => {
  calls = [];
  memory = ['Plays viola'];
  owner = true;
  chatReply = () => reply({ reply: '<think>hm</think>Hello from ARIA', steps: [{ tool: 'research' }] });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'securetoken.googleapis.com')
      return reply({ id_token: 'idtok', user_id: 'u1', expires_in: '3600' });
    assert.equal(url.origin, ARIA, 'only ARIA is called');
    const auth = new Headers(init.headers).get('Authorization');
    calls.push({ method: init.method || 'GET', path: url.pathname + url.search, auth, body: init.body ? JSON.parse(init.body) : null, headers: new Headers(init.headers) });
    if (!owner) return reply({ error: 'not_owner', message: 'Not an owner.' }, 403);
    const p = url.pathname;
    if (p === '/api/chat') return chatReply(JSON.parse(init.body));
    if (p === '/api/memory' && init.method === 'POST') {
      const b = JSON.parse(init.body);
      if (b.action === 'add' && !memory.includes(b.fact)) memory.push(b.fact);
      return reply({ success: true, facts: memory });
    }
    if (p === '/api/memory') return reply({ facts: memory, meta: {} });
    if (p === '/api/memory/forget') {
      const b = JSON.parse(init.body);
      if (memory[b.index] !== b.expect) return reply({ error: 'That memory changed since you loaded it.' }, 409);
      memory.splice(b.index, 1);
      return reply({ ok: true });
    }
    if (p === '/api/reminders' && init.method === 'POST') return reply({ ok: true, text: `"${JSON.parse(init.body).text}" tomorrow at 7:00 AM` });
    if (p === '/api/hud/report') return reply({ text: 'All clear.' });
    if (p === '/api/claw/status') return reply({ killed: false, disabled: false, relays: [{ hostname: 'SarvinsPC' }], pendingConfirms: [] });
    if (p === '/api/cli/status') return reply({ connected: true, agents: { claude: { hostname: 'SarvinsPC' }, gemini: null } });
    return reply({ error: 'not found' }, 404);
  };
});

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = buildServer(env, props);
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return client;
}

const textOf = (r) => r.content.map((c) => c.text).join('\n');

// ── Tests ────────────────────────────────────────────────────────────────────

test('lists the tools, with destructive ones marked', async () => {
  const c = await connect();
  const { tools } = await c.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['ask_aria', 'aria_status', 'list_memory', 'remember', 'forget_memory', 'add_reminder', 'search_aria'])
    assert.ok(names.includes(n), n);
  const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name).sort();
  assert.deepEqual(destructive, ['delete_reminder', 'forget_memory']);
});

test('ask_aria calls ARIA as the owner, without streaming, and cleans the reply', async () => {
  const c = await connect();
  const r = await c.callTool({ name: 'ask_aria', arguments: { message: 'hi' } });
  assert.equal(r.isError, undefined);
  assert.match(textOf(r), /^Hello from ARIA/);
  assert.doesNotMatch(textOf(r), /think/);
  assert.match(textOf(r), /ARIA used: research/);
  const chat = calls.find((x) => x.path === '/api/chat');
  assert.equal(chat.auth, 'Bearer idtok');
  assert.equal(chat.headers.get('X-No-Stream'), '1');
  assert.deepEqual(chat.body.history, []);
});

test('ask_aria reads a streamed answer too, and says when approval is pending', async () => {
  chatReply = () => reply(
    'data: {"stream_start":true}\n\ndata: {"delta":"Need"}\n\n' +
    'data: {"done":true,"full":"Needs your OK.\\nACTION: claw | shell: rm x","confirm":{"action":"shell: rm x","reason":"looks destructive"}}\n\n',
    200, 'text/event-stream');
  const c = await connect();
  const r = await c.callTool({ name: 'ask_aria', arguments: { message: 'clean up' } });
  const t = textOf(r);
  assert.match(t, /^Needs your OK\./);
  assert.doesNotMatch(t, /ACTION:/);
  assert.match(t, /Waiting for approval in the ARIA app: shell: rm x — looks destructive/);
});

test('a non-owner gets a readable tool error, not a crash', async () => {
  owner = false;
  const c = await connect();
  const r = await c.callTool({ name: 'list_memory', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /Not an owner/);
});

test('memory: list, remember (deduped), forget only the expected fact', async () => {
  const c = await connect();
  assert.match(textOf(await c.callTool({ name: 'list_memory', arguments: {} })), /"index": 0,\s*"fact": "Plays viola"/);
  assert.match(textOf(await c.callTool({ name: 'remember', arguments: { fact: 'Likes chess' } })), /Remembered/);
  assert.match(textOf(await c.callTool({ name: 'remember', arguments: { fact: 'Likes chess' } })), /already knew/);
  const wrong = await c.callTool({ name: 'forget_memory', arguments: { index: 0, expect: 'Likes chess' } });
  assert.equal(wrong.isError, true);
  assert.deepEqual(memory, ['Plays viola', 'Likes chess']);
  await c.callTool({ name: 'forget_memory', arguments: { index: 1, expect: 'Likes chess' } });
  assert.deepEqual(memory, ['Plays viola']);
});

test('aria_status joins the report with PC and CLI state', async () => {
  const c = await connect();
  const t = textOf(await c.callTool({ name: 'aria_status', arguments: {} }));
  assert.match(t, /All clear\./);
  assert.match(t, /PC relay: SarvinsPC/);
  assert.match(t, /CLI agents on the PC: claude/);
});

test('add_reminder passes ARIA\'s confirmation through', async () => {
  const c = await connect();
  const t = textOf(await c.callTool({ name: 'add_reminder', arguments: { when: 'tomorrow at 7am', text: 'Practice' } }));
  assert.equal(t, '"Practice" tomorrow at 7:00 AM');
});

test('cleanReply strips think blocks, ACTION lines and message tags', () => {
  assert.equal(cleanReply('<think>x</think><message>Hi</message>\nACTION: time | now\n<message>There</message>'), 'Hi\n\nThere');
});

// Optional: the same tools against a real ARIA running locally (no login).
if (process.env.ARIA_LIVE) {
  test('live: aria_status and list_memory against a real ARIA', async () => {
    const live = process.env.ARIA_LIVE.replace(/\/+$/, '');
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'securetoken.googleapis.com') return reply({ id_token: 'local', user_id: 'u1', expires_in: '3600' });
      return REAL_FETCH(live + url.pathname + url.search, init);
    };
    const c = await connect();
    const s = await c.callTool({ name: 'aria_status', arguments: {} });
    assert.equal(s.isError, undefined, textOf(s));
    console.log(textOf(s));
    const m = await c.callTool({ name: 'list_memory', arguments: {} });
    assert.equal(m.isError, undefined, textOf(m));
  });
}
