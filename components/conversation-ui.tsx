"use client";

import {
  addAgentMcpServerAction,
  createAgentAction,
  deleteAgentMcpServerAction,
  getAgentSystemPromptAction,
  getSessionMessagesAction,
  getSessionTokenUsageAction,
  listAgentMemoriesAction,
  listAgentMcpServersAction,
  listAgentSessionsAction,
  listAgentsAction,
  startFreshDefaultSessionAction,
  updateAgentMcpServerAction,
} from "@/lib/actions";
import type { ModelMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FormEvent, useEffect, useRef, useState, useTransition } from "react";

type Agent = {
  id: string;
  name: string;
};

type AgentSession = {
  id: string;
};

type SessionTokenUsage = {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type AgentMcpTransport = "http" | "sse";

type AgentMcpServer = {
  id: string;
  name: string;
  transport: AgentMcpTransport;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
};

type McpServerDraft = {
  id: string;
  name: string;
  transport: AgentMcpTransport;
  url: string;
  headersText: string;
  enabled: boolean;
};

type SidebarTab = "agents" | "sessions" | "mcp";

type AgentMemoryDocument = {
  id: string;
  content: {
    text: string;
    day: string;
    createdAt: string;
    updatedAt: string;
    entries: number;
  };
  metadata?: {
    agentId: string;
    day: string;
  };
};

const DEFAULT_SESSION_ID = "default";
const EMPTY_USAGE: SessionTokenUsage = {
  inputTokens: 0,
  reasoningTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export function ConversationUi() {
  const [messages, setMessages] = useState<ModelMessage[]>([]);
  const [input, setInput] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [mcpServers, setMcpServers] = useState<AgentMcpServer[]>([]);
  const [mcpDrafts, setMcpDrafts] = useState<Record<string, McpServerDraft>>({});
  const [newMcpDraft, setNewMcpDraft] = useState<McpServerDraft>(emptyMcpDraft());
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [isLoadingMcpServers, setIsLoadingMcpServers] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("agents");
  const [isAddingAgent, setIsAddingAgent] = useState(false);
  const [isAddingMcp, setIsAddingMcp] = useState(false);
  const [expandedMcpId, setExpandedMcpId] = useState<string | null>(null);
  const [agentIdInput, setAgentIdInput] = useState("");
  const [agentNameInput, setAgentNameInput] = useState("");
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState(DEFAULT_SESSION_ID);
  const [sessionUsage, setSessionUsage] = useState<SessionTokenUsage>(EMPTY_USAGE);
  const [agentSystemPrompt, setAgentSystemPrompt] = useState("");
  const [isLoadingSystemPrompt, setIsLoadingSystemPrompt] = useState(false);
  const [systemPromptError, setSystemPromptError] = useState<string | null>(null);
  const [memories, setMemories] = useState<AgentMemoryDocument[]>([]);
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const [isSystemPromptExpanded, setIsSystemPromptExpanded] = useState(false);
  const [expandedMemories, setExpandedMemories] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [isSavingAgent, startSaveAgentTransition] = useTransition();
  const [isSavingMcp, startSaveMcpTransition] = useTransition();
  const [isStartingFresh, startFreshTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

  useEffect(() => {
    const loadAgents = async () => {
      try {
        const loadedAgents = await listAgentsAction();
        setAgents(loadedAgents);
        setSelectedAgentId(loadedAgents[0]?.id ?? null);
      } catch {
        setAgents([]);
        setSelectedAgentId(null);
      } finally {
        setIsLoadingAgents(false);
      }
    };

    void loadAgents();
  }, []);

  useEffect(() => {
    if (!selectedAgentId) {
      setSessions([]);
      setMessages([]);
      return;
    }

    const loadSessions = async () => {
      try {
        setIsLoadingSessions(true);
        const loadedSessions = await listAgentSessionsAction({ agentId: selectedAgentId });
        setSessions(loadedSessions);
        setSelectedSessionId(loadedSessions[0]?.id ?? DEFAULT_SESSION_ID);
      } catch {
        setSessions([]);
        setSelectedSessionId(DEFAULT_SESSION_ID);
      } finally {
        setIsLoadingSessions(false);
      }
    };

    void loadSessions();
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setMessages([]);
      setSessionUsage(EMPTY_USAGE);
      return;
    }

    const loadMessages = async () => {
      try {
        setIsLoadingMessages(true);
        const sessionMessages = await getSessionMessagesAction({
          agentId: selectedAgentId,
          sessionId: selectedSessionId,
        });
        setMessages(sessionMessages);
        const usage = await getSessionTokenUsageAction({
          agentId: selectedAgentId,
          sessionId: selectedSessionId,
        });
        setSessionUsage(usage);
      } catch {
        setMessages([]);
        setSessionUsage(EMPTY_USAGE);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    void loadMessages();
  }, [selectedAgentId, selectedSessionId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setMcpServers([]);
      setMcpDrafts({});
      setMcpError(null);
      return;
    }

    const loadMcpServers = async () => {
      try {
        setIsLoadingMcpServers(true);
        const loadedServers = await listAgentMcpServersAction({ agentId: selectedAgentId });
        setMcpServers(loadedServers);
        setMcpDrafts(mapServersToDrafts(loadedServers));
        setMcpError(null);
      } catch {
        setMcpServers([]);
        setMcpDrafts({});
        setMcpError("Failed to load MCP servers.");
      } finally {
        setIsLoadingMcpServers(false);
      }
    };

    void loadMcpServers();
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentSystemPrompt("");
      setSystemPromptError(null);
      return;
    }

    const loadSystemPrompt = async () => {
      try {
        setIsLoadingSystemPrompt(true);
        const prompt = await getAgentSystemPromptAction({ agentId: selectedAgentId });
        setAgentSystemPrompt(prompt);
        setSystemPromptError(null);
      } catch {
        setAgentSystemPrompt("");
        setSystemPromptError("Failed to load system prompt.");
      } finally {
        setIsLoadingSystemPrompt(false);
      }
    };

    void loadSystemPrompt();
  }, [selectedAgentId]);

  useEffect(() => {
    setIsSystemPromptExpanded(false);
    setExpandedMemories({});
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setMemories([]);
      setMemoriesError(null);
      return;
    }

    const loadMemories = async () => {
      try {
        setIsLoadingMemories(true);
        const nextMemories = await listAgentMemoriesAction({ agentId: selectedAgentId });
        setMemories(nextMemories);
        setMemoriesError(null);
      } catch {
        setMemories([]);
        setMemoriesError("Failed to load memories.");
      } finally {
        setIsLoadingMemories(false);
      }
    };

    void loadMemories();
  }, [selectedAgentId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();

    if (!text || isPending || !selectedAgentId) {
      return;
    }

    const userMessage: ModelMessage = {
      role: "user",
      content: text,
    };

    const assistantPlaceholder: ModelMessage = {
      role: "assistant",
      content: "",
    };

    setMessages((current) => [...current, userMessage, assistantPlaceholder]);
    setInput("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentId: selectedAgentId,
            sessionId: selectedSessionId,
            content: text,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        if (!response.body) {
          throw new Error("Missing response stream");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamedText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          streamedText += decoder.decode(value, { stream: true });
          setMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && typeof last.content === "string") {
              next[next.length - 1] = {
                ...last,
                content: streamedText,
              };
            }
            return next;
          });
        }

        const persistedMessages = await getSessionMessagesAction({
          agentId: selectedAgentId,
          sessionId: selectedSessionId,
        });
        setMessages(persistedMessages);
        const usage = await getSessionTokenUsageAction({
          agentId: selectedAgentId,
          sessionId: selectedSessionId,
        });
        setSessionUsage(usage);
      } catch (error) {
        const content =
          error instanceof Error ? error.message : "Failed to get response from agent.";
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: `Error: ${content}`,
          },
        ]);
      } finally {
        scrollToBottom();
      }
    });
  };

  const handleAddAgent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = agentIdInput.trim();
    const name = agentNameInput.trim();

    if (!id || !name || isSavingAgent) {
      return;
    }

    startSaveAgentTransition(async () => {
      try {
        const agent = await createAgentAction({ id, name });
        setAgents((current) => [agent, ...current]);
        setSelectedAgentId(agent.id);
        setSidebarTab("agents");
        setIsAddingAgent(false);
        setAgentIdInput("");
        setAgentNameInput("");
      } catch {
        // Keep this silent for now to avoid interrupting chat flow.
      }
    });
  };

  const handleStartFresh = () => {
    if (!selectedAgentId) {
      return;
    }

    startFreshTransition(async () => {
      await startFreshDefaultSessionAction({ agentId: selectedAgentId });
      setSelectedSessionId(DEFAULT_SESSION_ID);
      const refreshedMessages = await getSessionMessagesAction({
        agentId: selectedAgentId,
        sessionId: DEFAULT_SESSION_ID,
      });
      setMessages(refreshedMessages);
      setSessionUsage(EMPTY_USAGE);
      const prompt = await getAgentSystemPromptAction({ agentId: selectedAgentId });
      setAgentSystemPrompt(prompt);
      const nextMemories = await listAgentMemoriesAction({ agentId: selectedAgentId });
      setMemories(nextMemories);
    });
  };

  const handleChangeMcpDraft = (serverId: string, patch: Partial<McpServerDraft>) => {
    setMcpDrafts((current) => {
      const previous = current[serverId];
      if (!previous) {
        return current;
      }
      return {
        ...current,
        [serverId]: {
          ...previous,
          ...patch,
        },
      };
    });
  };

  const handleAddMcpServer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedAgentId || isSavingMcp) {
      return;
    }

    startSaveMcpTransition(async () => {
      try {
        const server = draftToMcpServer(newMcpDraft);
        const updated = await addAgentMcpServerAction({
          agentId: selectedAgentId,
          server,
        });
        setMcpServers(updated);
        setMcpDrafts(mapServersToDrafts(updated));
        setNewMcpDraft(emptyMcpDraft());
        setIsAddingMcp(false);
        setMcpError(null);
      } catch (error) {
        setMcpError(error instanceof Error ? error.message : "Failed to add MCP server.");
      }
    });
  };

  const handleUpdateMcpServer = (serverId: string) => {
    if (!selectedAgentId || isSavingMcp) {
      return;
    }

    startSaveMcpTransition(async () => {
      try {
        const draft = mcpDrafts[serverId];
        if (!draft) {
          return;
        }

        const updated = await updateAgentMcpServerAction({
          agentId: selectedAgentId,
          serverId,
          server: draftToMcpServer(draft),
        });
        setMcpServers(updated);
        setMcpDrafts(mapServersToDrafts(updated));
        setMcpError(null);
      } catch (error) {
        setMcpError(error instanceof Error ? error.message : "Failed to update MCP server.");
      }
    });
  };

  const handleDeleteMcpServer = (serverId: string) => {
    if (!selectedAgentId || isSavingMcp) {
      return;
    }

    startSaveMcpTransition(async () => {
      try {
        const updated = await deleteAgentMcpServerAction({
          agentId: selectedAgentId,
          serverId,
        });
        setMcpServers(updated);
        setExpandedMcpId((current) => (current === serverId ? null : current));
        setMcpDrafts(mapServersToDrafts(updated));
        setMcpError(null);
      } catch (error) {
        setMcpError(error instanceof Error ? error.message : "Failed to delete MCP server.");
      }
    });
  };

  const handleRefreshSystemPrompt = () => {
    if (!selectedAgentId) {
      return;
    }

    startTransition(async () => {
      try {
        setIsLoadingSystemPrompt(true);
        const prompt = await getAgentSystemPromptAction({ agentId: selectedAgentId });
        setAgentSystemPrompt(prompt);
        setSystemPromptError(null);
      } catch {
        setAgentSystemPrompt("");
        setSystemPromptError("Failed to load system prompt.");
      } finally {
        setIsLoadingSystemPrompt(false);
      }
    });
  };

  const handleRefreshMemories = () => {
    if (!selectedAgentId) {
      return;
    }

    startTransition(async () => {
      try {
        setIsLoadingMemories(true);
        const nextMemories = await listAgentMemoriesAction({ agentId: selectedAgentId });
        setMemories(nextMemories);
        setMemoriesError(null);
      } catch {
        setMemories([]);
        setMemoriesError("Failed to load memories.");
      } finally {
        setIsLoadingMemories(false);
      }
    });
  };

  return (
    <div className="h-screen overflow-hidden bg-linear-to-b from-slate-50 to-slate-100">
      <div className="mx-auto grid h-full w-full max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
        <main className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Conversation
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Input: {sessionUsage.inputTokens} · Reasoning: {sessionUsage.reasoningTokens} ·
                Output: {sessionUsage.outputTokens} · Total: {sessionUsage.totalTokens}
              </p>
            </div>
            <button
              type="button"
              disabled={!selectedAgentId || isStartingFresh}
              onClick={handleStartFresh}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStartingFresh ? "Starting..." : "Start fresh"}
            </button>
          </header>

          <section className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
            {messages.map((message, index) => {
              const isUser = message.role === "user";
              const isTool = message.role === "tool";
              return (
                <article key={`message-${index}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${
                      isUser
                        ? "bg-slate-900 text-slate-50"
                        : isTool
                          ? "bg-amber-50 text-amber-900"
                          : "bg-slate-100 text-slate-900"
                    }`}
                  >
                    {renderMessageContent(message)}
                  </div>
                </article>
              );
            })}
            <div ref={bottomRef} />
          </section>

          <footer className="border-t border-slate-200 bg-slate-50 p-3 sm:p-4">
            <form ref={formRef} className="space-y-3" onSubmit={handleSubmit}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.metaKey) {
                    event.preventDefault();
                    formRef.current?.requestSubmit();
                  }
                }}
                placeholder="Message the agent..."
                className="min-h-24 w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Cmd+Enter to send, Enter for new line</p>
                <button
                  type="submit"
                  disabled={isPending || !selectedAgentId}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {isPending ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </footer>
        </main>

        <aside className="overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Workspace</h2>
            {selectedAgentId ? (
              <span className="text-xs text-slate-500">Agent: {selectedAgentId}</span>
            ) : (
              <span className="text-xs text-slate-500">No agent selected</span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setSidebarTab("agents")}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                sidebarTab === "agents"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Agents ({agents.length})
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("sessions")}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                sidebarTab === "sessions"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Sessions ({sessions.length})
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("mcp")}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                sidebarTab === "mcp"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              MCP ({mcpServers.length})
            </button>
          </div>

          {sidebarTab === "agents" ? (
            <div className="mt-4 space-y-3">
              {isLoadingAgents ? <p className="text-xs text-slate-500">Loading agents...</p> : null}
              {isLoadingMessages ? <p className="text-xs text-slate-500">Loading conversation...</p> : null}
              {!isLoadingAgents && agents.length === 0 ? <p className="text-xs text-slate-500">No agents yet.</p> : null}

              {agents.map((agent) => {
                const isSelected = selectedAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-slate-50"
                        : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className={`text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}>{agent.id}</p>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setIsAddingAgent((current) => !current)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {isAddingAgent ? "Close" : "Add Agent"}
              </button>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Current System Prompt
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsSystemPromptExpanded((current) => !current)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      {isSystemPromptExpanded ? "Collapse" : "Expand"}
                    </button>
                    <button
                      type="button"
                      onClick={handleRefreshSystemPrompt}
                      disabled={!selectedAgentId || isLoadingSystemPrompt}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLoadingSystemPrompt ? "Loading..." : "Refresh"}
                    </button>
                  </div>
                </div>
                {systemPromptError ? (
                  <p className="text-xs text-rose-600">{systemPromptError}</p>
                ) : null}
                <div
                  className={`rounded-lg border border-slate-300 bg-white px-3 py-2 ${
                    isSystemPromptExpanded ? "" : "max-h-40 overflow-hidden"
                  }`}
                >
                  {agentSystemPrompt ? (
                    <MarkdownText text={agentSystemPrompt} />
                  ) : (
                    <p className="text-xs text-slate-500">
                      {selectedAgentId ? "No prompt found." : "Select an agent to view prompt."}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Memories
                  </p>
                  <button
                    type="button"
                    onClick={handleRefreshMemories}
                    disabled={!selectedAgentId || isLoadingMemories}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoadingMemories ? "Loading..." : "Refresh"}
                  </button>
                </div>
                {memoriesError ? <p className="text-xs text-rose-600">{memoriesError}</p> : null}
                {!isLoadingMemories && memories.length === 0 ? (
                  <p className="text-xs text-slate-500">No memories yet.</p>
                ) : null}
                <div className="space-y-2">
                  {memories.map((memory) => {
                    const isExpanded = expandedMemories[memory.id] ?? false;
                    return (
                      <article key={memory.id} className="rounded-lg border border-slate-300 bg-white p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium text-slate-700">
                              {memory.id} · entries: {memory.content.entries}
                            </p>
                            <p className="text-xs text-slate-500">{memory.content.updatedAt}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedMemories((current) => ({
                                ...current,
                                [memory.id]: !isExpanded,
                              }))
                            }
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            {isExpanded ? "Hide" : "Show"}
                          </button>
                        </div>
                        {isExpanded ? (
                          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                            <MarkdownText text={memory.content.text} />
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-600">
                            {getMemoryPreview(memory.content.text)}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>

              {isAddingAgent ? (
                <form className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" onSubmit={handleAddAgent}>
                  <input
                    id="agent-id"
                    value={agentIdInput}
                    onChange={(event) => setAgentIdInput(event.target.value)}
                    placeholder="agent id"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  />
                  <input
                    id="agent-name"
                    value={agentNameInput}
                    onChange={(event) => setAgentNameInput(event.target.value)}
                    placeholder="agent name"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                  />
                  <button
                    type="submit"
                    disabled={isSavingAgent || !agentIdInput.trim() || !agentNameInput.trim()}
                    className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {isSavingAgent ? "Adding..." : "Create Agent"}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {sidebarTab === "sessions" ? (
            <div className="mt-4 space-y-2">
              {isLoadingSessions ? <p className="text-xs text-slate-500">Loading sessions...</p> : null}
              {!selectedAgentId ? <p className="text-xs text-slate-500">Select an agent first.</p> : null}
              {!isLoadingSessions && selectedAgentId && sessions.length === 0 ? (
                <p className="text-xs text-slate-500">No sessions yet.</p>
              ) : null}

              {sessions.map((session) => {
                const isSelected = selectedSessionId === session.id;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-slate-50"
                        : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-sm font-medium">{session.id}</p>
                  </button>
                );
              })}
            </div>
          ) : null}

          {sidebarTab === "mcp" ? (
            <div className="mt-4 space-y-3">
              {isLoadingMcpServers ? <p className="text-xs text-slate-500">Loading MCP servers...</p> : null}
              {!selectedAgentId ? <p className="text-xs text-slate-500">Select an agent first.</p> : null}
              {!isLoadingMcpServers && selectedAgentId && mcpServers.length === 0 ? (
                <p className="text-xs text-slate-500">No MCP servers configured.</p>
              ) : null}
              {mcpError ? <p className="text-xs text-rose-600">{mcpError}</p> : null}

              {mcpServers.map((server) => {
                const draft = mcpDrafts[server.id];
                const isExpanded = expandedMcpId === server.id;
                if (!draft) {
                  return null;
                }

                return (
                  <div key={server.id} className="rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{server.name}</p>
                        <p className="text-xs text-slate-500">
                          {server.id} · {server.transport} · {server.enabled ? "enabled" : "disabled"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedMcpId((current) => (current === server.id ? null : server.id))}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {isExpanded ? "Hide" : "Edit"}
                      </button>
                    </div>

                    {isExpanded ? (
                      <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={draft.id}
                            onChange={(event) => handleChangeMcpDraft(server.id, { id: event.target.value })}
                            placeholder="server id"
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                          />
                          <input
                            value={draft.name}
                            onChange={(event) => handleChangeMcpDraft(server.id, { name: event.target.value })}
                            placeholder="name"
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                          />
                        </div>

                        <label className="flex items-center justify-end gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) =>
                              handleChangeMcpDraft(server.id, { enabled: event.target.checked })
                            }
                          />
                          enabled
                        </label>

                        <select
                          value={draft.transport}
                          onChange={(event) =>
                            handleChangeMcpDraft(server.id, {
                              transport: event.target.value as AgentMcpTransport,
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                        >
                          <option value="http">http</option>
                          <option value="sse">sse</option>
                        </select>

                        <input
                          value={draft.url}
                          onChange={(event) => handleChangeMcpDraft(server.id, { url: event.target.value })}
                          placeholder="url"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                        />

                        <textarea
                          value={draft.headersText}
                          onChange={(event) =>
                            handleChangeMcpDraft(server.id, { headersText: event.target.value })
                          }
                          placeholder='headers json, e.g. {"Authorization":"Bearer ..."}'
                          className="min-h-16 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                        />

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleUpdateMcpServer(server.id)}
                            disabled={isSavingMcp}
                            className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMcpServer(server.id)}
                            disabled={isSavingMcp}
                            className="w-full rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => setIsAddingMcp((current) => !current)}
                disabled={!selectedAgentId}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAddingMcp ? "Close" : "Add MCP Server"}
              </button>

              {isAddingMcp ? (
                <form className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" onSubmit={handleAddMcpServer}>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={newMcpDraft.id}
                      onChange={(event) => setNewMcpDraft((current) => ({ ...current, id: event.target.value }))}
                      placeholder="server id"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                    />
                    <input
                      value={newMcpDraft.name}
                      onChange={(event) =>
                        setNewMcpDraft((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="name"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                    />
                  </div>

                  <input
                    value={newMcpDraft.url}
                    onChange={(event) =>
                      setNewMcpDraft((current) => ({ ...current, url: event.target.value }))
                    }
                    placeholder="url"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                  />

                  <select
                    value={newMcpDraft.transport}
                    onChange={(event) =>
                      setNewMcpDraft((current) => ({
                        ...current,
                        transport: event.target.value as AgentMcpTransport,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                  >
                    <option value="http">http</option>
                    <option value="sse">sse</option>
                  </select>

                  <textarea
                    value={newMcpDraft.headersText}
                    onChange={(event) =>
                      setNewMcpDraft((current) => ({ ...current, headersText: event.target.value }))
                    }
                    placeholder='headers json, e.g. {"Authorization":"Bearer ..."}'
                    className="min-h-16 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-slate-500"
                  />

                  <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={newMcpDraft.enabled}
                      onChange={(event) =>
                        setNewMcpDraft((current) => ({ ...current, enabled: event.target.checked }))
                      }
                    />
                    enabled
                  </label>

                  <button
                    type="submit"
                    disabled={
                      isSavingMcp || !selectedAgentId || !newMcpDraft.id.trim() || !newMcpDraft.name.trim()
                    }
                    className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {isSavingMcp ? "Saving..." : "Create MCP Server"}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function renderMessageContent(message: ModelMessage) {
  if (message.role === "tool") {
    return (
      <div className="space-y-2">
        {message.content.map((part, index) => {
          if (part.type === "tool-result") {
            return (
              <div key={`tool-result-${index}`}>
                <p className="text-xs font-medium uppercase tracking-wide">Tool Response: {part.toolName}</p>
                <p className="text-xs text-amber-800">{part.toolCallId}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                  {JSON.stringify(part.output)}
                </p>
              </div>
            );
          }

          if (part.type === "tool-approval-response") {
            return (
              <div key={`tool-approval-${index}`}>
                <p className="text-xs font-medium uppercase tracking-wide">Tool Approval Response</p>
                <p className="text-xs text-amber-800">{part.approvalId}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                  {part.approved ? "approved" : "denied"}
                </p>
              </div>
            );
          }

          return null;
        })}
      </div>
    );
  }

  if (typeof message.content === "string") {
    return <MarkdownText text={message.content} />;
  }

  return (
    <div className="space-y-2">
      {message.content.map((part, index) => {
        if (part.type === "text") {
          return <MarkdownText key={`text-${index}`} text={part.text} />;
        }

        if (part.type === "tool-call") {
          return (
            <div
              key={`tool-call-${index}`}
              className="rounded-lg border border-slate-300/50 bg-slate-50/50 px-2 py-1"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                Tool Call: {part.toolName}
              </p>
              <p className="text-xs text-slate-500">{part.toolCallId}</p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                {JSON.stringify(part.input)}
              </p>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-p:my-2 prose-pre:my-2 prose-code:break-words prose-ul:my-2 prose-ol:my-2 prose-headings:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function getMemoryPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

function emptyMcpDraft(): McpServerDraft {
  return {
    id: "",
    name: "",
    transport: "http",
    url: "",
    headersText: "{}",
    enabled: true,
  };
}

function mapServersToDrafts(servers: AgentMcpServer[]): Record<string, McpServerDraft> {
  return Object.fromEntries(servers.map((server) => [server.id, mcpServerToDraft(server)]));
}

function mcpServerToDraft(server: AgentMcpServer): McpServerDraft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    url: server.url,
    headersText: JSON.stringify(server.headers, null, 2),
    enabled: server.enabled,
  };
}

function draftToMcpServer(draft: McpServerDraft): AgentMcpServer {
  const id = draft.id.trim();
  const name = draft.name.trim();

  if (!id) {
    throw new Error("MCP server id is required");
  }

  if (!name) {
    throw new Error("MCP server name is required");
  }

  const headers = parseHeadersInput(draft.headersText);
  const url = draft.url.trim();

  if (!url) {
    throw new Error("MCP servers require a URL");
  }

  return {
    id,
    name,
    transport: draft.transport,
    url,
    headers,
    enabled: draft.enabled,
  };
}

function parseHeadersInput(value: string): Record<string, string> {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Headers must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers must be a JSON object");
  }

  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== "string") {
      throw new Error(`Header '${key}' must be a string`);
    }

    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error("Header keys cannot be empty");
    }

    headers[normalizedKey] = headerValue;
  }

  return headers;
}
