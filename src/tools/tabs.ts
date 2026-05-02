import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTargets, connectToTarget, getClient, getCurrentTargetId, disconnect } from "../cdp.js";
import { detectChallenge } from "../detect.js";

export function registerTabTools(server: McpServer) {
  server.tool(
    "tab_list",
    "List all open browser tabs",
    {},
    async () => {
      const tabs = await getTargets();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              tabs.map((t) => ({ id: t.id, title: t.title, url: t.url }))
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "tab_open",
    "Open a new tab with the specified URL",
    {
      url: z.string().describe("URL to open in the new tab"),
    },
    async ({ url }) => {
      const client = await getClient();
      const { targetId } = await client.Target.createTarget({ url });
      await connectToTarget(targetId);

      // Wait for page load (with timeout to avoid hanging)
      const newClient = await getClient();
      await Promise.race([
        newClient.Page.loadEventFired(),
        new Promise((r) => setTimeout(r, 10000)),
      ]);

      const { result } = await newClient.Runtime.evaluate({
        expression: "document.title",
      });

      const response: any = { id: targetId, title: result.value, url };

      // Auto-detect challenges
      const challenge = await detectChallenge();
      if (challenge?.has_challenge) {
        response.status = "human_verification_needed";
        response.challenges = challenge.challenges;
        response.message =
          "New tab has a verification challenge. Complete it in the browser, then call wait_for_human.";
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(response) },
        ],
      };
    }
  );

  server.tool(
    "tab_switch",
    "Switch to a specific tab by its ID",
    {
      id: z.string().describe("Tab ID from tab_list"),
    },
    async ({ id }) => {
      await connectToTarget(id);
      const client = await getClient();

      // Bring tab to front
      await client.Page.bringToFront();

      const { result } = await client.Runtime.evaluate({
        expression:
          'JSON.stringify({title: document.title, url: location.href})',
      });

      let text =
        typeof result.value === "string"
          ? result.value
          : JSON.stringify({ status: "switched", id });

      // Auto-detect challenges
      const challenge = await detectChallenge();
      if (challenge?.has_challenge) {
        const parsed = JSON.parse(text);
        parsed.status = "human_verification_needed";
        parsed.challenges = challenge.challenges;
        parsed.message =
          "Tab has a verification challenge. Complete it in the browser, then call wait_for_human.";
        text = JSON.stringify(parsed);
      }

      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  server.tool(
    "tab_close",
    "Close a tab by its ID. If no ID provided, closes the current tab.",
    {
      id: z.string().optional().describe("Tab ID to close. Omit to close current tab."),
    },
    async ({ id }) => {
      const targetId = id || await getCurrentTargetId();
      let closingCurrentTab = !id;
      if (id) {
        try {
          closingCurrentTab = id === await getCurrentTargetId();
        } catch {
          closingCurrentTab = false;
        }
      }
      const client = await getClient();

      await client.Target.closeTarget({ targetId });

      if (closingCurrentTab) {
        await disconnect();
      }

      return {
        content: [{ type: "text" as const, text: "ok" }],
      };
    }
  );
}
