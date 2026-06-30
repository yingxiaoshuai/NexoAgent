## 1. Shared Profile State

- [x] 1.1 Add shared model-profile loading state so the chat homepage can tell whether any saved model profiles exist.
- [x] 1.2 Refresh that shared model-profile state during app startup and after model create, update, or delete actions.

## 2. Homepage Onboarding UI

- [x] 2.1 Create a dedicated empty-homepage onboarding component with concise copy, essential provider connection inputs, discovered model selection, and a primary save action.
- [x] 2.2 Replace the generic empty chat suggestions with the onboarding flow when there are no saved model profiles.
- [x] 2.3 Block first-turn chat sending while onboarding is active and show a clear helper message that a model must be added first.
- [x] 2.4 Add a low-emphasis action from the onboarding flow to open the full Settings experience.

## 3. Discovery And Save Flow

- [x] 3.1 Reuse the existing homepage discovery behavior for provider defaults, optional API-key providers, loading states, and inline error handling.
- [x] 3.2 Save the onboarding-selected model as an enabled primary profile with sensible defaults and inferred capabilities.
- [x] 3.3 Refresh profile state after a successful save and return the homepage to the normal chat-ready empty state.

## 4. Verification

- [x] 4.1 Verify that a fresh workspace with zero saved model profiles lands on homepage onboarding instead of the generic empty chat state.
- [x] 4.2 Verify that discovery or save failure keeps the user on the homepage with a clear error and no broken profile saved.
- [x] 4.3 Verify that a successful homepage save immediately enables normal chat input and the next message uses the new primary model profile.
