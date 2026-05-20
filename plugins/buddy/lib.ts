export interface BuddyPrimingInput {
  selfName: string;
  buddyName: string;
  leadPane?: string;
  task: string;
  taskContextPath: string;
  worktreePath: string;
  selfRole: string;
  buddyRole: string;
  engine: string;
  buddyEngine: string;
  systemName?: string;
  selfAddress?: string;
  buddyAddress?: string;
  leadName?: string;
  lineage?: string;
  verification?: string;
  gitContract?: string;
  ownership?: string;
  cadence?: string;
  firstMove?: string;
}

export interface BuddyPrimingOutput {
  message: string;
  talkCommand: string;
  selfAddress: string;
  buddyAddress: string;
}

function quoteForDoubleQuotedShell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

function heyCommand(target: string, message: string): string {
  return `maw hey ${target} "${quoteForDoubleQuotedShell(message)}"`;
}

function line(label: string, value: string | undefined): string | null {
  if (!value) return null;
  return `  ${label}: ${value}`;
}

function pushOptional(lines: string[], ...values: Array<string | null>): void {
  for (const value of values) {
    if (value) lines.push(value);
  }
}

export function buildBuddyPriming(input: BuddyPrimingInput): BuddyPrimingOutput {
  const systemName = input.systemName || "buddy-system";
  const selfAddress = input.selfAddress || input.selfName;
  const buddyAddress = input.buddyAddress || input.buddyName;
  const lineage = input.lineage || "Buddy pair born by maw buddy";
  const ownership = input.ownership || "Shared worktree. State intended write scope before editing; do not revert buddy edits; coordinate before touching the same files.";
  const cadence = input.cadence || "Use maw hey for sync. Send ACK, first-move plan, blocker/escalation, and DONE with evidence. Batch updates; do not loop or message yourself.";
  const verification = input.verification || "Agree on the smallest test/build command that proves done, then report the exact evidence.";
  const gitContract = input.gitContract || "Do not commit or push unless the lead explicitly assigns that responsibility.";
  const firstMove = input.firstMove || "Read the context file, ACK your buddy, state your intended write scope, then propose your first move.";

  const lines: string[] = [
    `[m5:${systemName}] You are ${input.selfName}, paired with ${input.buddyName}.`,
    "",
    `  TASK: ${input.task}`,
    `  CONTEXT: ${input.taskContextPath}`,
    `  WORKTREE: ${input.worktreePath}`,
    `  LINEAGE: ${lineage}`,
    "",
    `  SELF ADDRESS: ${selfAddress}`,
    `  BUDDY ADDRESS: ${buddyAddress}`,
  ];

  pushOptional(
    lines,
    line("LEAD", input.leadName),
    line("LEAD ADDRESS", input.leadPane),
  );

  lines.push(
    "",
    "  TALK TO YOUR BUDDY:",
    `    ${heyCommand(buddyAddress, "<message>")}`,
    "",
    "  Example:",
    `    ${heyCommand(buddyAddress, "I'll handle the spec, you handle impl")}`,
    "",
    `  YOUR ROLE: ${input.selfRole}`,
    `  BUDDY ROLE: ${input.buddyRole}`,
    `  YOUR ENGINE: ${input.engine}`,
    `  BUDDY ENGINE: ${input.buddyEngine}`,
    "",
    `  OWNERSHIP: ${ownership}`,
    `  CADENCE: ${cadence}`,
    `  VERIFICATION: ${verification}`,
    `  GIT: ${gitContract}`,
    "  LOOP GUARD: Do not maw hey yourself. Avoid infinite ping-pong; prefer concise batched updates.",
    `  PEEK: maw tmux peek ${buddyAddress}`,
  );

  if (input.leadPane) {
    lines.push(`  REPORT TO LEAD: ${heyCommand(input.leadPane, "DONE <summary + evidence>")}`);
  }

  lines.push(
    "",
    "  DONE: Report DONE via maw hey to your buddy with evidence and any remaining risks.",
    `  START NOW: ${firstMove}`,
  );

  return {
    message: lines.join("\n"),
    talkCommand: heyCommand(buddyAddress, "<message>"),
    selfAddress,
    buddyAddress,
  };
}

export function buildBuddyPrimingMessage(input: BuddyPrimingInput): string {
  return buildBuddyPriming(input).message;
}
