# Nexo Agent

[中文](./README.md)

Nexo Agent is a local-first AI Agent desktop and web console. It brings chat, tool use, persistent memory, a local knowledge base, skills, and scheduled tasks into one workspace for personal assistants or team-internal agent workflows.

The project is built with Electron, React, TypeScript, Ant Design, Express, and LangChain. It can run as an Electron desktop app and also exposes a local web console that uses the same sessions, settings, and runtime capabilities.

## Features

- Multi-session chat: create, switch, rename, delete, persist, and stream conversations.
- OpenAI-compatible models: configure API Base URL, API Key, model, temperature, planning mode, context turns, max tool steps, and optional context-budget overrides.
- Tool calling: use LangChain tool calling for search, HTTP requests, model sub-calls, calculation, file read/write, memory recall, skill search/install, and shell commands.
- Shared browser workbench: operate a conversation-scoped Electron browser with visible browsing, hidden background browsing, DOM-first element resolution, screenshots, element picking, history, zoom, and web-app automation.
- Local memory: store persistent `daily`, `dream`, and `script` memories in SQLite, with embedding-backed semantic recall when available.
- Dream memory: consolidate daily memories into reusable dream records for cross-session context.
- Local knowledge base: create, edit, delete, browse, preview, and retrieve Markdown documents with Chroma-backed semantic recall when embeddings are available.
- Skills: load built-in, workspace, managed, and marketplace-installed skills into the Agent prompt.
- Scheduled tasks: run 5-field Cron prompt tasks on a schedule or manually, then save the result as a task session.
- Attachments and logs: inline text attachments into context and inspect runtime logs from the Logs panel.
- Token-aware context management: resolve model context windows from profile overrides, a local dictionary, provider metadata, or persisted first-use lookup results; automatically compact long threads into a rolling session summary before the prompt overruns the active model budget.
- Desktop and web surfaces: the Electron app starts a local web console; the web console can also be built and served independently.

## Quick Start

### Requirements

- Node.js 22 or a compatible version
- npm
- An API key for an OpenAI-compatible model service

### Install Dependencies

```bash
npm install
```

### Start the Electron Desktop App

```bash
npm run dev:electron
```

This starts:

- Vite frontend dev server at `http://localhost:8106`
- Electron main-process TypeScript watch
- Electron desktop window
- Local Express web console at `http://localhost:9898`

### Start Only the Web Frontend Dev Server

```bash
npm run dev:web
```

Vite listens on `http://localhost:8106` and proxies `/api` and `/uploads` to `http://localhost:9898`. If you only run `dev:web`, a backend service must also be running.

### Serve the Built Web Console

```bash
npm run build
npm run serve:web-console
```

Default URL:

```text
http://localhost:9898
```

## Basic Configuration

After first launch, open Settings and configure the model runtime:

| Setting | Description |
| --- | --- |
| API Base URL | OpenAI-compatible endpoint, for example `https://api.openai.com/v1` |
| API Key | Model service secret; the desktop app saves it through Electron |
| Model | Model name, such as `gpt-4o-mini`, `deepseek-chat`, or `qwen-*` |
| Provider | OpenAI Compatible, DeepSeek, Qwen, Doubao, or Custom |
| Workspace Path | Default root for file tools |
| Extra File Access Roots | Additional absolute paths allowed for `file_read` and `file_write` |
| Temperature | Model output randomness |
| Max Context Turns | Recent conversation turns included in model requests |
| Context Window / Reserved Output | Optional advanced overrides for model-specific context budgeting |
| Max Tool Steps | Maximum tool-call steps in one assistant response |
| Shell Command Timeout | Default timeout for `shell_command` |
| Planning Mode | Fast, Balanced, or Deep |
| Enable Memory | Whether chat should recall and write memories |
| Enable Knowledge | Whether chat should retrieve local knowledge notes |

