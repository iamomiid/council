import { Search } from "@upstash/search";

type MemoryContent = {
	text: string;
	day: string;
	createdAt: string;
	updatedAt: string;
	entries: number;
};

type MemoryMetadata = {
	agentId: string;
	day: string;
};

function getAgentMemoryIndex(agentId: string) {
	return Search.fromEnv().index<MemoryContent, MemoryMetadata>(agentId);
}

export async function resetAgentMemory(agentId: string): Promise<void> {
	const index = getAgentMemoryIndex(agentId);
	await index.reset();
}

export async function appendAgentMemory(input: {
	agentId: string;
	content: string;
}): Promise<{ index: string; id: string; entries: number }> {
	const content = input.content.trim();
	if (!content) {
		throw new Error("Memory content is required");
	}

	const now = new Date().toISOString();
	const dayId = now.slice(0, 10);
	const index = getAgentMemoryIndex(input.agentId);
	const existing = await index.fetch({ ids: [dayId] });
	const existingDoc = existing[0];

	const previousText = existingDoc?.content?.text?.trim() ?? "";
	const previousEntries = existingDoc?.content?.entries ?? 0;
	const previousCreatedAt = existingDoc?.content?.createdAt ?? now;
	const nextEntries = previousEntries + 1;

	const appendedLine = `[${now}] ${content}`;
	const nextText = previousText
		? `${previousText}\n${appendedLine}`
		: appendedLine;

	await index.upsert({
		id: dayId,
		content: {
			text: nextText,
			day: dayId,
			createdAt: previousCreatedAt,
			updatedAt: now,
			entries: nextEntries,
		},
		metadata: {
			agentId: input.agentId,
			day: dayId,
		},
	});

	return {
		index: input.agentId,
		id: dayId,
		entries: nextEntries,
	};
}

export async function searchAgentMemory(input: {
	agentId: string;
	query: string;
}): Promise<
	Array<{
		id: string;
		score: number;
		content: MemoryContent;
		metadata?: MemoryMetadata;
	}>
> {
	const query = input.query.trim();
	if (!query) {
		throw new Error("Memory search query is required");
	}

	const index = getAgentMemoryIndex(input.agentId);
	const results = await index.search({
		query,
		limit: 3,
	});

	return results.map((item) => ({
		id: item.id,
		score: item.score,
		content: item.content,
		metadata: item.metadata,
	}));
}
