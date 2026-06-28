# chrome-local-mcp

[English](README.md) | 简体中文

一个轻量级 MCP server，用于让运行在 WSL 中的 AI 编程代理（Claude Code、Codex、Cursor 等）通过 Chrome DevTools Protocol 控制 Windows 本机 Chrome。它重点解决低 token 开销、长页面内容文件化、以及验证码/登录验证场景下的人工介入。

### 为什么做这个？

在 WSL 环境里使用现有浏览器 MCP 工具时，常见问题有三个：

| 问题 | 本项目的处理方式 |
|---|---|
| 工具 schema 开销大，交互前可能消耗 13,700-18,000 tokens | 约 1,000 tokens 覆盖 17 个工具 |
| 页面内容或 accessibility tree 容易塞满上下文 | 长文本自动保存到文件，只返回摘要和文件路径 |
| CAPTCHA、Cloudflare、登录验证需要人工操作 | 内置验证检测和 `wait_for_human` 工具 |

### 前置条件

Windows Chrome 需要开启远程调试端口：

```powershell
chrome.exe --remote-debugging-port=9222
```

> 注意：如果直接用这条命令，通常需要先关闭所有已打开的 Chrome 窗口，否则调试端口可能不会生效。

更推荐使用项目里的启动脚本，它会创建独立 Chrome profile，不影响日常浏览器：

```powershell
.\scripts\start-chrome-debug.ps1
```

启动脚本支持三种模式：

```powershell
# 推荐模式：适合截图，减少后台/遮挡导致的渲染暂停。
.\scripts\start-chrome-debug.ps1 -Mode stable

# 普通可见窗口，使用独立 profile。
.\scripts\start-chrome-debug.ps1 -Mode interactive

# 无可见窗口。适合自动化，但不适合手动处理 CAPTCHA/登录。
.\scripts\start-chrome-debug.ps1 -Mode headless
```

Windows 上也可以使用 npm 快捷命令：

```powershell
npm run chrome:stable
npm run chrome:stable:wsl
npm run chrome:interactive
npm run chrome:headless
```

`stable` 模式会加入这些 Chrome 参数，降低后台节流和窗口遮挡对截图/渲染的影响：

```text
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
--disable-background-timer-throttling
--disable-features=CalculateNativeWinOcclusion
```

常用选项：

```powershell
.\scripts\start-chrome-debug.ps1 -Mode stable -Port 9333 -UserDataDir D:\tmp\chrome-mcp-profile
.\scripts\start-chrome-debug.ps1 -Mode stable -WindowWidth 1600 -WindowHeight 1000
.\scripts\start-chrome-debug.ps1 -Mode stable -ExtraArgs "--lang=en-US"
.\scripts\start-chrome-debug.ps1 -Mode stable -ReadyTimeoutSeconds 20
.\scripts\start-chrome-debug.ps1 -Mode stable -ReuseExisting
.\scripts\start-chrome-debug.ps1 -Mode stable -DryRun
```

默认情况下，如果目标调试端口已经被监听，脚本会拒绝再启动一个 Chrome。只有在你明确想复用当前 CDP endpoint 时，才使用 `-ReuseExisting`。

如果 MCP server 跑在 WSL 中，并且访问不到 Windows 的 `localhost:9222`，可以让 Chrome 监听可达地址，再让 MCP server 指向 Windows 宿主机 IP：

```powershell
.\scripts\start-chrome-debug.ps1 -Mode stable -RemoteDebuggingAddress 0.0.0.0
```

或使用快捷命令：

```powershell
npm run chrome:stable:wsl
```

然后启动 MCP server 时指定 Windows 宿主机 IP：

```bash
node dist/index.js --host <windows-host-ip> --port 9222
```

`0.0.0.0` 会让 Chrome DevTools 暴露到本机回环地址之外。只应在可信本机/局域网中使用，并建议用防火墙限制访问范围。

验证 CDP 是否可达：

```powershell
curl http://localhost:9222/json/version
```

### 安装

```bash
cd /path/to/chrome-local-mcp
npm install
npm run build
```

### 接入方式

#### Windows Codex CLI

```powershell
codex mcp add chrome-local -- node "D:\repository\chrome-local-mcp\dist\index.js"
codex mcp list
```

如果 Chrome 使用了非默认 host 或 port：

```powershell
codex mcp add chrome-local -- node "D:\repository\chrome-local-mcp\dist\index.js" --host localhost --port 9222
```

#### Windows Claude Code

```powershell
claude mcp add --scope user chrome-local -- node "D:\repository\chrome-local-mcp\dist\index.js"
claude mcp list
```

#### Claude Code

```bash
claude mcp add --scope user chrome-local -- node /path/to/chrome-local-mcp/dist/index.js
```

