# ARIA — Adaptive Reasoning Intelligence Architecture

A personal AI OS with chat, voice, memory, tool use, and remote PC control.

## What's in this repo

| Component | What it is | Where |
|---|---|---|
| **ARIA server** | Express server, AI routing, memory, agentic tools | `server.js` |
| **Tools** | Calc, weather, notes, todo, timer, search, news, calendar… | `tools/index.js` |
| **Web UI** | Front-end (chat, voice, settings, claw panel) | `public/` |
| **Claw Relay (PC)** | Runs on your computer; lets ARIA control keyboard/mouse | `claw-relay.js` |
| **ESP32 Relay** | Same as above but over BLE HID for Chromebooks/sandboxed devices | `ARIA_ESP32__Relay/` |
| **Screenshot Watcher** | Companion script for ESP32 to enable vision on a Chromebook | `aria-screenshot-watcher.js` |
| **Voice Hook (PC)** | Gives ARIA a phone number via Google Voice, password-locked | `aria-voice-hook.js` |
| **Ollama Hook (PC)** | Lets a hosted ARIA use the Ollama models on your PC | `aria-ollama-hook.js` |

## Quick start

```bash
git clone https://github.com/DaEpickid540/ARIA.git
cd ARIA
npm install
cp .env.example .env  # fill in at least one provider key
npm start
```

Then open `http://localhost:3000`.

## Website (Firebase Hosting)

<https://personal-suite-aria.web.app> is the same UI as a static site, with
no server of its own:

```bash
npm run deploy:web   # build dist-web/ and deploy to the personal-suite-aria site
```

- It picks a **brain**: your PC's desktop app (`127.0.0.1:3717`) when it
  answers, otherwise Render. You can pin one from the lock screen.
  `public/js/apiBase.js` sends every `/api` call there.
- **Sign-in is Google only.** Every request carries your Firebase ID token
  (a header, or `?access_token=` for live updates), since cookies don't
  cross sites.
- **Render** checks the token as usual (`ARIA_OWNER_UID`).
- **Your PC** accepts the site only with a token for `ARIA_OWNER_UID`. Set
  it once in the desktop app under **Settings ▸ Keys ▸ Owner**; the website
  shows your ID the first time you sign in. Chrome also asks once whether
  the site may reach devices on your local network.
- **Allowed origins.** Both servers allow the site's origin through
  `ARIA_WEB_ORIGINS` (it's in the default list).
- **Don't let personal-suite overwrite it.** The `personal-suite` folder
  still maps its `aria` target, a redirect to Render, to the same site.
  Deploy that folder with `--only hosting:grind,hosting:hardware`.

## Desktop app (Windows)

```bash
npm run desktop   # run it from the checkout (uses this repo's .env)
npm run dist      # build dist/ARIA-Setup-Mark-<mark>.<point>.exe
```

The installer runs the full ARIA server on your PC and shows it in its own
window (Electron, `desktop/main.js`). It's the same `server.js` as Render's.

- **Keys:** **Settings ▸ Keys**. They work from the next message, with no
  restart. They're stored in `%APPDATA%\ARIA\.env`, created from
  `.env.example` on first run. `npm start` reads `./.env` the same way
  (`ARIA_ENV_FILE` to point elsewhere). On Render, set keys in the dashboard.
- **Data:** `%APPDATA%\ARIA\data` (via `ARIA_DATA_DIR`). Updates and
  uninstalls leave it alone.
- **Ollama:** no hook needed; the server is on the same PC, so your models
  show up in the model switcher directly. Replies stream. Hybrid models
  (qwen3.5) reason only on turns that need it; reasoning-only builds
  (qwen3:30b "Thinking") keep their reasoning in the collapsible section.
  An image sent to a text-only model is read by an installed vision model
  instead. Context is 16k (`OLLAMA_NUM_CTX`).
- **Claw:** off until you click **Turn on PC control** in the Claw panel (or
  tick **ARIA ▸ PC control**). It runs `claw-relay.js` against the local
  server.
- **Voice input:** Electron can't use the browser's speech recognizer, so
  the app records and transcribes instead: with Groq or OpenAI Whisper when
  one of those keys is set, otherwise with a local Whisper model that
  downloads once (about 80 MB).
- **ARIA's own voice:** Settings ▸ Voice ▸ *ARIA voice (runs on your PC)*.
  It's Kokoro-82M on the CPU (`lib/tts.js`, about 90 MB downloaded on first
  use), with no cloud and no key. Speech starts after the first sentence
  and the rest is generated while it plays. The hosted website can use it
  too when it's open on the PC running the desktop app: it calls
  `http://127.0.0.1:3717/api/tts`, which only accepts requests from your
  site's origin (`ARIA_WEB_ORIGINS`, default the Render URL). Off on
  Render itself (`ARIA_TTS=on` to force it).
