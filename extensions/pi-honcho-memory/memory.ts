/* eslint-disable no-magic-numbers */
import type { HonchoHandles } from "./client.ts";

// --- Cached memory text ---
const PERSISTENT_MEMORY_HEADER = "[Persistent memory]";
const USER_PROFILE_LABEL = "User profile";
const PROJECT_SUMMARY_LABEL = "Project summary";

let cachedMemoryText: string | null = null;

export const getCachedMemory = (): string | null => cachedMemoryText;

export const clearCachedMemory = (): void => {
  cachedMemoryText = null;
};

// --- Async save queue ---
let pendingSave: Promise<void> = Promise.resolve();

const enqueue = (fn: () => Promise<void>): Promise<void> => {
  pendingSave = pendingSave.then(fn, () => fn());
  return pendingSave;
};

export const flushPending = (): Promise<void> => pendingSave;

// --- Memory fetch ---

/**
 * Fetch context from Honcho and cache it for injection.
 * Non-blocking from the caller's perspective when used after save.
 */
export const buildMemoryText = (context: {
  peerRepresentation?: string | null;
  summary?: { content?: string | null } | null;
}): string | null => {
  const parts: string[] = [];

  if (context.peerRepresentation) {
    parts.push(`${USER_PROFILE_LABEL}:\n${context.peerRepresentation}`);
  }

  if (context.summary?.content) {
    parts.push(`${PROJECT_SUMMARY_LABEL}:\n${context.summary.content}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return `${PERSISTENT_MEMORY_HEADER}\n${parts.join("\n\n")}`;
};

export const refreshMemoryCache = async (handles: HonchoHandles): Promise<void> => {
  try {
    const ctx = await handles.session.context({
      summary: true,
      peerPerspective: handles.aiPeer,
      peerTarget: handles.userPeer,
      tokens: handles.config.contextTokens,
    });

    cachedMemoryText = buildMemoryText(ctx);
  } catch {
    // Keep stale cache on failure rather than clearing it
  }
};

// --- Message extraction helpers ---

interface ContentBlock {
  type?: string;
  text?: string;
}

const isTextBlock = (block: ContentBlock): block is ContentBlock & { text: string } =>
  block.type === "text" && typeof block.text === "string";

const extractText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return (content as ContentBlock[])
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n")
    .trim();
};

interface AgentMessage {
  role?: string;
  content?: unknown;
}

/**
 * Extract user/assistant text pairs from agent_end messages.
 * Skips tool results, images, and oversized blobs.
 */
export const extractConversationalPairs = (
  messages: AgentMessage[],
  maxMessageLength: number,
): { role: "user" | "assistant"; text: string }[] => {
  const pairs: { role: "user" | "assistant"; text: string }[] = [];

  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") {
      continue;
    }

    const text = extractText(msg.content);
    if (!text || text.length > maxMessageLength) {
      continue;
    }

    pairs.push({ role: msg.role, text });
  }

  return pairs;
};

// --- Save + refresh pipeline ---

/**
 * Save conversational messages to Honcho then refresh the cache.
 * Enqueued so saves and refreshes happen in order without racing.
 */
export const saveAndRefresh = (handles: HonchoHandles, messages: AgentMessage[]): Promise<void> => {
  const pairs = extractConversationalPairs(messages, handles.config.maxMessageLength);
  if (pairs.length === 0) {
    return Promise.resolve();
  }

  return enqueue(async () => {
    try {
      const honchoMessages = pairs.map((pair) => {
        if (pair.role === "user") {
          return handles.userPeer.message(pair.text);
        }
        return handles.aiPeer.message(pair.text);
      });
      await handles.session.addMessages(honchoMessages);
    } catch {
      // Non-fatal: message save failed, will retry on next turn
    }

    await refreshMemoryCache(handles);
  });
};
