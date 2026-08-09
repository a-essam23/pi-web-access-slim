import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { loadConfig } from "./config.ts";
import { fetchContent } from "./fetch.ts";
import { searchExa, type QueryResult, type RecencyFilter } from "./search.ts";
import { summarizeResults } from "./summary.ts";
import { clearResults, findResults, generateId, getResult, restoreFromSession, storeResult } from "./storage.ts";

function normalizeQueries(params: { query?: unknown; queries?: unknown }): string[] {
	const values = Array.isArray(params.queries) ? params.queries : params.query !== undefined ? [params.query] : [];
	return values
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter(Boolean)
		.slice(0, 8);
}

function normalizeUrls(params: { url?: unknown; urls?: unknown }): string[] {
	const values = Array.isArray(params.urls) ? params.urls : params.url !== undefined ? [params.url] : [];
	return values
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter(Boolean)
		.slice(0, 20);
}

function formatFetched(results: Array<{ url: string; title: string; content: string; error: string | null }>): string {
	return results.map((result) => {
		const header = result.title ? `# ${result.title}\n\n` : "";
		return `${result.url}\n\n${result.error ? `Error: ${result.error}` : `${header}${result.content}`}`.trim();
	}).join("\n\n---\n\n");
}

function formatStored(data: ReturnType<typeof getResult>): string {
	if (!data) return "No stored result found.";
	if (data.type === "search") return formatResults(data.queries ?? []);
	return formatFetched(data.urls ?? []);
}

function formatResults(results: QueryResult[]): string {
	const lines: string[] = [];
	for (const result of results) {
		lines.push(`Query: ${result.query}`);
		if (result.error) {
			lines.push(`Error: ${result.error}`);
			lines.push("");
			continue;
		}
		if (result.results.length === 0) {
			lines.push("No results.", "");
			continue;
		}
		for (const [index, source] of result.results.entries()) {
			lines.push(`${index + 1}. ${source.title}`, `   ${source.url}`);
			if (source.snippet) lines.push(`   ${source.snippet}`);
			lines.push("");
		}
	}
	return lines.join("\n").trim();
}

function isAbortError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === "AbortError" || error.message.toLowerCase().includes("aborted");
}

