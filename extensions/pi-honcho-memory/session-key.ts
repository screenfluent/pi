/* eslint-disable no-magic-numbers */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createHash } from "node:crypto"; // eslint-disable-line import/no-nodejs-modules
import type { HonchoSessionStrategy } from "./config.ts";
import { execGit } from "./git.ts"; // eslint-disable-line import/no-named-export

const HASH_LENGTH = 8;
const SSH_MATCH_INDEX = 1;

const shortHash = (input: string): string =>
  createHash("sha256").update(input).digest("hex").slice(0, HASH_LENGTH);

/** Replace any character not in [a-zA-Z0-9_-] with an underscore. */
const sanitize = (input: string): string => input.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * Normalize a git remote URL to owner/repo form.
 *
 * Handles:
 *   git@github.com:owner/repo.git
 *   https://github.com/owner/repo.git
 *   ssh://git@github.com/owner/repo.git
 */
const normalizeGitUrl = (url: string): string | null => {
  // SSH style: git@host:owner/repo.git
  const sshMatch = url.match(/^[^@]+@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[SSH_MATCH_INDEX];
  }

  // HTTPS / SSH protocol style
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
    if (path) {
      return path;
    }
  } catch {
    // Not a valid URL
  }

  return null;
};

const tryGitRemote = async (pi: ExtensionAPI, cwd: string): Promise<string | null> => {
  const result = await execGit(pi, cwd, ["remote", "get-url", "origin"]);
  if (result?.code === 0 && result.stdout.trim()) {
    const normalized = normalizeGitUrl(result.stdout.trim());
    if (normalized) {
      return sanitize(`repo_${normalized}`);
    }
  }
  return null;
};

const tryGitRoot = async (pi: ExtensionAPI, cwd: string): Promise<string | null> => {
  const result = await execGit(pi, cwd, ["rev-parse", "--show-toplevel"]);
  if (result?.code === 0 && result.stdout.trim()) {
    const root = result.stdout.trim();
    const basename = root.split("/").pop() || "repo";
    return sanitize(`local_${basename}_${shortHash(root)}`);
  }
  return null;
};

const tryGitBranch = async (pi: ExtensionAPI, cwd: string): Promise<string | null> => {
  const branchResult = await execGit(pi, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branchResult || branchResult.code !== 0 || !branchResult.stdout.trim()) {
    return null;
  }

  const branch = branchResult.stdout.trim();
  if (branch !== "HEAD") {
    return sanitize(branch);
  }

  const commitResult = await execGit(pi, cwd, ["rev-parse", "--short", "HEAD"]);
  if (commitResult?.code === 0 && commitResult.stdout.trim()) {
    return sanitize(`detached_${commitResult.stdout.trim()}`);
  }

  return null;
};

const deriveRepoScopedKey = async (pi: ExtensionAPI, cwd: string): Promise<string> => {
  const remoteKey = await tryGitRemote(pi, cwd);
  if (remoteKey) {
    return remoteKey;
  }

  const rootKey = await tryGitRoot(pi, cwd);
  if (rootKey) {
    return rootKey;
  }

  const basename = cwd.split("/").pop() || "project";
  return sanitize(`cwd_${basename}_${shortHash(cwd)}`);
};

const deriveDirectoryScopedKey = (cwd: string): string => {
  const basename = cwd.split("/").pop() || "project";
  return sanitize(`cwd_${basename}_${shortHash(cwd)}`);
};

/**
 * Derive a stable Honcho session key from the current working directory.
 *
 * Strategies:
 *   - repo: share memory across git worktrees of the same repo
 *   - git-branch: separate memory per branch inside the same repo
 *   - directory: separate memory per working directory
 */
const deriveSessionKey = async (
  pi: ExtensionAPI,
  cwd: string,
  sessionStrategy: HonchoSessionStrategy,
): Promise<string> => {
  if (sessionStrategy === "directory") {
    return deriveDirectoryScopedKey(cwd);
  }

  const repoKey = await deriveRepoScopedKey(pi, cwd);
  if (sessionStrategy === "git-branch") {
    const branch = await tryGitBranch(pi, cwd);
    if (branch) {
      return `${repoKey}__branch_${branch}`;
    }
  }

  return repoKey;
};

// eslint-disable-next-line import/prefer-default-export, import/no-named-export
export { deriveSessionKey };
