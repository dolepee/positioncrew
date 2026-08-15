import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { PositionCrewRequestSchema } from "../contracts/index.js";
import { HashSchema, TimestampSchema } from "../contracts/common.js";
import { canonicalHash } from "../core/canonical.js";
import { BenchmarkProtocolSchema } from "./contracts.js";
import {
  BenchmarkBlindPacketSchema,
  BenchmarkSessionSchema,
  EVALUATOR_INDEPENDENCE_ATTESTATION,
  MANUAL_INDEPENDENCE_ATTESTATION,
  ManualCaptureMetadataSchema,
  SCORECARD_ATTESTATION,
  captureManualBenchmarkRun,
  type BenchmarkCandidateRecord,
} from "./evidence.js";

const ManualTaskPacketSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.manual-task-packet.v1"),
    session: BenchmarkSessionSchema,
    protocol: BenchmarkProtocolSchema,
    fixture: PositionCrewRequestSchema,
    outputContract: z.record(z.string(), z.unknown()),
    instructions: z.array(z.string().min(1)).min(3),
  })
  .strict();

export const ManualHandoffBundleSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.manual-handoff-bundle.v1"),
    sessionId: z.string().min(12),
    taskId: z.string().min(8),
    taskPacketHash: HashSchema,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    outputHash: HashSchema,
    output: z.unknown(),
    metadata: ManualCaptureMetadataSchema,
  })
  .strict();

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function writeExclusive(path: string, value: string): void {
  writeFileSync(path, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function sharedStyles(): string {
  return `
    :root { color-scheme: light; --ink:#17211c; --muted:#607069; --line:#d8dfda; --soft:#f3f6f3; --yellow:#f4c542; --green:#17644f; --red:#923b49; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:#edf1ed; font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    button,input,textarea { font:inherit; }
    button { min-height:40px; padding:0 14px; border:1px solid #b98c00; border-radius:5px; color:#1f1b0e; background:var(--yellow); font-weight:800; cursor:pointer; }
    button.secondary { border-color:var(--line); background:white; }
    button:disabled { cursor:not-allowed; opacity:.5; }
    header { display:flex; align-items:center; justify-content:space-between; gap:20px; min-height:64px; padding:0 24px; color:white; background:#111713; }
    header strong { font-size:16px; } header span { color:#aeb9b3; font-size:12px; }
    main { width:min(1320px,calc(100% - 28px)); margin:22px auto 40px; }
    .panel { border:1px solid var(--line); border-radius:7px; background:white; box-shadow:0 12px 30px rgba(20,32,25,.06); }
    .intro { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,.48fr); gap:0; }
    .intro > section { padding:22px; } .intro > section + section { border-left:1px solid var(--line); background:#f8faf8; }
    .kicker { color:#6b765f; font-size:10px; font-weight:850; text-transform:uppercase; }
    h1 { margin:7px 0 8px; font-size:26px; line-height:1.15; } h2 { margin:0; font-size:16px; }
    p { color:var(--muted); } ul { padding-left:18px; color:#46534d; }
    .facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:18px; border:1px solid var(--line); }
    .facts div { min-width:0; padding:11px; border-right:1px solid var(--line); } .facts div:last-child { border-right:0; }
    .facts small,.facts strong { display:block; } .facts small { color:var(--muted); font-size:9px; font-weight:800; text-transform:uppercase; }
    .facts strong { margin-top:5px; overflow-wrap:anywhere; font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
    label > span { display:block; margin-bottom:5px; color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; }
    input,textarea { width:100%; border:1px solid var(--line); border-radius:5px; color:var(--ink); background:white; }
    input { min-height:40px; padding:0 10px; } textarea { min-height:130px; padding:10px; resize:vertical; font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
    input:focus,textarea:focus { outline:2px solid #ebcf71; outline-offset:1px; }
    .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .form-grid .wide { grid-column:1/-1; }
    .attestation { display:flex; align-items:flex-start; gap:8px; margin-top:12px; color:#46534d; font-size:12px; }
    .attestation input { flex:0 0 16px; width:16px; min-height:16px; margin-top:2px; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:15px; padding-top:15px; border-top:1px solid var(--line); }
    .timer { font:700 14px ui-monospace,SFMono-Regular,Consolas,monospace; }
    .notice { margin-top:12px; padding:10px 12px; border-left:3px solid var(--yellow); color:#665326; background:#fff9e8; font-size:12px; }
    .notice.error { border-color:var(--red); color:var(--red); background:#fff2f4; }
    pre { margin:0; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace; }
    [hidden] { display:none !important; }
    @media (max-width:760px) { header { padding:0 14px; } main { width:min(100% - 18px,1320px); margin-top:12px; } .intro,.form-grid { grid-template-columns:1fr; } .intro > section + section { border-top:1px solid var(--line); border-left:0; } .facts { grid-template-columns:1fr; } .facts div { border-right:0; border-bottom:1px solid var(--line); } .facts div:last-child { border-bottom:0; } }
  `;
}

function manualOperatorHtml(packetInput: unknown): string {
  const packet = ManualTaskPacketSchema.parse(packetInput);
  const packetHash = canonicalHash(packet);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PositionCrew manual benchmark - ${packet.session.benchmarkSlug}</title><style>${sharedStyles()}
  .workspace { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); margin-top:16px; overflow:hidden; }
  .workspace > section { min-width:0; padding:18px; } .workspace > section + section { border-left:1px solid var(--line); }
  .code-panel { max-height:440px; margin-top:12px; padding:13px; overflow:auto; border:1px solid var(--line); background:var(--soft); }
  .output { min-height:420px; } .operator-fields { margin-top:15px; }
  .format-guide { margin:12px 0; padding:10px 12px; border:1px solid var(--line); background:var(--soft); color:#46534d; font-size:12px; }
  .format-guide strong { color:var(--ink); }
  @media (max-width:900px) { .workspace { grid-template-columns:1fr; } .workspace > section + section { border-top:1px solid var(--line); border-left:0; } }
</style></head><body>
<header><strong>PositionCrew manual benchmark</strong><span>Offline evidence capture · no network calls</span></header>
<main>
  <div class="panel intro">
    <section><span class="kicker">Independent manual operator</span><h1>${packet.session.benchmarkSlug.replaceAll("-", " ")}</h1><p>Complete the frozen capital task without PositionCrew, AI assistance, a prior candidate, or the hidden scoring rubric.</p>
      <div class="facts"><div><small>Task</small><strong>${packet.session.taskId}</strong></div><div><small>Packet</small><strong>${packetHash}</strong></div><div><small>Timer</small><strong>Starts when the fixture is revealed</strong></div></div>
    </section>
    <section><h2>Integrity boundary</h2><ul>${packet.instructions.map((instruction) => `<li>${instruction.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</li>`).join("")}</ul></section>
  </div>
  <div class="panel" style="margin-top:16px;padding:18px" id="setup">
    <h2>Operator record</h2><div class="form-grid operator-fields">
      <label><span>Operator name</span><input id="operator" autocomplete="name"></label>
      <label><span>Contact or public profile</span><input id="contact" autocomplete="url"></label>
      <label><span>Direct cost (USD)</span><input id="cost" type="number" min="0" step="0.01" value="0"></label>
      <label class="wide"><span>Manual method and tools</span><textarea id="method" placeholder="Describe the arithmetic, calculator, spreadsheet, or other non-AI tools used."></textarea></label>
    </div>
    <label class="attestation"><input id="independent" type="checkbox"><span>I will complete this task without PositionCrew, an AI assistant, a prior candidate output, or access to the scoring rubric.</span></label>
    <div class="toolbar"><span>The work area remains hidden until timing starts.</span><button id="start">Start timed task</button></div>
    <div class="notice error" id="setup-error" hidden></div>
  </div>
  <div class="panel workspace" id="workspace" hidden>
    <section><span class="kicker">Frozen input</span><h2>Task fixture</h2><div class="code-panel"><pre id="fixture"></pre></div><details style="margin-top:12px"><summary>Neutral output contract</summary><div class="code-panel"><pre id="contract"></pre></div></details></section>
    <section><div class="toolbar" style="margin:0;padding:0 0 12px;border-top:0;border-bottom:1px solid var(--line)"><div><span class="kicker">Manual answer</span><h2>Final JSON deliverable</h2></div><span class="timer" id="timer">00:00.000</span></div>
      <div class="format-guide"><strong>Neutral format guide.</strong> Copy identifiers from the fixture. Use ISO-8601 strings for timestamps. Enter decimal quantities as quoted plain strings such as <code>"0"</code> or <code>"123.45"</code>, without currency symbols, commas, spaces, or scientific notation. A nullable field may use <code>null</code>. Replace every blank scaffold value with your own result.</div>
      <textarea class="output" id="output" spellcheck="false"></textarea>
      <div class="notice" id="validation">The JSON must satisfy the neutral output contract before it can be finalized.</div>
      <div class="toolbar"><button class="secondary" id="validate">Validate JSON</button><button id="finish">Finalize and download</button></div>
    </section>
  </div>
  <div class="panel" style="margin-top:16px;padding:18px" id="complete" hidden><span class="kicker">Capture complete</span><h2>Manual result is immutable</h2><p id="complete-detail"></p><button id="download-again">Download bundle again</button></div>
</main>
<script id="packet-data" type="application/json">${scriptJson(packet)}</script>
<script>
(() => {
  const packet = JSON.parse(document.getElementById("packet-data").textContent);
  const packetHash = ${JSON.stringify(packetHash)};
  const byId = (id) => document.getElementById(id);
  let startedAt = null;
  let timerId = null;
  let finalBundle = null;
  const canonical = (value) => JSON.stringify(Array.isArray(value) ? value.map(normalize) : normalize(value));
  function normalize(value) { if (Array.isArray(value)) return value.map(normalize); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,normalize(v)])); return value; }
  async function hash(value) { const bytes = new TextEncoder().encode(canonical(value)); const digest = await crypto.subtle.digest("SHA-256", bytes); return "sha256:" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2,"0")).join(""); }
  function scaffold(schema) { if (schema.const !== undefined) return schema.const; if (schema.anyOf) { const nonNull = schema.anyOf.find((item) => item.type !== "null"); return scaffold(nonNull || schema.anyOf[0]); } if (schema.enum) return schema.enum[0]; if (schema.type === "object") return Object.fromEntries((schema.required || []).map((key) => [key, scaffold(schema.properties[key])])); if (schema.type === "array") return Array.from({ length: schema.minItems || 0 }, () => scaffold(schema.items)); if (schema.type === "integer" || schema.type === "number") return schema.minimum || 0; if (schema.type === "null") return null; return ""; }
  function validateValue(value, schema, path, errors) {
    if (schema.anyOf) { const valid = schema.anyOf.some((candidate) => { const branch = []; validateValue(value,candidate,path,branch); return branch.length === 0; }); if (!valid) errors.push(path + " does not match an allowed shape"); return; }
    if (schema.const !== undefined && value !== schema.const) errors.push(path + " must equal " + JSON.stringify(schema.const));
    if (schema.enum && !schema.enum.includes(value)) errors.push(path + " must be one of " + schema.enum.join(", "));
    if (schema.type === "object") { if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(path + " must be an object"); return; } for (const key of schema.required || []) if (!(key in value)) errors.push(path + "." + key + " is required"); for (const [key,child] of Object.entries(value)) { if (schema.properties && schema.properties[key]) validateValue(child,schema.properties[key],path + "." + key,errors); else if (schema.additionalProperties === false) errors.push(path + "." + key + " is not allowed"); } return; }
    if (schema.type === "array") { if (!Array.isArray(value)) { errors.push(path + " must be an array"); return; } if (schema.minItems && value.length < schema.minItems) errors.push(path + " needs at least " + schema.minItems + " item(s)"); value.forEach((item,index) => validateValue(item,schema.items,path + "[" + index + "]",errors)); return; }
    if (schema.type === "string") { if (typeof value !== "string") { errors.push(path + " must be a string"); return; } if (schema.minLength && value.length < schema.minLength) errors.push(path + " is too short"); if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) errors.push(path + " has an invalid format"); return; }
    if ((schema.type === "number" || schema.type === "integer") && (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value)))) errors.push(path + " must be a valid " + schema.type);
    if (schema.type === "null" && value !== null) errors.push(path + " must be null");
  }
  function parseAndValidate() { let value; try { value = JSON.parse(byId("output").value); } catch (error) { return { errors:["Invalid JSON: " + error.message] }; } const errors=[]; validateValue(value,packet.outputContract,"output",errors); return { value, errors }; }
  function showValidation(errors) { const box=byId("validation"); box.classList.toggle("error",errors.length>0); box.textContent=errors.length ? errors.slice(0,8).join(" · ") : "JSON passes the neutral browser preflight. Final schema validation will run during import."; }
  function download(bundle) { const blob=new Blob([JSON.stringify(bundle,null,2)+"\\n"],{type:"application/json"}); const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url; link.download=packet.session.benchmarkSlug+"-manual-handoff.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
  byId("fixture").textContent=JSON.stringify(packet.fixture,null,2); byId("contract").textContent=JSON.stringify(packet.outputContract,null,2); byId("output").value=JSON.stringify(scaffold(packet.outputContract),null,2);
  byId("start").addEventListener("click",() => { const operator=byId("operator").value.trim(); const contact=byId("contact").value.trim(); const method=byId("method").value.trim(); const cost=byId("cost").value.trim(); const errors=[]; if (operator.length<2) errors.push("Enter the operator name."); if (contact.length<3) errors.push("Enter a contact reference."); if (method.length<10) errors.push("Describe the manual method in at least 10 characters."); if (!/^(0|[1-9]\\d*)(?:\\.\\d{1,18})?$/.test(cost)) errors.push("Enter a non-negative direct cost."); if (!byId("independent").checked) errors.push("Confirm the independence attestation."); if (errors.length) { byId("setup-error").textContent=errors.join(" "); byId("setup-error").hidden=false; return; } byId("setup-error").hidden=true; for (const field of ["operator","contact","method","cost","independent"]) byId(field).disabled=true; startedAt=new Date(); byId("workspace").hidden=false; byId("start").disabled=true; const tick=() => { const elapsed=Date.now()-startedAt.getTime(); const minutes=Math.floor(elapsed/60000); const seconds=Math.floor((elapsed%60000)/1000); const millis=elapsed%1000; byId("timer").textContent=String(minutes).padStart(2,"0")+":"+String(seconds).padStart(2,"0")+"."+String(millis).padStart(3,"0"); }; tick(); timerId=setInterval(tick,97); const output=byId("output"); output.focus(); output.setSelectionRange(0,0); output.scrollTop=0; });
  byId("validate").addEventListener("click",() => showValidation(parseAndValidate().errors));
  byId("finish").addEventListener("click",async() => { const checked=parseAndValidate(); showValidation(checked.errors); if (checked.errors.length || !startedAt) return; const completedAt=new Date(); const elapsed=Math.max(1,completedAt.getTime()-startedAt.getTime()); clearInterval(timerId); finalBundle={ schemaVersion:"positioncrew.manual-handoff-bundle.v1", sessionId:packet.session.sessionId, taskId:packet.session.taskId, taskPacketHash:packetHash, startedAt:startedAt.toISOString(), completedAt:completedAt.toISOString(), outputHash:await hash(checked.value), output:checked.value, metadata:{ operatorId:byId("operator").value.trim(), contactReference:byId("contact").value.trim(), method:byId("method").value.trim(), independenceAttestation:${JSON.stringify(MANUAL_INDEPENDENCE_ATTESTATION)}, elapsedMilliseconds:elapsed, directCostUsd:byId("cost").value.trim(), capturedAt:completedAt.toISOString() } }; byId("output").disabled=true; byId("validate").disabled=true; byId("finish").disabled=true; byId("complete").hidden=false; byId("complete-detail").textContent="Elapsed "+elapsed+" ms · output "+finalBundle.outputHash+". Return the downloaded bundle without editing it."; download(finalBundle); });
  byId("download-again").addEventListener("click",() => finalBundle && download(finalBundle));
})();
</script></body></html>`;
}

function evaluatorHtml(packetInput: unknown): string {
  const packet = BenchmarkBlindPacketSchema.parse(packetInput);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PositionCrew blind evaluation - ${packet.benchmarkSlug}</title><style>${sharedStyles()}
  .candidates { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:16px; } .candidate { min-width:0; padding:16px; }
  .candidate pre { max-height:420px; margin-top:10px; padding:12px; border:1px solid var(--line); background:var(--soft); }
  .criterion { margin-top:12px; padding:14px; border:1px solid var(--line); border-radius:5px; } .criterion-head { display:flex; justify-content:space-between; gap:12px; }
  .criterion-head span { color:var(--muted); font-size:11px; } .score-grid { display:grid; grid-template-columns:90px 1fr; gap:10px; margin-top:10px; }
  .score-grid textarea { min-height:82px; } .critical { display:flex; align-items:center; gap:6px; margin-top:7px; font-size:11px; } .critical input { width:15px; min-height:15px; }
  .total { font:800 13px ui-monospace,SFMono-Regular,Consolas,monospace; }
  @media (max-width:900px) { .candidates { grid-template-columns:1fr; } }
</style></head><body>
<header><strong>PositionCrew blind evaluator</strong><span>Sources, timing, cost, and operator identity withheld</span></header>
<main>
  <div class="panel intro"><section><span class="kicker">Independent quality scorecard</span><h1>${packet.rubric.title}</h1><p>Score both anonymized outputs only against the frozen rubric. Do not attempt to identify their source.</p><div class="facts"><div><small>Task</small><strong>${packet.taskId}</strong></div><div><small>Packet</small><strong>${packet.packetHash}</strong></div><div><small>Mapping commitment</small><strong>${packet.mappingCommitment}</strong></div></div></section><section><h2>Evaluator boundary</h2><ul>${packet.evaluatorInstructions.map((instruction) => `<li>${instruction.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</li>`).join("")}</ul></section></div>
  <div class="panel" style="margin-top:16px;padding:18px"><h2>Evaluator record</h2><div class="form-grid" style="margin-top:14px"><label><span>Name</span><input id="name"></label><label><span>Contact or public profile</span><input id="contact"></label><label class="wide"><span>Relationship disclosure</span><textarea id="relationship"></textarea></label></div><label class="attestation"><input id="independent" type="checkbox"><span>I did not produce either candidate and cannot see source identity, timing, or cost while scoring.</span></label></div>
  <div class="candidates" id="candidates"></div>
  <div class="panel" style="margin-top:16px;padding:18px"><div class="toolbar" style="margin:0;padding:0;border:0"><span class="total" id="totals">Candidate A 0/100 · Candidate B 0/100</span><button id="finish">Finalize scorecard</button></div><div class="notice" id="validation">Every criterion needs a score and concrete notes.</div></div>
</main>
<script id="packet-data" type="application/json">${scriptJson(packet)}</script>
<script>
(() => {
  const packet=JSON.parse(document.getElementById("packet-data").textContent); const root=document.getElementById("candidates"); const controls=new Map();
  function element(tag,className,text) { const node=document.createElement(tag); if(className) node.className=className; if(text!==undefined) node.textContent=text; return node; }
  for (const candidate of packet.candidates) { const card=element("section","panel candidate"); card.append(element("span","kicker","Anonymized deliverable"),element("h2",null,candidate.label)); const pre=element("pre"); pre.textContent=JSON.stringify(candidate.output,null,2); card.append(pre); const entries=[]; for(const criterion of packet.rubric.criteria) { const box=element("div","criterion"); const head=element("div","criterion-head"); head.append(element("strong",null,criterion.label),element("span",null,"0-"+criterion.maximumScore+(criterion.critical?" · critical":""))); box.append(head); const full=element("p"); full.textContent="Full credit: "+criterion.fullCredit; const zero=element("p"); zero.textContent="Zero credit: "+criterion.zeroCredit; box.append(full,zero); const grid=element("div","score-grid"); const scoreLabel=element("label"); scoreLabel.append(element("span",null,"Score")); const score=document.createElement("input"); score.type="number"; score.min="0"; score.max=String(criterion.maximumScore); score.step="1"; score.placeholder="Required"; scoreLabel.append(score); const notesLabel=element("label"); notesLabel.append(element("span",null,"Evidence notes")); const notes=document.createElement("textarea"); notesLabel.append(notes); grid.append(scoreLabel,notesLabel); box.append(grid); let critical=null; if(criterion.critical){ const label=element("label","critical"); critical=document.createElement("input"); critical.type="checkbox"; label.append(critical,document.createTextNode(" Critical zero-credit condition applies")); box.append(label); } card.append(box); entries.push({criterion,score,notes,critical}); score.addEventListener("input",updateTotals); } const overallLabel=element("label"); overallLabel.style.display="block"; overallLabel.style.marginTop="13px"; overallLabel.append(element("span",null,"Overall notes")); const overall=document.createElement("textarea"); overallLabel.append(overall); card.append(overallLabel); controls.set(candidate.label,{entries,overall}); root.append(card); }
  function total(label){ return controls.get(label).entries.reduce((sum,item)=>sum+(item.score.value.trim()===""?0:Number(item.score.value)||0),0); }
  function updateTotals(){ document.getElementById("totals").textContent=packet.candidates.map((candidate)=>candidate.label+" "+total(candidate.label)+"/100").join(" · "); } updateTotals();
  function download(value){ const blob=new Blob([JSON.stringify(value,null,2)+"\\n"],{type:"application/json"}); const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url; link.download=packet.benchmarkSlug+"-completed-scorecard.json"; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
  document.getElementById("finish").addEventListener("click",()=>{ const errors=[]; const name=document.getElementById("name").value.trim(); const contact=document.getElementById("contact").value.trim(); const relationship=document.getElementById("relationship").value.trim(); if(name.length<2) errors.push("Enter evaluator name."); if(contact.length<3) errors.push("Enter a contact reference."); if(relationship.length<10) errors.push("Complete the relationship disclosure."); if(!document.getElementById("independent").checked) errors.push("Confirm evaluator independence."); const candidates=packet.candidates.map((candidate)=>{ const state=controls.get(candidate.label); const criteria=state.entries.map(({criterion,score,notes,critical})=>{ const entered=score.value.trim(); const value=entered===""?Number.NaN:Number(entered); if(!Number.isInteger(value)||value<0||value>criterion.maximumScore) errors.push(candidate.label+" "+criterion.id+" needs a score from 0 to "+criterion.maximumScore+"."); if(notes.value.trim().length<1) errors.push(candidate.label+" "+criterion.id+" needs notes."); return {criterionId:criterion.id,score:value,criticalFailure:Boolean(critical&&critical.checked),notes:notes.value.trim()}; }); if(state.overall.value.trim().length<1) errors.push(candidate.label+" needs overall notes."); return {label:candidate.label,criteria,overallNotes:state.overall.value.trim()}; }); const validation=document.getElementById("validation"); validation.classList.toggle("error",errors.length>0); validation.textContent=errors.length?errors.slice(0,10).join(" "):"Scorecard is complete and ready to return."; if(errors.length)return; const scorecard={schemaVersion:"positioncrew.blind-scorecard.v1",sessionId:packet.sessionId,taskId:packet.taskId,packetHash:packet.packetHash,mappingCommitment:packet.mappingCommitment,evaluator:{displayName:name,contactReference:contact,relationshipDisclosure:relationship,independenceAttestation:${JSON.stringify(EVALUATOR_INDEPENDENCE_ATTESTATION)}},scoredAt:new Date().toISOString(),candidates,attestation:${JSON.stringify(SCORECARD_ATTESTATION)}}; download(scorecard); document.getElementById("finish").disabled=true; for(const field of document.querySelectorAll("input,textarea")) field.disabled=true; });
})();
</script></body></html>`;
}

