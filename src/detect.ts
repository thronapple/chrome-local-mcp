import { getClient } from "./cdp.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface PageStatus {
  has_challenge: boolean;
  challenges: string[];
  url?: string;
  title?: string;
}

const challengeLogDedupe = new Map<string, number>();
const DEFAULT_LOG_DEDUPE_MS = 60_000;

export function challengeDetectionExpression(): string {
  return `
        (function() {
          var body = document.body ? (document.body.innerText || '') : '';

          // --- Cloudflare / Turnstile: elements disappear after solving ---
          var cloudflare = !!document.querySelector('#challenge-running, #challenge-form, .cf-browser-verification, #cf-challenge-running')
            || (body.indexOf('Checking your browser') !== -1)
            || (body.indexOf('Verify you are human') !== -1)
            || (body.indexOf('Just a moment') !== -1 && !!document.querySelector('#challenge-stage'));

          var turnstile = !!document.querySelector('.cf-turnstile iframe[src*="challenges.cloudflare.com"]');

          // --- reCAPTCHA: element stays, check if response token is filled ---
          var recaptchaPresent = !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]');
          var recaptchaSolved = false;
          if (recaptchaPresent) {
            // Check all possible response textareas
            var responses = document.querySelectorAll('#g-recaptcha-response, [name="g-recaptcha-response"], textarea.g-recaptcha-response');
            for (var i = 0; i < responses.length; i++) {
              if (responses[i].value && responses[i].value.length > 20) {
                recaptchaSolved = true;
                break;
              }
            }
          }
          var recaptcha = recaptchaPresent && !recaptchaSolved;

          // --- hCaptcha: element stays, check if response token is filled ---
          var hcaptchaPresent = !!document.querySelector('.h-captcha, iframe[src*="hcaptcha"]');
          var hcaptchaSolved = false;
          if (hcaptchaPresent) {
            var hResponses = document.querySelectorAll('[name="h-captcha-response"], textarea[name="h-captcha-response"]');
            for (var j = 0; j < hResponses.length; j++) {
              if (hResponses[j].value && hResponses[j].value.length > 20) {
                hcaptchaSolved = true;
                break;
              }
            }
          }
          var hcaptcha = hcaptchaPresent && !hcaptchaSolved;

          // --- Google "unusual traffic" page ---
          var google_sorry = body.indexOf('unusual traffic') !== -1 || body.indexOf('not a robot') !== -1;

          // --- Google consent ---
          var google_consent = !!document.querySelector('form[action*="consent.google"]');

          // --- Age gates ---
          var age_gate = !!document.querySelector('[class*="age-gate"], [class*="age-verify"], [id*="age-gate"]');

          var checks = {
            cloudflare: cloudflare,
            turnstile: turnstile,
            recaptcha: recaptcha,
            hcaptcha: hcaptcha,
            google_sorry: google_sorry,
            google_consent: google_consent,
            age_gate: age_gate,
          };

          var detected = [];
          for (var k in checks) {
            if (checks[k]) detected.push(k);
          }

          return JSON.stringify({
            has_challenge: detected.length > 0,
            challenges: detected,
            url: location.href,
            title: document.title
          });
        })()
      `;
}

/**
 * Detect if the current page has an UNSOLVED verification challenge.
 * Key distinction: "element exists" != "challenge is active".
 * reCAPTCHA/hCaptcha elements stay in the DOM after solving — we check their response fields.
 */
export async function detectChallenge(): Promise<PageStatus | null> {
  try {
    const client = await getClient();
    const { result } = await client.Runtime.evaluate({
      expression: challengeDetectionExpression(),
    });

    if (typeof result.value === "string") {
      const status = JSON.parse(result.value) as PageStatus;
      logChallengeDetection(status);
      return status;
    }
    return null;
  } catch {
    return null;
  }
}

function logChallengeDetection(status: PageStatus) {
  if (!status.has_challenge || process.env.CHROME_MCP_DISABLE_CHALLENGE_LOG === "1") {
    return;
  }

  try {
    const now = Date.now();
    const dedupeMs = process.env.CHROME_MCP_CHALLENGE_LOG_DEDUPE_MS
      ? Number(process.env.CHROME_MCP_CHALLENGE_LOG_DEDUPE_MS)
      : DEFAULT_LOG_DEDUPE_MS;
    const challenges = status.challenges.join(",");
    const key = `${status.url || ""}|${challenges}`;
    const previous = challengeLogDedupe.get(key);

    if (previous && Number.isFinite(dedupeMs) && now - previous < dedupeMs) {
      return;
    }
    challengeLogDedupe.set(key, now);

    const triggeredAt = new Date(now).toISOString();
    const logPath = getChallengeLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      JSON.stringify({
        event: "human_verification_detected",
        triggered: true,
        triggered_at: triggeredAt,
        webpage: {
          url: status.url || "",
          title: status.title || "",
        },
        has_challenge: status.has_challenge,
        challenges: status.challenges,
      }) + "\n",
      "utf8"
    );
  } catch {
    // Logging must never change browser tool behavior.
  }
}

function getChallengeLogPath() {
  if (process.env.CHROME_MCP_CHALLENGE_LOG) {
    return process.env.CHROME_MCP_CHALLENGE_LOG;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "..", "logs", "challenge-events.jsonl");
}

/**
 * Build a warning message to append to tool results when a challenge is detected.
 */
export function challengeWarning(status: PageStatus): string {
  const types = status.challenges.join(", ");
  return `\n[WARNING] Page verification detected: ${types}. Use wait_for_human to pause while you complete it in the browser, or check_page_status for details.`;
}
