import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../cdp.js";
import { detectChallenge } from "../detect.js";

export function registerHumanTools(server: McpServer) {
  server.tool(
    "wait_for_human",
    "Pause and wait for human intervention (e.g. CAPTCHA, login, verification). Polls the page until the challenge is solved, a condition is met, or the page changes. Returns within 45s to avoid MCP timeout — if still waiting, returns status='waiting' and should be called again.",
    {
      reason: z
        .string()
        .describe(
          "Why human intervention is needed (shown to the user)"
        ),
      wait_until_gone: z
        .string()
        .optional()
        .describe(
          "CSS selector that should disappear (e.g. CAPTCHA container). Polling stops when this element is gone."
        ),
      wait_until_present: z
        .string()
        .optional()
        .describe(
          "CSS selector that should appear (e.g. main content after login). Polling stops when this element appears."
        ),
      timeout: z
        .number()
        .optional()
        .default(45000)
        .describe("Max wait time in ms (default 45000). Returns 'waiting' if not resolved, call again to continue."),
      poll_interval: z
        .number()
        .optional()
        .default(2000)
        .describe("How often to check in ms (default 2000)"),
    },
    async ({ reason, wait_until_gone, wait_until_present, timeout, poll_interval }, extra) => {
      const client = await getClient();
      const startTime = Date.now();
      let pollCount = 0;

      const hasExplicitCondition = !!(wait_until_gone || wait_until_present);

      // Snapshot initial state for change detection
      let initialUrl = "";
      let initialTitle = "";
      try {
        const { result } = await client.Runtime.evaluate({
          expression:
            'JSON.stringify({url: location.href, title: document.title})',
        });
        const initial = JSON.parse(result.value as string);
        initialUrl = initial.url;
        initialTitle = initial.title;
      } catch {
        // ignore
      }

      while (Date.now() - startTime < timeout) {
        await new Promise((r) => setTimeout(r, poll_interval));
        pollCount++;

        // Send progress notification to keep the client connection alive
        // (prevents MCP SDK's 60s request timeout from killing the wait)
        try {
          await extra.sendNotification({
            method: "notifications/progress" as any,
            params: {
              progressToken: "wait_for_human",
              progress: pollCount,
              total: Math.ceil(timeout / poll_interval),
              message: `Waiting for human: ${reason} (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`,
            } as any,
          });
        } catch {
          // Client may not support progress notifications, that's ok
        }

        try {
          // Check 1: Explicit selector conditions
          if (wait_until_gone) {
            const { result } = await client.Runtime.evaluate({
              expression: `!document.querySelector(${JSON.stringify(wait_until_gone)})`,
            });
            if (result.value === true) {
              return makeResult("ready", reason, Date.now() - startTime);
            }
          }

          if (wait_until_present) {
            const { result } = await client.Runtime.evaluate({
              expression: `!!document.querySelector(${JSON.stringify(wait_until_present)})`,
            });
            if (result.value === true) {
              return makeResult("ready", reason, Date.now() - startTime);
            }
          }

          if (hasExplicitCondition) {
            continue;
          }

          // Check 2: Smart challenge detection for default wait mode.
          // Uses detectChallenge() which knows that a solved reCAPTCHA != active challenge
          const challenge = await detectChallenge();
          if (challenge && !challenge.has_challenge) {
            return makeResult("ready", reason, Date.now() - startTime);
          }

          // Check 3: URL/title change detection (fallback when no explicit conditions)
          const { result } = await client.Runtime.evaluate({
            expression:
              'JSON.stringify({url: location.href, title: document.title})',
          });
          const current = JSON.parse(result.value as string);
          if (
            current.url !== initialUrl ||
            current.title !== initialTitle
          ) {
            return makeResult("ready", reason, Date.now() - startTime);
          }
        } catch {
          // Page might be navigating, keep waiting
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "waiting",
              reason,
              waited_ms: Date.now() - startTime,
              message:
                "Still waiting for human intervention. Call wait_for_human again to continue polling.",
            }),
          },
        ],
      };
    }
  );

  server.tool(
    "check_page_status",
    "Check if the current page has an unsolved verification challenge (CAPTCHA, Cloudflare, etc.). Distinguishes between 'challenge present' and 'challenge solved'.",
    {},
    async () => {
      const client = await getClient();

      // Use shared detection (which checks solved state)
      const challenge = await detectChallenge();

      // Also get basic page info
      const { result } = await client.Runtime.evaluate({
        expression: 'JSON.stringify({url: location.href, title: document.title})',
      });

      const pageInfo =
        typeof result.value === "string"
          ? JSON.parse(result.value)
          : { url: "", title: "" };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ...pageInfo,
              has_challenge: challenge?.has_challenge ?? false,
              challenges: challenge?.challenges ?? [],
            }),
          },
        ],
      };
    }
  );
}

function makeResult(status: string, reason: string, waitedMs: number) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status,
          reason,
          waited_ms: waitedMs,
        }),
      },
    ],
  };
}
