"use server";

import type { ModelMessage } from "ai";
import {
  clearSessionMessages,
  createAgent,
  DEFAULT_SESSION_ID,
  getSessionMessages,
  getSessionTokenUsage,
  listAgentSessions,
  listAgents,
  type Agent,
  type AgentSession,
  type SessionTokenUsage,
} from "@/lib/agents";

export async function listAgentsAction(): Promise<Agent[]> {
  return listAgents();
}

export async function createAgentAction(input: { name: string; id: string }): Promise<Agent> {
  return createAgent(input);
}

export async function getSessionMessagesAction(input: {
  agentId: string;
  sessionId?: string;
}): Promise<ModelMessage[]> {
  return getSessionMessages(input.agentId, input.sessionId ?? DEFAULT_SESSION_ID);
}

export async function listAgentSessionsAction(input: {
  agentId: string;
}): Promise<AgentSession[]> {
  return listAgentSessions(input.agentId);
}

export async function startFreshDefaultSessionAction(input: {
  agentId: string;
}): Promise<void> {
  return clearSessionMessages(input.agentId, DEFAULT_SESSION_ID);
}

export async function getSessionTokenUsageAction(input: {
  agentId: string;
  sessionId?: string;
}): Promise<SessionTokenUsage> {
  return getSessionTokenUsage(input.agentId, input.sessionId ?? DEFAULT_SESSION_ID);
}
