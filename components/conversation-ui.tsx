"use client";

import { FormEvent, useMemo, useRef, useState, useTransition } from "react";
import { sendMessageAction } from "@/app/actions";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
};

const initialMessages: Message[] = [
  {
    id: "m1",
    role: "assistant",
    content: "Ready to coordinate. What should we work on first?",
    time: "09:41",
  },
];

const agents = [
  { id: "a1", name: "ops-assistant-v1", status: "online", active: true },
  { id: "a2", name: "research-agent", status: "idle", active: false },
  { id: "a3", name: "qa-agent", status: "offline", active: false },
];

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ConversationUi() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const lastAction = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    return lastAssistant?.content ?? "No responses yet";
  }, [messages]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();

    if (!text || isPending) {
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      time: formatTime(new Date()),
    };

    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput("");
    scrollToBottom();

    startTransition(async () => {
      try {
        const result = await sendMessageAction(
          nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        );

        setLatencyMs(result.latencyMs);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: result.text,
            time: result.time,
          },
        ]);
      } catch (error) {
        const content =
          error instanceof Error ? error.message : "Failed to get response from agent.";

        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Error: ${content}`,
            time: formatTime(new Date()),
          },
        ]);
      } finally {
        scrollToBottom();
      }
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <main className="flex min-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Conversation
              </p>
              <h1 className="text-lg font-semibold text-slate-900">
                Product Operations Agent
              </h1>
            </div>
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Agent Online
            </div>
          </header>

          <section className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
            {messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <article
                  key={message.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${
                      isUser
                        ? "bg-slate-900 text-slate-50"
                        : "bg-slate-100 text-slate-900"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {message.content}
                    </p>
                    <p
                      className={`mt-2 text-right text-[11px] ${
                        isUser ? "text-slate-300" : "text-slate-500"
                      }`}
                    >
                      {message.time}
                    </p>
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
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    formRef.current?.requestSubmit();
                  }
                }}
                placeholder="Message the agent..."
                className="min-h-24 w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none transition focus:border-slate-500"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Enter to send, Shift+Enter for new line
                </p>
                <button
                  type="submit"
                  disabled={isPending}
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
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`w-full rounded-xl border p-3 text-left transition ${
                  agent.active
                    ? "border-slate-900 bg-slate-900 text-slate-50"
                    : "border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300"
                }`}
              >
                <p className="text-sm font-medium">{agent.name}</p>
                <p
                  className={`mt-1 text-xs uppercase tracking-wide ${
                    agent.active ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  {agent.status}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Last Action</p>
            <p className="mt-1 text-sm text-slate-900 line-clamp-3">{lastAction}</p>
            <p className="mt-2 text-xs text-slate-500">
              Last latency: {latencyMs ? `${latencyMs} ms` : "n/a"}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
