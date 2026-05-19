# ARIA — Adaptive Reasoning Intelligence Architecture

A personal AI OS with chat, voice, memory, tool use, and remote PC control.

## What's in this repo

| Component | What it is | Where |
|---|---|---|
| **ARIA server** | Express server, AI routing, memory, agentic tools | `server.js` |
| **Tools** | Calc, weather, notes, todo, timer, search, news, calendar… | `tools/index.js` |
| **Web UI** | Cyberpunk front-end (chat, voice, settings, claw panel) | `public/` |
| **Claw Relay (PC)** | Runs on your computer; lets ARIA control keyboard/mouse | `claw-relay.js` |
| **ESP32 Relay** | Same as above but over BLE HID for Chromebooks/sandboxed devices | `ARIA_ESP32__Relay/` |
| **Screenshot Watcher** | Companion script for ESP32 to enable vision on a Chromebook | `aria-screenshot-watcher.js` |

## Quick start

```bash
git clone https://github.com/DaEpickid540/ARIA.git
cd ARIA
npm install
cp .env.example .env  # fill in at least one provider key
npm start
```

Then open `http://localhost:3000`.

## Required environment variables

At minimum you need one AI provider. See `.env.example` for the full list.

| Key | Required? | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | recommended | Default chat model |
| `GROQ_API_KEY` | optional | Fast inference |
| `OPENAI_KEY` | optional | DALL-E image generation |
| `CLOUDFLARE_AI_API` + `CLOUDFLARE_ACCOUNT_ID` | optional | FLUX image gen |
| `NEWSDATA_KEY` | optional | Live news headlines |

## Claw (remote PC control)

Claw lets ARIA control keyboard, mouse, screenshots, app launching on a target machine. Two relay flavors:

### Node relay (Windows / macOS / Linux)
```bash
node claw-relay.js https://your-aria-url.onrender.com
```

### ESP32 BLE HID relay (Chromebooks, locked-down devices)
1. Open `ARIA_ESP32__Relay/ARIA_ESP32_Relay.ino` in Arduino IDE
2. Set partition scheme to **Huge APP (3MB No OTA/1MB SPIFFS)**
3. Install libraries: `NimBLE-Arduino`, `ArduinoJson`
4. Edit `WIFI_NETWORKS` and `SERVER_URL` constants
5. Flash, then pair "ARIA Claw" from Bluetooth settings on target device

For **screenshots** on Chromebook (since ESP32 has no screen capture), also run:
```bash
node aria-screenshot-watcher.js https://your-aria-url.onrender.com
```
This watches `~/Downloads` and uploads screenshots to ARIA when the ESP32 triggers a capture.

## API endpoints (selected)

| Endpoint | Use |
|---|---|
| `GET  /api/health` | Server status, relay count, uptime |
| `POST /api/chat` | Main chat endpoint (streaming + non-streaming) |
| `GET  /api/memory` | Read ARIA's fact memory |
| `POST /api/memory` | Add/delete/clear facts |
| `POST /api/imagine` | Image generation |
| `POST /api/claw/relay/register` | Relay handshake |
| `GET  /api/claw/queue` | Relay polls commands here |
| `POST /api/claw/relay/result` | Relay reports command result + screenshots |
| `POST /api/claw/kill` | Emergency stop — clears all queues |

## Data persistence

ARIA stores state in `data/`:
- `memory.json` — facts and session history
- `chats.json` — user conversation history
- `notes.json`, `todos.json` — user notes and tasks
- `behavior.json` — adaptive personality data

All writes are atomic (temp file + rename) and debounced to avoid hammering disk.

## Architecture notes

**Agentic pipeline.** When ARIA needs a tool, the model emits `ACTION: toolname | input`. The pipeline parses this, runs the tool, injects the result back as a user message, and re-prompts up to 8 iterations.

**Streaming.** SSE-based. Chat replies stream token-by-token. If the streamed reply contains an `ACTION:`, the pipeline runs after the stream finishes.

**Memory.** Two layers: fact extraction (regex-based, runs on every reply) and behavior signals (positive/negative feedback). Both persist to `data/` and inject into the system prompt on subsequent turns.

## Version

Current: **Mark 1.0** (`public/js/version.js` is the single source of truth — bump `mark` and `point` there).

## License

Personal project — no formal license.

## Background Tasks (Mark 1.4)

Cowork/Copilot-style task engine. Tasks survive server restarts, run as multi-step plans, support scheduling, and broadcast live progress to all connected clients via SSE.

### Quick examples

```bash
# Fire-and-forget: ARIA plans + executes
curl -X POST /api/tasks/create -H "Content-Type: application/json" -d '{
  "description": "Research the top 5 open-source LLMs and summarize tradeoffs"
}'

# Plan only — review and approve before execution
curl -X POST /api/tasks/create -d '{
  "description": "Refactor the Mason Navigator routing logic",
  "autoExecute": false
}'

# Schedule: run once at a specific time
curl -X POST /api/tasks/create -d '{
  "description": "Summarize my chats from today",
  "schedule": { "runAt": 1735718400000 }
}'

# Recurring: every weekday at 9am
curl -X POST /api/tasks/create -d '{
  "description": "Read overnight news and produce a 5-bullet briefing",
  "schedule": { "cron": "0 9 * * 1-5" }
}'
```

### Endpoints

| Endpoint | Use |
|---|---|
| `POST /api/tasks/create` | Create a task |
| `GET  /api/tasks` | List all tasks (optional `?status=running`) |
| `GET  /api/tasks/:id` | Get one task with full step state |
| `POST /api/tasks/:id/approve` | Approve a plan and start execution |
| `POST /api/tasks/:id/pause` | Pause a running task |
| `POST /api/tasks/:id/resume` | Resume a paused task |
| `POST /api/tasks/:id/cancel` | Cancel a task |
| `DELETE /api/tasks/:id` | Delete a task |
| `POST /api/tasks/:id/edit-steps` | Edit plan before approval |
| `GET  /api/tasks/subscribe` | SSE feed of live updates |
| `GET  /api/tasks/stats` | Task engine stats |

The legacy `/api/background` endpoints still work — they're shimmed to use the new engine.
