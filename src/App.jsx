import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Local server ──────────────────────────────────────────────────────────────
const API = "http://localhost:3001";

// ── Constants ─────────────────────────────────────────────────────────────────
const AGENT_TYPES = [
  { value: "customer", label: "Customer-facing" },
  { value: "internal", label: "Internal (employees)" },
];
const TONES = ["casual", "formal", "neutral"];
const METRICS = [
  { id: "coherence",             label: "Coherence",             desc: "Response is easy to understand, no grammatical errors" },
  { id: "completeness",          label: "Completeness",          desc: "Response includes all essential information" },
  { id: "conciseness",           label: "Conciseness",           desc: "Response is brief but comprehensive" },
  { id: "latency",               label: "Latency",               desc: "Latency in ms from request to response" },
  { id: "instruction_adherence", label: "Instruction Adherence", desc: "How well responses follow topic instructions" },
  { id: "factuality",            label: "Factuality",            desc: "How factual the response is" },
];

// ── Salesforce Lightning Design Tokens ───────────────────────────────────────
const C = {
  bg:          "#010409",
  surface:     "#0d1117",
  surfaceAlt:  "#161b22",
  border:      "#30363d",
  borderFocus: "#388bfd",
  text:        "#e6edf3",
  textWeak:    "#8b949e",
  textWeaker:  "#484f58",
  brand:       "#1f6feb",
  brandDark:   "#1158c7",
  brandLight:  "#0d2149",
  gold:        "#e3b341",
  goldBg:      "#2d1f00",
  success:     "#3fb950",
  successBg:   "#0d2a14",
  warning:     "#d29922",
  warningBg:   "#2b2000",
  error:       "#f85149",
  errorBg:     "#2d1010",
  shadow:      "0 2px 8px rgba(0,0,0,0.4)",
  shadowMd:    "0 4px 16px rgba(0,0,0,0.5)",
  radius:      "6px",
  radiusMd:    "10px",
};

// ── AI Prompts ────────────────────────────────────────────────────────────────
// Official reference: https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-reference.html
//
// agentSpec required: agentType, companyName, companyDescription, role, topics
// agentSpec optional: maxNumOfTopics (default 5), agentUser, enrichLogs (default false),
//                     tone (casual|formal|neutral, default casual),
//                     promptTemplateName, groundingContext
// agentType valid values: "customer" | "internal" ONLY
// tone valid values: "casual" | "formal" | "neutral" ONLY
//
// testSpec required: name, subjectType (AGENT), subjectName, testCases
// testSpec optional: description, subjectVersion
// testCase required: utterance, expectedTopic, expectedActions, expectedOutcome
// testCase optional: contextVariables, customEvaluations, conversationHistory, metrics

const AGENT_SPEC_PROMPT = `You are an expert Salesforce Agentforce architect. Generate a valid agentSpec.yaml.
Reference: https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-reference.html

EXACT YAML structure (all fields from official reference):
agentType: <"customer" or "internal" ONLY — no other values>
companyName: <company name>
companyDescription: <natural language description of the company>
role: <natural language description of agent role and tasks>
tone: <"casual", "formal", or "neutral" ONLY>
maxNumOfTopics: <EXACT integer provided — no more, no less>
enrichLogs: false
topics:
  - name: <PascalCase, no spaces — e.g. OrderTracking, EmployeeScheduling>
    description: <specific description, hint at which Salesforce actions to use>

OPTIONAL fields to include if relevant (from official reference):
# agentUser: <username@org.com>           — assigns agent to a user in the org
# promptTemplateName: <ApiName>           — custom prompt template API name
# groundingContext: <context string>      — context added to prompts with custom template

CRITICAL RULES:
- agentType MUST be "customer" or "internal" — never "customer_facing", "sales", "service", etc.
- tone MUST be "casual", "formal", or "neutral" — no other values
- Generate EXACTLY maxNumOfTopics topic blocks — hard constraint
- Topic names: PascalCase, no spaces, descriptive (e.g. OrderTracking not Order_Tracking)
- Topics must be distinct and non-overlapping
- Output ONLY valid YAML, no markdown fences, start with "agentType:"`;

const AGENT_SPEC_REFINE_PROMPT = `You are an expert Salesforce Agentforce architect. Refine an existing agentSpec.yaml.
Reference: https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-reference.html
CRITICAL: agentType must be "customer" or "internal" ONLY. tone must be "casual", "formal", or "neutral" ONLY. Preserve maxNumOfTopics count exactly.
Output ONLY the complete updated YAML. No markdown fences. Start with "agentType:".`;

// Full testSpec structure reference (from official Salesforce docs):
// https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html
// https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html
//
// COMPLETE testCase structure:
//   utterance         (required) - natural language user input
//   expectedTopic     (required) - topic API name (GenAiPlugin)
//   expectedActions   (required) - action API names (GenAiFunction)
//   expectedOutcome   (required) - natural language expected result
//   contextVariables  (optional) - Service agent context vars (MessagingSession fields)
//     - name: EndUserLanguage
//       value: Spanish
//   customEvaluations (optional) - test response for specific strings/numbers
//     - label: "Check order ID in response"
//       JSONPath: "$.actions[?(@.name=='GetOrder')].output.orderId"
//       operator: equals  # equals | notEquals | greaterThan | greaterThanOrEquals | lessThan | lessThanOrEquals | contains
//       expectedValue: "12345"
//   conversationHistory (optional) - multi-turn context
//     - role: user    # user | agent
//       message: "Hi I need help with my order"
//     - role: agent
//       message: "Sure! What's your order number?"
//       topic: OrderManagement   # required when role is agent
//   metrics (optional but recommended) - inside each testCase
//     - name: coherence | completeness | conciseness | latency | instruction_adherence | factuality

const TEST_FROM_AGENT_PROMPT = `You are an expert Salesforce Agentforce QA engineer. Generate a complete, production-quality testSpec.yaml from an Agent Script (.agent) file.

References:
- https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html
- https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html

The .agent file contains topics, actions, instructions, variables, and config.

Generate test cases following this COMPLETE structure:

name: <Human readable test suite name>
description: <purpose of this test suite>
subjectType: AGENT
subjectName: <agent developer_name from .agent file config section, or filename without extension>
# subjectVersion: v1   # optional — omit to use latest active version
testCases:
  # Happy path test case
  - utterance: <realistic natural language user input>
    expectedTopic: <topic API name EXACTLY as in the .agent file>
    expectedActions:
      - <action API name from the .agent file>
    expectedOutcome: <natural language description of expected agent response>
    contextVariables: []
    customEvaluations: []
    conversationHistory: []
    metrics:
      <selected metrics here>

  # Edge/error case with conversation history for multi-turn context
  - utterance: <edge case or error scenario>
    expectedTopic: <topic API name>
    expectedActions:
      - <action API name>
    expectedOutcome: <expected error handling or fallback response>
    contextVariables: []
    customEvaluations:
      - label: "<descriptive label>"
        JSONPath: "<JSONPath to action output field>"
        operator: contains
        expectedValue: "<expected substring>"
    conversationHistory:
      - role: user
        message: "<prior user message providing context>"
      - role: agent
        message: "<prior agent response>"
        topic: <topic API name used>
    metrics:
      <selected metrics here>

RULES:
- subjectType MUST be "AGENT" — never change this
- Generate 2 test cases per topic: 1 happy path + 1 edge/error case
- Topics and actions MUST come from the actual .agent file content
- customEvaluations: add at least one per edge case test with a realistic JSONPath
- conversationHistory: add to multi-turn scenarios where prior context matters
- contextVariables: add if agent has messaging/service context (EndUserLanguage, etc.)
- metrics: only include the ones from the provided selection
- Output ONLY valid YAML, no markdown fences, start with "name:"`;

const TEST_APPEND_FROM_AGENT_PROMPT = `You are an expert Salesforce Agentforce QA engineer. Append new test cases to an existing testSpec.yaml, based on an Agent Script (.agent) file.

References:
- https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html
- https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html

Return ONLY the complete updated testSpec.yaml with the new test cases appended.
Do NOT change existing test cases.
New test cases must follow the full structure: utterance, expectedTopic, expectedActions, expectedOutcome, contextVariables, customEvaluations, conversationHistory, metrics.
Add at least one test with customEvaluations and one with conversationHistory.
Output ONLY valid YAML, no markdown fences, start with "name:".`;

