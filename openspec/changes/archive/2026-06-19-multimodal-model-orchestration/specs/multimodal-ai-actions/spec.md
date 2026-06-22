## ADDED Requirements

### Requirement: Image understanding from user attachments
The system MUST accept image attachments for analysis requests and route the work to a vision-capable profile when the user asks about the image content.

#### Scenario: Analyze an uploaded image
- **WHEN** a user sends an image and asks what it contains
- **THEN** the system uses a vision-capable profile and returns a text answer about the image

#### Scenario: No vision specialist exists
- **WHEN** the user asks for image analysis but no enabled vision-capable profile is available
- **THEN** the system returns a clear capability error instead of guessing with a chat-only model

### Requirement: Image generation and editing
The system MUST support generating new images from text prompts and editing existing images from user-supplied sources, and it MUST store the resulting media as managed artifacts.

#### Scenario: Generate a new image
- **WHEN** the user requests a generated image from a prompt
- **THEN** the system routes the request to an image-generation-capable profile and stores the output image

#### Scenario: Edit an existing image
- **WHEN** the user supplies a source image and asks for an edit
- **THEN** the system routes the request to an image-editing-capable profile and returns the edited image artifact

### Requirement: Speech-to-text transcription
The system MUST accept audio input for transcription requests and route the work to a speech-to-text-capable profile.

#### Scenario: Transcribe an uploaded audio file
- **WHEN** a user uploads audio and asks for transcription
- **THEN** the system uses a speech-to-text-capable profile and returns the transcript text

#### Scenario: No STT specialist exists
- **WHEN** the user asks for transcription but no enabled speech-to-text profile is available
- **THEN** the system returns a clear capability error

### Requirement: Text-to-speech output
The system MUST support generating audio output from text and expose the generated audio as a managed artifact.

#### Scenario: Generate speech from text
- **WHEN** the user asks the system to read text aloud
- **THEN** the system uses a text-to-speech-capable profile and returns audio output

#### Scenario: TTS artifact is available in history
- **WHEN** a text-to-speech request succeeds
- **THEN** the conversation or task result includes a stable reference to the generated audio artifact