- **Other websites can't use your local ARIA.** A request carrying another
  site's `Origin` is refused, so a page you visit can't post a Claw command
  to the local server.
- `ARIA_USER_DATA=<dir>` runs a separate copy (own keys, data, lock), e.g. a
  dev build next to the installed app.
- **Texting ARIA against the desktop app:**

  ```bash
  node --env-file="%APPDATA%\ARIA\.env" aria-voice-hook.js http://127.0.0.1:3717
  ```
- The server listens on `127.0.0.1:3717` only. The local API has no login, so
  it stays off your network.
- Logs: `%APPDATA%\ARIA\logs`. The installer isn't code-signed, so Windows
  SmartScreen asks once (**More info ▸ Run anyway**).

## Required environment variables

At minimum you need one AI provider. See `.env.example` for the full list.

| Key | Required? | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | recommended | Default chat model |
| `GROQ_API_KEY` | optional | Fast inference |
| `OPENAI_KEY` | optional | DALL-E image generation |
| `CLOUDFLARE_AI_API` + `CLOUDFLARE_ACCOUNT_ID` | optional | FLUX image gen |
| `NEWSDATA_KEY` | optional | Live news headlines |
| `TAVILY_API_KEY` | optional | Web research: search results come with page text, and pages that block ARIA are read through Tavily. Falls back to SerpAPI, DuckDuckGo, then Wikipedia |

## Access control

**Google sign-in (recommended).** Set `ARIA_OWNER_UID` on Render to your
personal-suite Firebase user ID (the same one GRIND uses). The lock screen
then shows **Sign in with Google**, and only that account gets in. The page
signs in with Firebase Auth (`public/js/googleAuth.js`), and
`POST /api/auth/google` checks the ID token (`lib/auth.js`) and sets an
HttpOnly session cookie that every `/api` route checks. After the first
popup it's one click, and if the cookie is lost the page renews it on its own.
Non-browser callers can send `Authorization: Bearer <Firebase ID token>`.

One-time setup: Firebase console ▸ Authentication ▸ Settings ▸ **Authorised
domains** ▸ add your Render domain. If you sign in with the wrong account,
the server log prints that account's `uid`, which helps if you don't know
yours.

**Access key.** `ARIA_ACCESS_KEY` still works, alongside Google or on its own
(`POST /api/auth/login`), and it's what `aria-voice-hook.js` sends for now.

**Relays** authenticate with `ARIA_RELAY_KEY` (or the access key). On a
public deploy with neither, relays are refused. With no way to log in on a
public deploy, the API stays open but Claw refuses to run. Locally (no
`RENDER` env), everything is open as before; `ARIA_REQUIRE_LOGIN=true` turns
Google sign-in on there too.

## Claw (remote PC control)

Claw lets ARIA control keyboard, mouse, screenshots, app launching on a target machine. Two relay flavors:

### Node relay (Windows / macOS / Linux)
```bash
node claw-relay.js https://your-aria-url.onrender.com --key=<ARIA_RELAY_KEY>
```

The model now gets each command's real result (shell output, errors) back
instead of "queued". Destructive shell commands (`rm -rf`, `Remove-Item`,
`format`, `shutdown`, `curl … | sh`, …) are held for approval no matter how the
model phrases them, as is any PC action after ARIA has read web content in the
same turn. Approvals are held server-side by id and expire after 10 minutes.

### ESP32 BLE HID relay (Chromebooks, locked-down devices)
1. Open `ARIA_ESP32__Relay/ARIA_ESP32_Relay.ino` in Arduino IDE
2. Set partition scheme to **Huge APP (3MB No OTA/1MB SPIFFS)**
3. Install libraries: `NimBLE-Arduino`, `ArduinoJson`
4. Edit `WIFI_NETWORKS`, `SERVER_URL` and `RELAY_KEY` constants
5. Flash, then pair "ARIA Claw" from Bluetooth settings on target device

For **screenshots** on Chromebook (since ESP32 has no screen capture), also run:
```bash
node aria-screenshot-watcher.js https://your-aria-url.onrender.com --key=<ARIA_RELAY_KEY>
```
This watches `~/Downloads` and uploads screenshots to ARIA when the ESP32 triggers a capture.

## Use your PC's Ollama models

On Render, `localhost:11434` is Render's machine, so ARIA can't see the Ollama
on your PC by itself. `aria-ollama-hook.js` runs next to Ollama, connects out
to ARIA (nothing to port-forward) and runs model requests locally:

```bash
node aria-ollama-hook.js https://your-aria-url.onrender.com --key=<ARIA_RELAY_KEY>
```

Your models then appear in the model switcher in the chat header; pick one
there. That choice is also saved on the server, so texts through the voice
hook use it too. If the hook goes offline, the switcher turns amber and ARIA
falls back to a cloud model.

