import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { bootstrap, clearHandles, getHandles } from "./client.ts";
import { registerCommands } from "./commands.ts";
import { resolveConfig } from "./config.ts";
import {
  clearCachedMemory,
  flushPending,
  getCachedMemory,
  refreshMemoryCache,
  saveMessages,
} from "./memory.ts";
import { registerTools } from "./tools.ts";

interface StatusContext {
  ui: {
    setStatus: (id: string, text: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    theme: any;
  };
}

const setStatus = (
  ctx: StatusContext,
  state: "off" | "connected" | "syncing" | "offline" | "error",
): void => {
  const { theme } = ctx.ui;
  const labels: Record<string, string> = {
    off: theme.fg("dim", "🧠 Honcho off"),
    connected: theme.fg("success", "🧠 Connected"),
    syncing: theme.fg("warning", "🧠 Syncing"),
    offline: theme.fg("dim", "🧠 Offline"),
    error: theme.fg("error", "🧠 Error"),
  };
  ctx.ui.setStatus("honcho", labels[state]);
};

export default function honcho(pi: ExtensionAPI): void {
  let initializing: Promise<void> | null = null;

  // --- Register tools & commands (always, so they can show helpful errors if not connected) ---
  registerTools(pi);
  registerCommands(pi);

  /**
   * Non-blocking bootstrap: kicks off Honcho initialization in the background.
   * Sets status on completion. Never throws.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const backgroundInit = (ctx: { ui: any; cwd: string }): void => {
    initializing = (async () => {
      try {
        const config = await resolveConfig();
        if (!config.enabled || !config.apiKey) {
          setStatus(ctx, "off");
          return;
        }

        const handles = await bootstrap(pi, config, ctx.cwd);
        setStatus(ctx, "connected");

        // Prefetch memory context
        await refreshMemoryCache(handles);
      } catch {
        setStatus(ctx, "offline");
      } finally {
        initializing = null;
      }
    })();
  };

  // --- Lifecycle events ---

  let lastCtx: { ui: any; cwd: string } | null = null;

  pi.on("session_start", async (event, ctx) => {
    lastCtx = ctx;
    if (event.reason === "startup" || event.reason === "reload") {
      clearHandles();
      clearCachedMemory();
      backgroundInit(ctx);
    } else {
      // "new" | "resume" | "fork" — flush first, then reinit
      await flushPending();
      clearHandles();
      clearCachedMemory();
      backgroundInit(ctx);
    }
  });

  // Re-bootstrap when pi-workon switches project (new cwd = new session key)
  pi.events.on("workon:switch", async (data: { path: string; name: string }) => {
    await flushPending();
    clearHandles();
    clearCachedMemory();
    const ctx = lastCtx || { ui: { setStatus: () => {}, theme: { fg: () => "" } }, cwd: data.path };
    backgroundInit({ ...ctx, cwd: data.path });
  });

  // --- Prompt path: inject cached memory into system prompt (0ms network) ---

  pi.on("before_agent_start", async (event) => {
    // Wait for initial bootstrap if it's still running on the very first prompt
    if (initializing) {
      await initializing;
    }

    const memoryText = getCachedMemory();
    if (!memoryText) {
      return;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${memoryText}`,
    };
  });

  // --- Post-response: save messages + refresh cache ---

  pi.on("agent_end", async (event, ctx) => {
    const handles = getHandles();
    if (!handles) {
      return;
    }

    setStatus(ctx, "syncing");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion
    saveMessages(handles, event.messages as any[])
      .then(() => setStatus(ctx, "connected"))
      .catch(() => setStatus(ctx, "offline"));
  });

  // --- Flush on lifecycle edges ---

  pi.on("session_before_compact", async () => {
    await flushPending();
  });

  pi.on("session_before_switch", async () => {
    await flushPending();
  });

  pi.on("session_before_fork", async () => {
    await flushPending();
  });

  pi.on("session_shutdown", async () => {
    await flushPending();
  });
}
