## ADDED Requirements

### Requirement: Homepage model setup replaces the first-run empty chat state
The system MUST replace the generic empty chat homepage with a model setup onboarding experience when the active chat session is empty and no saved model profiles exist.

#### Scenario: First-run homepage requires model setup
- **WHEN** the active chat session has no messages and the workspace has no saved model profiles
- **THEN** the homepage shows a model setup onboarding instead of the generic conversation suggestions
- **AND** the user cannot submit a normal chat message from that homepage until model setup succeeds

#### Scenario: Existing model profiles keep the normal homepage
- **WHEN** at least one saved model profile exists
- **THEN** the chat homepage continues to use the normal empty-state and message flow

### Requirement: Homepage onboarding stays minimal and clear
The homepage onboarding MUST expose only the minimum setup controls needed to create a working model and MUST provide a direct path to full Settings for advanced configuration.

#### Scenario: Homepage setup shows only essential controls
- **WHEN** the homepage onboarding is shown
- **THEN** it shows only the provider connection fields needed for model discovery, a discovered model selector, and a primary save action
- **AND** it does not require the user to configure advanced tuning fields such as context budgets, thinking options, or specialist capabilities

#### Scenario: Advanced setup still goes through Settings
- **WHEN** the user needs advanced model management or non-minimal configuration
- **THEN** the homepage onboarding provides a direct action that opens the full Settings experience

### Requirement: Homepage onboarding reuses provider discovery and validates inline
The homepage onboarding MUST reuse the existing provider model discovery behavior and MUST surface discovery or save failures inline without leaving the homepage.

#### Scenario: Discover models from the homepage
- **WHEN** the user enters a reachable API Base and the required provider credentials in the homepage onboarding
- **THEN** the system returns available models for selection in the same homepage flow

#### Scenario: Allow providers that do not require an API key
- **WHEN** the selected provider connection allows model discovery without an API key
- **THEN** the homepage onboarding allows discovery and save without forcing an API key value

#### Scenario: Discovery or save failure stays on the homepage
- **WHEN** model discovery or model save fails because the connection is invalid or the provider returns an error
- **THEN** the homepage onboarding stays visible
- **AND** the system shows a clear inline failure message
- **AND** the system does not save a broken model profile

### Requirement: Successful homepage onboarding creates a chat-ready primary model
The system MUST save a successful homepage onboarding selection as an enabled primary orchestration profile so chat works immediately after setup.

#### Scenario: Save the first onboarding-created model
- **WHEN** the user selects a discovered model and confirms the homepage onboarding
- **THEN** the system saves an enabled primary model profile with the provider connection, model identifier, and inferred capabilities needed for orchestration

#### Scenario: Chat unlocks immediately after onboarding
- **WHEN** the homepage onboarding save succeeds
- **THEN** the onboarding disappears from the homepage
- **AND** the next chat request uses the newly saved primary model profile
