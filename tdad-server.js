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
      const v  = l.slice(eq + 1).trim().replace(/^["']|["']$/g, ""); // strip quotes
      if (!k) return;
      // .env always wins except ANTHROPIC_API_KEY if already set in system env
      if (k === "ANTHROPIC_API_KEY" && process.env[k]) return;
      process.env[k] = v;
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
const TESTS_DIR         = path.join(PROJECT_PATH, "tests");
const MODEL             = "claude-sonnet-4-20250514";

// ── Startup banner ────────────────────────────────────────────────────────────
console.log("\n⚡  TDAD Local Server");
console.log("──────────────────────────────────────────────");
console.log(`  Project    : ${PROJECT_PATH}`);
console.log(`  Specs dir  : ${SPECS_DIR}`);
console.log(`  Tests dir  : ${TESTS_DIR}`);
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
if (!fs.existsSync(TESTS_DIR)) {
  fs.mkdirSync(TESTS_DIR, { recursive: true });
  console.log(`  Created    : ${TESTS_DIR}`);
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

// Disable socket timeout for SSE streaming routes
app.use((req, res, next) => {
  if (req.path === "/sf/run") {
    req.socket && req.socket.setTimeout(0);
    res.socket && res.socket.setTimeout(0);
  }
  next();
});

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
const ALLOWED_PREFIXES = ["agent ", "project deploy", "project retrieve"];
const isSafeCmd = cmd => ALLOWED_PREFIXES.some(p => cmd.trim().startsWith(p));

// ── Persistent bash sessions (for local test steps sharing $SESSION_ID) ──────
const bashSessions = new Map(); // sessionId → { proc, env, vars }

function createBashSession(sessionId) {
  const env = {
    ...process.env,
    PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  };
  // Spawn a persistent bash process with stdin/stdout pipes
  const proc = spawn("bash", [], { cwd: PROJECT_PATH, env, stdio: ["pipe", "pipe", "pipe"] });
  const session = { proc, env, vars: {} };
  bashSessions.set(sessionId, session);
  // Auto-cleanup after 30 min
  setTimeout(() => {
    if (bashSessions.has(sessionId)) {
      try { proc.kill(); } catch (_) {}
      bashSessions.delete(sessionId);
      console.log(`  Session ${sessionId} expired`);
    }
  }, 30 * 60 * 1000);
  return session;
}

function runSseStream(proc, label, cwd, res, req) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.socket && res.socket.setTimeout(0);
  res.flushHeaders();

  const sse = (type, text) => {
    try { res.write(`data: ${JSON.stringify({ type, text })}\n\n`); } catch (_) {}
  };

  sse("info", `▶ ${label}\n  cwd: ${cwd}\n\n`);

  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch (_) { clearInterval(ping); }
  }, 15000);

  proc.stdout.on("data", d => sse("stdout", d.toString()));
  proc.stderr.on("data", d => sse("stderr", d.toString()));
  proc.on("close", code => {
    clearInterval(ping);
    sse(code === 0 ? "done" : "error",
        code === 0 ? "\n✓ Completed successfully" : `\n✗ Exited with code ${code}`);
    try { res.end(); } catch (_) {}
  });
  proc.on("error", e => {
    clearInterval(ping);
    sse("error", `\n✗ ${e.message}`);
    try { res.end(); } catch (_) {}
  });
  req && req.on("close", () => {
    clearInterval(ping);
    try { proc.kill(); } catch (_) {}
  });
}

function runSfStreaming(cmdAfterSf, cwd, res, req) {
  const args = cmdAfterSf.trim().split(/\s+/);
  const proc = spawn("sf", args, { cwd, shell: true });
  runSseStream(proc, `sf ${cmdAfterSf}`, cwd, res, req);
}

