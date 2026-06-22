## ADDED Requirements

### Requirement: Automatic provider model discovery
The system MUST accept an API Base and API Key, call an OpenAI-compatible `/models` endpoint, and present the returned models as selectable options without requiring the user to manually type a model name first.

#### Scenario: Load available models from provider
- **WHEN** a user enters a reachable API Base and a valid API Key
- **THEN** the system returns the provider's model list for selection

#### Scenario: Reject invalid discovery request
- **WHEN** the provider credentials are invalid or the endpoint returns an error
- **THEN** the system surfaces the failure and does not save a broken discovery result

### Requirement: Capabilities are inferred and editable
The system MUST assign one or more capabilities to each discovered model and allow the user to edit those capabilities before saving a profile.

#### Scenario: Infer vision support
- **WHEN** a discovered model identifier or metadata indicates vision support
- **THEN** the system marks the model as vision-capable by default

#### Scenario: Override inferred capabilities
- **WHEN** the user changes the capability set before saving
- **THEN** the saved profile uses the user-selected capabilities

### Requirement: Discovery results can be saved as reusable profiles
The system MUST allow a discovered model to be saved as a profile that retains provider connection data, model identifier, capability tags, and enabled state.

#### Scenario: Save discovered model
- **WHEN** the user saves a discovered model as a profile
- **THEN** the system persists the provider base URL, API key reference, model identifier, and capabilities

#### Scenario: Keep API key on edit
- **WHEN** the user edits a saved profile without entering a new API key
- **THEN** the existing API key remains available to the profile
