/**
 * Minimal YAML parser + template resolver.
 *
 * Supports:
 *   - top-level key: value
 *   - block scalars (key: |)
 *   - vars: section (2-space indent key-value)
 *   - members: array (- role: ... with 4-space indent fields)
 *   - # comments
 *
 * Template: ${VAR} → vars[VAR] || process.env[VAR] || literal
 */

export function parseSimpleYaml(text: string): Record<string, any> {
  const lines = text.split(/\r?\n/);
  const root: Record<string, any> = {};
  const members: Record<string, any>[] = [];
  let currentMember: Record<string, any> | null = null;
  let blockKey: string | null = null;
  let blockLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const stripped = line.replace(/#.*$/, "");
    if (!stripped.trim()) { i++; continue; }

    if (blockKey && /^\S/.test(line)) {
      if (currentMember) currentMember[blockKey] = blockLines.join("\n").trim();
      else root[blockKey] = blockLines.join("\n").trim();
      blockKey = null;
      blockLines = [];
    }
    if (blockKey) {
      blockLines.push(stripped.replace(/^ {4,6}/, ""));
      i++; continue;
    }

    const topMatch = stripped.match(/^([a-z][a-z0-9-]*):\s*(.*)$/);

    if (topMatch && topMatch[1] === "vars") {
      const vars: Record<string, string> = {};
      i++;
      while (i < lines.length) {
        const vl = lines[i]!.replace(/#.*$/, "");
        if (!vl.trim()) { i++; continue; }
        if (/^\S/.test(vl)) break;
        const vm = vl.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):\s*(.+)$/);
        if (vm) vars[vm[1]!] = vm[2]!.replace(/^["']|["']$/g, "").trim();
        i++;
      }
      root.vars = vars;
      continue;
    }

    if (topMatch && topMatch[1] === "members") { i++; continue; }

    if (topMatch) {
      const val = topMatch[2]!.replace(/^["']|["']$/g, "").trim();
      if (val === "|") { blockKey = topMatch[1]!; blockLines = []; }
      else root[topMatch[1]!] = val;
      i++; continue;
    }

    const memberStart = stripped.match(/^\s+-\s+role:\s*(.+)$/);
    if (memberStart) {
      if (currentMember) members.push(currentMember);
      currentMember = { role: memberStart[1]!.replace(/^["']|["']$/g, "").trim() };
      i++; continue;
    }

    if (currentMember) {
      const field = stripped.match(/^\s{4}([a-z][a-z0-9-]*):\s*(.*)$/);
      if (field) {
        const val = field[2]!.replace(/^["']|["']$/g, "").trim();
        if (val === "|") { blockKey = field[1]!; blockLines = []; }
        else currentMember[field[1]!] = val;
      }
    }
    i++;
  }
  if (blockKey && currentMember) currentMember[blockKey] = blockLines.join("\n").trim();
  if (currentMember) members.push(currentMember);
  root.members = members;
  return root;
}

export function resolveTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)}/g, (match, name) => {
    if (name in vars) return vars[name];
    if (name in process.env) return process.env[name]!;
    return match;
  });
}