- `--ctx=16384` (default) sets the context window. ARIA's system prompt is
  about 3k tokens, and Ollama's default on GPUs under 24 GB is 4k, which
  leaves no room for the conversation. Use less if the model spills out of
  VRAM (`ollama ps` should say 100% GPU); `--ctx=0` keeps Ollama's own setting.
- `--ollama=http://host:11434` if Ollama isn't on this machine's localhost.
- Newly pulled models show up within 30 seconds, no restart needed.

## Text ARIA from your phone (Google Voice)

`aria-voice-hook.js` runs on your PC, keeps voice.google.com open in a real
browser (Playwright driving your installed Edge/Chrome), and answers texts to
your Google Voice number with ARIA.

```bash
npm install                 # adds playwright-core; downloads no browser
# .env: ARIA_SMS_PASSWORD=<8+ chars>, plus ARIA_ACCESS_KEY if the server has one
node aria-voice-hook.js https://your-aria-url.onrender.com
```

The first run opens a browser window: sign in to Google Voice there. The login
is kept in `data/gvoice-profile/` (your Google session, so keep it private);
after that you can add `--headless`.

**The lock.** Every conversation starts locked. Text the password to unlock it.
Until then nothing is sent on to the ARIA server, and only the first text gets
a reply ("ARIA is locked, text the password"). Later ones are ignored, so a
stranger can't make the number text them over and over (`ARIA_SMS_SILENT=true`
skips even that first reply). After 5 minutes with no texts either way it
locks again (`--idle=<min>`) and says so on the next text. Text `lock` to lock
right away. Five
texts to a locked conversation that aren't the password mute it for 15
minutes, password included. Restarting the hook locks everything.
`--allow=+15551234567` limits unlocking to your own number(s).

**Claw over text.** If ARIA wants to run something that needs approval, it
texts you what it wants to do; reply `YES` or `NO`.

**Caveats.** Google Voice has no API. This drives the web page, so a Google UI
change can break it; the page selectors are all in `SEL` near the top of the
file. Google's Voice Acceptable Use Policy prohibits sending messages via an
automated process and can suspend numbers that break it. The hook keeps volume
low (it only answers unlocked conversations, and mutes a thread that gets 8+
replies in a minute), but that is a risk to your number. Use a Google account you can live
without.

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
| `POST /api/auth/login` | Exchange `ARIA_ACCESS_KEY` for a session cookie |
| `POST /api/confirm` | Approve/deny a held Claw action by id |
| `GET/POST /api/model` | The model switcher's pick; used by requests that name no provider |
| `/api/ollama/relay/*` | Ollama hook: register, long-poll jobs, return results |

## Data persistence

ARIA stores state in `data/`:
- `memory.json` — facts and session history
- `chats.json` — user conversation history
- `notes.json`, `todos.json` — user notes and tasks
- `behavior.json` — adaptive personality data

All writes are atomic (temp file + rename) and debounced to avoid hammering disk.

## Architecture notes

**Agentic pipeline.** When ARIA needs a tool, the model emits `ACTION: toolname | input`. The pipeline parses this, runs the tool, injects the result back as a user message, and re-prompts up to 8 iterations.

**Tool calls in the chat.** Every tool call behind a reply appears in a panel
above it: tool, input, result, time, status, and for web lookups the pages
read. Each row expands. The panel is saved with the chat, so it survives
a reload.

**Web lookups read 6 pages.** `research` and `search` (now the same tool) and
the fact-check agent each read 6 pages. A page that fails to load is replaced
by the next result. If the web runs out of readable results, the answer says
how many were read. `scrape` still reads the one URL it's given.

**Sub-agents (`spawn`).** ARIA can brief its own agents and run up to 4 in
parallel:

```
ACTION: spawn | name | the agent's instructions | its task
ACTION: spawn | [{"name":"for","prompt":"…","task":"…"},{"name":"against","prompt":"…","task":"…"}]
```

- **Tools:** each agent runs the same tool loop with your instructions as its
  system prompt, but only read-only tools: research, scrape, calc, convert,
  time, weather, news and the fixed agents.
- **Limits:** no PC control, approvals, tasks or further agents. Each agent
  gets 5 tool rounds and 3 minutes.
- **Results:** reports go back to ARIA, which writes the reply. Their tool
  calls appear nested under the spawn row.

**Streaming.** SSE-based. Chat replies stream token-by-token. If the streamed reply contains an `ACTION:`, the pipeline runs after the stream finishes.

**Memory.** Two layers: fact extraction (regex-based, runs on every reply) and behavior signals (positive/negative feedback). Both persist to `data/` and inject into the system prompt on subsequent turns.

## Version

Current: **Mark 2.5** (`public/js/version.js` is the single source of truth — bump `mark` and `point` there).

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
