# Chrome Local MCP — 设计文档

## 1. 项目背景与动机

### 1.1 问题场景

在 WSL 环境中使用 Claude Code / Codex 进行研究报告等需要浏览器交互的任务时，面临三个核心痛点：

| 痛点 | 现有方案的不足 |
|---|---|
| **WSL ↔ Windows Chrome 连接** | Chrome DevTools MCP 不原生支持 WSL，需要 socat/portproxy 等复杂桥接 |
| **Token 消耗过高** | Chrome DevTools MCP schema 开销 ~18,000 tokens，Playwright MCP ~13,700 tokens；每次交互返回完整 accessibility tree（单页面可达 124K tokens） |
| **人工验证无法介入** | CAPTCHA、Cloudflare 验证、登录墙等需要人工操作，现有 MCP 工具没有 human-in-the-loop 机制 |

### 1.2 设计目标

- Schema 开销控制在 **~1,000 tokens**（比现有方案降低 15-20 倍）
- 长内容存文件，**不污染 LLM 上下文窗口**
- 原生支持 **human-in-the-loop**（验证检测 + 等待机制）
- 直接通过 localhost 连接 Windows Chrome，**不需要额外网络桥接**（WSL 镜像网络模式）
- 工具集满足**研究报告**工作流：搜索 → 多标签浏览 → 内容提取 → 汇总

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────── WSL ────────────────────┐   ┌────────── Windows ──────────┐
│                                         │   │                             │
│  Claude Code / Codex                    │   │                             │
│    │ stdio                              │   │                             │
│    ▼                                    │   │                             │
│  chrome-local-mcp (Node.js)             │   │                             │
│    │                                    │   │                             │
│    │ CDP WebSocket                      │   │                             │
│    │ ws://localhost:9222                 │   │                             │
│    └────────────────────────────────────┼───▶  Chrome (--remote-debugging │
│                                         │   │          -port=9222)        │
│  /tmp/chrome-mcp/                       │   │                             │
│    ├── content-*.txt (提取的页面内容)    │   │  用户可随时在浏览器中       │
│    └── screenshot-*.png (截图文件)       │   │  手动操作（验证码等）       │
│                                         │   │                             │
└─────────────────────────────────────────┘   └─────────────────────────────┘
```

### 2.2 通信链路

1. **Claude Code → MCP Server**：stdio（标准 MCP 传输协议，零配置）
2. **MCP Server → Chrome**：CDP over WebSocket（`chrome-remote-interface` 库）
3. **MCP Server → 文件系统**：长内容和截图保存到 `/tmp/chrome-mcp/`

### 2.3 连接管理

- 单一持久 CDP 连接，避免每次 tool call 重新建连
- 自动健康检查（`Browser.getVersion()`），连接断开时自动重连
- 标签页切换时关闭旧连接，建立到新 target 的连接

## 3. 工具集设计

### 3.1 工具清单

共 15 个工具，分 6 类：

#### 导航类

| 工具 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `navigate` | `url: string` | `{status, title, url}` | 打开页面 |
| `wait_for` | `selector: string, timeout?: number` | `{found: bool}` | 等待元素出现 |
| `go_back` | — | `{title, url}` | 浏览器后退 |

#### 内容提取类

| 工具 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `get_content` | `selector?: string, max_length?: number` | 短文本直接返回；长文本 `{saved_to, preview}` | 智能提取页面正文 |
| `evaluate` | `expression: string` | JS 执行结果 | 自定义数据提取 |
| `screenshot` | `path?: string, full_page?: bool` | `{saved_to: filepath}` | 截图存文件 |

#### 交互类

| 工具 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `click` | `selector: string` | `"ok"` | 点击元素 |
| `fill` | `selector: string, value: string` | `"ok"` | 填写表单 |
| `press_key` | `key: string` | `"ok"` | 按键（Enter/Tab/Escape 等） |
| `scroll` | `direction: up\|down, amount?: number` | `{scrollY, scrollHeight, innerHeight}` | 页面滚动 |

#### 标签页管理类

| 工具 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `tab_list` | — | `[{id, title, url}]` | 列出所有标签页 |
| `tab_open` | `url: string` | `{id, title, url}` | 新标签页打开 |
| `tab_switch` | `id: string` | `{title, url}` | 切换标签页 |
| `tab_close` | `id?: string` | `"ok"` | 关闭标签页 |

#### 搜索类

| 工具 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `search` | `query: string, max_results?: number` | `{query, count, results: [{title, url, snippet}]}` | Google 搜索，自动检测 CAPTCHA |

#### 人工介入类

| 工具 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `wait_for_human` | `reason: string, wait_until_gone?: string, wait_until_present?: string, timeout?: number` | `{status, waited_ms}` | 等待人工完成验证 |
| `check_page_status` | — | `{has_challenge, challenges: [...]}` | 检测页面验证状态 |

### 3.2 Token 优化策略

#### 返回值最小化

所有工具的返回值都经过精心设计，只包含必要信息：

```
navigate → {"status":"ok","title":"Google","url":"https://google.com"}  (~60 tokens)
click    → "ok"                                                          (~1 token)
fill     → "ok"                                                          (~1 token)
```

对比 Playwright MCP 的 navigate 返回完整 accessibility tree（数千到数万 tokens）。

#### 长内容文件化

`get_content` 的核心策略：

```
页面文本 < 3000 字符 → 直接返回 JSON（含文本）
页面文本 >= 3000 字符 → 保存到 /tmp/chrome-mcp/content-{timestamp}.txt
                       → 返回 {saved_to: "/tmp/...", preview: "前500字..."}
