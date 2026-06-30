## Why

New users who open the app without any saved model profile currently land on the generic chat homepage and only discover the required model setup after a failed chat or a trip to Settings. We need a first-run experience that makes model setup obvious, immediate, and simple so users can start chatting from the first screen.

## What Changes

- Add a first-run onboarding panel to the chat homepage when no model profiles exist.
- Let users enter only the minimum connection details, discover available models, choose one, and save it without leaving the homepage.
- Save the first onboarding-created model as an enabled primary orchestration profile so chat works immediately after setup.
- Keep advanced model tuning and multi-model management in Settings.

## Capabilities

### New Capabilities
- `homepage-model-onboarding`: Show a simple homepage setup flow for first-time users and create a working primary model directly from that flow.

### Modified Capabilities
_None._

## Impact

- Frontend chat homepage empty-state and onboarding UI in `src/components/ChatPanel/` and related layout/state wiring.
- Reuse existing model discovery and model profile persistence routes in `electron/server/routes/model-profiles.ts`.
- Potential shared model setup helpers between the homepage onboarding flow and `src/components/Settings/index.tsx`.
- No storage migration is required; onboarding writes the same model profile records already used by runtime routing.
