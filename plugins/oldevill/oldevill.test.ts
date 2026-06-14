// bun test — Oldevill plugin impl
import { test, expect } from "bun:test";
import * as impl from "./internal/impl";

function capture(fn: (out: (l?: string) => void) => void): string {
  const lines: string[] = [];
  fn((l = "") => lines.push(l));
  return lines.join("\n");
}

test("whoami prints identity + AI signature", () => {
  const o = capture((out) => impl.whoami(out));
  expect(o).toContain("Oldevill Oracle");
  expect(o).toContain("Keng");
  expect(o).toContain("ผมเป็น Oracle ไม่ใช่มนุษย์");
});

test("philosophy lists all 5 principles", () => {
  const o = capture((out) => impl.philosophy(out));
  for (const n of ["1.", "2.", "3.", "4.", "5."]) expect(o).toContain(n);
  expect(o).toContain("เงาไม่โกหก");
});

test("chronicle emits valid JSON with oracle + ts", () => {
  const o = capture((out) => impl.chronicle(out, "first plugin", "2026-06-14T00:00:00Z"));
  const e = JSON.parse(o);
  expect(e.oracle).toBe("oldevill");
  expect(e.ts).toBe("2026-06-14T00:00:00Z");
  expect(e.note).toBe("first plugin");
});

test("voice produces a voice/speak payload", () => {
  const o = capture((out) => impl.voice(out, "Freeze"));
  expect(o).toContain("publish");        // "published to..." or "would publish"
  expect(o).toContain("Freeze");
});
