import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));

type DaemonEntry = {
  proc: ChildProcess;
  lanPort: number;
  uiWsPort: number;
  configPath: string;
};

const daemons = new Map<string, DaemonEntry>();

function repoRootFromDesktop(): string {
  return path.resolve(desktopDir, "../..");
}

function cargoBin(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const candidate = path.join(home, ".cargo", "bin", "cargo.exe");
  if (fs.existsSync(candidate)) return candidate;
  const unix = path.join(home, ".cargo", "bin", "cargo");
  if (fs.existsSync(unix)) return unix;
  return "cargo";
}

function spawnDaemon(configPath: string, repoRoot: string): ChildProcess {
  const cargo = cargoBin();
  return spawn(cargo, ["run", "-q", "-p", "lockal-daemon", "--", "--config", configPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

export function lockalDevDaemonPlugin(): Plugin {
  const repoRoot = repoRootFromDesktop();
  const daemonDir = path.join(repoRoot, ".lockal", "daemons");

  return {
    name: "lockal-dev-daemon",
    configureServer(server) {
      server.middlewares.use("/__lockal/daemon/start", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const config = JSON.parse(body) as Record<string, unknown>;
            const deviceId = String(config.device_id ?? "");
            if (!deviceId) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "device_id required" }));
              return;
            }

            let entry = daemons.get(deviceId);
            if (entry) {
              config.lan_port = entry.lanPort;
              config.ui_ws_port = entry.uiWsPort;
              fs.writeFileSync(entry.configPath, JSON.stringify(config, null, 2));
            } else {
              fs.mkdirSync(daemonDir, { recursive: true });
              const lanPort = 39200 + daemons.size * 10;
              const uiWsPort = lanPort + 1;
              config.lan_port = lanPort;
              config.ui_ws_port = uiWsPort;
              const configPath = path.join(daemonDir, `${deviceId}.json`);
              fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

              const proc = spawnDaemon(configPath, repoRoot);
              proc.stdout?.on("data", (d) => process.stdout.write(`[daemon:${deviceId.slice(0, 8)}] ${d}`));
              proc.stderr?.on("data", (d) => process.stderr.write(`[daemon:${deviceId.slice(0, 8)}] ${d}`));
              proc.on("exit", () => {
                daemons.delete(deviceId);
              });

              entry = { proc, lanPort, uiWsPort, configPath };
              daemons.set(deviceId, entry);
              console.log(
                `[lockal] Started daemon for ${deviceId.slice(0, 12)}… LAN ${lanPort}, UI ws ${uiWsPort}`,
              );
            }

            entry = daemons.get(deviceId)!;

            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: true,
                lanPort: entry.lanPort,
                uiWsPort: entry.uiWsPort,
                wsUrl: `ws://127.0.0.1:${entry.uiWsPort}`,
              }),
            );
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          }
        });
      });

      server.httpServer?.once("close", () => {
        for (const [id, entry] of daemons) {
          entry.proc.kill();
          daemons.delete(id);
        }
      });
    },
  };
}
