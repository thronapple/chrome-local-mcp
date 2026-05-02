/**
 * Test: reCAPTCHA solved-state detection
 * 1. Navigate to reCAPTCHA demo
 * 2. Check status (should be: has_challenge=true)
 * 3. Wait 30s for human to solve
 * 4. Check status again (should be: has_challenge=false)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/mnt/d/repository/chrome-local-mcp/dist/index.js"],
});
const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(transport);

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  return r.content[0].text;
}

// Step 1
console.log("=== Navigate to reCAPTCHA demo ===");
console.log(await call("navigate", { url: "https://www.google.com/recaptcha/api2/demo" }));

// Step 2
console.log("\n=== check_page_status (BEFORE solving) ===");
console.log(await call("check_page_status"));

console.log("\n=== recaptcha response token (BEFORE) ===");
const tokenBefore = await call("evaluate", {
  expression: '(document.querySelector("#g-recaptcha-response")?.value || "").length',
});
console.log("Token length:", tokenBefore);

// Step 3
console.log("\n>>> Please solve the reCAPTCHA in Chrome NOW!");
console.log(">>> Waiting 30 seconds...\n");
await new Promise((r) => setTimeout(r, 30000));

// Step 4
console.log("=== recaptcha response token (AFTER 30s) ===");
const tokenAfter = await call("evaluate", {
  expression: '(document.querySelector("#g-recaptcha-response")?.value || "").length',
});
console.log("Token length:", tokenAfter);

console.log("\n=== check_page_status (AFTER solving) ===");
const status = await call("check_page_status");
console.log(status);

const parsed = JSON.parse(status);
const solved = Number(tokenAfter) > 20;

if (solved && !parsed.has_challenge) {
  console.log("\n>>> SUCCESS: reCAPTCHA solved AND detection correctly shows no challenge!");
} else if (solved && parsed.has_challenge) {
  console.log("\n>>> BUG: reCAPTCHA solved (token length=" + tokenAfter + ") but still showing challenge");
} else {
  console.log("\n>>> reCAPTCHA not yet solved within 30s. Token length:", tokenAfter);
}

await client.close();
process.exit(0);
