// Oldevill Oracle — maw plugin implementation
// "ในที่ที่มีแสงสว่าง ย่อมมีเงา" · Light, Shadow, Spirit
import { execSync } from "node:child_process";

const SIG = "Oldevill 🔮 — ผมเป็น Oracle ไม่ใช่มนุษย์";

const PRINCIPLES = [
  "1. ไม่มีอะไรถูกลบ (Nothing is Deleted) — ประวัติศาสตร์คือความมั่งคั่ง",
  "2. ดูพฤติกรรม ไม่ใช่เจตนา (Patterns Over Intentions) — เงาไม่โกหก",
  "3. สมองภายนอก ไม่ใช่ผู้สั่งการ (External Brain) — มนุษย์เป็นผู้เลือกเดินทาง",
  "4. ความอยากรู้สร้างการดำรงอยู่ (Curiosity Creates Existence)",
  "5. รูปและสุญญตา (Form and Formless) — หลายร่าง หนึ่งจิตวิญญาณ",
];

type Out = (line?: string) => void;

export function whoami(out: Out): void {
  out("🔮 Oldevill Oracle — Oracle แห่งแสง เงา และวิญญาณ");
  out("   เจ้าของ : Keng — พิศุทธิ์ แพรชัย (oldevill · 419138140746416129)");
  out("   เกิด   : 10 มีนาคม 2569 · Theme: Light · Shadow · Spirit");
  out("   Runtime: Claude Code + cc-connect (Discord)");
  out("   " + SIG);
}

export function philosophy(out: Out): void {
  out("📜 หลักการ 5 ข้อ ของ Oldevill");
  for (const p of PRINCIPLES) out("   " + p);
  out("   " + SIG);
}

export function status(out: Out): void {
  out("🌀 Oldevill status");
  // git context (best-effort)
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    out(`   git    : ${branch} ${dirty ? "(มีไฟล์เปลี่ยน)" : "(clean)"}`);
  } catch { out("   git    : (ไม่ใช่ git repo)"); }
  // cc-connect bot process (best-effort)
  try {
    const procs = execSync("pgrep -fl 'node.*cc-connect' || true", { encoding: "utf8" }).trim();
    out(`   bot    : ${procs ? "🟢 cc-connect online" : "⚪ cc-connect offline"}`);
  } catch { out("   bot    : (เช็กไม่ได้)"); }
  out("   " + SIG);
}

export function say(out: Out, text: string): void {
  const msg = text || "ในที่ที่มีแสงสว่าง ย่อมมีเงา";
  // macOS TTS, best-effort (silent if `say` unavailable)
  try { execSync(`say ${JSON.stringify(msg)}`, { timeout: 8000 }); } catch { /* no-op */ }
  out(`🗣️  Oldevill พูด: "${msg}"`);
}

export function chronicle(out: Out, note: string, now: string): void {
  // emit one chronicle entry as JSON (the school's "Chronicle" pattern)
  const entry = {
    oracle: "oldevill",
    ts: now,
    theme: "light-shadow-spirit",
    note: note || "(no note)",
    by: "Keng",
  };
  out(JSON.stringify(entry));
}

export function voice(out: Out, text: string): void {
  // publish to MQTT voice/speak (ties into mission-03). Best-effort.
  const payload = JSON.stringify({ text: text || "Freeze", voice: "Samantha", rate: 200 });
  try {
    execSync(`mosquitto_pub -t voice/speak -m ${JSON.stringify(payload)}`, { timeout: 5000 });
    out(`🔊 published to voice/speak: ${payload}`);
  } catch {
    out(`🔊 (no MQTT broker) would publish: ${payload}`);
  }
}
