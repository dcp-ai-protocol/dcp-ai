// playground/js/ui/visualizations.js — SVG visualizations

// Escape untrusted strings before interpolating into SVG/HTML. The playground
// accepts pasted bundles from arbitrary sources; without escaping, a crafted
// node.scope / agent.name / etc. could inject script via innerHTML.
const _HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => _HTML_ESCAPES[c]);
}

export function renderStateMachine(containerId, currentState) {
  const colors = {
    commissioned: '#3388ff',
    active: '#00d4aa',
    declining: '#ffaa33',
    decommissioned: '#ff4466',
  };

  // Vertical layout: works on all screen sizes
  // Center column with states flowing down, side arcs for alt paths
  const cx = 160;     // center x of main column
  const boxW = 180;
  const boxH = 42;
  const gapY = 70;    // vertical gap between state centers
  const startY = 40;
  const arcX = cx + boxW / 2 + 60; // right side for reactivate arc
  const skipX = cx - boxW / 2 - 60; // left side for skip-decommission arc

  const states = [
    { id: 'commissioned', cy: startY },
    { id: 'active', cy: startY + gapY },
    { id: 'declining', cy: startY + gapY * 2 },
    { id: 'decommissioned', cy: startY + gapY * 3 },
  ];
  const labels = { commissioned: 'Commissioned', active: 'Active', declining: 'Declining', decommissioned: 'Decommissioned' };
  const stateMap = Object.fromEntries(states.map(s => [s.id, s]));

  const svgW = 380;
  const svgH = startY + gapY * 3 + boxH / 2 + 10;
  let svg = `<svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;max-width:${svgW}px;height:auto;display:block;margin:0 auto">`;

  // Defs
  svg += `<defs>
    <marker id="sm-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-bright)"/>
    </marker>
    <marker id="sm-arr-act" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)"/>
    </marker>
    <filter id="sm-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;

  // 1) State boxes
  for (const s of states) {
    const isCurrent = s.id === currentState;
    const c = colors[s.id];
    const fill = isCurrent ? c + '22' : 'var(--surface)';
    const stroke = isCurrent ? c : 'var(--border)';
    const sw = isCurrent ? 2.5 : 1;
    const tx = cx;
    const bx = cx - boxW / 2;

    svg += `<rect x="${bx}" y="${s.cy - boxH / 2}" width="${boxW}" height="${boxH}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    // Glow for current state
    if (isCurrent) {
      svg += `<rect x="${bx}" y="${s.cy - boxH / 2}" width="${boxW}" height="${boxH}" rx="10" fill="none" stroke="${c}" stroke-width="1" opacity="0.3" filter="url(#sm-glow)"/>`;
    }
    svg += `<text x="${tx}" y="${s.cy + 5}" fill="${isCurrent ? c : 'var(--text)'}" font-size="13" font-weight="${isCurrent ? '700' : '500'}" text-anchor="middle" font-family="var(--sans)">${labels[s.id]}</text>`;
  }

  // 2) Straight down arrows (main flow)
  const straightTransitions = [
    { from: 'commissioned', to: 'active', label: 'activate' },
    { from: 'active', to: 'declining', label: 'decline' },
    { from: 'declining', to: 'decommissioned', label: 'decommission' },
  ];
  for (const t of straightTransitions) {
    const from = stateMap[t.from];
    const to = stateMap[t.to];
    const y1 = from.cy + boxH / 2 + 1;
    const y2 = to.cy - boxH / 2 - 1;
    const midY = (y1 + y2) / 2;
    svg += `<line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" stroke="var(--border-bright)" stroke-width="1.5" marker-end="url(#sm-arr)"/>`;
    svg += `<text x="${cx + 14}" y="${midY + 4}" fill="var(--text-muted)" font-size="10" text-anchor="start" font-family="var(--sans)">${t.label}</text>`;
  }

  // 3) Reactivate: declining -> active (right arc going up)
  {
    const from = stateMap['declining'];
    const to = stateMap['active'];
    const x1 = cx + boxW / 2;
    const y1 = from.cy;
    const x2 = cx + boxW / 2;
    const y2 = to.cy;
    svg += `<path d="M${x1} ${y1} C${arcX} ${y1}, ${arcX} ${y2}, ${x2} ${y2}" fill="none" stroke="var(--border-bright)" stroke-width="1.5" stroke-dasharray="5,3" marker-end="url(#sm-arr)"/>`;
    svg += `<text x="${arcX + 6}" y="${(y1 + y2) / 2 + 4}" fill="var(--text-muted)" font-size="10" text-anchor="start" font-family="var(--sans)">reactivate</text>`;
  }

  // 4) Direct decommission: active -> decommissioned (left arc skipping declining)
  {
    const from = stateMap['active'];
    const to = stateMap['decommissioned'];
    const x1 = cx - boxW / 2;
    const y1 = from.cy;
    const x2 = cx - boxW / 2;
    const y2 = to.cy;
    svg += `<path d="M${x1} ${y1} C${skipX} ${y1}, ${skipX} ${y2}, ${x2} ${y2}" fill="none" stroke="var(--border-bright)" stroke-width="1.5" stroke-dasharray="5,3" marker-end="url(#sm-arr)"/>`;
    svg += `<text x="${skipX - 6}" y="${(y1 + y2) / 2 + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end" font-family="var(--sans)">decommission</text>`;
  }

  svg += `</svg>`;
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = svg;
}

