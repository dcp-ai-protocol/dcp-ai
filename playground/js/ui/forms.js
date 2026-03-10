// playground/js/ui/forms.js — Form helpers, cards, notifications

export function card(title, content, stepNum) {
  const step = stepNum ? `<span class="step-num">${stepNum}</span> ` : '';
  return `<div class="card"><h3>${step}${title}</h3>${content}</div>`;
}

export function formRow(fields, single) {
  const cls = single ? 'form-row single' : 'form-row';
  return `<div class="${cls}">${fields.join('')}</div>`;
}

export function formGroup(label, input) {
  return `<div class="form-group"><label>${label}</label>${input}</div>`;
}

export function selectField(id, options, selected) {
  const opts = options
    .map(
      o =>
        `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label || o.value}</option>`
    )
    .join('');
  return `<select id="${id}">${opts}</select>`;
}

export function inputField(id, placeholder, value, type = 'text') {
  return `<input type="${type}" id="${id}" placeholder="${placeholder}" value="${value || ''}">`;
}

export function btn(text, onclick, cls = 'btn-primary') {
  return `<button class="btn ${cls}" onclick="${onclick}">${text}</button>`;
}

export function btnGroup(...buttons) {
  return `<div class="btn-group">${buttons.join('')}</div>`;
}

export function infoBox(text) {
  return `<div class="info-box">${text}</div>`;
}

export function tag(text, color) {
  return `<span class="tag tag-${color}">${text}</span>`;
}

export function notify(message, type = 'info') {
  const el = document.createElement('div');
  const colors = { info: 'var(--accent)', error: 'var(--red)', warn: 'var(--yellow)', success: 'var(--accent)' };
  el.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:9999;
    background:var(--surface);border:1px solid ${colors[type] || colors.info};
    border-radius:var(--radius);padding:0.8rem 1.2rem;font-size:0.85rem;
    color:var(--text);max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.3);
    animation:slideIn 0.3s ease;
  `;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

export function slider(id, label, min, max, step, value) {
  return `
    <div class="form-group">
      <label>${label}: <span id="${id}-val">${value}</span></label>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"
        oninput="document.getElementById('${id}-val').textContent=this.value"
        style="width:100%;accent-color:var(--accent)">
    </div>`;
}
