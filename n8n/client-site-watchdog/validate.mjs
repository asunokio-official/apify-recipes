// Static checks of workflow.json: valid JSON, unique names/ids, connections, reachability, no credentials or secrets,
// Code nodes parse, schedule disabled on import, both Apify nodes run once with a spend cap, sticky notes present.
// Usage: node validate.mjs [path/to/workflow.json]
import { readFileSync } from 'node:fs';
import { DNS_ACTOR_ID, TECH_ACTOR_ID } from './build.mjs';

export function validateWorkflow(wf) {
  const problems = [];
  if (!Array.isArray(wf.nodes) || typeof wf.connections !== 'object') return ['nodes/connections missing'];
  const names = new Set();
  const ids = new Set();
  for (const n of wf.nodes) {
    if (names.has(n.name)) problems.push(`duplicate node name: ${n.name}`);
    if (ids.has(n.id)) problems.push(`duplicate node id: ${n.id}`);
    names.add(n.name); ids.add(n.id);
    if (!n.type || typeof n.typeVersion !== 'number' || !Array.isArray(n.position) || n.position.length !== 2) problems.push(`node "${n.name}" lacks type, typeVersion or position`);
    if (n.credentials) problems.push(`node "${n.name}" has a credentials block`);
  }
  for (const [from, v] of Object.entries(wf.connections)) {
    if (!names.has(from)) problems.push(`connection from unknown node: ${from}`);
    for (const outs of v.main || []) for (const c of outs || []) if (!names.has(c.node)) problems.push(`connection ${from} -> unknown node ${c.node}`);
  }
  const triggers = wf.nodes.filter((n) => /Trigger$/.test(n.type)).map((n) => n.name);
  const seen = new Set(triggers);
  const queue = [...triggers];
  while (queue.length) for (const outs of wf.connections[queue.pop()]?.main || []) for (const c of outs || []) if (!seen.has(c.node)) { seen.add(c.node); queue.push(c.node); }
  for (const n of wf.nodes) if (n.type !== 'n8n-nodes-base.stickyNote' && !seen.has(n.name)) problems.push(`not reachable from a trigger: ${n.name}`);
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    try { new Function('$', '$input', n.parameters.jsCode); } catch (e) { problems.push(`Code node "${n.name}" does not parse: ${e.message}`); }
    if (/\bexport\s+\{/.test(n.parameters.jsCode)) problems.push(`Code node "${n.name}" still contains an export statement`);
  }
  const schedule = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  if (schedule && !schedule.disabled) problems.push('the schedule trigger must be disabled on import');
  const apify = wf.nodes.filter((n) => n.type === '@apify/n8n-nodes-apify.apify');
  const idsWanted = [DNS_ACTOR_ID, TECH_ACTOR_ID].sort().join();
  if (apify.length !== 2 || apify.map((a) => a.parameters.actorId?.value).sort().join() !== idsWanted) problems.push('expected exactly the DNS and Tech Stack Change Monitor Apify nodes');
  for (const a of apify) {
    if (!String(a.parameters.maxTotalChargeUsd).includes('maxTotalChargeUsd')) problems.push(`Apify node "${a.name}" must pass a spend cap`);
    if (a.executeOnce !== true) problems.push(`Apify node "${a.name}" must run once (otherwise it runs once per input item)`);
    if (a.alwaysOutputData !== true) problems.push(`Apify node "${a.name}" needs alwaysOutputData (an empty Actor result must not silently stop the workflow)`);
  }
  const notes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
  if (notes.length < 4) problems.push('needs an overview note and section notes');
  if (wf.nodes.length < 25) problems.push('unexpectedly few nodes');
  if (wf.active) problems.push('workflow must be inactive');
  if (Object.keys(wf.pinData || {}).length) problems.push('pinData must be empty');
  const text = JSON.stringify(wf);
  const secrets = [/apify_api_[A-Za-z0-9]{10,}/, /xox[abprs]-[A-Za-z0-9-]{10,}/, /hooks\.slack\.com\/services\//i, /Bearer\s+[A-Za-z0-9._-]{15,}/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[a-z]{2,}/i];
  for (const re of secrets) { const m = text.match(re); if (m) problems.push(`possible secret or e-mail address: ${m[0].slice(0, 30)}`); }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] ?? new URL('./workflow.json', import.meta.url).pathname;
  let wf;
  try { wf = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`invalid JSON: ${e.message}`); process.exit(1); }
  const problems = validateWorkflow(wf);
  if (problems.length) { for (const p of problems) console.error(`- ${p}`); process.exit(1); }
  console.log(`OK: ${wf.nodes.length} nodes, ${Object.keys(wf.connections).length} with outgoing connections, no credentials`);
}
