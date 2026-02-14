import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LanguageModelUsage, ModelMessage } from "ai";
import { redis } from "@/lib/redis";

const KEY_PREFIX = "council:v1";
export const DEFAULT_SESSION_ID = "default";

const agentsIndexKey = () => `${KEY_PREFIX}:agents`;
const agentKey = (agentId: string) => `${KEY_PREFIX}:agent:${agentId}`;
const agentSessionsKey = (agentId: string) => `${agentKey(agentId)}:sessions`;
const sessionKey = (agentId: string, sessionId: string) =>
  `${agentKey(agentId)}:session:${sessionId}`;
const sessionMessagesKey = (agentId: string, sessionId: string) =>
  `${sessionKey(agentId, sessionId)}:messages`;

export type Agent = {
  id: string;
  name: string;
};

export type AgentMcpServer = {
  id: string;
  name: string;
  transport: "http" | "sse";
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
};

export type AgentSession = {
  id: string;
};

export type SessionTokenUsage = {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export async function listAgents(): Promise<Agent[]> {
  const ids = await redis.smembers<string[]>(agentsIndexKey());

  if (ids.length === 0) {
    return [];
  }

  const items = await Promise.all(
    ids.map(async (id) => {
      const record = await redis.hgetall<{ id?: string; name?: string }>(agentKey(id));
      if (!record?.id || !record.name) {
        return null;
      }
      return { id: record.id, name: record.name } satisfies Agent;
    }),
  );

  return items
    .filter((item): item is Agent => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createAgent(input: { id: string; name: string }): Promise<Agent> {
  const name = input.name.trim();
  const id = input.id.trim();

  if (!name) {
    throw new Error("Agent name is required");
  }

  if (!id) {
    throw new Error("Agent id is required");
  }

  const exists = await redis.exists(agentKey(id));

  if (exists) {
    throw new Error("Agent id already exists");
  }

  const createdAt = new Date().toISOString();
  const bootstrapPrompt = await getBootstrapSystemPrompt();

  await redis.hset(agentKey(id), {
    id,
    name,
    systemPrompt: bootstrapPrompt,
    mcpServers: "[]",
    createdAt,
    updatedAt: createdAt,
  });
  await redis.sadd(agentsIndexKey(), id);
  await ensureSession(id, DEFAULT_SESSION_ID, createdAt);

  return { id, name };
}

export async function getSessionMessages(
  agentId: string,
  sessionId: string,
): Promise<ModelMessage[]> {
  await assertAgentExists(agentId);
  const raw = await redis.lrange<ModelMessage>(sessionMessagesKey(agentId, sessionId), 0, -1);
  return raw;
}

export async function listAgentSessions(agentId: string): Promise<AgentSession[]> {
  await assertAgentExists(agentId);
  const sessions = await redis.smembers<string[]>(agentSessionsKey(agentId));

  if (sessions.length === 0) {
    const now = new Date().toISOString();
    await ensureSession(agentId, DEFAULT_SESSION_ID, now);
    return [{ id: DEFAULT_SESSION_ID }];
  }

  const sorted = [...sessions].sort((a, b) => {
    if (a === DEFAULT_SESSION_ID) {
      return -1;
    }
    if (b === DEFAULT_SESSION_ID) {
      return 1;
    }
    return a.localeCompare(b);
  });

  return sorted.map((id) => ({ id }));
}

export async function appendSessionMessage(input: {
  agentId: string;
  sessionId: string;
  message: ModelMessage;
}): Promise<ModelMessage> {
  await assertAgentExists(input.agentId);

  const timestamp = new Date().toISOString();
  const message = input.message;

  await ensureSession(input.agentId, input.sessionId, timestamp);
  await redis.rpush(sessionMessagesKey(input.agentId, input.sessionId), message);
  await redis.hset(sessionKey(input.agentId, input.sessionId), {
    updatedAt: timestamp,
    lastMessageAt: timestamp,
  });

  return message;
}

export async function appendSessionMessages(input: {
  agentId: string;
  sessionId: string;
  messages: ModelMessage[];
}): Promise<void> {
  if (input.messages.length === 0) {
    return;
  }

  await assertAgentExists(input.agentId);

  const timestamp = new Date().toISOString();
  await ensureSession(input.agentId, input.sessionId, timestamp);
  await redis.rpush(sessionMessagesKey(input.agentId, input.sessionId), ...input.messages);
  await redis.hset(sessionKey(input.agentId, input.sessionId), {
    updatedAt: timestamp,
    lastMessageAt: timestamp,
  });
}

export async function clearSessionMessages(
  agentId: string,
  sessionId: string,
): Promise<void> {
  await assertAgentExists(agentId);

  const timestamp = new Date().toISOString();
  await ensureSession(agentId, sessionId, timestamp);
  await redis.del(sessionMessagesKey(agentId, sessionId));
  await redis.hset(sessionKey(agentId, sessionId), {
    updatedAt: timestamp,
    usageInputTokens: 0,
    usageReasoningTokens: 0,
    usageOutputTokens: 0,
    usageTotalTokens: 0,
  });
}

export async function getSessionTokenUsage(
  agentId: string,
  sessionId: string,
): Promise<SessionTokenUsage> {
  await assertAgentExists(agentId);
  const record = await redis.hgetall<{
    usageInputTokens?: string | number;
    usageReasoningTokens?: string | number;
    usageOutputTokens?: string | number;
    usageTotalTokens?: string | number;
  }>(sessionKey(agentId, sessionId));

  return {
    inputTokens: asNumber(record?.usageInputTokens),
    reasoningTokens: asNumber(record?.usageReasoningTokens),
    outputTokens: asNumber(record?.usageOutputTokens),
    totalTokens: asNumber(record?.usageTotalTokens),
  };
}

export async function addSessionTokenUsage(input: {
  agentId: string;
  sessionId: string;
  usage: LanguageModelUsage;
}): Promise<SessionTokenUsage> {
  const current = await getSessionTokenUsage(input.agentId, input.sessionId);
  const inputTokens = input.usage.inputTokens ?? 0;
  const outputTokens = input.usage.outputTokens ?? 0;
  const reasoningTokens =
    input.usage.outputTokenDetails.reasoningTokens ?? input.usage.reasoningTokens ?? 0;
  const totalTokens = input.usage.totalTokens ?? inputTokens + outputTokens;

  const next: SessionTokenUsage = {
    inputTokens: current.inputTokens + inputTokens,
    reasoningTokens: current.reasoningTokens + reasoningTokens,
    outputTokens: current.outputTokens + outputTokens,
    totalTokens: current.totalTokens + totalTokens,
  };

  await redis.hset(sessionKey(input.agentId, input.sessionId), {
    usageInputTokens: next.inputTokens,
    usageReasoningTokens: next.reasoningTokens,
    usageOutputTokens: next.outputTokens,
    usageTotalTokens: next.totalTokens,
    updatedAt: new Date().toISOString(),
  });

  return next;
}

export async function getAgentSystemPrompt(agentId: string): Promise<string> {
  const agent = await assertAgentExists(agentId);
  return agent.systemPrompt ?? (await getBootstrapSystemPrompt());
}

export async function updateAgentSystemPrompt(input: {
  agentId: string;
  systemPrompt: string;
}): Promise<void> {
  const nextPrompt = input.systemPrompt.trim();
  if (!nextPrompt) {
    throw new Error("System prompt is required");
  }

  await assertAgentExists(input.agentId);
  await redis.hset(agentKey(input.agentId), {
    systemPrompt: nextPrompt,
    updatedAt: new Date().toISOString(),
  });
}

export async function resetAgentSystemPrompt(agentId: string): Promise<void> {
  await assertAgentExists(agentId);
  const bootstrapPrompt = await getBootstrapSystemPrompt();
  await redis.hset(agentKey(agentId), {
    systemPrompt: bootstrapPrompt,
    updatedAt: new Date().toISOString(),
  });
}

export async function listAgentMcpServers(agentId: string): Promise<AgentMcpServer[]> {
  const agent = await assertAgentExists(agentId);
  return parseStoredMcpServers(agent.mcpServers);
}

export async function addAgentMcpServer(input: {
  agentId: string;
  server: AgentMcpServer;
}): Promise<AgentMcpServer[]> {
  const agent = await assertAgentExists(input.agentId);
  const servers = parseStoredMcpServers(agent.mcpServers);
  const next = normalizeMcpServer(input.server);

  if (servers.some((server) => server.id === next.id)) {
    throw new Error(`MCP server id already exists: ${next.id}`);
  }

  const updated = [...servers, next].sort((a, b) => a.name.localeCompare(b.name));
  await saveAgentMcpServers(input.agentId, updated);
  return updated;
}

export async function updateAgentMcpServer(input: {
  agentId: string;
  serverId: string;
  server: AgentMcpServer;
}): Promise<AgentMcpServer[]> {
  const agent = await assertAgentExists(input.agentId);
  const servers = parseStoredMcpServers(agent.mcpServers);
  const targetId = input.serverId.trim();

  if (!targetId) {
    throw new Error("MCP server id is required");
  }

  const index = servers.findIndex((server) => server.id === targetId);
  if (index < 0) {
    throw new Error(`MCP server not found: ${targetId}`);
  }

  const next = normalizeMcpServer(input.server);
  const hasCollision = servers.some((server) => server.id === next.id && server.id !== targetId);
  if (hasCollision) {
    throw new Error(`MCP server id already exists: ${next.id}`);
  }

  const updated = [...servers];
  updated[index] = next;
  updated.sort((a, b) => a.name.localeCompare(b.name));
  await saveAgentMcpServers(input.agentId, updated);
  return updated;
}

export async function deleteAgentMcpServer(input: {
  agentId: string;
  serverId: string;
}): Promise<AgentMcpServer[]> {
  const agent = await assertAgentExists(input.agentId);
  const servers = parseStoredMcpServers(agent.mcpServers);
  const targetId = input.serverId.trim();

  if (!targetId) {
    throw new Error("MCP server id is required");
  }

  const updated = servers.filter((server) => server.id !== targetId);
  if (updated.length === servers.length) {
    throw new Error(`MCP server not found: ${targetId}`);
  }

  await saveAgentMcpServers(input.agentId, updated);
  return updated;
}

async function assertAgentExists(agentId: string): Promise<{
  id: string;
  name: string;
  systemPrompt?: string;
  mcpServers?: unknown;
}> {
  const agent = await redis.hgetall<{
    id?: string;
    name?: string;
    systemPrompt?: string;
    mcpServers?: unknown;
  }>(agentKey(agentId));
  if (!agent?.id || !agent.name) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return {
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    mcpServers: agent.mcpServers,
  };
}

async function ensureSession(
  agentId: string,
  sessionId: string,
  timestamp: string,
) {
  const scopedAgentKey = agentKey(agentId);
  const scopedSessionKey = sessionKey(agentId, sessionId);
  const alreadyExists = await redis.exists(scopedSessionKey);

  await redis.sadd(agentSessionsKey(agentId), sessionId);
  if (!alreadyExists) {
    await redis.hset(scopedSessionKey, {
      id: sessionId,
      agentId,
      createdAt: timestamp,
      updatedAt: timestamp,
      usageInputTokens: 0,
      usageReasoningTokens: 0,
      usageOutputTokens: 0,
      usageTotalTokens: 0,
    });
  } else {
    await redis.hset(scopedSessionKey, {
      updatedAt: timestamp,
    });
  }

  await redis.hset(scopedAgentKey, {
    updatedAt: timestamp,
  });
}

let bootstrapPromptCache: string | null = null;

async function getBootstrapSystemPrompt(): Promise<string> {
  if (bootstrapPromptCache) {
    return bootstrapPromptCache;
  }

  const candidates = ["bootstrap.md", "BOOTSTRAP.md", "lib/bootstrap.md", "lib/BOOTSTRAP.md"];

  for (const relativePath of candidates) {
    const fullPath = path.join(process.cwd(), relativePath);
    try {
      const content = await readFile(fullPath, "utf-8");
      const trimmed = content.trim();
      if (!trimmed) {
        continue;
      }
      bootstrapPromptCache = trimmed;
      return bootstrapPromptCache;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    "Missing bootstrap.md (checked bootstrap.md, BOOTSTRAP.md, lib/bootstrap.md, lib/BOOTSTRAP.md)",
  );
}

function asNumber(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseStoredMcpServers(value: unknown): AgentMcpServer[] {
  if (!value) {
    return [];
  }

  const parsed = normalizeStoredMcpPayload(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const servers: AgentMcpServer[] = [];
  for (const item of parsed) {
    try {
      servers.push(normalizeMcpServer(item));
    } catch {
      // Skip malformed entries to keep existing agents usable.
    }
  }
  return servers;
}

function normalizeStoredMcpPayload(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return normalizeStoredMcpPayload(parsed);
    } catch {
      return null;
    }
  }

  if (value && typeof value === "object") {
    const entries = Object.values(value);
    if (entries.every((entry) => entry && typeof entry === "object")) {
      return entries;
    }
  }

  return null;
}

function normalizeMcpServer(input: unknown): AgentMcpServer {
  if (!input || typeof input !== "object") {
    throw new Error("MCP server payload must be an object");
  }

  const value = input as {
    id?: unknown;
    name?: unknown;
    transport?: unknown;
    url?: unknown;
    headers?: unknown;
    enabled?: unknown;
  };

  const id = asNonEmptyString(value.id, "MCP server id is required");
  const name = asNonEmptyString(value.name, "MCP server name is required");
  const transport = normalizeTransport(value.transport);
  const url = asOptionalTrimmedString(value.url);
  const headers = normalizeHeaders(value.headers);
  const enabled = typeof value.enabled === "boolean" ? value.enabled : true;

  if (!url) {
    throw new Error("MCP servers require a URL");
  }

  return {
    id,
    name,
    transport,
    url,
    headers,
    enabled,
  };
}

function normalizeTransport(value: unknown): "http" | "sse" {
  if (value === "sse") {
    return "sse";
  }
  if (value === undefined || value === "http" || value === "streamable-http") {
    return "http";
  }
  throw new Error("Invalid MCP transport. Supported transports: http, sse.");
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue === "string" && key.trim()) {
      headers[key.trim()] = headerValue;
    }
  }
  return headers;
}

function asNonEmptyString(value: unknown, errorMessage: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(errorMessage);
  }
  return value.trim();
}

function asOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

async function saveAgentMcpServers(agentId: string, servers: AgentMcpServer[]): Promise<void> {
  await redis.hset(agentKey(agentId), {
    mcpServers: JSON.stringify(servers),
    updatedAt: new Date().toISOString(),
  });
}
