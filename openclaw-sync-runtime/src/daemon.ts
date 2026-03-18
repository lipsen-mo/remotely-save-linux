import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { OpenClawCore } from "./core";
import { loadConfig } from "./config";
import { LockPayload } from "./types";

function watchRecursively(rootDir: string, onEvent: (relative: string) => void): fs.FSWatcher[] {
  const watchers: fs.FSWatcher[] = [];

  const attach = (dir: string) => {
    const watcher = fs.watch(dir, { persistent: true }, (_eventType, fileName) => {
      if (!fileName) return;
      onEvent(path.relative(rootDir, path.join(dir, fileName.toString())));
    });
    watchers.push(watcher);

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        attach(path.join(dir, entry.name));
      }
    }
  };

  attach(rootDir);
  return watchers;
}

async function main() {
  const configPath = process.argv[2] ?? "openclaw.config.yaml";
  const config = loadConfig(configPath);
  const core = new OpenClawCore(config);
  const lockManager = core.getLockManager();
  let guardedLease: LockPayload | undefined;
  const queue = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  const logPath = path.join(config.vault.stateDir, "daemon.log");
  const log = (msg: string) => {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  };

  const watchers = watchRecursively(config.vault.rootDir, (relativePath) => {
    queue.add(relativePath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const changed = Array.from(queue.values());
      queue.clear();
      try {
        const result = await core.syncOnce("watch_event", false, changed);
        log(
          `sync_once ok changed=${changed.length} uploaded=${result.uploaded_files} deleted=${result.deleted_files} lock=${result.lock_status}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`sync_once failed changed=${changed.length} error=${message}`);
      }
    }, config.vault.debounceMs);
  });

  if (fs.existsSync(config.vault.socketPath)) {
    fs.unlinkSync(config.vault.socketPath);
  }

  const server = net.createServer((socket) => {
    socket.on("data", async (buf) => {
      const input = buf.toString("utf8").trim();
      const [action, ...args] = input.split(" ");
      const forceSteal = args.includes("--force-lock-steal");
      try {
        if (action === "status") {
          socket.write(
            JSON.stringify({
              success: true,
              queued_files: queue.size,
              guarded_lock_holder: guardedLease?.holder_id,
            }) + "\n"
          );
        } else if (action === "sync_once") {
          const result = await core.syncOnce("socket_sync_once", forceSteal);
          socket.write(`${JSON.stringify(result)}\n`);
        } else if (action === "flush_queue") {
          const result = await core.syncOnce("socket_flush_queue", forceSteal);
          socket.write(`${JSON.stringify(result)}\n`);
        } else if (action === "acquire_lock") {
          const acquired = await lockManager.acquire("guarded_write", forceSteal);
          if (acquired.ok && acquired.payload) {
            guardedLease = acquired.payload;
          }
          socket.write(`${JSON.stringify(acquired)}\n`);
        } else if (action === "release_lock") {
          await lockManager.release(guardedLease);
          guardedLease = undefined;
          socket.write(`${JSON.stringify({ success: true, status: "released" })}\n`);
        } else {
          socket.write(JSON.stringify({ success: false, error: `unknown action: ${input}` }) + "\n");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        socket.write(JSON.stringify({ success: false, error: message }) + "\n");
      }
    });
  });

  server.listen(config.vault.socketPath, () => {
    log(`daemon started socket=${config.vault.socketPath}`);
  });

  const shutdown = async () => {
    for (const watcher of watchers) watcher.close();
    await lockManager.release(guardedLease);
    server.close();
    if (fs.existsSync(config.vault.socketPath)) {
      fs.unlinkSync(config.vault.socketPath);
    }
    log("daemon stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
