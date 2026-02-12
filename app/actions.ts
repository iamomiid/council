"use server";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type SendMessageResult = {
  text: string;
  time: string;
  latencyMs: number;
};

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_NAME ?? "Council",
  },
});

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function sendMessageAction(
  messages: ChatMessage[],
): Promise<SendMessageResult> {
  const model = process.env.OPENROUTER_MODEL;

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  if (!model) {
    throw new Error("Missing OPENROUTER_MODEL");
  }

  const startedAt = Date.now();

  const { text } = await generateText({
    model: openrouter(model),
    messages,
    system:
      "You are a precise operations assistant helping coordinate AI agent tasks. Keep responses practical and concise.",
  });

  return {
    text,
    time: formatTime(new Date()),
    latencyMs: Date.now() - startedAt,
  };
}
