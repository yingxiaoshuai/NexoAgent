export type RuntimeSurface = "desktop" | "web";
export type ConversationSurface = "chat" | "browser";

export type ProviderId =
  | "openai-compatible"
  | "anthropic-compatible";

export type PlanningMode = "fast" | "balanced" | "deep";
export type ThinkingEffort = "high" | "max";

export type ModelContextSource =
  | "user"
  | "profile"
  | "dictionary"
  | "provider"
  | "lookup"
  | "cache"
  | "default";

export const MODEL_CAPABILITIES = [
  "orchestration",
  "chat",
  "vision",
  "image_generation",
  "image_editing",
  "speech_to_text",
  "text_to_speech",
  "embedding",
] as const;

export type ModelCapability = typeof MODEL_CAPABILITIES[number];

export type AttachmentType = "image" | "audio" | "file";

export function isModelCapability(value: unknown): value is ModelCapability {
  return typeof value === "string" && (MODEL_CAPABILITIES as readonly string[]).includes(value);
}

export type ChannelKey =
  | "web"
  | "desktop"
  | "feishu"
  | "dingtalk"
  | "wechat"
  | "wecom";

export interface ModelContextBudget {
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
  autoCompactTokenLimit?: number;
  compactionTargetRatio?: number;
  contextWindowSource?: ModelContextSource;
  contextWindowSourceDetail?: string;
  contextWindowResolvedAt?: string;
}

export type CircuitBreakerReason =
  | "repeated_visible_output"
  | "repeated_tool_calls"
  | "consecutive_failures"
  | "token_budget";

export interface CircuitBreakerInfo {
  reason: CircuitBreakerReason;
  detail: string;
  step: number;
}

export interface AgentSettings extends ModelContextBudget {
  providerId: ProviderId;
  providerName: string;
  apiBase: string;
  apiKey: string;
  hasApiKey: boolean;
  model: string;
  temperature: number;
  maxContextTurns: number;
  enableContextCompaction: boolean;
  contextCompactionThreshold: number;
  /** Default timeout for shell_command when timeoutMs is omitted (ms). */
  shellCommandTimeoutMs: number;
  planningMode: PlanningMode;
  thinkingEnabled: boolean;
  thinkingEffort: ThinkingEffort;
  circuitBreakerEnabled: boolean;
  circuitBreakerConsecutiveFailureLimit: number;
  circuitBreakerRepeatedToolCallLimit: number;
  circuitBreakerTokenBudget: number;
  enableMemory: boolean;
  enableKnowledge: boolean;
  workspacePath: string;
  /** Extra directories used for workspace path resolution and shell cwd selection (absolute paths). */
  fileAccessRoots?: string[];
  webHost: string;
  webPort: number;
  webPassword: string;
  channels: Record<ChannelKey, boolean>;
}

export interface RuntimeInfo {
  surface: RuntimeSurface;
  platform: string;
  version: string;
  userDataPath?: string;
  webBaseUrl?: string;
}

export type BrowserAction =
  | "snapshot"
  | "resolve"
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "run"
  | "script"
  | "screenshot"
  | "refresh"
  | "back"
  | "forward";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserRelativePosition {
  xRatio: number;
  yRatio: number;
}

export interface BrowserTargetDescriptor {
  ref?: string;
  query?: string;
  role?: string;
  text?: string;
  selector?: string;
  xpath?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearText?: string;
  bounds?: BrowserBounds;
  relativePosition?: BrowserRelativePosition;
}

export interface BrowserElementSnapshot {
  ref: string;
  tag: string;
  role?: string;
  name: string;
  text?: string;
  value?: string;
  type?: string;
  href?: string;
  editable?: boolean;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  bounds?: BrowserBounds;
}

export interface BrowserElementDescriptor extends BrowserElementSnapshot {
  ariaLabel?: string;
  label?: string;
  title?: string;
  placeholder?: string;
  identity?: string;
  heading?: string;
  context?: string;
  nearbyText?: string;
  descriptorText?: string;
  visible?: boolean;
  enabled?: boolean;
}