#### OpenAI Codex CLI

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.chrome-local]
command = ["node", "/path/to/chrome-local-mcp/dist/index.js"]
```

#### Cursor / VS Code

添加到 `.cursor/mcp.json` 或 VS Code MCP 配置：

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

#### 自定义 host/port

如果 WSL 和 Windows 不共享 localhost（例如 WSL2 NAT 模式），传入 Windows 宿主机 IP：

```bash
node dist/index.js --host 172.x.x.1 --port 9222
```

也可以通过环境变量配置默认值：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `CHROME_HOST` | Chrome DevTools Protocol host | `localhost` |
| `CHROME_PORT` | Chrome DevTools Protocol port | `9222` |
| `CHROME_MCP_TMPDIR` | 内容和截图的保存目录 | 系统临时目录 + `chrome-mcp` |
| `CHROME_MCP_CHALLENGE_LOG` | 正常 MCP 使用中检测到人工验证时的 JSONL 日志路径 | 仓库 `logs/challenge-events.jsonl` |
| `CHROME_MCP_CHALLENGE_LOG_DEDUPE_MS` | 同一 URL/验证类型日志去重窗口 | `60000` |
| `CHROME_MCP_DISABLE_CHALLENGE_LOG` | 设置为 `1` 时禁用验证日志 | 未设置 |

### 工具

#### 导航

| 工具 | 说明 |
|---|---|
| `navigate(url)` | 打开 URL，并自动检测验证挑战。 |
| `wait_for(selector, timeout?)` | 等待元素出现。 |
| `go_back()` | 浏览器后退。 |

#### 内容

| 工具 | 说明 |
|---|---|
| `get_content(selector?, max_length?)` | 提取页面文本。短文本直接返回，长文本保存到文件并返回预览。 |
| `evaluate(expression)` | 在页面上下文执行 JavaScript。长结果会保存到文件。 |
| `screenshot(path?, full_page?)` | 截图保存到文件，不把图片内容塞进上下文。 |

#### 交互

| 工具 | 说明 |
|---|---|
| `click(selector)` | 点击元素，点击后自动检测验证挑战。 |
| `fill(selector, value)` | 填写表单字段。 |
| `press_key(key)` | 按键，如 Enter、Tab、Escape。 |
| `scroll(direction, amount?)` | 页面向上或向下滚动。 |

#### 标签页

| 工具 | 说明 |
|---|---|
| `tab_list()` | 列出所有打开的标签页。 |
| `tab_open(url)` | 在新标签页打开 URL。 |
| `tab_switch(id)` | 按 ID 切换标签页。 |
| `tab_close(id?)` | 关闭指定标签页；不传 ID 时关闭当前标签页。 |

#### 搜索

| 工具 | 说明 |
|---|---|
| `search(query, max_results?)` | Google 搜索并返回结构化结果，自动检测 CAPTCHA。 |

#### 人工介入

| 工具 | 说明 |
|---|---|
| `wait_for_human(reason, wait_until_gone?, wait_until_present?, timeout?)` | 暂停等待人工操作，如 CAPTCHA、登录、验证。 |
| `check_page_status()` | 检测当前页面是否存在验证挑战。 |

### Human-in-the-loop

导航相关动作后会自动检测验证挑战。检测到时，工具返回类似：

```json
{
  "status": "human_verification_needed",
  "challenges": ["cloudflare", "turnstile"],
  "message": "Page has a verification challenge. Complete it in the browser, then call wait_for_human or retry."
}
```

当前检测类型包括：`cloudflare`、`recaptcha`、`hcaptcha`、`turnstile`、`google_sorry`、`google_consent`、`age_gate`。

订阅提示、付费预览条等不阻塞正文读取的访问提示，不应该返回 `human_verification_needed`。

正常 MCP 使用中检测到真实人工验证时，默认会追加 JSONL 日志到 `logs/challenge-events.jsonl`：

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

可以用 `CHROME_MCP_CHALLENGE_LOG` 改写日志位置。

#### 验证检测回归日志

可以对一组 canary 页面运行监控，记录检测是否过于激进：

```bash
npm run build
npm run monitor:challenges
```

监控结果写入 `logs/challenge-regressions.jsonl`。每条记录包含 `checked_at`、`triggered_at` 和页面 URL/title。默认只记录日志；如果希望发现问题时返回非零退出码，使用 `-- --fail-on-issue true`。

#### 典型流程

```text
Agent:  navigate("https://protected-site.com")
        -> {"status": "human_verification_needed", "challenges": ["cloudflare"]}

Agent:  wait_for_human(reason="Cloudflare verification", wait_until_gone="#challenge-running")
        -> 用户在 Chrome 中完成验证
        -> {"status": "ready", "waited_ms": 8000}

Agent:  get_content()
        -> 正常提取页面内容
```

### Token 效率

| 指标 | chrome-local-mcp | Chrome DevTools MCP | Playwright MCP |
|---|---|---|---|
| Schema 开销 | ~1,000 tokens | ~18,000 tokens | ~13,700 tokens |
| navigate 返回 | ~60 tokens | 视情况而定 | ~3,800+ tokens（accessibility tree） |
| screenshot | ~30 tokens（文件路径） | ~4,000 tokens（base64） | ~4,000 tokens |
| 10 页面研究任务 | ~5,000 tokens | ~70,000+ tokens | ~500,000+ tokens |

这些数字是用于说明量级差异的估算值，实际消耗会随客户端、工具 schema 版本、页面复杂度和任务流程变化。

### 架构

```text
Claude Code / Codex (WSL)
  ↓ stdio
chrome-local-mcp (Node.js, WSL)
  ↓ CDP WebSocket (ws://localhost:9222)
Chrome (Windows, with --remote-debugging-port=9222)
```

- 传输协议：stdio（MCP 标准传输）
- CDP 客户端：`chrome-remote-interface`
- 长内容保存到 `/tmp/chrome-mcp/`，agent 按需读取文件

### 开发

```bash
npm run build    # 编译 TypeScript
npm run dev      # watch 模式
npm run test     # 运行测试套件
```

### License

MIT

