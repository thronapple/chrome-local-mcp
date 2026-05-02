# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

chrome-local-mcp is a lightweight MCP (Model Context Protocol) server that connects to a Windows Chrome instance via CDP (Chrome DevTools Protocol). Designed for WSL environments where Claude Code needs to control a real browser with human-in-the-loop support for CAPTCHAs and verification challenges.

## Build & Run

```bash
npm run build          # Compile TypeScript → dist/
npm run dev            # Watch mode
npm start              # Run the MCP server (requires Chrome with --remote-debugging-port=9222)
```

### Register with Claude Code

```bash
claude mcp add --scope user chrome-local -- node /mnt/d/repository/chrome-local-mcp/dist/index.js
```

### Register with Codex CLI

Edit `~/.codex/config.toml`:
```toml
[mcp_servers.chrome-local]
command = ["node", "/mnt/d/repository/chrome-local-mcp/dist/index.js"]
```

### Test

```bash
npm test                           # Quick tool listing test
curl http://localhost:9222/json/version  # Verify Chrome CDP is reachable
```

### Prerequisites

Windows Chrome must be running with remote debugging:
```powershell
chrome.exe --remote-debugging-port=9222
```

## Architecture

```
Claude Code (WSL) → stdio → MCP Server (WSL/Node.js) → CDP WebSocket → Chrome (Windows)
```

- **Transport**: stdio (MCP standard for CLI agents)
- **CDP connection**: `chrome-remote-interface` npm package, single persistent connection with auto-reconnect
- **Token strategy**: Long content saved to temp files (`/tmp/chrome-mcp/`), only summaries returned to LLM context

### Source Structure

- `src/index.ts` — Entry point, CLI arg parsing, server bootstrap
- `src/cdp.ts` — CDP connection management (connect, reconnect, target switching)
- `src/detect.ts` — Shared challenge auto-detection (Cloudflare, CAPTCHA, login walls, etc.)
- `src/tools/navigation.ts` — navigate, wait_for, go_back
- `src/tools/content.ts` — get_content (smart extraction), evaluate (JS exec), screenshot
- `src/tools/interaction.ts` — click, fill, press_key, scroll
- `src/tools/tabs.ts` — tab_list, tab_open, tab_switch, tab_close
- `src/tools/search.ts` — Google search with auto CAPTCHA detection
- `src/tools/human.ts` — wait_for_human, check_page_status
- `src/types/chrome-remote-interface.d.ts` — Type declarations for CDP client

### Key Design Decisions

1. **No accessibility tree / DOM snapshots in responses** — biggest token saver vs Playwright MCP / Chrome DevTools MCP
2. **get_content auto-saves long text to files** — threshold at 3000 chars, returns file path + preview
3. **Human-in-the-loop is a first-class tool** — `wait_for_human` polls for page changes, `check_page_status` detects Cloudflare/reCAPTCHA/hCaptcha
4. **Search is a high-level tool** — single call does navigate + fill + extract, not 4 separate tool calls
