import fs from "node:fs";
import net from "node:net";
import { loadConfig } from "./config";
import { OpenClawCore } from "./core";

function getFlag(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function printOutput(payload: unknown, asJson: boolean) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function callSocket(socketPath: string, action: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(action);
    });
    client.once("data", (buf) => {
      try {
        resolve(JSON.parse(buf.toString("utf8")));
      } catch (err) {
        reject(err);
      } finally {
        client.end();
      }
    });
    client.once("error", reject);
  });
}

async function main() {
  const action = process.argv[2];
  const configPath = getFlag("--config", "openclaw.config.yaml")!;
  const asJson = hasFlag("--json");
  const forceSteal = hasFlag("--force-lock-steal");
  const config = loadConfig(configPath);

  if (action === "daemon") {
    printOutput({ success: true, next: `tsx openclaw-sync-runtime/src/daemon.ts ${configPath}` }, asJson);
    return;
  }

  if (action === "status") {
    if (fs.existsSync(config.vault.socketPath)) {
      const status = await callSocket(config.vault.socketPath, "status");
      printOutput(status, asJson);
      return;
    }
    printOutput({ success: false, error: "daemon socket not found" }, asJson);
    return;
  }

  if (action === "sync_once") {
    if (fs.existsSync(config.vault.socketPath)) {
      const result = await callSocket(config.vault.socketPath, `sync_once ${forceSteal ? "--force-lock-steal" : ""}`);
      printOutput(result, asJson);
      return;
    }
    const core = new OpenClawCore(config);
    const result = await core.syncOnce("cli_sync_once", forceSteal);
    printOutput(result, asJson);
    return;
  }

  if (action === "flush_queue" || action === "reconcile") {
    if (!fs.existsSync(config.vault.socketPath)) {
      printOutput({ success: false, error: "daemon socket not found" }, asJson);
      return;
    }
    const result = await callSocket(config.vault.socketPath, `flush_queue ${forceSteal ? "--force-lock-steal" : ""}`);
    printOutput(result, asJson);
    return;
  }

  if (action === "acquire_lock" || action === "release_lock") {
    if (!fs.existsSync(config.vault.socketPath)) {
      printOutput({ success: false, error: "daemon socket not found" }, asJson);
      return;
    }
    const result = await callSocket(
      config.vault.socketPath,
      `${action} ${forceSteal && action === "acquire_lock" ? "--force-lock-steal" : ""}`
    );
    printOutput(result, asJson);
    return;
  }

  printOutput(
    {
      success: false,
      usage: [
        "rs-openclaw-cli sync_once --config openclaw.config.yaml --json",
        "rs-openclaw-cli acquire_lock --config openclaw.config.yaml --json",
        "rs-openclaw-cli release_lock --config openclaw.config.yaml --json",
        "rs-openclaw-cli status --config openclaw.config.yaml --json",
        "rs-openclaw-cli flush_queue --config openclaw.config.yaml --json",
        "tsx openclaw-sync-runtime/src/daemon.ts openclaw.config.yaml",
      ],
    },
    asJson
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
