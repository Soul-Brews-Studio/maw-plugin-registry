import { spawn } from "child_process";
import { DEFAULT_TUNNEL_LOCAL_PORT, DEFAULT_TUNNEL_REMOTE_PORT, TUNNEL_PROCESS_NAME, type OpResult, type Options, type TunnelAction } from "./types";

export async function tunnel(action: TunnelAction, options: Options): Promise<OpResult> {
  if (action === "down") {
    await runPm2(["stop", TUNNEL_PROCESS_NAME], true);
    await runPm2(["delete", TUNNEL_PROCESS_NAME], true);
    const output = `tunnel stopped: ${TUNNEL_PROCESS_NAME}`;
    console.log(output);
    return { ok: true, output };
  }

  if (!options.remote) {
    const error = "tunnel up requires --remote <host>";
    console.error(error);
    return { ok: false, error };
  }

  const localPort = options.localPort ?? DEFAULT_TUNNEL_LOCAL_PORT;
  const remotePort = options.remotePort ?? DEFAULT_TUNNEL_REMOTE_PORT;
  const sshArgs = [
    "-N",
    "-L",
    `${localPort}:localhost:${remotePort}`,
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    options.remote,
  ];

  await runPm2(["delete", TUNNEL_PROCESS_NAME], true);
  await runPm2(["start", "ssh", "--name", TUNNEL_PROCESS_NAME, "--", ...sshArgs], false);
  const output = `tunnel up: localhost:${localPort} -> ${options.remote}:localhost:${remotePort} (${TUNNEL_PROCESS_NAME})`;
  console.log(output);
  return { ok: true, output };
}

function runPm2(args: string[], ignoreFailure: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pm2", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (e) => {
      if (ignoreFailure) resolve();
      else reject(e);
    });
    child.on("close", (code) => {
      if (code === 0 || ignoreFailure) resolve();
      else reject(new Error(`pm2 ${args.join(" ")} failed (${code}): ${output.trim()}`));
    });
  });
}
