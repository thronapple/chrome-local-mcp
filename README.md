# chrome-local-mcp

[简体中文](README.zh-CN.md) | English

Lightweight MCP server for controlling a Windows Chrome instance from WSL. Designed for AI coding agents (Claude Code, Codex, Cursor) that need browser interaction with minimal token overhead and human-in-the-loop support.

## Why?

Existing browser MCP tools (Chrome DevTools MCP, Playwright MCP) have three problems in WSL environments:

| Problem | This project's solution |
|---|---|
| Schema overhead: 13,700-18,000 tokens before any interaction | ~1,000 tokens for 17 tools |
| Long page content floods LLM context (accessibility tree up to 124K tokens) | Long content auto-saved to file, only summary returned |
| No human intervention mechanism for CAPTCHAs/verification | Built-in auto-detection + `wait_for_human` tool |

## Prerequisites

Windows Chrome running with remote debugging enabled:

```powershell
chrome.exe --remote-debugging-port=9222
```

> **Important**: Close all existing Chrome windows before running this command, otherwise the debug port won't open.

Or start an isolated Chrome profile without closing your normal browser:

```powershell
.\scripts\start-chrome-debug.ps1
```

The startup script supports multiple modes:

```powershell
# Recommended for screenshots: keeps rendering active when Chrome is covered/backgrounded.
.\scripts\start-chrome-debug.ps1 -Mode stable

# Plain visible Chrome with an isolated profile.
.\scripts\start-chrome-debug.ps1 -Mode interactive

# No visible Chrome window. Best for automation, but weaker for manual CAPTCHA/login flows.
.\scripts\start-chrome-debug.ps1 -Mode headless
```

Equivalent npm shortcuts are available on Windows:

```powershell
npm run chrome:stable
npm run chrome:stable:wsl
npm run chrome:interactive
npm run chrome:headless
```

`stable` adds Chrome flags that reduce background throttling and native occlusion issues:

```text
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
--disable-background-timer-throttling
--disable-features=CalculateNativeWinOcclusion
```

Useful options:

```powershell
.\scripts\start-chrome-debug.ps1 -Mode stable -Port 9333 -UserDataDir D:\tmp\chrome-mcp-profile
.\scripts\start-chrome-debug.ps1 -Mode stable -WindowWidth 1600 -WindowHeight 1000
.\scripts\start-chrome-debug.ps1 -Mode stable -ExtraArgs "--lang=en-US"
.\scripts\start-chrome-debug.ps1 -Mode stable -ReadyTimeoutSeconds 20
.\scripts\start-chrome-debug.ps1 -Mode stable -ReuseExisting
.\scripts\start-chrome-debug.ps1 -Mode stable -DryRun
```

By default, the script refuses to launch a second Chrome when the requested debug port is already listening. Use `-ReuseExisting` only when you intentionally want to attach to the currently running Chrome CDP endpoint.

If the MCP server runs in WSL and cannot reach Windows `localhost:9222`, bind Chrome to a reachable address and point the MCP server at the Windows host IP:

```powershell
.\scripts\start-chrome-debug.ps1 -Mode stable -RemoteDebuggingAddress 0.0.0.0
```

Or use the npm shortcut:

```powershell
npm run chrome:stable:wsl
```

Then start the MCP server with the Windows host IP instead of `localhost`:

```bash
node dist/index.js --host <windows-host-ip> --port 9222
```

`0.0.0.0` exposes Chrome DevTools beyond local loopback. Use it only on a trusted local machine/network and prefer firewall rules that restrict access.

Verify Chrome DevTools Protocol is reachable:

```powershell
curl http://localhost:9222/json/version
```

## Install

```bash
cd /path/to/chrome-local-mcp
npm install
npm run build
```

## Setup

### Windows Codex CLI

```powershell
codex mcp add chrome-local -- node "D:\repository\chrome-local-mcp\dist\index.js"
codex mcp list
```

If Chrome uses a non-default host or port:

```powershell
codex mcp add chrome-local -- node "D:\repository\chrome-local-mcp\dist\index.js" --host localhost --port 9222
```

### Windows Claude Code

```powershell
claude mcp add --scope user chrome-local -- node "D:\repository\chrome-local-mcp\dist\index.js"
claude mcp list
```

### Claude Code

```bash
claude mcp add --scope user chrome-local -- node /path/to/chrome-local-mcp/dist/index.js
```

