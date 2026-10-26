// Writes a play script's service part for a ruleset from the rules engine: a
// greedy waiter (serve the most urgent waiting table, else pick up dishes,
// optionally buying upgrades) decided whenever the player is idle, as key
// presses timed in the runtime's fixed steps (a rules tick every 6 frames in
// a render check; the countdown takes ~156 frames). The plan tolerates a
// tick of drift: a serve that is no longer legal is refused and the next
// decision catches up. Prints the steps; `--check` replays it with each
// command a tick late and reports the outcome too.
//   node tools/plan.mjs j01 [--buy] [--check]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../js/rules.js');
const C = require('../js/content.js');

const args = process.argv.slice(2);
const id = args[0] ?? 'j01';
const buy = args.includes('--buy');
const cfg = C.JOURNEY.find((c) => c.id === id) ?? C.CHALLENGES.find((c) => c.id === id) ?? C.LESSONS.find((l) => l.id === id)?.cfg;
if (!cfg) { console.error(`no ruleset ${id}`); process.exit(1); }
const KEY_FOR = { pickup: 'KeyK' };

function decide(state) {
  const p = state.waiters[0];
  if (p.task) return null;
  const legal = R.legalActions(state);
  const serves = legal.filter((a) => a.type === 'serve').sort((a, b) => (b.urgent - a.urgent) || (a.table - b.table));
  if (buy) {
    const b = legal.find((a) => a.type === 'buy' && state.coins >= a.cost + 10);
    if (b) return { type: 'buy', item: b.item };
  }
  if (serves.length && serves[0].table < 9) return { type: 'serve', table: serves[0].table };
  if (legal.some((a) => a.type === 'pickup')) return { type: 'pickup' };
  return null;
}

function run(lag) {
  const state = R.createGame(cfg);
  const plan = [];
  const due = [];
  while (!state.terminal && state.tick < 100000) {
    for (let i = due.length - 1; i >= 0; i--) if (due[i].at <= state.tick) { R.applyCommand(state, due[i].cmd); due.splice(i, 1); }
    if (!due.length) {
      const cmd = decide(state);
      if (cmd) {
        plan.push({ tick: state.tick, cmd });
        if (lag) due.push({ at: state.tick + lag, cmd }); else R.applyCommand(state, cmd);
      }
    }
    R.step(state);
  }
  return { plan, state };
}

const { plan, state } = run(0);
const out = [`# service plan for ${cfg.id} from tools/plan.mjs${buy ? ' --buy' : ''}: ${plan.length} commands; the rules bot ends ${state.terminal.reason} with ${state.terminal.score.total}`];
out.push('frames 160');
let at = 0;
for (const { tick, cmd } of plan) {
  const wait = Math.max(0, (tick - at) * 6 - 2);
  at = tick;
  const key = cmd.type === 'serve' ? `Digit${cmd.table + 1}` : cmd.type === 'pickup' ? KEY_FOR.pickup : null;
  if (cmd.type === 'buy') { out.push(`frames ${wait}`, `# buy ${cmd.item}: through the upgrade panel`); continue; }
  out.push(`frames ${wait}`, `key ${key} 2`);
}
console.log(out.join('\n'));
if (args.includes('--check')) {
  for (const lag of [1, 2]) {
    const r = run(lag);
    console.error(`lag ${lag}: ${r.state.terminal.reason} ${r.state.terminal.score.total}`);
  }
}
