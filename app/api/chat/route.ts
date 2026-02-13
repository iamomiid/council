import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ToolLoopAgent, jsonSchema, tool, type ModelMessage } from "ai";
import {
  addSessionTokenUsage,
  appendSessionMessage,
  appendSessionMessages,
  DEFAULT_SESSION_ID,
  getAgentSystemPrompt,
  getSessionMessages,
  listAgents,
  updateAgentSystemPrompt,
} from "@/lib/agents";

type ChatRequestBody = {
  agentId?: string;
  sessionId?: string;
  content?: string;
};

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_NAME ?? "Council",
  },
});

export async function POST(request: Request) {
  const model = process.env.OPENROUTER_MODEL;

  if (!process.env.OPENROUTER_API_KEY) {
    return new Response("Missing OPENROUTER_API_KEY", { status: 500 });
  }

  if (!model) {
    return new Response("Missing OPENROUTER_MODEL", { status: 500 });
  }

  const body = (await request.json()) as ChatRequestBody;
  const agentId = body.agentId?.trim();
  const sessionId = body.sessionId?.trim() || DEFAULT_SESSION_ID;
  const content = body.content?.trim();

  if (!agentId) {
    return new Response("Missing agentId", { status: 400 });
  }

  if (!content) {
    return new Response("Message content is required", { status: 400 });
  }

  const userMessage: ModelMessage = {
    role: "user",
    content,
  };

  await appendSessionMessage({
    agentId,
    sessionId,
    message: userMessage,
  });

  const messages = await getSessionMessages(agentId, sessionId);
  const system = await getAgentSystemPrompt(agentId);

  const agent = new ToolLoopAgent({
    model: openrouter(model),
    instructions: system,
    tools: {
      agents_list: tool({
        description: "Get the list of all agents with id and name.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => {
          return {
            agents: await listAgents(),
          };
        },
      }),
      agent_update_system_prompt: tool({
        description:
          "Update this agent's system prompt. Use when asked to change behavior, tone, or operating rules.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            systemPrompt: {
              type: "string",
              description: "The new complete system prompt for this agent.",
            },
          },
          required: ["systemPrompt"],
          additionalProperties: false,
        }),
        execute: async ({ systemPrompt }) => {
          await updateAgentSystemPrompt({
            agentId,
            systemPrompt,
          });

          return {
            ok: true,
            message: "System prompt updated successfully.",
          };
        },
      }),
    },
  });

  const streamResult = await agent.stream({ messages });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamResult.textStream) {
          controller.enqueue(encoder.encode(chunk));
        }

        const response = await streamResult.response;
        await appendSessionMessages({
          agentId,
          sessionId,
          messages: response.messages as ModelMessage[],
        });
        const usage = await streamResult.totalUsage;
        await addSessionTokenUsage({
          agentId,
          sessionId,
          usage,
        });

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
