import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../cdp.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONTENT_THRESHOLD = 3000; // chars before saving to file
const PREVIEW_LENGTH = 500;

function getTmpDir() {
  return process.env.CHROME_MCP_TMPDIR || path.join(os.tmpdir(), "chrome-mcp");
}

function saveTextArtifact(prefix: string, text: string) {
  const tmpDir = getTmpDir();
  fs.mkdirSync(tmpDir, { recursive: true });

  const filepath = path.join(tmpDir, `${prefix}-${Date.now()}.txt`);
  fs.writeFileSync(filepath, text, "utf8");
  return filepath;
}

function resolveOutputPath(requestedPath: string | undefined, filename: string) {
  const tmpDir = path.resolve(getTmpDir());
  fs.mkdirSync(tmpDir, { recursive: true });

  if (!requestedPath) {
    return path.join(tmpDir, filename);
  }

  const resolved = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(tmpDir, requestedPath);
  const relative = path.relative(tmpDir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Output path must be inside ${tmpDir}`);
  }

  if (path.extname(resolved).toLowerCase() !== ".png") {
    throw new Error("Screenshot path must end with .png");
  }

  return resolved;
}

export function registerContentTools(server: McpServer) {
  server.tool(
    "get_content",
    "Extract text content from the page. Short content returned directly; long content saved to file to preserve context window.",
    {
      selector: z
        .string()
        .optional()
        .describe(
          "CSS selector to extract from. Defaults to auto-detecting main content (article, main, body)"
        ),
      max_length: z
        .number()
        .optional()
        .default(5000)
        .describe("Max characters to extract (default 5000)"),
    },
    async ({ selector, max_length }) => {
      const client = await getClient();

      const extractScript = `
        (function() {
          let el;
          ${
            selector
              ? `el = document.querySelector(${JSON.stringify(selector)});`
              : `el = document.querySelector('article')
                   || document.querySelector('main')
                   || document.querySelector('[role="main"]')
                   || document.body;`
          }
          if (!el) return JSON.stringify({error: "Element not found"});

          // Remove noise elements
          const clone = el.cloneNode(true);
          clone.querySelectorAll('script, style, nav, header, footer, aside, .ad, .ads, .advertisement, [role="navigation"], [role="banner"], [role="contentinfo"]')
            .forEach(n => n.remove());

          let text = clone.innerText || clone.textContent || "";
          // Collapse whitespace
          text = text.replace(/\\n{3,}/g, '\\n\\n').replace(/[ \\t]+/g, ' ').trim();
          text = text.substring(0, ${max_length});

          return JSON.stringify({
            title: document.title,
            url: location.href,
            length: text.length,
            text: text
          });
        })()
      `;

      const { result } = await client.Runtime.evaluate({
        expression: extractScript,
      });

      if (result.type === "undefined" || !result.value) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Failed to extract content" }),
            },
          ],
        };
      }

      const data = JSON.parse(result.value as string);
      if (data.error) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data) }],
        };
      }

      // Short content: return directly
      if (data.text.length < CONTENT_THRESHOLD) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data) }],
        };
      }

      const filepath = saveTextArtifact(
        "content",
        `# ${data.title}\n# ${data.url}\n\n${data.text}`
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              title: data.title,
              url: data.url,
              length: data.text.length,
              saved_to: filepath,
              preview: data.text.substring(0, PREVIEW_LENGTH) + "...",
            }),
          },
        ],
      };
    }
  );

  server.tool(
    "evaluate",
    "Execute JavaScript in the page and return the result. Use for custom data extraction or page manipulation.",
    {
      expression: z
        .string()
        .describe("JavaScript expression to evaluate in the page context"),
    },
    async ({ expression }) => {
      const client = await getClient();
      const { result, exceptionDetails } = await client.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: true,
      });

      if (exceptionDetails) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: exceptionDetails.text,
                description:
                  exceptionDetails.exception?.description || "Unknown error",
              }),
            },
          ],
          isError: true,
        };
      }

      const value =
        typeof result.value === "object"
          ? JSON.stringify(result.value)
          : String(result.value ?? "undefined");

      if (value.length >= CONTENT_THRESHOLD) {
        const filepath = saveTextArtifact("evaluate", value);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                length: value.length,
                saved_to: filepath,
                preview: value.substring(0, PREVIEW_LENGTH) + "...",
              }),
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: value }],
      };
    }
  );

  server.tool(
    "screenshot",
    "Take a screenshot of the current page. Saves to file to avoid consuming context window tokens.",
    {
      path: z
        .string()
        .optional()
        .describe("File path to save screenshot. Defaults to temp directory."),
      full_page: z
        .boolean()
        .optional()
        .default(false)
        .describe("Capture full page or just viewport (default: viewport)"),
    },
    async ({ path: savePath, full_page }) => {
      const client = await getClient();

      const { data } = await client.Page.captureScreenshot({
        format: "png",
        captureBeyondViewport: full_page,
      });

      let filepath: string;
      try {
        filepath = resolveOutputPath(savePath, `screenshot-${Date.now()}.png`);
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
          isError: true,
        };
      }

      fs.mkdirSync(path.dirname(filepath), { recursive: true });
      fs.writeFileSync(filepath, Buffer.from(data, "base64"));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ saved_to: filepath }),
          },
        ],
      };
    }
  );
}