### OpenAI Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.chrome-local]
command = ["node", "/path/to/chrome-local-mcp/dist/index.js"]
```

### Cursor / VS Code

Add to `.cursor/mcp.json` or VS Code MCP settings:

```json
{
  "mcpServers": {
    "chrome-local": {
      "command": "node",
      "args": ["/path/to/chrome-local-mcp/dist/index.js"]
    }
  }
}
```

### Custom host/port

If WSL and Windows don't share localhost (WSL2 NAT mode), pass the Windows host IP:

```bash
node dist/index.js --host 172.x.x.1 --port 9222
```

You can also configure defaults with environment variables:

| Variable | Description | Default |
|---|---|---|
| `CHROME_HOST` | Chrome DevTools Protocol host | `localhost` |
| `CHROME_PORT` | Chrome DevTools Protocol port | `9222` |
| `CHROME_MCP_TMPDIR` | Directory for saved content and screenshots | OS temp directory + `chrome-mcp` |
| `CHROME_MCP_CHALLENGE_LOG` | JSONL log path for human verification events detected during normal MCP use | repo `logs/challenge-events.jsonl` |
| `CHROME_MCP_CHALLENGE_LOG_DEDUPE_MS` | Dedupe window for the same URL/challenge log event | `60000` |
| `CHROME_MCP_DISABLE_CHALLENGE_LOG` | Set to `1` to disable challenge event logging | unset |

## Tools

### Navigation

| Tool | Description |
|---|---|
| `navigate(url)` | Open a URL. Auto-detects verification challenges. |
| `wait_for(selector, timeout?)` | Wait for an element to appear. |
| `go_back()` | Browser back button. |

### Content

| Tool | Description |
|---|---|
| `get_content(selector?, max_length?)` | Extract page text. Short text returned directly; long text saved to file with preview. |
| `evaluate(expression)` | Execute JavaScript in page context. Long results are saved to file with preview. |
| `screenshot(path?, full_page?)` | Save screenshot to file (never inlined into context). |

### Interaction

| Tool | Description |
|---|---|
| `click(selector)` | Click an element. Auto-detects verification after click. |
| `fill(selector, value)` | Type into a form field. |
| `press_key(key)` | Press a key (Enter, Tab, Escape, etc.). |
| `scroll(direction, amount?)` | Scroll up or down. |

### Tabs

| Tool | Description |
|---|---|
| `tab_list()` | List all open tabs. |
| `tab_open(url)` | Open URL in a new tab. |
| `tab_switch(id)` | Switch to a tab by ID. |
| `tab_close(id?)` | Close a tab. |

### Search

| Tool | Description |
|---|---|
| `search(query, max_results?)` | Google search with structured results. Auto-detects CAPTCHAs. |

### Human Intervention

| Tool | Description |
|---|---|
| `wait_for_human(reason, wait_until_gone?, wait_until_present?, timeout?)` | Pause for human action (CAPTCHA, login, etc.). Polls until condition is met. |
| `check_page_status()` | Detect verification challenges on current page. |

## Human-in-the-loop

Verification challenges are **auto-detected** after every navigation-related action. When detected, the tool response includes:

```json
{
  "status": "human_verification_needed",
  "challenges": ["cloudflare", "turnstile"],
  "message": "Page has a verification challenge. Complete it in the browser, then call wait_for_human or retry."
}
```

Detected challenge types: `cloudflare`, `recaptcha`, `hcaptcha`, `turnstile`, `google_sorry`, `google_consent`, `age_gate`.

Access prompts that do not block readable content, such as article subscription prompts or paid preview banners, should not return `human_verification_needed`.

When normal MCP usage detects a real human verification challenge, it appends a JSONL event to `logs/challenge-events.jsonl` by default:

```json
{
  "event": "human_verification_detected",
  "triggered": true,
  "triggered_at": "2026-05-02T02:10:00.000Z",
  "webpage": {
    "url": "https://example.com/",
    "title": "Example"
  },
  "has_challenge": true,
  "challenges": ["cloudflare"]
}
```

Use `CHROME_MCP_CHALLENGE_LOG` to write this log somewhere else.

### Challenge regression log

Run the canary monitor against a Chrome instance to record pages where challenge detection may be too aggressive:

```bash
npm run build
npm run monitor:challenges
```

The monitor writes JSONL entries to `logs/challenge-regressions.jsonl`. Each entry includes `checked_at`, `triggered_at`, and the `webpage` URL/title. By default it only logs; use `-- --fail-on-issue true` if you want issues to make the command exit non-zero.

### Typical flow

```
Agent:  navigate("https://protected-site.com")
        → {"status": "human_verification_needed", "challenges": ["cloudflare"]}

Agent:  wait_for_human(reason="Cloudflare verification", wait_until_gone="#challenge-running")
        → User completes verification in Chrome
        → {"status": "ready", "waited_ms": 8000}

Agent:  get_content()
        → Page content extracted normally
```

## Token efficiency

| Metric | chrome-local-mcp | Chrome DevTools MCP | Playwright MCP |
|---|---|---|---|
| Schema overhead | ~1,000 tokens | ~18,000 tokens | ~13,700 tokens |
| navigate response | ~60 tokens | varies | ~3,800+ tokens (accessibility tree) |
| screenshot | ~30 tokens (file path) | ~4,000 tokens (base64) | ~4,000 tokens |
| 10-page research task | ~5,000 tokens | ~70,000+ tokens | ~500,000+ tokens |

## Architecture

```
Claude Code / Codex (WSL)
  ↓ stdio
chrome-local-mcp (Node.js, WSL)
  ↓ CDP WebSocket (ws://localhost:9222)
Chrome (Windows, with --remote-debugging-port=9222)
```

- Transport: stdio (MCP standard)
- CDP client: `chrome-remote-interface`
- Long content saved to `/tmp/chrome-mcp/` — agent reads files on demand

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
npm run test     # Run test suite
```

## License

ISC
