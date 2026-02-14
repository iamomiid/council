import { BraveSearch } from "brave-search";

type BravePage = {
	title: string;
	url: string;
	description: string;
};

function getBraveClient(): BraveSearch {
	const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("Missing BRAVE_SEARCH_API_KEY");
	}

	const braveClient = new BraveSearch(apiKey);
	return braveClient;
}

export async function searchBraveWeb(query: string): Promise<BravePage[]> {
	const normalizedQuery = query.trim();
	if (!normalizedQuery) {
		throw new Error("Search query is required");
	}

	const response = await getBraveClient().webSearch(normalizedQuery, {
		count: 3,
		search_lang: "en",
	});

	return (response.web?.results ?? []).slice(0, 3).map((item) => ({
		title: item.title,
		url: item.url,
		description: item.description,
	}));
}
