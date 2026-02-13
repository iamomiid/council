import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import {
	ToolLoopAgent,
	jsonSchema,
	tool,
	type ModelMessage,
	type ToolSet,
} from "ai";
import {
	addSessionTokenUsage,
	type AgentMcpServer,
	appendSessionMessage,
	appendSessionMessages,
	DEFAULT_SESSION_ID,
	getAgentSystemPrompt,
	listAgentSessions,
	getSessionMessages,
	listAgentMcpServers,
	updateAgentSystemPrompt,
} from "@/lib/agents";
import { appendAgentMemory, searchAgentMemory } from "@/lib/memory";

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
	const enabledMcpServers = (await listAgentMcpServers(agentId)).filter(
		(server) => server.enabled,
	);
	const mcpClients: MCPClient[] = [];
	const tools: ToolSet = {
		sessions_list: tool({
			description: "List this agent's sessions. Returns session names only.",
			inputSchema: jsonSchema({
				type: "object",
				properties: {},
				additionalProperties: false,
			}),
			execute: async () => {
				const sessions = await listAgentSessions(agentId);
				return {
					sessions: sessions.map((session) => session.id),
				};
			},
		}),
		update_system_prompt: tool({
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
		memory_add: tool({
			description: "Append memory into knowledge base for today.",
			inputSchema: jsonSchema({
				type: "object",
				properties: {
					memory: {
						type: "string",
						description: "Memory text to append.",
					},
				},
				required: ["memory"],
				additionalProperties: false,
			}),
			execute: async ({ memory }) => {
				const result = await appendAgentMemory({
					agentId,
					content: memory,
				});

				return {
					ok: true,
					index: result.index,
					id: result.id,
					entries: result.entries,
				};
			},
		}),
		memory_search: tool({
			description:
				"Search the agent's memory index and return top 3 related memory documents.",
			inputSchema: jsonSchema({
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Search query for related memory.",
					},
				},
				required: ["query"],
				additionalProperties: false,
			}),
			execute: async ({ query }) => {
				const results = await searchAgentMemory({
					agentId,
					query,
				});

				return {
					results,
				};
			},
		}),
	};

	try {
		for (const server of enabledMcpServers) {
			const client = await createMCPClient({
				transport: {
					type: server.transport,
					url: server.url,
					headers: server.headers,
				},
			});
			mcpClients.push(client);

			const serverTools = (await client.tools()) as ToolSet;
			for (const [toolName, serverTool] of Object.entries(serverTools)) {
				tools[getScopedMcpToolName(server, toolName)] = serverTool;
			}
		}
	} catch (error) {
		await closeMcpClients(mcpClients);
		return new Response(
			error instanceof Error
				? `Failed to initialize MCP tools: ${error.message}`
				: "Failed to initialize MCP tools",
			{ status: 500 },
		);
	}

	const agent = new ToolLoopAgent({
		model: openrouter(model),
		instructions: system,
		tools,
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
			} finally {
				await closeMcpClients(mcpClients);
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

function getScopedMcpToolName(
	server: AgentMcpServer,
	toolName: string,
): string {
	const safeServerId = server.id.replace(/[^a-zA-Z0-9_]/g, "_");
	const safeToolName = toolName.replace(/[^a-zA-Z0-9_]/g, "_");
	return `mcp_${safeServerId}__${safeToolName}`;
}

async function closeMcpClients(clients: MCPClient[]): Promise<void> {
	await Promise.allSettled(clients.map((client) => client.close()));
}
