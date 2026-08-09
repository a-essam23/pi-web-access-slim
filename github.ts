import { execFile as execFileCallback } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExtractedContent } from "./storage.ts";

const execFile = promisify(execFileCallback);
const cloneCache = new Map<string, Promise<string>>();

interface GitHubTarget {
	owner: string;
	repo: string;
	ref?: string;
	path?: string;
}

function cloneRoot(): string {
	return process.env.PI_WEB_ACCESS_CLONE_DIR?.trim() || join(homedir(), ".cache", "pi-web-access-slim", "github");
}

export function parseGitHubUrl(value: string): GitHubTarget | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.hostname.toLowerCase() !== "github.com") return null;
	const parts = url.pathname.split("/").filter(Boolean);
	if (parts.length < 2) return null;

	const owner = parts[0];
	const repo = parts[1].replace(/\.git$/, "");
	if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
	if (parts.length === 2) return { owner, repo };
	if (parts[2] !== "blob" && parts[2] !== "tree") return { owner, repo };
	if (parts.length < 4) return { owner, repo };
	return { owner, repo, ref: parts[3], path: parts.slice(4).join("/") || undefined };
}

async function cloneRepository(target: GitHubTarget): Promise<string> {
	const key = `${target.owner}/${target.repo}#${target.ref ?? "default"}`;
	const existing = cloneCache.get(key);
	if (existing) return existing;

	const refDirectory = target.ref?.replace(/[^A-Za-z0-9_.-]+/g, "_") || "default";
	const destination = join(cloneRoot(), target.owner, target.repo, refDirectory);
	const operation = (async () => {
		if (existsSync(join(destination, ".git"))) return destination;
		mkdirSync(join(cloneRoot(), target.owner, target.repo), { recursive: true });
		const branchArgs = target.ref ? ["--branch", target.ref] : [];
		await execFile("git", [
			"clone",
			"--depth",
			"1",
			"--single-branch",
			...branchArgs,
			`https://github.com/${target.owner}/${target.repo}.git`,
			destination,
		], { timeout: 120_000, maxBuffer: 1024 * 1024 });
		return destination;
	})();
	cloneCache.set(key, operation);
	try {
		return await operation;
	} catch (error) {
		cloneCache.delete(key);
		throw error;
	}
}

function pathWithin(root: string, requestedPath: string | undefined): string {
	const candidate = resolve(root, requestedPath ?? ".");
	const rootWithSeparator = root.endsWith("/") ? root : `${root}/`;
	if (candidate !== root && !candidate.startsWith(rootWithSeparator)) throw new Error("Requested GitHub path escapes the repository");
	return candidate;
}

async function describePath(root: string, requestedPath: string | undefined): Promise<string> {
	const targetPath = pathWithin(root, requestedPath);
	if (existsSync(targetPath)) {
		if (targetPath !== root && statSync(targetPath).isFile()) return readFileSync(targetPath, "utf8");
	}

	const { stdout } = await execFile("git", ["-C", root, "ls-tree", "-r", "--name-only", "HEAD"], { maxBuffer: 2 * 1024 * 1024 });
	const prefix = requestedPath ? `${requestedPath.replace(/\/$/, "")}/` : "";
	const entries = stdout.split("\n").filter((entry) => entry && entry.startsWith(prefix)).slice(0, 200);
	return `Repository cloned to: ${root}\n${entries.length ? entries.join("\n") : "No matching files found."}`;
}

export async function fetchGitHub(value: string): Promise<ExtractedContent | null> {
	const target = parseGitHubUrl(value);
	if (!target) return null;
	try {
		const root = await cloneRepository(target);
		const content = await describePath(root, target.path);
		return { url: value, title: `${target.owner}/${target.repo}`, content, error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { url: value, title: `${target.owner}/${target.repo}`, content: "", error: `GitHub clone failed: ${message}` };
	}
}

export function clearGitHubCache(): void {
	cloneCache.clear();
}
