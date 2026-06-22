## 1. Model Types and Profile Storage

- [x] 1.1 Add or verify shared model capability types for orchestration, chat, vision, image generation, image editing, speech-to-text, text-to-speech, and embeddings
- [x] 1.2 Add or verify discovered-model types and profile fields for capabilities, primary-model status, and persisted API key behavior
- [x] 1.3 Implement capability normalization so old profiles remain usable and unknown profiles default to chat-capable behavior
- [x] 1.4 Implement capability inference from discovered model identifiers and provider metadata where available
- [x] 1.5 Enforce a single saved primary profile by clearing other primary flags when a new primary is saved
- [x] 1.6 Implement deterministic enabled-profile lookup by capability, including clear errors when no specialist exists

## 2. Provider Discovery API

- [x] 2.1 Add or verify `POST /api/model-profiles/discover` for OpenAI-compatible `/models` discovery
- [x] 2.2 Validate API Base and API Key inputs before discovery and return actionable errors on provider failure
- [x] 2.3 Return discovered model IDs, display labels, owner metadata when available, and inferred capabilities
- [x] 2.4 Preserve the previous API key when editing a saved profile without entering a new key
- [x] 2.5 Add API coverage for discovery success, discovery failure, profile save, profile edit, and primary-profile uniqueness

## 3. Model Management UI

- [x] 3.1 Replace manual-first model entry with a connection form for API Base and API Key plus a discover button
- [x] 3.2 Display discovered models in a selectable list with inferred capability badges
- [x] 3.3 Add capability checkboxes or tags so users can override inferred capabilities before saving
- [x] 3.4 Add a primary-orchestrator toggle and show which saved profile is currently primary
- [x] 3.5 Show specialist readiness status for vision, image generation, image editing, speech-to-text, text-to-speech, embeddings, and chat
- [x] 3.6 Keep manual model entry available as a fallback for providers whose discovery endpoint is incomplete

## 4. Agent Orchestration Runtime

- [x] 4.1 Update the main streaming agent to use the primary orchestrator profile when one is configured
- [x] 4.2 Fall back to existing settings-based chat model behavior when no enabled primary profile exists
- [x] 4.3 Update the system prompt to describe capability-based delegation and available specialist capabilities
- [x] 4.4 Update `invoke_model` so capability requests resolve enabled specialists before falling back to default chat behavior
- [x] 4.5 Ensure disabled profiles are never selected for orchestration or specialist work
- [x] 4.6 Surface clear runtime errors when the requested capability is not configured

## 5. Multimodal Actions and Media Handling

- [x] 5.1 Extend attachment types and upload handling to distinguish image, audio, and generic file inputs
- [x] 5.2 Add a vision action that sends image references or payloads to a vision-capable specialist and returns text analysis
- [x] 5.3 Add an image-generation action that routes prompts to an image-generation-capable specialist and stores output images
- [x] 5.4 Add an image-editing action that accepts source images plus prompt text and stores edited output images
- [x] 5.5 Add a speech-to-text action that accepts uploaded audio and returns transcript text
- [x] 5.6 Add a text-to-speech action that generates audio files from text and stores output artifacts
- [x] 5.7 Store generated media in a managed data directory and return stable artifact references in conversation or task results

## 6. Conversation and Result UI

- [x] 6.1 Render uploaded image and audio attachments clearly in conversation history
- [x] 6.2 Render generated image artifacts inline when possible and expose a download/open action
- [x] 6.3 Render generated audio artifacts with playback or download controls
- [x] 6.4 Show capability errors in conversation results with guidance to configure the missing specialist

## 7. Verification

- [x] 7.1 Verify model discovery works against a valid OpenAI-compatible provider and does not require manual model typing
- [x] 7.2 Verify invalid discovery credentials return an error and do not create a saved profile
- [x] 7.3 Verify only one primary profile can remain selected after saving multiple profiles
- [x] 7.4 Verify normal chat uses the primary orchestrator when configured and falls back when it is not configured
- [x] 7.5 Verify each multimodal capability reports a clear missing-specialist error when no enabled profile exists
- [x] 7.6 Verify image analysis, image generation, image editing, speech-to-text, and text-to-speech flows create the expected conversation outputs or artifacts
- [x] 7.7 Run `npm run typecheck` and fix TypeScript errors