// ── Detect active org dynamically ────────────────────────────────────────────
function detectActiveOrg() {
  // 1. Project-level config: .sf/config.json (new CLI)
  try {
    const sfConfig = path.join(PROJECT_PATH, ".sf", "config.json");
    if (fs.existsSync(sfConfig)) {
      const cfg = JSON.parse(fs.readFileSync(sfConfig, "utf8"));
      if (cfg["target-org"]) return { org: cfg["target-org"], source: "project (.sf/config.json)" };
    }
  } catch (_) {}

  // 2. Project-level config: .sfdx/sfdx-config.json (old CLI)
  try {
    const sfdxConfig = path.join(PROJECT_PATH, ".sfdx", "sfdx-config.json");
    if (fs.existsSync(sfdxConfig)) {
      const cfg = JSON.parse(fs.readFileSync(sfdxConfig, "utf8"));
      if (cfg.defaultusername) return { org: cfg.defaultusername, source: "project (.sfdx/sfdx-config.json)" };
    }
  } catch (_) {}

  // 3. Global sf CLI config
  try {
    const result = execSync("sf config get target-org --json 2>/dev/null", { encoding: "utf8", timeout: 3000 });
    const parsed = JSON.parse(result);
    const val = parsed?.result?.[0]?.value;
    if (val) return { org: val, source: "global sf config" };
  } catch (_) {}

  // 4. Fallback to .env
  return { org: TARGET_ORG, source: ".env" };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /status
app.get("/status", (req, res) => {
  const hasSfdx = fs.existsSync(path.join(PROJECT_PATH, "sfdx-project.json"));
  let projectName = path.basename(PROJECT_PATH);
  try {
    const sfdxJson = JSON.parse(fs.readFileSync(path.join(PROJECT_PATH, "sfdx-project.json"), "utf8"));
    if (sfdxJson.name) projectName = sfdxJson.name;
  } catch (_) {}
  const specFiles = fs.existsSync(SPECS_DIR)
    ? fs.readdirSync(SPECS_DIR)
        .filter(f => f.endsWith(".yaml"))
        .map(f => {
          const fp = path.join(SPECS_DIR, f);
          return { name: f, size: fs.statSync(fp).size,
                   modified: fs.statSync(fp).mtime.toISOString() };
        })
    : [];

  const { org: activeOrg, source: orgSource } = detectActiveOrg();

  res.json({
    ok: true, projectPath: PROJECT_PATH, projectName, specsDir: SPECS_DIR, testsDir: TESTS_DIR,
    hasSfdxProject: hasSfdx, targetOrg: activeOrg, orgSource,
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

// GET /files/tests  — list all YAML test specs with content
app.get("/files/tests", (req, res) => {
  try {
    const files = fs.existsSync(TESTS_DIR)
      ? fs.readdirSync(TESTS_DIR)
          .filter(f => f.endsWith(".yaml"))
          .map(f => {
            const fp = path.join(TESTS_DIR, f);
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

// POST /files/save-test  — write testSpec YAML to tests/
app.post("/files/save-test", (req, res) => {
  const { filename, content } = req.body;
  if (!filename || !content)
    return res.status(400).json({ ok: false, error: "filename and content required" });
  const safe = path.basename(filename);
  if (!safe.endsWith(".yaml"))
    return res.status(400).json({ ok: false, error: "Only .yaml files allowed" });
  const filePath = path.join(TESTS_DIR, safe);
  try {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  ✓ Saved test: ${filePath}`);
    res.json({ ok: true, path: filePath, filename: safe });
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
  console.log(`  GET /files/aievals — scanning: ${PROJECT_PATH}`);
  try {
    const results = [];
    const walk = (dir, depth = 0) => {
      if (depth > 8) return;
      if (!fs.existsSync(dir)) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (_) { return; } // skip unreadable dirs
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".xml")) {
          // Match any XML that looks like AiEvaluationDefinition
          const lower = entry.name.toLowerCase();
          if (lower.includes("aievaluation") || lower.includes("evaluation")) {
            try {
              const stat = fs.statSync(full);
              const content = fs.readFileSync(full, "utf8");
              // Confirm it's actually an AiEvaluationDefinition XML
              if (content.includes("AiEvaluationDefinition") || content.includes("subjectType")) {
                results.push({
                  name: entry.name,
                  path: full,
                  relativePath: path.relative(PROJECT_PATH, full),
                  size: stat.size,
                  modified: stat.mtime.toISOString(),
                  content,
                });
              }
            } catch (_) {}
          }
        }
      }
    };
    walk(PROJECT_PATH);
    console.log(`  /files/aievals — found ${results.length} file(s)`);
    res.json({ ok: true, files: results });
  } catch (e) {
    console.error(`  /files/aievals ERROR:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/sf/run", (req, res) => {
  const cmd = (req.query.cmd || "").trim();
  if (!cmd)             return res.status(400).json({ error: "cmd is required" });
  if (!isSafeCmd(cmd))  return res.status(403).json({ error: "Only sf agent and sf project deploy commands are allowed" });
  runSfStreaming(cmd, PROJECT_PATH, res, req);
});

// POST /preview/session — create a new bash session, returns sessionId
app.post("/preview/session", (req, res) => {
  const sid = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  createBashSession(sid);
  console.log(`  Created preview session: ${sid}`);
  res.json({ ok: true, sessionId: sid });
});

// DELETE /preview/session/:id — destroy a session
app.delete("/preview/session/:id", (req, res) => {
  const session = bashSessions.get(req.params.id);
  if (session) {
    try { session.proc.kill(); } catch (_) {}
    bashSessions.delete(req.params.id);
  }
  res.json({ ok: true });
});

// POST /preview/run — run a script step in a session, stream output via SSE
app.post("/preview/run", (req, res) => {
  const { sessionId, script, captureVars, utterances } = req.body;
  if (!script) return res.status(400).json({ error: "script required" });

  // If utterances array is provided, build the send loop server-side
  // (avoids JSX template literal issues with bash ${!arr[@]} syntax)
  if (utterances && utterances.length > 0) {
    // Will be injected below as the actual script
  }

  const env = {
    ...process.env,
    PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  };

  // Build step2 script server-side if utterances provided
  let builtScript = script || "";
  if (utterances && utterances.length > 0) {
    const targetOrg = (req.body.org || "").replace(/"/g, "");
    const apiName = (req.body.apiName || "").replace(/"/g, "");
    const bundleFlag = apiName ? "--authoring-bundle " + apiName : "";
    const NL = "\n";
    // Use single-quote escaping for utterances to avoid all bash quoting issues
    const assignments = utterances.map((u, i) => {
      const safe = String(u).replace(/'/g, "'\\''");
      return "UTTERANCES[" + i + "]='" + safe + "'";
    }).join(NL);
    const nodeExpr = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d),r=j.result||j;const m=r.response||r.message||r.botResponse||(r.messages&&r.messages[r.messages.length-1]&&r.messages[r.messages.length-1].message)||JSON.stringify(r).substring(0,200);console.log('  -> '+(m?String(m).substring(0,150):'(no message)'));}catch(e){console.log('  err: '+e.message);}});";
    const parts = [
      "declare -a UTTERANCES",
      assignments,
      "",
      'for i in "${!UTTERANCES[@]}"; do',
      '  UTTERANCE="${UTTERANCES[$i]}"',
      '  echo ""',
      '  echo "[${i}] ${UTTERANCE}"',
      "  RESP=$(sf agent preview send " + (bundleFlag ? bundleFlag + " " : "") + '--session-id "$SESSION_ID" --utterance "$UTTERANCE" --target-org ' + targetOrg + ' --json 2>/dev/null)',
      '  echo "$RESP" | node -e "' + nodeExpr + '"',
      "done",
    ];
    builtScript = parts.join(NL);
  }

  // Prepend saved vars from previous steps
  let fullScript = "";
  if (sessionId && bashSessions.has(sessionId)) {
    const session = bashSessions.get(sessionId);
    const savedVars = Object.entries(session.vars)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join("\n");
    if (savedVars) fullScript = savedVars + "\n";
  }
  fullScript += builtScript;

  // If caller wants us to capture specific vars, append echo markers after script
  if (captureVars && captureVars.length > 0) {
    const echos = captureVars.map(v => `printf '___VAR_${v}=%s\n' "$${v}"`).join("\n");
    fullScript += "\n" + echos;
  }

  console.log(`  /preview/run [${sessionId || "no-session"}]`);

  // Write script to a temp file to avoid shell quoting issues with -c
  const tmpFile = path.join(require("os").tmpdir(), `agentkit_${Date.now()}.sh`);
  fs.writeFileSync(tmpFile, fullScript, "utf8");
  fs.chmodSync(tmpFile, "755");
  const proc = spawn("bash", [tmpFile], { cwd: PROJECT_PATH, env });
  proc.on("close", () => { try { fs.unlinkSync(tmpFile); } catch (_) {} });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.socket && res.socket.setTimeout(0);
  res.flushHeaders();

  const sse = (type, text) => { try { res.write(`data: ${JSON.stringify({ type, text })}\n\n`); } catch (_) {} };
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (_) { clearInterval(ping); } }, 15000);

  let procDone = false;
  proc.stdout.on("data", d => {
    const chunk = d.toString();
    // Intercept ___VAR_XXX=value lines and save them, don't stream them
    const lines = chunk.split("\n");
    const visible = [];
    for (const line of lines) {
      const m = line.match(/^___VAR_([A-Z_]+)=(.*)$/);
      if (m && sessionId && bashSessions.has(sessionId)) {
        bashSessions.get(sessionId).vars[m[1]] = m[2];
      } else {
        visible.push(line);
      }
    }
    const out = visible.join("\n");
    if (out.trim() || out.includes("\n")) sse("stdout", out);
  });

  proc.stderr.on("data", d => sse("stderr", d.toString()));

  proc.on("close", (code, signal) => {
    procDone = true;
    clearInterval(ping);
    console.log(`  proc close: code=${code} signal=${signal}`);
    sse(code === 0 ? "done" : "error",
        code === 0 ? "\n✓ Done" : `\n✗ Exited with code ${code} signal=${signal}`);
    try { res.end(); } catch (_) {}
  });

  proc.on("error", e => {
    procDone = true;
    clearInterval(ping);
    console.log(`  proc error: ${e.message}`);
    sse("error", `\n✗ ${e.message}`);
    try { res.end(); } catch (_) {}
  });

  // Do NOT kill on req close — curl and some browsers close the write-side
  // of the connection immediately after sending the body, which fires req close
  // before bash has produced any output. The script will self-terminate.
  req.on("close", () => {
    console.log(`  req close, procDone=${procDone} — not killing process`);
    clearInterval(ping);
  });
});

// POST /files/save-agent — save edited .agent file back to SFDX project
app.post("/files/save-agent", (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined)
    return res.status(400).json({ ok: false, error: "path and content required" });
  // Security: must be within PROJECT_PATH
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PROJECT_PATH)))
    return res.status(403).json({ ok: false, error: "Path outside project directory" });
  // Must be a .agent file
  if (!resolved.endsWith(".agent"))
    return res.status(400).json({ ok: false, error: "Only .agent files allowed" });
  try {
    fs.writeFileSync(resolved, content, "utf8");
    console.log(`  ✓ Saved agent: ${resolved}`);
    res.json({ ok: true, path: resolved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /preview/traces — list and read trace JSON files from a session path
app.get("/preview/traces", (req, res) => {
  const basePath = req.query.path;
  if (!basePath) return res.status(400).json({ ok: false, error: "path required" });
  if (!fs.existsSync(basePath)) return res.json({ ok: true, files: [] });
  try {
    // Trace files are in the traces/ subfolder
    const tracesDir = path.join(basePath, "traces");
    const searchDir = fs.existsSync(tracesDir) ? tracesDir : basePath;
    // Walk recursively to find all .json files (excluding metadata.json)
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".json") && entry.name !== "metadata.json") {
          found.push({ name: entry.name, path: full, content: fs.readFileSync(full, "utf8") });
        }
      }
    };
    walk(searchDir);
    console.log(`  /preview/traces — found ${found.length} trace file(s) in ${searchDir}`);
    res.json({ ok: true, files: found });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /files/formal-tests — scan formal-tests/ and return structured test history
app.get("/files/formal-tests", (req, res) => {
  const formalTestsDir = path.join(PROJECT_PATH, "formal-tests");
  if (!fs.existsSync(formalTestsDir)) return res.json({ ok: true, agents: [] });
  try {
    const agents = [];
    for (const entry of fs.readdirSync(formalTestsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const agentDir = path.join(formalTestsDir, entry.name);
      const runs = [];
      for (const file of fs.readdirSync(agentDir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(agentDir, file), "utf8"));
          const r = raw.result || raw;
          const tcs = r.testCases || [];
          const passed = tcs.filter(tc => tc.testResults?.every(m => m.result === "PASS" || m.metricLabel === "output_latency_milliseconds")).length;
          const latencies = tcs.flatMap(tc => tc.testResults || [])
            .filter(m => m.metricLabel === "output_latency_milliseconds" && m.score)
            .map(m => m.score);
          const avgLatency = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : null;
          runs.push({
            filename: file,
            runId: r.runId || file.replace(".json",""),
            subjectName: r.subjectName,
            startTime: r.startTime,
            endTime: r.endTime,
            status: r.status,
            passed,
            total: tcs.length,
            passRate: tcs.length ? Math.round(passed/tcs.length*100) : 0,
            avgLatency,
            testCases: tcs.map(tc => ({
              testNumber: tc.testNumber,
              status: tc.status,
              startTime: tc.startTime,
              endTime: tc.endTime,
              utterance: tc.inputs?.utterance || "",
              topic: tc.generatedData?.topic || "",
              actions: tc.generatedData?.actionsSequence || "",
              outcome: tc.generatedData?.outcome || "",
              metrics: (tc.testResults || []).map(m => ({
                label: m.metricLabel,
                result: m.result,
                score: m.score,
                actualValue: m.actualValue,
                expectedValue: m.expectedValue,
                explainability: m.metricExplainability || "",
              })),
              passed: (tc.testResults || []).every(m => m.result === "PASS" || m.metricLabel === "output_latency_milliseconds"),
            })),
          });
        } catch (_) {}
      }
      runs.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
      if (runs.length) agents.push({ name: entry.name, runs });
    }
    res.json({ ok: true, agents });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ── Testing History routes ─────────────────────────────────────────────────────

const FORMAL_TESTS_DIR = path.join(PROJECT_PATH, "formal-tests");

// GET /history/agents — list agents with stats
app.get("/history/agents", (req, res) => {
  if (!fs.existsSync(FORMAL_TESTS_DIR)) return res.json({ ok: true, agents: [] });
  try {
    const agents = fs.readdirSync(FORMAL_TESTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const agentDir = path.join(FORMAL_TESTS_DIR, d.name);
        const suites = fs.readdirSync(agentDir, { withFileTypes: true })
          .filter(s => s.isDirectory()).map(s => s.name);
        let totalRuns = 0, latestRun = null, latestPassRate = null;
        for (const suite of suites) {
          const resultsDir = path.join(agentDir, suite, "Results");
          if (fs.existsSync(resultsDir)) {
            const files = fs.readdirSync(resultsDir).filter(f => f.endsWith(".json"));
            totalRuns += files.length;
            for (const f of files) {
              try {
                const data = JSON.parse(fs.readFileSync(path.join(resultsDir, f), "utf8"));
                const r = data.result || data;
                const ts = r.startTime || r.endTime;
                if (!latestRun || ts > latestRun.time) {
                  const tcs = r.testCases || [];
                  const CORE = ["topic_assertion","actions_assertion","output_validation"];
                  const passed = tcs.filter(tc => { const core = (tc.testResults||[]).filter(tr => CORE.includes(tr.name)); return core.length > 0 && core.every(tr => tr.result === "PASS"); }).length;
                  latestRun = { time: ts, passed, total: tcs.length };
                  latestPassRate = tcs.length > 0 ? Math.round(passed/tcs.length*100) : null;
                }
              } catch(_) {}
            }
          }
        }
        return { name: d.name, suites: suites.length, totalRuns, latestRun, latestPassRate };
      });
    res.json({ ok: true, agents });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /history/suites?agent=X — list test suites for an agent
app.get("/history/suites", (req, res) => {
  const agentName = req.query.agent;
  if (!agentName) return res.status(400).json({ ok: false, error: "agent required" });
  const agentDir = path.join(FORMAL_TESTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) return res.json({ ok: true, suites: [] });
  try {
    const suites = fs.readdirSync(agentDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const suiteDir = path.join(agentDir, d.name);
        const resultsDir = path.join(suiteDir, "Results");
        const fixDir = path.join(suiteDir, "FixLoop");
        const resultFiles = fs.existsSync(resultsDir) ? fs.readdirSync(resultsDir).filter(f => f.endsWith(".json")).sort() : [];
        const fixFiles = fs.existsSync(fixDir) ? fs.readdirSync(fixDir).filter(f => f.endsWith(".json")) : [];
        let latestPassed = 0, latestTotal = 0, latestTime = null;
        if (resultFiles.length > 0) {
          try {
            const last = JSON.parse(fs.readFileSync(path.join(resultsDir, resultFiles[resultFiles.length-1]), "utf8"));
            const r = last.result || last;
            const tcs = r.testCases || [];
            latestTotal = tcs.length;
            const CORE2 = ["topic_assertion","actions_assertion","output_validation"]; latestPassed = tcs.filter(tc => { const core = (tc.testResults||[]).filter(tr => CORE2.includes(tr.name)); return core.length > 0 && core.every(tr => tr.result === "PASS"); }).length;
            latestTime = r.startTime || r.endTime;
          } catch(_) {}
        }
        return { name: d.name, runs: resultFiles.length, fixLoops: fixFiles.length, latestPassed, latestTotal, latestTime };
      });
    res.json({ ok: true, suites });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /history/runs?agent=X&suite=Y — list all runs with results + fix loops
app.get("/history/runs", (req, res) => {
  const { agent, suite } = req.query;
  if (!agent || !suite) return res.status(400).json({ ok: false, error: "agent and suite required" });
  const suiteDir = path.join(FORMAL_TESTS_DIR, agent, suite);
  const resultsDir = path.join(suiteDir, "Results");
  const fixDir = path.join(suiteDir, "FixLoop");
  if (!fs.existsSync(resultsDir)) return res.json({ ok: true, runs: [] });
  try {
    const resultFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith(".json")).sort();
    const fixFiles = fs.existsSync(fixDir) ? fs.readdirSync(fixDir).filter(f => f.endsWith(".json")) : [];
    // Load fix loops indexed by runId
    const fixByRunId = {};
    for (const ff of fixFiles) {
      try {
        const fix = JSON.parse(fs.readFileSync(path.join(fixDir, ff), "utf8"));
        // Index by triggered_by_run_id field
        if (fix.triggered_by_run_id) fixByRunId[fix.triggered_by_run_id] = fix;
        // Also index by runId extracted from fix filename (AgentName-RunId-SuiteName-fix.json)
        const parts = ff.replace(/-fix\.json$/, '').split('-');
        const idx = parts.findIndex(p => /^4K[A-Za-z0-9]{13,}$/.test(p));
        if (idx >= 0) fixByRunId[parts[idx]] = fix;
      } catch(_) {}
    }
    const runs = resultFiles.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(resultsDir, f), "utf8"));
        const r = data.result || data;
        const tcs = r.testCases || [];
        // Count pass/fail per TC (a TC passes if ALL its assertions pass)
        const tcResults = tcs.map(tc => {
          const assertions = (tc.testResults||[]).filter(tr => ["topic_assertion","actions_assertion","output_validation"].includes(tr.name || tr.metricLabel));
          const allPass = assertions.length > 0 && assertions.every(tr => tr.result === "PASS");
          const latency = (tc.testResults||[]).find(tr => tr.name === "output_latency_milliseconds");
          return { number: tc.testNumber, utterance: tc.inputs?.utterance, status: allPass ? "PASS" : "FAIL", latency: latency?.score || null };
        });
        const passed = tcResults.filter(t => t.status === "PASS").length;
        const avgLatency = tcResults.filter(t => t.latency).reduce((s,t,_,a) => s + t.latency/a.length, 0);
        // Extract runId from filename if not in JSON (format: AgentName-RunId-SuiteName-results.json)
        const runIdFromFile = (() => {
          const parts = f.replace(/-results\.json$/, '').split('-');
          const idx = parts.findIndex(p => /^4K[A-Za-z0-9]{13,}$/.test(p));
          return idx >= 0 ? parts[idx] : null;
        })();
        // Prioritize filename runId — Salesforce sometimes writes wrong runId inside JSON
        const runId = runIdFromFile || r.runId;
        return {
          file: f, runId, startTime: r.startTime, status: r.status,
          passed, total: tcs.length, passRate: tcs.length > 0 ? Math.round(passed/tcs.length*100) : 0,
          avgLatency: Math.round(avgLatency), tcResults,
          fixLoop: fixByRunId[runId] || null
        };
      } catch(_) { return { file: f, error: true }; }
    }).reverse(); // newest first
    res.json({ ok: true, runs });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /history/report?agent=X&suite=Y&file=Z — get raw results JSON for a run
app.get("/history/report", (req, res) => {
  const { agent, suite, file } = req.query;
  if (!agent || !suite || !file) return res.status(400).json({ ok: false, error: "agent, suite, file required" });
  const safe = path.basename(file);
  const filePath = path.join(FORMAL_TESTS_DIR, agent, suite, "Results", safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: "File not found" });
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json({ ok: true, data });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`✓ Server ready → http://localhost:${PORT}\n  Open your React app and it will connect automatically.\n`)
);
