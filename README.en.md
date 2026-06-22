# Nexo Agent

[中文](./README.md)

Nexo Agent is a local-first AI Agent desktop and web console. It brings chat, tool use, long-term memory, a local knowledge base, skills, and scheduled tasks into one workspace for personal assistants or team-internal agent workflows.

The project is built with Electron, React, TypeScript, Ant Design, Express, and LangChain. It can run as an Electron desktop app and also exposes a local web console that uses the same sessions, settings, and runtime capabilities.

## Features

- Multi-session chat: create, switch, rename, delete, persist, and stream conversations.
- OpenAI-compatible models: configure API Base URL, API Key, model, temperature, planning mode, context turns, max tool steps, and optional context-budget overrides.
- Tool calling: use LangChain tool calling for search, HTTP requests, model sub-calls, calculation, file read/write, memory recall, skill search/install, and shell commands.
- Local memory: store `daily`, `dream`, `long_term`, and `script` memories in SQLite, with semantic recall when embeddings are available.
- Dream memory: consolidate daily memories into reusable dream records for cross-session context.
- Local knowledge base: create, edit, delete, browse, preview, and retrieve Markdown documents.
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
│       ├── routes/               # settings/chat/session/memory/knowledge/tools APIs
│       ├── tools/                # Tool executors and registry
│       ├── skills.ts             # Skill loading, toggles, marketplace installs
│       ├── knowledge.ts          # Local knowledge-base loading and retrieval
│       └── tasks.ts              # Scheduled task runtime
├── src/
│   ├── components/               # Chat, Memory, Knowledge, Tools, Skills, Tasks UI
│   ├── services/api.ts           # Electron IPC and Web fetch API adapter
│   ├── store/chat.ts             # Sessions, message stream, tool-call state
│   ├── shared/                   # Shared types, settings, and port constants
│   └── theme/                    # Theme configuration
├── nexo/
│   ├── tools.json                # Built-in tool metadata
│   └── skills/                   # Built-in skills
├── docs/                         # Project documentation
├── openspec/                     # OpenSpec changes and capability specs
└── .nexo-data/                   # Local runtime data, generated during development
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
| `recall_memory` | Search daily, dream, long-term, or script memories |
| `search_skills` | Search skill marketplaces or local skills |
| `create_skill` | Create a managed local skill from conversation input |
| `install_skill` | Install a skill from a supported marketplace |
| `create_scheduled_task` | Create a scheduled task that appears in the Tasks panel and runs through Nexo's scheduler |
| `shell_command` | Run a terminal command from the workspace |

File tools are restricted to the configured workspace and extra file access roots. Add external directories in Settings before using `file_read` or `file_write` against them, or handle the path through a terminal command.

## Memory

The memory system lives in `electron/memory.ts` and stores data under `.nexo-data/` by default.

| Kind | Description |
| --- | --- |
| `daily` | Facts extracted from conversations by calendar day |
| `dream` | A consolidated summary of one day of daily, long-term, and script memories |
| `long_term` | Facts that remain useful across sessions |
| `script` | Workflow state and key data for repeatable scripts or processes |

The source of truth is `.nexo-data/memory.sqlite`. When an API Key and embedding support are available, Nexo tries to use Chroma for semantic retrieval. If vector retrieval is unavailable, it falls back to SQLite keyword matching.

Thread compaction is intentionally separate from durable memory. Long-running chats keep a rolling thread summary in session state for current work, while only stable preferences, workflows, conventions, and long-lived facts are promoted into cross-session memory.

## Knowledge Base

The knowledge base manages local Markdown files:

- Browse the knowledge directory tree
- Create Markdown files
- Edit and delete knowledge files
- Preview Markdown
- Retrieve relevant knowledge content during chat

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
.nexo-data/
```

Common contents include:

- Sessions
- Settings
- Memory SQLite database
- Chroma vector data
- Knowledge-base files
- Skill and marketplace configuration
- Tasks and logs
- Uploaded attachments

This directory should usually not be committed.

## Current Boundaries

- Feishu, DingTalk, WeChat, and WeCom channel pages currently save configuration only; they are not complete message runtimes yet.
- MCP server support currently focuses on configuration management; process management, tool discovery, and runtime invocation are not fully wired.
- Knowledge retrieval is lightweight and best suited to local Markdown recall; enterprise-grade RAG needs further work.
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
