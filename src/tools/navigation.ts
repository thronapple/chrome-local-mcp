import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../cdp.js";
import { detectChallenge, challengeWarning } from "../detect.js";

export function registerNavigationTools(server: McpServer) {
  server.tool(
    "navigate",
    "Navigate to a URL in the current tab",
    { url: z.string().describe("The URL to navigate to") },
    async ({ url }) => {
      const client = await getClient();
      await client.Page.navigate({ url });
      // Race: wait for load event or timeout after 10s
      await Promise.race([
        client.Page.loadEventFired(),
        new Promise((r) => setTimeout(r, 10000)),
      ]);

      const { result } = await client.Runtime.evaluate({
        expression: "document.title",
      });

      const response: any = {
        status: "ok",
        title: result.value,
        url,
      };

      // Auto-detect challenges after navigation
      const challenge = await detectChallenge();
      if (challenge?.has_challenge) {
        response.status = "human_verification_needed";
        response.challenges = challenge.challenges;
        response.message =
          "Page has a verification challenge. Complete it in the browser, then call wait_for_human or retry.";
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response),
          },
        ],
      };
    }
  );

  server.tool(
    "wait_for",
    "Wait for an element to appear on the page",
    {
      selector: z.string().describe("CSS selector to wait for"),
      timeout: z
        .number()
        .optional()
        .default(10000)
        .describe("Timeout in ms (default 10000)"),
    },
    async ({ selector, timeout }) => {
      const client = await getClient();
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const { result } = await client.Runtime.evaluate({
          expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        });
        if (result.value === true) {
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ found: true }) },
            ],
          };
        }
        await new Promise((r) => setTimeout(r, 300));
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ found: false, reason: "timeout" }),
          },
        ],
      };
    }
  );

  server.tool(
    "go_back",
    "Navigate back in browser history",
    {},
    async () => {
      const client = await getClient();
      const entryId = await getHistoryEntryId(client, -1);

      if (entryId === null) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                error: "no_history_entry",
                message: "There is no previous browser history entry in this tab.",
              }),
            },
          ],
          isError: true,
        };
      }

      await client.Page.navigateToHistoryEntry({
        entryId,
      });

      // Wait for navigation to settle (loadEventFired can hang on some pages)
      await new Promise((r) => setTimeout(r, 1500));

      const { result } = await client.Runtime.evaluate({
        expression: "JSON.stringify({title: document.title, url: location.href})",
      });

      let text =
        typeof result.value === "string"
          ? result.value
          : JSON.stringify({ status: "ok" });

      // Auto-detect challenges after going back
      const challenge = await detectChallenge();
      if (challenge?.has_challenge) {
        const parsed = JSON.parse(text);
        parsed.challenges = challenge.challenges;
        parsed.message = "Verification detected after going back." + challengeWarning(challenge);
        text = JSON.stringify(parsed);
      }

      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}

async function getHistoryEntryId(
  client: any,
  offset: number
): Promise<number | null> {
  const { currentIndex, entries } = await client.Page.getNavigationHistory();
  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= entries.length) {
    return null;
  }
  return entries[targetIndex].id;
}
