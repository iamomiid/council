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

async function assertAgentExists(agentId: string): Promise<{
  id: string;
  name: string;
  systemPrompt?: string;
}> {
  const agent = await redis.hgetall<{ id?: string; name?: string; systemPrompt?: string }>(
    agentKey(agentId),
  );
  if (!agent?.id || !agent.name) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return {
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.systemPrompt,
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
