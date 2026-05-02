#!/usr/bin/env node

import CDP from "chrome-remote-interface";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { challengeDetectionExpression } from "../dist/detect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));
const host = args.host || process.env.CHROME_HOST || "localhost";
const port = Number(args.port || process.env.CHROME_PORT || 9222);
const configPath = path.resolve(
  process.cwd(),
  args.config || path.join("scripts", "challenge-canaries.json")
);
const logPath = path.resolve(
  process.cwd(),
  args.log || path.join("logs", "challenge-regressions.jsonl")
);
const failOnIssue = args.failOnIssue === "true";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid Chrome CDP port: ${args.port || process.env.CHROME_PORT || port}`);
}

const canaries = JSON.parse(fs.readFileSync(configPath, "utf8"));
const client = await CDP({ host, port });

try {
  await Promise.all([
    client.Page.enable(),
    client.Runtime.enable(),
    client.Network.enable(),
  ]);

  const results = [];
  for (const canary of canaries) {
    results.push(await runCanary(client, canary));
  }

  for (const result of results) {
    console.log(JSON.stringify(result));
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const checkedAt = new Date().toISOString();
  fs.appendFileSync(
    logPath,
    results.map((result) => JSON.stringify(toLogEntry(result, checkedAt))).join("\n") + "\n",
    "utf8"
  );

  const failed = results.filter((result) => result.status !== "pass");
  if (failed.length > 0 && failOnIssue) {
    console.error(`challenge regression monitor found ${failed.length}/${results.length} issues`);
    process.exitCode = 1;
  } else {
    console.error(
      `challenge regression monitor logged ${results.length} canary checks to ${logPath}`
    );
  }
} finally {
  await client.close();
}

async function runCanary(client, canary) {
  await client.Page.navigate({ url: canary.url });
  await waitForPage(client, canary.load_timeout_ms || 15000);

  const page = await evaluateJson(
    client,
    'JSON.stringify({url: location.href, title: document.title})'
  );
  const challenge = await evaluateJson(client, challengeDetectionExpression());
  const content = await evaluateJson(client, contentProbeExpression(canary));

  const readable = content.text_length >= (canary.min_text_length || 1);
  const issues = [];

  if (
    canary.expected_has_challenge !== undefined &&
    challenge.has_challenge !== canary.expected_has_challenge
  ) {
    issues.push({
      type: "unexpected_challenge_status",
      expected: canary.expected_has_challenge,
      actual: challenge.has_challenge,
    });
  }

  if (canary.expected_readable !== undefined && readable !== canary.expected_readable) {
    issues.push({
      type: "unexpected_readability",
      expected: canary.expected_readable,
      actual: readable,
      text_length: content.text_length,
    });
  }

  if (challenge.has_challenge && readable) {
    issues.push({
      type: "false_blocking_candidate",
      challenges: challenge.challenges,
      text_length: content.text_length,
    });
  }

  return {
    name: canary.name,
    status: issues.length === 0 ? "pass" : "fail",
    url: page.url,
    title: page.title,
    has_challenge: challenge.has_challenge,
    challenges: challenge.challenges,
    readable,
    text_length: content.text_length,
    selector: canary.selector || "auto",
    issues,
  };
}

async function waitForPage(client, timeoutMs) {
  await Promise.race([
    client.Page.loadEventFired(),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function evaluateJson(client, expression) {
  const { result, exceptionDetails } = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  }

  if (typeof result.value !== "string") {
    throw new Error(`Expected JSON string from evaluation, got ${result.type}`);
  }

  return JSON.parse(result.value);
}

function contentProbeExpression(canary) {
  const selector = canary.selector || "";
  return `
    JSON.stringify((function() {
      var el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "null"}
        || document.querySelector('article')
        || document.querySelector('main')
        || document.querySelector('[role="main"]')
        || document.body;
      if (!el) return { text_length: 0 };
      var clone = el.cloneNode(true);
      clone.querySelectorAll('script, style, nav, header, footer, aside, .ad, .ads, .advertisement, [role="navigation"], [role="banner"], [role="contentinfo"]')
        .forEach(function(node) { node.remove(); });
      var text = (clone.innerText || clone.textContent || '').replace(/\\s+/g, ' ').trim();
      return { text_length: text.length };
    })())
  `;
}

function toLogEntry(result, checkedAt) {
  const triggered = result.issues.length > 0;
  return {
    event: "challenge_regression_check",
    checked_at: checkedAt,
    triggered,
    triggered_at: triggered ? checkedAt : null,
    webpage: {
      url: result.url,
      title: result.title,
    },
    canary: result.name,
    status: result.status,
    has_challenge: result.has_challenge,
    challenges: result.challenges,
    readable: result.readable,
    text_length: result.text_length,
    selector: result.selector,
    issues: result.issues,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      parsed[key] = argv[i + 1];
      i++;
    }
  }
  return parsed;
}

function printHelp() {
  const script = path.relative(process.cwd(), fileURLToPath(import.meta.url));
  console.log(`Usage: node ${script} [--host localhost] [--port 9222] [--config scripts/challenge-canaries.json] [--log logs/challenge-regressions.jsonl] [--fail-on-issue true]`);
}
