import { existsSync, readFileSync } from "node:fs";
import { getWebSearchConfigPath } from "./utils.ts";

export interface SummaryConfig {
	enabled: boolean;
	model?: string;
}

export interface WebSearchConfig {
	exaApiKey?: string;
	summary: SummaryConfig;
}

function readConfigFile(): Record<string, unknown> {
	const path = getWebSearchConfigPath();
	if (!existsSync(path)) return {};

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid config in ${path}: ${message}`);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid config in ${path}: expected a JSON object`);
	}
	return parsed as Record<string, unknown>;
}

function readOptionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function readSummaryConfig(value: unknown): SummaryConfig {
	if (value === undefined) return { enabled: false };
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("summary must be an object");
	}

	const summary = value as Record<string, unknown>;
	if (summary.enabled !== undefined && typeof summary.enabled !== "boolean") {
		throw new Error("summary.enabled must be a boolean");
	}

	return {
		enabled: summary.enabled ?? false,
		model: readOptionalString(summary.model, "summary.model"),
	};
}

export function loadConfig(): WebSearchConfig {
	const raw = readConfigFile();
	return {
		exaApiKey: readOptionalString(raw.exaApiKey, "exaApiKey"),
		summary: readSummaryConfig(raw.summary),
	};
}

export function getExaApiKey(config: WebSearchConfig): string {
	const key = config.exaApiKey ?? process.env.EXA_API_KEY?.trim();
	if (!key) {
		throw new Error(`Exa API key missing. Set EXA_API_KEY or add exaApiKey to ${getWebSearchConfigPath()}.`);
	}
	return key;
}