```

LLM 拿到文件路径后，可以用 Claude Code 的 Read 工具按需读取，而不是全部塞进上下文。

#### Screenshot 永远存文件

截图不做 base64 编码返回（一张截图约 3000-5000 tokens），只返回文件路径。LLM 可以用 Read 工具查看图片。

### 3.3 人工介入设计

#### 验证检测

`check_page_status` 检测以下类型：

- **Cloudflare**：`#challenge-running`, `#challenge-form`, `.cf-browser-verification`, "Checking your browser", "Verify you are human"
- **reCAPTCHA**：`.g-recaptcha`, `iframe[src*="recaptcha"]`
- **hCaptcha**：`.h-captcha`, `iframe[src*="hcaptcha"]`
- **Google 同意页**：`form[action*="consent.google"]`
- **登录墙**：`[class*="login-wall"]`, `[class*="signin-wall"]`

#### 等待机制

`wait_for_human` 支持三种等待模式：

1. **元素消失**（`wait_until_gone`）：等待验证容器消失，如 `.cf-browser-verification`
2. **元素出现**（`wait_until_present`）：等待目标内容出现，如 `#search-results`
3. **页面变化**（默认）：检测 URL 或 title 变化，适用于不确定具体元素的情况

典型工作流：

```
Agent: search("某个关键词")
  → 返回 {"status": "human_verification_needed", ...}

Agent: wait_for_human(reason="Google CAPTCHA", wait_until_gone=".g-recaptcha", timeout=120000)
  → 用户在 Windows Chrome 中手动完成验证
  → 返回 {"status": "ready", "waited_ms": 15000}

Agent: search("某个关键词")  // 重试
  → 正常返回搜索结果
```

## 4. 研究报告工作流

### 4.1 典型使用流程

```
1. search("AI agent browser automation 2026")
   → 获取 10 条搜索结果

2. tab_open(results[0].url)    ─┐
   tab_open(results[1].url)     ├─ 并行打开多个来源
   tab_open(results[2].url)    ─┘

3. tab_switch(tab1_id)
   get_content()                → 短文本直接获取 / 长文本存文件
   tab_switch(tab2_id)
   get_content()
   ...

4. [遇到 Cloudflare 验证]
   check_page_status()          → {"has_challenge": true, "challenges": ["cloudflare"]}
   wait_for_human(reason="Cloudflare verification")
   → 用户手动完成
   get_content()                → 继续提取

5. LLM 综合所有提取内容，生成研究报告
```

### 4.2 Token 消耗估算

| 操作 | 本项目 | Chrome DevTools MCP | Playwright MCP |
|---|---|---|---|
| 工具 schema 加载 | ~1,000 | ~18,000 | ~13,700 |
| 搜索一次 | ~200 | ~500 (多步操作) | ~500 |
| 提取一个页面内容 | ~100 (路径) 或 ~1,500 (短文本) | ~5,000+ | ~50,000+ (accessibility tree) |
| 截图 | ~30 (路径) | ~4,000 (base64) | ~4,000 |
| **10 页面研究任务总计** | **~5,000** | **~70,000+** | **~500,000+** |

## 5. 配置与部署

### 5.1 Chrome 启动

```powershell
# Windows - 必须在无其他 Chrome 实例时启动
chrome.exe --remote-debugging-port=9222
```

### 5.2 MCP 注册

```bash
# 基本用法（WSL 共享网络，localhost 直通）
claude mcp add --scope user chrome-local -- node /path/to/dist/index.js

# 指定 host（WSL2 NAT 模式时需要 Windows IP）
claude mcp add --scope user chrome-local -- node /path/to/dist/index.js --host 172.x.x.1 --port 9222
```

### 5.3 CLI 参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--host` | `localhost` | Chrome CDP 地址 |
| `--port` | `9222` | Chrome CDP 端口 |

## 6. 技术栈

| 组件 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript | MCP SDK 生态最成熟 |
| MCP SDK | `@modelcontextprotocol/sdk` | 官方 SDK，API 稳定 |
| CDP 客户端 | `chrome-remote-interface` | 轻量、成熟、无额外依赖 |
| Schema 验证 | `zod` | MCP SDK 原生集成 |
| 传输 | stdio | Claude Code 默认方式，零配置 |

## 7. 与现有方案对比

| 维度 | chrome-local-mcp | Chrome DevTools MCP --slim | Playwright MCP | mcp-chrome |
|---|---|---|---|---|
| 工具数 | 15 | 3 | 21 | 20+ |
| Schema 开销 | ~1,000 tokens | ~2,000 tokens | ~13,700 tokens | 未知 |
| 交互返回开销 | 极低（文件化） | 中 | 高（accessibility tree） | 中 |
| WSL 原生支持 | 是（localhost 直连） | 需桥接 | 需桥接 | 需 Windows 侧 bridge |
| 人工介入 | 原生支持 | 不支持 | 不支持 | 不支持 |
| 多标签页 | 支持 | 不支持 | 有限 | 支持 |
| 搜索集成 | 高阶工具 | 无 | 无 | 无 |
| 内容提取 | 智能提取+文件化 | JS 执行 | accessibility tree | 语义搜索 |

## 8. 后续扩展方向

- **搜索引擎扩展**：支持 Bing、DuckDuckGo 等，减少 Google CAPTCHA 触发频率
- **Cookie/Session 导出**：将浏览器登录态导出供其他工具使用
- **页面监控**：定时检查页面变化，用于持续研究
- **WebMCP 集成**：当 Chrome 146 stable 发布后，支持 WebMCP 协议直接调用网站暴露的工具