export interface BrowserResolveCandidate extends BrowserElementDescriptor {
  confidence: number;
  lexicalScore: number;
  roleScore: number;
  contextScore: number;
  stateScore: number;
  reasons: string[];
}

export interface BrowserResolveResult {
  query: string;
  candidates: BrowserResolveCandidate[];
  resolver: "ax-tree";
  needsDisambiguation?: boolean;
  needsVisionFallback?: boolean;
  strictActionMismatch?: boolean;
  selectedRef?: string;
  minConfidence: number;
}

export type BrowserRunOperation =
  | "navigate"
  | "resolve"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "wheel"
  | "hover"
  | "drag"
  | "wait"
  | "screenshot"
  | "back"
  | "forward"
  | "refresh";

export type BrowserActionStrategy =
  | "auto"
  | "dom"
  | "css"
  | "xpath"
  | "cdp"
  | "coordinate"
  | "visionFallback";

export type BrowserRunFailureAction =
  | "snapshot"
  | "resolve"
  | "scroll"
  | "return-candidates";

export interface BrowserRunFailurePolicy {
  retry?: BrowserRunFailureAction[];
  maxAttempts?: number;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  continueOnError?: boolean;
}

export interface BrowserRunStep {
  op: BrowserRunOperation;
  target?: BrowserTargetDescriptor;
  strategy?: BrowserActionStrategy;
  onFailure?: BrowserRunFailurePolicy;
  url?: string;
  text?: string;
  key?: string;
  submit?: boolean;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  deltaX?: number;
  deltaY?: number;
  waitMs?: number;
  durationMs?: number;
  minConfidence?: number;
}

export interface BrowserRunStepResult {
  index: number;
  op: BrowserRunOperation;
  ok: boolean;
  strategy: string;
  target?: BrowserTargetDescriptor;
  selectedRef?: string;
  selectedBounds?: BrowserBounds;
  confidence?: number;
  resolve?: BrowserResolveResult;
  interaction?: BrowserInteractionResult;
  artifact?: BrowserArtifact;
  retries?: BrowserRunFailureAction[];
  warning?: string;
  error?: string;
}

export interface BrowserScriptResultValue {
  format: "json" | "inspect";
  type: string;
  value?: unknown;
  text?: string;
  truncated?: boolean;
}

export interface BrowserScriptError {
  name: string;
  message: string;
  stack?: string;
}

export interface BrowserScriptExecutionResult {
  durationMs: number;
  timedOut?: boolean;
  result?: BrowserScriptResultValue;
  error?: BrowserScriptError;
}

export interface BrowserRunTrace {
  goal?: string;
  strategy?: BrowserActionStrategy;
  onFailure?: BrowserRunFailurePolicy;
  steps: BrowserRunStepResult[];
  completedSteps: number;
  totalSteps: number;
  finalUrl: string;
  finalTitle: string;
}

export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  presentation: "hidden" | "workbench";
  zoomFactor?: number;
  history?: BrowserHistoryEntry[];
  elements: BrowserElementSnapshot[];
  resolve?: BrowserResolveResult;
  text: string;
  lastAction?: BrowserAction;
  warning?: string;
  error?: string;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  timestamp: string;
  action: BrowserAction;
}

export interface BrowserArtifact {
  url: string;
  path: string;
  name: string;
  type: string;
  mimeType: string;
  size: number;
}

export interface BrowserInteractionResult {
  action: BrowserAction | BrowserRunOperation;
  ref?: string;
  query?: string;
  strategy?: string;
  bounds?: BrowserBounds;
  x?: number;
  y?: number;
  fallbackX?: number;
  fallbackY?: number;
}

export interface BrowserPickedElement {
  tag: string;
  role?: string;
  name: string;
  text?: string;
  value?: string;
  type?: string;
  href?: string;
  editable?: boolean;
  selector?: string;
  bounds?: BrowserBounds;
}

export interface BrowserElementPickResult {
  ok: boolean;
  url: string;
  title: string;
  element?: BrowserPickedElement;
  error?: string;
}