Without an API Key, chat returns a local demo response. Configure a model to use the full Agent runtime.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev:web` | Start the Vite web dev server |
| `npm run dev:electron` | Start the Electron desktop dev environment |
| `npm run build:web` | Type-check and build the web frontend |
| `npm run build:electron` | Compile the Electron main process |
| `npm run build` | Build the full app |
| `npm run serve:web-console` | Run the built local web console |
| `npm run preview` | Preview the Vite build output |
| `npm run typecheck` | Run TypeScript checks for frontend and Electron code |
| `npm run package` | Package the desktop app with electron-builder |

Packaged artifacts are written to:

```text
release/
```

## GitHub Actions Packaging

The repository includes a GitHub Actions workflow at `.github/workflows/build-release.yml`.

- Push to `main`: build Windows, macOS, and Linux packages and upload them as workflow artifacts
- Open or update a pull request: run the same multi-platform packaging validation without publishing a release
- Push a tag like `v0.1.1`: build all three desktop packages and publish them to a GitHub Release
- Manual run: use the Actions tab and trigger `Build And Release`

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop container | Electron 33 |
| Frontend | React 18, TypeScript, Ant Design 5 |
| State management | Zustand |
| Build tool | Vite 6 |
| Agent orchestration | LangChain, OpenAI-compatible Chat API |
| Browser automation | Electron BrowserView, Chrome DevTools Protocol input events, local MiniLM element resolver |
| Backend service | Express, Server-Sent Events |
| Local storage | JSON files, SQLite/sql.js |
| Memory retrieval | OpenAI Embeddings, Chroma, SQLite keyword fallback |
| Packaging | electron-builder |

## Project Structure

```text
nexoAgent/
├── electron/
│   ├── bootstrap.ts              # Electron bootstrap entry
│   ├── main.ts                   # Desktop window, IPC, settings, local web server
│   ├── memory.ts                 # SQLite memory, dream consolidation, vector recall
│   ├── preload.ts                # Electron preload bridge
│   └── server/
│       ├── agent.ts              # LangChain Agent loop, tool calls, context assembly
│       ├── browser-manager.ts    # Shared browser, DOM snapshots, CDP clicks, element picker
│       ├── browser-embedding.ts  # Browser-only MiniLM element resolver
│       ├── routes/               # settings/chat/session/memory/knowledge/tools APIs
│       ├── tools/                # Tool executors and registry
│       ├── skills.ts             # Skill loading, toggles, marketplace installs
│       ├── knowledge.ts          # Local knowledge-base loading and retrieval
│       └── tasks.ts              # Scheduled task runtime
├── src/
│   ├── components/               # Chat, BrowserWorkbench, Memory, Knowledge, Tools, Skills, Tasks UI
│   ├── services/api.ts           # Electron IPC and Web fetch API adapter
│   ├── store/chat.ts             # Sessions, message stream, tool-call state
│   ├── shared/                   # Shared types, settings, and port constants
│   └── theme/                    # Theme configuration
├── nexo/
│   ├── tools.json                # Built-in tool metadata
│   └── skills/                   # Built-in skills
├── docs/                         # Project documentation
├── openspec/                     # OpenSpec changes and capability specs
└── .NexoAgent/                   # Local runtime data, generated during development
```

## Agent Tools

Built-in tools are declared in `nexo/tools.json`, and their executors live in `electron/server/tools/`.

| Tool | Purpose |
| --- | --- |
| `web_search` | Search recent information and return links and snippets |
| `http_request` | Send an HTTP request and return a response preview |
| `invoke_model` | Call the default model or a configured model profile for a sub-task |
| `calculator` | Evaluate a math expression |
| `file_read` | Read a file or list a directory inside allowed roots |
| `file_write` | Write or append a file inside allowed roots |
| `recall_memory` | Search persistent daily, dream, or script memories |
| `search_skills` | Search skill marketplaces or local skills |
| `create_skill` | Create a managed local skill from conversation input |
| `install_skill` | Install a skill from a supported marketplace |
| `create_scheduled_task` | Create a scheduled task that appears in the Tasks panel and runs through Nexo's scheduler |
| `shell_command` | Run a terminal command from the workspace |
| `browser_action` | Operate the shared Electron browser session through DOM snapshots, semantic element resolution, `action="run"` multi-step execution, CDP clicks, typing, scrolling, screenshots, refresh, back, and forward |

File tools are restricted to the configured workspace and extra file access roots. Add external directories in Settings before using `file_read` or `file_write` against them, or handle the path through a terminal command.

## Browser Workbench

The desktop app includes a conversation-scoped shared browser. It is not a separate product surface; it is a browser component used by the current chat so the assistant can inspect pages, operate web apps, gather visual evidence, and bring the result back into the conversation.

### Surfaces

- Visible browser mode: the browser is shown beside the chat panel. The left side contains the web page, the center rail contains zoom controls and the split resize handle, and the right side contains session history plus the conversation.
- Hidden browser mode: the same browser session can be kept offscreen for chat-only workflows. The assistant can browse in the background and summarize results without asking the user to watch the page.
- Screenshot return: `browser_action.screenshot` creates an image artifact and attaches it to the assistant response when visual state, layout, charts, images, or user-requested evidence matter.

### DOM-first Operation

Browser automation is DOM-first. For ordinary controls such as buttons, links, inputs, menus, and form submission, the assistant should prefer DOM target resolution instead of screenshot-based visual localization. Fixed actions like `snapshot`, `resolve`, `click`, `type`, and `scroll` remain available for simple tasks, and their locators should be expressed through `target`, while `browser_action` with `action="run"` is preferred for compound or fuzzy browser tasks.

The resolver extracts visible interactive elements from the current page, including:

- Native `button`, `a`, `input`, `textarea`, `select`, and `summary` elements
- ARIA controls such as `role="button"`, `role="link"`, menu items, checkboxes, and radios
- Contenteditable regions
- Clickable-looking `div` or `span` elements with `cursor:pointer`, click handlers, or common button/action class/id/data attributes

Each candidate keeps its role, name, text, value, href, editability, bounds, nearby context, selector, and a descriptor string used for matching.

### `browser_action.run`

`action="run"` lets the model send a browser goal, a default target, an ordered `steps` array, an optional `strategy`, and `onFailure` guidance in one tool call. The browser runtime then resolves natural-language targets through DOM descriptors, local MiniLM semantic matching, DOM rules, selectors, xpath, or explicit coordinates before executing each step.

Example:

```json
{
  "action": "run",
  "goal": "Compose and send a test email",
  "steps": [
    { "op": "click", "target": { "query": "Compose", "role": "button" } },
    { "op": "type", "target": { "query": "Recipient" }, "text": "test@example.com" },
    { "op": "type", "target": { "query": "Subject" }, "text": "Smoke test" },
    { "op": "click", "target": { "query": "Send", "role": "button" }, "strategy": "auto" }
  ],
  "onFailure": { "retry": ["snapshot", "resolve", "scroll"] }
}
```

### Browser-only MiniLM Resolver

`electron/server/browser-embedding.ts` loads a local `Xenova/all-MiniLM-L6-v2` model from `nexo/models/browser-resolver/`. It is used only for browser element resolution. It is not used for persistent memory, knowledge retrieval, daily memory, dream memory, or conversation compaction.

The resolver combines:

- Lexical and exact-name matching
- Role matching
- Nearby context and recent interaction context
- Enabled/visible state checks
- Local MiniLM semantic similarity for fuzzy element names

For explicit high-impact actions such as send, delete, save, login, and cancel, semantic similarity alone is not enough. The chosen element must contain the requested action anchor, preventing mistakes such as treating "compose" as "send" just because both are mail-related.

### CDP Input Events

Clicks are executed through Chrome DevTools Protocol when possible. Nexo first resolves a `target` through `target.ref`, `target.query`, selector/xpath, or explicit coordinates, then sends:

```text
Input.dispatchMouseEvent(mouseMoved)
Input.dispatchMouseEvent(mousePressed)
Input.dispatchMouseEvent(mouseReleased)
```

The CDP events include `buttons`, `modifiers`, and second-based `timestamp` values, and they travel through Chromium's native input pipeline. This is more reliable for modern SPAs than calling `HTMLElement.click()`.

Typing supports `target.ref` and `target.query`, and it also falls back to the focused editable element. If a SPA rerenders and a previous ref becomes stale after the field has already been focused, `browser_action.type` and `browser_action.run` type steps can still write into `document.activeElement`.

### Element Picker

The browser toolbar includes an element picker button. When enabled, the page highlights hovered elements. The next click is captured before the page handles it, and the selected element's name, tag, role, text, selector, bounds, and URL are written into the chat input. This is useful when a user wants to point at a page element and ask the assistant to reason about it.

### Boundaries

- DOM-first does not mean vision is never used. Screenshots remain the right fallback for canvas content, charts, images, layout inspection, and cases where the user explicitly wants visual evidence. `browser_action.run` may also request `strategy: "visionFallback"` when DOM evidence is weak.
- Cross-origin iframe internals, browser plugins, canvas-only UI, and sites with strong anti-automation behavior may still require screenshots, user confirmation, or site-specific adaptation.
- The browser resolver's MiniLM model is scoped to browser parsing only and should not be reused as a memory or knowledge embedding model.

## Memory

The memory system lives in `electron/memory.ts` and stores data under `~/.NexoAgent/` by default.

| Kind | Description |
| --- | --- |
| `daily` | Facts extracted from conversations by calendar day |
| `dream` | A consolidated summary of one day of daily and script memories |
| `script` | Workflow state and key data for repeatable scripts or processes, persisted across sessions |

The source of truth is `~/.NexoAgent/memory.sqlite`. When an API Key and embedding support are available, Nexo tries to use Chroma for semantic retrieval. If vector retrieval is unavailable, it falls back to SQLite keyword matching.

Thread compaction is intentionally separate from durable memory. Long-running chats keep a rolling thread summary in session state for current work, while persistent daily, dream, and script memories remain available for cross-session recall.

## Knowledge Base

The knowledge base manages local Markdown files:

- Browse the knowledge directory tree
- Create Markdown files
- Edit and delete knowledge files
- Preview Markdown
- Retrieve relevant knowledge content during chat with semantic vector search when an embedding profile is available, falling back to keyword matching

It is useful for project notes, team rules, operating procedures, business context, and other reference material that the model should reuse.

## Skills

Skills are capability instructions injected into the Agent prompt. Nexo Agent supports:

- Built-in skills from `nexo/skills/`
- Workspace-discovered skills
- Managed skills created through the UI or tools
- Marketplace skills searched and installed from supported sources

Use the Skills panel to enable, disable, or delete non-built-in skills. Enabled skills are injected during chat and influence Agent behavior.

## Scheduled Tasks

The Tasks panel supports 5-field Cron expressions:

```text
0 9 * * *    # Run every day at 9:00
```

Each task has a name, Cron expression, prompt, and enabled state. Tasks can run on schedule or manually. Completed runs create task sessions for later review.

## Local Data

Runtime data is stored primarily in:

```text
%USERPROFILE%/.NexoAgent
```

Common contents include:

- Sessions
- Settings
- Memory SQLite database
- Chroma vector data
- Knowledge-base files
- Skill and marketplace configuration
- Tasks
- Runtime logs under `logs/`
- Uploaded attachments

This directory should usually not be committed.

## Current Boundaries

- Feishu, DingTalk, WeChat, and WeCom channel pages currently save configuration only; they are not complete message runtimes yet.
- MCP server support currently focuses on configuration management; process management, tool discovery, and runtime invocation are not fully wired.
- Knowledge retrieval is hybrid semantic/keyword recall for local Markdown notes; enterprise-grade RAG features such as permissions, citations, and advanced ranking need further work.
- Image attachments are currently displayed and stored as metadata; image understanding requires a future vision-model path.
- Web password auth endpoints exist, but the frontend does not yet enforce a full login gate.

## Development Notes

- Start with `electron/server/agent.ts` when changing Agent behavior.
- Add new tools by updating both `nexo/tools.json` and `electron/server/tools/executors.ts`.
- Shared frontend/backend types live in `src/shared/types.ts`.
- Memory changes should account for the SQLite schema, migration behavior, and Chroma fallback path.
- OpenSpec-related changes live under `openspec/`.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).
