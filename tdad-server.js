/**
 * TDAD Local Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Bridges the React UI with:
 *   • Anthropic API  (AI generation — API key stays server-side)
 *   • Salesforce CLI (sf agent / sf project commands)
 *   • Local filesystem (reads/writes YAML specs in your SFDX project)
 *
 * Setup:
 *   1. npm install express cors
 *   2. Create a .env file next to this file:
 *        ANTHROPIC_API_KEY=sk-ant-...
 *        SF_PROJECT_PATH=/absolute/path/to/your/sfdx-project
 *        TARGET_ORG=my-dev-org
 *   3. node tdad-server.js
 *      — or with explicit path: node tdad-server.js --project /path/to/sfdx-project
 *
 * React app connects to http://localhost:3001
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express  = require("express");
const cors     = require("cors");
const fs       = require("fs");
const path     = require("path");
const https    = require("https");
const { spawn, execSync } = require("child_process");

// ── .env loader (zero dependencies) ──────────────────────────────────────────
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .forEach(l => {
      const eq = l.indexOf("=");
      const k  = l.slice(0, eq).trim();
      const v  = l.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v.trim();
    });
}

// ── Config ────────────────────────────────────────────────────────────────────
const projectArgIdx = process.argv.indexOf("--project");
const PROJECT_PATH  = projectArgIdx !== -1
  ? process.argv[projectArgIdx + 1]
  : (process.env.SF_PROJECT_PATH || process.cwd());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const TARGET_ORG        = process.env.TARGET_ORG || "my-dev-org";
const PORT              = parseInt(process.env.PORT || "3001", 10);
const SPECS_DIR         = path.join(PROJECT_PATH, "specs");
const MODEL             = "claude-sonnet-4-20250514";

// ── Startup banner ────────────────────────────────────────────────────────────
console.log("\n⚡  TDAD Local Server");
console.log("──────────────────────────────────────────────");
console.log(`  Project    : ${PROJECT_PATH}`);
console.log(`  Specs dir  : ${SPECS_DIR}`);
console.log(`  Target org : ${TARGET_ORG}`);
console.log(`  Port       : ${PORT}`);
console.log(`  API key    : ${ANTHROPIC_API_KEY ? "✓ set" : "✗ MISSING — add ANTHROPIC_API_KEY to .env"}`);

if (!ANTHROPIC_API_KEY) {
  console.error("\n  ✗ ANTHROPIC_API_KEY is required. Add it to .env and restart.\n");
  process.exit(1);
}
if (!fs.existsSync(PROJECT_PATH)) {
  console.error(`\n  ✗ Project path not found: ${PROJECT_PATH}\n`);
  process.exit(1);
}
if (!fs.existsSync(SPECS_DIR)) {
  fs.mkdirSync(SPECS_DIR, { recursive: true });
  console.log(`  Created    : ${SPECS_DIR}`);
}

let sfVersion = "not found";
try { sfVersion = execSync("sf --version", { encoding: "utf8" }).trim().split("\n")[0]; }
catch (_) {}
console.log(`  sf CLI     : ${sfVersion}`);
console.log("──────────────────────────────────────────────\n");

// ── Express setup ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ── Anthropic proxy ───────────────────────────────────────────────────────────
function callAnthropic(system, userMsg, maxTokens = 4096) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL, max_tokens: maxTokens, system,
      messages: [{ role: "user", content: userMsg }],
    });
    const req = https.request({
      hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const p = JSON.parse(data);
          if (p.error) return reject(new Error(p.error.message));
          resolve(p.content?.[0]?.text || "");
        } catch (e) { reject(new Error("Failed to parse Anthropic response")); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── sf CLI — streaming via SSE ────────────────────────────────────────────────
// Only allow sf agent and sf project deploy commands
const ALLOWED_PREFIXES = ["agent ", "project deploy"];
const isSafeCmd = cmd => ALLOWED_PREFIXES.some(p => cmd.trim().startsWith(p));

function runSfStreaming(cmdAfterSf, cwd, res) {
  const args = cmdAfterSf.trim().split(/\s+/);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sse = (type, text) => res.write(`data: ${JSON.stringify({ type, text })}\n\n`);

  sse("info", `▶ sf ${cmdAfterSf}\n`);
  sse("info", `  cwd: ${cwd}\n\n`);

  const proc = spawn("sf", args, { cwd, shell: true });
  proc.stdout.on("data", d => sse("stdout", d.toString()));
  proc.stderr.on("data", d => sse("stderr", d.toString()));
  proc.on("close", code => {
    sse(code === 0 ? "done" : "error",
        code === 0 ? "\n✓ Completed successfully" : `\n✗ Exited with code ${code}`);
    res.end();
  });
  proc.on("error", e => { sse("error", `\n✗ ${e.message}`); res.end(); });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /status
app.get("/status", (req, res) => {
  const hasSfdx = fs.existsSync(path.join(PROJECT_PATH, "sfdx-project.json"));
  const specFiles = fs.existsSync(SPECS_DIR)
    ? fs.readdirSync(SPECS_DIR)
        .filter(f => f.endsWith(".yaml"))
        .map(f => {
          const fp = path.join(SPECS_DIR, f);
          return { name: f, size: fs.statSync(fp).size,
                   modified: fs.statSync(fp).mtime.toISOString() };
        })
    : [];
  res.json({
    ok: true, projectPath: PROJECT_PATH, specsDir: SPECS_DIR,
    hasSfdxProject: hasSfdx, targetOrg: TARGET_ORG,
    sfFound: sfVersion !== "not found", sfVersion, specFiles,
  });
});

// POST /ai  — proxy to Anthropic
app.post("/ai", async (req, res) => {
  const { system, userMsg } = req.body;
  if (!system || !userMsg)
    return res.status(400).json({ ok: false, error: "system and userMsg required" });
  try {
    const result = await callAnthropic(system, userMsg);
    res.json({ ok: true, result });
  } catch (e) {
    console.error("  Anthropic error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /files/save  — write YAML to specs/
app.post("/files/save", (req, res) => {
  const { filename, content } = req.body;
  if (!filename || !content)
    return res.status(400).json({ ok: false, error: "filename and content required" });

  const safe = path.basename(filename);
  if (!safe.endsWith(".yaml"))
    return res.status(400).json({ ok: false, error: "Only .yaml files allowed" });

  const filePath = path.join(SPECS_DIR, safe);
  try {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  ✓ Saved  : ${filePath}`);
    res.json({ ok: true, path: filePath, filename: safe });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /files/specs  — list all YAML specs with content
app.get("/files/specs", (req, res) => {
  try {
    const files = fs.existsSync(SPECS_DIR)
      ? fs.readdirSync(SPECS_DIR)
          .filter(f => f.endsWith(".yaml"))
          .map(f => {
            const fp = path.join(SPECS_DIR, f);
            return { name: f, path: fp,
                     size: fs.statSync(fp).size,
                     modified: fs.statSync(fp).mtime.toISOString(),
                     content: fs.readFileSync(fp, "utf8") };
          })
      : [];
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /files/agents  — find all .agent files in the SFDX project recursively
app.get("/files/agents", (req, res) => {
  try {
    const results = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".agent")) {
          const stat = fs.statSync(full);
          const content = fs.readFileSync(full, "utf8");
          results.push({
            name: entry.name,
            path: full,
            relativePath: path.relative(PROJECT_PATH, full),
            size: stat.size,
            modified: stat.mtime.toISOString(),
            content,
          });
        }
      }
    };
    walk(PROJECT_PATH);
    res.json({ ok: true, files: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// GET /files/aievals  — find all AiEvaluationDefinition XML files recursively
app.get("/files/aievals", (req, res) => {
  try {
    const results = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(full);
        } else if (entry.isFile() && (
          entry.name.endsWith(".aiEvaluationDefinition-meta.xml") ||
          (entry.name.endsWith(".xml") && entry.name.toLowerCase().includes("aievaluation"))
        )) {
          const stat = fs.statSync(full);
          const content = fs.readFileSync(full, "utf8");
          results.push({
            name: entry.name,
            path: full,
            relativePath: path.relative(PROJECT_PATH, full),
            size: stat.size,
            modified: stat.mtime.toISOString(),
            content,
          });
        }
      }
    };
    walk(PROJECT_PATH);
    res.json({ ok: true, files: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/sf/run", (req, res) => {
  const cmd = (req.query.cmd || "").trim();
  if (!cmd)            return res.status(400).json({ error: "cmd is required" });
  if (!isSafeCmd(cmd)) return res.status(403).json({ error: "Only sf agent and sf project deploy commands are allowed" });
  runSfStreaming(cmd, PROJECT_PATH, res);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`✓ Server ready → http://localhost:${PORT}\n  Open your React app and it will connect automatically.\n`)
);