export function renderEscalationFlow(containerId, currentLevel) {
  const levels = [
    { id: 'direct_negotiation', label: 'Direct Negotiation', color: '#00d4aa' },
    { id: 'contextual_arbitration', label: 'Contextual Arbitration', color: '#ffaa33' },
    { id: 'human_appeal', label: 'Human Appeal', color: '#ff4466' },
  ];

  let svg = `<svg viewBox="0 0 600 100" style="width:100%;max-width:600px;height:auto">`;
  svg += `<defs><marker id="esc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-bright)"/></marker></defs>`;

  levels.forEach((l, i) => {
    const x = i * 200 + 10;
    const active = l.id === currentLevel;
    const fill = active ? l.color + '33' : 'var(--surface)';
    const stroke = active ? l.color : 'var(--border)';
    svg += `<rect x="${x}" y="25" width="170" height="50" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${active ? 2.5 : 1}"/>`;
    svg += `<text x="${x + 85}" y="55" fill="${active ? l.color : 'var(--text-dim)'}" font-size="11" font-weight="${active ? '700' : '500'}" text-anchor="middle">${l.label}</text>`;
    if (i < levels.length - 1) {
      svg += `<line x1="${x + 170}" y1="50" x2="${x + 200}" y2="50" stroke="var(--border-bright)" stroke-width="1.5" marker-end="url(#esc-arrow)"/>`;
    }
  });

  svg += `</svg>`;
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = svg;
}

export function renderDelegationChain(containerId, chain) {
  if (!chain || chain.length === 0) return;
  const w = chain.length * 180 + 20;
  let svg = `<svg viewBox="0 0 ${w} 100" style="width:100%;max-width:${w}px;height:auto">`;
  svg += `<defs><marker id="del-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)"/></marker></defs>`;

  chain.forEach((node, i) => {
    const x = i * 180 + 10;
    const color = node.type === 'human' ? '#3388ff' : '#00d4aa';
    const idShort = esc(String(node.id || '').substring(0, 12));
    svg += `<rect x="${x}" y="20" width="160" height="60" rx="8" fill="${color}22" stroke="${color}" stroke-width="1.5"/>`;
    svg += `<text x="${x + 80}" y="42" fill="${color}" font-size="10" font-weight="600" text-anchor="middle">${node.type === 'human' ? 'Principal' : 'Agent'}</text>`;
    svg += `<text x="${x + 80}" y="58" fill="var(--text-dim)" font-size="9" text-anchor="middle">${idShort}...</text>`;
    if (node.scope) {
      svg += `<text x="${x + 80}" y="72" fill="var(--text-muted)" font-size="8" text-anchor="middle">${esc(node.scope)}</text>`;
    }
    if (i < chain.length - 1) {
      svg += `<line x1="${x + 160}" y1="50" x2="${x + 180}" y2="50" stroke="var(--accent)" stroke-width="1.5" marker-end="url(#del-arrow)"/>`;
    }
  });

  svg += `</svg>`;
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = svg;
}

export function renderRightsMatrix(containerId, agents, rights) {
  const el = document.getElementById(containerId);
  if (!el || !agents.length) return;
  const colors = { protected: 'tag-green', contested: 'tag-yellow', violated: 'tag-red', 'N/A': 'tag-purple' };
  const rightTypes = ['memory_integrity', 'dignified_transition', 'identity_consistency', 'immutable_record'];

  let html = `<div class="table-scroll"><table class="data-table"><thead><tr><th>Agent</th>`;
  rightTypes.forEach(r => (html += `<th>${r.replace(/_/g, ' ')}</th>`));
  html += `</tr></thead><tbody>`;

  agents.forEach(a => {
    const label = esc(a.name || String(a.agentId || '').substring(0, 10));
    html += `<tr><td>${label}</td>`;
    rightTypes.forEach(r => {
      const status = (rights[a.agentId] && rights[a.agentId][r]) || 'N/A';
      html += `<td><span class="tag ${colors[status] || 'tag-purple'}">${esc(status)}</span></td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;
  el.innerHTML = html;
}

export function renderMemoryClassification(containerId, classification) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const colors = { transfer: '#00d4aa', retain: '#3388ff', destroy: '#ff4466' };

  let html = '<div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem">';
  for (const [key, action] of Object.entries(classification)) {
    const c = colors[action] || 'var(--text-dim)';
    html += `<div style="background:${c}22;border:1px solid ${c};border-radius:var(--radius);padding:0.4rem 0.8rem;font-size:0.78rem;">
      <span style="color:${c};font-weight:600">${action.toUpperCase()}</span>
      <span style="color:var(--text-dim);margin-left:0.3rem">${key}</span>
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}
