#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configure } from "./cdp.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerContentTools } from "./tools/content.js";
import { registerInteractionTools } from "./tools/interaction.js";
import { registerTabTools } from "./tools/tabs.js";
import { registerSearchTools } from "./tools/search.js";
import { registerHumanTools } from "./tools/human.js";

// Parse CLI arguments
const args = process.argv.slice(2);
let host = process.env.CHROME_HOST || "localhost";
let port = process.env.CHROME_PORT ? parseInt(process.env.CHROME_PORT, 10) : 9222;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--host" && args[i + 1]) {
    host = args[++i];
  } else if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[++i], 10);
  }
}

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid Chrome CDP port: ${process.env.CHROME_PORT || port}`);
}

configure({ host, port });

const server = new McpServer({
  name: "chrome-local-mcp",
  version: "1.0.0",
});

// Register all tools
registerNavigationTools(server);
registerContentTools(server);
registerInteractionTools(server);
registerTabTools(server);
registerSearchTools(server);
registerHumanTools(server);

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(
  `chrome-local-mcp connected to Chrome at ${host}:${port}\n`
);
