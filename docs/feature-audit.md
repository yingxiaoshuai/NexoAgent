# Nexo Agent Feature Audit

This audit compares Nexo's current runtime behavior against the product surface shown in the app. CowAgent is used only as a capability-boundary reference; no CowAgent implementation code is copied.

## Real Runtime Features

- Chat sessions: create, rename, delete, persist, and stream model responses.
- Tool calls: `web_search`, `calculator`, `file_read`, `file_write`, and `recall_memory` are executable and controlled by the tool toggles.
- Knowledge files: create, edit, delete, browse, and retrieve into chat context when knowledge is enabled. Retrieval uses Chroma-backed semantic vectors when embeddings are available, with keyword fallback.
- File attachments: uploaded text files are inlined into the current model context; image attachments are shown and referenced by metadata only.
- Memory: stores persistent daily, dream, and script memories in SQLite (`.nexo-data/memory.sqlite`). Semantic retrieval uses embeddings via Chroma when credentials are available, with SQLite keyword fallback.
- Scheduled tasks: persisted 5-field cron tasks run in the background and create task result sessions; tasks can also be run manually.
- Logs: streams the local app log over SSE.

## Configuration-Only Surfaces

- Feishu, DingTalk, WeCom, and WeChat channels currently save connection fields only. They do not start webhook endpoints, stream clients, media handlers, or outbound reply pipelines.
- MCP servers currently save name/command/args only. They are not launched, inspected, hot-reloaded, or exposed as runtime tools.

## Partial Features

- `web_search` works without a paid key through web-result fallbacks, but reliability is best with `BING_SEARCH_API_KEY` or `AZURE_BING_SEARCH_API_KEY`.
- Knowledge retrieval is vector indexed when an embedding profile and Chroma runtime are available, with keyword fallback. It is not graph-based and does not yet provide enterprise RAG features such as citations or per-note permissions.
- Script memory exposes a stable keyed store for repeatable workflows, but no visual editor exists yet.
- Cron support covers common 5-field expressions with `*`, lists, ranges, and steps. It does not implement named months/weekdays, seconds, time zones, or advanced scheduler policies.
- Attachments are limited to UTF-8 text inlining for file attachments. Image understanding requires a future vision-model path.
- Web password auth endpoints exist, but the frontend does not yet enforce a login gate.

## Future Work

- Add a real channel runtime abstraction with inbound event normalization and outbound reply adapters.
- Add MCP stdio/SSE process management and expose discovered tools to the agent loop.
- Add terminal/browser/vision tools with explicit risk controls.
- Add automatic knowledge curation, citations, and richer ranking controls.