export default function register(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => restoreFromSession(ctx));
	pi.on("session_tree", (_event, ctx) => restoreFromSession(ctx));
	pi.on("session_shutdown", () => clearResults());

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web using the Exa REST API. Optionally summarize the results with a configured Pi model.",
		promptSnippet: "Search the web with Exa; enable summary only when a concise synthesis is useful.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "A single web search query." })),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple web search queries." })),
			numResults: Type.Optional(Type.Number({ description: "Results per query, from 1 to 20. Defaults to 5." })),
			recencyFilter: Type.Optional(StringEnum(["day", "week", "month", "year"])),
			domainFilter: Type.Optional(Type.Array(Type.String(), { description: "Domains to include; prefix a domain with - to exclude it." })),
			includeContent: Type.Optional(Type.Boolean({ description: "Include Exa text content in the result." })),
			summary: Type.Optional(Type.Boolean({ description: "Override the configured summary.enabled value." })),
			summaryModel: Type.Optional(Type.String({ description: "Override the configured summary.model using provider/model-id." })),
		}),

		async execute(callId, params, signal, onUpdate, ctx) {
			const queries = normalizeQueries(params);
			if (queries.length === 0) {
				return { content: [{ type: "text", text: "Error: provide query or queries." }], details: { error: "No query provided" } };
			}

			const config = loadConfig();
			const results: QueryResult[] = [];
			for (const [index, query] of queries.entries()) {
				onUpdate?.({
					content: [{ type: "text", text: `Searching Exa (${index + 1}/${queries.length}): ${query}` }],
					details: { phase: "searching", progress: index / queries.length, query },
				});

				try {
					results.push(await searchExa(query, config, {
						numResults: params.numResults,
						recencyFilter: params.recencyFilter as RecencyFilter | undefined,
						domainFilter: params.domainFilter,
						includeContent: params.includeContent,
						signal,
					}));
				} catch (error) {
					if (signal?.aborted || isAbortError(error)) throw error;
					results.push({ query, results: [], error: error instanceof Error ? error.message : String(error) });
				}
			}

			const shouldSummarize = params.summary ?? config.summary.enabled;
			let summary: { text: string; model: string } | undefined;
			if (shouldSummarize) {
				const model = params.summaryModel ?? config.summary.model;
				if (!model) throw new Error("Summary is enabled but no summary.model is configured.");
				if (!ctx) throw new Error("Summary requires an active Pi extension context.");
				onUpdate?.({
					content: [{ type: "text", text: `Summarizing with ${model}...` }],
					details: { phase: "summarizing", progress: 1, model },
				});
				summary = await summarizeResults(results, ctx, model, signal);
			}

			const responseId = generateId();
			const stored = { id: responseId, type: "search" as const, timestamp: Date.now(), queries: results };
			storeResult(stored);
			pi.appendEntry("web-search-results", stored);

			const content = summary ? `${summary.text}\n\n${formatResults(results)}` : formatResults(results);
			return {
				content: [{ type: "text", text: content || "No results." }],
				details: {
					responseId,
					queryCount: queries.length,
					totalResults: results.reduce((total, result) => total + result.results.length, 0),
					summary: summary ? { model: summary.model } : undefined,
				},
			};
		},

		renderCall(args, theme) {
			const queries = normalizeQueries(args as { query?: unknown; queries?: unknown });
			if (queries.length === 0) return new Text(theme.fg("error", "search (no query)"), 0, 0);
			const label = queries.length === 1 ? queries[0] : `${queries.length} queries`;
			return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", label), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			const details = result.details as { phase?: string; query?: string; model?: string; totalResults?: number; error?: string } | undefined;
			if (isPartial) {
				const suffix = details?.phase === "summarizing" && details.model ? ` with ${details.model}` : "";
				return new Text(theme.fg("accent", `${details?.phase ?? "searching"}${suffix}${details?.query ? `: ${details.query}` : "..."}`), 0, 0);
			}
			if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			return new Text(theme.fg("success", `${details?.totalResults ?? 0} Exa sources`), 0, 0);
		},
	});

	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description: "Fetch URLs directly and convert HTML to readable Markdown. GitHub URLs are shallow-cloned locally.",
		promptSnippet: "Fetch a web page or inspect a GitHub repository.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "A single URL to fetch." })),
			urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs to fetch." })),
		}),

		async execute(_callId, params, signal, onUpdate) {
			const urls = normalizeUrls(params);
			if (urls.length === 0) return { content: [{ type: "text", text: "Error: provide url or urls." }], details: { error: "No URL provided" } };
			onUpdate?.({
				content: [{ type: "text", text: `Fetching ${urls.length} URL${urls.length === 1 ? "" : "s"}...` }],
				details: { phase: "fetching", progress: 0 },
			});
			const results = await fetchContent(urls, signal);
			const responseId = generateId();
			const stored = { id: responseId, type: "fetch" as const, timestamp: Date.now(), urls: results };
			storeResult(stored);
			pi.appendEntry("web-search-results", stored);
			return {
				content: [{ type: "text", text: formatFetched(results) || "No content." }],
				details: { responseId, urlCount: urls.length, errorCount: results.filter((result) => result.error).length },
			};
		},

		renderCall(args, theme) {
			const urls = normalizeUrls(args as { url?: unknown; urls?: unknown });
			return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", urls.length ? `${urls.length} URL${urls.length === 1 ? "" : "s"}` : "(no URL)"), 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("accent", "fetching..."), 0, 0);
			const details = result.details as { urlCount?: number; errorCount?: number; error?: string } | undefined;
			if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			return new Text(theme.fg("success", `Fetched ${details?.urlCount ?? 0} URL${details?.urlCount === 1 ? "" : "s"}${details?.errorCount ? ` (${details.errorCount} failed)` : ""}`), 0, 0);
		},
	});

	pi.registerTool({
		name: "get_search_content",
		label: "Get Stored Web Content",
		description: "Retrieve full content from a previous web search or fetch by response ID, URL, or query.",
		promptSnippet: "Retrieve previously stored web content by response ID, URL, or query.",
		parameters: Type.Object({
			responseId: Type.Optional(Type.String({ description: "The response ID returned by web_search or fetch_content." })),
			url: Type.Optional(Type.String({ description: "A URL from a previous result." })),
			query: Type.Optional(Type.String({ description: "The original search query." })),
		}),

		async execute(_callId, params) {
			if (typeof params.responseId === "string" && params.responseId.trim()) {
				const result = getResult(params.responseId.trim());
				return { content: [{ type: "text", text: formatStored(result) }], details: { responseId: params.responseId.trim(), found: !!result } };
			}
			const url = typeof params.url === "string" ? params.url.trim() : "";
			const query = typeof params.query === "string" ? params.query.trim().toLowerCase() : "";
			const matches = findResults((data) => {
				if (url) return !!(data.urls?.some((item) => item.url === url) || data.queries?.some((item) => item.results.some((result) => result.url === url)));
				if (query) return !!data.queries?.some((item) => item.query.toLowerCase() === query);
				return false;
			});
			const result = matches.at(-1) ?? null;
			return { content: [{ type: "text", text: formatStored(result) }], details: { responseId: result?.id ?? "", found: !!result } };
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("get stored web content")), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as { found?: boolean } | undefined;
			return new Text(details?.found ? theme.fg("success", "Stored content retrieved") : theme.fg("warning", "No stored content found"), 0, 0);
		},
	});
}
