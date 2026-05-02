import CDP, { Client } from "chrome-remote-interface";

export type { Client };

export interface CDPOptions {
  host: string;
  port: number;
}

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  type: string;
}

let client: Client | null = null;
let currentTargetId: string | null = null;
let cdpOptions: CDPOptions = { host: "localhost", port: 9222 };

export function configure(opts: Partial<CDPOptions>) {
  if (opts.host) cdpOptions.host = opts.host;
  if (opts.port) cdpOptions.port = opts.port;
}

export async function getClient(): Promise<Client> {
  if (client) {
    try {
      // Test if connection is alive
      await client.Browser.getVersion();
      return client;
    } catch {
      client = null;
    }
  }

  client = await CDP({
    host: cdpOptions.host,
    port: cdpOptions.port,
  });
  currentTargetId = await readAttachedTargetId(client);

  await Promise.all([
    client.Page.enable(),
    client.Runtime.enable(),
    client.Network.enable(),
    client.DOM.enable(),
  ]);

  return client;
}

export async function getTargets(): Promise<TabInfo[]> {
  const targets = await CDP.List({
    host: cdpOptions.host,
    port: cdpOptions.port,
  });

  return targets
    .filter((t: any) => t.type === "page")
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      type: t.type,
    }));
}

export async function connectToTarget(targetId: string): Promise<Client> {
  if (client) {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }

  client = await CDP({
    host: cdpOptions.host,
    port: cdpOptions.port,
    target: targetId,
  });
  currentTargetId = targetId;

  await Promise.all([
    client.Page.enable(),
    client.Runtime.enable(),
    client.Network.enable(),
    client.DOM.enable(),
  ]);

  return client;
}

export async function getCurrentTargetId(): Promise<string> {
  const activeClient = await getClient();
  if (currentTargetId) {
    return currentTargetId;
  }
  currentTargetId = await readAttachedTargetId(activeClient);
  if (currentTargetId) {
    return currentTargetId;
  }
  throw new Error("Unable to determine current Chrome target ID.");
}

async function readAttachedTargetId(activeClient: Client): Promise<string | null> {
  if (typeof activeClient.target === "string" && activeClient.target) {
    return activeClient.target;
  }

  try {
    const info = await activeClient.Target.getTargetInfo({});
    return info.targetInfo?.targetId || null;
  } catch {
    return null;
  }
}

export async function disconnect() {
  if (client) {
    try {
      await client.close();
    } catch {
      // ignore
    }
    client = null;
    currentTargetId = null;
  }
}
