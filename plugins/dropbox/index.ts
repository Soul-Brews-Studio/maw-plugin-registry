import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { ensureDeps, runSend, listPeers, showHelp } from "./impl";
import { dirname } from "path";
import { fileURLToPath } from "url";

export const command = {
  name: "dropbox",
  description: "P2P file sharing via WebRTC DataChannel",
};

const HERE = dirname(fileURLToPath(import.meta.url));

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const log = ctx.writer ?? console.log;
  const args = ctx.args as string[];
  const cmd = args[0];

  switch (cmd) {
    case "send":
    case "s": {
      await ensureDeps(HERE, log);
      runSend(HERE, args.slice(1));
      return { ok: true };
    }

    case "peers":
    case "p": {
      await ensureDeps(HERE, log);
      runSend(HERE, ["--list"]);
      return { ok: true };
    }

    case "list":
    case "ls": {
      await ensureDeps(HERE, log);
      const { listUploads } = await import("./impl");
      listUploads(log);
      return { ok: true };
    }

    case "index":
    case "i": {
      await ensureDeps(HERE, log);
      const { queryIndex } = await import("./impl");
      queryIndex(args.slice(1).join(" ") || undefined, log);
      return { ok: true };
    }

    case "version":
    case "v": {
      log("maw dropbox v1.0.0 (P2P WebRTC)");
      return { ok: true };
    }

    default:
      showHelp(log);
      return { ok: true };
  }
}
