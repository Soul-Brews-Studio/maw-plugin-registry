import { type MembraneReport } from "./types";
import { exec } from "./ghq";

const SECRET_FIND_EXPR = [
  "(",
  "-name", ".env",
  "-o", "-name", ".env.*",
  "-o", "-name", ".envrc",
  "-o", "-name", "*.key",
  "-o", "-name", "*.pem",
  "-o", "-name", "*.pfx",
  "-o", "-name", "*.p12",
  "-o", "-name", "*.kdbx",
  "-o", "-name", ".netrc",
  "-o", "-name", ".npmrc",
  "-o", "-name", ".git-credentials",
  "-o", "-name", "id_rsa",
  "-o", "-name", "id_ed25519",
  "-o", "-name", "id_ecdsa",
  "-o", "-name", "id_dsa",
  "-o", "-name", "terraform.tfstate",
  "-o", "-name", "terraform.tfstate.backup",
  "-o", "-name", "secrets.yaml",
  "-o", "-name", "secrets.yml",
  "-o", "-path", "*/wireguard/*",
  "-o", "-path", "*/.ssh/*",
  "-o", "-path", "*/.aws/*",
  "-o", "-path", "*/.kube/*",
  ")",
];

export async function runMembrane(dir: string): Promise<MembraneReport> {
  const collScript = `find "$1" -type f -not -path '*/.git/*' | awk '{ lc=tolower($0); paths[lc]=paths[lc] $0 "\\n"; cnt[lc]++ } END { for (k in cnt) if (cnt[k] > 1) printf "%s", paths[k] }'`;

  const [coll, secrets, apple] = await Promise.all([
    exec("bash", ["-c", collScript, "_", dir]),
    exec("find", [dir, "-type", "f", "-not", "-path", "*/.git/*", ...SECRET_FIND_EXPR]),
    exec("bash", ["-c", `find "$1" -name '._*' -not -path '*/.git/*' | wc -l`, "_", dir]),
  ]);

  return {
    caseCollisions: coll.stdout.trim().split("\n").filter(Boolean),
    secrets: secrets.stdout.trim().split("\n").filter(Boolean).map((p) => p.replace(dir + "/", "")),
    appleDouble: parseInt(apple.stdout.trim(), 10) || 0,
  };
}
