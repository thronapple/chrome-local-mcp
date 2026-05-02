import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../cdp.js";
import { detectChallenge } from "../detect.js";

export function registerInteractionTools(server: McpServer) {
  server.tool(
    "click",
    "Click an element on the page",
    {
      selector: z.string().describe("CSS selector of the element to click"),
    },
    async ({ selector }) => {
      const client = await getClient();

      // Get element center coordinates
      const selectorJson = JSON.stringify(selector);
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const el = document.querySelector(${selectorJson});
            if (!el) return JSON.stringify({error: "not_found"});
            const rect = el.getBoundingClientRect();
            return JSON.stringify({
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            });
          })()
        `,
      });

      const pos = JSON.parse(result.value as string);
      if (pos.error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Element not found: " + selector }),
            },
          ],
          isError: true,
        };
      }

      await client.Input.dispatchMouseEvent({
        type: "mousePressed",
        x: pos.x,
        y: pos.y,
        button: "left",
        clickCount: 1,
      });
      await client.Input.dispatchMouseEvent({
        type: "mouseReleased",
        x: pos.x,
        y: pos.y,
        button: "left",
        clickCount: 1,
      });

      // Brief wait for any navigation/JS to process
      await new Promise((r) => setTimeout(r, 500));

      // Auto-detect challenges after click (may have triggered navigation)
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
                  "Click triggered a verification page. Complete it in the browser, then call wait_for_human.",
              }),
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: "ok" }],
      };
    }
  );

  server.tool(
    "fill",
    "Fill a form input field with a value",
    {
      selector: z.string().describe("CSS selector of the input element"),
      value: z.string().describe("Value to fill in"),
    },
    async ({ selector, value }) => {
      const client = await getClient();

      // Focus and clear the element
      const selectorJson = JSON.stringify(selector);
      const { result } = await client.Runtime.evaluate({
        expression: `
          (function() {
            const el = document.querySelector(${selectorJson});
            if (!el) return "not_found";
            el.focus();
            el.value = '';
            el.dispatchEvent(new Event('input', {bubbles: true}));
            return "ok";
          })()
        `,
      });

      if (result.value === "not_found") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Element not found: " + selector }),
            },
          ],
          isError: true,
        };
      }

      // Type the value character by character via CDP Input
      for (const char of value) {
        await client.Input.dispatchKeyEvent({
          type: "keyDown",
          text: char,
        });
        await client.Input.dispatchKeyEvent({
          type: "keyUp",
          text: char,
        });
      }

      // Trigger change event
      await client.Runtime.evaluate({
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) {
              el.dispatchEvent(new Event('change', {bubbles: true}));
              el.dispatchEvent(new Event('input', {bubbles: true}));
            }
          })()
        `,
      });

      return {
        content: [{ type: "text" as const, text: "ok" }],
      };
    }
  );

  server.tool(
    "press_key",
    "Press a keyboard key (Enter, Tab, Escape, etc.)",
    {
      key: z.string().describe("Key to press (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown')"),
    },
    async ({ key }) => {
      const client = await getClient();

      await client.Input.dispatchKeyEvent({
        type: "keyDown",
        key,
        windowsVirtualKeyCode: getKeyCode(key),
      });
      await client.Input.dispatchKeyEvent({
        type: "keyUp",
        key,
        windowsVirtualKeyCode: getKeyCode(key),
      });

      return {
        content: [{ type: "text" as const, text: "ok" }],
      };
    }
  );

  server.tool(
    "scroll",
    "Scroll the page",
    {
      direction: z.enum(["up", "down"]).describe("Scroll direction"),
      amount: z
        .number()
        .optional()
        .default(500)
        .describe("Pixels to scroll (default 500)"),
    },
    async ({ direction, amount }) => {
      const client = await getClient();
      const y = direction === "down" ? amount : -amount;
      await client.Runtime.evaluate({
        expression: `window.scrollBy(0, ${y})`,
      });

      const { result } = await client.Runtime.evaluate({
        expression: `JSON.stringify({scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight, innerHeight: window.innerHeight})`,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: typeof result.value === "string"
              ? result.value
              : JSON.stringify({ status: "scrolled", direction, amount }),
          },
        ],
      };
    }
  );
}

function getKeyCode(key: string): number {
  const codes: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Space: 32,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
  };
  return codes[key] || 0;
}
