## Context

The current first-run chat homepage is the generic empty `MessageList` state with prompt suggestions. Model creation only lives in the Settings page, while runtime failures for missing model setup appear later during chat execution as precondition errors. That means a new user can reach the main screen without a clear next step, type a message, and only then discover that a model must be configured elsewhere.

This change crosses the chat homepage, shared app state, and model-profile management flow, but it does not require a new backend contract. The existing `/api/model-profiles/discover` and `/api/model-profiles` routes already support the data we need.

## Goals / Non-Goals

**Goals:**
- Make the first-run no-model state obvious from the chat homepage before the user hits a runtime error.
- Let the user create one working model with the fewest possible inputs.
- Reuse existing model discovery and save behavior instead of inventing a second backend workflow.
- Transition directly from onboarding to a chat-ready state after the first successful save.

**Non-Goals:**
- Replace the full Settings model-management experience.
- Expose advanced model tuning on the homepage.
- Migrate legacy fallback settings into model profiles automatically.
- Redesign chat behavior for every model-misconfiguration case beyond the first-run empty homepage.

## Decisions

### 1. Detect onboarding from saved model-profile state, not from a failed chat

The homepage should know whether any saved model profiles exist before the first message is sent. The cleanest path is to promote model-profile availability into shared app state so the chat homepage and Settings can react to the same source of truth.

Why this over waiting for a runtime error:
- It removes the confusing “send first, fail second” experience.
- It keeps the first-run guidance attached to the homepage the user already sees.

Alternative considered:
- Show a CTA only after the runtime returns `No primary model is configured.`  
Rejected because it preserves the current confusing path and creates an avoidable failed first impression.

### 2. Build a dedicated homepage onboarding UI, but share the discovery/save logic

The Settings model modal is feature-rich and optimized for ongoing management, not first-run clarity. The homepage should use a dedicated minimal UI with concise copy and only the essential controls. To avoid behavior drift, discovery/save helpers should be shared where practical even if the homepage and Settings use different visual components.

Why this over reusing the full Settings UI:
- The existing Settings model form includes fields and concepts that are unnecessary for first-run success.
- A dedicated homepage surface can be much clearer without weakening the advanced flow.

Alternative considered:
- Embed the Settings modal directly into the homepage.  
Rejected because it is too dense for the requested “simple and clear” onboarding.

### 3. Reuse the existing discovery and save routes, and save the first model as primary

The homepage should call the same discovery route used by Settings and save through the same model-profile route. The onboarding save should explicitly create an enabled primary profile so chat becomes usable immediately without requiring a second configuration step.

Why this over adding a new “quick setup” API:
- Existing routes already support provider connection data, discovered model IDs, capabilities, and saved API keys.
- Reusing the same persistence path avoids a second source of truth.

Alternative considered:
- Add a dedicated backend quick-setup endpoint.  
Rejected because it duplicates model-profile logic without adding meaningful capability.

### 4. Block the first-turn chat input while homepage onboarding is active

If onboarding is visible but the user can still send a message, the confusing failure path still exists. The chat homepage should therefore suppress the generic suggestion chips and prevent normal sending until setup succeeds.

Why this over leaving input active:
- It keeps the first-run experience single-path and self-explanatory.
- It prevents avoidable `precondition_failed` chat turns.

Alternative considered:
- Keep input enabled and rely on the onboarding card as a suggestion.  
Rejected because it is still easy for a new user to skip the card and hit the same failure.

### 5. Keep a direct escape hatch to full Settings

Minimal onboarding will not cover every provider nuance or advanced configuration need. The homepage should include a low-emphasis path to Settings so power users can leave the simplified flow without friction.

## Risks / Trade-offs

- [Shared state drift] Homepage onboarding and Settings can become inconsistent if each manages model profiles independently. → Centralize profile loading/refresh behavior in shared state or a shared helper.
- [Legacy no-profile users] Rare existing users who still rely on fallback non-profile settings may see the onboarding until they create a profile. → Keep the homepage copy neutral and provide a one-click Settings path.
- [Provider discovery latency] Some `/models` endpoints are slow or flaky. → Preserve inline loading, retry, and clear error states instead of navigating away.
- [UI duplication] A second model setup entry point can drift from Settings. → Share discovery/save logic and keep the homepage surface intentionally narrower than Settings.

## Migration Plan

- No data migration is required.
- Load model-profile availability during normal app startup.
- Rollback is low risk: removing the homepage trigger restores the previous empty-state behavior while leaving saved model profiles untouched.

## Open Questions

- Whether the homepage onboarding should also appear for legacy users who have a usable fallback API key/model in old settings but still have zero saved model profiles. This design assumes the trigger is “no saved model profiles,” because that best matches the requested first-run simplification.
