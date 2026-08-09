import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { QueryResult, SearchResult } from "./search.ts";

const CACHE_TTL_MS = 60 * 60 * 1000;

export interface ExtractedContent {
	url: string;
	title: string;
	content: string;
	error: string | null;
}

export interface StoredSearchData {
	id: string;
	type: "search" | "fetch";
	timestamp: number;
	queries?: QueryResult[];
	urls?: ExtractedContent[];
}

const storedResults = new Map<string, StoredSearchData>();

export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function storeResult(data: StoredSearchData): void {
	storedResults.set(data.id, data);
}

export function getResult(id: string): StoredSearchData | null {
	return storedResults.get(id) ?? null;
}

export function findResults(predicate: (data: StoredSearchData) => boolean): StoredSearchData[] {
	return Array.from(storedResults.values()).filter(predicate);
}

export function clearResults(): void {
	storedResults.clear();
}

function isSearchResult(value: unknown): value is SearchResult {
	if (!value || typeof value !== "object") return false;
	const result = value as Record<string, unknown>;
	return typeof result.title === "string" && typeof result.url === "string" && typeof result.snippet === "string";
}

function isQueryResult(value: unknown): value is QueryResult {
	if (!value || typeof value !== "object") return false;
	const result = value as Record<string, unknown>;
	return typeof result.query === "string"
		&& Array.isArray(result.results)
		&& result.results.every(isSearchResult)
		&& (result.error === undefined || typeof result.error === "string");
}

function isExtractedContent(value: unknown): value is ExtractedContent {
	if (!value || typeof value !== "object") return false;
	const content = value as Record<string, unknown>;
	return typeof content.url === "string"
		&& typeof content.title === "string"
		&& typeof content.content === "string"
		&& (content.error === null || typeof content.error === "string");
}

function isValidStoredData(value: unknown): value is StoredSearchData {
	if (!value || typeof value !== "object") return false;
	const data = value as Record<string, unknown>;
	if (typeof data.id !== "string" || typeof data.timestamp !== "number") return false;
	if (data.type === "search") return Array.isArray(data.queries) && data.queries.every(isQueryResult);
	if (data.type === "fetch") return Array.isArray(data.urls) && data.urls.every(isExtractedContent);
	return false;
}

export function restoreFromSession(ctx: ExtensionContext): void {
	storedResults.clear();
	const now = Date.now();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== "web-search-results") continue;
		if (!isValidStoredData(entry.data)) continue;
		if (now - entry.data.timestamp < CACHE_TTL_MS) storeResult(entry.data);
	}
}
