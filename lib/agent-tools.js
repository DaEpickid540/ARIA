// lib/agent-tools.js — which tools a sub-agent may call
//
// A sub-agent runs the full tool loop without anyone watching, so what it
// can reach is decided per kind of agent, not once for all:
//
//   spawn      Research helpers ARIA briefs herself. They read arbitrary web
//              pages, so they get no private data (no calendar, no day) —
//              text a page plants could otherwise carry it out through
//              scrape's URL.
//   trigger    Answers a question the owner set up ("what's due today?").
//              It gets the owner's calendar and day, and so it gets no
//              scrape: nothing that fetches a URL of its choosing. It does
//              keep research, which reads pages the search engine picks; the
//              only thing it sends out is a search query, to the provider.
//              NEVER add a tool that takes a URL (or posts anywhere) here.
//
// Neither ever gets PC control, tasks, routines or more agents.

export const SPAWN_TOOLS = new Set(["research", "search", "scrape", "calc", "convert", "time", "weather", "news", "agent"]);
export const TRIGGER_TOOLS = new Set(["research", "search", "calc", "convert", "time", "weather", "news", "calendar", "debrief"]);

const SETS = { spawn: SPAWN_TOOLS, trigger: TRIGGER_TOOLS };

/** The tool set for a kind of sub-agent (spawn when unknown). */
export const toolsFor = (kind) => SETS[kind] || SPAWN_TOOLS;

/** Whether a sub-agent of `kind` may call `tool`. */
export const subAgentMay = (kind, tool) => toolsFor(kind).has(String(tool || "").toLowerCase().trim());
