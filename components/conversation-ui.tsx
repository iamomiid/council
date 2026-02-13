"use client";

import {
  createAgentAction,
  getSessionMessagesAction,
  getSessionTokenUsageAction,
  listAgentSessionsAction,
  listAgentsAction,
  startFreshDefaultSessionAction,
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
  const [agentIdInput, setAgentIdInput] = useState("");
  const [agentNameInput, setAgentNameInput] = useState("");
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState(DEFAULT_SESSION_ID);
  const [sessionUsage, setSessionUsage] = useState<SessionTokenUsage>(EMPTY_USAGE);
  const [isPending, startTransition] = useTransition();
  const [isSavingAgent, startSaveAgentTransition] = useTransition();
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
    });
  };

  return (
    <div className="h-screen overflow-hidden bg-linear-to-b from-slate-50 to-slate-100">
      <div className="mx-auto grid h-full w-full max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_320px]">
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
                <article
                  key={`message-${index}`}
                  className={`flex ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
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
                  if (event.key === "Enter" && event.shiftKey) {
                    event.preventDefault();
                    formRef.current?.requestSubmit();
                  }
                }}
                placeholder="Message the agent..."
                className="min-h-24 w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Shift+Enter to send, Enter for new line</p>
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

        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Agents</h2>
            <span className="text-xs text-slate-500">{agents.length} total</span>
          </div>

          <div className="mt-4 space-y-2">
            {isLoadingAgents ? <p className="text-xs text-slate-500">Loading agents...</p> : null}
            {isLoadingMessages ? (
              <p className="text-xs text-slate-500">Loading conversation...</p>
            ) : null}
            {!isLoadingAgents && agents.length === 0 ? (
              <p className="text-xs text-slate-500">No agents yet.</p>
            ) : null}

            {agents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? "border-slate-900 bg-slate-900 text-slate-50"
                      : "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300"
                  }`}
                >
                  <p className="text-sm font-medium">{agent.name}</p>
                  <p
                    className={`mt-1 text-xs tracking-wide ${
                      isSelected ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {agent.id}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Sessions</h2>
              <span className="text-xs text-slate-500">{sessions.length} total</span>
            </div>

            <div className="mt-4 space-y-2">
              {isLoadingSessions ? (
                <p className="text-xs text-slate-500">Loading sessions...</p>
              ) : null}
              {!isLoadingSessions && sessions.length === 0 ? (
                <p className="text-xs text-slate-500">No sessions yet.</p>
              ) : null}

              {sessions.map((session) => {
                const isSelected = selectedSessionId === session.id;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-slate-50"
                        : "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-sm font-medium">{session.id}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <form className="mt-4 space-y-2" onSubmit={handleAddAgent}>
            <label className="text-xs uppercase tracking-wide text-slate-500" htmlFor="agent-name">
              Add Agent
            </label>
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
              {isSavingAgent ? "Adding..." : "Add Agent"}
            </button>
          </form>
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
                <p className="text-xs font-medium uppercase tracking-wide">
                  Tool Response: {part.toolName}
                </p>
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
                <p className="text-xs font-medium uppercase tracking-wide">
                  Tool Approval Response
                </p>
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
            <div key={`tool-call-${index}`} className="rounded-lg border border-slate-300/50 bg-slate-50/50 px-2 py-1">
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
