/**
 * Simple test client for chrome-local-mcp.
 * Usage: node test-client.mjs [tool_name] [json_args]
 *
 * Examples:
 *   node test-client.mjs                         # just initialize + list tools
 *   node test-client.mjs navigate '{"url":"https://example.com"}'
 *   node test-client.mjs get_content '{}'
 *   node test-client.mjs search '{"query":"MCP protocol"}'
 *   node test-client.mjs tab_list '{}'
 *   node test-client.mjs check_page_status '{}'
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const toolName = process.argv[2];
const toolArgs = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const timeoutMs = Number(process.env.TEST_CLIENT_TIMEOUT_MS || 60000);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  stderr: "pipe",
});

transport.stderr?.on("data", (data) => {
  process.stderr.write(`[server] ${data}`);
});

const client = new Client({
  name: "test-client",
  version: "1.0.0",
});

const timeout = setTimeout(async () => {
  console.error(`\nTimeout - no response after ${Math.round(timeoutMs / 1000)}s`);
  await transport.close();
  process.exit(1);
}, timeoutMs);

try {
  await client.connect(transport);

  const result = toolName
    ? await client.callTool({ name: toolName, arguments: toolArgs })
    : await client.listTools();

  console.log(JSON.stringify(result, null, 2));
  clearTimeout(timeout);
  await transport.close();
} catch (error) {
  clearTimeout(timeout);
  await transport.close();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