const TEST_FROM_GHERKIN_PROMPT = `You are an expert Salesforce Agentforce QA engineer. Convert Gherkin BDD scenarios into a complete Agentforce testSpec.yaml.

References:
- https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html
- https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html

Gherkin mapping:
- "Given" → conversationHistory (prior context)
- "When the user says/asks..." → utterance
- "Then the agent should..." → expectedOutcome
- "And the response contains..." → customEvaluations with operator: contains

Output this EXACT YAML structure:
name: <Feature name + " Tests">
description: <summary of scenarios covered>
subjectType: AGENT
subjectName: <provided agent API name>
testCases:
  - utterance: <from "When" step>
    expectedTopic: <most relevant topic from provided list>
    expectedActions:
      - <PascalCase action name inferred from steps>
    expectedOutcome: <from "Then" steps>
    contextVariables: []
    customEvaluations:
      - label: "<from And/Then assertion>"
        JSONPath: "<inferred JSONPath to relevant action output>"
        operator: contains
        expectedValue: "<expected value>"
    conversationHistory:
      <from Given steps if any, as role/message pairs>
    metrics:
      <selected metrics here>

Output ONLY valid YAML, no markdown fences, start with "name:".`;

const TEST_APPEND_FROM_GHERKIN_PROMPT = `You are an expert Salesforce Agentforce QA engineer. Append new test cases from a Gherkin scenario to an existing testSpec.yaml.

References:
- https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html
- https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html

Return ONLY the complete updated testSpec.yaml with the new test cases appended.
Do NOT change existing test cases. Follow the exact same structure.
Gherkin mapping: "Given" → conversationHistory, "When" → utterance, "Then/And" → expectedOutcome + customEvaluations.
Output ONLY valid YAML, no markdown fences, start with "name:".`;

const TEST_FROM_AI_EVAL_PROMPT = `You are an expert Salesforce Agentforce QA engineer. Convert an AiEvaluationDefinition XML metadata file into a valid testSpec.yaml.

Reference: https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html

The AiEvaluationDefinition XML is the org metadata equivalent of the testSpec YAML.
Map fields as follows:
- AiEvaluationDefinition.name → testSpec.name
- AiEvaluationDefinition.description → testSpec.description
- subjectType: AGENT (always)
- AiEvaluationDefinition.subjectName → testSpec.subjectName
- Each AiEvaluationTestCase → testCases entry:
  - testCase.inputs.utterance → utterance
  - testCase.expectedActions → expectedActions
  - testCase.expectedTopic → expectedTopic
  - testCase.expectedOutcome → expectedOutcome
  - testCase.contextVariables → contextVariables (name/value pairs)
  - testCase.customEvaluations → customEvaluations (label/JSONPath/operator/expectedValue)
  - testCase.conversationHistory → conversationHistory (role/message/topic)
  - testCase.metrics → metrics

Output ONLY the complete valid testSpec YAML. No markdown fences. Start with "name:".`;

// ── Helpers ───────────────────────────────────────────────────────────────────
const parseTopics   = yaml => [...(yaml||"").matchAll(/- name:\s*(.+)/g)].map(m => m[1].trim());
// Parse topics from .agent file — supports Salesforce XML format and plain text
const parseAgentTopics = content => {
  if (!content) return [];
  const results = new Set();

  // Primary: YAML custom format  "topic booking_information:"  (your .agent format)
  for (const m of content.matchAll(/^topic\s+([A-Za-z0-9_]+)\s*:/gm)) results.add(m[1].trim());

  // Secondary: XML metadata format
  if (results.size === 0) {
    for (const m of content.matchAll(/<topicApiName>([^<]+)<\/topicApiName>/g)) results.add(m[1].trim());
    for (const m of content.matchAll(/<apiName>([^<]+)<\/apiName>/g)) results.add(m[1].trim());
  }

  // Tertiary: JSON
  if (results.size === 0)
    for (const m of content.matchAll(/"(?:apiName|topicApiName)":\s*"([A-Za-z0-9_]+)"/g)) results.add(m[1].trim());

  // Exclude non-topic keywords (entry points, farewell, etc.)
  const EXCLUDE = new Set(["farewell", "greet_and_route", "start_agent"]);
  return [...results].filter(t => t.length > 1 && !EXCLUDE.has(t));
};
const parseSubject  = yaml => (yaml?.match(/subjectName:\s*(.+)/)||[])[1]?.trim() || "";
const parseAgentDeveloperName = content =>
  (content?.match(/developer_name:\s*["']?([^"'\n]+)["']?/)||
   content?.match(/config:\s*\n\s+developer_name:\s*["']?([^"'\n]+)["']?/)||[])[1]?.trim() || "";

async function callAI(system, userMsg) {
  const res = await fetch(`${API}/ai`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userMsg }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Server error");
  return data.result || "";
}

async function fetchFiles(route, filterFn) {
  const r = await fetch(`${API}${route}`);
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch (_) { throw new Error(`Server error on ${route} — is tdad-server.js running?`); }
  if (!d.ok) throw new Error(d.error);
  return filterFn ? d.files.filter(filterFn) : d.files;
}
async function fetchSpecs(filterFn) { return fetchFiles("/files/specs", filterFn); }

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useServerStatus() {
  const [status, setStatus] = useState(null);
  const check = useCallback(async () => {
    try {
      const r = await fetch(`${API}/status`, { signal: AbortSignal.timeout(2000) });
      const d = await r.json();
      setStatus(d.ok ? d : false);
    } catch (_) { setStatus(false); }
  }, []);
  useEffect(() => { check(); const t = setInterval(check, 8000); return () => clearInterval(t); }, [check]);
  return { status, refresh: check };
}

function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return m;
}

// ── Design Components ─────────────────────────────────────────────────────────

function Card({ children, style = {} }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radiusMd, boxShadow: C.shadow, ...style }}>
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle, icon, action }) {
  return (
    <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {icon && <span style={{ fontSize: "18px" }}>{icon}</span>}
        <div>
          <div style={{ fontWeight: "700", fontSize: "14px", color: C.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: "12px", color: C.textWeak, marginTop: "1px" }}>{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "brand", size = "md", style = {} }) {
  const variants = {
    brand:   { bg: C.brand,    color: "#fff", border: C.brand,    hoverBg: C.brandDark },
    outline: { bg: "transparent", color: C.brand, border: C.brand, hoverBg: C.brandLight },
    neutral: { bg: C.surface,  color: C.text, border: C.border,   hoverBg: C.surfaceAlt },
    success: { bg: C.success,  color: "#fff", border: C.success,  hoverBg: "#1d6135" },
    danger:  { bg: C.error,    color: "#fff", border: C.error,    hoverBg: "#8e0312" },
  };
  const sizes = { sm: "6px 12px", md: "8px 16px", lg: "10px 20px" };
  const v = variants[variant];
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: v.bg, color: v.color, border: `1px solid ${v.border}`, padding: sizes[size],
               borderRadius: C.radius, fontSize: size === "sm" ? "12px" : "13px", fontWeight: "600",
               cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
               opacity: disabled ? 0.4 : 1, display: "inline-flex", alignItems: "center", gap: "6px",
               transition: "all 0.15s", ...style }}>
      {children}
    </button>
  );
}

function Badge({ children, color = "brand" }) {
  const colors = {
    brand:   { bg: C.brandLight,  text: C.brandDark },
    success: { bg: C.successBg,   text: C.success },
    warning: { bg: C.warningBg,   text: "#b75000" },
    error:   { bg: C.errorBg,     text: C.error },
    neutral: { bg: C.surfaceAlt,  text: C.textWeak },
  };
  const c = colors[color] || colors.brand;
  return (
    <span style={{ background: c.bg, color: c.text, padding: "2px 8px", borderRadius: "999px",
                   fontSize: "11px", fontWeight: "600", display: "inline-block" }}>
      {children}
    </span>
  );
}

function Alert({ type = "info", children }) {
  const map = {
    info:    { bg: C.brandLight,  border: C.brand,   color: C.text, icon: "ℹ️" },
    success: { bg: C.successBg,   border: C.success,  color: C.success,  icon: "✅" },
    warning: { bg: C.warningBg,   border: C.warning,  color: "#b75000",  icon: "⚠️" },
    error:   { bg: C.errorBg,     border: C.error,    color: C.error,    icon: "❌" },
  };
  const m = map[type];
  return (
    <div style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: C.radius,
                  padding: "10px 14px", fontSize: "13px", color: m.color,
                  display: "flex", gap: "8px", alignItems: "flex-start" }}>
      <span>{m.icon}</span><div>{children}</div>
    </div>
  );
}

