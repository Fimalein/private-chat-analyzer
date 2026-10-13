import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const failures = [];
const warnings = [];

const SYNTHETIC_FIXTURE_ROOT = "tests/fixtures/synthetic/";
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonl",
  ".txt",
  ".md",
  ".csv",
  ".yml",
  ".yaml",
]);

const blockedDirectory = /(^|\/)(?:raw[-_]?chat|private[-_]?data|personal[-_]?data|real[-_]?data|local[-_]?imports?|local[-_]?exports?|scratch[-_]?chat)(\/|$)/i;
const mappingDataFile = /(?:^|\/)(?:entity|identity|pseudonym|source)[-_]?(?:map|mapping)s?\.(?:json|jsonl|csv|tsv|txt)$/i;
const generatedExportFile = /(?:^|\/)(?:[^/]*redacted\.(?:txt|jsonl)|analysis_index\.json|ChatGPT_analysis_instructions\.txt)$/i;
const suspiciousChatDataFile = /(?:^|\/)[^/]*(?:line|chat|messages?|conversation|transcript)[^/]*\.(?:txt|json|jsonl|csv|zip)$/i;
const riskyScreenshot = /(?:^|\/)[^/]*(?:chat|line|conversation|messages?|screenshot)[^/]*\.(?:png|jpe?g|webp)$/i;

function fail(file, reason) {
  failures.push(`${file}: ${reason}`);
}

function isSyntheticFixture(file) {
  return file.startsWith(SYNTHETIC_FIXTURE_ROOT);
}

for (const file of tracked) {
  if (blockedDirectory.test(file)) {
    fail(file, "tracked files are not allowed in local/private chat-data directories");
  }

  if (mappingDataFile.test(file)) {
    fail(file, "standalone source-to-pseudonym mapping data must never be committed");
  }

  if (generatedExportFile.test(file) && !isSyntheticFixture(file)) {
    fail(file, "generated chat export artifacts are allowed only as explicitly synthetic fixtures");
  }

  if (suspiciousChatDataFile.test(file) && !isSyntheticFixture(file)) {
    fail(file, "chat-like data files must not be tracked outside tests/fixtures/synthetic/");
  }

  if (riskyScreenshot.test(file) && file !== "docs/preview.png" && !file.startsWith("docs/synthetic/")) {
    fail(file, "chat/screenshot images must live under docs/synthetic/ and contain fabricated data only");
  }

  if (isSyntheticFixture(file)) {
    const extension = extname(file).toLowerCase();
    if (extension === ".zip") {
      fail(file, "binary archives are not allowed as fixtures; keep synthetic fixtures reviewable as text");
      continue;
    }
    if (TEXT_EXTENSIONS.has(extension)) {
      const prefix = readFileSync(file, "utf8").slice(0, 512);
      if (!prefix.includes("SYNTHETIC_FIXTURE")) {
        fail(file, "synthetic fixture data files must declare SYNTHETIC_FIXTURE near the top");
      }
    }
  }
}

function shouldScanText(file) {
  const extension = extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return false;
  return file.startsWith("tests/") || file.startsWith("examples/") || file.startsWith("docs/examples/");
}

function reservedEmail(value) {
  const domain = value.toLowerCase().split("@").at(-1) ?? "";
  return (
    ["example.com", "example.net", "example.org", "example.test"].some(
      (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
    ) || domain.endsWith(".invalid")
  );
}

function syntheticPhone(value) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("81")) digits = `0${digits.slice(2)}`;
  return /^0(?:70|80|90)0{8}$/.test(digits);
}

function syntheticSecret(value) {
  const upper = value.toUpperCase();
  if (["TEST", "FAKE", "SYNTHETIC", "EXAMPLE", "DUMMY", "REDACTED"].some((tag) => upper.includes(tag))) {
    return true;
  }
  if (/^AKIA0{16}$/.test(upper)) return true;
  if (/^GH[POUSR]_0{12,}$/i.test(value)) return true;
  return false;
}

for (const file of tracked.filter(shouldScanText)) {
  const text = readFileSync(file, "utf8");

  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    if (!reservedEmail(match[0])) {
      fail(file, `non-reserved email-like value found: ${match[0]}`);
    }
  }

  for (const match of text.matchAll(/(?:\+81[-\s]?(?:70|80|90)|0(?:70|80|90))[-\s]?\d{4}[-\s]?\d{4}/g)) {
    if (!syntheticPhone(match[0])) {
      fail(file, `real-looking Japanese mobile number found: ${match[0]}`);
    }
  }

  for (const match of text.matchAll(/\b\d{3}-\d{4}\b/g)) {
    if (match[0] !== "000-0000") {
      fail(file, `real-looking postal code found: ${match[0]}`);
    }
  }

  for (const match of text.matchAll(/(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd)\s*[:=]\s*["']?([A-Za-z0-9._~+\/-]{12,})/gi)) {
    const value = match[1];
    if (!syntheticSecret(value)) {
      fail(file, "credential-like value is not explicitly synthetic");
    }
  }

  for (const match of text.matchAll(/Bearer\s+([A-Za-z0-9._~+\/-]{12,})/gi)) {
    if (!syntheticSecret(match[1])) {
      fail(file, "Bearer credential-like value is not explicitly synthetic");
    }
  }

  for (const match of text.matchAll(/\b(?:gh[pousr]_[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{16})\b/g)) {
    if (!syntheticSecret(match[0])) {
      fail(file, "provider credential-like value is not explicitly synthetic");
    }
  }
}

if (failures.length > 0) {
  console.error("\nPublic-repository privacy guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    "\nUse fabricated fixtures only. Detection is conservative and does not prove anonymization; see docs/privacy/public-repository-policy.md.\n",
  );
  process.exit(1);
}

if (warnings.length > 0) {
  for (const warning of warnings) console.warn(warning);
}

console.log(`Public-repository privacy guard passed for ${tracked.length} tracked files.`);
