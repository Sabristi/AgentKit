# ⚡ AgentKit — Designed for TDAD

> **Test-Driven Agent Development for Salesforce Agentforce**  
> A local web app that guides you through the full 7-stage TDAD pipeline — from agent spec to production deployment — powered by Claude AI, connected directly to your Salesforce DX project.

<img width="1550" height="900" alt="image" src="https://github.com/user-attachments/assets/77c38e75-427f-4e63-a5ed-48c497d1b928" />


> **Version:** `v1.0.0-beta`

---

## Table of Contents

- [What is AgentKit?](#what-is-agentkit)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the app](#running-the-app)
- [The 7-Stage Pipeline](#the-7-stage-pipeline)
  - [Stage 01 — Agent Spec](#stage-01--agent-spec)
  - [Stage 02 — Authoring](#stage-02--authoring)
  - [Stage 03 — Validation](#stage-03--validation)
  - [Stage 03.5 — Local Test](#stage-035--local-test)
  - [Stage 04 — Deployment](#stage-04--deployment)
  - [Stage 05 — Formal Test](#stage-05--formal-test)
  - [Stage 06 — Observability](#stage-06--observability)
  - [Stage 07 — Production](#stage-07--production)
- [Salesforce DX reference](#salesforce-dx-reference)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

---

## What is AgentKit?

AgentKit is a local UI for **Test-Driven Agent Development (TDAD)** on Salesforce Agentforce. It covers the full lifecycle from spec to production across 7 stages.

Instead of juggling CLI commands, YAML files, and terminal windows, AgentKit gives you:

<img width="1910" height="124" alt="image" src="https://github.com/user-attachments/assets/e4072b5b-91fe-490d-b743-298c6b9a68dc" />


- 📋 **Stage 01 — Generate `agentSpec.yaml`** via AI or CLI, edit inline, save to project
- ✍️ **Stage 02 — Author your `.agent` script** via CLI command or Agent Skill prompt for Claude Code
- ✅ **Stage 03 — Validate** your agent with `sf agent validate`
- 🧪 **Stage 03.5 — Local Test** with `sf agent preview` — send utterances, collect traces, analyze routing and actions without deploying
- 🚀 **Stage 04 — Deploy** to your dev org with publish + activate commands
- 🎯 **Stage 05 — Formal Test** — generate `testSpec.yaml` (via AI, CLI, or Gherkin), run tests, track fix loops, and visualize pass rate history
- 📊 **Stage 06 — Observability** — STDM analysis with `sf agent analyze`
- 🏭 **Stage 07 — Production** — staging + production deployment pipeline with all commands ready to copy

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
         ├── POST /ai                  ──▶  Anthropic API  (Claude)
         ├── POST /files/save          ──▶  SFDX project / specs/ or tests/
         ├── GET  /files/specs         ◀──  lists saved YAML specs
         ├── GET  /files/agents        ◀──  lists .agent files in project
         ├── GET  /files/tests         ◀──  lists testSpec YAML files
         ├── GET  /files/aievals       ◀──  lists AiEvaluationDefinition XMLs
         ├── GET  /files/formal-tests  ◀──  structured test history
         ├── GET  /history/runs        ◀──  runs + fix loops per suite
         ├── GET  /history/report      ◀──  raw results JSON for a run
         ├── GET  /sf/run?cmd=...      ──▶  sf CLI (streamed via SSE)
         └── GET  /status              ◀──  project health + org detection
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
│   ├── App.jsx          ← agentforce-tdad.jsx  (rename it)
│   └── main.jsx
├── tdad-server.js       ← at project root
├── vite.config.js       ← replace the default one
├── .env                 ← create from .env.example (see below)
└── .env.example         ← template (safe to commit)
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
      "/ai":       "http://localhost:3001",
      "/files":    "http://localhost:3001",
      "/sf":       "http://localhost:3001",
      "/status":   "http://localhost:3001",
      "/history":  "http://localhost:3001",
      "/preview":  "http://localhost:3001",
    },
  },
});
```

> ⚠️ The proxy is required. Without it, the browser cannot reach the Express server.  
> ⚠️ Always restart Vite after changing `vite.config.js` — it is only read at startup.

### `.env`

Create your config file from the template:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Your Anthropic API key (required)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Absolute path to your Salesforce DX project (required)
SF_PROJECT_PATH=/Users/yourname/Projects/my-sfdx-project

# Default org alias used in generated sf CLI commands (optional)
TARGET_ORG=my-dev-org

# Server port (optional, default: 3001)
PORT=3001
```

> ⚠️ **Never commit `.env`** — it contains your API key. It is excluded by `.gitignore`.

#### Watch out: shell environment conflicts

If `ANTHROPIC_API_KEY` is already defined in your shell profile (`~/.zshrc`, `~/.bashrc`, etc.), it may override the value in `.env`. Check with:

```bash
grep "ANTHROPIC_API_KEY" ~/.zshrc ~/.zprofile ~/.bashrc ~/.bash_profile 2>/dev/null
```

If found, remove that line from your shell profile, then restart the server.

---

## Running the app

AgentKit requires **two terminals** running simultaneously.

**Terminal 1 — Start the Express server:**

```bash
node tdad-server.js
# or with explicit project path:
node tdad-server.js --project /path/to/sfdx-project
```

Expected output:

```
⚡  TDAD Local Server
──────────────────────────────────────────────
  Project    : /Users/yourname/Projects/my-sfdx-project
  Specs dir  : /Users/yourname/Projects/my-sfdx-project/specs
  Target org : my-dev-org  (detected from .sf/config.json)
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

The header confirms the connection: `● <project_name> · Project connected · N specs`

---

## The 7-Stage Pipeline

### Stage 01 — Agent Spec

Generate or edit the `agentSpec.yaml` that defines your agent's role, tone, and topics.

<img width="1910" height="917" alt="image" src="https://github.com/user-attachments/assets/204d667f-c5b2-44b1-9aff-a0c73b25ae49" />


**Via AI** — fill in the form (agent type, company, role, tone, max topics) and let Claude generate the YAML. Refine iteratively with natural language instructions.

**Via CLI Command** — generates the full `sf agent generate agent-spec` command with all flags pre-filled. Run it directly from the UI with live output.

**Edit Spec** — paste an existing YAML or pick a file from your `specs/` folder to load and edit it.

```bash
# Generated command example:
sf agent generate agent-spec \
  --type customer \
  --role "Handles booking info and cancellations" \
  --company-name "SkyBlue Airlines" \
  --tone casual \
  --max-topics 3 \
  --output-file specs/skyblue-spec.yaml
```

---

### Stage 02 — Authoring

Create the `.agent` script from your spec.

<img width="1910" height="917" alt="image" src="https://github.com/user-attachments/assets/ac335368-7bfd-48a6-8244-45b69d730aa6" />


**Via CLI Command** — generates `sf agent generate authoring-bundle` with bundle name, API name, and target org pre-filled.

**Via Agent Skill** — generates a ready-to-paste prompt for Claude Code (or any AI coding agent with MCP skill support) using the `sf-ai-agentscript` skill. The AI agent authors the full `.agent` file autonomously.

```bash
# Generated command example:
sf agent generate authoring-bundle \
  --spec specs/skyblue-spec.yaml \
  --name "SkyBlue Airlines Service Agent" \
  --api-name SkyBlueAirlinesServiceAgent \
  --target-org my-dev-org
```

---

### Stage 03 — Validation

Validate your `.agent` file before deploying.

<img width="1910" height="917" alt="image" src="https://github.com/user-attachments/assets/84e995d6-68f4-4c07-81c2-e008076dbe90" />


Select your `.agent` file, enter the Agent API name (auto-detected), and run:

```bash
sf agent validate --agent-api-name SkyBlueAirlinesServiceAgent --target-org my-dev-org
```

---

### Stage 03.5 — Local Test

Smoke test your agent locally **without deploying** using `sf agent preview`.

<img width="1910" height="917" alt="image" src="https://github.com/user-attachments/assets/56df8eb2-9c3a-4457-8335-4f89d996dc1d" />
<img width="1010" height="474" alt="image" src="https://github.com/user-attachments/assets/a8560eb2-4fb6-4112-83a8-7194906c001c" />


1. Select your `.agent` file and target org
2. **Step 1** — Start a preview session (generates `SESSION_ID`)
3. **Step 2** — Add utterances and send them one by one
4. **Step 3** — End the session and collect trace files
5. **Trace Analysis** — automatically parses trace JSON files and displays per-utterance:
   - Topic routing (TransitionStep)
   - Actions invoked
   - Tools visible to planner
   - Agent response
   - Grounding category, safety score, latency

```bash
sf agent preview start --bundle-name SkyBlueAirlinesServiceAgent --target-org my-dev-org
sf agent preview send --bundle-name SkyBlueAirlinesServiceAgent --session-id "$SESSION_ID" \
  --utterance "I want to cancel my flight" --target-org my-dev-org
sf agent preview end --bundle-name SkyBlueAirlinesServiceAgent --session-id "$SESSION_ID" \
  --target-org my-dev-org
```

---

### Stage 04 — Deployment

Publish and activate your agent in the dev org.

<img width="1914" height="919" alt="image" src="https://github.com/user-attachments/assets/0749f935-704d-43aa-a9e7-37ff4582658d" />

```bash
sf agent publish authoring-bundle --api-name SkyBlueAirlinesServiceAgent --target-org my-dev-org
sf agent activate --api-name SkyBlueAirlinesServiceAgent --target-org my-dev-org
```

Both commands are runnable directly from the UI with live streaming output.

---

### Stage 05 — Formal Test

The most comprehensive stage. Four tabs:

#### Test Spec

Generate a `testSpec.yaml` for your agent. Three modes:

<img width="1914" height="919" alt="image" src="https://github.com/user-attachments/assets/72e25c14-06e3-4b96-a3a6-dca5bd2fe426" />


**Via CLI Command** — interactive `sf agent generate test-spec` (prompts for test cases in terminal).

**Via AI** — select topics, set tests per topic, pick metrics, and let Claude generate structured test cases with `expectedTopic`, `expectedActions`, and `expectedOutcome`.

**Via Gherkin (AI)** — paste a `Given / When / Then` scenario to convert it to a test case.

#### Run Test

Configure and run formal tests:

<img width="1914" height="919" alt="image" src="https://github.com/user-attachments/assets/2e70c85f-407a-4e99-97e0-ed783dc3c931" />

- Select `.agent` file and `testSpec.yaml`
- Choose target org (auto-detected or override)
- Select wait mode: async (get job ID) or sync (wait up to N minutes)
- Run `sf agent test create` then `sf agent test run`
- Fetch results by job ID with `sf agent test results`

#### Test & Fix

Generate a prompt for the `sf-ai-agentforce-testing` Agent Skill — a full autonomous test-fix-deploy cycle powered by Claude Code. The AI agent runs tests, diagnoses failures, applies fixes, and retries up to 3 times.

<img width="1914" height="919" alt="image" src="https://github.com/user-attachments/assets/9f3cb479-8e16-48f7-82e4-7eae17c75eb3" />


#### Testing History

Visual history of all test runs for each agent and test suite, stored in `formal-tests/`:

<img width="1914" height="919" alt="image" src="https://github.com/user-attachments/assets/6f2d0d6b-5aa1-448b-9ce8-430311fe7069" />
<img width="1914" height="919" alt="image" src="https://github.com/user-attachments/assets/94e60067-8565-4b63-afd2-16863b7e7b6b" />
<img width="1914" height="919" alt="image" src="https://github.com/user-attachments/assets/43af85ff-1350-4a68-a96f-efc1bf476a59" />
<img width="1914" height="919" alt="image" src="https://github.com/user-attachments/assets/d30caf23-2e82-467f-972b-b5479ae07c0f" />


```
formal-tests/
└── SkyBlueAgent/
    └── SkyBlueAgent_General-testSpec/
        ├── Results/
        │   ├── SkyBlueAgent-{RunId}-...-results.json
        │   └── ...
        └── FixLoop/
            ├── SkyBlueAgent-{RunId}-...-fix.json
            └── ...
```

The history table shows:
- **Pass rate** per run with color coding (green ≥ 80%, amber ≥ 50%, red below)
- **Average latency** per run
- **Δ vs previous** — improvement or regression since last run
- **Fix loop rows** — expandable between runs showing files changed and field-level diffs
- **Detailed view** — per test case results with topic, actions, outcome, and metric scores

#### Fix loop JSON format

```json
{
  "schema_version": "1.0",
  "iteration": 2,
  "agent": "SkyBlueAgent",
  "date": "2026-03-15",
  "triggered_by_run_id": "4KBg80000000BoHGAU",
  "issues": [
    {
      "test_id": "TC2",
      "assertion": "actions_assertion",
      "status": "FAIL",
      "category": "TEST_SPEC_CORRECTION",
      "agent_behavior_correct": true,
      "description": "...",
      "root_cause": "..."
    }
  ],
  "changes": [
    {
      "file": "tests/SkyBlueAgent_General-testSpec.yaml",
      "type": "MODIFIED",
      "description": "...",
      "details": [
        { "field": "TC2.expectedActions", "old_value": "['go_booking_info']", "new_value": "[]" }
      ]
    }
  ],
  "expected_outcome": "TC2 fully resolved. Projected: 15/15 = 100%.",
  "result": null
}
```

---

### Stage 06 — Observability

Analyze your agent's behavior using Salesforce's STDM (Structured Test Data Model).

```bash
sf agent analyze --agent-api-name SkyBlueAirlinesServiceAgent --target-org my-dev-org
```

---

### Stage 07 — Production

Full staging → production deployment pipeline with all commands pre-filled and ready to copy:

**Staging:**
```bash
sf agent publish authoring-bundle --api-name SkyBlueAirlinesServiceAgent --target-org skyblue-staging
sf agent activate --api-name SkyBlueAirlinesServiceAgent --target-org skyblue-staging
sf agent test run --name SkyBlueAirlinesServiceAgentTest --wait 10 --target-org skyblue-staging
```

**Production:**
```bash
sf agent publish authoring-bundle --api-name SkyBlueAirlinesServiceAgent --target-org skyblue-prod
sf agent activate --api-name SkyBlueAirlinesServiceAgent --target-org skyblue-prod
```

---

## Salesforce DX reference

### Valid agentSpec values

| Field | Required | Valid values |
|-------|----------|-------------|
| `agentType` | ✅ | `customer` or `internal` **only** |
| `tone` | ✅ | `casual`, `formal`, or `neutral` **only** |
| `subjectType` | ✅ (testSpec) | `AGENT` **only** |

### Metrics

| Metric ID | What it measures |
|-----------|-----------------|
| `coherence` | Response is logically consistent and easy to read |
| `completeness` | All aspects of the request are addressed |
| `conciseness` | Response is appropriately brief |
| `output_latency_milliseconds` | Response time in milliseconds |
| `instruction_following` | Agent follows its reasoning instructions (API/CLI only) |
| `factuality` | Response is factually accurate (API/CLI only) |

> ⚠️ Use `output_latency_milliseconds` exactly — not `latency`. Wrong metric IDs are silently ignored by Salesforce.

### Fix loop failure categories

| Category | Meaning | Fix |
|----------|---------|-----|
| `TOPIC_NOT_MATCHED` | Agent routed to wrong topic | Improve topic description wording |
| `ACTION_NOT_INVOKED` | Expected action not called | Improve action description |
| `WRONG_ACTION_SELECTED` | Wrong action called | Differentiate action descriptions |
| `ACTION_INVOCATION_FAILED` | Action called but failed | Fix Flow or Apex logic |
| `TEST_SPEC_CORRECTION` | Spec was wrong, agent was correct | Update expectedTopic/expectedActions |
| `TEST_SPEC_IMPROVEMENT` | Spec needs enrichment (data, context) | Add org data or conversationHistory |
| `INFORMATIONAL` | Known metric false-negative | No change required |

### Official documentation

- [Agent Spec reference](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-reference.html)
- [Test Spec reference](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html)
- [Test metrics](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html)
- [Run agent tests](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-run.html)
- [Agent preview](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-preview.html)

---

## Troubleshooting

### 🔴 "Server offline" in the header
The Express server isn't running. Start it: `node tdad-server.js`

### ❌ AI generation fails — "invalid x-api-key"
A system environment variable is overriding your `.env` key.  
Run `grep "ANTHROPIC_API_KEY" ~/.zshrc ~/.zprofile` and remove the line if found.

### ❌ Topics not detected in `.agent` file
AgentKit looks for `topic <name>:` lines. Make sure your `.agent` file uses standard agentscript syntax.

### ❌ Files not found in picklist
- Check `SF_PROJECT_PATH` in `.env` points to your SFDX project root
- In the server terminal, confirm `Project : /your/path` at startup
- For AiEvaluationDefinition files, retrieve them first:
  ```bash
  sf project retrieve start --metadata AiEvaluationDefinition --target-org my-dev-org
  ```

### ❌ Run ID not showing in Testing History
- The server extracts Run IDs from filenames using pattern `4K[A-Za-z0-9]{13,}`
- Make sure your results files follow the naming convention: `{AgentName}-{RunId}-{SuiteName}-results.json`
- Salesforce sometimes writes incorrect `runId` inside the JSON — the server uses the filename as source of truth

### ❌ Fix loop not appearing between runs
- Check `triggered_by_run_id` in your fix JSON matches the exact Run ID of the run that triggered the fix
- Fix loops are displayed below the run they were triggered by (older run)

### ❌ Vite proxy not working — getting HTML instead of JSON
Restart Vite after changing `vite.config.js`: `Ctrl+C` then `npm run dev`

### ❌ Port 3001 already in use
Set `PORT=3002` in `.env` and update all proxy entries in `vite.config.js` to `http://localhost:3002`.

### ❌ `sf` commands fail — "not authenticated"
```bash
sf org login web --alias my-dev-org
```

### ❌ contextVariables in testSpec cause RETRY crash
Salesforce has a known bug where `contextVariables` in test cases trigger an `INTERNAL_SERVER_ERROR: RETRY` enum error. Remove all `contextVariables` from your test cases and embed context in `conversationHistory` instead.

---

## Security

| Concern | How AgentKit handles it |
|---------|------------------------|
| API key exposure | Key is server-side only — the browser never sees it |
| Shell injection | Only `sf agent` and `sf project deploy` commands are allowed |
| Path traversal | File writes are scoped to `specs/` and `tests/` only |
| Secrets in git | `.env` is in `.gitignore` by default |

```bash
# Verify before pushing:
cat .gitignore | grep .env
git ls-files | grep env   # .env should NOT appear
```

---

## Project structure

```
agentkit/
├── src/
│   ├── App.jsx              # React UI — all components (7 stages)
│   └── main.jsx             # Vite entry point
├── tdad-server.js           # Express server
├── vite.config.js           # Proxy config
├── package.json
├── index.html
├── .env                     # Your secrets — never commit
├── .env.example             # Safe template — commit this
└── README.md
```

---

## Changelog

### v1.0.0-beta
- Full 7-stage TDAD pipeline (Agent Spec → Production)
- Stage 03.5 Local Test with Trace Analysis panel
- Stage 05 Testing History with fix loop visualization
- Fix loop JSON format with field-level diffs
- Project name auto-detected from `sfdx-project.json`
- Run ID extraction from filename (tolerates Salesforce metadata bugs)
- Support for all Salesforce Run ID formats (`4K*`)

---

*Built with [Claude](https://anthropic.com) · Designed for [Salesforce Agentforce](https://www.salesforce.com/agentforce/) TDAD workflows*
