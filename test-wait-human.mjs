/**
 * Full test: wait_for_human with reCAPTCHA
 * Tests:
 * 1. Detect unsolved reCAPTCHA
 * 2. wait_for_human polls and returns within 45s
 * 3. If still waiting, auto-retry (simulates LLM calling again)
 * 4. Detect solved state after human completes
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

console.log("=== Step 1: Navigate to reCAPTCHA demo ===");
console.log(await call("navigate", { url: "https://www.google.com/recaptcha/api2/demo" }));

console.log("\n=== Step 2: check_page_status (before) ===");
console.log(await call("check_page_status"));

console.log("\n>>> Please solve the reCAPTCHA in Chrome!");
console.log(">>> wait_for_human will poll in 45s windows...\n");

// Retry loop — mimics how an LLM would re-call wait_for_human
const MAX_RETRIES = 4; // 4 × 45s = 180s total
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  console.log(`=== wait_for_human attempt ${attempt}/${MAX_RETRIES} ===`);

  const result = await call("wait_for_human", {
    reason: "reCAPTCHA on demo page",
    timeout: 45000,
    poll_interval: 3000,
  });

  const parsed = JSON.parse(result);
  console.log(result);

  if (parsed.status === "ready") {
    console.log("\n=== check_page_status (after solving) ===");
    console.log(await call("check_page_status"));
    console.log("\n>>> SUCCESS! Human intervention completed in " + (parsed.waited_ms / 1000).toFixed(1) + "s");
    await client.close();
    process.exit(0);
  }

  console.log(">>> Still waiting, will retry...\n");
}

console.log(">>> Gave up after " + MAX_RETRIES + " attempts.");
await client.close();
process.exit(1);
