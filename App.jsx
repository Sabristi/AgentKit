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
  { id: "instruction_following", label: "Instruction Following", desc: "Available in API/CLI only — not in Salesforce Testing Center UI", locked: true },
  { id: "factuality",            label: "Factuality",            desc: "Available in API/CLI only — not in Salesforce Testing Center UI", locked: true },
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
//     - name: coherence | completeness | conciseness | latency | instruction_following | factuality

const TESTSPEC_FORMAT_RULES = `
CRITICAL FORMAT RULES — Salesforce Agentforce testSpec.yaml
Sources: https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html
         https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html
═══════════════════════════════════════════════════════════════════════════════════════════════

STANDARD testSpec.yaml structure (used by sf agent generate test-spec):

name: <string>
description: <string>
subjectType: AGENT
subjectName: <agentApiName>
testCases:
  - utterance: <string>
    expectedTopic: <topicApiName>
    expectedActions:
      - <actionApiName>
    expectedOutcome: <natural language expected outcome>
    contextVariables:          # optional — for Service agents with context variables
      - name: <variableName>   # API name from MessagingSession object
        value: "<string>"      # ALWAYS a string — never boolean/number (e.g. "true" not true)
    customEvaluations:         # optional — only when explicitly requested
      - label: "<descriptive label>"
        JSONPath: "<JSONPath to action output field, e.g. $.generatedData.outcome>"
        operator: contains     # equals | contains | startswith | endswith | greater_than | less_than
        expectedValue: "<expected value>"
    conversationHistory:       # optional — for multi-turn context
      - role: user
        message: <string>
      - role: agent
        message: <string>
        topic: <topicApiName>  # required for agent messages
    metrics:                   # CRITICAL — NO 'name:' key, just the bare metric value
      - coherence
      - completeness
      - conciseness
      - output_latency_milliseconds
    # ⚠️ DO NOT add instruction_following or factuality unless explicitly in the selected metrics list below

RULES:
1. subjectType MUST always be AGENT
2. contextVariables values are ALWAYS strings — "true" not true, "42" not 42
3. customEvaluations: only include if the user explicitly requested them
4. metrics: include only metrics from the user's selection
5. conversationHistory: agent messages MUST have a topic field
6. Output ONLY valid YAML, start with "name:", no markdown fences
`;

const TEST_FROM_AGENT_PROMPT = `You are an expert Salesforce Agentforce QA engineer generating testSpec.yaml files.

${TESTSPEC_FORMAT_RULES}

The .agent file contains topics, actions, instructions, variables, and config.
Extract: developer_name (→ subjectName), topic names, action names.

Generate ${'{'}testsPerTopic{'}'} test cases per topic:
- 1 happy path: direct utterance, correct topic + action, positive outcome
- 1 edge/error: ambiguous or auth-required, may include conversationHistory
- Additional if testsPerTopic > 2: varied scenarios (off-topic, multi-turn, boundary)

EXAMPLE test case (use EXACTLY this structure):
testCases:
  - utterance: "I want to cancel my flight"
    expectedTopic: cancellation_management
    expectedActions:
      - verify_passenger
    expectedOutcome: Agent asks for booking reference and email to verify identity
    contextVariables: []
    customEvaluations: []
    conversationHistory: []
    metrics:
      - coherence
      - completeness
      - conciseness
      - output_latency_milliseconds

❌ NEVER use: - name: coherence  (wrong — no 'name:' key)
❌ NEVER add instruction_following or factuality unless they appear in the selected metrics list
✅ ALWAYS use: - coherence  (correct — bare value only)

Output ONLY valid YAML starting with "name:".`;

const TEST_APPEND_FROM_AGENT_PROMPT = `You are an expert Salesforce Agentforce QA engineer appending test cases to an existing testSpec.yaml.

${TESTSPEC_FORMAT_RULES}

Return the COMPLETE updated testSpec.yaml with new test cases appended.
Do NOT modify existing test cases.
New test cases must use the correct expectation[] structure (not old flat format).
Output ONLY valid YAML starting with "name:".`;

const TEST_FROM_GHERKIN_PROMPT = `You are an expert Salesforce Agentforce QA engineer converting Gherkin BDD scenarios into testSpec.yaml.

${TESTSPEC_FORMAT_RULES}

Gherkin mapping:
- "Given ..."        → conversationHistory (role: user/agent messages)
- "When user says"   → inputs.utterance
- "Then agent ..."   → expectation[{name: bot_response_rating, expectedValue: ...}]
- "And response contains X" → expectation[{name: string_comparison, parameter: [{name:actual,value:$.response,isReference:true},{name:operator,value:contains},{name:expected,value:X}]}]
- Infer topic and action from the agent file topics list provided.

Output ONLY valid YAML starting with "name:".`;

const TEST_APPEND_FROM_GHERKIN_PROMPT = `You are an expert Salesforce Agentforce QA engineer appending Gherkin-derived test cases to an existing testSpec.yaml.

${TESTSPEC_FORMAT_RULES}

Return the COMPLETE updated testSpec.yaml with new test cases appended.
Do NOT modify existing test cases.
Gherkin mapping: "Given" → conversationHistory, "When" → utterance, "Then/And" → bot_response_rating / string_comparison expectation.
Output ONLY valid YAML starting with "name:".`;


const TEST_FROM_AI_EVAL_PROMPT = `You are an expert Salesforce Agentforce QA engineer converting AiEvaluationDefinition XML into testSpec.yaml.

${TESTSPEC_FORMAT_RULES}

XML → YAML field mapping:
- AiEvaluationDefinition.name          → name
- AiEvaluationDefinition.description   → description
- subjectType: AGENT (always)
- AiEvaluationDefinition.subjectName   → subjectName
- Each AiEvaluationTestCase → testCases entry with inputs + expectation[] structure
- testCase.inputs.utterance            → inputs.utterance
- testCase.inputs.contextVariable[]    → inputs.contextVariables (variableName/variableValue — values always strings)
- testCase.inputs.conversationHistory[]→ inputs.conversationHistory (role/message/topic)
- testCase.expectation[]               → expectation[] keep name/expectedValue/parameter as-is

Output ONLY valid YAML starting with "name:".
`;

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

// ── YAML tokenizer (shared) ──────────────────────────────────────────────────
// ── AgentScript (.agent) tokenizer ──────────────────────────────────────────
const agentTokenize = line => {
  const t = line.trimStart();
  if (t.startsWith("#"))                          return "#6e7681";  // comment — grey
  if (/^(config|system|variables|start_agent|topic)/.test(t)) return "#ff7b72"; // block keywords — red
  if (/^(topic|start_agent)\s+\w+:/.test(t))     return "#ffa657";  // topic name — orange
  if (t.startsWith("  messages:") || t.startsWith("  instructions:") || t.startsWith("  reasoning:") || t.startsWith("  actions:")) return "#7ee787"; // section keys — green
  if (t.startsWith("    instructions:") || t.startsWith("    actions:")) return "#7ee787";
  if (t.startsWith("description:") || t.startsWith("  description:") || t.startsWith("    description:")) return "#8b949e";
  if (/^\s+\w+:\s+@/.test(t))                    return "#79c0ff";  // action ref — blue
  if (/^\s+@/.test(t))                           return "#d2a8ff";  // @ references — purple
  if (/^\s+go_\w+:|^\s+\w+_\w+:/.test(t))       return "#79c0ff";  // action names — blue
  if (t.startsWith("  developer_name:") || t.startsWith("  agent_type:") || t.startsWith("  agent_description:")) return "#ffa657";
  if (t.startsWith("  welcome:") || t.startsWith("  error:")) return "#a5d6ff";
  if (/^\s+mutable\s/.test(t) || /^\s+\w+:\s+(string|boolean|int)/.test(t)) return "#d2a8ff"; // type declarations
  if (t.startsWith("  - ") || t.startsWith("    - ")) return "#e6edf3";
  if (t.includes(":") && !t.startsWith(" "))     return "#ff7b72";  // top-level keys
  if (t.includes(": "))                          return "#8b949e";  // general key:value
  return "#e6edf3";
};

// ── AgentScript (.agent) tokenizer ─────────────────────────────────────────
const yamlTokenize = line => {
  const t = line.trimStart();
  if (t.startsWith("#"))                    return "#6e7681";
  if (t.startsWith("agentType:") || t.startsWith("subjectType:")) return "#ff7b72";
  if (t.startsWith("name:") || t.startsWith("subjectName:"))      return "#ffa657";
  if (t.startsWith("topics:") || t.startsWith("testCases:") || t.startsWith("metrics:")) return "#7ee787";
  if (t.startsWith("- name:"))              return "#79c0ff";
  if (t.startsWith("utterance:"))           return "#d2a8ff";
  if (t.startsWith("expectedTopic:"))       return "#ffa657";
  if (t.startsWith("expectedOutcome:") || t.startsWith("expectedActions:")) return "#7ee787";
  if (t.startsWith("  - name: "))           return "#79c0ff";
  if (t.match(/^  - [A-Z]/))               return "#79c0ff";
  if (t.includes(":")) {
    const key = t.split(":")[0].trim();
    if (["companyName","companyDescription","role","tone","maxNumOfTopics","enrichLogs",
         "description","customEvaluations","conversationHistory"].includes(key)) return "#8b949e";
  }
  return "#8b949e";
};

