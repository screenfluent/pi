import type { Peer, Session } from "@honcho-ai/sdk";
import { Honcho } from "@honcho-ai/sdk"; // eslint-disable-line no-duplicate-imports
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { HonchoExtensionConfig } from "./config.ts";
import { deriveSessionKey } from "./session-key.ts";

export interface HonchoHandles {
  honcho: Honcho;
  userPeer: Peer;
  aiPeer: Peer;
  session: Session;
  sessionKey: string;
  config: HonchoExtensionConfig;
}

let cachedHandles: HonchoHandles | null = null;

export const getHandles = (): HonchoHandles | null => cachedHandles;

export const clearHandles = (): void => {
  cachedHandles = null;
};

/**
 * Bootstrap the Honcho client and resolve all handles.
 * Throws on failure — callers must catch and degrade gracefully.
 */
export const bootstrap = async (
  pi: ExtensionAPI,
  config: HonchoExtensionConfig,
  cwd: string,
): Promise<HonchoHandles> => {
  const honcho = new Honcho({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    workspaceId: config.workspaceId,
  });

  const sessionKey = await deriveSessionKey(pi, cwd, config.sessionStrategy);

  const [userPeer, aiPeer, session] = await Promise.all([
    honcho.peer(config.userPeerId),
    honcho.peer(config.aiPeerId),
    honcho.session(sessionKey),
  ]);

  await session.addPeers([userPeer, aiPeer]);

  cachedHandles = { honcho, userPeer, aiPeer, session, sessionKey, config };
  return cachedHandles;
};
