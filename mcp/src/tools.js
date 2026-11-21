// tools.js — the MCP server: what Claude can see and do in ARIA.
//
// Every tool is one call to ARIA's REST API on Render, as the connected
// owner. ask_aria is the big one: it runs ARIA's whole pipeline (memory,
// research, Claw, the CLI agents…), so anything ARIA can do, Claude can ask
// for — and ARIA's own approvals still apply: an action that needs Sarvin's
// OK waits for it in the ARIA app, never here.
//
// Tools that remove something carry destructiveHint, so Claude asks first.

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { ToolError, idTokenFor, aria, readChat, cleanReply } from './aria.js';

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { ...WRITE, destructiveHint: true };

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const json = (v) => (typeof v === 'string' ? text(v) : text(JSON.stringify(v, null, 1)));

// A chat can run tools for minutes (research, CLI agents). Workers have no
// wall-clock limit while waiting on a fetch, but Claude gives up eventually.
const CHAT_MS = 5 * 60 * 1000;

const turn = z.object({ role: z.enum(['user', 'assistant']), content: z.string() });
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** Pulls `keys` off each object, so lists stay small enough to read. */
const pick = (list, keys) => (list || []).map((o) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]])));

export function buildServer(env, props) {
  const server = new McpServer(
    { name: 'aria', title: 'ARIA', version: '1.0.0' },
    {
      instructions: [
        'ARIA is Sarvin\'s own AI assistant, running on their server. It knows them (memory), keeps their reminders, journal, daily rings and background tasks, watches pages, and can control their PC and run Claude Code / Gemini CLI there.',
        'Use the specific tools for reading and changing ARIA\'s data. Use ask_aria to have ARIA itself do something (research, act on the PC, anything it has a tool for) or to ask what it thinks.',
        'ARIA does not see this conversation: give ask_aria a self-contained message, or pass the earlier turns of your ARIA thread as history.',
        'If ask_aria says an action is waiting for approval, tell the user to approve it in the ARIA app; you cannot approve it from here.',
        'Memory facts are addressed by index from list_memory; pass the fact text as expect when forgetting one so the wrong fact is never removed.',
      ].join(' '),
    },
  );

  /** Signs in as the owner, runs the handler, and turns expected failures
   *  into readable tool errors rather than protocol errors. */
  const tool = (fn) => async (args) => {
    try {
      const token = await idTokenFor(env, props);
      const call = (method, path, body, opts) => aria(env, token, method, path, body, opts);
      return json(await fn({ args, token, call }));
    } catch (err) {
      if (err instanceof ToolError) return { isError: true, content: [{ type: 'text', text: err.message }] };
      console.error('[aria-mcp]', err);
      return { isError: true, content: [{ type: 'text', text: `Something went wrong: ${err.message || err}` }] };
    }
  };

  // ── Talk to ARIA ────────────────────────────────────────────────────────

  server.registerTool('ask_aria', {
    title: 'Ask ARIA',
    description: 'Send ARIA a message and get its reply. ARIA runs its own tools as needed (web research, PC control through Claw, Claude Code / Gemini CLI on the PC, reminders, memory…). Can take from seconds to a few minutes. Actions ARIA considers sensitive wait for approval in the ARIA app.',
    inputSchema: z.object({
      message: z.string().min(1).max(8000).describe('What to say to ARIA. Self-contained: ARIA can\'t see this conversation.'),
      history: z.array(turn).max(20).optional().describe('Earlier turns of this ARIA thread, oldest first, to continue it.'),
      deep_think: z.boolean().optional().describe('Ask ARIA to reason longer.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, tool(async ({ args, call }) => {
    const res = await call('POST', '/api/chat', {
      message: args.message,
      history: args.history || [],
      deepThink: !!args.deep_think,
      chatId: 'mcp_claude',
      // One JSON answer instead of a token stream (server.js, "SSE STREAMING").
    }, { raw: true, timeoutMs: CHAT_MS, headers: { 'X-No-Stream': '1' } });
    const { reply, confirm, steps } = await readChat(res);
    const tools = (steps || []).map((s) => s.tool).filter(Boolean);
    const lines = [cleanReply(reply) || '(ARIA gave an empty reply.)'];
    if (confirm) lines.push(`\n[Waiting for approval in the ARIA app: ${confirm.action}${confirm.reason ? ` — ${confirm.reason}` : ''}]`);
    if (tools.length) lines.push(`\n[ARIA used: ${[...new Set(tools)].join(', ')}]`);
    return lines.join('\n');
  }));

  server.registerTool('aria_status', {
    title: 'ARIA status',
    description: 'ARIA\'s status report: what needs attention today (reminders, rings, tasks, alerts), and the health of the server, PC relay and models.',
    inputSchema: z.object({}),
    annotations: READ,
  }, tool(async ({ call }) => {
    const [report, claw, cli] = await Promise.all([
      call('GET', '/api/hud/report'),
      call('GET', '/api/claw/status').catch(() => null),
      call('GET', '/api/cli/status').catch(() => null),
    ]);
    const pc = claw
      ? claw.disabled ? 'PC control: disabled on this server'
        : claw.killed ? 'PC control: killed (resume in the Claw panel)'
        : claw.relays?.length ? `PC relay: ${claw.relays.map((r) => r.hostname).join(', ')}` : 'PC relay: not connected'
      : null;
    const agents = cli?.agents ? Object.entries(cli.agents).filter(([, v]) => v).map(([k]) => k) : [];
    return [report.text, pc, cli ? `CLI agents on the PC: ${agents.join(', ') || 'none connected'}` : null,
      claw?.pendingConfirms?.length ? `Waiting for approval: ${claw.pendingConfirms.map((c) => c.action).join('; ')}` : null]
      .filter(Boolean).join('\n');
  }));

  server.registerTool('search_aria', {
    title: 'Search ARIA',
    description: 'Search everything ARIA keeps — past chats, memory, journal, reminders, tasks, notes — for a phrase.',
    inputSchema: z.object({
      query: z.string().min(2).max(200),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    annotations: READ,
  }, tool(async ({ args, call }) => {
    const q = new URLSearchParams({ q: args.query, limit: String(args.limit || 15) });
    const d = await call('GET', `/api/search?${q}`);
    return d.hits?.length ? d.hits : `Nothing found for "${args.query}".`;
  }));

  // ── Memory ──────────────────────────────────────────────────────────────

  server.registerTool('list_memory', {
    title: 'List memory',
    description: 'The facts ARIA remembers about Sarvin, with their index (used by forget_memory).',
    inputSchema: z.object({}),
    annotations: READ,
  }, tool(async ({ call }) => {
    const d = await call('GET', '/api/memory');
    const facts = (d.facts || []).map((fact, index) => ({ index, fact }));
    return facts.length ? facts : 'ARIA has no saved facts yet.';
  }));

  server.registerTool('remember', {
    title: 'Remember a fact',
    description: 'Save a lasting fact about Sarvin to ARIA\'s memory (preferences, people, ongoing things). Duplicates are ignored.',
    inputSchema: z.object({ fact: z.string().min(3).max(300) }),
    annotations: WRITE,
  }, tool(async ({ args, call }) => {
    const before = (await call('GET', '/api/memory')).facts?.length || 0;
    const d = await call('POST', '/api/memory', { action: 'add', fact: args.fact });
    return d.facts?.length > before ? `Remembered: ${args.fact}` : 'ARIA already knew that (or it was too short to keep).';
  }));

  server.registerTool('forget_memory', {
    title: 'Forget a fact',
    description: 'Remove one fact from ARIA\'s memory. Cannot be undone.',
    inputSchema: z.object({
      index: z.number().int().min(0).describe('From list_memory.'),
      expect: z.string().describe('The fact\'s text, exactly as list_memory showed it.'),
    }),
    annotations: DESTRUCTIVE,
  }, tool(async ({ args, call }) => {
    await call('POST', '/api/memory/forget', { index: args.index, expect: args.expect });
    return `Forgot: ${args.expect}`;
  }));

  // ── Reminders ───────────────────────────────────────────────────────────

  server.registerTool('list_reminders', {
    title: 'List reminders',
    description: 'Upcoming reminders, with when they fire and whether they repeat.',
    inputSchema: z.object({}),
    annotations: READ,
  }, tool(async ({ call }) => {
    const d = await call('GET', '/api/reminders');
    return d.reminders?.length ? pick(d.reminders, ['id', 'text', 'when', 'repeats']) : 'No reminders set.';
  }));

  server.registerTool('add_reminder', {
    title: 'Add a reminder',
    description: 'Set a reminder. ARIA pings Sarvin at that time (and texts, if they have that on).',
    inputSchema: z.object({
      when: z.string().min(1).describe('Natural language, as ARIA understands it: "in 20 minutes", "tomorrow at 7am", "every weekday at 3:30pm".'),
      text: z.string().min(1).max(300),
    }),
    annotations: WRITE,
  }, tool(async ({ args, call }) => (await call('POST', '/api/reminders', { when: args.when, text: args.text })).text));

  server.registerTool('delete_reminder', {
    title: 'Delete a reminder',
    description: 'Cancel a reminder by id (from list_reminders).',
    inputSchema: z.object({ id: z.string().min(1) }),
    annotations: DESTRUCTIVE,
  }, tool(async ({ args, call }) => {
    await call('DELETE', `/api/reminders/${encodeURIComponent(args.id)}`);
    return 'Reminder deleted.';
  }));

  // ── Journal & daily rings ───────────────────────────────────────────────

  server.registerTool('get_journal', {
    title: 'Get journal',
    description: 'Recent journal entries (one a day: a 1-5 mood and a note) and mood stats. With query, only entries mentioning it.',
    inputSchema: z.object({ query: z.string().max(100).optional() }),
    annotations: READ,
  }, tool(async ({ args, call }) => call('GET', `/api/journal${args.query ? `?q=${encodeURIComponent(args.query)}` : ''}`)));

  server.registerTool('write_journal', {
    title: 'Write journal entry',
    description: 'Write or update a day\'s journal entry. Only the fields given change. Write in Sarvin\'s words; don\'t invent a mood.',
    inputSchema: z.object({
      day: dayKey.optional().describe('Defaults to today.'),
      mood: z.number().int().min(1).max(5).nullable().optional().describe('1-5; null clears it.'),
      note: z.string().max(5000).optional(),
      append: z.boolean().optional().describe('Add the note to the end of the day\'s note instead of replacing it.'),
    }),
    annotations: WRITE,
  }, tool(async ({ args, call }) => {
    const d = await call('POST', '/api/journal', args);
    return `Saved ${d.saved?.day || d.saved || args.day || 'today'}.`;
  }));

  server.registerTool('list_rings', {
    title: 'List daily rings',
    description: 'Daily habits ("rings"): today\'s progress toward each target and the streaks.',
    inputSchema: z.object({}),
    annotations: READ,
  }, tool(async ({ call }) => call('GET', '/api/habits')));

  server.registerTool('check_ring', {
    title: 'Check in a ring',
    description: 'Log progress on a daily ring: add an amount (negative takes it back), or toggle it closed/open.',
    inputSchema: z.object({
      id: z.string().min(1).describe('From list_rings.'),
      amount: z.number().optional(),
      toggle: z.boolean().optional(),
    }),
    annotations: WRITE,
  }, tool(async ({ args, call }) => {
    await call('POST', `/api/habits/${encodeURIComponent(args.id)}/check`, args.toggle ? { toggle: true } : { amount: args.amount ?? 1 });
    return 'Logged.';
  }));

  // ── Background tasks & watchers ─────────────────────────────────────────

  server.registerTool('list_tasks', {
    title: 'List background tasks',
    description: 'ARIA\'s background tasks (multi-step jobs it runs on its own) and their status.',
    inputSchema: z.object({ status: z.string().optional().describe('e.g. running, done, failed, pending.') }),
    annotations: READ,
  }, tool(async ({ args, call }) => {
    const d = await call('GET', `/api/tasks${args.status ? `?status=${encodeURIComponent(args.status)}` : ''}`);
    return d.tasks?.length ? pick(d.tasks.slice(-20), ['id', 'title', 'status', 'progress', 'result', 'error', 'createdAt']) : 'No background tasks.';
  }));

  server.registerTool('create_task', {
    title: 'Create a background task',
    description: 'Queue a long multi-step job for ARIA to plan and run on its own (minutes, not one reply). Results show in ARIA\'s task panel.',
    inputSchema: z.object({
      description: z.string().min(5).max(4000).describe('The whole brief: what to do and what it should produce.'),
      title: z.string().max(120).optional(),
    }),
    annotations: WRITE,
  }, tool(async ({ args, call }) => {
    const d = await call('POST', '/api/tasks/create', { description: args.description, title: args.title });
    return { queued: pick([d.task], ['id', 'title', 'status'])[0] };
  }));

  server.registerTool('list_watchers', {
    title: 'List watchers',
    description: 'Pages, prices and GitHub PRs ARIA is watching, and what it last saw.',
    inputSchema: z.object({}),
    annotations: READ,
  }, tool(async ({ call }) => {
    const d = await call('GET', '/api/watchers');
    return d.watchers?.length ? d.watchers : 'Not watching anything.';
  }));

  server.registerTool('add_watcher', {
    title: 'Watch something',
    description: 'Have ARIA watch a public page, price, or GitHub PR/issue/repo and alert Sarvin when it changes or a condition comes true.',
    inputSchema: z.object({
      target: z.string().min(1).describe('A URL, owner/repo#N, or owner/repo.'),
      condition: z.string().max(300).optional().describe('In plain words, e.g. "the price drops below $50". Leave out for any change.'),
      every: z.string().optional().describe('How often, e.g. "30m", "2h", "1d". 5m minimum.'),
      repeat: z.boolean().optional().describe('Keep alerting each time it comes true, instead of once.'),
    }),
    annotations: { ...WRITE, openWorldHint: true },
  }, tool(async ({ args, call }) => call('POST', '/api/watchers', args)));

  return server;
}