export interface BrowserActionRequest {
  action: BrowserAction;
  url?: string;
  text?: string;
  goal?: string;
  script?: string;
  args?: unknown[];
  target?: BrowserTargetDescriptor;
  steps?: BrowserRunStep[];
  strategy?: BrowserActionStrategy;
  onFailure?: BrowserRunFailurePolicy;
  key?: string;
  submit?: boolean;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  deltaX?: number;
  deltaY?: number;
  waitMs?: number;
  durationMs?: number;
  timeoutMs?: number;
  limit?: number;
  minConfidence?: number;
}

export interface BrowserActionResponse extends BrowserState {
  ok: boolean;
  artifact?: BrowserArtifact;
  interaction?: BrowserInteractionResult;
  run?: BrowserRunTrace;
  script?: BrowserScriptExecutionResult;
}

export type ChatRole = "system" | "user" | "assistant";
export type ChatMessageStatus = "sending" | "completed" | "interrupted" | "needs_input" | "failed" | "undone";
export type TurnCompletionStatus = Exclude<ChatMessageStatus, "sending">;

export interface Attachment {
  url: string;
  name: string;
  type: AttachmentType;
  mimeType?: string;
  size?: number;
  source?: "upload" | "generated";
}

export interface ToolCallTrace {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  elapsed?: number;
  status: "running" | "done" | "error";
}

export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "tool"; id: string };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status?: ChatMessageStatus;
  attachments?: Attachment[];
  meta?: {
    undoneAt?: string;
    undoneMessage?: string;
    toolCalls?: ToolCallTrace[];
    messageBlocks?: MessageBlock[];
  };
}

export interface ToolCapability {
  key: string;
  name: string;
  group: "system" | "research" | "productivity" | "extension";
  status: "ready" | "needs-config" | "disabled";
  risk: "low" | "medium" | "high";
  description: string;
}

export interface ModelProfile extends ModelContextBudget {
  id: string;
  name: string;
  providerId: ProviderId;
  providerName?: string;
  apiBase: string;
  apiKey: string;
  hasApiKey: boolean;
  model: string;
  capabilities?: ModelCapability[];
  isPrimary?: boolean;
  temperature?: number;
  thinkingEnabled?: boolean;
  thinkingEffort?: ThinkingEffort;
  description?: string;
  enabled: boolean;
}

export interface DiscoveredModel extends ModelContextBudget {
  id: string;
  label: string;
  ownedBy?: string;
  capabilities: ModelCapability[];
  metadata?: Record<string, unknown>;
}

export interface SkillDefinition {
  key: string;
  name: string;
  category: string;
  enabled: boolean;
  source: "built-in" | "workspace" | "marketplace";
  description: string;
  instruction?: string;
  path?: string;
  managed?: boolean;
  marketplaceId?: string;
  marketplaceName?: string;
  homepage?: string;
  author?: string;
  version?: string;
  contentSize?: number;
}

export interface SkillMarketplace {
  id: string;
  name: string;
  description: string;
  homepage: string;
  cli?: string;
  installHint: string;
  searchEnabled: boolean;
  installEnabled: boolean;
  directSpecOnly?: boolean;
  notes?: string;
}

export interface SkillMarketplaceSearchResult {
  id: string;
  marketplaceId: string;
  marketplaceName: string;
  name: string;
  description: string;
  installSpec: string;
  installCommandPreview: string;
  homepage?: string;
  author?: string;
  installs?: string;
  verified?: boolean;
}

export interface SkillSearchResponse {
  query: string;
  results: SkillMarketplaceSearchResult[] | SkillDefinition[];
  warnings: string[];
  marketplaceResults?: SkillMarketplaceSearchResult[];
}

export interface SkillInstallRequest {
  marketplaceId: string;
  installSpec: string;
  key?: string;
  name?: string;
  homepage?: string;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type McpServerConnectionStatus = "connected" | "empty" | "error";

export interface McpServerStatus {
  serverName: string;
  toolCount: number;
  status: McpServerConnectionStatus;
  error?: string;
  toolNames: string[];
}

export interface McpServerListItem extends McpServerConfig {
  runtimeStatus?: McpServerStatus;
}

export interface KnowledgeItem {
  key: string;
  title: string;
  kind: "memory" | "document" | "entity" | "routine";
  confidence: number;
  updatedAt: string;
  summary: string;
}
