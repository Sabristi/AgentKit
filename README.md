# ⚡ AgentKit — Designed for TDAD

> **Test-Driven Agent Development for Salesforce Agentforce**  
> A local web app that generates, refines, and runs your `agentSpec.yaml` and `testSpec.yaml` — powered by Claude AI, connected directly to your Salesforce DX project.

---

## Table of Contents

- [What is AgentKit?](#what-is-agentkit)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the app](#running-the-app)
- [Usage guide](#usage-guide)
  - [Step 1 — Agent Spec](#step-1--agent-spec)
  - [Step 2 — Test Spec](#step-2--test-spec)
- [Salesforce DX reference](#salesforce-dx-reference)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

---

## What is AgentKit?

AgentKit is a two-step local UI for **Test-Driven Agent Development (TDAD)** on Salesforce Agentforce.

Instead of manually writing YAML files and running CLI commands, AgentKit lets you:

- 🤖 **Generate `agentSpec.yaml`** — describe your agent in plain language, Claude does the rest
- 🧪 **Generate `testSpec.yaml`** — from your `.agent` file, an `AiEvaluationDefinition` XML, or Gherkin scenarios
- 💾 **Save directly to your SFDX project** — files land exactly where `sf agent` expects them
- ▶ **Run `sf agent` commands** with live streaming output — no terminal needed
- 🔁 **Refine iteratively** — version history, undo, and inline refinement on every generated spec

Everything runs locally. Your API key never leaves your machine.

---

## Architecture

AgentKit uses a **React frontend + local Express server** pattern. The server acts as a secure proxy — your Anthropic API key stays server-side only.

```
Browser (React UI — Vite, port 5173)
         │
         │  HTTP / SSE
         ▼
Local Express server (port 3001)  ←── tdad-server.js
         │
         ├── POST /ai              ──▶  Anthropic API  (Claude)
         ├── POST /files/save      ──▶  SFDX project / specs/
         ├── GET  /files/specs     ◀──  lists saved YAML specs
         ├── GET  /files/agents    ◀──  lists .agent files in project
         ├── GET  /files/aievals   ◀──  lists AiEvaluationDefinition XMLs
         ├── GET  /sf/run?cmd=...  ──▶  sf CLI (streamed via SSE)
         └── GET  /status          ◀──  project health check
```

---

## Prerequisites

Before installing AgentKit, make sure you have:

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | v18 or higher | [nodejs.org](https://nodejs.org) |
| **Salesforce CLI** | latest | [Install guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_install_cli.htm) |
| **Anthropic API key** | — | [console.anthropic.com](https://console.anthropic.com) |
| **A Salesforce DX project** | — | `sf project generate -n my-project` |

Verify your setup:

```bash
node --version        # should print v18.x or higher
sf --version          # should print @salesforce/cli/...
```

---

## Installation

### 1. Create the Vite project

```bash
cd ~/Projects
npm create vite@latest agentkit -- --template react
cd agentkit
npm install
```

### 2. Install server dependencies

```bash
npm install express cors
```

### 3. Place the AgentKit files

Copy the files from this repo into your project:

```
agentkit/
├── src/
│   └── App.jsx          ← agentforce-tdad.jsx  (rename it)
├── tdad-server.js       ← at project root
├── vite.config.js       ← replace the default one
├── .env                 ← create from env.example (see below)
└── env.example          ← template (safe to commit)
```

### 4. Update `index.html`

Add full-width styles inside the `<head>` tag of `index.html`:

```html
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #root { width: 100%; min-height: 100vh; }
</style>
```

---

## Configuration

### `vite.config.js`

Replace the entire file with:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ai":     "http://localhost:3001",
      "/files":  "http://localhost:3001",
      "/sf":     "http://localhost:3001",
      "/status": "http://localhost:3001",
    },
  },
});
```

> ⚠️ The proxy is required. Without it, the browser cannot reach the Express server.  
> ⚠️ Always restart Vite after changing `vite.config.js` — it is only read at startup.

### `.env`

Create your config file from the template:

```bash
cp env.example .env
```

Edit `.env` with your values:

```env
# Your Anthropic API key (required)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Absolute path to your Salesforce DX project (required)
# The server reads .agent and XML files from here, and writes YAML specs to <path>/specs/
SF_PROJECT_PATH=/Users/yourname/Projects/my-sfdx-project

# Default org alias used in generated sf CLI commands (optional, default: my-dev-org)
TARGET_ORG=my-dev-org

# Server port (optional, default: 3001)
PORT=3001
```

> ⚠️ **Never commit `.env`** — it contains your API key. It is excluded by `.gitignore`.

#### Watch out: shell environment conflicts

If `ANTHROPIC_API_KEY` is defined in your shell profile (`~/.zshrc`, `~/.bashrc`, etc.), it may override the value in `.env`. Check with:

```bash
grep "ANTHROPIC_API_KEY" ~/.zshrc ~/.zprofile ~/.bashrc ~/.bash_profile 2>/dev/null
```

If found, remove that line from your shell profile, then:

```bash
source ~/.zshrc
# Then restart: node tdad-server.js
```

---

## Running the app

AgentKit requires **two terminals** running simultaneously.

**Terminal 1 — Start the Express server:**

```bash
node tdad-server.js
```

Expected output:

```
⚡  TDAD Local Server
──────────────────────────────────────────────
  Project    : /Users/yourname/Projects/my-sfdx-project
  Specs dir  : /Users/yourname/Projects/my-sfdx-project/specs
  Target org : my-dev-org
  Port       : 3001
  API key    : ✓ set
  sf CLI     : @salesforce/cli/2.x.x darwin-arm64 node-v20.x.x
──────────────────────────────────────────────

✓ Server ready → http://localhost:3001
```

**Terminal 2 — Start the React app:**

```bash
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

The green pill in the header confirms everything is connected: `● Project connected · N specs`

---

## Usage guide

### Step 1 — Agent Spec

Generate an `agentSpec.yaml` for your Agentforce agent.

#### Option A — Generate with AI

1. Select **Agent Type**: `customer` (external-facing) or `internal` (employee-facing)
2. Fill in **Company Name**, **Company Description**, and **Role**
3. Select **Tone**: `casual`, `formal`, or `neutral`
4. Set **Max Topics** (default: 5)
5. Optionally fill in **Agent User**, **Prompt Template Name**, **Grounding Context**
6. Click **⚡ Generate agentSpec.yaml**

#### Option B — Paste YAML

Click **📋 Paste YAML** and paste an existing `agentSpec.yaml` to load it into the editor.

#### Option C — Pick from project

Click **📁 Pick from project** to load a previously saved spec from your `specs/` folder.

#### Refining the output

- Type a refinement instruction in the box at the bottom: e.g. `"Add a billing topic"`, `"Make tone more formal"`, `"Split topic 3 into two"`
- Click **↩ Undo** to revert to the previous version
- Version number is displayed as `v2`, `v3`, etc.

#### Saving and deploying

1. Click **💾 Save to project** — writes to `{SF_PROJECT_PATH}/specs/agentSpec.yaml`
2. Switch to the **CLI Pipeline** tab
3. Click **▶ Run** on each step:

```bash
# Step 1 — Generate via Salesforce API
sf agent generate agent-spec --type customer --role "..." ...

# Step 2 — Create the authoring bundle
sf agent generate authoring-bundle --spec specs/agentSpec.yaml --target-org my-dev-org

# Step 3 — Deploy to org
sf project deploy start --source-dir force-app/main/default/aiAuthoringBundles --target-org my-dev-org
```

---

### Step 2 — Test Spec

Generate a `testSpec.yaml` for your agent. Three modes are available.

---

#### Mode A — New from `.agent` file

1. Select your `.agent` file from the picklist — AgentKit scans your SFDX project automatically
2. **Select topics to test** — pills are detected from your `.agent` file. Toggle to include/exclude. At least one required.
3. **Set tests per topic** — pick 1, 2, 3, 5, or enter a custom number (max 10)
4. **Select metrics**: Coherence, Completeness, Conciseness, Latency, Instruction Adherence, Factuality
5. Click **✨ Generate N test cases (X topics × Y)**

---

#### Mode B — From AiEvaluationDefinition XML

Convert an existing `AiEvaluationDefinition` metadata XML into a `testSpec.yaml`.

**Recommended — native CLI:**

```bash
sf agent generate test-spec \
  --from-definition force-app/main/default/aiEvaluationDefinitions/MyAgent.aiEvaluationDefinition-meta.xml \
  --output-file specs/MyAgent-testSpec.yaml
```

This command is also available as a runnable block inside AgentKit.

**Alternative — AI conversion:**

1. Pick an XML file from the picklist, or paste the content via **📋 Paste XML**
2. Click **🤖 Convert to testSpec.yaml with AI**

If your `.aiEvaluationDefinition-meta.xml` files don't exist locally, retrieve them first:

```bash
sf project retrieve start --metadata AiEvaluationDefinition --target-org my-dev-org
```

---

#### Mode C — Append to existing spec

1. Select an existing `testSpec.yaml` from the picklist
2. Choose append method:
   - **🤖 Via `.agent` file** — AI generates additional cases for topics not yet covered
   - **🥒 Via Gherkin** — paste a `Given / When / Then` scenario to convert it to a test case
3. Click **➕ Append test cases**

---

#### Running the test pipeline

Once your spec is saved, use the **CLI Pipeline** tab:

```bash
# 1. Generate via Salesforce API (alternative to AI generation)
sf agent generate test-spec --agent-api-name MyAgent --target-org my-dev-org

# 2. Preview before creating
sf agent test create --spec specs/MyAgent-testSpec.yaml --preview --target-org my-dev-org

# 3. Create the test in your org
sf agent test create --spec specs/MyAgent-testSpec.yaml --target-org my-dev-org

# 4. Run and wait for results (sync, 10 min timeout)
sf agent test run --name MyAgentTest --wait 10 --target-org my-dev-org

# 5. Get results
sf agent test results --job-id <JOB_ID> --target-org my-dev-org
```

Every command has a **▶ Run** button with live streamed output.

---

## Salesforce DX reference

### Valid agentSpec values

| Field | Required | Valid values |
|-------|----------|-------------|
| `agentType` | ✅ | `customer` or `internal` **only** |
| `tone` | ✅ | `casual`, `formal`, or `neutral` **only** |
| `subjectType` | ✅ (testSpec) | `AGENT` **only** |

### Metrics

| Metric | What it measures |
|--------|-----------------|
| `coherence` | Response is logically consistent |
| `completeness` | All aspects of the request are addressed |
| `conciseness` | Response is appropriately brief |
| `latency` | Response time in milliseconds |
| `instruction_adherence` | Agent follows its system prompt instructions |
| `factuality` | Response is factually accurate |

### Official documentation

- [Agent Spec reference](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-reference.html)
- [Test Spec reference](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html)
- [Test metrics](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html)
- [Create and run tests](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-create.html)

---

## Troubleshooting

### 🔴 "Server offline" in the header
The Express server isn't running. Start it: `node tdad-server.js`

### ❌ AI generation fails — "invalid x-api-key"
A system environment variable is overriding your `.env` key.  
Run `grep "ANTHROPIC_API_KEY" ~/.zshrc ~/.zprofile` and remove the line if found.

### ❌ Topics not detected in `.agent` file
AgentKit looks for `topic <name>:` lines. Open an issue with your file structure.

### ❌ Files not found in picklist (`/files/aievals`, `/files/agents`)
- Check `SF_PROJECT_PATH` in `.env` points to your SFDX project root
- In the server terminal, look for `Project : /your/path` at startup
- For AiEvaluationDefinition files, retrieve them first: `sf project retrieve start --metadata AiEvaluationDefinition --target-org my-dev-org`

### ❌ Vite proxy not working — getting HTML instead of JSON
Restart Vite after changing `vite.config.js`: `Ctrl+C` then `npm run dev`

### ❌ Port 3001 already in use
Set `PORT=3002` in `.env` and update all four proxy entries in `vite.config.js` to `http://localhost:3002`.

### ❌ `sf` commands fail — "not authenticated"
```bash
sf org login web --alias my-dev-org
```

---

## Security

| Concern | How AgentKit handles it |
|---------|------------------------|
| API key exposure | Key is server-side only — the browser never sees it |
| Shell injection | Only `sf agent` and `sf project deploy` commands are allowed — no arbitrary execution |
| Path traversal | YAML writes are scoped to `specs/` only |
| Secrets in git | `.env` is in `.gitignore` by default |

```bash
# Verify before pushing:
cat .gitignore | grep .env
git status   # .env should NOT appear
```

---

## Project structure

```
agentkit/
├── src/
│   ├── App.jsx              # React UI — all components
│   └── main.jsx             # Vite entry point
├── tdad-server.js           # Express server
├── vite.config.js           # Proxy config
├── package.json
├── index.html               # Add full-width styles here
├── .env                     # Your secrets — never commit
├── env.example              # Safe template
└── README.md
```

---

*Built with [Claude](https://anthropic.com) · Designed for [Salesforce Agentforce](https://www.salesforce.com/agentforce/) TDAD workflows*
