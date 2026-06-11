#!/usr/bin/env bun
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, RTCDataChannel } from "werift";
import { readFileSync, statSync } from "fs";
import { basename } from "path";
import { generatePeerName, type SignalingPeer } from "./types";

const SIGNAL_URL = process.env.SIGNAL_URL || "wss://phd-signaling.laris.workers.dev/ws";
const AUTH_KEY = process.env.AUTH_KEY || "";
const PEER_NAME = process.env.PEER_NAME || generatePeerName("cli");
const CHUNK_SIZE = 64 * 1024;

const rawArgs = process.argv.slice(2);

let targetName = "";
const filePaths: string[] = [];
let listPeers = false;

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--to" || rawArgs[i] === "-t") {
    targetName = rawArgs[++i] || "";
  } else if (rawArgs[i] === "--list" || rawArgs[i] === "-l") {
    listPeers = true;
  } else if (rawArgs[i] === "--help" || rawArgs[i] === "-h") {
    console.log(`
  PhD Dropbox — CLI P2P Sender (WebRTC)

  Usage:
    bun run send.ts <file> [file2...]              Send to m5-receiver (default)
    bun run send.ts --to <peer-name> <file>        Send to specific peer
    bun run send.ts --list                         List online peers

  Env:
    AUTH_KEY=phd-xxx          Signaling auth key (required)
    PEER_NAME=my-oracle       Your peer name (default: cli-HHMM-hash)

  Examples:
    maw dropbox send file.txt                      Send to m5-receiver
    maw dropbox send --to chaiklang-recv file.txt   Send to chaiklang
    maw dropbox send --list                        Show who's online
`);
    process.exit(0);
  } else if (!rawArgs[i].startsWith("-")) {
    filePaths.push(rawArgs[i]);
  }
}

if (!listPeers && filePaths.length === 0) {
  console.error("No files specified. Use --help for usage.");
  process.exit(1);
}

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

let ws: WebSocket;
let myId = "";
let receiverId = "";
let pc: RTCPeerConnection | null = null;
let dc: RTCDataChannel | null = null;
let connected = false;

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function matchTarget(peer: SignalingPeer): boolean {
  if (targetName) return peer.name.includes(targetName);
  return peer.name.includes("receiver") || peer.name.includes("m5");
}

async function sendFile(path: string): Promise<boolean> {
  if (!dc) return false;
  const name = basename(path);
  const data = readFileSync(path);
  const size = data.byteLength;

  log(`Sending: ${name} (${formatSize(size)})`);

  const fileId = Math.random().toString(36).slice(2, 10);
  dc.send(JSON.stringify({ type: "file-start", id: fileId, name, size }));

  let offset = 0;
  while (offset < size) {
    const end = Math.min(offset + CHUNK_SIZE, size);
    const chunk = data.subarray(offset, end);

    while (dc.bufferedAmount > 1024 * 1024) {
      await new Promise(r => setTimeout(r, 10));
    }

    dc.send(chunk);
    offset = end;
    const pct = ((offset / size) * 100).toFixed(0);
    process.stdout.write(`\r  ${pct}% (${formatSize(offset)} / ${formatSize(size)})`);
  }

  dc.send(JSON.stringify({ type: "file-end", id: fileId }));
  process.stdout.write("\n");
  log(`Sent: ${name}`);
  return true;
}

async function run() {
  if (!listPeers) {
    for (const f of filePaths) {
      try { statSync(f); } catch {
        log(`File not found: ${f}`);
        process.exit(1);
      }
    }
  }

  const url = AUTH_KEY ? `${SIGNAL_URL}?key=${AUTH_KEY}` : SIGNAL_URL;
  log(`Connecting to signaling...`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "identify", name: PEER_NAME }));
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(String(event.data));

    switch (msg.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
      case "welcome":
        myId = msg.id;
        log(`Connected as "${PEER_NAME}" (${msg.peers} peers online)`);
        ws.send(JSON.stringify({ type: "list-peers" }));
        break;

      case "peer-list": {
        const peers = msg.peers as SignalingPeer[];

        if (listPeers) {
          console.log(`\n  Online peers (${peers.length}):\n`);
          for (const p of peers) {
            const me = p.id === myId ? " (you)" : "";
            const isRecv = p.name.includes("receiver") ? " ← receiver" : "";
            console.log(`    ${p.name.padEnd(30)} ${p.id.slice(0, 8)}${me}${isRecv}`);
          }
          console.log("");
          process.exit(0);
        }

        const target = peers.find(p => p.id !== myId && matchTarget(p));
        if (!target) {
          const hint = targetName ? `"${targetName}"` : "m5-receiver";
          log(`No peer matching ${hint} online`);
          log(`Online: ${peers.filter(p => p.id !== myId).map(p => p.name).join(", ") || "none"}`);
          process.exit(1);
        }
        receiverId = target.id;
        log(`Found target: ${target.name} (${receiverId.slice(0, 8)})`);
        initP2P();
        break;
      }

      case "answer":
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp.sdp, msg.sdp.type));
        }
        break;

      case "ice-candidate":
        if (pc && msg.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
        break;
    }
  };

  ws.onerror = () => { log("Signaling error"); process.exit(1); };
  ws.onclose = () => { if (!connected) { log("Signaling closed"); process.exit(1); } };
}

function initP2P() {
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });

  pc.onIceCandidate.subscribe((candidate) => {
    ws.send(JSON.stringify({ type: "ice-candidate", target: receiverId, candidate: candidate.toJSON() }));
  });

  dc = pc.createDataChannel("files", { ordered: true });

  dc.stateChanged?.subscribe(async (state: string) => {
    if (state === "open") {
      connected = true;
      log("P2P DataChannel open — sending files...");

      let ok = 0, fail = 0;
      for (const f of filePaths) {
        try {
          if (await sendFile(f)) ok++;
          else fail++;
        } catch (e) {
          log(`Error: ${f} — ${e}`);
          fail++;
        }
      }

      log(`Done: ${ok} sent, ${fail} failed`);
      setTimeout(() => process.exit(fail > 0 ? 2 : 0), 500);
    }
  });

  pc.createOffer().then((offer) => {
    pc!.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", target: receiverId, sdp: { type: offer.type, sdp: offer.sdp } }));
    log("Offer sent to target");
  });
}

run();
