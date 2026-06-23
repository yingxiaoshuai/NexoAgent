export type RuntimeSurface = "desktop" | "web";

export type ProviderId =
  | "openai-compatible"
  | "anthropic-compatible";

export type PlanningMode = "fast" | "balanced" | "deep";

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
  | "no_progress"
  | "runtime_limit"
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
  maxSteps: number;
  /** Default timeout for shell_command when timeoutMs is omitted (ms). */
  shellCommandTimeoutMs: number;
  planningMode: PlanningMode;
  circuitBreakerEnabled: boolean;
  circuitBreakerConsecutiveFailureLimit: number;
  circuitBreakerRepeatedToolCallLimit: number;
  circuitBreakerNoProgressLimit: number;
  circuitBreakerMaxRuntimeMs: number;
  circuitBreakerTokenBudget: number;
  enableMemory: boolean;
  enableKnowledge: boolean;
  workspacePath: string;
  /** Extra directories file_read/file_write may access (absolute paths). */
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

export type ChatRole = "system" | "user" | "assistant";
export type ChatMessageStatus = "sending" | "completed" | "interrupted" | "needs_input" | "failed";
export type TurnCompletionStatus = Exclude<ChatMessageStatus, "sending">;

export interface Attachment {
  url: string;
  name: string;
  type: AttachmentType;
  mimeType?: string;
  size?: number;
  source?: "upload" | "generated";
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status?: ChatMessageStatus;
  attachments?: Attachment[];
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
