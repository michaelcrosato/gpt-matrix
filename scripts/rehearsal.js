// A clearly labeled, deterministic local fixture. Makes no model or network requests.
import fs from 'node:fs';
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const emit = (e) => process.stdout.write(JSON.stringify(e) + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
emit({ type: 'thread.started', thread_id: 'local-rehearsal' });
emit({
  type: 'item.started',
  item: { id: 'write', type: 'command_execution', command: 'write rehearsal.html' },
});
await wait(450);
fs.writeFileSync(
  'rehearsal.html',
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local rehearsal</title><style>body{font:20px system-ui;background:#13231c;color:#e8f4e9;display:grid;place-content:center;min-height:90vh;padding:24px}button{font:inherit;padding:16px;border:0;border-radius:12px;background:#ceff81}</style><main><p>GPT HUB / LOCAL REHEARSAL</p><h1>Your artifact is ready.</h1><p>This fixture checks the queue → artifact → human review workflow.</p><button onclick="this.textContent=\'Interaction verified ✓\'">Try the interaction</button><p>No model was called. Usage is intentionally unknown.</p></main></html>'
);
emit({
  type: 'item.completed',
  item: { id: 'write', type: 'command_execution', command: 'write rehearsal.html' },
});
fs.writeFileSync(
  'hub-report.json',
  JSON.stringify({
    actualStack: 'HTML + CSS + JavaScript (local fixture)',
    engineFeedback: 'Local rehearsal only; no engine evaluation.',
    promptFeedback: 'Local rehearsal only; no model feedback.',
    testingPerformed: 'Fixture writes one interactive HTML artifact. No model-generated tests.',
    issues: [],
  })
);
await wait(450);
emit({
  type: 'item.completed',
  item: {
    id: 'done',
    type: 'agent_message',
    text: 'Local rehearsal complete. Open rehearsal.html and save a human review. This is synthetic verification data, not an AI result.',
  },
});
