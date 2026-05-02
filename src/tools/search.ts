import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../cdp.js";
import { detectChallenge } from "../detect.js";

export function registerSearchTools(server: McpServer) {
  server.tool(
    "search",
    "Search the web using Google and return structured results. Handles the full search flow automatically.",
    {
      query: z.string().describe("Search query"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(10)
        .describe("Maximum number of results to return (default 10, max 20)"),
    },
    async ({ query, max_results }) => {
      const client = await getClient();

      // Navigate to Google search
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${max_results}`;
      await client.Page.navigate({ url: searchUrl });
      await Promise.race([
        client.Page.loadEventFired(),
        new Promise((r) => setTimeout(r, 10000)),
      ]);

      // Wait a bit for dynamic content
      await new Promise((r) => setTimeout(r, 1000));

      // Auto-detect challenges using shared detector
      const challenge = await detectChallenge();
      if (challenge?.has_challenge) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "human_verification_needed",
                challenges: challenge.challenges,
                message:
                  "Search page has a verification challenge (" +
                  challenge.challenges.join(", ") +
                  "). Complete it in the browser, then call wait_for_human and retry.",
              }),
            },
          ],
        };
      }

      // Extract search results
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const results = [];
            const seen = new Set();

            function cleanText(text) {
              return (text || '').replace(/\\s+/g, ' ').trim();
            }

            function addResult(titleEl, linkEl, snippetEl) {
              if (!titleEl || !linkEl || !linkEl.href) return;
              const url = linkEl.href;
              if (!/^https?:\\/\\//.test(url)) return;
              if (seen.has(url)) return;

              const title = cleanText(titleEl.textContent || '');
              if (!title) return;

              seen.add(url);
              results.push({
                title,
                url,
                snippet: snippetEl ? cleanText(snippetEl.textContent || '') : ''
              });
            }

            // Google search result selectors
            const items = document.querySelectorAll('div.g, div[data-sokoban-container]');
            for (const item of items) {
              const linkEl = item.querySelector('a[href^="http"]');
              const titleEl = item.querySelector('h3');
              const snippetEl = item.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]');

              addResult(titleEl, linkEl, snippetEl);
              if (results.length >= ${max_results}) break;
            }

            // Fallback for Google layouts where result containers no longer use div.g.
            if (results.length < ${max_results}) {
              const headings = document.querySelectorAll('h3');
              for (const heading of headings) {
                const linkEl = heading.closest('a[href^="http"]')
                  || heading.parentElement?.closest('a[href^="http"]')
                  || heading.querySelector('a[href^="http"]');
                const block = heading.closest('div');
                const snippetEl = block ? block.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]') : null;

                addResult(heading, linkEl, snippetEl);
                if (results.length >= ${max_results}) break;
              }
            }

            return JSON.stringify(results);
          })()
        `,
      });

      const results = JSON.parse(result.value as string);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              query,
              count: results.length,
              results,
            }),
          },
        ],
      };
    }
  );
}
