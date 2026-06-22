## Context

Nexo currently lets users configure a single chat-oriented model endpoint and invoke it from the agent loop or the `invoke_model` tool. The current flow does not cleanly separate a primary orchestrator model from specialist models, and it still expects users to type a model name manually.

This change expands the model layer into a multimodal system:
- one primary model profile coordinates reasoning and delegation;
- specialist model profiles handle vision, image generation, image editing, speech recognition, speech synthesis, and embeddings;
- provider connections discover available models automatically from API Base + API Key;
- UI and runtime both need to work with capability metadata instead of raw model names.

The implementation touches shared types, Electron server runtime, model profile persistence, tools, chat execution, upload/media handling, and the model settings UI.

## Goals / Non-Goals

**Goals:**
- Let users connect a provider with only API Base + API Key, then discover available models automatically.
- Allow one enabled profile to act as the primary orchestrator.
- Route sub-tasks by capability instead of by manual model string.
- Support multimodal specialist work for image understanding, image generation/editing, STT, and TTS.
- Keep OpenAI-compatible providers as the first supported integration path.

**Non-Goals:**
- Building vendor-specific adapters for every provider in this change.
- Training, fine-tuning, or hosting models locally.
- Replacing the existing agent/tool framework.
- Designing a full media library or asset manager beyond the storage needed for multimodal outputs.

## Decisions

1. **Use capability-driven routing instead of model-name routing.**  
   Model profiles will carry capability tags such as `vision` or `text_to_speech`, and the tool/runtime layer will resolve specialists from those tags. This is more stable than hard-coding model IDs and makes provider switching easier.
   Alternatives considered: direct model-name selection, separate per-feature configuration, or a manually maintained routing table. Those options increase user setup and make provider changes brittle.

2. **Treat one enabled profile as the primary orchestrator.**  
   The orchestrator handles planning, tool selection, and deciding when to delegate to specialists. Specialist profiles do the narrow task work.
   Alternatives considered: allowing multiple primaries or asking users to choose an orchestrator each time. Both add ambiguity and weaken the default runtime path.

3. **Discover models from the provider API instead of manual entry.**  
   The UI will call an OpenAI-compatible `/models` endpoint after the user enters API Base + API Key. Discovered models can then be promoted into saved profiles with inferred capabilities.
   Alternatives considered: manual text input only, or provider-specific discovery pages. Manual entry is error-prone and does not scale across multimodal use cases.

4. **Keep media files in local managed storage and pass references through chat/tool flows.**  
   Uploaded images and audio, plus generated outputs, will be stored under the app data directory and referenced by URL or file metadata.
   Alternatives considered: inline base64 payloads everywhere or storing all media in SQLite. Both are poor fits for larger image/audio assets.

5. **Start with OpenAI-compatible chat/completions and `/models`, then layer multimodal endpoints behind capability-specific helpers.**  
   This keeps the first release coherent while leaving room for vendor-specific adapters later.
   Alternatives considered: shipping all vendor integrations at once or baking provider-specific logic directly into the agent loop. Both would make the initial change much riskier.

## Risks / Trade-offs

- [Capability inference may misclassify a model] -> Let users override capabilities in the profile UI and treat inference as a default, not a contract.
- [Primary model selection could be ambiguous if multiple profiles are marked primary] -> Save only one primary enabled profile at a time and normalize old data on write.
- [Multimodal providers differ in API shape] -> Define capability-specific runtime helpers and keep provider adapters narrow.
- [Large media files can slow chat and tool flows] -> Store media on disk, avoid inline transport when possible, and enforce size limits for attachments.
- [Discovery endpoint may not expose every usable model] -> Allow manual profile creation from a discovered model and keep raw model editing available as a fallback.

## Migration Plan

1. Expand shared model types and model profile storage to include capabilities, discovery results, and primary model metadata.
2. Update the model settings UI to support discovery-first setup and capability editing.
3. Update the model routing tool and agent runtime to resolve specialists by capability.
4. Add multimodal helpers for image and audio work, reusing the existing upload pipeline and adding any missing output storage.
5. Keep existing chat profiles working during rollout by defaulting unknown profiles to `chat` and preserving manual model entry as a fallback.

Rollback is straightforward: disable the new UI paths and revert runtime routing back to the plain chat model field if a provider integration proves unstable.

## Open Questions

- Should the orchestrator only delegate by tool call, or should it also be able to emit structured routing plans for the UI?
- Which multimodal tasks need first-class UI buttons versus only tool/runtime support?
- Should generated images and audio be shown inline in conversation history immediately, or only as downloadable artifacts?
- Do we need per-capability provider preferences when more than one specialist profile supports the same task?
