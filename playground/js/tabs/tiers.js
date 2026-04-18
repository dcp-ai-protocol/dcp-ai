// playground/js/tabs/tiers.js — Tab 4: Tier Comparison

const TIERS = [
  {
    num: 0, name: 'Routine', color: '#00d4aa', latency: 2, maxBar: 15,
    mode: 'Classical only', checkpoint: 'Every 50 events', size: '~1.2 KB',
    desc: 'Low-risk browsing, read-only API calls. Ed25519 signatures only with periodic PQ checkpoints.',
    use: 'Reading public data, simple queries',
  },
  {
    num: 1, name: 'Standard', color: '#3388ff', latency: 7, maxBar: 15,
    mode: 'Hybrid preferred', checkpoint: 'Every 10 events', size: '~4.8 KB',
    desc: 'Moderate risk operations. Hybrid signatures preferred but classical accepted.',
    use: 'API calls, CRM updates, calendar events',
  },
  {
    num: 2, name: 'Elevated', color: '#ffaa33', latency: 11, maxBar: 15,
    mode: 'Hybrid required', checkpoint: 'Every event', size: '~9.2 KB',
    desc: 'High-risk operations with sensitive data. Hybrid signatures mandatory.',
    use: 'PII access, payment initiation',
  },
  {
    num: 3, name: 'Maximum', color: '#ff4466', latency: 15, maxBar: 15,
    mode: 'Hybrid + immediate verify', checkpoint: 'Every event + verify', size: '~12.5 KB',
    desc: 'Maximum security for the most sensitive operations. Immediate verification after each checkpoint.',
    use: "Credentials access, children's data",
  },
];

export function init() {
  window.pg_selectTier = selectTier;
  window.pg_runLatencySim = runLatencySim;
  renderTierCards();
}

function renderTierCards() {
  const grid = document.getElementById('tier-grid');
  if (!grid) return;
  grid.innerHTML = TIERS.map(
    t => `
    <div class="tier-card" onclick="pg_selectTier(${t.num})" id="tier-card-${t.num}">
      <div class="tier-num" style="color:${t.color}">${t.num}</div>
      <div class="tier-name">${t.name}</div>
      <div class="tier-desc">${t.desc}</div>
      <div class="latency-bar-wrap">
        <div class="latency-bar" id="tier-bar-${t.num}" style="background:${t.color};width:0%"></div>
      </div>
      <div class="latency-val" style="color:${t.color}">~${t.latency} ms</div>
      <dl class="tier-detail">
        <dt>Verification</dt><dd>${t.mode}</dd>
        <dt>Checkpoint</dt><dd>${t.checkpoint}</dd>
        <dt>Bundle Size</dt><dd>${t.size}</dd>
        <dt>Use Case</dt><dd>${t.use}</dd>
      </dl>
    </div>`
  ).join('');

  setTimeout(() => {
    TIERS.forEach(t => {
      const bar = document.getElementById('tier-bar-' + t.num);
      if (bar) bar.style.width = (t.latency / t.maxBar) * 100 + '%';
    });
  }, 100);
}

function selectTier(num) {
  document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('active'));
  const el = document.getElementById('tier-card-' + num);
  if (el) el.classList.add('active');
}

function runLatencySim() {
  const container = document.getElementById('latency-sim');
  if (!container) return;
  container.innerHTML = TIERS.map(
    t => `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.8rem">
      <div style="width:80px;font-weight:600;font-size:0.8rem;color:${t.color}">Tier ${t.num}</div>
      <div style="flex:1;height:24px;background:var(--bg);border-radius:4px;overflow:hidden;border:1px solid var(--border)">
        <div id="sim-bar-${t.num}" style="height:100%;width:0;background:${t.color};border-radius:4px;transition:width 0.6s ease;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;">
          <span style="font-family:var(--mono);font-size:0.7rem;color:var(--bg);font-weight:700;"></span>
        </div>
      </div>
      <div style="width:60px;text-align:right;font-family:var(--mono);font-size:0.8rem;color:${t.color}" id="sim-val-${t.num}">0 ms</div>
    </div>`
  ).join('');

  TIERS.forEach((t, i) => {
    setTimeout(() => {
      const bar = document.getElementById('sim-bar-' + t.num);
      const val = document.getElementById('sim-val-' + t.num);
      if (bar) {
        bar.style.width = (t.latency / 20) * 100 + '%';
        bar.querySelector('span').textContent = t.latency + ' ms';
      }
      if (val) val.textContent = '~' + t.latency + ' ms';
    }, i * 300);
  });
}
