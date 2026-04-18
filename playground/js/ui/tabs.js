// playground/js/ui/tabs.js — Two-level tab navigation controller

const TAB_GROUPS = {
  core: {
    label: 'Core Protocol',
    tabs: [
      { id: 'identity', label: 'Identity' },
      { id: 'builder', label: 'Bundle Builder' },
      { id: 'verifier', label: 'Verifier' },
      { id: 'tiers', label: 'Tiers' },
      { id: 'explorer', label: 'Explorer' },
    ],
  },
  lifecycle: {
    label: 'Lifecycle',
    tabs: [
      { id: 'lifecycle', label: 'Agent Lifecycle' },
      { id: 'succession', label: 'Succession' },
    ],
  },
  governance: {
    label: 'Governance',
    tabs: [
      { id: 'disputes', label: 'Disputes' },
      { id: 'rights', label: 'Rights' },
      { id: 'delegation', label: 'Delegation' },
    ],
  },
  workflows: {
    label: 'Workflows',
    tabs: [{ id: 'workflows', label: 'Cross-Spec Flows' }],
  },
};

let activeGroup = 'core';
let activeTab = 'identity';

export function initTabs() {
  window.pg_navTo = navigateTo;
  renderGroupBar();
  renderTabBar();
  showTab('identity');
}

function renderGroupBar() {
  const bar = document.getElementById('group-bar');
  bar.innerHTML = Object.entries(TAB_GROUPS)
    .map(
      ([key, g]) =>
        `<button class="group-btn${key === activeGroup ? ' active' : ''}" data-group="${key}">${g.label}</button>`
    )
    .join('');
  bar.querySelectorAll('.group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeGroup = btn.dataset.group;
      renderGroupBar();
      renderTabBar();
      const firstTab = TAB_GROUPS[activeGroup].tabs[0].id;
      showTab(firstTab);
    });
  });
}

function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  const group = TAB_GROUPS[activeGroup];
  bar.innerHTML = group.tabs
    .map(
      t =>
        `<button class="tab-btn${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
    )
    .join('');
  bar.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
}

export function showTab(tabId) {
  activeTab = tabId;
  // Find which group this tab belongs to
  for (const [gk, g] of Object.entries(TAB_GROUPS)) {
    if (g.tabs.some(t => t.id === tabId)) {
      if (gk !== activeGroup) {
        activeGroup = gk;
        renderGroupBar();
      }
      break;
    }
  }
  renderTabBar();
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.add('active');
}

export function navigateTo(tabId) {
  showTab(tabId);
}
