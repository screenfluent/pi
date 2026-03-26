import type { HonchoHandles } from "./client.ts";

// --- Cached memory text ---
const PERSISTENT_MEMORY_HEADER = "[Persistent memory]";
const USER_PROFILE_LABEL = "User profile";
const PROJECT_SUMMARY_LABEL = "Project summary";
interface CachedMemoryParts {
  userProfile: string | null;
  projectSummary: string | null;
}

interface CachedHonchoContext {
  peerRepresentation?: string | null;
  summary?: { content?: string | null } | null;
}

const EMPTY_MEMORY: CachedMemoryParts = {
  userProfile: null,
  projectSummary: null,
};

let cachedMemory = EMPTY_MEMORY;

const buildSection = (label: string, value: string | null): string | null => {
  if (!value) {
    return null;
  }

  return `${PERSISTENT_MEMORY_HEADER}\n${label}:\n${value}`;
};

const normalizeMemoryText = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

export const buildCachedMemoryParts = (context: CachedHonchoContext): CachedMemoryParts => ({
  userProfile: normalizeMemoryText(context.peerRepresentation),
  projectSummary: normalizeMemoryText(context.summary?.content),
});

export const buildUserProfileText = (userProfile: string | null): string | null =>
  buildSection(USER_PROFILE_LABEL, userProfile);

export const buildProjectSummaryText = (projectSummary: string | null): string | null =>
  buildSection(PROJECT_SUMMARY_LABEL, projectSummary);

const buildCombinedMemoryText = (parts: CachedMemoryParts): string | null => {
  const sections = [
    parts.userProfile ? `${USER_PROFILE_LABEL}:\n${parts.userProfile}` : null,
    parts.projectSummary ? `${PROJECT_SUMMARY_LABEL}:\n${parts.projectSummary}` : null,
  ].filter((section): section is string => section !== null);

  if (sections.length === 0) {
    return null;
  }

  return `${PERSISTENT_MEMORY_HEADER}\n${sections.join("\n\n")}`;
};

export const buildMemoryText = (context: CachedHonchoContext): string | null =>
  buildCombinedMemoryText(buildCachedMemoryParts(context));

export const getCachedMemory = (): string | null => buildCombinedMemoryText(cachedMemory);

export const clearCachedMemory = (): void => {
  cachedMemory = EMPTY_MEMORY;
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
 * Fetch both user profile and project summary from Honcho and cache them.
 * Called once at session start — project summary is frozen for the session.
 */
export const refreshMemoryCache = async (handles: HonchoHandles): Promise<void> => {
  try {
    const ctx = await handles.session.context({
      summary: true,
      peerPerspective: handles.aiPeer,
      peerTarget: handles.userPeer,
      tokens: handles.config.contextTokens,
    });

    cachedMemory = buildCachedMemoryParts(ctx);
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

interface ConversationAgentMessage {
  role?: string;
  content?: unknown;
}

/**
 * Extract user/assistant text pairs from agent_end messages.
 * Skips tool results, images, and oversized blobs.
 */
export const extractConversationalPairs = (
  messages: ConversationAgentMessage[],
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
 * Save conversational messages to Honcho.
 * Memory is only fetched at session start — mid-session context comes
 * from the conversation history itself.
 * Enqueued so saves happen in order without racing.
 */
export const saveMessages = (
  handles: HonchoHandles,
  messages: ConversationAgentMessage[],
): Promise<void> => {
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
  });
};
