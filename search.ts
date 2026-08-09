import { getExaApiKey, type WebSearchConfig } from "./config.ts";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const REQUEST_TIMEOUT_MS = 60_000;

export type RecencyFilter = "day" | "week" | "month" | "year";

export interface SearchOptions {
	numResults?: number;
	recencyFilter?: RecencyFilter;
	domainFilter?: string[];
	includeContent?: boolean;
	signal?: AbortSignal;
}

export interface SearchResult {
	title: string;
	url: string;
	publishedDate?: string;
	snippet: string;
	content?: string;
}

export interface QueryResult {
	query: string;
	results: SearchResult[];
	error?: string;
}

interface ExaResult {
	title?: unknown;
	url?: unknown;
	publishedDate?: unknown;
	text?: unknown;
	highlights?: unknown;
}

interface ExaResponse {
	results?: unknown;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function recencyStartDate(filter: RecencyFilter): string {
	const days = { day: 1, week: 7, month: 30, year: 365 }[filter];
	return new Date(Date.now() - days * 86_400_000).toISOString();
}

function domainArgs(domainFilter: string[] | undefined): Record<string, string[]> {
	if (!domainFilter?.length) return {};
	const includeDomains = domainFilter.filter((domain) => !domain.startsWith("-")).map((domain) => domain.trim()).filter(Boolean);
	const excludeDomains = domainFilter
		.filter((domain) => domain.startsWith("-"))
		.map((domain) => domain.slice(1).trim())
		.filter(Boolean);
	return {
		...(includeDomains.length > 0 ? { includeDomains } : {}),
		...(excludeDomains.length > 0 ? { excludeDomains } : {}),
	};
}

function normalizeHighlights(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function mapResult(value: ExaResult): SearchResult | null {
	if (typeof value.url !== "string" || value.url.trim().length === 0) return null;
	const highlights = normalizeHighlights(value.highlights);
	const text = typeof value.text === "string" ? value.text.trim() : "";
	return {
		title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : value.url,
		url: value.url,
		...(typeof value.publishedDate === "string" ? { publishedDate: value.publishedDate } : {}),
		snippet: highlights.join(" ") || text.slice(0, 1000),
		...(text ? { content: text } : {}),
	};
}

function redact(value: string, key: string): string {
	return value.replaceAll(key, "[REDACTED]");
}

export async function searchExa(
	query: string,
	config: WebSearchConfig,
	options: SearchOptions = {},
): Promise<QueryResult> {
	const apiKey = getExaApiKey(config);
	const numResults = Math.min(20, Math.max(1, Math.floor(options.numResults ?? 5)));
	const body = {
		query,
		type: "auto",
		numResults,
		...domainArgs(options.domainFilter),
		...(options.recencyFilter ? { startPublishedDate: recencyStartDate(options.recencyFilter) } : {}),
		contents: options.includeContent ? { text: true, highlights: true } : { highlights: true },
	};

	try {
		const response = await fetch(EXA_SEARCH_URL, {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"Content-Type": "application/json",
				"x-exa-integration": "pi-web-access-slim",
			},
			body: JSON.stringify(body),
			signal: requestSignal(options.signal),
		});

		if (!response.ok) {
			const message = redact((await response.text()).slice(0, 300), apiKey);
			throw new Error(`Exa API error ${response.status}: ${message}`);
		}

		const data = await response.json() as ExaResponse;
		const rawResults = Array.isArray(data.results) ? data.results : [];
		const results = rawResults
			.map((value) => value && typeof value === "object" ? mapResult(value as ExaResult) : null)
			.filter((value): value is SearchResult => value !== null);
		return { query, results };
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(redact(message, apiKey));
	}
}