const inputStyle = {
  width: "100%", background: C.surface, border: `1px solid ${C.border}`, color: C.text,
  padding: "8px 12px", borderRadius: C.radius, fontFamily: "inherit", fontSize: "13px",
  outline: "none", transition: "border-color 0.15s", boxSizing: "border-box",
};
const labelStyle = {
  color: C.textWeak, fontSize: "12px", fontWeight: "600", marginBottom: "5px",
  display: "block", textTransform: "uppercase", letterSpacing: "0.5px",
};

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label style={labelStyle}>{label}{required && <span style={{ color: C.error, marginLeft: "3px" }}>*</span>}</label>
      {children}
      {hint && <div style={{ fontSize: "11px", color: C.textWeak, marginTop: "3px" }}>{hint}</div>}
    </div>
  );
}

function Spinner({ size = 14 }) {
  return <span style={{ width: size, height: size, border: `2px solid ${C.brand}`, borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.6s linear infinite", flexShrink: 0 }} />;
}

// ── YAML Viewer ───────────────────────────────────────────────────────────────
function YamlViewer({ code, maxHeight = "400px" }) {
  if (!code) return null;
  const tokenize = line => {
    const t = line.trimStart();
    if (t.startsWith("#"))                    return "#888";
    if (t.startsWith("agentType:") || t.startsWith("subjectType:")) return "#d73a49";
    if (t.startsWith("name:") || t.startsWith("subjectName:"))      return "#e36209";
    if (t.startsWith("topics:") || t.startsWith("testCases:") || t.startsWith("metrics:")) return "#22863a";
    if (t.startsWith("- name:"))              return "#005cc5";
    if (t.startsWith("utterance:"))           return "#6f42c1";
    if (t.startsWith("expectedTopic:"))       return "#e36209";
    if (t.startsWith("expectedOutcome:") || t.startsWith("expectedActions:")) return "#22863a";
    if (t.startsWith("  - name: "))           return "#0070d2";
    if (t.match(/^  - [A-Z]/))                return "#005cc5";
    if (t.includes(":")) {
      const key = t.split(":")[0].trim();
      if (["companyName","companyDescription","role","tone","maxNumOfTopics","enrichLogs","description","customEvaluations","conversationHistory"].includes(key)) return "#6a737d";
    }
    return C.textWeak;
  };
  return (
    <div style={{ background: "#0d1117", border: `1px solid ${C.border}`, borderRadius: C.radius,
                  padding: "14px 16px", overflowY: "auto", maxHeight,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "12px", lineHeight: "1.8" }}>
      {code.split("\n").map((line, i) => (
        <div key={i} style={{ color: tokenize(line), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line || " "}</div>
      ))}
    </div>
  );
}

// ── Terminal Panel ────────────────────────────────────────────────────────────
function TerminalPanel({ cmd, serverOnline }) {
  const [lines, setLines]     = useState([]);
  const [running, setRunning] = useState(false);
  const [open, setOpen]       = useState(false);
  const bottomRef             = useRef(null);
  const esRef                 = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  const run = () => {
    if (!serverOnline || running) return;
    const cmdAfterSf = cmd.replace(/^sf\s+/, "").replace(/\\\n\s+/g, " ").trim();
    setLines([]); setOpen(true); setRunning(true);
    const es = new EventSource(`${API}/sf/run?cmd=${encodeURIComponent(cmdAfterSf)}`);
    esRef.current = es;
    es.onmessage = e => {
      try {
        const { type, text } = JSON.parse(e.data);
        setLines(l => [...l, { type, text }]);
        if (type === "done" || type === "error") { setRunning(false); es.close(); }
      } catch (_) {}
    };
    es.onerror = () => { setLines(l => [...l, { type: "error", text: "\n✗ Connection lost" }]); setRunning(false); es.close(); };
  };

  const typeColor = { stdout: C.text, stderr: "#b75000", info: C.textWeak, done: C.success, error: C.error };

  return (
    <div style={{ marginTop: "6px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <Btn size="sm" variant="success" onClick={run} disabled={!serverOnline || running}>
          {running ? <><Spinner size={10} /> Running…</> : "▶ Run"}
        </Btn>
        {running && <Btn size="sm" variant="danger" onClick={() => { esRef.current?.close(); setRunning(false); }}>■ Stop</Btn>}
        {lines.length > 0 && !running && (
          <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", color: C.brand, fontSize: "11px", cursor: "pointer", textDecoration: "underline" }}>
            {open ? "Hide output" : "Show output"}
          </button>
        )}
        {!serverOnline && <span style={{ fontSize: "11px", color: C.textWeak }}>Server offline</span>}
      </div>
      {open && lines.length > 0 && (
        <div style={{ marginTop: "8px", background: "#1e1e1e", borderRadius: C.radius, padding: "10px 14px",
                      maxHeight: "200px", overflowY: "auto", fontFamily: "monospace", fontSize: "11px", lineHeight: "1.7" }}>
          {lines.map((l, i) => <span key={i} style={{ color: typeColor[l.type]||"#ccc", whiteSpace: "pre-wrap" }}>{l.text}</span>)}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

// ── CLI Command Block ─────────────────────────────────────────────────────────
function CmdBlock({ label, cmd, note, serverOnline }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(cmd.replace(/\\\n\s+/g, " ")); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden", marginBottom: "8px" }}>
      <div style={{ padding: "6px 12px", background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "11px", fontWeight: "600", color: C.textWeak, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
        <button onClick={copy} style={{ background: "none", border: "none", color: copied ? C.success : C.brand, cursor: "pointer", fontSize: "11px", fontWeight: "600" }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div style={{ padding: "10px 14px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#79c0ff", background: "#0d1117", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "1.6" }}>{cmd}</div>
      {note && <div style={{ padding: "4px 12px 8px", fontSize: "11px", color: C.textWeak }}>{note}</div>}
      <div style={{ padding: "4px 12px 10px" }}><TerminalPanel cmd={cmd} serverOnline={serverOnline} /></div>
    </div>
  );
}

// ── Save Button ───────────────────────────────────────────────────────────────
function SaveBtn({ filename, content, serverOnline }) {
  const [state, setState] = useState("idle");
  const save = async () => {
    if (!serverOnline || !content) return;
    setState("saving");
    try {
      const r = await fetch(`${API}/files/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, content }) });
      const d = await r.json();
      setState(d.ok ? "saved" : "error");
      setTimeout(() => setState("idle"), 3000);
    } catch (_) { setState("error"); }
  };
  return (
    <Btn size="sm" variant={state === "saved" ? "success" : "outline"} onClick={save} disabled={state === "saving" || !serverOnline || !content}>
      {state === "saving" ? <><Spinner size={10} /> Saving…</> : state === "saved" ? "✓ Saved!" : state === "error" ? "✗ Error" : "💾 Save to project"}
    </Btn>
  );
}

// ── File Picker (picklist) ────────────────────────────────────────────────────
function FilePicker({ label, route = "/files/specs", filterFn, onSelect, selected, emptyMsg, serverOnline }) {
  const [files, setFiles]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const load = useCallback(async () => {
    if (!serverOnline) return;
    setLoading(true); setError("");
    try { setFiles(await fetchFiles(route, filterFn)); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }, [serverOnline, route, filterFn]);

  useEffect(() => { load(); }, [load]);

  if (!serverOnline) return <Alert type="warning">Server offline — start <code>tdad-server.js</code> to browse project files.</Alert>;

  const handleChange = e => {
    const f = files.find(f => f.name === e.target.value);
    if (f) onSelect(f);
  };

  const selectStyle = {
    ...inputStyle,
    cursor: "pointer",
    fontFamily: "monospace",
    paddingRight: "32px",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b949e' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <label style={labelStyle}>{label}</label>
        <button onClick={load} style={{ background: "none", border: "none", color: C.brand, fontSize: "11px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}>
          {loading ? <Spinner size={9} /> : "↻"} {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {!loading && !error && files.length === 0 ? (
        <div style={{ padding: "12px 14px", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: C.radius, color: C.textWeak, fontSize: "13px" }}>
          {emptyMsg || "No files found."}
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <select value={selected?.name || ""} onChange={handleChange} style={selectStyle} disabled={loading || files.length === 0}>
            <option value="" disabled>{loading ? "Loading files…" : `— select a file (${files.length}) —`}</option>
            {files.map(f => {
              const kb = (f.size / 1024).toFixed(1);
              const date = new Date(f.modified).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
              return <option key={f.name} value={f.name}>{f.name}  ·  {kb} KB  ·  {date}</option>;
            })}
          </select>
          {selected && (
            <div style={{ marginTop: "6px", padding: "8px 12px", background: C.brandLight, border: `1px solid ${C.brand}`, borderRadius: C.radius, display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: C.brand, fontSize: "12px" }}>✓</span>
              <span style={{ fontFamily: "monospace", fontSize: "12px", color: C.text, fontWeight: "600" }}>{selected.name}</span>
              <span style={{ fontSize: "11px", color: C.textWeak, marginLeft: "auto" }}>{(selected.size/1024).toFixed(1)} KB</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Metrics Selector ──────────────────────────────────────────────────────────
function MetricsSelector({ selected, onChange }) {
  const toggle = id => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {METRICS.map(m => {
        const on = selected.includes(m.id);
        return (
          <button key={m.id} onClick={() => toggle(m.id)} title={m.desc}
            style={{ padding: "5px 12px", borderRadius: "999px", border: `1px solid ${on ? C.brand : C.border}`,
                     background: on ? C.brandLight : C.surface, color: on ? C.brandDark : C.textWeak,
                     fontSize: "12px", fontWeight: "600", cursor: "pointer", transition: "all 0.15s" }}>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ── YAML Output Panel ─────────────────────────────────────────────────────────
function OutputPanel({ title, filename, yaml, statsComp, history, onUndo, onCopy, copied,
                       refineText, setRefineText, onRefine, refining, refinePlaceholder,
                       cliContent, footer, serverOnline }) {
  const [tab, setTab] = useState("yaml");
  if (!yaml) return null;
  return (
    <Card style={{ animation: "fadeIn 0.25s ease" }}>
      <CardHeader
        title={title || filename}
        subtitle={`${yaml.split("\n").length} lines`}
        action={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <SaveBtn filename={filename} content={yaml} serverOnline={serverOnline} />
            <Btn size="sm" variant="neutral" onClick={onCopy}>{copied ? "✓ Copied" : "⎘ Copy"}</Btn>
            {history?.length > 1 && (
              <Btn size="sm" variant="neutral" onClick={onUndo}>↩ Undo</Btn>
            )}
          </div>
        }
      />
      {statsComp}
      <div style={{ borderBottom: `1px solid ${C.border}`, display: "flex", gap: "0" }}>
        {["yaml", "cli"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "10px 18px", background: "none", border: "none", borderBottom: `2px solid ${tab === t ? C.brand : "transparent"}`,
                     color: tab === t ? C.brand : C.textWeak, fontSize: "13px", fontWeight: "600", cursor: "pointer", transition: "all 0.15s" }}>
            {t === "yaml" ? "YAML" : "CLI Pipeline"}
          </button>
        ))}
      </div>
      <div style={{ padding: "16px" }}>
        {tab === "yaml" && (
          <>
            <YamlViewer code={yaml} />
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={labelStyle}>🔁 Refine with AI</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input value={refineText} onChange={e => setRefineText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && onRefine()}
                  placeholder={refinePlaceholder} style={{ ...inputStyle, flex: 1 }} />
                <Btn onClick={onRefine} disabled={refining || !refineText?.trim()}>
                  {refining ? <><Spinner size={11} /> Refining…</> : "Refine"}
                </Btn>
              </div>
            </div>
          </>
        )}
        {tab === "cli" && <div style={{ display: "flex", flexDirection: "column" }}>{cliContent}</div>}
      </div>
      {footer && <div style={{ padding: "0 16px 16px" }}>{footer}</div>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 1 — AGENT SPEC
// ═══════════════════════════════════════════════════════════════════════════════

function PageAgentSpec({ serverOnline }) {
  const isMobile = useIsMobile();
  const [mode, setMode]         = useState("generate");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [yaml, setYaml]         = useState("");
  const [copied, setCopied]     = useState(false);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [history, setHistory]   = useState([]);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [pickedFile, setPickedFile]   = useState(null);
  const [form, setForm] = useState({ agentType: "customer", companyName: "", companyDescription: "", role: "", tone: "casual", maxNumOfTopics: 5, agentUser: "", promptTemplateName: "", groundingContext: "", enrichLogs: false });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const generate = async () => {
    if (!form.companyName || !form.companyDescription || !form.role) return;
    setLoading(true); setError(""); setYaml("");
    try {
      let userMsg = `agentType: ${form.agentType}\ncompanyName: ${form.companyName}\ncompanyDescription: ${form.companyDescription}\nrole: ${form.role}\ntone: ${form.tone}\nmaxNumOfTopics: ${form.maxNumOfTopics}\nenrichLogs: ${form.enrichLogs}`;
      if (form.agentUser)          userMsg += `\nagentUser: ${form.agentUser}`;
      if (form.promptTemplateName) userMsg += `\npromptTemplateName: ${form.promptTemplateName}`;
      if (form.groundingContext)   userMsg += `\ngroundingContext: ${form.groundingContext}`;
      const r = await callAI(AGENT_SPEC_PROMPT, userMsg);
      setYaml(r); setHistory([r]);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const importYaml = () => {
    const t = importText.trim();
    if (!t) { setImportError("Paste your YAML content."); return; }
    if (!t.includes("agentType:")) { setImportError("Missing agentType field — not a valid agentSpec.yaml."); return; }
    setImportError(""); setYaml(t); setHistory([t]);
  };

  const refine = async () => {
    if (!refineText.trim()) return;
    setRefining(true); setError("");
    try {
      const r = await callAI(AGENT_SPEC_REFINE_PROMPT, `Current agentSpec.yaml:\n${yaml}\n\nRefinement: ${refineText}`);
      setHistory(h => [...h, r]); setYaml(r); setRefineText("");
    } catch (e) { setError(e.message); }
    setRefining(false);
  };

  const topics = parseTopics(yaml);
  const isValid = form.companyName && form.companyDescription && form.role;

  const ModeTab = ({ id, icon, label, disabled }) => (
    <button onClick={() => { if (!disabled) { setMode(id); setYaml(""); setHistory([]); setError(""); setImportError(""); setPickedFile(null); if (id === "pick") {} } }}
      disabled={disabled} title={disabled ? "Requires server connection" : undefined}
      style={{ padding: "8px 14px", borderRadius: C.radius, border: `1px solid ${mode === id ? C.brand : C.border}`,
               background: mode === id ? C.brandLight : C.surface, color: mode === id ? C.brandDark : disabled ? C.textWeaker : C.textWeak,
               fontSize: "12px", fontWeight: "600", cursor: disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "5px", transition: "all 0.15s" }}>
      {icon} {label}
    </button>
  );

  // CLI for step 1
  const agentType = (yaml?.match(/agentType:\s*(.+)/)||[])[1]?.trim()||"customer";
  const role      = (yaml?.match(/role:\s*(.+)/)||[])[1]?.trim()||"";
  const company   = (yaml?.match(/companyName:\s*(.+)/)||[])[1]?.trim()||"";
  const compDesc  = (yaml?.match(/companyDescription:\s*(.+)/)||[])[1]?.trim()||"";
  const tone      = (yaml?.match(/tone:\s*(.+)/)||[])[1]?.trim()||"casual";

  return (
    <div style={{ display: "grid", gridTemplateColumns: (!isMobile && yaml) ? "1fr 1fr" : "1fr", gap: "24px", alignItems: "start" }}>
      <Card>
        <CardHeader icon="🤖" title="Define your Agentforce Agent" subtitle="Generate or import an agentSpec.yaml" />
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Mode selector */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <ModeTab id="generate" icon="⚡" label="Generate with AI" />
            <ModeTab id="import"   icon="📋" label="Paste YAML" />
            <ModeTab id="pick"     icon="📁" label="Pick from project" disabled={!serverOnline} />
          </div>

          {/* ── Generate ── */}
          {mode === "generate" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: "12px" }}>
                <Field label="Agent Type" required hint='Valid: "customer" or "internal"'>
                  <select value={form.agentType} onChange={e => set("agentType", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                    {AGENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Tone" hint='Valid: "casual", "formal", "neutral"'>
                  <select value={form.tone} onChange={e => set("tone", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                    {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Company Name" required>
                <input style={inputStyle} placeholder="e.g. Coral Cloud Resorts" value={form.companyName} onChange={e => set("companyName", e.target.value)} />
              </Field>
              <Field label="Company Description" required>
                <textarea style={{ ...inputStyle, resize: "vertical" }} rows={3} placeholder="e.g. Provides customers with exceptional destination activities." value={form.companyDescription} onChange={e => set("companyDescription", e.target.value)} />
              </Field>
              <Field label="Agent Role" required hint="💡 Mention specific Salesforce action names for better topic generation">
                <textarea style={{ ...inputStyle, resize: "vertical" }} rows={4} placeholder="e.g. Fields customer complaints, manages schedules. Uses GetSchedule and CreateTask actions." value={form.role} onChange={e => set("role", e.target.value)} />
              </Field>
              <Field label={`maxNumOfTopics — ${form.maxNumOfTopics}`}>
                <input type="range" min={2} max={10} value={form.maxNumOfTopics} onChange={e => set("maxNumOfTopics", Number(e.target.value))} style={{ width: "100%", accentColor: C.brand }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: C.textWeaker }}>
                  <span>2 — focused</span><span>10 — exhaustive</span>
                </div>
              </Field>

              {/* Advanced options */}
              <div>
                <button onClick={() => setShowAdvanced(a => !a)}
                  style={{ background: "none", border: "none", color: C.brand, fontSize: "12px", fontWeight: "600", cursor: "pointer", padding: "0", display: "flex", alignItems: "center", gap: "5px" }}>
                  {showAdvanced ? "▾" : "▸"} Advanced options <span style={{ color: C.textWeaker, fontWeight: "400" }}>(agentUser, promptTemplate, groundingContext, enrichLogs)</span>
                </button>
                {showAdvanced && (
                  <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px", paddingLeft: "12px", borderLeft: `2px solid ${C.border}` }}>
                    <Field label="agentUser" hint="Username of the org user to assign to this agent (must exist in org)">
                      <input style={inputStyle} placeholder="e.g. managerrole@salesforce.com" value={form.agentUser} onChange={e => set("agentUser", e.target.value)} />
                    </Field>
                    <Field label="promptTemplateName" hint="API name of a custom prompt template from Prompt Builder">
                      <input style={inputStyle} placeholder="e.g. einstein_gpt__answerWithKnowledge" value={form.promptTemplateName} onChange={e => set("promptTemplateName", e.target.value)} />
                    </Field>
                    <Field label="groundingContext" hint="Context string added to agent prompts when using a custom prompt template">
                      <textarea style={{ ...inputStyle, resize: "vertical" }} rows={2} placeholder="e.g. You are a resort manager helping {!$Input:User.Name}." value={form.groundingContext} onChange={e => set("groundingContext", e.target.value)} />
                    </Field>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input type="checkbox" id="enrichLogs" checked={form.enrichLogs} onChange={e => set("enrichLogs", e.target.checked)} style={{ accentColor: C.brand, width: "14px", height: "14px" }} />
                      <label htmlFor="enrichLogs" style={{ fontSize: "13px", color: C.text, cursor: "pointer" }}>
                        <strong>enrichLogs</strong> <span style={{ color: C.textWeak }}>— add agent conversation data to event logs</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {error && <Alert type="error">{error}</Alert>}
              <Btn onClick={generate} disabled={loading || !isValid || !serverOnline}>
                {loading ? <><Spinner size={12} /> Generating…</> : "⚡ Generate agentSpec.yaml"}
              </Btn>
              {!serverOnline && <Alert type="warning">Server offline — start <code>tdad-server.js</code> to use AI generation.</Alert>}
            </>
          )}

          {/* ── Paste YAML ── */}
          {mode === "import" && (
            <>
              <Alert type="info">Paste an <code>agentSpec.yaml</code> generated locally via VS Code or Salesforce CLI. You can refine it with AI afterward.</Alert>
              <Field label="agentSpec.yaml content">
                <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={14}
                  placeholder={"agentType: customer\ncompanyName: ...\nrole: ...\ntone: casual\nmaxNumOfTopics: 5\nenrichLogs: false\ntopics:\n  - name: OrderTracking\n    description: ..."}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: "12px", lineHeight: "1.7" }} />
              </Field>
              {importError && <Alert type="error">{importError}</Alert>}
              <Btn onClick={importYaml} disabled={!importText.trim()}>📋 Import YAML</Btn>
            </>
          )}

          {/* ── Pick from project ── */}
          {mode === "pick" && (
            <FilePicker
              label="YAML files in specs/"
              filterFn={f => f.content?.includes("agentType:")}
              selected={pickedFile}
              onSelect={f => { setPickedFile(f); setYaml(f.content); setHistory([f.content]); }}
              emptyMsg="No agentSpec files found in specs/ — generate one first."
              serverOnline={serverOnline}
            />
          )}
        </div>
      </Card>

      {/* Output */}
      {yaml && (
        <OutputPanel
          title="agentSpec.yaml" filename="agentSpec.yaml"
          yaml={yaml}
          statsComp={
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <Badge color="brand">{topics.length} topic{topics.length !== 1 ? "s" : ""}</Badge>
              <Badge color="neutral">{(yaml.match(/agentType:\s*(.+)/)||[])[1]?.trim()}</Badge>
              <Badge color="neutral">{(yaml.match(/tone:\s*(.+)/)||[])[1]?.trim()}</Badge>
              {topics.map(n => <Badge key={n} color="success">{n}</Badge>)}
            </div>
          }
          history={history}
          onUndo={() => { if (history.length > 1) { setYaml(history[history.length-2]); setHistory(h => h.slice(0,-1)); } }}
          onCopy={() => { navigator.clipboard.writeText(yaml); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          copied={copied} refineText={refineText} setRefineText={setRefineText}
          onRefine={refine} refining={refining}
          refinePlaceholder='"Add escalation topic" · "Split OrderManagement in two" · "More formal tone"'
          serverOnline={serverOnline}
          cliContent={
            <>
              <CmdBlock label="1. Generate Agent Spec (required flags)" serverOnline={serverOnline}
                cmd={`sf agent generate agent-spec \\\n  --type ${agentType} \\\n  --role "${role}" \\\n  --company-name "${company}" \\\n  --company-description "${compDesc}" \\\n  --tone ${tone} \\\n  --max-topics ${form.maxNumOfTopics}`} />
              {(form.agentUser || form.promptTemplateName) && (
                <CmdBlock label="1b. With optional flags" serverOnline={serverOnline}
                  note="Add these flags to the command above as needed"
                  cmd={[
                    form.agentUser          ? `  --agent-user "${form.agentUser}"` : null,
                    form.promptTemplateName ? `  --prompt-template "${form.promptTemplateName}"` : null,
                    form.enrichLogs         ? `  --enrich-logs` : null,
                  ].filter(Boolean).join(" \\\n")} />
              )}
              <CmdBlock label="2. Generate Authoring Bundle" serverOnline={serverOnline}
                cmd={`sf agent generate authoring-bundle \\\n  --spec specs/agentSpec.yaml \\\n  --target-org my-dev-org`} />
              <CmdBlock label="3. Deploy to org" serverOnline={serverOnline}
                cmd={`sf project deploy start \\\n  --source-dir force-app/main/default/aiAuthoringBundles \\\n  --target-org my-dev-org`} />
            </>
          }
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 2 — TEST SPEC
// ═══════════════════════════════════════════════════════════════════════════════

function PageTestSpec({ serverOnline }) {
  const isMobile = useIsMobile();

  // Mode: "new_from_agent" | "append_existing" | "from_ai_eval"
  const [mode, setMode] = useState("new_from_agent");

  // Shared
  const [yaml, setYaml]         = useState("");
  const [copied, setCopied]     = useState(false);
  const [history, setHistory]   = useState([]);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [error, setError]       = useState("");

  // New from .agent
  const [agentFile, setAgentFile]       = useState(null);
  const [selectedMetrics, setSelectedMetrics] = useState(METRICS.map(m => m.id));
  const [selectedTopics, setSelectedTopics]   = useState([]);
  const [testsPerTopic, setTestsPerTopic]     = useState(2);
  const [generating, setGenerating]     = useState(false);

  // From AiEvaluationDefinition XML
  const [aiEvalFile, setAiEvalFile]         = useState(null);
  const [aiEvalXml, setAiEvalXml]           = useState("");
  const [aiEvalMode, setAiEvalMode]         = useState("pick"); // "pick" | "paste"
  const [convertingEval, setConvertingEval] = useState(false);
  const [aiEvalError, setAiEvalError]       = useState("");

  // Append existing
  const [existingSpec, setExistingSpec] = useState(null);
  const [appendMode, setAppendMode]     = useState("agent"); // "agent" | "gherkin"
  const [appendAgentFile, setAppendAgentFile] = useState(null);
  const [gherkinInput, setGherkinInput] = useState("");
  const [appending, setAppending]       = useState(false);
  const [appendError, setAppendError]   = useState("");

  const resetOutput = () => { setYaml(""); setHistory([]); setError(""); setAiEvalError(""); };

  // ── Convert AiEvaluationDefinition XML → testSpec ──
  const convertFromAiEval = async () => {
    const xml = aiEvalMode === "paste" ? aiEvalXml : aiEvalFile?.content;
    if (!xml?.trim()) return;
    setConvertingEval(true); setAiEvalError(""); setYaml("");
    try {
      const r = await callAI(TEST_FROM_AI_EVAL_PROMPT, `AiEvaluationDefinition XML:\n\n${xml}`);
      setYaml(r); setHistory([r]);
    } catch (e) { setAiEvalError(e.message); }
    setConvertingEval(false);
  };

  // ── Generate new testSpec from .agent ──
  const generateFromAgent = async () => {
    if (!agentFile || selectedTopics.length === 0) return;
    setGenerating(true); setError(""); setYaml("");
    try {
      const metricsStr = selectedMetrics.map(m => `      - name: ${m}`).join("\n");
      const topicsList = selectedTopics.map(t => `- ${t}`).join("\n");
      const r = await callAI(TEST_FROM_AGENT_PROMPT,
        `.agent file content:\n\n${agentFile.content}\n\nTopics to test (generate ONLY for these):\n${topicsList}\n\nTests per topic: ${testsPerTopic}\n\nSelected metrics:\n${metricsStr}\n\nIMPORTANT: Generate exactly ${testsPerTopic} test case(s) per topic listed above. Total test cases: ${selectedTopics.length * testsPerTopic}.`);
      setYaml(r); setHistory([r]);
    } catch (e) { setError(e.message); }
    setGenerating(false);
  };

  // ── Append to existing spec ──
  const appendWithAgent = async () => {
    if (!existingSpec || !appendAgentFile) return;
    setAppending(true); setAppendError("");
    try {
      const r = await callAI(TEST_APPEND_FROM_AGENT_PROMPT,
        `Existing testSpec.yaml:\n\n${existingSpec.content}\n\n.agent file:\n\n${appendAgentFile.content}\n\nAppend 2-3 new test cases based on topics in the .agent file that are NOT already covered.`);
      const updated = { ...existingSpec, content: r };
      setExistingSpec(updated); setYaml(r); setHistory(h => [...h, r]);
    } catch (e) { setAppendError(e.message); }
    setAppending(false);
  };

  const appendWithGherkin = async () => {
    if (!existingSpec || !gherkinInput.trim()) return;
    setAppending(true); setAppendError("");
    const subject = parseSubject(existingSpec.content);
    const topics  = parseTopics(existingSpec.content);
    try {
      const r = await callAI(TEST_APPEND_FROM_GHERKIN_PROMPT,
        `Existing testSpec.yaml:\n\n${existingSpec.content}\n\nAgent API name: ${subject}\nAvailable topics: ${topics.join(", ")}\n\nGherkin to append:\n\n${gherkinInput}`);
      const updated = { ...existingSpec, content: r };
      setExistingSpec(updated); setYaml(r); setHistory(h => [...h, r]); setGherkinInput("");
    } catch (e) { setAppendError(e.message); }
    setAppending(false);
  };

  const refine = async () => {
    if (!refineText.trim()) return;
    setRefining(true);
    try {
      const r = await callAI("You are a Salesforce Agentforce QA engineer. Refine this testSpec.yaml. Keep subjectType: AGENT. metrics inside each testCase. Output ONLY YAML, no fences, start with 'name:'.",
        `Current testSpec.yaml:\n${yaml}\n\nRefinement: ${refineText}`);
      setHistory(h => [...h, r]); setYaml(r); setRefineText("");
    } catch (e) { setError(e.message); }
    setRefining(false);
  };

  const testCaseCount = (yaml.match(/^  - utterance:/gm)||[]).length;
  const subjectName   = parseSubject(yaml);

  const ModeTab = ({ id, icon, label }) => (
    <button onClick={() => { setMode(id); resetOutput(); }}
      style={{ flex: 1, padding: "10px 14px", background: mode === id ? C.brand : C.surface,
               color: mode === id ? "#fff" : C.textWeak, border: `1px solid ${mode === id ? C.brand : C.border}`,
               borderRadius: C.radius, fontSize: "13px", fontWeight: "600", cursor: "pointer",
               display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", transition: "all 0.15s" }}>
      {icon} {label}
    </button>
  );

  // CLI
  const specFilename = subjectName ? `${subjectName}-testSpec.yaml` : "agent-testSpec.yaml";

  return (
    <div style={{ display: "grid", gridTemplateColumns: (!isMobile && yaml) ? "1fr 1fr" : "1fr", gap: "24px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* Mode selector */}
        <Card>
          <CardHeader icon="🧪" title="Generate Test Spec" subtitle="Create or complete a testSpec.yaml for your agent" />
          <div style={{ padding: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <ModeTab id="new_from_agent"    icon="✨" label="New from .agent" />
            <ModeTab id="from_ai_eval"      icon="📄" label="From AiEvaluationDefinition" />
            <ModeTab id="append_existing"   icon="➕" label="Append to existing spec" />
          </div>
        </Card>

        {/* ── Mode C: From AiEvaluationDefinition XML ── */}
        {mode === "from_ai_eval" && (
          <Card>
            <CardHeader title="From AiEvaluationDefinition XML"
              subtitle="Generate a testSpec.yaml from a metadata XML file — via CLI or AI conversion" />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

              {/* CLI path — primary recommended */}
              <div style={{ background: "rgba(31,111,235,0.07)", border: `1px solid ${C.brand}`, borderRadius: C.radius, padding: "14px 16px" }}>
                <div style={{ fontSize: "12px", fontWeight: "700", color: C.brand, marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                  ⚡ Recommended — Native Salesforce CLI
                </div>
                <div style={{ fontSize: "12px", color: C.textWeak, marginBottom: "10px" }}>
                  If you have an <code>.aiEvaluationDefinition-meta.xml</code> in your DX project, use the CLI directly — no AI needed.
                </div>
                <CmdBlock label="Generate testSpec from AiEvaluationDefinition XML" serverOnline={serverOnline}
                  cmd={`sf agent generate test-spec \\\n  --from-definition force-app/main/default/aiEvaluationDefinitions/MyAgent.aiEvaluationDefinition-meta.xml \\\n  --output-file specs/MyAgent-testSpec.yaml`} />
                <div style={{ fontSize: "11px", color: C.textWeak, marginTop: "8px" }}>
                  💡 Replace <code>MyAgent</code> with your agent name. The XML is in <code>force-app/.../aiEvaluationDefinitions/</code>
                </div>
              </div>

              {/* Divider */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ flex: 1, height: "1px", background: C.border }} />
                <span style={{ fontSize: "11px", color: C.textWeak, fontWeight: "600" }}>OR — AI CONVERSION</span>
                <div style={{ flex: 1, height: "1px", background: C.border }} />
              </div>

              <div style={{ fontSize: "12px", color: C.textWeak }}>
                Paste or pick your <code>.aiEvaluationDefinition-meta.xml</code> and Claude will convert it to a <code>testSpec.yaml</code>.
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                {[["pick","📁","Pick from project"],["paste","📋","Paste XML"]].map(([id,icon,label]) => (
                  <button key={id} onClick={() => setAiEvalMode(id)}
                    style={{ padding: "7px 14px", borderRadius: C.radius, border: `1px solid ${aiEvalMode===id ? C.brand : C.border}`,
                             background: aiEvalMode===id ? C.brandLight : C.surface, color: aiEvalMode===id ? C.brandDark : C.textWeak,
                             fontSize: "12px", fontWeight: "600", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
                    {icon} {label}
                  </button>
                ))}
              </div>

              {aiEvalMode === "pick" && (
                <FilePicker
                  label="AiEvaluationDefinition XML files"
                  route="/files/aievals"
                  selected={aiEvalFile}
                  onSelect={setAiEvalFile}
                  emptyMsg="No .aiEvaluationDefinition-meta.xml found — use Paste XML below, or run: sf project retrieve start --target-org my-dev-org"
                  serverOnline={serverOnline}
                />
              )}

              {aiEvalMode === "paste" && (
                <Field label="AiEvaluationDefinition XML content" hint="Paste the full content of your .aiEvaluationDefinition-meta.xml file">
                  <textarea value={aiEvalXml} onChange={e => setAiEvalXml(e.target.value)} rows={12}
                    placeholder='<?xml version="1.0"?>\n<AiEvaluationDefinition xmlns="http://soap.sforce.com/2006/04/metadata">\n  <n>MyAgent_Test</n>\n  <subjectName>MyAgent</subjectName>\n  ...\n</AiEvaluationDefinition>'
                    style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: "12px" }} />
                </Field>
              )}

              {aiEvalError && <Alert type="error">{aiEvalError}</Alert>}

              <Btn onClick={convertFromAiEval}
                disabled={convertingEval || !serverOnline || (aiEvalMode==="pick" ? !aiEvalFile : !aiEvalXml.trim())}>
                {convertingEval ? <><Spinner size={12} /> Converting…</> : "🤖 Convert to testSpec.yaml with AI"}
              </Btn>
            </div>
          </Card>
        )}

        {/* ── Mode A: New from .agent ── */}
        {mode === "new_from_agent" && (
          <Card>
            <CardHeader title="New testSpec from .agent file" subtitle="Select topics and configure how many test cases to generate per topic" />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <FilePicker
                label=".agent files in project"
                route="/files/agents"
                filterFn={f => f.name.endsWith(".agent") || f.content?.includes("<topics>") || f.content?.includes("topic ") || f.content?.includes("developer_name:")}
                selected={agentFile}
                onSelect={f => { setAgentFile(f); const t = parseAgentTopics(f?.content); setSelectedTopics(t.length > 0 ? t : []); }}
                emptyMsg="No .agent files found. Make sure your SFDX project path is correct in .env."
                serverOnline={serverOnline}
              />

              {agentFile && (() => {
                const allTopics = parseAgentTopics(agentFile.content);
                const toggleTopic = t => setSelectedTopics(prev =>
                  prev.includes(t)
                    ? (prev.length > 1 ? prev.filter(x => x !== t) : prev)
                    : [...prev, t]
                );
                const totalTests = selectedTopics.length * testsPerTopic;
                return (<>

                  {/* Agent name */}
                  <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: C.radius, padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "600", color: C.textWeak }}>Agent detected:</span>
                    <code style={{ fontSize: "13px", color: C.brand }}>{parseAgentDeveloperName(agentFile.content) || agentFile.name.replace(".agent","")}</code>
                  </div>

                  {/* Topic selector */}
                  {allTopics.length > 0 ? (
                    <Field label={`Topics to test — ${selectedTopics.length} of ${allTopics.length} selected`}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "6px" }}>
                        {allTopics.map(t => {
                          const active = selectedTopics.includes(t);
                          const isLast = active && selectedTopics.length === 1;
                          return (
                            <button key={t} onClick={() => toggleTopic(t)}
                              disabled={isLast}
                              title={isLast ? "At least one topic must be selected" : active ? `Remove ${t}` : `Add ${t}`}
                              style={{
                                padding: "6px 14px", borderRadius: "20px",
                                border: `1.5px solid ${active ? C.gold : C.border}`,
                                background: active ? "rgba(227,179,65,0.13)" : C.surface,
                                color: active ? C.gold : C.textWeak,
                                fontSize: "12px", fontWeight: active ? "700" : "500",
                                cursor: isLast ? "not-allowed" : "pointer",
                                opacity: isLast ? 0.7 : 1,
                                transition: "all 0.15s",
                                display: "flex", alignItems: "center", gap: "5px"
                              }}>
                              {active && <span style={{ fontSize: "10px" }}>✓</span>}{t}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", gap: "12px", marginTop: "8px", alignItems: "center" }}>
                        <span style={{ fontSize: "11px", color: C.textWeak }}>At least one required</span>
                        {allTopics.length > 1 && selectedTopics.length < allTopics.length && (
                          <button onClick={() => setSelectedTopics(allTopics)}
                            style={{ background: "none", border: "none", color: C.brand, cursor: "pointer", fontSize: "11px", padding: "0", fontWeight: "600" }}>
                            ✦ Select all
                          </button>
                        )}
                        {selectedTopics.length === allTopics.length && allTopics.length > 1 && (
                          <button onClick={() => setSelectedTopics([allTopics[0]])}
                            style={{ background: "none", border: "none", color: C.textWeak, cursor: "pointer", fontSize: "11px", padding: "0" }}>
                            Clear
                          </button>
                        )}
                      </div>
                    </Field>
                  ) : (
                    <Alert type="warning">No topics detected in this .agent file. The AI will infer topics from the file content.</Alert>
                  )}

                  {/* Tests per topic */}
                  <Field label="Tests per topic" hint={`${totalTests} total test case${totalTests !== 1 ? "s" : ""} will be generated (${selectedTopics.length} topic${selectedTopics.length !== 1 ? "s" : ""} × ${testsPerTopic})`}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                      {[1, 2, 3, 5].map(n => (
                        <button key={n} onClick={() => setTestsPerTopic(n)}
                          style={{
                            width: "40px", height: "40px", borderRadius: C.radius,
                            border: `1.5px solid ${testsPerTopic === n ? C.gold : C.border}`,
                            background: testsPerTopic === n ? "rgba(227,179,65,0.13)" : C.surface,
                            color: testsPerTopic === n ? C.gold : C.textWeak,
                            fontSize: "14px", fontWeight: "700", cursor: "pointer", transition: "all 0.15s"
                          }}>{n}</button>
                      ))}
                      <input type="number" min={1} max={10} value={testsPerTopic}
                        onChange={e => setTestsPerTopic(Math.min(10, Math.max(1, parseInt(e.target.value)||1)))}
                        style={{ ...inputStyle, width: "60px", textAlign: "center", padding: "8px" }} />
                      <span style={{ fontSize: "12px", color: C.textWeak }}>custom</span>
                    </div>
                  </Field>

                  {/* Metrics */}
                  <Field label="Metrics to evaluate">
                    <MetricsSelector selected={selectedMetrics} onChange={setSelectedMetrics} />
                  </Field>

                  {error && <Alert type="error">{error}</Alert>}

                  <Btn onClick={generateFromAgent}
                    disabled={generating || !serverOnline || selectedTopics.length === 0}>
                    {generating
                      ? <><Spinner size={12} /> Generating…</>
                      : `✨ Generate ${totalTests} test case${totalTests !== 1 ? "s" : ""} (${selectedTopics.length} topic${selectedTopics.length !== 1 ? "s" : ""} × ${testsPerTopic})`}
                  </Btn>
                </>);
              })()}

              {!serverOnline && <Alert type="warning">Server offline — start <code>tdad-server.js</code>.</Alert>}
            </div>
          </Card>
        )}

        {/* ── Mode B: Append to existing ── */}
        {mode === "append_existing" && (
          <Card>
            <CardHeader title="Select an existing testSpec.yaml" subtitle="Pick a spec to complete, then add test cases with AI or Gherkin" />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <FilePicker
                label="testSpec files in specs/"
                filterFn={f => f.content?.includes("subjectType:") || f.name.includes("testSpec")}
                selected={existingSpec}
                onSelect={f => { setExistingSpec(f); setYaml(f.content); setHistory([f.content]); }}
                emptyMsg="No testSpec files found in specs/."
                serverOnline={serverOnline}
              />

              {existingSpec && (
                <>
                  <div style={{ display: "flex", gap: "8px", borderBottom: `1px solid ${C.border}`, paddingBottom: "12px" }}>
                    {[["agent", "🤖", "Add via .agent file"], ["gherkin", "🥒", "Add via Gherkin"]].map(([id, icon, label]) => (
                      <button key={id} onClick={() => setAppendMode(id)}
                        style={{ padding: "7px 14px", borderRadius: C.radius, border: `1px solid ${appendMode === id ? C.brand : C.border}`,
                                 background: appendMode === id ? C.brandLight : C.surface, color: appendMode === id ? C.brandDark : C.textWeak,
                                 fontSize: "12px", fontWeight: "600", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
                        {icon} {label}
                      </button>
                    ))}
                  </div>

                  {appendMode === "agent" && (
                    <>
                      <FilePicker
                        label="Select .agent file to base new tests on"
                        route="/files/agents"
                        filterFn={f => f.name.endsWith(".agent") || f.content?.includes("topic ") || f.content?.includes("developer_name:")}
                        selected={appendAgentFile}
                        onSelect={setAppendAgentFile}
                        emptyMsg="No .agent files found."
                        serverOnline={serverOnline}
                      />
                      {appendError && <Alert type="error">{appendError}</Alert>}
                      {appendAgentFile && (
                        <Btn onClick={appendWithAgent} disabled={appending || !serverOnline}>
                          {appending ? <><Spinner size={12} /> Appending…</> : "➕ Append test cases from .agent"}
                        </Btn>
                      )}
                    </>
                  )}

                  {appendMode === "gherkin" && (
                    <>
                      <Field label="Gherkin scenario to append" hint="Paste one or more Gherkin scenarios — they will be appended to the existing spec">
                        <textarea value={gherkinInput} onChange={e => setGherkinInput(e.target.value)}
                          rows={8} placeholder={"Scenario: User tracks an order\n  Given the user is authenticated\n  When the user asks \"Where is my order #12345?\"\n  Then the agent should return the current order status"}
                          style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: "12px" }}
                          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") appendWithGherkin(); }} />
                        <div style={{ fontSize: "11px", color: C.textWeaker, marginTop: "3px" }}>⌘↵ to append</div>
                      </Field>
                      {appendError && <Alert type="error">{appendError}</Alert>}
                      <Btn onClick={appendWithGherkin} disabled={appending || !gherkinInput.trim() || !serverOnline}>
                        {appending ? <><Spinner size={12} /> Appending…</> : "🥒 Append from Gherkin"}
                      </Btn>
                    </>
                  )}
                </>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Output */}
      {yaml && (
        <OutputPanel
          title={specFilename} filename={specFilename}
          yaml={yaml}
          statsComp={
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <Badge color="success">{testCaseCount} test case{testCaseCount !== 1 ? "s" : ""}</Badge>
              {subjectName && <Badge color="brand">{subjectName}</Badge>}
              {history.length > 1 && <Badge color="neutral">v{history.length}</Badge>}
            </div>
          }
          history={history}
          onUndo={() => { if (history.length > 1) { setYaml(history[history.length-2]); setHistory(h => h.slice(0,-1)); } }}
          onCopy={() => { navigator.clipboard.writeText(yaml); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          copied={copied} refineText={refineText} setRefineText={setRefineText}
          onRefine={refine} refining={refining}
          refinePlaceholder='"Add error cases" · "Add conversationHistory to test 2" · "More edge cases"'
          serverOnline={serverOnline}
          cliContent={
            <>
              <CmdBlock label="1a. Generate test spec via CLI (interactive)" serverOnline={serverOnline}
                note="Alternative to AI generation — uses Salesforce API"
                cmd={`sf agent generate test-spec \\\n  --agent-api-name ${subjectName||"MyAgent"} \\\n  --target-org my-dev-org`} />
              <CmdBlock label="1b. Convert AiEvaluationDefinition XML → testSpec" serverOnline={serverOnline}
                note="If you already have an AiEvaluationDefinition metadata XML in your project"
                cmd={`sf agent generate test-spec \\\n  --from-definition force-app/main/default/aiEvaluationDefinitions/${subjectName||"MyAgent"}.aiEvaluationDefinition-meta.xml \\\n  --output-file specs/${specFilename}`} />
              <CmdBlock label="2. Create test in org (preview)" serverOnline={serverOnline}
                cmd={`sf agent test create \\\n  --spec specs/${specFilename} \\\n  --preview \\\n  --target-org my-dev-org`} />
              <CmdBlock label="3. Create test in org" serverOnline={serverOnline}
                cmd={`sf agent test create \\\n  --spec specs/${specFilename} \\\n  --target-org my-dev-org`} />
              <CmdBlock label="4. Run tests (async)" serverOnline={serverOnline}
                cmd={`sf agent test run \\\n  --name ${subjectName||"MyAgent"}Test \\\n  --target-org my-dev-org`} />
              <CmdBlock label="4b. Run tests (sync, wait 10min)" serverOnline={serverOnline}
                cmd={`sf agent test run \\\n  --name ${subjectName||"MyAgent"}Test \\\n  --wait 10 \\\n  --target-org my-dev-org`} />
              <CmdBlock label="5. Get results" serverOnline={serverOnline}
                cmd={`sf agent test results \\\n  --job-id <JOB_ID> \\\n  --target-org my-dev-org`} />
            </>
          }
          footer={
            <Alert type="success">
              <strong>Ready to run.</strong> Save to project, then create and run the test in your org with the CLI commands above.
            </Alert>
          }
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [page, setPage]       = useState("agent"); // "agent" | "test"
  const { status, refresh }   = useServerStatus();
  const serverOnline          = !!status;

  // no NavBtn — using inline stepper below

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Salesforce Sans', 'Inter', 'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: #0d1117; } ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        input:focus, textarea:focus, select:focus { border-color: ${C.borderFocus} !important; box-shadow: 0 0 0 3px rgba(1,118,211,0.15); outline: none; }
        input::placeholder, textarea::placeholder { color: ${C.textWeaker}; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        code { background: #161b22; padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 0.9em; }
      `}</style>

      {/* Top Bar */}
      <div style={{ background: C.brand, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 0" }}>
          <div style={{ width: "28px", height: "28px", background: "rgba(255,255,255,0.2)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>⚡</div>
          <span style={{ color: "#fff", fontWeight: "800", fontSize: "16px", letterSpacing: "-0.3px" }}>AgentKit</span>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", fontWeight: "500", letterSpacing: "0.5px", textTransform: "uppercase" }}>Designed for TDAD</span>
        </div>
        {/* Server status */}
        <div onClick={!serverOnline ? refresh : undefined} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 12px", background: "rgba(255,255,255,0.15)", borderRadius: "999px", cursor: !serverOnline ? "pointer" : "default" }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: status === null ? "#aaa" : serverOnline ? "#4bca81" : "#f28b00", display: "inline-block" }} />
          <span style={{ color: "#fff", fontSize: "12px", fontWeight: "500" }}>
            {status === null ? "Connecting…" : serverOnline ? `Project connected · ${status.specFiles?.length ?? 0} specs` : "Server offline — click to retry"}
          </span>
        </div>
      </div>

      {/* Step switcher */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "12px clamp(20px,4vw,56px)", display: "flex", alignItems: "center", gap: "0" }}>
        {[
          { id: "agent", step: "01", label: "Agent Spec",  sub: "Generate agentSpec.yaml" },
          { id: "test",  step: "02", label: "Test Spec",   sub: "Generate testSpec.yaml"  },
        ].map(({ id, step, label, sub }, i, arr) => {
          const active = page === id;
          const done   = id === "agent" && page === "test";
          return (
            <React.Fragment key={id}>
              <button onClick={() => setPage(id)} style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "8px 20px 8px 0", background: "none", border: "none", cursor: "pointer",
                borderBottom: `2px solid ${active ? C.brand : "transparent"}`,
                transition: "all 0.15s", textAlign: "left",
              }}>
                <div style={{
                  width: "30px", height: "30px", borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "11px", fontWeight: "700", letterSpacing: "0.3px",
                  background: active ? C.brand : done ? C.success : C.surfaceAlt,
                  color: active || done ? "#fff" : C.textWeak,
                  border: `2px solid ${active ? C.brand : done ? C.success : C.border}`,
                  transition: "all 0.15s",
                }}>
                  {done ? "✓" : step}
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: active ? C.text : C.textWeak, transition: "color 0.15s" }}>{label}</div>
                  <div style={{ fontSize: "11px", color: C.textWeaker, marginTop: "1px" }}>{sub}</div>
                </div>
              </button>
              {i < arr.length - 1 && (
                <div style={{ flex: "0 0 40px", height: "1px", background: C.border, margin: "0 8px 0 12px" }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Offline banner */}
      {status === false && (
        <div style={{ background: C.warningBg, borderBottom: `1px solid ${C.warning}`, padding: "10px 24px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", color: C.warning }}>⚠️ Local server not running — AI generation and file operations are unavailable.</span>
          <code style={{ fontSize: "12px", background: C.surfaceAlt, color: C.text, padding: "2px 8px", borderRadius: "4px", fontFamily: "monospace" }}>node tdad-server.js --project /path/to/sfdx-project</code>
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "28px clamp(20px, 4vw, 56px) 80px" }}>
        {page === "agent" && <PageAgentSpec serverOnline={serverOnline} />}
        {page === "test"  && <PageTestSpec  serverOnline={serverOnline} />}
      </div>
    </div>
  );
}
