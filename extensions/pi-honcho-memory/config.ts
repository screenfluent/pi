import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

export type HonchoSessionStrategy = "repo" | "git-branch" | "directory";

export const DEFAULT_CONTEXT_TOKENS = 1200;
export const DEFAULT_MAX_MESSAGE_LENGTH = 8000;
export const DEFAULT_SEARCH_LIMIT = 8;
export const DEFAULT_TOOL_PREVIEW_LENGTH = 500;

export interface HonchoExtensionConfig {
  enabled: boolean;
  apiKey?: string;
  baseURL?: string;
  workspaceId: string;
  userPeerId: string;
  aiPeerId: string;
  sessionStrategy: HonchoSessionStrategy;
  contextTokens: number;
  maxMessageLength: number;
  searchLimit: number;
  toolPreviewLength: number;
}

interface ConfigFileHost {
  workspace?: string;
  aiPeer?: string;
  endpoint?: string;
  sessionStrategy?: HonchoSessionStrategy;
  contextTokens?: number;
  maxMessageLength?: number;
  searchLimit?: number;
  toolPreviewLength?: number;
}

interface ConfigFile {
  apiKey?: string;
  peerName?: string;
  hosts?: {
    pi?: ConfigFileHost;
  };
}

const CONFIG_PATH = join(homedir(), ".honcho", "config.json");
const SESSION_STRATEGIES = ["repo", "git-branch", "directory"] as const;

const isSessionStrategy = (value: string): value is HonchoSessionStrategy =>
  SESSION_STRATEGIES.some((strategy) => strategy === value);

export const normalizePositiveInteger = (
  value: number | string | null | undefined,
  fallback: number,
): number => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
};

export const readConfigFile = async (): Promise<ConfigFile | null> => {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (typeof parsed === "object" && parsed !== null ? parsed : {}) as ConfigFile;
  } catch {
    return null;
  }
};

export const normalizeSessionStrategy = (
  value: string | null | undefined,
): HonchoSessionStrategy => {
  if (value && isSessionStrategy(value)) {
    return value;
  }
  return "repo";
};

export const getSessionStrategyLabel = (strategy: HonchoSessionStrategy): string => {
  const labels: Record<HonchoSessionStrategy, string> = {
    repo: "Repo",
    "git-branch": "Git branch",
    directory: "Directory",
  };
  return labels[strategy];
};

export const resolveConfig = async (): Promise<HonchoExtensionConfig> => {
  const file = await readConfigFile();
  const piHost = file?.hosts?.pi;

  // Enabled gate: explicit env var, otherwise true if API key is available
  const enabledEnv = process.env.HONCHO_ENABLED;
  const apiKey = process.env.HONCHO_API_KEY || file?.apiKey || undefined;
  const enabled = enabledEnv !== undefined ? enabledEnv === "true" : Boolean(apiKey);

  const baseURL = process.env.HONCHO_URL || piHost?.endpoint || undefined;
  const workspaceId = process.env.HONCHO_WORKSPACE_ID || piHost?.workspace || "pi";
  const userPeerId =
    process.env.HONCHO_PEER_NAME || file?.peerName || userInfo().username || "user";
  const aiPeerId = process.env.HONCHO_AI_PEER || piHost?.aiPeer || "pi";
  const sessionStrategy = normalizeSessionStrategy(
    process.env.HONCHO_SESSION_STRATEGY || piHost?.sessionStrategy,
  );
  const contextTokens = normalizePositiveInteger(
    process.env.HONCHO_CONTEXT_TOKENS || piHost?.contextTokens,
    DEFAULT_CONTEXT_TOKENS,
  );
  const maxMessageLength = normalizePositiveInteger(
    process.env.HONCHO_MAX_MESSAGE_LENGTH || piHost?.maxMessageLength,
    DEFAULT_MAX_MESSAGE_LENGTH,
  );
  const searchLimit = normalizePositiveInteger(
    process.env.HONCHO_SEARCH_LIMIT || piHost?.searchLimit,
    DEFAULT_SEARCH_LIMIT,
  );
  const toolPreviewLength = normalizePositiveInteger(
    process.env.HONCHO_TOOL_PREVIEW_LENGTH || piHost?.toolPreviewLength,
    DEFAULT_TOOL_PREVIEW_LENGTH,
  );

  return {
    enabled,
    apiKey,
    baseURL,
    workspaceId,
    userPeerId,
    aiPeerId,
    sessionStrategy,
    contextTokens,
    maxMessageLength,
    searchLimit,
    toolPreviewLength,
  };
};

export const getConfigPath = (): string => CONFIG_PATH;