// ── YAML Viewer ───────────────────────────────────────────────────────────────
function YamlViewer({ code, maxHeight = "400px" }) {
  if (!code) return null;
  return (
    <div style={{ background: "#0d1117", border: `1px solid ${C.border}`, borderRadius: C.radius,
                  padding: "14px 16px", overflowY: "auto", maxHeight,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "12px", lineHeight: "1.8" }}>
      {code.split("\n").map((line, i) => (
        <div key={i} style={{ color: yamlTokenize(line), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line || " "}</div>
      ))}
    </div>
  );
}

// ── YAML Editor (syntax-highlighted + editable) ───────────────────────────────
function YamlEditor({ value, onChange, minHeight = "420px" }) {
  const textareaRef = useRef(null);
  const backdropRef = useRef(null);

  // Sync scroll between textarea and backdrop
  const syncScroll = () => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop  = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const sharedStyle = {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "12px",
    lineHeight: "1.8",
    whiteSpace: "pre",
    overflowWrap: "normal",
    wordBreak: "normal",
    overflowX: "auto",
    padding: "14px 16px",
    margin: 0,
    border: "none",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    minHeight,
    tabSize: 2,
  };

  return (
    <div style={{ position: "relative", background: "#0d1117", border: `1px solid ${C.gold}`,
                  borderRadius: C.radius, overflow: "hidden" }}>
      {/* Highlighted backdrop */}
      <div ref={backdropRef} aria-hidden="true"
        style={{ ...sharedStyle, position: "absolute", top: 0, left: 0, height: "100%",
                 overflowY: "hidden", overflowX: "hidden", pointerEvents: "none", color: "transparent" }}>
        {(value + "\n").split("\n").map((line, i) => (
          <div key={i} style={{ color: yamlTokenize(line), minHeight: "1.8em" }}>{line || " "}</div>
        ))}
      </div>
      {/* Editable textarea on top */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        style={{
          ...sharedStyle,
          position: "relative",
          background: "transparent",
          color: "transparent",
          caretColor: "#e6edf3",
          resize: "vertical",
          overflowY: "auto",
          zIndex: 1,
        }}
      />
    </div>
  );
}

// ── Agent Script Editor (syntax-highlighted + editable) ─────────────────────
function AgentEditor({ value, onChange, minHeight = "420px" }) {
  const textareaRef = useRef(null);
  const backdropRef = useRef(null);

  const syncScroll = () => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop  = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const sharedStyle = {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "12px", lineHeight: "1.8",
    whiteSpace: "pre", overflowWrap: "normal", wordBreak: "normal",
    overflowX: "auto", padding: "14px 16px", margin: 0,
    border: "none", outline: "none", width: "100%",
    boxSizing: "border-box", minHeight, tabSize: 2,
  };

  return (
    <div style={{ position: "relative", background: "#0d1117",
                  border: `1px solid ${C.gold}`, borderRadius: C.radius, overflow: "hidden" }}>
      {/* Highlighted backdrop */}
      <div ref={backdropRef} aria-hidden="true"
        style={{ ...sharedStyle, position: "absolute", top: 0, left: 0, height: "100%",
                 overflowY: "hidden", overflowX: "hidden", pointerEvents: "none", color: "transparent" }}>
        {(value + "\n").split("\n").map((line, i) => (
          <div key={i} style={{ color: agentTokenize(line), minHeight: "1.8em" }}>{line || " "}</div>
        ))}
      </div>
      {/* Editable textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false} autoCapitalize="off" autoCorrect="off"
        style={{
          ...sharedStyle,
          position: "relative",
          background: "transparent",
          color: "transparent",
          caretColor: "#e6edf3",
          resize: "vertical",
          overflowY: "auto",
          zIndex: 1,
        }}
      />
    </div>
  );
}


// ── Terminal Panel ────────────────────────────────────────────────────────────
function TerminalPanel({ cmd, serverOnline, onSuccess }) {
  const [lines, setLines]     = useState([]);
  const [running, setRunning] = useState(false);
  const [open, setOpen]       = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const bottomRef             = useRef(null);
  const esRef                 = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  const run = () => {
    if (!serverOnline || running) return;
    setLines([]); setOpen(true); setRunning(true); setSucceeded(false);

    // Detect if this is a multi-line bash script (contains newlines or shell operators)
    const isBashScript = cmd.includes("\n") || cmd.includes("SESSION_ID") || cmd.includes("for ") || cmd.includes("PLAN_IDS");

    if (isBashScript) {
      // Use POST /sf/bash for multi-line scripts
      fetch(`${API}/preview/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: cmd }),
      }).then(res => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const pump = () => reader.read().then(({ done, value }) => {
          if (done) { setRunning(false); return; }
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop();
          for (const part of parts) {
            const line = part.replace(/^data: /, "").trim();
            if (!line || line.startsWith(":")) continue; // skip pings
            try {
              const { type, text } = JSON.parse(line);
              setLines(l => [...l, { type, text }]);
              if (type === "done" || type === "error") { setRunning(false); if (type === "done") { setSucceeded(true); onSuccess && onSuccess(); } }
            } catch (_) {}
          }
          pump();
        }).catch(() => setRunning(false));
        pump();
      }).catch(() => {
        setLines(l => [...l, { type: "error", text: "\n✗ Connection failed" }]);
        setRunning(false);
      });
    } else {
      // Use GET /sf/run via EventSource for simple sf commands
      const cmdAfterSf = cmd.replace(/^sf\s+/, "").replace(/\\ \n\s*/g, " ").replace(/\\\n\s*/g, " ").trim();
      const es = new EventSource(`${API}/sf/run?cmd=${encodeURIComponent(cmdAfterSf)}`);
      esRef.current = es;
      es.onmessage = e => {
        try {
          const { type, text } = JSON.parse(e.data);
          setLines(l => [...l, { type, text }]);
          if (type === "done" || type === "error") { setRunning(false); if (type === "done") { setSucceeded(true); onSuccess && onSuccess(); } es.close(); }
        } catch (_) {}
      };
      es.onerror = () => {
        setLines(l => [...l, { type: "error", text: "\n✗ Connection lost" }]);
        setRunning(false); es.close();
      };
    }
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

// ── Step Reference (copy-only, no Run) ───────────────────────────────────────
function StepRef({ label, cmd }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden" }}>
      <div style={{ padding: "5px 12px", background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "11px", fontWeight: "600", color: C.textWeak, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
        <button onClick={copy} style={{ background: "none", border: "none", color: copied ? C.success : C.brand, cursor: "pointer", fontSize: "11px", fontWeight: "600" }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div style={{ padding: "10px 14px", fontFamily: "JetBrains Mono, monospace", fontSize: "11px",
                    color: "#79c0ff", background: "#0d1117", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "1.6" }}>
        {cmd}
      </div>
    </div>
  );
}

// ── CLI Command Block ─────────────────────────────────────────────────────────
function CmdBlock({ label, cmd, note, serverOnline, onSuccess }) {
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
      <div style={{ padding: "10px 14px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#79c0ff", background: "#0d1117", lineHeight: "1.7", whiteSpace: "pre-wrap", wordBreak: "break-all", overflowWrap: "break-word", minWidth: 0 }}>
        {cmd}
      </div>
      {note && <div style={{ padding: "4px 12px 8px", fontSize: "11px", color: C.textWeak }}>{note}</div>}
      <div style={{ padding: "4px 12px 10px" }}><TerminalPanel cmd={cmd} serverOnline={serverOnline} onSuccess={onSuccess} /></div>
    </div>
  );
}

// ── Save Button ───────────────────────────────────────────────────────────────
function SaveBtn({ filename, content, serverOnline, route = "/files/save" }) {
  const [state, setState] = useState("idle");
  const save = async () => {
    if (!serverOnline || !content) return;
    setState("saving");
    try {
      const r = await fetch(`${API}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, content }) });
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
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
      {METRICS.map(m => {
        const on = selected.includes(m.id);
        if (m.locked) return (
          <span key={m.id} title={m.desc}
            style={{ padding: "5px 12px", borderRadius: "999px", border: `1px solid ${C.border}`,
                     background: C.bg, color: C.textWeaker, fontSize: "12px", fontWeight: "600",
                     cursor: "not-allowed", opacity: 0.45 }}>
            {m.label}
          </span>
        );
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
                       onManualEdit, cliContent, footer, serverOnline, saveRoute = "/files/save" }) {
  const [tab, setTab]           = useState("yaml");
  const [editContent, setEditContent] = useState("");
  const [editDirty, setEditDirty]     = useState(false);

  // Sync textarea when switching to edit tab or yaml changes
  const handleTabClick = t => {
    if (t === "edit") setEditContent(yaml);
    setTab(t);
    setEditDirty(false);
  };

  const applyEdit = () => {
    if (onManualEdit && editContent.trim()) {
      onManualEdit(editContent);
      setEditDirty(false);
      setTab("yaml");
    }
  };

  if (!yaml) return null;
  return (
    <Card style={{ animation: "fadeIn 0.25s ease" }}>
      <CardHeader
        title={title || filename}
        subtitle={`${yaml.split("\n").length} lines`}
        action={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <SaveBtn filename={filename} content={yaml} serverOnline={serverOnline} route={saveRoute} />
            <Btn size="sm" variant="neutral" onClick={onCopy}>{copied ? "✓ Copied" : "⎘ Copy"}</Btn>
            {history?.length > 1 && (
              <Btn size="sm" variant="neutral" onClick={onUndo}>↩ Undo</Btn>
            )}
          </div>
        }
      />
      {statsComp}
      <div style={{ borderBottom: `1px solid ${C.border}`, display: "flex", gap: "0" }}>
        {[
          { id: "yaml", label: "YAML" },
          { id: "edit", label: "✏️ Edit manually" },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => handleTabClick(id)}
            style={{ padding: "10px 18px", background: "none", border: "none",
                     borderBottom: `2px solid ${tab === id ? (id === "edit" ? C.gold : C.brand) : "transparent"}`,
                     color: tab === id ? (id === "edit" ? C.gold : C.brand) : C.textWeak,
                     fontSize: "13px", fontWeight: "600", cursor: "pointer", transition: "all 0.15s",
                     display: "flex", alignItems: "center", gap: "5px" }}>
            {label}
            {id === "edit" && editDirty && (
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.gold, display: "inline-block" }} />
            )}
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
        {tab === "edit" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: C.textWeak }}>
                Edit the YAML directly — click <strong style={{ color: C.gold }}>Apply</strong> to save to history
              </span>
              <span style={{ fontSize: "11px", color: C.textWeaker }}>
                {editContent.split("\n").length} lines
              </span>
            </div>
            <YamlEditor
              value={editContent}
              onChange={v => { setEditContent(v); setEditDirty(true); }}
              minHeight="420px"
            />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <Btn size="sm" variant="neutral" onClick={() => { setEditContent(yaml); setEditDirty(false); }}>
                ↺ Reset
              </Btn>
              <Btn size="sm" variant="outline"
                onClick={applyEdit}
                disabled={!editDirty || !editContent.trim()}
                style={{ borderColor: C.gold, color: C.gold }}>
                ✓ Apply changes
              </Btn>
            </div>
          </div>
        )}

      </div>
      {footer && <div style={{ padding: "0 16px 16px" }}>{footer}</div>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 1 — AGENT SPEC
// ═══════════════════════════════════════════════════════════════════════════════

function PageAgentSpec({ serverOnline, targetOrg = "my-dev-org" }) {
  const [tab, setTab]         = useState("new");
  const [subNew, setSubNew]   = useState("cli");
  const [subEdit, setSubEdit] = useState("paste");

  // AI generation state
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [yaml, setYaml]             = useState("");
  const [copied, setCopied]         = useState(false);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining]     = useState(false);
  const [history, setHistory]       = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState({ agentType:"customer", companyName:"", companyDescription:"", role:"", tone:"casual", maxNumOfTopics:5, agentUser:"", promptTemplateName:"", groundingContext:"", enrichLogs:false });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // CLI spec state
  const [cliAgentType, setCliAgentType] = useState("customer");
  const [cliRole, setCliRole]           = useState("");
  const [cliCompany, setCliCompany]     = useState("");
  const [cliCompDesc, setCliCompDesc]   = useState("");
  const [cliTone, setCliTone]           = useState("casual");
  const [cliMaxTopics, setCliMaxTopics] = useState(5);
  const [cliSpecName, setCliSpecName]   = useState("");
  const [cliYamlLoading, setCliYamlLoading] = useState(false);
  const [cliRanSuccess, setCliRanSuccess]   = useState(false);

  // Edit state
  const [importText, setImportText]   = useState("");
  const [importError, setImportError] = useState("");
  const [pickedFile, setPickedFile]   = useState(null);

  const generate = async () => {
    if (!form.companyName || !form.companyDescription || !form.role) return;
    setLoading(true); setError(""); setYaml("");
    try {
      let msg = `agentType: ${form.agentType}\ncompanyName: ${form.companyName}\ncompanyDescription: ${form.companyDescription}\nrole: ${form.role}\ntone: ${form.tone}\nmaxNumOfTopics: ${form.maxNumOfTopics}\nenrichLogs: ${form.enrichLogs}`;
      if (form.agentUser)          msg += `\nagentUser: ${form.agentUser}`;
      if (form.promptTemplateName) msg += `\npromptTemplateName: ${form.promptTemplateName}`;
      if (form.groundingContext)   msg += `\ngroundingContext: ${form.groundingContext}`;
      const r = await callAI(AGENT_SPEC_PROMPT, msg);
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

  const topics  = parseTopics(yaml);
  const isValid = form.companyName && form.companyDescription && form.role;
  const cliSpecFile2  = cliSpecName.trim() ? cliSpecName.trim() + "-spec.yaml" : "agentSpec.yaml";
  const cliOutputPath = `specs/${cliSpecFile2}`;
  const cliReady = cliCompany && cliRole;
  const cliCmd = cliReady ? `sf agent generate agent-spec --type ${cliAgentType} --role "${cliRole}" --company-name "${cliCompany}" --company-description "${cliCompDesc}" --tone ${cliTone} --max-topics ${cliMaxTopics} --output-file ${cliOutputPath}` : "";

  const agentType = (yaml?.match(/agentType:\s*(.+)/)||[])[1]?.trim()||"customer";
  const role      = (yaml?.match(/role:\s*(.+)/)||[])[1]?.trim()||"";
  const company   = (yaml?.match(/companyName:\s*(.+)/)||[])[1]?.trim()||"";
  const compDesc  = (yaml?.match(/companyDescription:\s*(.+)/)||[])[1]?.trim()||"";
  const tone      = (yaml?.match(/tone:\s*(.+)/)||[])[1]?.trim()||"casual";

  const SubTabBar = ({ value, onChange, tabs }) => (
    <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, gap:"0" }}>
      {tabs.map(({ id, icon, label, sub }) => {
        const active = value === id;
        return (
          <button key={id} onClick={() => onChange(id)} style={{
            padding:"10px 20px 9px", background:"none", border:"none",
            borderBottom:`2px solid ${active ? C.gold : "transparent"}`,
            cursor:"pointer", textAlign:"left", transition:"all 0.15s", marginBottom:"-1px",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
              <span style={{ fontSize:"12px" }}>{icon}</span>
              <span style={{ fontSize:"12px", fontWeight:"700", color:active ? C.text : C.textWeak }}>{label}</span>
            </div>
            <div style={{ fontSize:"10px", color:active ? C.textWeak : C.textWeaker, marginTop:"2px", paddingLeft:"18px" }}>{sub}</div>
          </button>
        );
      })}
    </div>
  );

  const OutputRight = () => yaml ? (
    <OutputPanel
      title="agentSpec.yaml" filename="agentSpec.yaml" yaml={yaml}
      statsComp={
        <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", gap:"12px", flexWrap:"wrap", alignItems:"center" }}>
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
      onManualEdit={v => { setHistory(h => [...h, v]); setYaml(v); }}
      serverOnline={serverOnline}
      cliContent={
        <>
          <CmdBlock label="Generate Agent Spec (required flags)" serverOnline={serverOnline}
            cmd={`sf agent generate agent-spec \\\n  --type ${agentType} \\\n  --role "${role}" \\\n  --company-name "${company}" \\\n  --company-description "${compDesc}" \\\n  --tone ${tone} \\\n  --max-topics ${form.maxNumOfTopics} \\
  --output-file ${cliOutputPath}`} />
        </>
      }
    />
  ) : (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                  minHeight:"320px", border:`1px dashed ${C.border}`,
                  borderRadius:C.radiusMd, color:C.textWeaker, flexDirection:"column", gap:"12px" }}>
      <span style={{ fontSize:"36px" }}>📋</span>
      <span style={{ fontSize:"14px", fontWeight:"600", color:C.textWeak }}>agentSpec.yaml</span>
      <span style={{ fontSize:"12px", textAlign:"center", maxWidth:"200px", lineHeight:"1.6" }}>
        {tab === "new" ? "Generate or run the CLI command to create your spec" : "Paste or pick a spec file"}
      </span>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

      {/* Main tab bar */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, gap:"0" }}>
        {[
          { id:"new",  icon:"➕", label:"New Spec",           sub:"Generate agent spec" },
          { id:"edit", icon:"✏️",  label:"Edit Spec", sub:"Import or pick from project" },
        ].map(({ id, icon, label, sub }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => { setTab(id); setYaml(""); setHistory([]); setError(""); setCliRanSuccess(false); }} style={{
              padding:"12px 24px 11px", background:"none", border:"none",
              borderBottom:`2px solid ${active ? C.brand : "transparent"}`,
              cursor:"pointer", textAlign:"left", transition:"all 0.15s", marginBottom:"-1px",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:"7px" }}>
                <span style={{ fontSize:"13px" }}>{icon}</span>
                <span style={{ fontSize:"13px", fontWeight:"700", color:active ? C.text : C.textWeak }}>{label}</span>
              </div>
              <div style={{ fontSize:"11px", color:active ? C.textWeak : C.textWeaker, marginTop:"2px", paddingLeft:"20px" }}>{sub}</div>
            </button>
          );
        })}
      </div>

      {/* ══ NEW SPEC ══ */}
      {tab === "new" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
          <SubTabBar value={subNew} onChange={v => { setSubNew(v); setYaml(""); setHistory([]); setError(""); setCliRanSuccess(false); }} tabs={[
            { id:"cli", icon:"⌨️", label:"Via CLI Command", sub:"sf agent generate agent-spec" },
            { id:"ai",  icon:"✨", label:"Via AI",           sub:"Generate with Claude" },
          ]} />

          {/* Via CLI */}
          {subNew === "cli" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px", alignItems:"start" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                <Card>
                  <CardHeader icon="⌨️" title="Generate Agent Spec" subtitle="Configure and run sf agent generate agent-spec" />
                  <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
                      <Field label="Agent Type">
                        <select value={cliAgentType} onChange={e => setCliAgentType(e.target.value)} style={{ ...inputStyle, cursor:"pointer" }}>
                          {AGENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Tone">
                        <select value={cliTone} onChange={e => setCliTone(e.target.value)} style={{ ...inputStyle, cursor:"pointer" }}>
                          {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </Field>
                    </div>
                    <Field label="Company Name" required>
                      <input style={inputStyle} placeholder="e.g. Coral Cloud Resorts" value={cliCompany} onChange={e => setCliCompany(e.target.value)} />
                    </Field>
                    <Field label="Company Description">
                      <textarea style={{ ...inputStyle, resize:"vertical" }} rows={2} placeholder="e.g. Provides customers with exceptional destination activities." value={cliCompDesc} onChange={e => setCliCompDesc(e.target.value)} />
                    </Field>
                    <Field label="Agent Role" required>
                      <textarea style={{ ...inputStyle, resize:"vertical" }} rows={3} placeholder="e.g. Fields customer complaints, manages schedules." value={cliRole} onChange={e => setCliRole(e.target.value)} />
                    </Field>
                    <Field label="Output filename">
                      <div style={{ display:"flex", alignItems:"center", gap:"0" }}>
                        <input value={cliSpecName} onChange={e => setCliSpecName(e.target.value.replace(/[^a-zA-Z0-9_-]/g,""))}
                          placeholder="agentSpec"
                          style={{ ...inputStyle, borderRadius:`${C.radius} 0 0 ${C.radius}`, borderRight:"none", fontFamily:"monospace", fontSize:"12px", flex:1 }} />
                        <span style={{ padding:"8px 12px", background:C.surfaceAlt, border:`1px solid ${C.border}`,
                                       borderRadius:`0 ${C.radius} ${C.radius} 0`, fontSize:"12px",
                                       color:C.textWeak, fontFamily:"monospace", whiteSpace:"nowrap" }}>-spec.yaml</span>
                      </div>
                      <div style={{ fontSize:"11px", color:C.textWeaker, marginTop:"4px" }}>
                        → <code style={{ color:C.textWeak }}>{cliOutputPath}</code>
                      </div>
                    </Field>

                    <Field label={`Max Topics — ${cliMaxTopics}`}>
                      <input type="range" min={2} max={10} value={cliMaxTopics} onChange={e => setCliMaxTopics(Number(e.target.value))} style={{ width:"100%", accentColor:C.brand }} />
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", color:C.textWeaker }}>
                        <span>2 — focused</span><span>10 — exhaustive</span>
                      </div>
                    </Field>
                  </div>
                </Card>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                {cliReady ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                    <CmdBlock label="Generate Agent Spec" serverOnline={serverOnline} cmd={cliCmd}
                      onSuccess={async () => {
                        setCliRanSuccess(true);
                        setCliYamlLoading(true);
                        await new Promise(r => setTimeout(r, 800));
                        try {
                          const res = await fetch(`${API}/files/specs`);
                          const d = await res.json();
                          const f = (d.files||[]).find(f => f.name === cliSpecFile2);
                          if (f && f.content) { setYaml(f.content); setHistory([f.content]); }
                          else setError(`File "${cliSpecFile2}" not found in specs/. Available: ${(d.files||[]).map(f=>f.name).join(", ")}`);
                        } catch(e) { setError(e.message); }
                        setCliYamlLoading(false);
                      }} />
                    {cliYamlLoading && <div style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 14px", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:C.radius, fontSize:"12px", color:C.textWeak }}><Spinner size={11}/> Loading generated spec…</div>}
                  </div>
                ) : (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                                minHeight:"180px", border:`1px dashed ${C.border}`,
                                borderRadius:C.radiusMd, flexDirection:"column", gap:"12px", color:C.textWeaker }}>
                    <span style={{ fontSize:"36px" }}>⌨️</span>
                    <span style={{ fontSize:"14px", fontWeight:"600", color:C.textWeak }}>CLI commands</span>
                    <span style={{ fontSize:"12px", textAlign:"center", maxWidth:"220px", lineHeight:"1.6" }}>
                      Fill in Company Name and Agent Role to generate the command
                    </span>
                  </div>
                )}
                {OutputRight()}
                <Card>
                  <CardHeader title="How it works" subtitle="Generate your agent spec via the Salesforce CLI" />
                  <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"12px" }}>
                    {[
                      { step:"1", title:"Fill in the form", desc:"Enter your company info and agent role. The CLI commands are generated automatically." },
                      { step:"2", title:"Run sf agent generate agent-spec", desc:"The CLI generates an agentSpec.yaml in the specs/ directory of your SFDX project." },
                      { step:"3", title:"Move to Stage 02 — Via CLI Command", desc:"Generate the Authoring Bundle from your spec using sf agent generate authoring-bundle." },
                      { step:"4", title:"Stage 02 → Edit existing agent", desc:"Open the generated .agent file to refine topics, actions, and instructions." },
                    ].map(({ step, title, desc }) => (
                      <div key={step} style={{ display:"flex", gap:"12px", alignItems:"flex-start" }}>
                        <div style={{ width:"24px", height:"24px", borderRadius:"50%", background:C.brandLight,
                                      border:`1px solid ${C.brand}`, display:"flex", alignItems:"center",
                                      justifyContent:"center", fontSize:"11px", fontWeight:"700",
                                      color:C.brand, flexShrink:0, marginTop:"1px" }}>{step}</div>
                        <div>
                          <div style={{ fontSize:"13px", fontWeight:"600", color:C.text, marginBottom:"2px" }}>{title}</div>
                          <div style={{ fontSize:"12px", color:C.textWeak, lineHeight:"1.5" }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"12px", display:"flex", flexDirection:"column", gap:"8px" }}>
                      <label style={labelStyle}>Resources</label>
                      {[
                        { label:"Generate an Agent Spec File — Salesforce Docs", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-generate-agent-spec.html" },
                        { label:"sf agent CLI reference", url:"https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_agent_commands_unified.htm" },
                      ].map(({ label, url }) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                          style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px",
                                   background:C.surfaceAlt, border:`1px solid ${C.border}`,
                                   borderRadius:C.radius, textDecoration:"none" }}>
                          <span>📄</span>
                          <div style={{ flex:1, fontSize:"12px", color:C.text }}>{label}</div>
                          <span style={{ fontSize:"11px", color:C.textWeaker }}>↗</span>
                        </a>
                      ))}
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* Via AI */}
          {subNew === "ai" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px", alignItems:"start" }}>
              <Card>
                <CardHeader icon="⚡" title="Generate with AI" subtitle="Claude generates an agentSpec.yaml from your inputs" />
                <div style={{ padding:"20px", display:"flex", flexDirection:"column", gap:"16px" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
                    <Field label="Agent Type" required hint='Valid: "customer" or "internal"'>
                      <select value={form.agentType} onChange={e => set("agentType", e.target.value)} style={{ ...inputStyle, cursor:"pointer" }}>
                        {AGENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Tone" hint='Valid: "casual", "formal", "neutral"'>
                      <select value={form.tone} onChange={e => set("tone", e.target.value)} style={{ ...inputStyle, cursor:"pointer" }}>
                        {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Company Name" required>
                    <input style={inputStyle} placeholder="e.g. Coral Cloud Resorts" value={form.companyName} onChange={e => set("companyName", e.target.value)} />
                  </Field>
                  <Field label="Company Description" required>
                    <textarea style={{ ...inputStyle, resize:"vertical" }} rows={3} placeholder="e.g. Provides customers with exceptional destination activities." value={form.companyDescription} onChange={e => set("companyDescription", e.target.value)} />
                  </Field>
                  <Field label="Agent Role" required hint="💡 Mention specific Salesforce action names for better topic generation">
                    <textarea style={{ ...inputStyle, resize:"vertical" }} rows={4} placeholder="e.g. Fields customer complaints, manages schedules. Uses GetSchedule and CreateTask actions." value={form.role} onChange={e => set("role", e.target.value)} />
                  </Field>
                  <Field label={`maxNumOfTopics — ${form.maxNumOfTopics}`}>
                    <input type="range" min={2} max={10} value={form.maxNumOfTopics} onChange={e => set("maxNumOfTopics", Number(e.target.value))} style={{ width:"100%", accentColor:C.brand }} />
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", color:C.textWeaker }}>
                      <span>2 — focused</span><span>10 — exhaustive</span>
                    </div>
                  </Field>
                  <div>
                    <button onClick={() => setShowAdvanced(a => !a)}
                      style={{ background:"none", border:"none", color:C.brand, fontSize:"12px", fontWeight:"600", cursor:"pointer", padding:"0", display:"flex", alignItems:"center", gap:"5px" }}>
                      {showAdvanced ? "▾" : "▸"} Advanced options <span style={{ color:C.textWeak, fontWeight:"400" }}>(agentUser, promptTemplate, groundingContext, enrichLogs)</span>
                    </button>
                    {showAdvanced && (
                      <div style={{ marginTop:"12px", display:"flex", flexDirection:"column", gap:"12px", paddingLeft:"12px", borderLeft:`2px solid ${C.border}` }}>
                        <Field label="agentUser" hint="Username of the org user to assign to this agent">
                          <input style={inputStyle} placeholder="e.g. managerrole@salesforce.com" value={form.agentUser} onChange={e => set("agentUser", e.target.value)} />
                        </Field>
                        <Field label="promptTemplateName" hint="API name of a custom prompt template">
                          <input style={inputStyle} placeholder="e.g. einstein_gpt__answerWithKnowledge" value={form.promptTemplateName} onChange={e => set("promptTemplateName", e.target.value)} />
                        </Field>
                        <Field label="groundingContext" hint="Context string added to agent prompts">
                          <textarea style={{ ...inputStyle, resize:"vertical" }} rows={2} placeholder="e.g. You are a resort manager helping {!$Input:User.Name}." value={form.groundingContext} onChange={e => set("groundingContext", e.target.value)} />
                        </Field>
                        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                          <input type="checkbox" id="enrichLogs" checked={form.enrichLogs} onChange={e => set("enrichLogs", e.target.checked)} style={{ accentColor:C.brand, width:"14px", height:"14px" }} />
                          <label htmlFor="enrichLogs" style={{ fontSize:"13px", color:C.text, cursor:"pointer" }}>
                            <strong>enrichLogs</strong> <span style={{ color:C.textWeak }}>— add agent conversation data to event logs</span>
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
                </div>
              </Card>
              {OutputRight()}
            </div>
          )}
        </div>
      )}

      {/* ══ EDIT EXISTING SPEC ══ */}
      {tab === "edit" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
          <SubTabBar value={subEdit} onChange={v => { setSubEdit(v); setYaml(""); setHistory([]); setError(""); }} tabs={[
            { id:"paste", icon:"📋", label:"Paste YAML",        sub:"Import from clipboard" },
            { id:"pick",  icon:"📁", label:"Pick from project", sub:"Browse specs/ directory" },
          ]} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px", alignItems:"start" }}>
            <Card>
              <CardHeader icon={subEdit === "paste" ? "📋" : "📁"}
                title={subEdit === "paste" ? "Paste YAML" : "Pick from project"}
                subtitle={subEdit === "paste" ? "Import an agentSpec.yaml from clipboard or another source" : "Browse agentSpec.yaml files in your specs/ directory"} />
              <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
                {subEdit === "paste" && (
                  <>
                    <Alert type="info">Paste an <code>agentSpec.yaml</code> generated locally via VS Code or Salesforce CLI. You can refine it with AI afterward.</Alert>
                    <Field label="agentSpec.yaml content">
                      <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={14}
                        placeholder={"agentType: customer\ncompanyName: ...\nrole: ...\ntone: casual\nmaxNumOfTopics: 5\ntopics:\n  - name: OrderTracking\n    description: ..."}
                        style={{ ...inputStyle, resize:"vertical", fontFamily:"monospace", fontSize:"12px", lineHeight:"1.7" }} />
                    </Field>
                    {importError && <Alert type="error">{importError}</Alert>}
                    <Btn onClick={importYaml} disabled={!importText.trim()}>📋 Import YAML</Btn>
                  </>
                )}
                {subEdit === "pick" && (
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
            {OutputRight()}
          </div>
        </div>
      )}

    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 2 — TEST SPEC
// ═══════════════════════════════════════════════════════════════════════════════

function PageTestSpec({ serverOnline, targetOrg = "my-dev-org" }) {
  const isMobile = useIsMobile();

  // Mode: "new_from_agent" | "append_existing" | "from_ai_eval"
  const [mode, setMode] = useState("new_from_agent");

  // Main tab: "testspec" | "newtest" | "run" | "history"
  const [mainTab, setMainTab] = useState("testspec");

  // Testing Center state
  const [runAgentFile, setRunAgentFile]     = useState(null);
  const [runSpecFile, setRunSpecFile]       = useState(null);
  const [runCopied, setRunCopied]           = useState(false);
  const [tcAgentFile, setTcAgentFile]       = useState(null);
  const [tcApiName, setTcApiName]           = useState("");
  const [tcSpecFile, setTcSpecFile]         = useState(null);
  const [tcCustomOrg, setTcCustomOrg]       = useState("");
  const [tcUseCustomOrg, setTcUseCustomOrg] = useState(false);
  const [tcWaitMinutes, setTcWaitMinutes]   = useState(10);
  const [tcJsonMode, setTcJsonMode]         = useState(true);
  const [tcJobId, setTcJobId]               = useState("");

  // Shared
  const [yaml, setYaml]         = useState("");
  const [copied, setCopied]     = useState(false);
  const [history, setHistory]   = useState([]);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [error, setError]       = useState("");

  // New from .agent
  const [agentFile, setAgentFile]       = useState(null);
  const [selectedMetrics, setSelectedMetrics] = useState(METRICS.filter(m => !m.locked).map(m => m.id));
  const [selectedTopics, setSelectedTopics]   = useState([]);
  const [testsPerTopic, setTestsPerTopic]     = useState(2);
  const [generateMethod, setGenerateMethod] = useState("cli"); // "cli" | "ai" | "gherkin"
  const [includeCustomEval, setIncludeCustomEval] = useState(false);
  const [specPrefix, setSpecPrefix]               = useState("");
  const [agentGherkinInput, setAgentGherkinInput] = useState("");
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
      const LOCKED = ["instruction_following", "factuality"];
      const activeMetrics = selectedMetrics.filter(m => !LOCKED.includes(m));
      const metricsStr = activeMetrics.map(m => `      - ${m}`).join("\n");
      const topicsList = selectedTopics.map(t => `- ${t}`).join("\n");
      const r = await callAI(TEST_FROM_AGENT_PROMPT,
        `.agent file content:\n\n${agentFile.content}\n\nTopics to test (generate ONLY for these):\n${topicsList}\n\nTests per topic: ${testsPerTopic}\n\nSelected metrics (USE ONLY THESE — NO OTHERS, bare values without 'name:' key):\n${metricsStr}\n\nInclude custom evaluations: ${includeCustomEval ? "YES — add customEvaluations with JSONPath/operator/expectedValue for edge cases" : "NO — omit customEvaluations entirely (leave as empty array [])"}\n\nIMPORTANT: Generate exactly ${testsPerTopic} test case(s) per topic listed above. Total test cases: ${selectedTopics.length * testsPerTopic}.`);
      setYaml(r); setHistory([r]);
    } catch (e) { setError(e.message); }
    setGenerating(false);
  };

  // ── Generate new testSpec from .agent + Gherkin ──
  const generateFromAgentGherkin = async () => {
    if (!agentFile || !agentGherkinInput.trim()) return;
    setGenerating(true); setError(""); setYaml("");
    try {
      const agentName = parseAgentDeveloperName(agentFile.content) || agentFile.name.replace(".agent","");
      const topics = parseAgentTopics(agentFile.content);
      const r = await callAI(TEST_FROM_GHERKIN_PROMPT,
        `.agent file content:

${agentFile.content}

Agent API name: ${agentName}
Available topics: ${topics.join(", ")}

Gherkin scenarios:

${agentGherkinInput}`);
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

  // CLI
  const specBaseName  = specPrefix.trim() || subjectName || "agent";
  const specFilename  = `${specBaseName}-testSpec.yaml`;

  const MODES = [
    { id: "new_from_agent",  icon: "➕", label: "New from .agent",             sub: "Generate from agent script" },
    { id: "from_ai_eval",    icon: "📄", label: "Convert from AiEvaluationDefinition", sub: "Convert XML metadata"        },
    { id: "append_existing", icon: "✏️", label: "Edit/Append to existing",          sub: "Add cases to existing spec"  },
  ];


  // Testing Center computed
  const tcOrg = tcUseCustomOrg && tcCustomOrg.trim() ? tcCustomOrg.trim() : targetOrg;
  const tcReady = tcApiName.trim().length > 0;
  const tcSpecPath = tcSpecFile ? "tests/" + tcSpecFile.name : "tests/" + (tcApiName || "MyAgent") + "-testSpec.yaml";
  const tcJsonFlag = tcJsonMode ? " --json" : "";
  const tcCreateCmd = "sf agent test create" +
    " --spec " + tcSpecPath +
    " --api-name " + (tcApiName || "MyAgent") +
    " --target-org " + tcOrg + tcJsonFlag;
  const tcRunCmd = "sf agent test run" +
    " --api-name " + (tcApiName || "MyAgent") +
    " --target-org " + tcOrg +
    " --wait " + tcWaitMinutes + tcJsonFlag;
  const tcResultsCmd = tcJobId.trim()
    ? "sf agent test results --job-id " + tcJobId.trim() + " --target-org " + tcOrg + tcJsonFlag
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>

      {/* Main tab bar */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: "20px" }}>
        {[
          { id: "testspec", icon: "🧪", label: "Test Spec",       sub: "Generate testSpec.yaml" },
          { id: "newtest",  icon: "🎯", label: "Run Test",        sub: "Create & run test"       },
          { id: "run",      icon: "🔁", label: "Test & Fix",       sub: "Full cycle with AI skill"  },
          { id: "history",  icon: "📋", label: "Testing History", sub: "Formal test results"       },
        ].map(({ id, icon, label, sub }) => {
          const active = mainTab === id;
          return (
            <button key={id} onClick={() => setMainTab(id)} style={{
              padding: "12px 24px 11px", background: "none", border: "none",
              borderBottom: `2px solid ${active ? C.brand : "transparent"}`,
              cursor: "pointer", textAlign: "left", transition: "all 0.15s", marginBottom: "-1px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <span style={{ fontSize: "13px" }}>{icon}</span>
                <span style={{ fontSize: "13px", fontWeight: "700", color: active ? C.text : C.textWeak }}>{label}</span>
              </div>
              <div style={{ fontSize: "11px", color: active ? C.textWeak : C.textWeaker, marginTop: "2px", paddingLeft: "20px" }}>{sub}</div>
            </button>
          );
        })}
      </div>

      {mainTab === "run" && (() => {
        const runAgentApiName  = runAgentFile ? (parseAgentDeveloperName(runAgentFile.content) || runAgentFile.name.replace(".agent","")) : "";
        const runTestSpecName  = runSpecFile  ? runSpecFile.name.replace(".yaml","") : "";
        const runOrg           = targetOrg;
        const ready            = runAgentApiName && runTestSpecName;

        const runPrompt = ready ? `AgentName = ${runAgentApiName}
Target org = ${runOrg}
Test Spec = ${runTestSpecName}

Use the sf-ai-agentforce-testing skill: run formal tests for [${runAgentApiName}] on org [${runOrg}] using the existing tests/[${runTestSpecName}.yaml].

Execute the full cycle: sf agent test create → sf project deploy start → sf agent test run.

Store results in /formal-tests/[${runAgentApiName}]/[${runTestSpecName}]/Results/.

Fix loop max 3 iterations, store each fix loop record in /formal-tests/[${runAgentApiName}]/[${runTestSpecName}]/FixLoop/ using the template at /templates/FixLoopTemplate.json. Commit after each iteration test([${runAgentApiName}] fix loop iteration N.

Cross-skill delegation rules:
- topic_assertion or actions_assertion failures → use sf-ai-agentscript skill to fix the .agent, re-validate, re-publish before retrying
- action invocation failures → use sf-flow or sf-apex skill to inspect and fix the backing Flow before retrying
- deployment failures → use sf-deploy skill to diagnose and resolve before retrying` : null;

        return (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px", alignItems:"start" }}>

            {/* ── Left col ── */}
            <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
              <Card>
                <CardHeader icon="🦾" title="Agent Skill" subtitle="Generate a prompt for the sf-ai-agentforce-testing skill" />
                <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>

                  <FilePicker label=".agent file" route="/files/agents"
                    filterFn={f => f.name.endsWith(".agent") || f.content?.includes("developer_name:")}
                    selected={runAgentFile} serverOnline={serverOnline}
                    onSelect={f => { setRunAgentFile(f); }}
                    emptyMsg="No .agent files found." />

                  {runAgentApiName && (
                    <div style={{ fontSize:"12px", color:C.textWeak, marginTop:"-8px" }}>
                      Agent API name: <code style={{ color:C.brand }}>{runAgentApiName}</code>
                    </div>
                  )}

                  <FilePicker label="testSpec (from tests/)" route="/files/tests"
                    filterFn={f => f.content?.includes("subjectType:") || f.name.includes("testSpec")}
                    selected={runSpecFile} serverOnline={serverOnline}
                    onSelect={f => setRunSpecFile(f)}
                    emptyMsg="No testSpec files found in tests/." />

                  {runTestSpecName && (
                    <div style={{ fontSize:"12px", color:C.textWeak, marginTop:"-8px" }}>
                      → <code style={{ color:C.textWeak }}>tests/{runTestSpecName}.yaml</code>
                    </div>
                  )}

                  <Field label="Target org">
                    <div style={{ padding:"8px 12px", background:C.surfaceAlt, border:`1px solid ${C.border}`,
                                  borderRadius:C.radius, fontSize:"12px", fontFamily:"monospace", color:C.brand }}>
                      {runOrg}
                    </div>
                    <div style={{ fontSize:"11px", color:C.textWeaker, marginTop:"4px" }}>
                      Detected from project — configure in .env to change
                    </div>
                  </Field>

                  {ready && (
                    <Btn onClick={() => {
                      navigator.clipboard.writeText(runPrompt);
                      setRunCopied(true);
                      setTimeout(() => setRunCopied(false), 2000);
                    }}>
                      {runCopied ? "✓ Copied!" : "⎘ Copy prompt"}
                    </Btn>
                  )}
                </div>
              </Card>

            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            {/* ── Right col — prompt ── */}
            {ready ? (
              <div style={{ display:"flex", flexDirection:"column", gap:"0",
                            border:`1px solid ${C.border}`, borderRadius:C.radiusMd,
                            overflow:"hidden", position:"sticky", top:"16px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                              padding:"10px 14px", background:C.surfaceAlt,
                              borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:"12px", fontWeight:"700", color:C.text }}>
                    🦾 sf-ai-agentforce-testing prompt
                  </span>
                  <Btn size="sm" variant="neutral" onClick={() => {
                    navigator.clipboard.writeText(runPrompt);
                    setRunCopied(true);
                    setTimeout(() => setRunCopied(false), 2000);
                  }}>
                    {runCopied ? "✓ Copied" : "⎘ Copy"}
                  </Btn>
                </div>
                <div style={{ padding:"16px", background:C.surface, fontFamily:"monospace",
                              fontSize:"12px", lineHeight:"1.8", color:C.textWeak,
                              whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                  {runPrompt.split("\n").map((line, i) => {
                    if (line.match(/^(AgentName|Target org|Test Spec) = /)) {
                      const eq = line.indexOf(" = ");
                      return <div key={i}>
                        <span style={{ color:C.textWeaker }}>{line.substring(0, eq)} = </span>
                        <span style={{ color:C.brand, fontWeight:"700" }}>{line.substring(eq+3)}</span>
                      </div>;
                    }
                    if (line.startsWith("Use the") || line.startsWith("Execute") || line.startsWith("Store") || line.startsWith("Fix loop") || line.startsWith("Cross-skill")) {
                      return <div key={i} style={{ marginTop:"12px", color:C.text, fontWeight:"600" }}>{line}</div>;
                    }
                    if (line.startsWith("- ")) {
                      return <div key={i} style={{ paddingLeft:"12px", color:C.textWeak, marginTop:"2px" }}>
                        <span style={{ color:C.warning }}>→</span>{line.substring(1)}
                      </div>;
                    }
                    if (line === "") return <div key={i} style={{ height:"4px" }} />;
                    return <div key={i} style={{ color:C.textWeak }}>{line}</div>;
                  })}
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                            minHeight:"320px", border:`1px dashed ${C.border}`,
                            borderRadius:C.radiusMd, flexDirection:"column", gap:"12px",
                            color:C.textWeaker }}>
                <span style={{ fontSize:"36px" }}>🦾</span>
                <span style={{ fontSize:"14px", fontWeight:"600", color:C.textWeak }}>
                  sf-ai-agentforce-testing prompt
                </span>
                <span style={{ fontSize:"12px", textAlign:"center", maxWidth:"220px", lineHeight:"1.6" }}>
                  Select an agent and a test spec to generate the prompt
                </span>
              </div>
            )}
              {/* How it works */}
              <Card>
                <CardHeader title="How it works" subtitle="sf-ai-agentforce-testing runs the full test cycle autonomously" />
                <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"12px" }}>
                  {[
                    { step:"1", title:"Select your agent & test spec", desc:"Pick the .agent file and testSpec.yaml from your SFDX project. The prompt is generated automatically." },
                    { step:"2", title:"Paste into your AI coding agent", desc:"Works with Claude Code, Cursor, Codex, Gemini CLI — any tool with MCP skill support." },
                    { step:"3", title:"Full cycle runs autonomously", desc:"The skill creates the test, deploys, runs it, and stores results in formal-tests/ with the correct structure." },
                    { step:"4", title:"Fix loops handled automatically", desc:"On failure, the AI analyzes the issue, applies the right skill (agentscript, flow, apex, deploy), and retries up to 3 times." },
                  ].map(({ step, title, desc }) => (
                    <div key={step} style={{ display:"flex", gap:"12px", alignItems:"flex-start" }}>
                      <div style={{ width:"24px", height:"24px", borderRadius:"50%", background:C.brandLight,
                                    border:`1px solid ${C.brand}`, display:"flex", alignItems:"center",
                                    justifyContent:"center", fontSize:"11px", fontWeight:"700",
                                    color:C.brand, flexShrink:0, marginTop:"1px" }}>{step}</div>
                      <div>
                        <div style={{ fontSize:"13px", fontWeight:"600", color:C.text, marginBottom:"2px" }}>{title}</div>
                        <div style={{ fontSize:"12px", color:C.textWeak, lineHeight:"1.5" }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"14px", display:"flex", flexDirection:"column", gap:"8px" }}>
                  <label style={labelStyle}>Resources</label>
                  {[
                    { label:"sf-ai-agentforce-testing — GitHub", url:"https://github.com/Jaganpro/sf-skills/blob/main/README.md", credit:true },
                    { label:"Agentforce Testing Center", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html" },
                    { label:"AiEvaluationDefinition reference", url:"https://developer.salesforce.com/docs/ai/agentforce/references/testing-api/testing-metadata-reference.html" },
                    { label:"Customize agent test spec", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html" },
                  ].map(({ label, url, credit }) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                      style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px",
                               background: credit ? C.brandLight : C.surfaceAlt,
                               border:`1px solid ${credit ? C.brand : C.border}`,
                               borderRadius:C.radius, color: credit ? C.brand : C.textWeak,
                               fontSize:"12px", fontWeight: credit ? "700" : "500", textDecoration:"none" }}>
                      <span>{credit ? "⭐" : "📄"}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ color: credit ? C.brand : C.text, fontWeight: credit ? "700" : "500" }}>{label}</div>
                        {credit && <div style={{ fontSize:"10px", color:C.textWeak, marginTop:"1px" }}>Credit: Jaganpro · sf-skills</div>}
                      </div>
                      <span style={{ fontSize:"11px", color:C.textWeaker }}>↗</span>
                    </a>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        );
      })()}

      {mainTab === "history" && (
        <TestingHistory serverOnline={serverOnline} projectName={projectName} />
      )}

      {mainTab === "newtest" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px", alignItems:"start" }}>

          {/* ── Left col — config ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <Card>
              <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"16px" }}>
                <FilePicker label=".agent file" route="/files/agents"
                  filterFn={f => f.name.endsWith(".agent") || f.content?.includes("developer_name:")}
                  selected={tcAgentFile} serverOnline={serverOnline}
                  onSelect={f => { setTcAgentFile(f); setTcApiName(parseAgentDeveloperName(f?.content) || f?.name?.replace(".agent","") || ""); }}
                  emptyMsg="No .agent files found." />
                <Field label="Agent API Name">
                  <input value={tcApiName} onChange={e => setTcApiName(e.target.value)}
                    placeholder="e.g. OrderSupport" style={{ ...inputStyle, fontFamily:"monospace" }} />
                </Field>
                <FilePicker label="testSpec (from tests/)" route="/files/tests"
                  filterFn={f => f.content?.includes("subjectType:") || f.name.includes("testSpec")}
                  selected={tcSpecFile} onSelect={setTcSpecFile} serverOnline={serverOnline}
                  emptyMsg="No testSpec files in tests/." />
                <Field label="Target Org">
                  <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                    <div style={{ padding:"8px 12px", background:C.surfaceAlt, border:`1px solid ${C.border}`,
                                  borderRadius:C.radius, fontFamily:"monospace", fontSize:"13px",
                                  color:tcUseCustomOrg ? C.textWeak : C.brand,
                                  textDecoration:tcUseCustomOrg ? "line-through" : "none" }}>{targetOrg}</div>
                    <label style={{ display:"flex", alignItems:"center", gap:"8px", cursor:"pointer" }}>
                      <input type="checkbox" checked={tcUseCustomOrg} onChange={e => setTcUseCustomOrg(e.target.checked)} style={{ accentColor:C.brand }} />
                      <span style={{ fontSize:"12px", color:C.textWeak }}>Use a different org</span>
                    </label>
                    {tcUseCustomOrg && <input value={tcCustomOrg} onChange={e => setTcCustomOrg(e.target.value)}
                      placeholder="my-other-org" style={{ ...inputStyle, fontFamily:"monospace" }} />}
                  </div>
                </Field>
                <Field label="Wait (minutes)">
                  <div style={{ display:"flex", gap:"6px" }}>
                    {[0,5,10,20].map(n => (
                      <button key={n} onClick={() => setTcWaitMinutes(n)} style={{ flex:1, padding:"7px", borderRadius:C.radius,
                        border:`1.5px solid ${tcWaitMinutes===n?C.brand:C.border}`,
                        background:tcWaitMinutes===n?C.brandLight:C.surface,
                        color:tcWaitMinutes===n?C.brand:C.textWeak, fontSize:"12px", fontWeight:"600", cursor:"pointer" }}>
                        {n===0?"async":n+"m"}
                      </button>
                    ))}
                  </div>
                </Field>
                <label style={{ display:"flex", alignItems:"center", gap:"8px", cursor:"pointer" }}>
                  <input type="checkbox" checked={tcJsonMode} onChange={e => setTcJsonMode(e.target.checked)} style={{ accentColor:C.brand }} />
                  <span style={{ fontSize:"12px", color:C.textWeak }}>Include <code>--json</code></span>
                </label>
              </div>
            </Card>
          </div>

          {/* ── Right col — commands + how it works ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            {tcReady ? (
              <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                <div style={{ padding:"12px 16px", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:C.radius,
                              display:"flex", gap:"16px", flexWrap:"wrap", alignItems:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                    <span style={{ fontSize:"11px", color:C.textWeaker, textTransform:"uppercase", fontWeight:"600" }}>Agent</span>
                    <code style={{ fontSize:"12px", color:C.brand, fontWeight:"700" }}>{tcApiName}</code>
                  </div>
                  <div style={{ width:"1px", height:"16px", background:C.border }} />
                  <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                    <span style={{ fontSize:"11px", color:C.textWeaker, textTransform:"uppercase", fontWeight:"600" }}>Org</span>
                    <code style={{ fontSize:"12px", color:C.textWeak }}>{tcOrg}</code>
                  </div>
                  <div style={{ width:"1px", height:"16px", background:C.border }} />
                  <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                    <span style={{ fontSize:"11px", color:C.textWeaker, textTransform:"uppercase", fontWeight:"600" }}>Spec</span>
                    <code style={{ fontSize:"12px", color:C.textWeak }}>{tcSpecPath}</code>
                  </div>
                </div>
                <Card><CardHeader title="1. Create Test" subtitle="Register the test spec in your org" />
                  <div style={{ padding:"16px" }}><CmdBlock label="sf agent test create" cmd={tcCreateCmd} serverOnline={serverOnline} /></div>
                </Card>
                <Card><CardHeader title="2. Run Test"
                  subtitle={tcWaitMinutes===0?"Async — get job ID then fetch results":"Sync — waits up to "+tcWaitMinutes+" minutes"} />
                  <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"10px" }}>
                    <CmdBlock label="sf agent test run" cmd={tcRunCmd} serverOnline={serverOnline} />
                    {tcWaitMinutes===0 && <Alert type="info">Copy the <code>jobId</code> from the output and paste it in Get Results.</Alert>}
                  </div>
                </Card>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"200px",
                            border:`1px dashed ${C.border}`, borderRadius:C.radiusMd,
                            flexDirection:"column", gap:"8px", color:C.textWeaker }}>
                <span style={{ fontSize:"28px" }}>🎯</span>
                <span style={{ fontSize:"13px" }}>Select an agent and a test spec to build the commands</span>
              </div>
            )}
            <Card>
              <CardHeader title="Get Results" subtitle="Fetch results by job ID after an async run" />
              <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"12px" }}>
                <Field label="Job ID">
                  <input value={tcJobId} onChange={e => setTcJobId(e.target.value)}
                    placeholder="e.g. 4KBfoo00000XXXXX" style={{ ...inputStyle, fontFamily:"monospace" }} />
                </Field>
                {tcResultsCmd && <CmdBlock label="sf agent test results" cmd={tcResultsCmd} serverOnline={serverOnline} />}
              </div>
            </Card>
            <Card>
              <CardHeader title="How it works" subtitle="Create, run and retrieve agent test results with the CLI" />
              <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"12px" }}>
                {[
                  { step:"1", title:"Create the test in your org", desc:"sf agent test create registers your testSpec.yaml as an AiEvaluationDefinition in your development org." },
                  { step:"2", title:"Run the test", desc:"sf agent test run executes the test. Use --wait for synchronous results, or capture the job ID for async retrieval." },
                  { step:"3", title:"Retrieve results by job ID", desc:"If you ran async, use sf agent test results --job-id to fetch the results once the test completes." },
                  { step:"4", title:"Analyze in Testing History", desc:"Results are stored in formal-tests/. Switch to the Testing History tab to visualize pass rates, latency, and fix loops." },
                ].map(({ step, title, desc }) => (
                  <div key={step} style={{ display:"flex", gap:"12px", alignItems:"flex-start" }}>
                    <div style={{ width:"24px", height:"24px", borderRadius:"50%", background:C.brandLight,
                                  border:`1px solid ${C.brand}`, display:"flex", alignItems:"center",
                                  justifyContent:"center", fontSize:"11px", fontWeight:"700",
                                  color:C.brand, flexShrink:0, marginTop:"1px" }}>{step}</div>
                    <div>
                      <div style={{ fontSize:"13px", fontWeight:"600", color:C.text, marginBottom:"2px" }}>{title}</div>
                      <div style={{ fontSize:"12px", color:C.textWeak, lineHeight:"1.5" }}>{desc}</div>
                    </div>
                  </div>
                ))}
                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"12px", display:"flex", flexDirection:"column", gap:"8px" }}>
                  <label style={labelStyle}>Resources</label>
                  {[
                    { label:"Run Agent Tests — Salesforce Docs", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-run.html" },
                    { label:"sf agent CLI reference", url:"https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_agent_commands_unified.htm" },
                  ].map(({ label, url }) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                      style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px",
                               background:C.surfaceAlt, border:`1px solid ${C.border}`,
                               borderRadius:C.radius, textDecoration:"none" }}>
                      <span>📄</span>
                      <div style={{ flex:1, fontSize:"12px", color:C.text }}>{label}</div>
                      <span style={{ fontSize:"11px", color:C.textWeaker }}>↗</span>
                    </a>
                  ))}
                </div>
              </div>
            </Card>
          </div>

        </div>
      )}


      {mainTab === "testspec" && (
        <>


        {/* Sub-tab bar */}
        <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, gap:"0" }}>
          {MODES.map(({ id, icon, label, sub, badge }) => {
            const active = mode === id;
            return (
              <button key={id} onClick={() => { setMode(id); resetOutput(); }} style={{
                padding:"10px 20px 9px", background:"none", border:"none",
                borderBottom:`2px solid ${active ? C.gold : "transparent"}`,
                cursor:"pointer", textAlign:"left", transition:"all 0.15s", marginBottom:"-1px",
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                  <span style={{ fontSize:"12px" }}>{icon}</span>
                  <span style={{ fontSize:"12px", fontWeight:"700", color:active ? C.text : C.textWeak }}>{label}</span>
                  {badge && <span style={{ fontSize:"9px", fontWeight:"700", color:"#fff", background:C.brand, borderRadius:"4px", padding:"1px 5px", letterSpacing:"0.5px", marginLeft:"2px" }}>{badge}</span>}
                </div>
                <div style={{ fontSize:"10px", color:active ? C.textWeak : C.textWeaker, marginTop:"2px", paddingLeft:"18px" }}>{sub}</div>
              </button>
            );
          })}
        </div>

        {mode === "new_from_agent" && (
            <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, gap:"0", marginTop:"16px" }}>
              {[
                { id:"cli",     icon:"⌨️",  label:"Via CLI Command",  sub:"sf agent generate test-spec" },
                { id:"ai",      icon:"✨", label:"Via AI", sub:"AI infers test cases from topics" },
                { id:"gherkin", icon:"🥒", label:"Via Gherkin (AI)",     sub:"Convert scenarios", badge:"NEW" },
              ].map(({ id, icon, label, sub, badge }) => {
                const active = generateMethod === id;
                return (
                  <button key={id} onClick={() => setGenerateMethod(id)} style={{
                    padding:"10px 20px 9px", background:"none", border:"none",
                    borderBottom:`2px solid ${active ? C.gold : "transparent"}`,
                    cursor:"pointer", textAlign:"left", transition:"all 0.15s", marginBottom:"-1px",
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                      <span style={{ fontSize:"12px" }}>{icon}</span>
                      <span style={{ fontSize:"12px", fontWeight:"700", color:active ? C.text : C.textWeak }}>{label}</span>
                      {badge && <span style={{ fontSize:"9px", fontWeight:"700", color:"#fff", background:C.brand, borderRadius:"4px", padding:"1px 5px", letterSpacing:"0.5px", marginLeft:"2px" }}>{badge}</span>}
                    </div>
                    <div style={{ fontSize:"10px", color:active ? C.textWeak : C.textWeaker, marginTop:"2px", paddingLeft:"18px" }}>{sub}</div>
                  </button>
                );
              })}
            </div>
        )}

        {mode === "new_from_agent" && generateMethod === "cli" && (
              <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:"24px", alignItems:"start", marginTop:"16px" }}>

                {/* Left — info */}
                <Card>
                  <CardHeader icon="⌨️" title="Generate Test Spec via CLI"
                    subtitle="Interactive wizard — run in your terminal, not from AgentKit" />
                  <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
                    <Alert type="info">This command is <strong>interactive</strong> — it prompts you step by step in the terminal. Copy the command and run it yourself.</Alert>
                    <div style={{ fontSize:"12px", color:C.textWeak, lineHeight:"1.8", padding:"12px 14px",
                                  background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:C.radius }}>
                      <div style={{ fontWeight:"700", color:C.text, marginBottom:"8px" }}>The CLI will prompt for:</div>
                      {[
                        "Agent to test — select from your local DX project",
                        "Test name & description",
                        "For each test case: utterance, expected topic, expected actions, expected outcome",
                        "Optional: custom evaluations, conversation history",
                      ].map((item, i) => (
                        <div key={i} style={{ display:"flex", gap:"8px", marginBottom:"4px" }}>
                          <span style={{ color:C.brand, fontWeight:"700", flexShrink:0 }}>{i+1}.</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>

                {/* Right — command + how it works */}
                <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                  <div style={{ border:`1px solid ${C.border}`, borderRadius:C.radiusMd, overflow:"hidden" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                                  padding:"8px 14px", background:C.surfaceAlt, borderBottom:`1px solid ${C.border}` }}>
                      <span style={{ fontSize:"11px", fontWeight:"700", color:C.textWeak, textTransform:"uppercase", letterSpacing:"0.5px" }}>Command</span>
                      <button onClick={() => navigator.clipboard.writeText("sf agent generate test-spec")}
                        style={{ background:"none", border:"none", color:C.brand, cursor:"pointer", fontSize:"11px", fontWeight:"600" }}>
                        Copy
                      </button>
                    </div>
                    <div style={{ padding:"12px 14px", fontFamily:"JetBrains Mono, monospace", fontSize:"13px", color:"#79c0ff", background:"#0d1117" }}>
                      sf agent generate test-spec
                    </div>
                  </div>
                  <Card>
                    <CardHeader title="How it works" subtitle="Interactive test spec generation with the Salesforce CLI" />
                    <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"12px" }}>
                      {[
                        { step:"1", title:"Run in your terminal", desc:"cd into your SFDX project directory and run the command. The CLI searches your local project for agents." },
                        { step:"2", title:"Answer the prompts", desc:"Provide a test name, description, and one or more test cases with utterance, expected topic, actions, and outcome." },
                        { step:"3", title:"File saved in specs/", desc:"The test spec is saved as {AgentApiName}-testSpec.yaml in your specs/ directory." },
                        { step:"4", title:"Load it in AgentKit", desc:"Switch to 'Generate with AI' to refine it with AI, or go to New Test to run it directly." },
                      ].map(({ step, title, desc }) => (
                        <div key={step} style={{ display:"flex", gap:"12px", alignItems:"flex-start" }}>
                          <div style={{ width:"24px", height:"24px", borderRadius:"50%", background:C.brandLight,
                                        border:`1px solid ${C.brand}`, display:"flex", alignItems:"center",
                                        justifyContent:"center", fontSize:"11px", fontWeight:"700",
                                        color:C.brand, flexShrink:0, marginTop:"1px" }}>{step}</div>
                          <div>
                            <div style={{ fontSize:"13px", fontWeight:"600", color:C.text, marginBottom:"2px" }}>{title}</div>
                            <div style={{ fontSize:"12px", color:C.textWeak, lineHeight:"1.5" }}>{desc}</div>
                          </div>
                        </div>
                      ))}
                      <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"12px", display:"flex", flexDirection:"column", gap:"8px" }}>
                        <label style={labelStyle}>Resources</label>
                        {[
                          { label:"Generate a Test Spec File — Salesforce Docs", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html" },
                          { label:"sf agent CLI reference", url:"https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_agent_commands_unified.htm" },
                        ].map(({ label, url }) => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                            style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px",
                                     background:C.surfaceAlt, border:`1px solid ${C.border}`,
                                     borderRadius:C.radius, textDecoration:"none" }}>
                            <span>📄</span>
                            <div style={{ flex:1, fontSize:"12px", color:C.text }}>{label}</div>
                            <span style={{ fontSize:"11px", color:C.textWeaker }}>↗</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  </Card>
                </div>

              </div>
        )}

        <div style={{ display: mode === "new_from_agent" && generateMethod === "cli" ? "none" : "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>


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
                  cmd={`sf agent generate test-spec \\\n  --from-definition force-app/main/default/aiEvaluationDefinitions/MyAgent.aiEvaluationDefinition-meta.xml \\\n  --output-file tests/MyAgent-testSpec.yaml`} />
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
                  emptyMsg="No .aiEvaluationDefinition-meta.xml found — use Paste XML below, or run: sf project retrieve start --target-org ${targetOrg}"
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
          <>
            {generateMethod !== "cli" && (
            <div style={{ padding: "20px 16px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
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

                  {/* Agent name — always shown */}
                  <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: C.radius, padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "600", color: C.textWeak }}>Agent detected:</span>
                    <code style={{ fontSize: "13px", color: C.brand }}>{parseAgentDeveloperName(agentFile.content) || agentFile.name.replace(".agent","")}</code>
                  </div>

                  {/* Topics, tests per topic, metrics — AI method only */}
                  {generateMethod === "ai" && allTopics.length > 0 ? (
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
                  ) : generateMethod === "ai" ? (
                    <Alert type="warning">No topics detected in this .agent file. The AI will infer topics from the file content.</Alert>
                  ) : null}

                  {generateMethod === "ai" && <>
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
                  <Field label="Test spec filename">
                    <div style={{ display:"flex", alignItems:"center", gap:"0" }}>
                      <input value={specPrefix} onChange={e => setSpecPrefix(e.target.value.replace(/[^a-zA-Z0-9_-]/g,""))}
                        placeholder={subjectName || "AgentName"}
                        style={{ ...inputStyle, borderRadius:`${C.radius} 0 0 ${C.radius}`, borderRight:"none", flex:1, fontFamily:"monospace", fontSize:"12px" }} />
                      <span style={{ padding:"8px 12px", background:C.surfaceAlt, border:`1px solid ${C.border}`,
                                     borderRadius:`0 ${C.radius} ${C.radius} 0`, fontSize:"12px",
                                     color:C.textWeak, whiteSpace:"nowrap", fontFamily:"monospace" }}>
                        -testSpec.yaml
                      </span>
                    </div>
                    <div style={{ fontSize:"11px", color:C.textWeaker, marginTop:"4px" }}>
                      → <code style={{ color:C.textWeak }}>{specFilename}</code>
                    </div>
                  </Field>

                  <Field label="Metrics to evaluate">
                    <MetricsSelector selected={selectedMetrics} onChange={setSelectedMetrics} />
                  </Field>
                  </>}

                  {/* Custom evaluations option */}
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer",
                                  padding: "10px 12px", background: includeCustomEval ? "rgba(31,111,235,0.06)" : C.surfaceAlt,
                                  border: `1px solid ${includeCustomEval ? C.brand : C.border}`,
                                  borderRadius: C.radius, transition: "all 0.15s" }}>
                    <input type="checkbox" checked={includeCustomEval} onChange={e => setIncludeCustomEval(e.target.checked)}
                      style={{ accentColor: C.brand, marginTop: "2px" }} />
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: "600", color: C.text }}>Include custom evaluations</div>
                      <div style={{ fontSize: "11px", color: C.textWeak, marginTop: "2px", lineHeight: "1.5" }}>
                        Adds <code>customEvaluations</code> with JSONPath/operator assertions. Leave unchecked for a standard testSpec compatible with all workflows.
                      </div>
                    </div>
                  </label>

                  {error && <Alert type="error">{error}</Alert>}

                  {generateMethod === "ai" && (
                    <Btn onClick={generateFromAgent}
                      disabled={generating || !serverOnline || selectedTopics.length === 0}>
                      {generating
                        ? <><Spinner size={12} /> Generating…</>
                        : `✨ Generate ${totalTests} test case${totalTests !== 1 ? "s" : ""} (${selectedTopics.length} topic${selectedTopics.length !== 1 ? "s" : ""} × ${testsPerTopic})`}
                    </Btn>
                  )}
                </>);
              })()}

              {/* Gherkin sub-tab */}
              {generateMethod === "gherkin" && agentFile && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <Alert type="info">
                    Paste one or more Gherkin scenarios. Claude will generate a complete <code>testSpec.yaml</code> using the topics and actions from the selected <code>.agent</code> file.
                  </Alert>
                  <Field label="Gherkin scenarios"
                    hint="Given / When / Then — one or more scenarios">
                    <textarea
                      value={agentGherkinInput}
                      onChange={e => setAgentGherkinInput(e.target.value)}
                      rows={10}
                      placeholder={"Feature: Flight cancellation\n\nScenario: Passenger cancels a booking\n  Given the passenger provides booking reference PNR-12345\n  When they request cancellation\n  Then the agent verifies identity and processes the cancellation"}
                      style={{ ...inputStyle, fontFamily: "monospace", fontSize: "12px",
                               resize: "vertical", lineHeight: "1.6" }}
                    />
                  </Field>
                  {error && <Alert type="error">{error}</Alert>}
                  <Btn onClick={generateFromAgentGherkin}
                    disabled={generating || !serverOnline || !agentGherkinInput.trim()}>
                    {generating
                      ? <><Spinner size={12} /> Generating…</>
                      : "🥒 Generate testSpec.yaml from Gherkin"}
                  </Btn>
                </div>
              )}
              {generateMethod === "gherkin" && !agentFile && (
                <Alert type="warning">Select an <code>.agent</code> file above first — it provides topics and actions context for the Gherkin conversion.</Alert>
              )}

              {!serverOnline && <Alert type="warning">Server offline — start <code>tdad-server.js</code>.</Alert>}
            </div>
            )}
          </>
        )}

        {/* ── Mode B: Append to existing ── */}
        {mode === "append_existing" && (
          <Card>
            <CardHeader title="Select an existing testSpec.yaml" subtitle="Pick a spec to complete, then add test cases with AI or Gherkin" />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <FilePicker
                label="testSpec files in tests/"
                route="/files/tests" filterFn={f => f.content?.includes("subjectType:") || f.name.includes("testSpec")}
                selected={existingSpec}
                onSelect={f => { setExistingSpec(f); setYaml(f.content); setHistory([f.content]); }}
                emptyMsg="No testSpec files found in tests/."
                serverOnline={serverOnline}
              />

              {existingSpec && (
                <>
                  <div style={{ display: "flex", gap: "8px", borderBottom: `1px solid ${C.border}`, paddingBottom: "12px" }}>
                    {[["agent", "🤖", "Add via .agent file", null], ["gherkin", "🥒", "Add via Gherkin", "NEW"]].map(([id, icon, label, badge]) => (
                      <button key={id} onClick={() => setAppendMode(id)}
                        style={{ padding: "7px 14px", borderRadius: C.radius, border: `1px solid ${appendMode === id ? C.brand : C.border}`,
                                 background: appendMode === id ? C.brandLight : C.surface, color: appendMode === id ? C.brandDark : C.textWeak,
                                 fontSize: "12px", fontWeight: "600", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
                        {icon} {label}
                        {badge && <span style={{ fontSize: "9px", fontWeight: "700", color: "#fff", background: C.brand, borderRadius: "4px", padding: "1px 5px", marginLeft: "2px" }}>{badge}</span>}
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

      {/* Right col — output */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: mode === "new_from_agent" && generateMethod !== "cli" ? "58px" : "0" }}>
      {/* Output — always visible, shows placeholder when empty */}
      {yaml ? (
        <OutputPanel
          title={specFilename} filename={specFilename}
          saveRoute="/files/save-test"
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
          onManualEdit={v => { setHistory(h => [...h, v]); setYaml(v); }}
          serverOnline={serverOnline}
          cliContent={
            <>
              <CmdBlock label="1a. Generate test spec via CLI (interactive)" serverOnline={serverOnline}
                note="Alternative to AI generation — uses Salesforce API"
                cmd={`sf agent generate test-spec \\\n  --agent-api-name ${subjectName||"MyAgent"} \\\n  --target-org ${targetOrg}`} />
              <CmdBlock label="1b. Convert AiEvaluationDefinition XML → testSpec" serverOnline={serverOnline}
                note="If you already have an AiEvaluationDefinition metadata XML in your project"
                cmd={`sf agent generate test-spec \\\n  --from-definition force-app/main/default/aiEvaluationDefinitions/${subjectName||"MyAgent"}.aiEvaluationDefinition-meta.xml \\\n  --output-file tests/${specFilename}`} />
              <CmdBlock label="2. Create test in org (preview)" serverOnline={serverOnline}
                cmd={`sf agent test create \\\n  --spec tests/${specFilename} \\\n  --preview \\\n  --target-org ${targetOrg}`} />
              <CmdBlock label="3. Create test in org" serverOnline={serverOnline}
                cmd={`sf agent test create \\\n  --spec tests/${specFilename} \\\n  --target-org ${targetOrg}`} />
              <CmdBlock label="4. Run tests (async)" serverOnline={serverOnline}
                cmd={`sf agent test run \\\n  --name ${subjectName||"MyAgent"}Test \\\n  --target-org ${targetOrg}`} />
              <CmdBlock label="4b. Run tests (sync, wait 10min)" serverOnline={serverOnline}
                cmd={`sf agent test run \\\n  --name ${subjectName||"MyAgent"}Test \\\n  --wait 10 \\\n  --target-org ${targetOrg}`} />
              <CmdBlock label="5. Get results" serverOnline={serverOnline}
                cmd={`sf agent test results \\\n  --job-id <JOB_ID> \\\n  --target-org ${targetOrg}`} />
            </>
          }
          footer={
            <Alert type="success">
              <strong>Ready to run.</strong> Save to project, then create and run the test in your org with the CLI commands above.
            </Alert>
          }
        />
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                      minHeight: "320px", border: `1px dashed ${C.border}`,
                      borderRadius: C.radiusMd, color: C.textWeaker,
                      flexDirection: "column", gap: "12px" }}>
          <span style={{ fontSize: "36px" }}>🧪</span>
          <span style={{ fontSize: "14px", fontWeight: "600", color: C.textWeak }}>testSpec.yaml</span>
          <span style={{ fontSize: "12px", textAlign: "center", maxWidth: "200px", lineHeight: "1.6" }}>
            Generate or load a test spec to preview it here
          </span>
        </div>

      )}
      </div>
        </div>
        </>
      )}

    </div>
  );
}



// ═══════════════════════════════════════════════════════════════════════════════
// TESTING HISTORY — Formal test results browser
// ═══════════════════════════════════════════════════════════════════════════════

const METRIC_META = {
  topic_assertion:              { label: "Topic",       icon: "🗺", scored: false },
  actions_assertion:            { label: "Actions",     icon: "⚡", scored: false },
  output_validation:            { label: "Output",      icon: "💬", scored: true  },
  coherence:                    { label: "Coherence",   icon: "📖", scored: true  },
  output_latency_milliseconds:  { label: "Latency",     icon: "⏱", scored: false, latency: true },
};

function TestingHistory({ serverOnline, projectName = "" }) {
  // nav: "agents" | "suites" | "runs" | "report"
  const [view, setView]                 = useState("agents");
  const [agents, setAgents]             = useState([]);
  const [suites, setSuites]             = useState([]);
  const [runs, setRuns]                 = useState([]);
  const [reportData, setReportData]     = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedSuite, setSelectedSuite] = useState(null);
  const [selectedRun, setSelectedRun]   = useState(null);
  const [expandedTc, setExpandedTc]     = useState(null);
  const [expandedFix, setExpandedFix]   = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");

  const load = async (url, setter) => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}${url}`);
      const d = await r.json();
      if (d.ok) setter(d);
      else setError(d.error || "Error loading data");
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  useEffect(() => {
    if (serverOnline && view === "agents") load("/history/agents", d => setAgents(d.agents || []));
  }, [serverOnline, view]);

  const goAgent = (name) => {
    setSelectedAgent(name); setView("suites");
    load(`/history/suites?agent=${encodeURIComponent(name)}`, d => setSuites(d.suites || []));
  };

  const goSuite = (suite) => {
    setSelectedSuite(suite.name); setView("runs");
    load(`/history/runs?agent=${encodeURIComponent(selectedAgent)}&suite=${encodeURIComponent(suite.name)}`, d => setRuns(d.runs || []));
  };

  const goRun = async (run) => {
    setSelectedRun(run); setView("report"); setExpandedTc(null);
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}/history/report?agent=${encodeURIComponent(selectedAgent)}&suite=${encodeURIComponent(selectedSuite)}&file=${encodeURIComponent(run.file)}`);
      const d = await r.json();
      if (d.ok) setReportData(d.data);
      else setError(d.error);
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const goBack = () => {
    if (view === "report") { setView("runs"); setReportData(null); setSelectedRun(null); }
    else if (view === "runs")  { setView("suites"); setRuns([]); setSelectedSuite(null); }
    else if (view === "suites"){ setView("agents"); setSuites([]); setSelectedAgent(null); }
  };

  // ── Helpers ──
  const passColor = (rate) => rate === 100 ? C.success : rate >= 60 ? C.warning : C.error;
  const passClass = (rate) => rate === 100 ? C.success : rate >= 60 ? C.warning : C.error;
  const fmt = (iso) => iso ? iso.replace("T"," ").replace("Z","").substring(0,16) : "—";
  const latColor = (ms) => ms < 2000 ? C.success : ms < 5000 ? C.warning : C.error;
  const scoreToColor = (s) => s >= 80 ? C.success : s >= 60 ? C.warning : C.error;
  const gradeLabel = (s) => { if (s === null || s === undefined) return '—'; if (s >= 97) return 'A+'; if (s >= 93) return 'A'; if (s >= 90) return 'A-'; if (s >= 87) return 'B+'; if (s >= 83) return 'B'; if (s >= 80) return 'B-'; if (s >= 77) return 'C+'; if (s >= 73) return 'C'; if (s >= 70) return 'C-'; if (s >= 67) return 'D+'; if (s >= 63) return 'D'; if (s >= 60) return 'D-'; return 'F'; };

  const Breadcrumb = () => (
    <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"16px",
                  fontSize:"12px", color:C.textWeak }}>
      <button onClick={() => { setView("agents"); setSelectedAgent(null); setSuites([]); setRuns([]); }}
        style={{ background:"none", border:"none", color:C.brand, cursor:"pointer", fontSize:"12px", fontWeight:"600" }}>
        ⌂ All agents
      </button>
      {selectedAgent && <>
        <span style={{ color:C.textWeaker }}>/</span>
        <button onClick={() => { setView("suites"); setSelectedSuite(null); setRuns([]); }}
          style={{ background:"none", border:"none", color: view === "suites" ? C.text : C.brand, cursor:"pointer", fontSize:"12px", fontWeight: view==="suites"?"700":"500" }}>
          {selectedAgent}
        </button>
      </>}
      {selectedSuite && <>
        <span style={{ color:C.textWeaker }}>/</span>
        <button onClick={() => { setView("runs"); setSelectedRun(null); setReportData(null); }}
          style={{ background:"none", border:"none", color: view === "runs" ? C.text : C.brand, cursor:"pointer", fontSize:"12px", fontWeight: view==="runs"?"700":"500" }}>
          {selectedSuite}
        </button>
      </>}
      {selectedRun && <>
        <span style={{ color:C.textWeaker }}>/</span>
        <span style={{ color:C.text, fontWeight:"700" }}>{selectedRun.runId?.substring(0,15) || "Run"}</span>
      </>}
    </div>
  );

  const Empty = ({ msg }) => (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                  minHeight:"200px", gap:"10px", color:C.textWeaker }}>
      <span style={{ fontSize:"32px" }}>📭</span>
      <span style={{ fontSize:"13px" }}>{msg}</span>
    </div>
  );

  // ── View: Agents index ──────────────────────────────────────────────────────
  if (view === "agents") return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:"16px", fontWeight:"700", color:C.text }}>Formal Test Results</div>
          <div style={{ fontSize:"12px", color:C.textWeak, marginTop:"2px" }}>
            Results read from <code>{(projectName || "SF_PROJECT_PATH") + "/formal-tests/"}</code>
          </div>
        </div>
        <Btn size="sm" onClick={() => load("/history/agents", d => setAgents(d.agents || []))} disabled={loading}>
          {loading ? <><Spinner size={10}/> Loading…</> : "↺ Refresh"}
        </Btn>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {!loading && agents.length === 0 && (
        <Empty msg="No formal-tests/ directory found. Run sf agent test run and save results to start." />
      )}
      {agents.length > 0 && (
        <div style={{ border:`1px solid ${C.border}`, borderRadius:C.radiusMd, overflow:"hidden", background:C.surface }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:C.surfaceAlt }}>
                {["Agent","Test suites","Total runs","Latest pass rate",""].map(h => (
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:"11px", fontWeight:"700",
                    textTransform:"uppercase", letterSpacing:"0.5px", color:C.textWeak,
                    borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map(a => (
                <tr key={a.name} onClick={() => goAgent(a.name)}
                  style={{ cursor:"pointer", borderBottom:`1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background=C.surfaceAlt}
                  onMouseLeave={e => e.currentTarget.style.background=""}>
                  <td style={{ padding:"12px 14px" }}>
                    <span style={{ fontSize:"13px", fontWeight:"700", color:C.brand }}>{a.name}</span>
                  </td>
                  <td style={{ padding:"12px 14px", fontSize:"12px", color:C.textWeak }}>{a.suites}</td>
                  <td style={{ padding:"12px 14px", fontSize:"12px", color:C.textWeak }}>{a.totalRuns}</td>
                  <td style={{ padding:"12px 14px" }}>
                    {a.latestPassRate !== null
                      ? <span style={{ fontSize:"13px", fontWeight:"700", color:passColor(a.latestPassRate) }}>
                          {a.latestPassRate === 100 ? `✓ ${a.latestRun?.passed}/${a.latestRun?.total}` : `${a.latestRun?.passed}/${a.latestRun?.total}`}
                          {" "}{a.latestPassRate}%
                        </span>
                      : <span style={{ color:C.textWeaker }}>—</span>}
                  </td>
                  <td style={{ padding:"12px 14px", textAlign:"right", color:C.brand, fontSize:"12px" }}>View →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── View: Suites ────────────────────────────────────────────────────────────
  if (view === "suites") return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <Breadcrumb />
      <div style={{ fontSize:"16px", fontWeight:"700", color:C.text }}>{selectedAgent}</div>
      {error && <Alert type="error">{error}</Alert>}
      {loading && <div style={{ color:C.textWeak, fontSize:"12px" }}><Spinner size={11}/> Loading…</div>}
      {!loading && suites.length === 0 && <Empty msg="No test suites found for this agent." />}
      {suites.length > 0 && (
        <div style={{ border:`1px solid ${C.border}`, borderRadius:C.radiusMd, overflow:"hidden", background:C.surface }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:C.surfaceAlt }}>
                {["Test Suite","Runs","Fix loops","Latest pass rate","Latest run",""].map(h => (
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:"11px", fontWeight:"700",
                    textTransform:"uppercase", letterSpacing:"0.5px", color:C.textWeak,
                    borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suites.map(s => (
                <tr key={s.name} onClick={() => goSuite(s)}
                  style={{ cursor:"pointer", borderBottom:`1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background=C.surfaceAlt}
                  onMouseLeave={e => e.currentTarget.style.background=""}>
                  <td style={{ padding:"12px 14px" }}>
                    <span style={{ fontSize:"13px", fontWeight:"700", color:C.brand }}>{s.name}</span>
                  </td>
                  <td style={{ padding:"12px 14px", fontSize:"12px", color:C.textWeak }}>{s.runs}</td>
                  <td style={{ padding:"12px 14px" }}>
                    {s.fixLoops > 0
                      ? <span style={{ background:"#fef3c7", color:"#92400e", border:"1px solid #fde68a",
                                       padding:"2px 8px", borderRadius:"10px", fontSize:"11px", fontWeight:"600" }}>
                          🔧 {s.fixLoops}
                        </span>
                      : <span style={{ color:C.textWeaker, fontSize:"12px" }}>—</span>}
                  </td>
                  <td style={{ padding:"12px 14px" }}>
                    {s.latestTotal > 0
                      ? <span style={{ fontSize:"13px", fontWeight:"700", color:passColor(Math.round(s.latestPassed/s.latestTotal*100)) }}>
                          {s.latestPassed}/{s.latestTotal} &nbsp;{Math.round(s.latestPassed/s.latestTotal*100)}%
                        </span>
                      : <span style={{ color:C.textWeaker }}>—</span>}
                  </td>
                  <td style={{ padding:"12px 14px", fontSize:"11px", color:C.textWeak }}>{fmt(s.latestTime)}</td>
                  <td style={{ padding:"12px 14px", textAlign:"right", color:C.brand, fontSize:"12px" }}>View →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── View: Runs list ─────────────────────────────────────────────────────────
  if (view === "runs") return (
    <div style={{ display:"flex", flexDirection:"column", gap:"0" }}>
      <Breadcrumb />
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"16px" }}>
        <div style={{ fontSize:"16px", fontWeight:"700", color:C.text }}>{selectedSuite}</div>
        <span style={{ fontSize:"12px", color:C.textWeak }}>{runs.length} run{runs.length!==1?"s":""}</span>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {loading && <div style={{ color:C.textWeak, fontSize:"12px" }}><Spinner size={11}/> Loading…</div>}
      {!loading && runs.length === 0 && <Empty msg="No runs found for this test suite." />}
      {runs.length > 0 && (
        <div style={{ border:`1px solid ${C.border}`, borderRadius:C.radiusMd, overflow:"hidden", background:C.surface }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:C.surfaceAlt }}>
                {["Date","Run ID","Pass Rate","Avg Latency","Δ vs Previous",""].map((h,i) => (
                  <th key={i} style={{ padding:"10px 14px", textAlign:"left", fontSize:"11px", fontWeight:"700",
                    textTransform:"uppercase", letterSpacing:"0.5px", color:C.textWeak,
                    borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run, idx) => {
                const rate = run.total > 0 ? Math.round(run.passed/run.total*100) : 0;
                const prevRun = runs[idx+1];
                const delta = prevRun ? run.passed - prevRun.passed : null;
                // Fix loop to show AFTER this row = fix triggered by NEXT run (older run that failed)
                const nextRun = runs[idx+1];
                const fixToShow = nextRun?.fixLoop || null;
                return (
                  <React.Fragment key={run.file}>
                    <tr onClick={() => goRun(run)} style={{ cursor:"pointer", borderBottom:`1px solid ${C.border}` }}
                      onMouseEnter={e => e.currentTarget.style.background=C.surfaceAlt}
                      onMouseLeave={e => e.currentTarget.style.background=""}>
                      <td style={{ padding:"12px 14px", fontSize:"12px", color:C.textWeak, whiteSpace:"nowrap" }}>
                        {fmt(run.startTime)}
                      </td>
                      <td style={{ padding:"12px 14px" }}>
                        <code style={{ fontSize:"12px", color:C.brand, fontWeight:"600" }}>{run.runId}</code>
                      </td>
                      <td style={{ padding:"12px 14px" }}>
                        <span style={{ fontSize:"13px", fontWeight:"700", color:passColor(rate) }}>
                          {run.passed}/{run.total} &nbsp; {rate}%
                        </span>
                      </td>
                      <td style={{ padding:"12px 14px" }}>
                        {run.avgLatency > 0
                          ? <span style={{ fontSize:"13px", fontWeight:"700", color:latColor(run.avgLatency) }}>
                              {run.avgLatency} ms
                            </span>
                          : <span style={{ color:C.textWeaker }}>—</span>}
                      </td>
                      <td style={{ padding:"12px 14px" }}>
                        {delta !== null
                          ? <span style={{ fontSize:"12px", fontWeight:"700",
                              color: delta > 0 ? C.success : delta < 0 ? C.error : C.textWeak }}>
                              {delta > 0 ? `+${delta} ▲` : delta < 0 ? `${delta} ▼` : "="}
                            </span>
                          : <span style={{ color:C.textWeaker, fontSize:"12px" }}>— (1st run)</span>}
                      </td>
                      <td style={{ padding:"12px 14px", textAlign:"right" }}>
                        <span style={{ color:C.brand, fontSize:"12px" }}>View →</span>
                      </td>
                    </tr>

                    {/* Fix loop row — between failing run and next (successful) run */}
                    {fixToShow && (() => {
                      // Use triggered_by_run_id as stable key for expand/collapse
                      const fixKey = fixToShow.triggered_by_run_id || (nextRun?.file || "fix");
                      const isOpen = expandedFix === fixKey;
                      const CATEG = {
                        TOPIC_NOT_MATCHED:"#ff7b72", ACTION_NOT_INVOKED:"#ffa657",
                        WRONG_ACTION_SELECTED:"#ffa657", ACTION_INVOCATION_FAILED:"#ff7b72",
                        TEST_SPEC_CORRECTION:"#79c0ff", TEST_SPEC_IMPROVEMENT:"#79c0ff",
                        INFORMATIONAL:"#8b949e",
                      };
                      const actionable = (fixToShow.issues||[]).filter(i => i.category !== "INFORMATIONAL");
                      const info       = (fixToShow.issues||[]).filter(i => i.category === "INFORMATIONAL");
                      return (
                        <tr style={{ background:"#0d0e00" }}>
                          <td colSpan={6} style={{ padding:"0", borderTop:"2px solid #fde68a", borderBottom:"2px solid #fde68a" }}>
                            {/* Header — always clickable */}
                            <div onClick={() => setExpandedFix(isOpen ? null : fixKey)}
                              style={{ padding:"10px 16px", display:"flex", alignItems:"center", gap:"10px",
                                       cursor:"pointer", userSelect:"none",
                                       borderBottom: isOpen ? "1px solid rgba(253,230,138,0.3)" : "none" }}>
                              <span style={{ fontSize:"14px" }}>🔧</span>
                              <div style={{ flex:1 }}>
                                <span style={{ fontSize:"12px", fontWeight:"700", color:"#fde68a" }}>
                                  Fix loop — Iteration {fixToShow.iteration}
                                </span>
                                <span style={{ background:"rgba(253,230,138,0.15)", color:"#fde68a",
                                               border:"1px solid rgba(253,230,138,0.4)",
                                               padding:"1px 8px", borderRadius:"10px", fontSize:"10px",
                                               marginLeft:"10px", fontWeight:"600" }}>
                                  {actionable.length} fix{actionable.length!==1?"es":""}{info.length > 0 ? ` · ${info.length} informational` : ""}
                                </span>
                                {fixToShow.result && (
                                  <span style={{ background:"rgba(63,185,80,0.15)", color:"#7ee787",
                                                 border:"1px solid rgba(63,185,80,0.3)",
                                                 padding:"1px 8px", borderRadius:"10px", fontSize:"10px",
                                                 marginLeft:"6px", fontWeight:"600" }}>
                                    ✓ Closed
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize:"13px", color:"#fde68a", fontWeight:"700" }}>{isOpen ? "▲" : "▼"}</span>
                            </div>

                            {/* Expanded body */}
                            {isOpen && (
                              <div style={{ padding:"16px 20px 18px 20px", display:"flex", flexDirection:"column", gap:"16px" }}>

                                {/* Issues */}
                                {(fixToShow.issues||[]).length > 0 && (
                                  <div>
                                    <div style={{ fontSize:"11px", fontWeight:"700", textTransform:"uppercase",
                                                  letterSpacing:"0.5px", color:"#fbbf24", marginBottom:"10px" }}>
                                      Failures identified
                                    </div>
                                    <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                                      {(fixToShow.issues||[]).map((issue, i) => {
                                        const catColor = CATEG[issue.category] || "#8b949e";
                                        const isInfo = issue.category === "INFORMATIONAL";
                                        return (
                                          <div key={i} style={{ padding:"8px 12px", borderRadius:"6px",
                                                                 background:"rgba(255,255,255,0.04)",
                                                                 border:`1px solid rgba(255,255,255,0.08)`,
                                                                 opacity: isInfo ? 0.7 : 1 }}>
                                            <div style={{ display:"flex", gap:"8px", alignItems:"flex-start", flexWrap:"wrap" }}>
                                              <span style={{ color: issue.agent_behavior_correct ? "#8b949e" : C.error,
                                                             fontWeight:"700", fontSize:"11px", flexShrink:0 }}>
                                                {issue.agent_behavior_correct ? "ℹ" : "✗"} {issue.test_id}
                                              </span>
                                              <code style={{ background:"rgba(255,255,255,0.08)", padding:"1px 6px",
                                                             borderRadius:"4px", fontSize:"10px", color:"#fde68a",
                                                             flexShrink:0 }}>{issue.assertion}</code>
                                              <span style={{ background:`${catColor}22`, color:catColor,
                                                             border:`1px solid ${catColor}44`,
                                                             padding:"1px 6px", borderRadius:"4px",
                                                             fontSize:"10px", fontWeight:"600", flexShrink:0 }}>
                                                {issue.category}
                                              </span>
                                              {issue.agent_behavior_correct && (
                                                <span style={{ color:"#7ee787", fontSize:"10px", fontWeight:"600", flexShrink:0 }}>
                                                  ✓ Agent correct
                                                </span>
                                              )}
                                            </div>
                                            <div style={{ fontSize:"12px", color:"#c9d1d9", marginTop:"5px", lineHeight:"1.5" }}>
                                              {issue.description}
                                            </div>
                                            {issue.root_cause && issue.root_cause !== issue.description && (
                                              <div style={{ fontSize:"11px", color:"#8b949e", marginTop:"4px",
                                                            lineHeight:"1.5", fontStyle:"italic" }}>
                                                {issue.root_cause.substring(0, 200)}{issue.root_cause.length > 200 ? "…" : ""}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Changes */}
                                {(fixToShow.changes||[]).length > 0 && (
                                  <div>
                                    <div style={{ fontSize:"11px", fontWeight:"700", textTransform:"uppercase",
                                                  letterSpacing:"0.5px", color:"#fbbf24", marginBottom:"10px" }}>
                                      Fixes applied
                                    </div>
                                    {(fixToShow.changes||[]).map((ch, i) => (
                                      <div key={i} style={{ padding:"8px 12px", borderRadius:"6px", marginBottom:"6px",
                                                             background:"rgba(255,255,255,0.04)",
                                                             border:"1px solid rgba(255,255,255,0.08)" }}>
                                        <div style={{ display:"flex", gap:"8px", alignItems:"center", marginBottom:"4px" }}>
                                          <span style={{ color: ch.type==="MODIFIED" ? C.warning : ch.type==="NEW" ? C.success : C.error,
                                                         fontWeight:"700", fontSize:"11px" }}>{ch.type}</span>
                                          <code style={{ fontSize:"11px", color:"#79c0ff" }}>{ch.file}</code>
                                        </div>
                                        <div style={{ fontSize:"12px", color:"#c9d1d9" }}>{ch.description}</div>
                                        {(ch.details||[]).map((d, j) => {
                                          const oldStr = typeof d.old_value === 'object' ? JSON.stringify(d.old_value) : String(d.old_value||"");
                                          const newStr = typeof d.new_value === 'object' ? JSON.stringify(d.new_value) : String(d.new_value||"");
                                          return (
                                            <div key={j} style={{ marginTop:"6px", paddingLeft:"12px", fontSize:"11px" }}>
                                              <div style={{ color:"#ff7b72", textDecoration:"line-through" }}>{d.field}: {oldStr.substring(0,120)}</div>
                                              <div style={{ color:"#7ee787", fontWeight:"500", marginTop:"2px" }}>{d.field}: {newStr.substring(0,120)}</div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Expected outcome */}
                                {fixToShow.expected_outcome && (
                                  <div style={{ fontSize:"12px", color:"#58a6ff", lineHeight:"1.5",
                                                padding:"8px 12px", borderRadius:"6px",
                                                background:"rgba(88,166,255,0.08)",
                                                border:"1px solid rgba(88,166,255,0.2)" }}>
                                    <span style={{ fontWeight:"700", display:"block", marginBottom:"2px" }}>Expected outcome</span>
                                    {fixToShow.expected_outcome}
                                  </div>
                                )}

                                {/* Result */}
                                {fixToShow.result && (
                                  <div style={{ fontSize:"12px", color:"#7ee787", lineHeight:"1.5",
                                                padding:"8px 12px", borderRadius:"6px",
                                                background:"rgba(63,185,80,0.08)",
                                                border:"1px solid rgba(63,185,80,0.2)" }}>
                                    <span style={{ fontWeight:"700", display:"block", marginBottom:"2px" }}>Result</span>
                                    {fixToShow.result}
                                  </div>
                                )}

                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })()}

                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── View: Report detail ─────────────────────────────────────────────────────
  if (view === "report") {
    const result = reportData?.result || reportData || {};
    const tcs = result.testCases || [];
    const METRIC_COLS = ["topic_assertion","actions_assertion","output_validation","coherence","completeness","conciseness","output_latency_milliseconds"];
    const METRIC_LABELS = { topic_assertion:"Topic", actions_assertion:"Actions", output_validation:"Output Val.",
      coherence:"Coherence", completeness:"Complete.", conciseness:"Concise.", output_latency_milliseconds:"Latency" };

    const tcPassed = (tc) => {
      const assertions = (tc.testResults||[]).filter(tr => ["topic_assertion","actions_assertion","output_validation"].includes(tr.name));
      return assertions.length > 0 && assertions.every(tr => tr.result === "PASS");
    };
    const passed = tcs.filter(tcPassed).length;
    const rate   = tcs.length > 0 ? Math.round(passed/tcs.length*100) : 0;

    // ── Global scoring function ──────────────────────────────────────────────
    const metricToScore = (tr) => {
      if (!tr) return null;
      const n = tr.name || tr.metricLabel;
      if (n === "topic_assertion" || n === "actions_assertion") return tr.result === "PASS" ? 100 : 0;
      if (n === "output_latency_milliseconds") { const ms = tr.score; if (ms == null) return null; return ms < 2000 ? 100 : ms < 3000 ? 80 : ms < 5000 ? 60 : ms < 8000 ? 40 : 20; }
      if (tr.score != null) return Math.round((tr.score / 5) * 100);
      return null;
    };
    const tcScore = (tc) => { const s = (tc.testResults||[]).map(tr => metricToScore(tr)).filter(s => s !== null); return s.length ? Math.round(s.reduce((a,b)=>a+b,0)/s.length) : null; };
    const tcScores = tcs.map(tcScore);
    const validScores = tcScores.filter(s => s !== null);
    const globalScore = validScores.length ? Math.round(validScores.reduce((a,b)=>a+b,0)/validScores.length) : null;
    const toGrade = (s) => s >= 95 ? "A+" : s >= 90 ? "A" : s >= 85 ? "A-" : s >= 80 ? "B+" : s >= 75 ? "B" : s >= 70 ? "B-" : s >= 65 ? "C+" : s >= 60 ? "C" : s >= 55 ? "C-" : s >= 50 ? "D" : "F";
    const ScorePill = ({ score }) => {
      if (score === null) return <span style={{ color:C.textWeaker, fontSize:"11px" }}>—</span>;
      const col = scoreToColor(score);
      const grade = toGrade(score);
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"1px" }}>
          <span style={{ fontSize:"14px", fontWeight:"800", color:col, lineHeight:"1" }}>{grade}</span>
          <span style={{ fontSize:"10px", color:C.textWeaker, lineHeight:"1" }}>{score}</span>
        </div>
      );
    };

    const scoreColor = (s, name) => {
      if (name === "output_latency_milliseconds") return latColor(s);
      if (s >= 4) return C.success; if (s >= 3) return "#f59e0b"; if (s >= 2) return "#fb923c"; return C.error;
    };
    const BADGE_METRICS = ["topic_assertion", "actions_assertion", "output_latency_milliseconds"];
    const ResultBadge = ({ result }) => {
      const map = {
        PASS:    { bg:"rgba(63,185,80,0.15)",  color:C.success,  text:"PASS" },
        FAIL:    { bg:"rgba(248,81,73,0.15)",  color:C.error,    text:"FAIL" },
        FAILURE: { bg:"rgba(248,81,73,0.15)",  color:C.error,    text:"FAIL" },
        WARNING: { bg:"rgba(227,179,65,0.15)", color:C.warning,  text:"WARN" },
        SKIPPED: { bg:"rgba(139,148,158,0.15)",color:C.textWeak, text:"SKIP" },
      };
      const s = map[result?.toUpperCase()] || { bg:"rgba(139,148,158,0.15)", color:C.textWeak, text:result||"—" };
      return (
        <span style={{ padding:"2px 10px", borderRadius:"999px", fontSize:"11px", fontWeight:"700",
                        background:s.bg, color:s.color, letterSpacing:"0.3px" }}>
          {s.text}
        </span>
      );
    };
    const LatencyBadge = ({ score }) => {
      const ms = score;
      const col = ms < 2000 ? C.success : ms < 5000 ? C.warning : C.error;
      const bg  = ms < 2000 ? "rgba(63,185,80,0.15)" : ms < 5000 ? "rgba(227,179,65,0.15)" : "rgba(248,81,73,0.15)";
      return (
        <span style={{ padding:"2px 10px", borderRadius:"999px", fontSize:"11px", fontWeight:"700",
                        background:bg, color:col, letterSpacing:"0.3px" }}>
          {ms} ms
        </span>
      );
    };
    const ScoreBar = ({ score, name, result }) => {
      if (name === "output_latency_milliseconds") return score ? <LatencyBadge score={score} /> : <span style={{ color:C.textWeaker, fontSize:"11px" }}>—</span>;
      if (BADGE_METRICS.includes(name)) return <ResultBadge result={result} />;
      if (score === null || score === undefined) return <span style={{ color:C.textWeaker, fontSize:"11px" }}>—</span>;
      const col = scoreColor(score, name);
      const pct = (score/5)*100;
      return (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"4px" }}>
          <div style={{ width:"32px", height:"6px", background:C.border, borderRadius:"3px", overflow:"hidden" }}>
            <div style={{ width:`${pct}%`, height:"100%", background:col, transition:"width 0.3s" }} />
          </div>
          <span style={{ fontSize:"11px", fontWeight:"600", color:col }}>{score}/5</span>
        </div>
      );
    };

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
        <Breadcrumb />

        {/* Summary cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(100px,1fr))", gap:"10px" }}>
          {[
            { label:"Test Cases", value:tcs.length, color:C.brand },
            { label:"Passed",     value:passed,     color:C.success },
            { label:"Failed",     value:tcs.length-passed, color:tcs.length-passed > 0 ? C.error : C.textWeak },
            { label:"Pass Rate",  value:`${rate}%`,  color:passColor(rate) },
            { label:"Global Score", value: globalScore !== null ? `${gradeLabel(globalScore)} (${globalScore}/100)` : "—", color: globalScore !== null ? scoreToColor(globalScore) : C.textWeak },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background:C.surface, border:`1px solid ${C.border}`,
                                      borderRadius:C.radius, padding:"12px 14px", textAlign:"center" }}>
              <div style={{ fontSize:"20px", fontWeight:"800", color }}>{value}</div>
              <div style={{ fontSize:"11px", color:C.textWeak, marginTop:"2px" }}>{label}</div>
            </div>
          ))}
        </div>

        {error && <Alert type="error">{error}</Alert>}
        {loading && <div style={{ color:C.textWeak, fontSize:"12px" }}><Spinner size={11}/> Loading report…</div>}

        {/* Results table */}
        {tcs.length > 0 && (
          <div style={{ border:`1px solid ${C.border}`, borderRadius:C.radiusMd, overflow:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
              <thead>
                <tr style={{ background:C.surfaceAlt }}>
                  <th style={{ padding:"8px 12px", textAlign:"left", color:C.textWeak, fontSize:"11px",
                               fontWeight:"700", textTransform:"uppercase", borderBottom:`1px solid ${C.border}`,
                               whiteSpace:"nowrap" }}>#</th>
                  <th style={{ padding:"8px 12px", textAlign:"left", color:C.textWeak, fontSize:"11px",
                               fontWeight:"700", textTransform:"uppercase", borderBottom:`1px solid ${C.border}` }}>Utterance</th>
                  {METRIC_COLS.map(m => (
                    <th key={m} style={{ padding:"8px 10px", textAlign:"center", color:C.textWeak, fontSize:"10px",
                                        fontWeight:"700", textTransform:"uppercase", letterSpacing:"0.4px",
                                        borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap",
                                        borderLeft: m==="coherence" ? `2px solid ${C.border}` : "none" }}>
                      {METRIC_LABELS[m]}
                    </th>
                  ))}
                  <th style={{ padding:"8px 10px", textAlign:"center", color:C.textWeak, fontSize:"11px",
                               fontWeight:"700", textTransform:"uppercase", borderBottom:`1px solid ${C.border}` }}>Status</th>
                  <th style={{ padding:"8px 10px", textAlign:"center", color:C.textWeak, fontSize:"11px",
                               fontWeight:"700", textTransform:"uppercase", borderBottom:`1px solid ${C.border}`,
                               borderLeft:`1px solid ${C.border}` }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {tcs.map(tc => {
                  const pass = tcPassed(tc);
                  const isOpen = expandedTc === tc.testNumber;
                  const metricMap = {};
                  (tc.testResults||[]).forEach(tr => { const k = tr.name || tr.metricLabel; if (k) metricMap[k] = tr; });
                  return (
                    <React.Fragment key={tc.testNumber}>
                      <tr onClick={() => setExpandedTc(isOpen ? null : tc.testNumber)}
                        style={{ cursor:"pointer", background: pass ? "transparent" : "rgba(248,81,73,0.04)",
                                 borderBottom:`1px solid ${C.border}` }}
                        onMouseEnter={e => e.currentTarget.style.background = pass ? C.surfaceAlt : "rgba(248,81,73,0.08)"}
                        onMouseLeave={e => e.currentTarget.style.background = pass ? "transparent" : "rgba(248,81,73,0.04)"}>
                        <td style={{ padding:"10px 12px", fontWeight:"700", color:C.textWeak, whiteSpace:"nowrap" }}>
                          {tc.testNumber}
                        </td>
                        <td style={{ padding:"10px 12px", maxWidth:"220px" }}>
                          <div style={{ color:C.text, whiteSpace:"nowrap", overflow:"hidden",
                                        textOverflow:"ellipsis", maxWidth:"220px" }}
                               title={tc.inputs?.utterance}>
                            {tc.inputs?.utterance}
                          </div>
                        </td>
                        {METRIC_COLS.map(m => {
                          const tr = metricMap[m];
                          return (
                            <td key={m} style={{ padding:"10px 8px", textAlign:"center", verticalAlign:"middle",
                                                 borderLeft: m==="coherence" ? `2px solid ${C.border}` : "none" }}>
                              {tr
                                ? <ScoreBar score={tr.score} name={m} result={tr.result} />
                                : <span style={{ color:C.textWeaker, fontSize:"11px" }}>—</span>}
                            </td>
                          );
                        })}
                        <td style={{ padding:"10px 8px", textAlign:"center", verticalAlign:"middle" }}>
                          <span style={{ padding:"3px 10px", borderRadius:"999px", fontSize:"11px", fontWeight:"700",
                                         background: pass ? "rgba(63,185,80,0.12)" : "rgba(248,81,73,0.12)",
                                         color: pass ? C.success : C.error }}>
                            {pass ? "PASS" : "FAIL"}
                          </span>
                        </td>
                        <td style={{ padding:"10px 8px", textAlign:"center", verticalAlign:"middle",
                                     borderLeft:`1px solid ${C.border}` }}>
                          <ScorePill score={tcScores[tcs.indexOf(tc)]} />
                        </td>
                      </tr>
                      {/* Expanded detail row */}
                      {isOpen && (() => {
                        const gd = tc.generatedData || {};
                        const decodeHtml = s => s ? s.replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,"&") : "";
                        const SectionLabel = ({ children }) => (
                          <div style={{ fontSize:"10px", fontWeight:"700", textTransform:"uppercase",
                                        letterSpacing:"0.6px", color:C.textWeaker, marginBottom:"8px" }}>{children}</div>
                        );
                        const Tooltip = ({ text, children }) => {
                          const [show, setShow] = React.useState(false);
                          return (
                            <div style={{ position:"relative", display:"inline-block" }}
                              onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
                              {children}
                              {show && text && (
                                <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%",
                                              transform:"translateX(-50%)", zIndex:100, width:"280px",
                                              background:"#161b22", border:`1px solid ${C.border}`,
                                              borderRadius:"6px", padding:"10px 12px", fontSize:"11px",
                                              color:C.textWeak, lineHeight:"1.6", boxShadow:"0 8px 24px rgba(0,0,0,0.4)",
                                              pointerEvents:"none" }}>
                                  {text}
                                  <div style={{ position:"absolute", top:"100%", left:"50%", transform:"translateX(-50%)",
                                                borderTop:"6px solid #161b22", borderLeft:"6px solid transparent",
                                                borderRight:"6px solid transparent", width:0, height:0 }} />
                                </div>
                              )}
                            </div>
                          );
                        };
                        return (
                          <tr>
                            <td colSpan={METRIC_COLS.length + 4} style={{ padding:"0", background:"#0a0d12" }}>
                              <div style={{ borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}` }}>

                                {/* ── Row 1: Utterance + Agent response ── */}
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0",
                                              borderBottom:`1px solid ${C.border}` }}>
                                  <div style={{ padding:"14px 16px", borderRight:`1px solid ${C.border}` }}>
                                    <SectionLabel>💬 Utterance</SectionLabel>
                                    <div style={{ fontSize:"13px", color:C.text, fontStyle:"italic", lineHeight:"1.5" }}>
                                      "{tc.inputs?.utterance}"
                                    </div>
                                  </div>
                                  <div style={{ padding:"14px 16px" }}>
                                    <SectionLabel>🤖 Agent response</SectionLabel>
                                    <div style={{ fontSize:"12px", color:C.textWeak, lineHeight:"1.6",
                                                  maxHeight:"80px", overflowY:"auto",
                                                  fontFamily:"JetBrains Mono, monospace" }}>
                                      {decodeHtml(gd.outcome) || "—"}
                                    </div>
                                  </div>
                                </div>

                                {/* ── Row 2: Topic + Actions ── */}
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0",
                                              borderBottom:`1px solid ${C.border}` }}>
                                  {["topic_assertion","actions_assertion"].map((name, ci) => {
                                    const tr = metricMap[name];
                                    if (!tr) return <div key={name} />;
                                    const pass = tr.result === "PASS";
                                    return (
                                      <div key={name} style={{ padding:"12px 16px",
                                                                borderRight: ci===0 ? `1px solid ${C.border}` : "none",
                                                                background: pass ? "rgba(63,185,80,0.03)" : "rgba(248,81,73,0.05)" }}>
                                        <SectionLabel>{name === "topic_assertion" ? "🗺 Topic Assertion" : "⚡ Actions Assertion"}</SectionLabel>
                                        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                                          {/* Empty expectedActions = no constraint */}
                                          {name === "actions_assertion" && tr.expectedValue === "[]" && pass ? (
                                            <div style={{ fontSize:"11px", color:C.textWeak, fontStyle:"italic" }}>
                                              No action constraint — <code style={{ color:C.success }}>any action accepted</code>
                                              <div style={{ marginTop:"4px", color:C.textWeak }}>
                                                Actual: <code style={{ color:C.success, background:"rgba(63,185,80,0.1)",
                                                  padding:"1px 5px", borderRadius:"4px" }}>{decodeHtml(tr.actualValue)}</code>
                                              </div>
                                            </div>
                                          ) : (
                                            <div style={{ display:"flex", gap:"10px", alignItems:"flex-start" }}>
                                              <div style={{ flex:1 }}>
                                                <div style={{ fontSize:"10px", color:C.textWeaker, marginBottom:"2px" }}>EXPECTED</div>
                                                <code style={{ fontSize:"11px", color:C.brand, background:"rgba(31,111,235,0.1)",
                                                               padding:"2px 6px", borderRadius:"4px", display:"inline-block" }}>
                                                  {tr.expectedValue || "—"}
                                                </code>
                                              </div>
                                              <div style={{ flex:1 }}>
                                                <div style={{ fontSize:"10px", color:C.textWeaker, marginBottom:"2px" }}>ACTUAL</div>
                                                <code style={{ fontSize:"11px",
                                                               color: pass ? C.success : C.error,
                                                               background: pass ? "rgba(63,185,80,0.1)" : "rgba(248,81,73,0.1)",
                                                               padding:"2px 6px", borderRadius:"4px", display:"inline-block" }}>
                                                  {decodeHtml(tr.actualValue) || "—"}
                                                </code>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* ── Row 3: Output validation + Quality metrics ── */}
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0" }}>

                                  {/* Output validation */}
                                  {(() => {
                                    const tr = metricMap["output_validation"];
                                    if (!tr) return <div />;
                                    const pass = tr.result === "PASS";
                                    return (
                                      <div style={{ padding:"12px 16px", borderRight:`1px solid ${C.border}`,
                                                    background: pass ? "rgba(63,185,80,0.03)" : "rgba(248,81,73,0.05)" }}>
                                        <SectionLabel>📋 Output Validation {pass ? "✓" : "✗"} {tr.score}/5</SectionLabel>
                                        <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                                          <div>
                                            <div style={{ fontSize:"10px", color:C.textWeaker, marginBottom:"3px" }}>EXPECTED OUTCOME</div>
                                            <div style={{ fontSize:"11px", color:C.textWeak, lineHeight:"1.5",
                                                          fontStyle:"italic", padding:"6px 8px",
                                                          background:C.surfaceAlt, borderRadius:"4px",
                                                          border:`1px solid ${C.border}` }}>
                                              {tr.expectedValue}
                                            </div>
                                          </div>
                                          <div>
                                            <div style={{ fontSize:"10px", color:C.textWeaker, marginBottom:"3px" }}>ACTUAL RESPONSE</div>
                                            <div style={{ fontSize:"11px", color:C.text, lineHeight:"1.5",
                                                          maxHeight:"60px", overflowY:"auto",
                                                          padding:"6px 8px", background:C.surfaceAlt,
                                                          borderRadius:"4px", border:`1px solid ${C.border}` }}>
                                              {tr.actualValue || "—"}
                                            </div>
                                          </div>
                                          {tr.metricExplainability && (
                                            <div>
                                              <div style={{ fontSize:"10px", color:C.textWeaker, marginBottom:"3px" }}>🧠 AI JUDGE EXPLANATION</div>
                                              <div style={{ fontSize:"11px", color:C.textWeak, lineHeight:"1.6",
                                                            padding:"6px 8px", background:C.surfaceAlt,
                                                            borderRadius:"4px", border:`1px solid ${C.border}`,
                                                            maxHeight:"80px", overflowY:"auto" }}>
                                                {tr.metricExplainability}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* Quality metrics grid */}
                                  <div style={{ padding:"12px 16px" }}>
                                    <SectionLabel>📊 Quality Metrics</SectionLabel>
                                    <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                                      {["coherence","completeness","conciseness","instruction_following","factuality","output_latency_milliseconds"]
                                        .map(name => {
                                          const tr = metricMap[name];
                                          if (!tr) return null;
                                          const isLatency = name === "output_latency_milliseconds";
                                          const score = tr.score;
                                          const col = isLatency
                                            ? (score < 2000 ? C.success : score < 5000 ? C.warning : C.error)
                                            : (score >= 4 ? C.success : score >= 3 ? C.warning : C.error);
                                          const label = {
                                            coherence:"Coherence", completeness:"Completeness",
                                            conciseness:"Conciseness", instruction_following:"Instruction following",
                                            factuality:"Factuality", output_latency_milliseconds:"Latency"
                                          }[name] || name;
                                          const pass = tr.result === "PASS";
                                          return (
                                            <Tooltip key={name} text={tr.metricExplainability || null}>
                                              <div style={{ display:"flex", alignItems:"center", gap:"8px",
                                                            padding:"5px 8px", borderRadius:"5px",
                                                            background:"rgba(255,255,255,0.03)",
                                                            border:`1px solid ${C.border}`,
                                                            cursor: tr.metricExplainability ? "help" : "default",
                                                            transition:"background 0.1s" }}
                                                onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.07)"}
                                                onMouseLeave={e => e.currentTarget.style.background="rgba(255,255,255,0.03)"}>
                                                <span style={{ fontSize:"11px", color:C.textWeak, flex:1, fontWeight:"500" }}>{label}</span>
                                                {!isLatency && score !== null && score !== undefined && (
                                                  <div style={{ width:"48px", height:"5px", background:C.border,
                                                                borderRadius:"3px", overflow:"hidden", flexShrink:0 }}>
                                                    <div style={{ width:`${(score/5)*100}%`, height:"100%",
                                                                  background:col }} />
                                                  </div>
                                                )}
                                                <span style={{ fontSize:"11px", fontWeight:"700", color:col,
                                                               flexShrink:0, minWidth:"40px", textAlign:"right" }}>
                                                  {isLatency ? `${score}ms` : `${score}/5`}
                                                </span>
                                                <span style={{ fontSize:"10px", fontWeight:"700",
                                                               color: pass ? C.success : C.error,
                                                               flexShrink:0 }}>
                                                  {pass ? "✓" : "✗"}
                                                </span>
                                                {tr.metricExplainability && (
                                                  <span style={{ fontSize:"10px", color:C.textWeaker }}>ⓘ</span>
                                                )}
                                              </div>
                                            </Tooltip>
                                          );
                                        })}
                                    </div>
                                  </div>
                                </div>

                              </div>
                            </td>
                          </tr>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Score legend */}
        <div style={{ display:"flex", gap:"12px", flexWrap:"wrap", padding:"10px 14px",
                      background:C.surfaceAlt, borderRadius:C.radius, fontSize:"11px", color:C.textWeak }}>
          <span style={{ fontWeight:"600", color:C.textWeak }}>Score (0–5):</span>
          {[[C.success,"5 Excellent"],[`#4ade80`,"4 Good"],[`#f59e0b`,"3 Acceptable"],[`#fb923c`,"2 Below avg"],[C.error,"1 Poor"]].map(([col, label]) => (
            <span key={label} style={{ display:"flex", alignItems:"center", gap:"4px" }}>
              <span style={{ width:"8px", height:"8px", borderRadius:"50%", background:col, flexShrink:0 }} />
              {label}
            </span>
          ))}
          <span style={{ marginLeft:"8px", fontWeight:"600", color:C.textWeak }}>Latency:</span>
          {[[C.success,"<2s"],[`#f59e0b`,"2–5s"],[C.error,">5s"]].map(([col, label]) => (
            <span key={label} style={{ display:"flex", alignItems:"center", gap:"4px" }}>
              <span style={{ width:"8px", height:"8px", borderRadius:"50%", background:col, flexShrink:0 }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 3 — VALIDATE
// ═══════════════════════════════════════════════════════════════════════════════

function PageValidate({ serverOnline, targetOrg = "my-dev-org" }) {
  const [agentFile, setAgentFile]   = useState(null);
  const [apiName, setApiName]       = useState("");
  const [customOrg, setCustomOrg]   = useState("");
  const [useCustomOrg, setUseCustomOrg] = useState(false);

  const [jsonMode, setJsonMode]     = useState(true);

  // Auto-detect api name from .agent file
  const handleSelectAgent = f => {
    setAgentFile(f);
    const detected = parseAgentDeveloperName(f?.content) || f?.name?.replace(".agent", "");
    setApiName(detected || "");
  };

  const org = useCustomOrg && customOrg.trim() ? customOrg.trim() : targetOrg;

  const validateCmd = "sf agent validate authoring-bundle" +
    " --api-name " + (apiName || "MyAgent") +
    " --target-org " + org +
    (jsonMode ? " --json" : "");

  const ready = apiName.trim().length > 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>

      {/* Left — config */}
      <Card>
        <CardHeader icon="🔍" title="Validate Agent Authoring Bundle"
          subtitle="Select an agent and run the validation against your org" />

        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

          <FilePicker
            label=".agent file"
            route="/files/agents"
            filterFn={f => f.name.endsWith(".agent") || f.content?.includes("developer_name:")}
            selected={agentFile}
            onSelect={handleSelectAgent}
            emptyMsg="No .agent files found. Check SF_PROJECT_PATH in .env."
            serverOnline={serverOnline}
          />

          <Field label="Agent API Name" hint="Auto-detected from the .agent file">
            <input
              value={apiName}
              readOnly
              placeholder="e.g. AtlasAirlinesServiceAgent"
              style={{ ...inputStyle, fontFamily: "monospace", opacity: 0.7, cursor: "default" }}
            />
          </Field>

          <Field label="Target Org">
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ padding: "8px 12px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                              borderRadius: C.radius, fontFamily: "monospace", fontSize: "13px",
                              color: useCustomOrg ? C.textWeak : C.brand, flex: 1,
                              textDecoration: useCustomOrg ? "line-through" : "none" }}>
                  {targetOrg}
                </div>
                <span style={{ fontSize: "12px", color: C.textWeak }}>from config</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input type="checkbox" checked={useCustomOrg} onChange={e => setUseCustomOrg(e.target.checked)}
                  style={{ accentColor: C.brand }} />
                <span style={{ fontSize: "12px", color: C.textWeak }}>Use a different org</span>
              </label>
              {useCustomOrg && (
                <input value={customOrg} onChange={e => setCustomOrg(e.target.value)}
                  placeholder="my-other-org"
                  style={{ ...inputStyle, fontFamily: "monospace" }} />
              )}
            </div>
          </Field>

          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input type="checkbox" checked={jsonMode} onChange={e => setJsonMode(e.target.checked)}
              style={{ accentColor: C.brand }} />
            <span style={{ fontSize: "12px", color: C.textWeak }}>Include <code>--json</code> flag (structured output)</span>
          </label>



        </div>
      </Card>

      {/* Right — command */}
      {ready ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "fadeIn 0.2s ease" }}>
          <Card>
            <CardHeader title="Validate command"
              subtitle={`Agent: ${apiName} · Org: ${org}`} />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <CmdBlock
                label="sf agent validate authoring-bundle"
                cmd={validateCmd}
                serverOnline={serverOnline}
              />
              <Alert type="info">
                Checks that the authoring bundle is valid before deploying — catches missing topics, invalid actions, misconfigured flows.
              </Alert>
            </div>
          </Card>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px",
                      border: `1px dashed ${C.border}`, borderRadius: C.radiusMd, color: C.textWeaker,
                      fontSize: "13px", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "24px" }}>🔍</span>
          <span>Select an agent to build the command</span>
        </div>
      )}

    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 2 — AGENT AUTHORING
// ═══════════════════════════════════════════════════════════════════════════════

function PageAuthoring({ serverOnline, targetOrg = "my-dev-org" }) {
  const [tab, setTab]             = useState("new"); // "new" | "edit"
  const [subTab, setSubTab]          = useState("cli"); // "skill" | "cli"
  const [cliSpecFile, setCliSpecFile]   = useState(null);
  const [cliBundleName, setCliBundleName] = useState("");
  const [cliBundleApi, setCliBundleApi]   = useState("");

  // ── New agent tab ──
  const [specFilePicked, setSpecFilePicked] = useState(null);
  const [agentName, setAgentName]           = useState("");
  const [copied, setCopied]                 = useState(false);

  // ── Edit existing tab ──
  const [agentFile, setAgentFile]     = useState(null);
  const [agentContent, setAgentContent] = useState("");
  const [editDirty, setEditDirty]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState("");

  const specPath = specFilePicked ? "specs/" + specFilePicked.name : "specs/my-agent.yaml";
  const prompt = specFilePicked && agentName.trim() ? `Use the sf-ai-agentscript skill: create the ${agentName} agent based on ${specPath}.

For each action defined in the agent script that targets a Flow (flow://), use the sf-flow skill to create/update the corresponding Auto-Launched Flow with no trigger, matching the exact inputs and outputs defined in the action.

For each action that targets an Apex class (apex://), use the sf-apex skill to create/update the corresponding Apex class and test class.

For any custom objects, fields, or metadata types referenced in the spec or actions, use the sf-metadata skill to create/update the required metadata before deploying the Flows or Apex.` : "";
  const copy = () => { navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleSelectAgent = f => {
    setAgentFile(f);
    setAgentContent(f.content || "");
    setEditDirty(false);
    setSaveMsg("");
  };

  const saveAgent = async () => {
    if (!agentFile || !agentContent.trim()) return;
    setSaving(true); setSaveMsg("");
    try {
      const r = await fetch(`${API}/files/save-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: agentFile.path, content: agentContent }),
      });
      const d = await r.json();
      setSaveMsg(d.ok ? "✓ Saved!" : `✗ ${d.error}`);
      if (d.ok) setEditDirty(false);
    } catch (e) { setSaveMsg(`✗ ${e.message}`); }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Main tab bar */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, gap: "0" }}>
        {[
          { id: "new",  icon: "➕", label: "New Agent",           sub: "Generate from spec" },
          { id: "edit", icon: "✏️",  label: "Edit Agent", sub: "Modify .agent script" },
        ].map(({ id, icon, label, sub }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: "12px 24px 11px", background: "none", border: "none",
              borderBottom: `2px solid ${active ? C.brand : "transparent"}`,
              cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              marginBottom: "-1px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <span style={{ fontSize: "13px" }}>{icon}</span>
                <span style={{ fontSize: "13px", fontWeight: "700",
                               color: active ? C.text : C.textWeak,
                               transition: "color 0.15s" }}>{label}</span>
              </div>
              <div style={{ fontSize: "11px", color: active ? C.textWeak : C.textWeaker,
                            marginTop: "2px", paddingLeft: "20px", transition: "color 0.15s" }}>{sub}</div>
            </button>
          );
        })}
      </div>

      {tab === "new" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

          {/* Sub-tab bar */}
          <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, gap:"0", marginBottom:"0" }}>
            {[
              { id:"cli",   icon:"⌨️",  label:"Via CLI Command",  sub:"sf agent generate authoring-bundle" },
              { id:"skill", icon:"🦾", label:"Via Agent Skill",  sub:"sf-ai-agentscript" },
            ].map(({ id, icon, label, sub }) => {
              const active = subTab === id;
              return (
                <button key={id} onClick={() => setSubTab(id)} style={{
                  padding: "10px 20px 9px", background: "none", border: "none",
                  borderBottom: `2px solid ${active ? C.gold : "transparent"}`,
                  cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                  marginBottom: "-1px",
                }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                    <span style={{ fontSize:"12px" }}>{icon}</span>
                    <span style={{ fontSize:"12px", fontWeight:"700", color: active ? C.text : C.textWeak }}>{label}</span>
                  </div>
                  <div style={{ fontSize:"10px", color: active ? C.textWeak : C.textWeaker, marginTop:"2px", paddingLeft:"18px" }}>{sub}</div>
                </button>
              );
            })}
          </div>

          {subTab === "skill" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px", alignItems:"start" }}>

          {/* ── Left col ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <Card>
              <CardHeader icon="✍️" title="New agent"
                subtitle="Generate your .agent script using the sf-ai-agentscript skill" />
              <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"16px" }}>
                <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:C.radius, padding:"10px 14px" }}>
                  <div style={{ fontSize:"11px", fontWeight:"700", color:C.textWeak, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:"8px" }}>Compatible with</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                    {["Claude Code","Codex","Gemini CLI","OpenCode","Amp","40+ agents"].map(tool => (
                      <span key={tool} style={{ padding:"3px 10px", borderRadius:"999px",
                        background: tool==="40+ agents" ? C.brandLight : C.surface,
                        border:`1px solid ${tool==="40+ agents" ? C.brand : C.border}`,
                        color: tool==="40+ agents" ? C.brand : C.textWeak,
                        fontSize:"11px", fontWeight: tool==="40+ agents" ? "700" : "500" }}>{tool}</span>
                    ))}
                  </div>
                </div>
                <FilePicker label="agentSpec.yaml (from specs/)" route="/files/specs"
                  filterFn={f => f.name.endsWith(".yaml") || f.name.endsWith(".yml")}
                  selected={specFilePicked} serverOnline={serverOnline}
                  onSelect={f => { setSpecFilePicked(f); if (!agentName) setAgentName(f.name.replace(/-?agentSpec\.yaml|\.yaml/i,"")); }}
                  emptyMsg="No spec files found in specs/." />
                {specFilePicked && (
                  <div style={{ fontSize:"12px", color:C.textWeak, marginTop:"-8px" }}>
                    → <code style={{ color:C.textWeak }}>specs/{specFilePicked.name}</code>
                  </div>
                )}
                <Field label="Agent API Name">
                  <input value={agentName} onChange={e => setAgentName(e.target.value)}
                    placeholder="e.g. AtlasAirlinesServiceAgent"
                    style={{ ...inputStyle, fontFamily:"monospace" }} />
                </Field>
                {(specFilePicked && agentName.trim()) && (
                  <Btn onClick={copy}>{copied ? "✓ Copied!" : "⎘ Copy prompt"}</Btn>
                )}
              </div>
            </Card>
          </div>

          {/* ── Right col — prompt + How it works ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            {(specFilePicked && agentName.trim()) ? (
              <div style={{ border:`1px solid ${C.border}`, borderRadius:C.radiusMd,
                            overflow:"hidden", position:"sticky", top:"16px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                              padding:"10px 14px", background:C.surfaceAlt,
                              borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:"12px", fontWeight:"700", color:C.text }}>✍️ sf-ai-agentscript prompt</span>
                  <Btn size="sm" variant="neutral" onClick={copy}>{copied ? "✓ Copied" : "⎘ Copy"}</Btn>
                </div>
                <div style={{ padding:"16px", background:C.surface, fontFamily:"monospace",
                              fontSize:"12px", lineHeight:"1.8", whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                  {prompt.split("\n").map((line, i) => {
                    if (line.startsWith("Use the sf-ai-agentscript"))
                      return <div key={i} style={{ color:C.gold, fontWeight:"700" }}>{line}</div>;
                    if (line.startsWith("For each action") || line.startsWith("For any custom"))
                      return <div key={i} style={{ marginTop:"12px", color:C.text, fontWeight:"600" }}>{line}</div>;
                    if (line === "") return <div key={i} style={{ height:"4px" }} />;
                    return <div key={i} style={{ color:C.textWeak }}>{line}</div>;
                  })}
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                            minHeight:"280px", border:`1px dashed ${C.border}`,
                            borderRadius:C.radiusMd, flexDirection:"column", gap:"12px",
                            color:C.textWeaker }}>
                <span style={{ fontSize:"36px" }}>✍️</span>
                <span style={{ fontSize:"14px", fontWeight:"600", color:C.textWeak }}>sf-ai-agentscript prompt</span>
                <span style={{ fontSize:"12px", textAlign:"center", maxWidth:"220px", lineHeight:"1.6" }}>
                  Select an agentSpec and enter the Agent API name to generate the prompt
                </span>
              </div>
            )}
            <Card>
              <CardHeader title="How it works" subtitle="sf-ai-agentscript reads your spec and generates the full .agent script" />
              <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                  {[
                    { step:"1", title:"Save your agentSpec.yaml", desc:"Use Stage 01 to generate and save your agentSpec.yaml to the specs/ folder of your SFDX project." },
                    { step:"2", title:"Open your AI coding agent", desc:"Works with Claude Code, Codex, Gemini CLI, OpenCode, Amp, and 40+ other agents — any tool that supports MCP skills." },
                    { step:"3", title:"Paste the prompt", desc:"Copy the prompt above and run it. The skill reads your spec and generates the complete .agent script." },
                    { step:"4", title:"Review & save", desc:"The .agent file is generated with topics, actions, reasoning instructions, and variables. Save it to your SFDX project." },
                  ].map(({ step, title, desc }) => (
                    <div key={step} style={{ display:"flex", gap:"12px", alignItems:"flex-start" }}>
                      <div style={{ width:"24px", height:"24px", borderRadius:"50%", background:C.brandLight,
                                    border:`1px solid ${C.brand}`, display:"flex", alignItems:"center",
                                    justifyContent:"center", fontSize:"11px", fontWeight:"700",
                                    color:C.brand, flexShrink:0, marginTop:"1px" }}>{step}</div>
                      <div>
                        <div style={{ fontSize:"13px", fontWeight:"600", color:C.text, marginBottom:"2px" }}>{title}</div>
                        <div style={{ fontSize:"12px", color:C.textWeak, lineHeight:"1.5" }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"14px", display:"flex", flexDirection:"column", gap:"8px" }}>
                  <label style={labelStyle}>Resources</label>
                  {[
                    { label:"sf-ai-agentscript — GitHub", url:"https://github.com/Jaganpro/sf-skills/blob/main/README.md", credit:true },
                    { label:"Agent Script reference", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-script.html" },
                    { label:"Agentforce DX overview", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx.html" },
                    { label:"Test Spec reference", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-spec.html" },
                    { label:"Customize agent test spec", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-test-customize.html" },
                  ].map(({ label, url, credit }) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                      style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px",
                               background: credit ? C.brandLight : C.surfaceAlt,
                               border:`1px solid ${credit ? C.brand : C.border}`,
                               borderRadius:C.radius, color: credit ? C.brand : C.textWeak,
                               fontSize:"12px", fontWeight: credit ? "700" : "500", textDecoration:"none" }}>
                      <span>{credit ? "⭐" : "📄"}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ color: credit ? C.brand : C.text, fontWeight: credit ? "700" : "500" }}>{label}</div>
                        {credit && <div style={{ fontSize:"10px", color:C.textWeak, marginTop:"1px" }}>Credit: Jaganpro · sf-skills</div>}
                      </div>
                      <span style={{ fontSize:"11px", color:C.textWeaker }}>↗</span>
                    </a>
                  ))}
                </div>
              </div>
            </Card>
          </div>

        </div>
          )}

          {subTab === "cli" && (() => {
            const cliSpec = cliSpecFile ? "specs/" + cliSpecFile.name : null;
            const cliName = cliBundleName.trim();
            const cliApi  = cliBundleApi.trim() || cliBundleName.trim().replace(/\s+/g, "_");
            const ready   = cliSpec && cliName;
            const cmd     = ready ? `sf agent generate authoring-bundle \\\n  --spec ${cliSpec} \\\n  --name "${cliName}" \\\n  --api-name ${cliApi} \\\n  --target-org ${targetOrg}` : "";
            return (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px", alignItems:"start" }}>

                {/* ── Left col — inputs ── */}
                <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                  <Card>
                    <CardHeader icon="⌨️" title="Generate Authoring Bundle"
                      subtitle="Create a new .agent script from your agentSpec using the Salesforce CLI" />
                    <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
                      <FilePicker label="agentSpec.yaml (from specs/)" route="/files/specs"
                        filterFn={f => f.name.endsWith(".yaml") || f.name.endsWith(".yml")}
                        selected={cliSpecFile} serverOnline={serverOnline}
                        onSelect={f => { setCliSpecFile(f); if (!cliBundleName) { const base = f.name.replace(/-?agentSpec\.yaml|\.yaml/i,"").replace(/_/g," "); setCliBundleName(base); setCliBundleApi(base.replace(/\s+/g,"_")); } }}
                        emptyMsg="No spec files found in specs/." />
                      <Field label="Bundle name (label)">
                        <input value={cliBundleName} onChange={e => { setCliBundleName(e.target.value); if (!cliBundleApi || cliBundleApi === cliBundleName.replace(/\s+/g,"_")) setCliBundleApi(e.target.value.replace(/\s+/g,"_")); }}
                          placeholder="e.g. Atlas Airlines Service Agent"
                          style={{ ...inputStyle }} />
                      </Field>
                      <Field label="Bundle API name">
                        <input value={cliBundleApi} onChange={e => setCliBundleApi(e.target.value.replace(/[^a-zA-Z0-9_]/g,""))}
                          placeholder="e.g. AtlasAirlinesServiceAgent"
                          style={{ ...inputStyle, fontFamily:"monospace" }} />
                        <div style={{ fontSize:"11px", color:C.textWeaker, marginTop:"4px" }}>
                          Auto-derived from label — only alphanumeric + underscore
                        </div>
                      </Field>
                    </div>
                  </Card>
                </div>

                {/* ── Right col — command + How it works ── */}
                <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                  {ready ? (
                    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                      <CmdBlock label="Generate Authoring Bundle" serverOnline={serverOnline} cmd={cmd} />
                      <div style={{ padding:"10px 14px", background:C.surfaceAlt, border:`1px solid ${C.border}`,
                                    borderRadius:C.radius, fontSize:"11px" }}>
                        <span style={{ color:C.textWeak, fontWeight:"600" }}>Output → </span>
                        <code style={{ color:C.brand, fontSize:"11px" }}>
                          force-app/main/default/aiAuthoringBundles/{cliApi}/{cliApi}.agent
                        </code>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                                  minHeight:"180px", border:`1px dashed ${C.border}`,
                                  borderRadius:C.radiusMd, flexDirection:"column", gap:"12px",
                                  color:C.textWeaker }}>
                      <span style={{ fontSize:"36px" }}>⌨️</span>
                      <span style={{ fontSize:"14px", fontWeight:"600", color:C.textWeak }}>CLI command</span>
                      <span style={{ fontSize:"12px", textAlign:"center", maxWidth:"220px", lineHeight:"1.6" }}>
                        Select a spec file and enter a bundle name to generate the command
                      </span>
                    </div>
                  )}
                  <Card>
                    <CardHeader title="How it works" subtitle="sf agent generate authoring-bundle creates the .agent scaffold" />
                    <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>
                      <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                        {[
                          { step:"1", title:"Save your agentSpec.yaml", desc:"Use Stage 01 to generate and save your agentSpec.yaml to the specs/ folder of your SFDX project." },
                          { step:"2", title:"Run the CLI command", desc:"The command reads your spec and scaffolds the .agent file with basic Agent Script code inside an AiAuthoringBundle metadata folder." },
                          { step:"3", title:"Edit the generated .agent", desc:"Use the 'Edit existing agent' tab to open and refine the generated script." },
                          { step:"4", title:"Validate & deploy", desc:"Move to Stage 03 to validate, then Stage 04 to deploy and activate your agent in the org." },
                        ].map(({ step, title, desc }) => (
                          <div key={step} style={{ display:"flex", gap:"12px", alignItems:"flex-start" }}>
                            <div style={{ width:"24px", height:"24px", borderRadius:"50%", background:C.brandLight,
                                          border:`1px solid ${C.brand}`, display:"flex", alignItems:"center",
                                          justifyContent:"center", fontSize:"11px", fontWeight:"700",
                                          color:C.brand, flexShrink:0, marginTop:"1px" }}>{step}</div>
                            <div>
                              <div style={{ fontSize:"13px", fontWeight:"600", color:C.text, marginBottom:"2px" }}>{title}</div>
                              <div style={{ fontSize:"12px", color:C.textWeak, lineHeight:"1.5" }}>{desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"14px", display:"flex", flexDirection:"column", gap:"8px" }}>
                        <label style={labelStyle}>Resources</label>
                        {[
                          { label:"Generate Authoring Bundle (Beta) — Salesforce Docs", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx-nga-authbundle.html" },
                          { label:"Agent Script reference", url:"https://developer.salesforce.com/docs/ai/agentforce/guide/agent-script.html" },
                          { label:"sf agent CLI reference", url:"https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_agent_commands_unified.htm" },
                        ].map(({ label, url }) => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                            style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 12px",
                                     background:C.surfaceAlt, border:`1px solid ${C.border}`,
                                     borderRadius:C.radius, color:C.textWeak,
                                     fontSize:"12px", fontWeight:"500", textDecoration:"none" }}>
                            <span>📄</span>
                            <div style={{ flex:1, color:C.text }}>{label}</div>
                            <span style={{ fontSize:"11px", color:C.textWeaker }}>↗</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  </Card>
                </div>

              </div>
            );
          })()}

        </div>
      )}

      {tab === "edit" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>

          {/* Left — file picker + metadata */}
          <Card>
            <CardHeader icon="📄" title="Select .agent file"
              subtitle="Pick an existing .agent script from your SFDX project to edit" />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <FilePicker
                label=".agent files in project"
                route="/files/agents"
                filterFn={f => f.name.endsWith(".agent") || f.content?.includes("developer_name:")}
                selected={agentFile}
                onSelect={handleSelectAgent}
                emptyMsg="No .agent files found. Check SF_PROJECT_PATH in .env."
                serverOnline={serverOnline}
              />
              {agentFile && (
                <>
                  <div style={{ padding: "8px 12px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                                borderRadius: C.radius, display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "12px", color: C.textWeak }}>File:</span>
                    <code style={{ fontSize: "12px", color: C.brand, flex: 1 }}>{agentFile.relativePath || agentFile.name}</code>
                    <span style={{ fontSize: "11px", color: C.textWeaker }}>{(agentFile.size/1024).toFixed(1)} KB</span>
                  </div>
                  <Alert type="info">
                    Edit the .agent script directly. Changes are saved to your SFDX project. Use your AI coding agent to make larger refactors.
                  </Alert>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <Btn onClick={saveAgent} disabled={saving || !editDirty}
                      variant={editDirty ? "brand" : "neutral"} size="sm">
                      {saving ? <><Spinner size={10} /> Saving…</> : "💾 Save to project"}
                    </Btn>
                    {editDirty && (
                      <button onClick={() => { setAgentContent(agentFile.content); setEditDirty(false); }}
                        style={{ background: "none", border: "none", color: C.textWeak, cursor: "pointer", fontSize: "12px" }}>
                        ↺ Reset
                      </button>
                    )}
                    {saveMsg && (
                      <span style={{ fontSize: "12px", color: saveMsg.startsWith("✓") ? C.success : C.error, fontWeight: "600" }}>
                        {saveMsg}
                      </span>
                    )}
                    {editDirty && <span style={{ fontSize: "11px", color: C.gold }}>● Unsaved changes</span>}
                  </div>
                </>
              )}
              {!agentFile && (
                <div style={{ padding: "20px", textAlign: "center", color: C.textWeaker, fontSize: "13px" }}>
                  Select a .agent file to start editing
                </div>
              )}
            </div>
          </Card>

          {/* Right — editor */}
          {agentFile ? (
            <Card>
              <CardHeader title={agentFile.name}
                subtitle={`${agentContent.split("\n").length} lines · ${editDirty ? "unsaved changes" : "saved"}`} />
              <div style={{ padding: "16px" }}>
                <AgentEditor
                  value={agentContent}
                  onChange={v => { setAgentContent(v); setEditDirty(true); }}
                  minHeight="600px"
                />
              </div>
            </Card>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "300px",
                          border: `1px dashed ${C.border}`, borderRadius: C.radiusMd, color: C.textWeaker,
                          fontSize: "13px", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "28px" }}>📄</span>
              <span>Select a .agent file to edit</span>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── Preview Step Panel — runs a step in a persistent server-side bash session ──
function PreviewStepPanel({ stepNum, label, script, utterances, org, apiName, sessionId, serverOnline, onSessionId, onTracesPath }) {
  const [lines, setLines]     = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone]       = useState(false);
  const [open, setOpen]       = useState(true);
  const bottomRef             = useRef(null);
  const readerRef             = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines]);

  const run = async () => {
    if (!serverOnline || running) return;
    setLines([]); setRunning(true); setDone(false); setOpen(true);

    try {
      // Step 1 creates the session, subsequent steps reuse it
      let sid = sessionId;
      if (stepNum === 1) {
        const r = await fetch(`${API}/preview/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await r.json();
        sid = d.sessionId;
        onSessionId && onSessionId(sid);
      }

      const res = await fetch(`${API}/preview/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          script,
          utterances: stepNum === 2 ? utterances : undefined,
          org: stepNum === 2 ? org : undefined,
          apiName: stepNum === 2 ? apiName : undefined,
          captureVars: stepNum === 1 ? ["SESSION_ID"] : [],
        }),
      });

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = "";

      const pump = async () => {
        while (true) {
          const { done: rdone, value } = await reader.read();
          if (rdone) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop();
          for (const part of parts) {
            const line = part.replace(/^data: /, "").trim();
            if (!line || line.startsWith(":")) continue;
            try {
              const { type, text } = JSON.parse(line);
              setLines(l => [...l, { type, text }]);
              // Capture tracesPath from step 3 JSON output
              if (type === "stdout" && stepNum === 3 && onTracesPath) {
                try {
                  const j = JSON.parse(text);
                  if (j.result && j.result.tracesPath) onTracesPath(j.result.tracesPath);
                } catch (_) {}
              }
              if (type === "done" || type === "error") { setRunning(false); setDone(type === "done"); }
            } catch (_) {}
          }
        }
        setRunning(false);
      };
      pump();
    } catch (e) {
      setLines(l => [...l, { type: "error", text: `\n✗ ${e.message}` }]);
      setRunning(false);
    }
  };

  const stop = () => { try { readerRef.current?.cancel(); } catch (_) {} setRunning(false); };

  const typeColor = { stdout: C.text, stderr: "#b75000", info: C.textWeak, done: C.success, error: C.error };

  const stepColor = done ? C.success : running ? C.gold : C.textWeaker;

  // A step is locked if it requires a previous step that hasn't run yet
  const locked = (stepNum === 2 || stepNum === 3) && !sessionId;

  return (
    <div style={{ border: `1px solid ${locked ? C.border : done ? C.success : running ? C.gold : C.border}`,
                  borderRadius: C.radius, overflow: "hidden", transition: "all 0.2s",
                  opacity: locked ? 0.45 : 1, pointerEvents: locked ? "none" : "auto" }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`,
                    display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "22px", height: "22px", borderRadius: "50%",
                      border: `2px solid ${locked ? C.border : stepColor}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "10px", fontWeight: "700",
                      color: locked ? C.textWeaker : stepColor, flexShrink: 0 }}>
          {done ? "✓" : locked ? "—" : stepNum}
        </div>
        <span style={{ fontSize: "12px", fontWeight: "600", color: locked ? C.textWeaker : C.text, flex: 1 }}>{label}</span>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {!running && !locked && (
            <button onClick={() => { navigator.clipboard.writeText(script); }}
              style={{ background: "none", border: "none", color: C.textWeak, cursor: "pointer", fontSize: "11px" }}>Copy</button>
          )}
          {locked
            ? <span style={{ fontSize: "11px", color: C.textWeaker }}>Run step {stepNum - 1} first</span>
            : running
              ? <Btn size="sm" variant="danger" onClick={stop}>■ Stop</Btn>
              : <Btn size="sm" variant="success" onClick={run} disabled={!serverOnline}>▶ Run</Btn>
          }
          {lines.length > 0 && (
            <button onClick={() => setOpen(o => !o)}
              style={{ background: "none", border: "none", color: C.brand, fontSize: "11px", cursor: "pointer" }}>
              {open ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>
      {/* Script */}
      <div style={{ padding: "10px 14px", fontFamily: "JetBrains Mono, monospace", fontSize: "11px",
                    color: "#79c0ff", background: "#0d1117", whiteSpace: "pre-wrap", lineHeight: "1.6",
                    maxHeight: "120px", overflowY: "auto" }}>
        {script}
      </div>
      {/* Output */}
      {open && lines.length > 0 && (
        <div style={{ background: "#1e1e1e", borderTop: `1px solid ${C.border}`, padding: "10px 14px",
                      maxHeight: "180px", overflowY: "auto", fontFamily: "monospace", fontSize: "11px", lineHeight: "1.7" }}>
          {lines.map((l, i) => <span key={i} style={{ color: typeColor[l.type] || "#ccc", whiteSpace: "pre-wrap" }}>{l.text}</span>)}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

// ── Trace Analysis Panel ─────────────────────────────────────────────────────
const TRACE_CHECKS = [
  {
    id: "topic", label: "Topic Routing", icon: "🗺",
    desc: "The agent routed the utterance to the correct topic",
    tooltip: "Checks the TransitionStep in the trace to verify the correct topic was activated.",
    failHelp: "TOPIC NOT MATCHED — Add more keywords or synonyms to your topic description in the .agent file. Make sure the topic description clearly covers the user intent. Fix strategy: improve topic description wording.",
  },
  {
    id: "action", label: "Action Invocation", icon: "⚡",
    desc: "The expected action was invoked by the planner",
    tooltip: "Checks that a FunctionStep or tool_call was triggered during the plan execution.",
    failHelp: "ACTION NOT INVOKED — The planner did not call any action. Improve the action description to better match the user intent, or check that the action is marked as available in the current topic context. Fix strategy: improve action description.",
  },
  {
    id: "ground", label: "Grounding", icon: "🔗",
    desc: "The response is grounded (not hallucinated)",
    tooltip: "Checks the ReasoningStep category. GROUNDED means the response is based on retrieved data. SMALL_TALK is acceptable for conversational turns.",
    failHelp: "UNGROUNDED RESPONSE — The planner generated a response without grounding it in retrieved data. Add grounding instructions to the topic reasoning block, or ensure the relevant action retrieves data before responding. Fix strategy: add context retention instructions.",
  },
  {
    id: "safety", label: "Safety Score", icon: "🛡",
    desc: "Safety score ≥ 0.9 (content is safe)",
    tooltip: "Checks PlannerResponseStep.safetyScore. A score below 0.9 indicates potential unsafe content was detected.",
    failHelp: "SAFETY SCORE LOW — The response may contain unsafe content. Add system instruction guardrails to your topic reasoning. Review the response for toxicity, bias, or inappropriate content. Fix strategy: add SAFETY GUARDRAILS to the topic instructions.",
  },
  {
    id: "tools", label: "Tool Visibility", icon: "🔧",
    desc: "Tools are visible to the planner",
    tooltip: "Checks EnabledToolsStep to verify actions are exposed to the LLM planner for this turn.",
    failHelp: "GUARDRAIL / TOOL NOT VISIBLE — The planner could not see the expected tools. Check that the action is enabled in the topic and that no guardrail is blocking it. Fix strategy: check action availability conditions in the .agent file.",
  },
  {
    id: "response", label: "Response Quality", icon: "💬",
    desc: "The agent produced a non-empty, relevant response",
    tooltip: "Checks PlannerResponseStep.message is non-empty and substantial.",
    failHelp: "RESPONSE QUALITY FAILURE — The agent returned an empty or very short response. Check that the topic instructions include a clear response directive. Fix strategy: add explicit response guidelines to the topic reasoning instructions.",
  },
];

function TraceAnalysisPanel({ tracesPath, serverOnline }) {
  const [files, setFiles]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [results, setResults]   = useState({}); // { filename: { checkId: { value, pass } } }
  const [expanded, setExpanded] = useState(null);
  const [error, setError]       = useState("");

  useEffect(() => {
    if (!tracesPath || !serverOnline) return;
    setLoading(true); setError(""); setResults({});
    fetch(`${API}/preview/traces?path=${encodeURIComponent(tracesPath)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setError(d.error); return; }
        setFiles(d.files || []);
        // Parse each trace file
        const res = {};
        for (const f of d.files) {
          res[f.name] = analyzeTrace(f.content);
        }
        setResults(res);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [tracesPath, serverOnline]);

  const analyzeTrace = (content) => {
    try {
      const trace = JSON.parse(content);
      const steps = trace.plan || trace.steps || [];
      const out = {};

      // 1. Topic Routing — root "topic" + TransitionStep
      const rootTopic = trace.topic && trace.topic !== "DefaultTopic" ? trace.topic : null;
      const transTopics = steps
        .filter(s => (s.type||s.stepType) === "TransitionStep")
        .map(s => s.data?.to || s.data?.topic).filter(Boolean);
      const allTopics = [...new Set([...(rootTopic?[rootTopic]:[]), ...transTopics])];
      out.topic = { value: allTopics.join(", ") || trace.topic || "DefaultTopic", pass: !!(rootTopic || transTopics.length > 0) };

      // 2. Action Invocation — tool_calls in LLMStep messages_sent
      const toolCallNames = steps
        .filter(s => (s.type||s.stepType) === "LLMStep")
        .flatMap(s => s.messages_sent || [])
        .filter(m => m.role === "assistant" && m.tool_calls)
        .flatMap(m => m.tool_calls || [])
        .map(t => t.function?.name).filter(Boolean);
      const allActions = [...new Set(toolCallNames)];
      out.action = { value: allActions.join(", ") || "—", pass: allActions.length > 0 };

      // 3. Grounding — ReasoningStep.category
      const reasonSteps = steps.filter(s => (s.type||s.stepType) === "ReasoningStep");
      const categories = reasonSteps.map(s => s.category || s.data?.groundingAssessment).filter(Boolean);
      const badCategories = categories.filter(c => c !== "GROUNDED" && c !== "SMALL_TALK" && c !== "SAFE");
      out.ground = {
        value: categories.join(", ") || "—",
        pass: categories.length > 0 && badCategories.length === 0
      };

      // 4. Safety Score — PlannerResponseStep.safetyScore.safetyScore.safety_score
      const plannerSteps = steps.filter(s => (s.type||s.stepType) === "PlannerResponseStep");
      const safetyScores = plannerSteps.map(s => {
        const ss = s.safetyScore || s.data?.safetyScore;
        return ss?.safetyScore?.safety_score ?? ss?.safety_score ?? (typeof ss === "number" ? ss : undefined);
      }).filter(v => typeof v === "number");
      const minSafety = safetyScores.length > 0 ? Math.min(...safetyScores) : null;
      out.safety = { value: minSafety !== null ? minSafety.toFixed(2) : "—", pass: minSafety !== null && minSafety >= 0.9 };

      // 5. Tool Visibility — EnabledToolsStep + LLMStep.tools_sent
      const toolSteps = steps.filter(s => (s.type||s.stepType) === "EnabledToolsStep");
      const enabledTools = toolSteps.flatMap(s => s.data?.enabled_tools || []).filter(Boolean);
      const llmTools = steps.filter(s => (s.type||s.stepType) === "LLMStep").flatMap(s => s.tools_sent || []).filter(Boolean);
      const allTools = [...new Set([...enabledTools, ...llmTools])];
      out.tools = {
        value: allTools.length > 0 ? allTools.slice(0,3).join(", ") + (allTools.length > 3 ? ` +${allTools.length-3}` : "") : "—",
        pass: allTools.length > 0
      };

      // 6. Response Quality — PlannerResponseStep.message
      const finalResp = plannerSteps.map(s => s.message).filter(Boolean).slice(-1)[0]
        || steps.filter(s => (s.type||s.stepType) === "LLMStep").map(s => s.data?.prompt_response).filter(Boolean).slice(-1)[0]
        || "";
      out.response = { value: finalResp ? finalResp.substring(0,80)+(finalResp.length>80?"…":"") : "—", pass: finalResp.length > 5 };

      // Extract utterance (first UserInputStep) and final response (last PlannerResponseStep)
      const userInput = steps.find(s => (s.type||s.stepType) === "UserInputStep");
      out._utterance = userInput?.message || "";
      const plannerLast = steps.filter(s => (s.type||s.stepType) === "PlannerResponseStep").slice(-1)[0];
      out._response = plannerLast?.message || "";

      // Extract utterance and final response for display
      const uiStep = steps.find(s => (s.type||s.stepType) === "UserInputStep");
      out._utterance = uiStep?.message || "";
      const prStep = steps.filter(s => (s.type||s.stepType) === "PlannerResponseStep").slice(-1)[0];
      out._response = prStep?.message || "";

      return out;
    } catch (e) {
      return { _error: e.message };
    }
  };


  const fileNames = Object.keys(results);
  const totalChecks = fileNames.length * TRACE_CHECKS.length;
  const passedChecks = fileNames.reduce((sum, f) =>
    sum + TRACE_CHECKS.filter(c => results[f]?.[c.id]?.pass).length, 0);

  const locked4 = !tracesPath;

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden", marginTop: "4px",
                  opacity: locked4 ? 0.45 : 1, pointerEvents: locked4 ? "none" : "auto", transition: "opacity 0.2s" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`,
                    display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "22px", height: "22px", borderRadius: "50%",
                      border: `2px solid ${locked4 ? C.border : C.gold}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "10px", fontWeight: "700", color: locked4 ? C.textWeaker : C.gold }}>
          {locked4 ? "—" : "4"}
        </div>
        <span style={{ fontSize: "12px", fontWeight: "600", color: locked4 ? C.textWeaker : C.text, flex: 1 }}>Trace Analysis</span>
        {locked4 && <span style={{ fontSize: "11px", color: C.textWeaker }}>Run step 3 first</span>}
        {!loading && fileNames.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "11px", color: passedChecks === totalChecks ? C.success : C.warning, fontWeight: "700" }}>
              {passedChecks}/{totalChecks} checks passed
            </span>
            <div style={{ width: "60px", height: "6px", background: C.border, borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ width: `${totalChecks > 0 ? (passedChecks/totalChecks)*100 : 0}%`,
                            height: "100%", background: passedChecks === totalChecks ? C.success : C.warning,
                            transition: "width 0.4s" }} />
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "12px 14px" }}>
        {loading && <div style={{ color: C.textWeak, fontSize: "12px" }}><Spinner size={11} /> Loading traces…</div>}
        {error && <Alert type="error">{error}</Alert>}
        {!loading && !error && !tracesPath && (
          <div style={{ fontSize: "12px", color: C.textWeaker, textAlign: "center", padding: "12px 0" }}>
            Run Step 3 to end the session and load trace files
          </div>
        )}
        {!loading && !error && tracesPath && fileNames.length === 0 && (
          <div style={{ fontSize: "12px", color: C.textWeak }}>No trace files found at <code>{tracesPath}</code></div>
        )}

        {fileNames.map(fname => {
          const checks = results[fname];
          const isOpen = expanded === fname;
          const passed = TRACE_CHECKS.filter(c => checks[c.id]?.pass).length;
          const allPass = passed === TRACE_CHECKS.length;
          return (
            <div key={fname} style={{ marginBottom: "8px", border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden" }}>
              <div onClick={() => setExpanded(isOpen ? null : fname)}
                style={{ padding: "8px 12px", background: C.surface, cursor: "pointer",
                         display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "14px" }}>{allPass ? "✅" : "⚠️"}</span>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  {results[fname]?._utterance
                    ? <span style={{ fontSize: "12px", color: C.text, fontStyle: "italic" }}>"{results[fname]._utterance.substring(0,50)}{results[fname]._utterance.length > 50 ? "…" : ""}"</span>
                    : <code style={{ fontSize: "11px", color: C.textWeak }}>{fname}</code>
                  }
                </div>
                <span style={{ fontSize: "11px", fontWeight: "700",
                               color: allPass ? C.success : C.warning }}>{passed}/{TRACE_CHECKS.length}</span>
                <span style={{ fontSize: "10px", color: C.textWeaker }}>{isOpen ? "▲" : "▼"}</span>
              </div>

              {isOpen && (
                <div style={{ borderTop: `1px solid ${C.border}` }}>
                  {checks._utterance && (
                    <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`,
                                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                      <div>
                        <div style={{ fontSize: "10px", fontWeight: "700", color: C.textWeaker, textTransform: "uppercase",
                                      letterSpacing: "0.5px", marginBottom: "4px" }}>Utterance</div>
                        <div style={{ fontSize: "12px", color: C.text, fontStyle: "italic" }}>"{checks._utterance}"</div>
                      </div>
                      {checks._response && (
                        <div>
                          <div style={{ fontSize: "10px", fontWeight: "700", color: C.textWeaker, textTransform: "uppercase",
                                        letterSpacing: "0.5px", marginBottom: "4px" }}>Agent Response</div>
                          <div style={{ fontSize: "12px", color: C.textWeak, lineHeight: "1.5" }}>
                            {checks._response.substring(0, 120)}{checks._response.length > 120 ? "…" : ""}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {checks._error ? (
                    <div style={{ padding: "10px 12px", fontSize: "12px", color: C.error }}>Parse error: {checks._error}</div>
                  ) : (
                    TRACE_CHECKS.map(check => {
                      const r = checks[check.id] || {};
                      return (
                        <div key={check.id} style={{ borderBottom: `1px solid ${C.border}`,
                                                     background: r.pass ? "rgba(63,185,80,0.04)" : "rgba(248,81,73,0.04)" }}>
                          {/* Main row */}
                          <div style={{ padding: "8px 12px", display: "flex", alignItems: "flex-start", gap: "10px" }}
                               title={check.tooltip}>
                            <span style={{ fontSize: "13px", flexShrink: 0, marginTop: "1px",
                                           color: r.pass ? C.success : C.error }}>
                              {r.pass ? "✓" : "✗"}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                                <span style={{ fontSize: "11px" }}>{check.icon}</span>
                                <span style={{ fontSize: "12px", fontWeight: "600",
                                               color: r.pass ? C.success : C.error }}>{check.label}</span>
                                <span style={{ fontSize: "10px", color: C.textWeaker, cursor: "help" }}
                                      title={check.tooltip}>ⓘ</span>
                              </div>
                              <div style={{ fontSize: "11px", color: C.textWeak }}>{check.desc}</div>
                            </div>
                            <div style={{ maxWidth: "180px", fontSize: "11px",
                                          color: r.pass ? C.brand : C.textWeaker,
                                          fontFamily: "monospace", textAlign: "right", wordBreak: "break-all" }}>
                              {r.value || "—"}
                            </div>
                          </div>
                          {/* Fail help banner */}
                          {!r.pass && (
                            <div style={{ margin: "0 12px 8px", padding: "8px 10px",
                                          background: "rgba(248,81,73,0.08)", border: `1px solid rgba(248,81,73,0.2)`,
                                          borderRadius: C.radius, fontSize: "11px", color: C.textWeak, lineHeight: "1.5" }}>
                              <span style={{ fontWeight: "700", color: C.error }}>💡 Fix: </span>
                              {check.failHelp}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 3.5 — LOCAL TESTING (preview)
// ═══════════════════════════════════════════════════════════════════════════════

function PageLocalTest({ serverOnline, targetOrg = "my-dev-org" }) {
  const [sessionId, setSessionId]       = useState(null);
  const [tracesPath, setTracesPath]       = useState("");
  const [agentFile, setAgentFile]       = useState(null);
  const [apiName, setApiName]           = useState("");
  const [customOrg, setCustomOrg]       = useState("");
  const [useCustomOrg, setUseCustomOrg] = useState(false);

  const [utterances, setUtterances]     = useState([]);
  const [newUtterance, setNewUtterance] = useState("");

  const handleSelectAgent = f => {
    setAgentFile(f);
    const detected = parseAgentDeveloperName(f?.content) || f?.name?.replace(".agent", "");
    setApiName(detected || "");
    // Auto-populate utterances from topics
    const topics = parseAgentTopics(f?.content);
    if (topics.length > 0 && utterances.length === 0) {
      setUtterances(topics.map(t => `Test the ${t.replace(/_/g, " ")} topic`));
    }
  };

  const org = useCustomOrg && customOrg.trim() ? customOrg.trim() : targetOrg;
  const ready = apiName.trim().length > 0;

  const addUtterance = () => {
    if (newUtterance.trim()) {
      setUtterances(u => [...u, newUtterance.trim()]);
      setNewUtterance("");
    }
  };

  const removeUtterance = i => setUtterances(u => u.filter((_, idx) => idx !== i));

  const moveUp   = i => { if (i === 0) return; const u = [...utterances]; [u[i-1], u[i]] = [u[i], u[i-1]]; setUtterances(u); };
  const moveDown = i => { if (i === utterances.length - 1) return; const u = [...utterances]; [u[i], u[i+1]] = [u[i+1], u[i]]; setUtterances(u); };

  // Build the 3-step bash script
  const utterancesBlock = utterances.length > 0
    ? utterances.map((u, i) => `  ${JSON.stringify(u)}${i < utterances.length - 1 ? " \\" : ""}`)
    .join("\n")
    : `  "Hello" \\\n  "Test utterance"`;

  // Use node -e to parse JSON — avoids jq dependency
  const step1 = `SESSION_ID=$(sf agent preview start \\
  --authoring-bundle ${apiName || "MyAgent"} \\
  --target-org ${org} --json 2>/dev/null \\
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).result.sessionId))")
echo "Session: $SESSION_ID"`;

  // Build utterances as a bash array
  // step2 script is built server-side to avoid JSX template literal issues
  // We pass utterances as JSON and the server injects them
  // Build a readable version of step2 for display (actual execution uses server-built script)
  const step2Utterances = utterances.length > 0 ? utterances : ["Hello"];
  const step2 = [
    "for UTTERANCE in \\",
    ...step2Utterances.map((u, i) => `  ${JSON.stringify(u)}${i < step2Utterances.length - 1 ? " \\" : "; do"}`),
    `  sf agent preview send --authoring-bundle ${apiName || "MyAgent"} \\`,
    `    --session-id "$SESSION_ID" --utterance "$UTTERANCE" \\`,
    `    --target-org ${org} --json 2>/dev/null`,
    "done",
  ].join("\n");

  const step3 = `sf agent preview end --authoring-bundle ${apiName || "MyAgent"} --session-id "$SESSION_ID" --target-org ${org} --json`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>

      {/* Left — config */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Card>
          <CardHeader icon="🧪" title="Local Testing"
            subtitle="Start a preview session, send utterances, and collect traces — without deploying" />
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

            <FilePicker
              label=".agent file"
              route="/files/agents"
              filterFn={f => f.name.endsWith(".agent") || f.content?.includes("developer_name:")}
              selected={agentFile}
              onSelect={handleSelectAgent}
              emptyMsg="No .agent files found. Check SF_PROJECT_PATH in .env."
              serverOnline={serverOnline}
            />

            <Field label="Authoring Bundle API Name" hint="Auto-detected from the .agent file">
              <input value={apiName} onChange={e => setApiName(e.target.value)}
                placeholder="e.g. OrderSupport"
                style={{ ...inputStyle, fontFamily: "monospace" }} />
            </Field>

            <Field label="Target Org">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ padding: "8px 12px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                                borderRadius: C.radius, fontFamily: "monospace", fontSize: "13px",
                                color: useCustomOrg ? C.textWeak : C.brand, flex: 1,
                                textDecoration: useCustomOrg ? "line-through" : "none" }}>
                    {targetOrg}
                  </div>
                  <span style={{ fontSize: "12px", color: C.textWeak }}>from config</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input type="checkbox" checked={useCustomOrg} onChange={e => setUseCustomOrg(e.target.checked)}
                    style={{ accentColor: C.brand }} />
                  <span style={{ fontSize: "12px", color: C.textWeak }}>Use a different org</span>
                </label>
                {useCustomOrg && (
                  <input value={customOrg} onChange={e => setCustomOrg(e.target.value)}
                    placeholder="my-other-org"
                    style={{ ...inputStyle, fontFamily: "monospace" }} />
                )}
              </div>
            </Field>

          </div>
        </Card>

        {/* Utterances */}
        <Card>
          <CardHeader title="Test Utterances"
            subtitle={`${utterances.length} utterance${utterances.length !== 1 ? "s" : ""} — one per topic recommended`} />
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>

            {utterances.length === 0 && (
              <div style={{ padding: "12px", background: C.surfaceAlt, border: `1px dashed ${C.border}`,
                            borderRadius: C.radius, color: C.textWeak, fontSize: "12px", textAlign: "center" }}>
                Select an agent to auto-populate utterances, or add them manually
              </div>
            )}

            {utterances.map((u, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px",
                                    background: C.surfaceAlt, border: `1px solid ${C.border}`,
                                    borderRadius: C.radius, padding: "8px 10px" }}>
                <span style={{ fontSize: "10px", color: C.textWeaker, fontWeight: "700",
                               minWidth: "18px", textAlign: "right" }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: "13px", color: C.text, fontFamily: "monospace",
                               fontSize: "12px" }}>{u}</span>
                <div style={{ display: "flex", gap: "2px" }}>
                  <button onClick={() => moveUp(i)} disabled={i === 0}
                    style={{ background: "none", border: "none", color: i === 0 ? C.textWeaker : C.textWeak,
                             cursor: i === 0 ? "default" : "pointer", fontSize: "12px", padding: "2px 4px" }}>↑</button>
                  <button onClick={() => moveDown(i)} disabled={i === utterances.length - 1}
                    style={{ background: "none", border: "none", color: i === utterances.length - 1 ? C.textWeaker : C.textWeak,
                             cursor: i === utterances.length - 1 ? "default" : "pointer", fontSize: "12px", padding: "2px 4px" }}>↓</button>
                  <button onClick={() => removeUtterance(i)}
                    style={{ background: "none", border: "none", color: C.error, cursor: "pointer",
                             fontSize: "13px", padding: "2px 4px" }}>×</button>
                </div>
              </div>
            ))}

            <div style={{ display: "flex", gap: "8px" }}>
              <input value={newUtterance} onChange={e => setNewUtterance(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addUtterance()}
                placeholder='e.g. "Where is my order?"'
                style={{ ...inputStyle, flex: 1, fontSize: "12px" }} />
              <Btn size="sm" variant="outline" onClick={addUtterance} disabled={!newUtterance.trim()}>+ Add</Btn>
            </div>

            {utterances.length > 0 && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button onClick={() => setUtterances(u => [...u, "Tell me a joke"])}
                  style={{ background: "none", border: `1px dashed ${C.border}`, borderRadius: C.radius,
                           color: C.textWeak, fontSize: "11px", padding: "3px 8px", cursor: "pointer" }}>
                  + Off-topic guardrail
                </button>
                <button onClick={() => setUtterances([])}
                  style={{ background: "none", border: "none", color: C.error, fontSize: "11px",
                           cursor: "pointer", padding: "3px 8px" }}>
                  Clear all
                </button>
              </div>
            )}

          </div>
        </Card>
      </div>

      {/* Right — step-by-step runner */}
      {ready ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", animation: "fadeIn 0.2s ease" }}>

          {sessionId && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "8px 12px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                          borderRadius: C.radius }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.success, display: "inline-block" }} />
                <span style={{ fontSize: "11px", color: C.textWeak }}>Session active:</span>
                <code style={{ fontSize: "11px", color: C.success }}>{sessionId}</code>
              </div>
              <button onClick={() => setSessionId(null)}
                style={{ background: "none", border: "none", color: C.error, cursor: "pointer", fontSize: "11px" }}>
                × End session
              </button>
            </div>
          )}

          <PreviewStepPanel stepNum={1} label="Start preview session"
            script={step1} sessionId={sessionId} serverOnline={serverOnline}
            onSessionId={sid => setSessionId(sid)} />

          <PreviewStepPanel stepNum={2} label="Send utterances"
            script={step2} utterances={step2Utterances} org={org} apiName={apiName} sessionId={sessionId} serverOnline={serverOnline} />

          <PreviewStepPanel stepNum={3} label="End session & get traces"
            script={step3} sessionId={sessionId} serverOnline={serverOnline}
            onTracesPath={p => setTracesPath(p)} />

          {/* Step 4 — Trace analysis */}
          <TraceAnalysisPanel tracesPath={tracesPath} serverOnline={serverOnline} />

        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "280px",
                      border: `1px dashed ${C.border}`, borderRadius: C.radiusMd, color: C.textWeaker,
                      fontSize: "13px", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "28px" }}>🧪</span>
          <span>Select an agent to build the preview commands</span>
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 4 — DEPLOY & ACTIVATE
// ═══════════════════════════════════════════════════════════════════════════════

function PageDeploy({ serverOnline, targetOrg = "my-dev-org" }) {
  const [agentFile, setAgentFile]     = useState(null);
  const [apiName, setApiName]         = useState("");
  const [customOrg, setCustomOrg]     = useState("");
  const [useCustomOrg, setUseCustomOrg] = useState(false);


  const handleSelectAgent = f => {
    setAgentFile(f);
    const detected = parseAgentDeveloperName(f?.content) || f?.name?.replace(".agent", "");
    setApiName(detected || "");
  };

  const org = useCustomOrg && customOrg.trim() ? customOrg.trim() : targetOrg;
  const ready = apiName.trim().length > 0;

  const publishCmd = "sf agent publish authoring-bundle --api-name " + (apiName || "MyAgent") + " --target-org " + org + " --json";
  const activateCmd = "sf agent activate --api-name " + (apiName || "MyAgent") + " --target-org " + org + " --json";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>

      {/* Left — config */}
      <Card>
        <CardHeader icon="🚀" title="Deploy & Activate"
          subtitle="Publish the authoring bundle and activate the agent in your org" />
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

          <FilePicker
            label=".agent file"
            route="/files/agents"
            filterFn={f => f.name.endsWith(".agent") || f.content?.includes("developer_name:")}
            selected={agentFile}
            onSelect={handleSelectAgent}
            emptyMsg="No .agent files found. Check SF_PROJECT_PATH in .env."
            serverOnline={serverOnline}
          />

          <Field label="Agent API Name" hint="Auto-detected from the .agent file — edit if needed">
            <input value={apiName} onChange={e => setApiName(e.target.value)}
              placeholder="e.g. AtlasAirlinesServiceAgent"
              style={{ ...inputStyle, fontFamily: "monospace" }} />
          </Field>

          <Field label="Target Org">
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ padding: "8px 12px", background: C.surfaceAlt, border: `1px solid ${C.border}`,
                              borderRadius: C.radius, fontFamily: "monospace", fontSize: "13px",
                              color: useCustomOrg ? C.textWeak : C.brand, flex: 1,
                              textDecoration: useCustomOrg ? "line-through" : "none" }}>
                  {targetOrg}
                </div>
                <span style={{ fontSize: "12px", color: C.textWeak }}>from config</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input type="checkbox" checked={useCustomOrg} onChange={e => setUseCustomOrg(e.target.checked)}
                  style={{ accentColor: C.brand }} />
                <span style={{ fontSize: "12px", color: C.textWeak }}>Use a different org</span>
              </label>
              {useCustomOrg && (
                <input value={customOrg} onChange={e => setCustomOrg(e.target.value)}
                  placeholder="my-other-org"
                  style={{ ...inputStyle, fontFamily: "monospace" }} />
              )}
            </div>
          </Field>

        </div>
      </Card>

      {/* Right — commands */}
      {ready ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "fadeIn 0.2s ease" }}>
          <Card>
            <CardHeader title="Publish & Activate"
              subtitle={`Agent: ${apiName} · Org: ${org}`} />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <CmdBlock label="1. Publish authoring bundle" cmd={publishCmd} serverOnline={serverOnline}
                note="Publishes the compiled authoring bundle to your org" />
              <CmdBlock label="2. Activate agent" cmd={activateCmd} serverOnline={serverOnline}
                note="Activates the agent and makes it available to users" />
              <Alert type="success">
                <strong>Run in order.</strong> Publish first, then activate. Both commands use <code>--json</code> for structured output.
              </Alert>
            </div>
          </Card>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "200px",
                      border: `1px dashed ${C.border}`, borderRadius: C.radiusMd, color: C.textWeaker,
                      fontSize: "13px", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "24px" }}>🚀</span>
          <span>Select an agent to build the commands</span>
        </div>
      )}

    </div>
  );
}



// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 5.5 — TESTING CENTER
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE 6 — OBSERVABILITY & STDM ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

const STDM_DMOS = [
  {
    name: "AIAgentSession_dlm",
    label: "AIAgentSession",
    role: "Root session record",
    fields: ["StartTimestamp", "EndTimestamp", "ChannelType", "EndType"],
    color: "#1f6feb",
    icon: "🗂",
  },
  {
    name: "AIAgentInteraction_dlm",
    label: "AIAgentInteraction",
    role: "Session → N Turns",
    fields: ["TopicApiName", "InteractionType", "TraceId"],
    color: "#3fb950",
    icon: "🔄",
  },
  {
    name: "AIAgentInteractionStep_dlm",
    label: "AIAgentInteractionStep",
    role: "Turn → N Steps",
    fields: ["StepType (LLM/ACTION)", "InputValue", "OutputValue", "Error"],
    color: "#e3b341",
    icon: "⚙️",
  },
  {
    name: "AIAgentMoment_dlm",
    label: "AIAgentMoment",
    role: "Session (NOT Turn)",
    fields: ["AgentApiName*", "RequestSummary", "ResponseSummary"],
    color: "#f78166",
    icon: "⏱",
  },
  {
    name: "AIAgentMessage_dlm",
    label: "AIAgentMessage",
    role: "Turn → Messages",
    fields: ["Content", "Role", "Timestamp"],
    color: "#d2a8ff",
    icon: "💬",
  },
];

const OBS_ANALYSES = [
  { icon: "📊", label: "Topic Analysis",        desc: "Which topics are triggered most? Which are never triggered (dead code)?" },
  { icon: "⏱",  label: "Latency Profiling",     desc: "Average response time per topic, per action. Identify slow actions." },
  { icon: "🚨",  label: "Error Pattern Detection", desc: "Which failure categories recur? Which utterances consistently fail?" },
  { icon: "🆘",  label: "Escalation Rate",       desc: "What % of conversations escalate to human agents?" },
];

function PageObservability({ serverOnline, targetOrg = "my-dev-org" }) {
  const [agentName, setAgentName]   = useState("");
  const [days, setDays]             = useState(7);
  const [outputPath, setOutputPath] = useState("./stdm_data");
  const [copiedCmd, setCopiedCmd]   = useState(false);

  const extractCmd = `python3 scripts/cli.py extract \\ \n  -org ${targetOrg} \\ \n  -days ${days} \\ \n  -agent ${agentName || "MyAgent"} \\ \n  -output ${outputPath}`;

  const copyCmd = () => {
    navigator.clipboard.writeText(
      `python3 scripts/cli.py extract -org ${targetOrg} -days ${days} -agent ${agentName || "MyAgent"} -output ${outputPath}`
    );
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

      {/* Feedback loop banner */}
      <div style={{ background: "linear-gradient(135deg, rgba(31,111,235,0.12), rgba(227,179,65,0.08))",
                    border: `1px solid ${C.brand}`, borderRadius: C.radiusMd, padding: "16px 20px",
                    display: "flex", alignItems: "center", gap: "16px" }}>
        <span style={{ fontSize: "28px" }}>🔁</span>
        <div>
          <div style={{ fontSize: "14px", fontWeight: "700", color: C.text, marginBottom: "4px" }}>
            Continuous Improvement Loop
          </div>
          <div style={{ fontSize: "12px", color: C.textWeak, lineHeight: "1.5" }}>
            Observability findings from Stage 6 feed back into <strong style={{ color: C.brand }}>Stage 2 — Authoring</strong>.
            The AI updates topic descriptions, action configurations, and guardrails based on real production data.
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {["02", "→", "03", "→", "04", "→", "05", "→", "06", "→", "02"].map((s, i) => (
            s === "→"
              ? <span key={i} style={{ color: C.textWeaker, fontSize: "12px" }}>→</span>
              : <div key={i} style={{ width: "28px", height: "28px", borderRadius: "50%",
                                      background: s === "06" || s === "02" ? C.brand : C.surfaceAlt,
                                      border: `1px solid ${s === "06" || s === "02" ? C.brand : C.border}`,
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      fontSize: "10px", fontWeight: "700",
                                      color: s === "06" || s === "02" ? "#fff" : C.textWeak }}>{s}</div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>

        {/* Left col */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Extraction command */}
          <Card>
            <CardHeader icon="📤" title="Data Extraction"
              subtitle="Extract session tracing data from Salesforce Data Cloud" />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>

              <Field label="Agent API Name">
                <input value={agentName} onChange={e => setAgentName(e.target.value)}
                  placeholder="e.g. AtlasAirlinesServiceAgent"
                  style={{ ...inputStyle, fontFamily: "monospace" }} />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <Field label="Days back" hint="Number of days to extract">
                  <div style={{ display: "flex", gap: "6px" }}>
                    {[1, 7, 14, 30].map(d => (
                      <button key={d} onClick={() => setDays(d)}
                        style={{ flex: 1, padding: "7px", borderRadius: C.radius,
                                 border: `1px solid ${days === d ? C.brand : C.border}`,
                                 background: days === d ? C.brandLight : C.surface,
                                 color: days === d ? C.brand : C.textWeak,
                                 fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>{d}d</button>
                    ))}
                  </div>
                </Field>
                <Field label="Output path">
                  <input value={outputPath} onChange={e => setOutputPath(e.target.value)}
                    placeholder="./stdm_data"
                    style={{ ...inputStyle, fontFamily: "monospace", fontSize: "12px" }} />
                </Field>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={labelStyle}>Extraction command</label>
                <div style={{ background: "#0d1117", border: `1px solid ${C.border}`,
                              borderRadius: C.radius, overflow: "hidden" }}>
                  <div style={{ padding: "6px 12px", background: C.surfaceAlt,
                                borderBottom: `1px solid ${C.border}`,
                                display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: C.textWeak, fontWeight: "600",
                                   textTransform: "uppercase", letterSpacing: "0.5px" }}>cli.py extract</span>
                    <button onClick={copyCmd}
                      style={{ background: "none", border: "none", color: copiedCmd ? C.success : C.brand,
                               cursor: "pointer", fontSize: "11px", fontWeight: "600" }}>
                      {copiedCmd ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <div style={{ padding: "12px 14px", fontFamily: "JetBrains Mono, monospace",
                                fontSize: "11px", color: "#79c0ff", whiteSpace: "pre", lineHeight: "1.8" }}>
                    {`python3 scripts/cli.py extract \
  -org ${targetOrg} \
  -days ${days} \
  -agent ${agentName || "MyAgent"} \
  -output ${outputPath}`}
                  </div>
                </div>
              </div>

              <Alert type="info">
                <strong>Note:</strong> Field naming uses <code>AiAgent</code> (lowercase 'i'). Agent name lives on <code>AIAgentMoment</code>, not on Session.
              </Alert>

            </div>
          </Card>

          {/* Analysis capabilities */}
          <Card>
            <CardHeader title="Analysis Capabilities" subtitle="What the STDM analysis reveals" />
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {OBS_ANALYSES.map(({ icon, label, desc }) => (
                <div key={label} style={{ display: "flex", gap: "12px", padding: "10px 12px",
                                          background: C.surfaceAlt, borderRadius: C.radius,
                                          border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "18px", flexShrink: 0 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: C.text, marginBottom: "3px" }}>{label}</div>
                    <div style={{ fontSize: "11px", color: C.textWeak, lineHeight: "1.5" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

        </div>

        {/* Right col — STDM DMOs */}
        <Card>
          <CardHeader icon="🗄" title="The 5 Core Session Tracing DMOs"
            subtitle="Salesforce Data Cloud objects used for agent observability" />
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>

            {/* Hierarchy diagram */}
            <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`,
                          borderRadius: C.radius, padding: "12px 14px", marginBottom: "4px" }}>
              <div style={{ fontSize: "11px", color: C.textWeak, fontWeight: "600",
                            textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                Data Hierarchy
              </div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px",
                            color: C.textWeak, lineHeight: "2" }}>
                <div><span style={{ color: "#1f6feb" }}>AIAgentSession</span> <span style={{ color: C.textWeaker }}>← root</span></div>
                <div style={{ paddingLeft: "14px" }}>├─ <span style={{ color: "#3fb950" }}>AIAgentInteraction</span> <span style={{ color: C.textWeaker }}>(N turns)</span></div>
                <div style={{ paddingLeft: "28px" }}>│  ├─ <span style={{ color: "#e3b341" }}>AIAgentInteractionStep</span> <span style={{ color: C.textWeaker }}>(N steps)</span></div>
                <div style={{ paddingLeft: "28px" }}>│  └─ <span style={{ color: "#d2a8ff" }}>AIAgentMessage</span> <span style={{ color: C.textWeaker }}>(messages)</span></div>
                <div style={{ paddingLeft: "14px" }}>└─ <span style={{ color: "#f78166" }}>AIAgentMoment</span> <span style={{ color: C.textWeaker }}>(session-level, has agent name)</span></div>
              </div>
            </div>

            {STDM_DMOS.map(dmo => (
              <div key={dmo.name} style={{ border: `1px solid ${C.border}`, borderRadius: C.radius,
                                           overflow: "hidden" }}>
                <div style={{ padding: "8px 12px", background: C.surface,
                              display: "flex", alignItems: "center", gap: "10px",
                              borderLeft: `3px solid ${dmo.color}` }}>
                  <span style={{ fontSize: "14px" }}>{dmo.icon}</span>
                  <div style={{ flex: 1 }}>
                    <code style={{ fontSize: "12px", fontWeight: "700", color: dmo.color }}>{dmo.label}</code>
                    <span style={{ fontSize: "11px", color: C.textWeaker, marginLeft: "8px" }}>{dmo.role}</span>
                  </div>
                </div>
                <div style={{ padding: "6px 12px 8px", background: C.surfaceAlt,
                              display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {dmo.fields.map(f => (
                    <span key={f} style={{ padding: "2px 8px", borderRadius: "4px",
                                           background: C.surface, border: `1px solid ${C.border}`,
                                           fontSize: "10px", fontFamily: "monospace",
                                           color: f.includes("*") ? C.warning : C.textWeak }}>
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            ))}

            <Alert type="warning">
              <strong>⚠ Naming quirk:</strong> The field is <code>AiAgentName</code> (lowercase 'i'), not <code>AIAgentName</code>. Agent name is on <code>AIAgentMoment</code>, not on <code>AIAgentSession</code>.
            </Alert>

          </div>
        </Card>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════

function PageProdDeploy({ serverOnline, targetOrg = "my-dev-org" }) {
  const [agentName, setAgentName]       = useState("");
  const [testSuiteName, setTestSuiteName] = useState("");
  const [stagingOrg, setStagingOrg]     = useState("staging");
  const [prodOrg, setProdOrg]           = useState("prod");

  const ready = agentName.trim().length > 0;

  const stagingPublish  = `sf agent publish authoring-bundle --api-name ${agentName || "MyAgent"} --target-org ${stagingOrg} --json`;
  const stagingActivate = `sf agent activate --api-name ${agentName || "MyAgent"} --target-org ${stagingOrg}`;
  const stagingTest     = `sf agent test run --api-name ${testSuiteName || agentName + "Test" || "MyAgentTest"} --wait 10 --result-format json --json --target-org ${stagingOrg}`;
  const prodPublish     = `sf agent publish authoring-bundle --api-name ${agentName || "MyAgent"} --target-org ${prodOrg} --json`;
  const prodActivate    = `sf agent activate --api-name ${agentName || "MyAgent"} --target-org ${prodOrg}`;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>

      {/* Hero banner */}
      <div style={{ background:`linear-gradient(135deg, #0a3622 0%, #0d1117 100%)`, border:`1px solid #238636`,
                    borderRadius:C.radiusMd, padding:"28px 32px", display:"flex", alignItems:"flex-start", gap:"20px" }}>
        <div style={{ fontSize:"36px", flexShrink:0 }}>🏁</div>
        <div>
          <div style={{ fontSize:"20px", fontWeight:"700", color:"#3fb950", marginBottom:"8px" }}>
            You made it — ready for production
          </div>
          <div style={{ fontSize:"14px", color:"#7ee787", lineHeight:"1.7", maxWidth:"640px" }}>
            Your agent has been spec'd, authored, validated, locally tested, deployed to dev, and tested with a full test suite.
            The only thing left is to push it through <strong>staging</strong> for a final smoke test, then ship it to <strong>production</strong>.
          </div>
          <div style={{ marginTop:"14px", display:"flex", gap:"12px", flexWrap:"wrap" }}>
            {["✓ Agent Spec", "✓ Authoring", "✓ Validate", "✓ Local Test", "✓ Deploy Dev", "✓ Test Suite", "✓ Observability"].map(s => (
              <span key={s} style={{ fontSize:"11px", fontWeight:"600", color:"#3fb950", background:"rgba(63,185,80,0.1)",
                                      border:"1px solid rgba(63,185,80,0.3)", borderRadius:"999px", padding:"3px 10px" }}>{s}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"24px", alignItems:"start" }}>

        {/* Left — config */}
        <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
          <Card>
            <CardHeader icon="⚙️" title="Deployment configuration"
              subtitle="Set your agent name and target orgs for staging and production" />
            <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:"14px" }}>

              <Field label="Agent API Name" required>
                <input value={agentName} onChange={e => setAgentName(e.target.value.replace(/\s/g,""))}
                  placeholder="e.g. AtlasAirlinesServiceAgent"
                  style={{ ...inputStyle, fontFamily:"monospace" }} />
              </Field>

              <Field label="Test suite API name" hint="Used in sf agent test run — defaults to [AgentName]Test">
                <input value={testSuiteName} onChange={e => setTestSuiteName(e.target.value.replace(/\s/g,""))}
                  placeholder={agentName ? agentName + "Test" : "e.g. AtlasAirlinesServiceAgentTest"}
                  style={{ ...inputStyle, fontFamily:"monospace" }} />
              </Field>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
                <Field label="Staging org alias">
                  <input value={stagingOrg} onChange={e => setStagingOrg(e.target.value.replace(/\s/g,""))}
                    placeholder="staging"
                    style={{ ...inputStyle, fontFamily:"monospace" }} />
                </Field>
                <Field label="Production org alias">
                  <input value={prodOrg} onChange={e => setProdOrg(e.target.value.replace(/\s/g,""))}
                    placeholder="prod"
                    style={{ ...inputStyle, fontFamily:"monospace" }} />
                </Field>
              </div>

              {!serverOnline && <Alert type="warning">Server offline — commands can be copied but not run.</Alert>}

            </div>
          </Card>

          {/* Pipeline visual */}
          <Card>
            <CardHeader title="Deployment pipeline" subtitle="3-environment promotion flow" />
            <div style={{ padding:"16px" }}>
              {[
                { env:"Dev sandbox", color:C.brand,   icon:"🛠", desc:"Already done — agent tested and validated" },
                { env:"Staging",     color:C.gold,    icon:"🧪", desc:"Publish → activate → smoke test" },
                { env:"Production",  color:"#3fb950", icon:"🚀", desc:"Publish → activate (after staging passes)" },
              ].map(({ env, color, icon, desc }, i) => (
                <div key={env}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:"12px", padding:"10px 0" }}>
                    <div style={{ width:"32px", height:"32px", borderRadius:"50%", background:color + "22",
                                  border:`1.5px solid ${color}`, display:"flex", alignItems:"center",
                                  justifyContent:"center", fontSize:"14px", flexShrink:0 }}>{icon}</div>
                    <div>
                      <div style={{ fontSize:"13px", fontWeight:"700", color:C.text }}>{env}</div>
                      <div style={{ fontSize:"12px", color:C.textWeak, marginTop:"2px" }}>{desc}</div>
                    </div>
                  </div>
                  {i < 2 && <div style={{ marginLeft:"16px", width:"1px", height:"16px", background:C.border }} />}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right — commands */}
        <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

          {/* Staging section */}
          <div style={{ border:`1px solid ${C.gold}22`, borderRadius:C.radiusMd, overflow:"hidden" }}>
            <div style={{ padding:"10px 16px", background:C.gold + "18", borderBottom:`1px solid ${C.gold}22`,
                          display:"flex", alignItems:"center", gap:"8px" }}>
              <span style={{ fontSize:"14px" }}>🧪</span>
              <span style={{ fontSize:"13px", fontWeight:"700", color:C.gold }}>Staging</span>
              <span style={{ fontSize:"11px", color:C.textWeak, marginLeft:"4px" }}>— run these first</span>
            </div>
            <div style={{ padding:"12px", display:"flex", flexDirection:"column", gap:"8px" }}>
              {ready ? (
                <>
                  <CmdBlock label="1. Publish to staging" serverOnline={serverOnline} cmd={stagingPublish} />
                  <CmdBlock label="2. Activate on staging" serverOnline={serverOnline} cmd={stagingActivate} />
                  <CmdBlock label="3. Run test suite on staging" serverOnline={serverOnline} cmd={stagingTest} />
                </>
              ) : (
                <div style={{ padding:"20px", textAlign:"center", color:C.textWeaker, fontSize:"13px" }}>
                  Enter the Agent API Name to generate commands
                </div>
              )}
            </div>
          </div>

          {/* Production section */}
          <div style={{ border:`1px solid #3fb95022`, borderRadius:C.radiusMd, overflow:"hidden" }}>
            <div style={{ padding:"10px 16px", background:"#3fb95018", borderBottom:`1px solid #3fb95022`,
                          display:"flex", alignItems:"center", gap:"8px" }}>
              <span style={{ fontSize:"14px" }}>🚀</span>
              <span style={{ fontSize:"13px", fontWeight:"700", color:"#3fb950" }}>Production</span>
              <span style={{ fontSize:"11px", color:C.textWeak, marginLeft:"4px" }}>— only after staging passes</span>
            </div>
            <div style={{ padding:"12px", display:"flex", flexDirection:"column", gap:"8px" }}>
              {ready ? (
                <>
                  <CmdBlock label="1. Publish to production" serverOnline={serverOnline} cmd={prodPublish} />
                  <CmdBlock label="2. Activate in production" serverOnline={serverOnline} cmd={prodActivate} />
                </>
              ) : (
                <div style={{ padding:"20px", textAlign:"center", color:C.textWeaker, fontSize:"13px" }}>
                  Enter the Agent API Name to generate commands
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage]       = useState("agent"); // "agent" | "test"
  const { status, refresh }   = useServerStatus();
  const serverOnline          = !!status;
  const targetOrg             = status?.targetOrg || "my-dev-org";
  const orgSource             = status?.orgSource || ".env";
  const projectName           = status?.projectName || "";

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
          <svg width="28" height="28" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
            <polygon points="28,4 50,16 50,40 28,52 6,40 6,16" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"/>
            <polygon points="28,12 42,20 42,36 28,44 14,36 14,20" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
            <circle cx="28" cy="28" r="6" fill="#fff"/>
            <circle cx="28" cy="14" r="4" fill="#fff" opacity="0.85"/>
            <circle cx="40" cy="21" r="4" fill="#fff" opacity="0.85"/>
            <circle cx="40" cy="35" r="4" fill="#fff" opacity="0.85"/>
            <circle cx="28" cy="42" r="4" fill="#fff" opacity="0.85"/>
            <circle cx="16" cy="35" r="4" fill="#fff" opacity="0.85"/>
            <circle cx="16" cy="21" r="4" fill="#fff" opacity="0.85"/>
            <g stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" fill="none">
              <line x1="28" y1="14" x2="40" y2="21"/><line x1="40" y1="21" x2="40" y2="35"/>
              <line x1="40" y1="35" x2="28" y2="42"/><line x1="28" y1="42" x2="16" y2="35"/>
              <line x1="16" y1="35" x2="16" y2="21"/><line x1="16" y1="21" x2="28" y2="14"/>
            </g>
          </svg>
          <span style={{ color: "#fff", fontWeight: "800", fontSize: "16px", letterSpacing: "-0.3px" }}>AgentKit</span>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", fontWeight: "500", letterSpacing: "0.5px", textTransform: "uppercase" }}>Designed for TDAD</span>
        </div>
        {/* Header right — org + status */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {serverOnline && (
            <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 10px", background: "rgba(255,255,255,0.1)", borderRadius: "999px" }}>
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>org</span>
              <span style={{ color: "#fff", fontSize: "12px", fontWeight: "700", fontFamily: "monospace" }} title={orgSource}>{targetOrg}</span>
            </div>
          )}
          <div onClick={!serverOnline ? refresh : undefined} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 12px", background: "rgba(255,255,255,0.15)", borderRadius: "999px", cursor: !serverOnline ? "pointer" : "default" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: status === null ? "#aaa" : serverOnline ? "#4bca81" : "#f28b00", display: "inline-block" }} />
            <span style={{ color: "#fff", fontSize: "12px", fontWeight: "500" }}>
              {status === null ? "Connecting…" : serverOnline ? `${projectName ? projectName + " · " : ""}Project connected · ${status.specFiles?.length ?? 0} specs` : "Server offline — click to retry"}
            </span>
          </div>
        </div>
      </div>

      {/* Step switcher */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "12px clamp(20px,4vw,56px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0", overflowX: "auto" }}>
        {[
          { id: "agent",     step: "01", label: "Agent Spec",   sub: "Define your agent"   },
          { id: "authoring", step: "02", label: "Authoring",     sub: "Write the agent script"    },
          { id: "validate",  step: "03", label: "Validation",    sub: "Check for errors" },
          { id: "localtest", step: "03.5", label: "Local Test",    sub: "Smoke test locally"      },
          { id: "deploy",    step: "04", label: "Deployment",    sub: "Push to dev org"        },
          { id: "test",         step: "05",  label: "Formal Test",   sub: "Run formal tests"    },
          { id: "observability", step: "06", label: "Observability", sub: "Analyze & iterate"   },
          { id: "production",    step: "07", label: "Production",    sub: "Deploy to production"  },
        ].map(({ id, step, label, sub }, i, arr) => {
          const active = page === id;
          const steps = ["agent", "authoring", "validate", "localtest", "deploy", "test", "observability", "production"];
          const done  = steps.indexOf(id) < steps.indexOf(page);
          return (
            <React.Fragment key={id}>
              <button onClick={() => setPage(id)} style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "8px 8px 8px 0", background: "none", border: "none", cursor: "pointer", flex: "1",
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
        {page === "agent"     && <PageAgentSpec  serverOnline={serverOnline} targetOrg={targetOrg} />}
        {page === "authoring" && <PageAuthoring serverOnline={serverOnline} targetOrg={targetOrg} />}
        {page === "validate"  && <PageValidate   serverOnline={serverOnline} targetOrg={targetOrg} />}
        {page === "localtest" && <PageLocalTest  serverOnline={serverOnline} targetOrg={targetOrg} />}
        {page === "deploy"    && <PageDeploy     serverOnline={serverOnline} targetOrg={targetOrg} />}
        {page === "test"         && <PageTestSpec      serverOnline={serverOnline} targetOrg={targetOrg} />}
        {page === "observability" && <PageObservability serverOnline={serverOnline} targetOrg={targetOrg} />}
        {page === "production"    && <PageProdDeploy     serverOnline={serverOnline} targetOrg={targetOrg} />}
      </div>
    </div>
  );
}
