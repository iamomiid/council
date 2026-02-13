"use server";

import type { ModelMessage } from "ai";
import {
  addAgentMcpServer,
  clearSessionMessages,
  createAgent,
  DEFAULT_SESSION_ID,
  deleteAgentMcpServer,
  getAgentSystemPrompt,
  getSessionMessages,
  getSessionTokenUsage,
  listAgentMcpServers,
  listAgentSessions,
  listAgents,
  updateAgentMcpServer,
  type Agent,
  type AgentMcpServer,
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

export async function getAgentSystemPromptAction(input: {
  agentId: string;
}): Promise<string> {
  return getAgentSystemPrompt(input.agentId);
}

export async function listAgentMcpServersAction(input: {
  agentId: string;
}): Promise<AgentMcpServer[]> {
  return listAgentMcpServers(input.agentId);
}

export async function addAgentMcpServerAction(input: {
  agentId: string;
  server: AgentMcpServer;
}): Promise<AgentMcpServer[]> {
  return addAgentMcpServer(input);
}

export async function updateAgentMcpServerAction(input: {
  agentId: string;
  serverId: string;
  server: AgentMcpServer;
}): Promise<AgentMcpServer[]> {
  return updateAgentMcpServer(input);
}

export async function deleteAgentMcpServerAction(input: {
  agentId: string;
  serverId: string;
}): Promise<AgentMcpServer[]> {
  return deleteAgentMcpServer(input);
}
