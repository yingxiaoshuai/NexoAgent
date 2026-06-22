## Why

The current AI configuration is centered on chat-style model profiles and does not provide a complete path for multimodal work such as vision, image generation/editing, speech recognition, or speech synthesis. Users should be able to enter a provider API base and key once, discover available models automatically, choose a primary orchestrator, and let the application route tasks to specialist models without manually typing model names.

## What Changes

- Add provider model discovery from API Base + API Key, starting with OpenAI-compatible `/models` endpoints.
- Add model capabilities for orchestration, chat, vision, image generation, image editing, speech-to-text, text-to-speech, and embeddings.
- Allow one enabled model profile to be marked as the primary orchestrator responsible for understanding user intent and delegating specialist work.
- Add capability-based specialist selection so tools and runtime code can request "vision" or "text-to-speech" instead of hard-coding a model ID.
- Add multimodal task flows for image recognition, image generation, image editing, speech recognition, and speech synthesis.
- Add UI affordances for discovered model lists, capability badges/overrides, primary model selection, and specialist readiness status.
- Store generated or uploaded media artifacts in a managed data location and expose them in conversation/task results.

## Capabilities

### New Capabilities

- `model-discovery`: Provider connection, automatic model listing, capability inference, and capability overrides after the user enters API Base and API Key.
- `model-orchestration`: Primary model selection and capability-based delegation from the orchestrator to specialist model profiles.
- `multimodal-ai-actions`: User-facing multimodal actions for vision, image generation, image editing, speech-to-text, and text-to-speech, including media artifact handling.

### Modified Capabilities

- None.

## Impact

- Affects model profile storage, model profile APIs, provider connection validation, and model invocation tools.
- Affects the main agent runtime so it can use the primary model for planning and invoke specialists by capability.
- Affects model configuration UI and conversation/task UI where multimodal inputs and generated outputs are displayed.
- Adds or extends server-side media handling for uploaded images/audio and generated image/audio artifacts.
- May require provider adapter abstractions for OpenAI-compatible endpoints first, with room for vendor-specific adapters later.
