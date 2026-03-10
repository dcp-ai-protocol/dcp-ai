// playground/js/ui/json-render.js — Syntax highlighting, JSON display, copy

export function syntaxHighlight(json) {
  if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\bnull\b)/g,
      match => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'json-key' : 'json-string';
        } else if (/true|false/.test(match)) {
          cls = 'json-bool';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
}

export function renderJson(containerId, obj, label) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const json = JSON.stringify(obj, null, 2);
  const labelHtml = label ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px">${label}</div>` : '';
  el.innerHTML = `${labelHtml}<div class="json-output"><button class="copy-btn" onclick="window.__copyJson(this)">Copy</button><pre>${syntaxHighlight(json)}</pre></div>`;
}

export function renderJsonInto(el, obj) {
  const json = JSON.stringify(obj, null, 2);
  el.innerHTML = `<div class="json-output"><button class="copy-btn" onclick="window.__copyJson(this)">Copy</button><pre>${syntaxHighlight(json)}</pre></div>`;
}

// Global copy handler
window.__copyJson = function (btn) {
  const pre = btn.parentElement.querySelector('pre');
  navigator.clipboard.writeText(pre.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });
};
