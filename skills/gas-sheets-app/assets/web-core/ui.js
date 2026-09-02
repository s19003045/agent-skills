/** 極簡 DOM 輔助函式，避免引入任何前端框架。 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function show(el) { el.classList.remove('hidden'); }
export function hide(el) { el.classList.add('hidden'); }

/** 一律以 textContent 寫入使用者資料，避免 XSS。 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;          // 僅用於本檔自產的靜態標記
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function toast(message, kind = 'info', ms = 4000) {
  const area = $('#toast-area');
  const node = el('div', { class: `toast toast-${kind}`, text: message });
  area.append(node);
  setTimeout(() => node.remove(), ms);
}

export function card(title, subtitle, children) {
  return el('div', { class: 'card' }, [
    title && el('h2', { text: title }),
    subtitle && el('p', { class: 'muted', text: subtitle }),
    ...[].concat(children)
  ].filter(Boolean));
}

export function empty(text) {
  return el('div', { class: 'empty', text });
}

export function statTile(label, value, sub) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value', text: value }),
    sub && el('div', { class: 'stat-sub', text: sub })
  ].filter(Boolean));
}

export function bar(percent) {
  const wrap = el('div', { class: 'bar' });
  const fill = el('span');
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  wrap.append(fill);
  return wrap;
}

/** 格式化 ISO 字串為易讀的本地時間。 */
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

export function fmtDate(text) {
  return text || '—';
}

/** 讓按鈕在非同步操作期間顯示忙碌狀態。 */
export async function withBusy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
