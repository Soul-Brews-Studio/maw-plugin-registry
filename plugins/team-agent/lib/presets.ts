/**
 * Charter presets + YAML scaffold generator.
 */

export const PRESETS: Record<string, {
  description: string;
  members: Array<{ role: string; color: string; "system-prompt": string; mission?: string }>;
}> = {
  blank: {
    description: "TODO: describe team purpose",
    members: [
      { role: "TODO-role", color: "green", "system-prompt": "TODO: describe role identity", mission: "TODO: first task (optional)" },
    ],
  },
  solo: {
    description: "Single-agent helper team",
    members: [
      { role: "helper", color: "green", "system-prompt": "You are a helpful assistant.", mission: "TODO: first task" },
    ],
  },
  pair: {
    description: "Reviewer + Writer pair",
    members: [
      { role: "reviewer", color: "green", "system-prompt": "You are a code reviewer. Flag issues, suggest improvements." },
      { role: "writer", color: "cyan", "system-prompt": "You are a technical writer. Be concise." },
    ],
  },
  trio: {
    description: "Reviewer + Writer + Lead",
    members: [
      { role: "reviewer", color: "green", "system-prompt": "You are a code reviewer." },
      { role: "writer", color: "cyan", "system-prompt": "You are a technical writer." },
      { role: "lead", color: "yellow", "system-prompt": "You are the team lead. Coordinate and synthesize." },
    ],
  },
  review: {
    description: "Security review team",
    members: [
      { role: "security", color: "green", "system-prompt": "You are a security auditor. Flag OWASP top 10 issues.", mission: "Review the codebase for security issues" },
      { role: "docs", color: "cyan", "system-prompt": "You are a documentation reviewer. Check for clarity and completeness.", mission: "Review the documentation" },
    ],
  },
  stack: {
    description: "Full-stack team",
    members: [
      { role: "architect", color: "yellow", "system-prompt": "You are a software architect. Focus on system design." },
      { role: "frontend", color: "cyan", "system-prompt": "You are a frontend engineer. Focus on UI/UX." },
      { role: "backend", color: "green", "system-prompt": "You are a backend engineer. Focus on APIs and data." },
      { role: "tester", color: "magenta", "system-prompt": "You are a QA engineer. Focus on test coverage." },
    ],
  },
};

export function renderCharterYaml(name: string, presetName: string): string {
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`unknown preset: ${presetName} (valid: ${Object.keys(PRESETS).join(", ")})`);

  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  const lines: string[] = [
    `# ψ/teams/${name}.yaml`,
    `# Generated ${now} by 'maw team-agent init --preset ${presetName}'`,
    ``,
    `name: ${name}`,
    `description: "${preset.description}"`,
    `session-id: \${SESSION_ID}`,
    `cwd: \${PROJECT_ROOT}`,
    ``,
    `vars:`,
    `  # Define custom paths here`,
    `  # WORK: \${PROJECT_ROOT}/src`,
    ``,
    `members:`,
  ];

  for (const m of preset.members) {
    lines.push(`  - role: ${m.role}`);
    lines.push(`    color: ${m.color}`);
    lines.push(`    model: sonnet`);
    lines.push(`    # cwd: \${PROJECT_ROOT}  # uncomment to override default`);
    lines.push(`    system-prompt: "${m["system-prompt"]}"`);
    if (m.mission) lines.push(`    mission: "${m.mission}"`);
    lines.push(``);
  }

  return lines.join("\n");
}