export function buildManualOperatorHandoff(
  sessionDirectoryInput: string,
  outputPathInput?: string,
): { path: string; taskPacketHash: string } {
  const directory = resolve(sessionDirectoryInput);
  const packet = ManualTaskPacketSchema.parse(readJson(join(directory, "manual-task-packet.json")));
  const path = resolve(outputPathInput ?? join(directory, "public", "manual-operator-tool.html"));
  writeExclusive(path, manualOperatorHtml(packet));
  return { path, taskPacketHash: canonicalHash(packet) };
}

export function captureManualHandoffBundle(
  sessionDirectoryInput: string,
  bundleInput: unknown,
): BenchmarkCandidateRecord {
  const directory = resolve(sessionDirectoryInput);
  const packet = ManualTaskPacketSchema.parse(readJson(join(directory, "manual-task-packet.json")));
  const bundle = ManualHandoffBundleSchema.parse(bundleInput);
  if (
    bundle.sessionId !== packet.session.sessionId ||
    bundle.taskId !== packet.session.taskId ||
    bundle.taskPacketHash !== canonicalHash(packet) ||
    bundle.outputHash !== canonicalHash(bundle.output)
  ) {
    throw new Error("Manual handoff bundle does not match the committed task packet or output");
  }
  const measured = Date.parse(bundle.completedAt) - Date.parse(bundle.startedAt);
  if (measured < 1 || Math.abs(measured - bundle.metadata.elapsedMilliseconds) > 2_000) {
    throw new Error("Manual handoff timer does not match its start and completion timestamps");
  }
  if (Date.parse(bundle.metadata.capturedAt) !== Date.parse(bundle.completedAt)) {
    throw new Error("Manual handoff capture time must match its completion time");
  }
  return captureManualBenchmarkRun(directory, bundle.output, bundle.metadata);
}

export function buildBlindEvaluatorHandoff(
  sessionDirectoryInput: string,
  outputPathInput?: string,
): { path: string; packetHash: string } {
  const directory = resolve(sessionDirectoryInput);
  const packet = BenchmarkBlindPacketSchema.parse(
    readJson(join(directory, "public", "blind-evaluator-packet.json")),
  );
  const path = resolve(outputPathInput ?? join(directory, "public", "blind-evaluator-tool.html"));
  writeExclusive(path, evaluatorHtml(packet));
  return { path, packetHash: packet.packetHash };
}

export function readManualHandoffBundle(path: string): unknown {
  return readJson(resolve(path));
}

export function handoffFilename(path: string): string {
  return basename(path);
}
