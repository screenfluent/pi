import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const STATE_FILE = path.join(os.homedir(), ".pi", "go-state.json");

// USER: Put your OpenCode Go API keys here.
// Example:
// const KEYS = ["sk-key-1", "sk-key-2"];
const KEYS: string[] = [
  // "sk-key-1",
  // "sk-key-2",
  // "sk-key-3",
];

let currentIndex = 0;

function loadState(): number {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return Number.isInteger(data.currentIndex) && data.currentIndex >= 0
      ? data.currentIndex
      : 0;
  } catch {
    return 0;
  }
}

function saveState(index: number): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ currentIndex: index }, null, 2));
}

function applyKey(index: number, pi: ExtensionAPI): string {
  if (KEYS.length === 0) {
    return "❌ No keys configured. Edit pi-go.ts and add your API keys.";
  }

  currentIndex = index;
  saveState(index);

  // Important: we only override apiKey here. Per Pi's registerProvider docs,
  // omitting models keeps the built-in opencode-go model definitions intact.
  pi.registerProvider("opencode-go", { apiKey: KEYS[index] });

  return `✅ Switched to opencode-go #${index + 1} of ${KEYS.length}`;
}

export default function (pi: ExtensionAPI) {
  // Restore the last-selected key on startup/reload.
  pi.on("session_start", () => {
    currentIndex = loadState();

    if (KEYS.length === 0) {
      return;
    }

    if (currentIndex >= KEYS.length) {
      currentIndex = 0;
      saveState(currentIndex);
    }

    // This takes effect immediately without ctx.reload().
    pi.registerProvider("opencode-go", { apiKey: KEYS[currentIndex] });
  });

  pi.registerCommand("go", {
    description: "Switch OpenCode Go account (1/2/3 or next)",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        ...KEYS.map((_, i) => ({ value: String(i + 1), label: `Account #${i + 1}` })),
        { value: "next", label: "Next account" },
      ];

      return items.filter((item) => item.value.startsWith(prefix));
    },
    handler: async (args: string) => {
      if (KEYS.length === 0) {
        return "❌ No keys configured. Edit pi-go.ts and add your API keys.";
      }

      const command = args.trim().toLowerCase();

      if (command === "next") {
        return applyKey((currentIndex + 1) % KEYS.length, pi);
      }

      const num = parseInt(command, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= KEYS.length) {
        return applyKey(num - 1, pi);
      }

      return `Usage: /go 1-${KEYS.length} | /go next`;
    },
  });
}
