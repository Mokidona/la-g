'use strict';

/* =============================================================================
   Визуальный редактор страницы.

   Всё правится на самой странице:
   — клик по тексту сразу ставит курсор, печатаете и видите результат;
   — клик по фото предлагает замену, файл можно просто перетащить на фото;
   — блоки переставляются перетаскиванием за ручку ≡;
   — справа — свойства выбранного элемента, слева — слои страницы.
   ========================================================================== */

const frameEl = document.getElementById('preview-frame');
const canvasEl = document.getElementById('canvas');
const canvasScrollEl = document.getElementById('canvas-scroll');
const canvasSpaceEl = document.getElementById('canvas-space');
const layersEl = document.getElementById('layers-tree');
const inspectorEl = document.getElementById('inspector-body');

const ui = {
  zoom: null, /* null = «вписать» */
  scale: 1,
  chrome: null,
  hover: null,
  drag: null,
  drop: null,
  layoutTimer: null,
  refreshTimer: null,
  seq: 0,
  scrollTop: 0,
  opened: new Set(),
  bound: false,
};

const FRAME_CSS = `
  .hf-root, .hf-root * { box-sizing: border-box; }
  .hf-root {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    z-index: 2147483000;
    pointer-events: none;
  }
  .hf-box {
    position: absolute;
    pointer-events: none;
    border-radius: 1px;
  }
  .hf-box--hover { border: 1.5px solid rgba(108, 76, 224, .55); }
  .hf-box--soft { border: 1.5px dashed rgba(108, 76, 224, .3); }
  .hf-box--sel {
    border: 2px solid #6C4CE0;
    box-shadow: 0 0 0 3px rgba(108, 76, 224, .14);
  }
  .hf-tag {
    position: absolute;
    bottom: 100%;
    left: -2px;
    margin-bottom: 4px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 7px;
    border-radius: 5px;
    background: #6C4CE0;
    color: #fff;
    font: 600 11px/1.2 'Inter', sans-serif;
    letter-spacing: .01em;
    white-space: nowrap;
    transform-origin: left bottom;
    transform: scale(var(--hf-k, 1));
  }
  .hf-tag--hover { background: #4B35A8; }
  .hf-drop {
    position: absolute;
    background: #6C4CE0;
    border-radius: 3px;
    box-shadow: 0 0 0 2px rgba(108, 76, 224, .22);
    pointer-events: none;
  }
  .hf-anchor {
    position: absolute;
    width: 0;
    height: 0;
  }
  .hf-bar {
    position: absolute;
    top: -7px;
    left: 0;
    width: max-content;
    max-width: 60vw;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 3px;
    border-radius: 9px;
    background: #1D1630;
    box-shadow: 0 8px 24px rgba(20, 12, 40, .34);
    transform-origin: left bottom;
    transform: translateY(-100%) scale(var(--hf-k, 1));
    pointer-events: auto;
    font-family: 'Inter', sans-serif;
  }
  .hf-bar.is-below {
    top: 7px;
    transform-origin: left top;
    transform: scale(var(--hf-k, 1));
  }
  .hf-bar__btn {
    appearance: none;
    margin: 0;
    min-width: 26px;
    height: 26px;
    padding: 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #fff;
    font: 600 12px/1 'Inter', sans-serif;
    cursor: pointer;
    white-space: nowrap;
  }
  .hf-bar__btn:hover { background: rgba(255, 255, 255, .18); }
  .hf-bar__btn:disabled { opacity: .3; cursor: default; }
  .hf-bar__btn--danger:hover { background: #C0394F; }
  .hf-bar__btn--grip { cursor: grab; color: #CDBFF6; letter-spacing: -1px; }
  .hf-bar__btn--grip:active { cursor: grabbing; }
  .hf-bar__sep { width: 1px; height: 16px; margin: 0 3px; background: rgba(255, 255, 255, .18); }

  .is-editor [data-e] { cursor: text; }
  .is-editor [data-img] { cursor: pointer; }
  .is-editor [data-block], .is-editor [data-section] { cursor: default; }
  .is-editor a { cursor: text; }
  .hf-editing {
    outline: 2px solid #6C4CE0 !important;
    outline-offset: 3px;
    background: rgba(108, 76, 224, .04);
    border-radius: 2px;
  }
  .hf-dragging { cursor: grabbing !important; }
  .hf-dragging * { cursor: grabbing !important; }
  .hf-photo-drop {
    outline: 3px dashed #6C4CE0 !important;
    outline-offset: -5px;
    filter: brightness(.88) saturate(.9);
  }
`;

/* ------------------------------------------------------------------ утилиты */

const frameDoc = () => frameEl.contentDocument;

function frameBase() {
  const doc = frameDoc();
  if (!doc || !doc.body) return null;
  const rect = doc.body.getBoundingClientRect();
  return { doc, left: rect.left, top: rect.top };
}

function sectionTitle(path) {
  const id = String(path || '').split('.')[0];
  const meta = SECTIONS.find((section) => section.id === id);
  return meta?.title || '';
}

function elementFor(selection) {
  const doc = frameDoc();
  if (!doc || !selection) return null;

  if (selection.kind === 'field') return doc.querySelector(`[data-e="${CSS.escape(selection.path)}"]`);
  if (selection.kind === 'image') return doc.querySelector(`[data-img="${CSS.escape(selection.path)}"]`);
  if (selection.kind === 'block') return doc.querySelector(`[data-block="${CSS.escape(selection.path)}"]`);
  if (selection.kind === 'section') return doc.querySelector(`[data-section="${CSS.escape(selection.id)}"]`);
  return null;
}

function describe(el) {
  if (!el || !el.dataset) return '';
  if (el.dataset.img) return 'Фото — кликните, чтобы заменить';
  if (el.dataset.e) {
    const spec = resolveFieldContext(el.dataset.e)?.spec;
    return spec?.label || 'Текст';
  }
  if (el.dataset.block) {
    const spec = resolveListSpec(el.dataset.list);
    const item = getPath(state.content, el.dataset.block);
    const title = spec?.itemTitle ? spec.itemTitle(item, Number(el.dataset.index) || 0) : '';
    return [spec?.label || 'Блок', title].filter(Boolean).join(' · ');
  }
  if (el.dataset.section) {
    const meta = SECTIONS.find((section) => section.id === el.dataset.section);
    return `Секция · ${meta?.title || el.dataset.section}`;
  }
  return '';
}

function isTypingTarget(target) {
  if (!target || !target.closest) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/* ----------------------------------------------------------------- история */

function pushHistory() {
  if (!state.content) return;
  const snapshot = JSON.stringify(state.content);
  if (state.history[state.history.length - 1] === snapshot) return;

  state.history.push(snapshot);
  if (state.history.length > 80) state.history.shift();
  state.future = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = !state.history.length;
  if (redoBtn) redoBtn.disabled = !state.future.length;
}

function undo() {
  if (!state.history.length || !state.content) return;
  if (state.editing) cancelInline();
  state.future.push(JSON.stringify(state.content));
  state.content = JSON.parse(state.history.pop());
  afterHistory();
}

function redo() {
  if (!state.future.length || !state.content) return;
  if (state.editing) cancelInline();
  state.history.push(JSON.stringify(state.content));
  state.content = JSON.parse(state.future.pop());
  afterHistory();
}

function afterHistory() {
  markDirty();
  renderLayers();
  renderInspector();
  refreshPreview();
  updateHistoryButtons();
}

/* ------------------------------------------------------------- холст, зум */

function zoomLabel() {
  return ui.zoom == null ? 'Вписать' : `${Math.round(ui.scale * 100)}%`;
}

function setZoom(next) {
  ui.zoom = next;
  layoutFrame();
}

function stepZoom(direction) {
  const steps = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5];
  const current = ui.scale;
  const index = steps.findIndex((value) => value > current + 0.001);
  let next;
  if (direction > 0) next = steps[index === -1 ? steps.length - 1 : index];
  else {
    const below = steps.filter((value) => value < current - 0.001);
    next = below.length ? below[below.length - 1] : steps[0];
  }
  setZoom(next);
}

function scheduleLayout() {
  clearTimeout(ui.layoutTimer);
  ui.layoutTimer = setTimeout(layoutFrame, 90);
}

function layoutFrame() {
  const doc = frameDoc();
  if (!doc || !doc.body || !canvasEl) return;

  const width = DEVICE_WIDTH[state.device] || 1440;
  const available = Math.max(280, canvasEl.clientWidth - 64);
  const fit = Math.min(1, available / width);
  const scale = ui.zoom == null ? fit : ui.zoom;
  const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 480);

  ui.scale = scale;
  frameEl.style.width = `${width}px`;
  frameEl.style.height = `${height}px`;
  frameEl.style.transform = `scale(${scale})`;
  canvasSpaceEl.style.width = `${Math.round(width * scale)}px`;
  canvasSpaceEl.style.height = `${Math.round(height * scale)}px`;

  const chrome = ui.chrome;
  if (chrome) chrome.doc.body.style.setProperty('--hf-k', String(1 / scale));

  const zoomButton = document.getElementById('zoom-fit');
  if (zoomButton) zoomButton.textContent = zoomLabel();

  const zoomValue = document.getElementById('zoom-bar-value');
  if (zoomValue) zoomValue.textContent = `${Math.round(scale * 100)}%`;

  updateOverlays();
}

/* ----------------------------------------------------------- превью страницы */

async function refreshPreview() {
  if (!state.content) return;

  const sequence = ++ui.seq;
  ui.scrollTop = canvasScrollEl ? canvasScrollEl.scrollTop : 0;

  try {
    const result = await api('/api/preview', {
      method: 'POST',
      body: JSON.stringify({ content: state.content, lang: state.lang }),
    });
    if (sequence !== ui.seq) return;
    frameEl.srcdoc = result.html;
  } catch (error) {
    if (error.status === 401) showLogin();
    else toast('Не удалось обновить страницу', true);
  }
}

function scheduleRefresh() {
  clearTimeout(ui.refreshTimer);
  ui.refreshTimer = setTimeout(refreshPreview, 350);
}

function resetPreview() {
  ui.seq += 1;
  ui.chrome = null;
  if (frameEl) frameEl.srcdoc = '<!DOCTYPE html><html><body></body></html>';
}

/* ------------------------------------------------------------------ оверлеи */

function mountChrome(doc) {
  doc.querySelectorAll('.hf-root').forEach((node) => node.remove());

  const root = doc.createElement('div');
  root.className = 'hf-root';
  root.setAttribute('aria-hidden', 'true');

  const hover = doc.createElement('div');
  hover.className = 'hf-box hf-box--hover';
  hover.hidden = true;
  const hoverTag = doc.createElement('span');
  hoverTag.className = 'hf-tag hf-tag--hover';
  hover.append(hoverTag);

  const selected = doc.createElement('div');
  selected.className = 'hf-box hf-box--sel';
  selected.hidden = true;

  const drop = doc.createElement('div');
  drop.className = 'hf-drop';
  drop.hidden = true;

  const anchor = doc.createElement('div');
  anchor.className = 'hf-anchor';
  anchor.hidden = true;
  const bar = doc.createElement('div');
  bar.className = 'hf-bar';
  bar.hidden = true;
  anchor.append(bar);

  root.append(hover, selected, drop, anchor);
  doc.body.append(root);

  ui.chrome = { doc, root, hover, hoverTag, selected, drop, anchor, bar };
  ui.hover = null;

  const style = doc.createElement('style');
  style.textContent = FRAME_CSS;
  doc.head.appendChild(style);

  doc.body.style.setProperty('--hf-k', String(1 / (ui.scale || 1)));
}

function placeBox(box, el) {
  const base = frameBase();
  if (!base) return null;
  const rect = el.getBoundingClientRect();

  box.hidden = false;
  box.style.left = `${rect.left - base.left}px`;
  box.style.top = `${rect.top - base.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  return rect;
}

function updateOverlays() {
  const chrome = ui.chrome;
  if (!chrome) return;

  if (state.mode !== 'editor' || state.drag) {
    chrome.hover.hidden = true;
    chrome.selected.hidden = true;
    chrome.anchor.hidden = true;
    return;
  }

  const el = (state.editing && state.editing.el) || elementFor(state.selection);

  if (!el) {
    chrome.selected.hidden = true;
    chrome.anchor.hidden = true;
    return;
  }

  placeBox(chrome.selected, el);

  const base = frameBase();
  if (!base) return;

  const rect = el.getBoundingClientRect();

  if (chrome.bar.hidden) {
    chrome.anchor.hidden = true;
    return;
  }

  chrome.anchor.hidden = false;
  chrome.anchor.style.left = `${rect.left - base.left}px`;
  chrome.anchor.style.top = `${rect.top - base.top}px`;

  const viewport = chrome.doc.documentElement.clientWidth;
  const barRect = chrome.bar.getBoundingClientRect();
  if (barRect.width && barRect.right > viewport - 8) {
    const overflow = Math.min(barRect.right - (viewport - 8), rect.width * (ui.scale || 1));
    chrome.bar.style.left = `${-overflow}px`;
  } else {
    chrome.bar.style.left = '0px';
  }

  const frameRect = frameEl.getBoundingClientRect();
  const canvasRect = canvasEl.getBoundingClientRect();
  const visibleTop = frameRect.top + (rect.top - base.top) * (ui.scale || 1) - canvasRect.top;
  chrome.bar.classList.toggle('is-below', visibleTop < 46);
}

function showHover(el) {
  const chrome = ui.chrome;
  if (!chrome || !el || state.drag || state.editing) {
    if (chrome) chrome.hover.hidden = true;
    ui.hover = null;
    return;
  }

  ui.hover = el;
  placeBox(chrome.hover, el);
  chrome.hover.classList.toggle('hf-box--soft', Boolean(el.dataset.section));
  chrome.hoverTag.textContent = describe(el);
}

/* ------------------------------------------------------- панель на выделении */

function barButton(doc, label, title, handler, extra = '') {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `hf-bar__btn ${extra}`.trim();
  button.title = title;
  button.textContent = label;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler();
  });
  return button;
}

function paintBar() {
  const chrome = ui.chrome;
  if (!chrome) return;

  const bar = chrome.bar;
  bar.textContent = '';
  bar.hidden = true;

  const selection = state.selection;
  if (!selection || state.editing || state.mode !== 'editor') return;

  const el = elementFor(selection);
  if (!el) return;

  const doc = chrome.doc;

  if (selection.kind === 'field') {
    bar.append(
      barButton(doc, 'Печатать', 'Редактировать текст на странице', () => beginTextEdit(selection.path, el)),
      barButton(doc, '✕', 'Очистить текст', () => clearField(selection.path), 'hf-bar__btn--danger')
    );
  } else if (selection.kind === 'image') {
    bar.append(
      barButton(doc, 'Заменить', 'Загрузить новое изображение', () => pickImage(selection.path)),
      barButton(doc, '✕', 'Убрать изображение', () => clearImage(selection.path), 'hf-bar__btn--danger')
    );
  } else if (selection.kind === 'block') {
    const list = getPath(state.content, selection.list);
    const total = Array.isArray(list) ? list.length : 0;

    const grip = doc.createElement('button');
    grip.type = 'button';
    grip.className = 'hf-bar__btn hf-bar__btn--grip';
    grip.title = 'Перетащите, чтобы поменять порядок';
    grip.textContent = '≡';
    grip.draggable = true;
    grip.addEventListener('dragstart', (event) => {
      ui.drag = { list: selection.list, index: selection.index };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `${selection.list}.${selection.index}`);
      chrome.doc.body.classList.add('hf-dragging');
      chrome.bar.hidden = true;
    });
    grip.addEventListener('dragend', () => {
      ui.drag = null;
      chrome.doc.body.classList.remove('hf-dragging');
      hideDropLine();
      layoutFrame();
    });

    const up = barButton(doc, '↑', 'Выше', () => moveBlock(-1));
    up.disabled = selection.index <= 0;
    const down = barButton(doc, '↓', 'Ниже', () => moveBlock(1));
    down.disabled = selection.index >= total - 1;

    bar.append(
      grip,
      barButton(doc, '+', 'Добавить такой же блок ниже', () => addBlock()),
      up,
      down,
      barButton(doc, '⧉', 'Дублировать', () => duplicateBlock()),
      barButton(doc, '✕', 'Удалить блок', () => deleteBlock(), 'hf-bar__btn--danger')
    );
  } else if (selection.kind === 'section') {
    if (MOVABLE_SECTIONS.includes(selection.id)) {
      const grip = doc.createElement('button');
      grip.type = 'button';
      grip.className = 'hf-bar__btn hf-bar__btn--grip';
      grip.title = 'Перетащите секцию, чтобы поменять порядок';
      grip.textContent = '≡';
      grip.draggable = true;
      grip.addEventListener('dragstart', (event) => {
        ui.drag = { kind: 'section', id: selection.id };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', selection.id);
        chrome.doc.body.classList.add('hf-dragging');
        chrome.bar.hidden = true;
      });
      bar.append(grip);
    }

    if (selection.id !== 'hero') {
      const visible = state.content.sections[selection.id] !== false;
      bar.append(
        barButton(doc, visible ? 'Скрыть' : 'Показать', visible ? 'Скрыть секцию на сайте' : 'Вернуть секцию', () =>
          toggleSection(selection.id)
        )
      );
    }
    bar.append(barButton(doc, 'Настроить', 'Открыть настройки секции', () => goSettings(selection.id)));
  }

  if (!bar.childNodes.length) return;
  bar.hidden = false;
  updateOverlays();
}

function hideDropLine() {
  if (ui.chrome) ui.chrome.drop.hidden = true;
  ui.drop = null;
}

/* ------------------------------------------------------------ выделение */

function select(selection, options = {}) {
  if (state.editing) commitInline();
  state.selection = selection;
  renderLayers();
  renderInspector();
  paintBar();
  updateOverlays();
  if (options.scroll && selection) scrollToSelection(selection);
}

function scrollToSelection(selection) {
  const el = elementFor(selection);
  if (!el || !canvasScrollEl) return;

  const base = frameBase();
  if (!base) return;

  const rect = el.getBoundingClientRect();
  const spaceTop =
    canvasSpaceEl.getBoundingClientRect().top - canvasScrollEl.getBoundingClientRect().top + canvasScrollEl.scrollTop;

  canvasScrollEl.scrollTo({
    top: Math.max(0, spaceTop + (rect.top - base.top) * ui.scale - 100),
    behavior: 'smooth',
  });
}

/* ---------------------------------------------------------- правка текста */

function fieldTextValue(value, lang) {
  if (value && typeof value === 'object' && ('ru' in value || 'kz' in value)) {
    return value[lang] !== undefined && value[lang] !== null && value[lang] !== '' ? value[lang] : value.ru || '';
  }
  return typeof value === 'string' ? value : '';
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function richHtml(value) {
  return escapeHtml(value)
    .replace(/&amp;([a-zA-Z][a-zA-Z0-9]{1,8}|#\d{1,6});/g, '&$1;')
    .replace(/&lt;br\s+class=(?:&quot;|&#39;|"|')br-m(?:&quot;|&#39;|"|')\s*\/?&gt;/gi, '<br class="br-m">')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/&lt;(\/?)(b|strong|i|em|u|span)&gt;/gi, '<$1$2>');
}

function valueToHtml(spec, value) {
  const text = fieldTextValue(value, state.lang);
  if (!text) return '';
  if (spec && spec.paragraphs) {
    return text
      .split(/\n{2,}/)
      .map((part) => `<p>${richHtml(part.trim())}</p>`)
      .join('');
  }
  return richHtml(text);
}

function sanitizeInlineHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const out = document.createElement('div');

  const append = (node, parent) => {
    if (node.nodeType === 3) {
      parent.appendChild(document.createTextNode(node.textContent.replace(/\u00a0/g, ' ')));
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName.toLowerCase();

    if (tag === 'div' || tag === 'p' || tag === 'li') {
      if (parent.childNodes.length) parent.appendChild(document.createElement('br'));
      node.childNodes.forEach((child) => append(child, parent));
      return;
    }
    if (tag === 'br') {
      parent.appendChild(document.createElement('br'));
      return;
    }
    if (['b', 'strong', 'i', 'em', 'u'].includes(tag)) {
      const el = document.createElement(tag);
      node.childNodes.forEach((child) => append(child, el));
      parent.appendChild(el);
      return;
    }
    node.childNodes.forEach((child) => append(child, parent));
  };

  template.content.childNodes.forEach((node) => append(node, out));
  return out.innerHTML.trim();
}

function writeFieldValue(ctx, value) {
  const target = getPath(ctx.object, ctx.path);
  if (target && typeof target === 'object' && !Array.isArray(target) && ('ru' in target || 'kz' in target)) {
    target[state.lang] = value;
  } else {
    setPath(ctx.object, ctx.path, value);
  }
}

function beginTextEdit(path, el) {
  if (!el || !state.content) return;

  const ctx = resolveFieldContext(path);
  if (!ctx) {
    toast('Это поле нельзя править на странице', true);
    return;
  }

  if (state.editing) {
    if (state.editing.el === el) return;
    commitInline();
  }

  pushHistory();

  const block = el.closest('[data-block]');
  if (block) block.draggable = false;

  state.editing = { el, path, ctx, original: el.innerHTML, block };
  state.selection = { kind: 'field', path };

  el.setAttribute('contenteditable', 'true');
  el.classList.add('hf-editing');

  const hint = document.getElementById('canvas-hint');
  if (hint && !hint.hidden) {
    hint.hidden = true;
    try {
      localStorage.setItem('lfk-hint-v2', 'done');
    } catch {
      /* приватный режим */
    }
  }

  paintBar();
  renderLayers();
  renderInspector();
  updateOverlays();
  placeCaret(el, ui.lastPointer);
  showEditBar(el);
}

function placeCaret(el, pointer) {
  const doc = frameDoc();
  const view = doc.defaultView;
  el.focus({ preventScroll: true });

  let range = null;
  if (pointer && doc.caretRangeFromPoint) {
    range = doc.caretRangeFromPoint(pointer.x, pointer.y);
  }

  if (!range || !el.contains(range.startContainer)) {
    range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }

  const selection = view.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function showEditBar(el) {
  const chrome = ui.chrome;
  if (!chrome) return;

  const doc = chrome.doc;
  const bar = chrome.bar;
  bar.textContent = '';
  bar.hidden = false;
  bar.classList.remove('is-below');

  const bold = barButton(doc, 'B', 'Полужирный (Ctrl+B)', () => doc.execCommand('bold'));
  bold.style.fontWeight = '700';
  const italic = barButton(doc, 'I', 'Курсив (Ctrl+I)', () => doc.execCommand('italic'));
  italic.style.fontStyle = 'italic';

  const sep = doc.createElement('span');
  sep.className = 'hf-bar__sep';

  bar.append(
    bold,
    italic,
    sep,
    barButton(doc, 'Готово', 'Закончить редактирование (Enter)', () => commitInline()),
    barButton(doc, 'Отмена', 'Вернуть как было (Esc)', () => cancelInline(), 'hf-bar__btn--danger')
  );

  updateOverlays();
}

function readEditingValue(source) {
  const editing = source || state.editing;
  if (!editing) return '';
  if (editing.ctx.spec.paragraphs) {
    return editing.el.innerText
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n');
  }
  return sanitizeInlineHtml(editing.el.innerHTML);
}

function commitInline() {
  const editing = state.editing;
  if (!editing) return;

  const { el, path, ctx } = editing;
  state.editing = null;

  el.removeAttribute('contenteditable');
  el.classList.remove('hf-editing');
  if (editing.block) editing.block.draggable = true;

  const value = readEditingValue(editing);
  if (value !== fieldTextValue(getPath(ctx.object, ctx.path), state.lang)) {
    writeFieldValue(ctx, value);
    markDirty();
  }

  const stored = getPath(ctx.object, ctx.path);
  const html = valueToHtml(ctx.spec, stored);
  if (html !== el.innerHTML) el.innerHTML = html;

  el.blur();
  paintBar();
  updateOverlays();
  renderLayers();
  renderInspector();
  scheduleLayout();
}

function cancelInline() {
  const editing = state.editing;
  if (!editing) return;

  state.editing = null;
  editing.el.innerHTML = editing.original;
  editing.el.removeAttribute('contenteditable');
  editing.el.classList.remove('hf-editing');
  if (editing.block) editing.block.draggable = true;
  editing.el.blur();

  paintBar();
  updateOverlays();
  renderInspector();
}

/* ------------------------------------------------------ правка изображений */

function readFileAsDataUrlSafe(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadImageFile(path, file) {
  if (!file) return;

  if (file.size > 6 * 1024 * 1024) {
    toast('Файл больше 6 МБ — уменьшите изображение', true);
    return;
  }

  try {
    const data = await readFileAsDataUrlSafe(file);
    const result = await api('/api/upload', { method: 'POST', body: JSON.stringify({ data }) });
    pushHistory();
    setPath(state.content, path, result.url);
    markDirty();
    patchFrame(path);
    renderLayers();
    renderInspector();
    paintBar();
    toast('Изображение обновлено');
  } catch (error) {
    toast(error.status === 401 ? 'Сессия истекла — войдите заново' : 'Не удалось загрузить изображение', true);
  }
}

function pickImage(path) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    await uploadImageFile(path, file);
  });

  document.body.appendChild(input);
  input.click();
}

function clearImage(path) {
  pushHistory();
  setPath(state.content, path, '');
  markDirty();
  patchFrame(path);
  renderLayers();
  renderInspector();
  paintBar();
}

function clearField(path) {
  const ctx = resolveFieldContext(path);
  if (!ctx) return;
  pushHistory();
  writeFieldValue(ctx, '');
  markDirty();
  patchFrame(path);
  renderInspector();
  paintBar();
  toast('Текст очищен — Ctrl+Z вернёт обратно');
}

/* ---------------------------------------------- точечное обновление страницы */

function patchFrame(path) {
  const doc = frameDoc();
  if (!doc) return false;

  const ctx = resolveFieldContext(path);
  const value = getPath(state.content, path);

  const textNode = doc.querySelector(`[data-e="${CSS.escape(path)}"]`);
  if (textNode && ctx) {
    textNode.innerHTML = valueToHtml(ctx.spec, value);
    scheduleLayout();
    return true;
  }

  const image = doc.querySelector(`[data-img="${CSS.escape(path)}"]`);
  if (image) {
    image.src = typeof value === 'string' ? value : '';
    scheduleLayout();
    return true;
  }

  return false;
}

/* ------------------------------------------------- события внутри страницы */

function onFrameClick(event) {
  const doc = frameDoc();
  if (!doc || !(event.target instanceof doc.defaultView.Element)) return;
  if (event.target.closest('.hf-root')) return;

  const target = event.target;
  ui.lastPointer = { x: event.clientX, y: event.clientY };

  if (state.editing) {
    if (state.editing.el.contains(target)) return;
    commitInline();
  }

  const image = target.closest('[data-img]');
  if (image) {
    event.preventDefault();
    event.stopPropagation();
    select({ kind: 'image', path: image.dataset.img });
    return;
  }

  const text = target.closest('[data-e]');
  if (text) {
    event.preventDefault();
    event.stopPropagation();
    beginTextEdit(text.dataset.e, text);
    return;
  }

  const block = target.closest('[data-block]');
  if (block) {
    event.preventDefault();
    event.stopPropagation();
    select({
      kind: 'block',
      path: block.dataset.block,
      list: block.dataset.list,
      index: Number(block.dataset.index) || 0,
    });
    return;
  }

  const section = target.closest('[data-section]');
  if (section) {
    event.preventDefault();
    event.stopPropagation();
    select({ kind: 'section', id: section.dataset.section });
    return;
  }

  event.preventDefault();
  select(null);
}

function onFrameDblClick(event) {
  const doc = frameDoc();
  if (!doc || !(event.target instanceof doc.defaultView.Element)) return;

  const image = event.target.closest('[data-img]');
  if (image) {
    event.preventDefault();
    event.stopPropagation();
    select({ kind: 'image', path: image.dataset.img });
    pickImage(image.dataset.img);
  }
}

function onFrameOver(event) {
  const doc = frameDoc();
  if (!doc || !(event.target instanceof doc.defaultView.Element)) return;
  if (state.drag) return;

  const target = event.target;
  if (target.closest('.hf-root')) return;

  const el = target.closest('[data-e], [data-img], [data-block], [data-section]');
  if (!el || el === ui.hover) return;

  if (state.editing && state.editing.el.contains(el)) {
    ui.chrome && (ui.chrome.hover.hidden = true);
    return;
  }

  showHover(el);
}

function onFrameOut(event) {
  const doc = frameDoc();
  if (!doc || !(event.target instanceof doc.defaultView.Element)) return;
  const next = event.relatedTarget;
  if (next && next.closest && next.closest('.hf-root')) return;
  if (ui.chrome) ui.chrome.hover.hidden = true;
  ui.hover = null;
}

function onFrameKeydown(event) {
  if (!state.editing) {
    if (event.key === 'Escape') select(null);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    cancelInline();
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    commitInline();
    return;
  }

  if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault();
    const doc = frameDoc();
    doc.execCommand('insertHTML', false, '<br>');
    return;
  }

  if (event.key.toLowerCase() === 'b' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.target.ownerDocument.execCommand('bold');
    return;
  }

  if (event.key.toLowerCase() === 'i' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.target.ownerDocument.execCommand('italic');
  }
}

function onFrameInput() {
  if (!state.editing) return;
  const editing = state.editing;
  writeFieldValue(editing.ctx, readEditingValue());
  markDirty();
  updateOverlays();
}

/* ------------------------------------------------- перетаскивание блоков */

function blocksOf(list) {
  const doc = frameDoc();
  if (!doc) return [];
  return Array.from(doc.querySelectorAll('[data-block]')).filter((el) => el.dataset.list === list);
}

function onFrameDragOver(event) {
  const doc = frameDoc();
  if (!doc) return;

  if (!ui.drag || (event.dataTransfer && event.dataTransfer.types.includes('Files'))) {
    const over = event.target.closest && event.target.closest('[data-img]');
    markPhotoDrop(over);
    if (over) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

  if (ui.drag.kind === 'section') {
    markSectionDrop(event);
    return;
  }

  const blocks = blocksOf(ui.drag.list).filter((el) => el.dataset.index !== String(ui.drag.index));
  if (!blocks.length) return;

  const base = frameBase();
  const chrome = ui.chrome;

  let best = null;
  let bestDistance = Infinity;
  blocks.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = (dx / Math.max(rect.width, 1)) ** 2 + (dy / Math.max(rect.height, 1)) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { el, rect };
    }
  });

  if (!best) return;

  const dx = event.clientX - (best.rect.left + best.rect.width / 2);
  const dy = event.clientY - (best.rect.top + best.rect.height / 2);
  const horizontal = Math.abs(dx) / Math.max(best.rect.width, 1) > Math.abs(dy) / Math.max(best.rect.height, 1);
  const before = horizontal ? dx < 0 : dy < 0;
  const index = Number(best.el.dataset.index);

  ui.drop = { list: ui.drag.list, index, before };

  const line = chrome.drop;
  const k = 1 / (ui.scale || 1);
  line.hidden = false;
  if (horizontal) {
    line.style.left = `${(before ? best.rect.left : best.rect.right) - base.left - 1.5 * k}px`;
    line.style.top = `${best.rect.top - base.top}px`;
    line.style.width = `${3 * k}px`;
    line.style.height = `${best.rect.height}px`;
  } else {
    line.style.left = `${best.rect.left - base.left}px`;
    line.style.top = `${(before ? best.rect.top : best.rect.bottom) - base.top - 1.5 * k}px`;
    line.style.width = `${best.rect.width}px`;
    line.style.height = `${3 * k}px`;
  }
}

function onFrameDrop(event) {
  const doc = frameDoc();
  if (!doc) return;
  clearPhotoDrop();

  const files = event.dataTransfer ? Array.from(event.dataTransfer.files || []) : [];
  if (files.length) {
    event.preventDefault();
    const over = event.target.closest && event.target.closest('[data-img]');
    const path = over ? over.dataset.img : state.selection?.kind === 'image' ? state.selection.path : '';
    if (path) uploadImageFile(path, files[0]);
    return;
  }

  if (!ui.drag || !ui.drop) {
    if (ui.drag) hideDropLine();
    return;
  }

  event.preventDefault();

  const drag = ui.drag;
  const drop = ui.drop;

  hideDropLine();
  ui.drag = null;
  if (ui.chrome) ui.chrome.doc.body.classList.remove('hf-dragging');

  if (drag.kind === 'section') {
    reorderSection(drag.id, drop.targetId, drop.before);
    return;
  }

  const { list, index: from } = drag;
  const { index, before } = drop;

  let to = before ? index : index + 1;
  if (to > from) to -= 1;
  if (to === from) {
    layoutFrame();
    return;
  }

  reorderBlock(list, from, to);
}

/* ----------------------------- секции: перетаскивание по странице */

function sectionElements() {
  const doc = frameDoc();
  if (!doc) return [];
  return Array.from(doc.querySelectorAll('[data-section]')).filter((el) =>
    MOVABLE_SECTIONS.includes(el.dataset.section)
  );
}

function markSectionDrop(event) {
  const doc = frameDoc();
  const chrome = ui.chrome;
  if (!doc || !chrome) return;

  const sections = sectionElements();
  if (!sections.length) return;

  /* Целимся в ближайшую границу секции: так вставка попадает туда, куда ведёт
     курсор, даже если сама секция очень длинная. */
  let best = null;
  let bestDistance = Infinity;
  sections.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const dTop = Math.abs(event.clientY - rect.top);
    const dBottom = Math.abs(event.clientY - rect.bottom);

    if (dTop < bestDistance) {
      bestDistance = dTop;
      best = { el, rect, before: true };
    }
    if (dBottom < bestDistance) {
      bestDistance = dBottom;
      best = { el, rect, before: false };
    }
  });

  if (!best) return;

  const before = best.before;
  ui.drop = { kind: 'section', targetId: best.el.dataset.section, before };

  const base = frameBase();
  if (!base) return;

  const k = 1 / (ui.scale || 1);
  const line = chrome.drop;
  line.hidden = false;
  line.style.left = `${best.rect.left - base.left}px`;
  line.style.top = `${(before ? best.rect.top : best.rect.bottom) - base.top - 1.5 * k}px`;
  line.style.width = `${best.rect.width}px`;
  line.style.height = `${3 * k}px`;
}

function markPhotoDrop(el) {
  if (ui.photoDrop === el) return;
  clearPhotoDrop();
  if (!el) return;
  el.classList.add('hf-photo-drop');
  ui.photoDrop = el;
}

function clearPhotoDrop() {
  if (!ui.photoDrop) return;
  ui.photoDrop.classList.remove('hf-photo-drop');
  ui.photoDrop = null;
}

function onFrameDragEnd() {
  ui.drag = null;
  hideDropLine();
  clearPhotoDrop();
  if (ui.chrome) {
    ui.chrome.doc.body.classList.remove('hf-dragging');
    paintBar();
  }
}

function onBlockDragStart(event) {
  if (state.editing) {
    event.preventDefault();
    return;
  }

  const el = event.target && event.target.closest ? event.target.closest('[data-block]') : null;
  if (!el) return;

  ui.drag = {
    kind: 'block',
    list: el.dataset.list,
    index: Number(el.dataset.index) || 0,
    path: el.dataset.block,
  };

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', el.dataset.block || '');
  }

  if (ui.chrome) {
    ui.chrome.bar.hidden = true;
    ui.chrome.doc.body.classList.add('hf-dragging');
  }
}

/* ------------------------------------------------------ действия со блоками */

function reorderBlock(list, from, to) {
  const array = getPath(state.content, list);
  if (!Array.isArray(array)) return;
  if (to < 0 || to >= array.length) return;

  pushHistory();
  const [item] = array.splice(from, 1);
  array.splice(to, 0, item);

  state.selection = { kind: 'block', path: `${list}.${to}`, list, index: to };
  markDirty();
  renderLayers();
  renderInspector();
  refreshPreview();
}

function reorderSection(id, targetId, before) {
  if (!id || !targetId || id === targetId) return;

  const order = sectionOrder();
  if (!order.includes(id) || !order.includes(targetId)) return;

  const rest = order.filter((item) => item !== id);
  let at = rest.indexOf(targetId);
  if (at === -1) return;
  if (!before) at += 1;
  rest.splice(at, 0, id);

  pushHistory();
  state.content.sections.order = rest;
  state.selection = { kind: 'section', id };
  markDirty();
  renderLayers();
  renderInspector();
  refreshPreview();
  toast('Порядок секций обновлён');
}

function blockContext() {
  const selection = state.selection;
  if (!selection || selection.kind !== 'block') return null;
  const array = getPath(state.content, selection.list);
  if (!Array.isArray(array)) return null;
  return { selection, array };
}

function moveBlock(delta) {
  const ctx = blockContext();
  if (!ctx) return;
  const target = ctx.selection.index + delta;
  if (target < 0 || target >= ctx.array.length) return;
  reorderBlock(ctx.selection.list, ctx.selection.index, target);
}

function duplicateBlock() {
  const ctx = blockContext();
  if (!ctx) return;

  pushHistory();
  ctx.array.splice(ctx.selection.index + 1, 0, clone(ctx.array[ctx.selection.index]));
  state.selection = {
    kind: 'block',
    list: ctx.selection.list,
    index: ctx.selection.index + 1,
    path: `${ctx.selection.list}.${ctx.selection.index + 1}`,
  };
  markDirty();
  renderLayers();
  renderInspector();
  refreshPreview();
  toast('Блок скопирован');
}

function addBlock() {
  const ctx = blockContext();
  if (!ctx) return;

  const spec = resolveListSpec(ctx.selection.list);
  if (!spec) return;

  pushHistory();
  ctx.array.splice(ctx.selection.index + 1, 0, clone(spec.blank || {}));
  state.selection = {
    kind: 'block',
    list: ctx.selection.list,
    index: ctx.selection.index + 1,
    path: `${ctx.selection.list}.${ctx.selection.index + 1}`,
  };
  markDirty();
  renderLayers();
  renderInspector();
  refreshPreview();
  toast('Добавлен новый блок');
}

function deleteBlock() {
  const ctx = blockContext();
  if (!ctx) return;

  const spec = resolveListSpec(ctx.selection.list);
  const item = ctx.array[ctx.selection.index];
  const name = spec?.itemTitle ? spec.itemTitle(item, ctx.selection.index) : 'блок';
  if (!window.confirm(`Удалить «${name}»? Ctrl+Z вернёт обратно.`)) return;

  pushHistory();
  ctx.array.splice(ctx.selection.index, 1);
  state.selection = null;
  markDirty();
  renderLayers();
  renderInspector();
  refreshPreview();
}

function toggleSection(id) {
  if (!id || id === 'hero') return;

  pushHistory();
  const visible = state.content.sections[id] !== false;
  state.content.sections[id] = !visible;

  if (visible && state.selection?.kind === 'section' && state.selection.id === id) {
    state.selection = null;
  }

  markDirty();
  renderLayers();
  renderInspector();
  paintBar();
  refreshPreview();
}

/* -------------------------------------------------------------------- слои */

const SECTION_GROUPS = [
  { id: 'hero', fixed: true },
  { id: 'steps', items: 'steps.items' },
  { id: 'when', items: 'when.items' },
  { id: 'packages', items: 'packages.items' },
  { id: 'services', items: 'services.items' },
  { id: 'team', items: 'team.items' },
  { id: 'reviews', items: 'reviews.items' },
  { id: 'faq', items: 'faq.items' },
  { id: 'footer', items: 'footer.nav', fixed: true },
  { id: 'modal', label: 'Форма записи', noSection: true },
  { id: 'socials', label: 'Соцсети', items: 'socials', noSection: true },
];

/* Порядок секций, которые можно двигать (главный экран и подвал закреплены). */
const MOVABLE_SECTIONS = ['steps', 'when', 'packages', 'services', 'team', 'reviews', 'faq'];

function sectionOrder() {
  const raw = state.content?.sections?.order;
  const requested = Array.isArray(raw) ? raw.filter((id) => MOVABLE_SECTIONS.includes(id)) : [];
  const unique = requested.filter((id, index) => requested.indexOf(id) === index);
  return [...unique, ...MOVABLE_SECTIONS.filter((id) => !unique.includes(id))];
}

function layerGroups() {
  const byId = new Map(SECTION_GROUPS.map((group) => [group.id, group]));
  return [
    byId.get('hero'),
    ...sectionOrder().map((id) => byId.get(id)),
    byId.get('footer'),
    byId.get('modal'),
    byId.get('socials'),
  ].filter(Boolean);
}

function renderLayers() {
  if (!layersEl || !state.content) return;

  layersEl.textContent = '';

  layerGroups().forEach((group) => {
    const meta = SECTIONS.find((section) => section.id === group.id);
    const label = group.label || meta?.title || group.id;
    const hidden = !group.noSection && state.content.sections[group.id] === false;
    const items = group.items ? getPath(state.content, group.items) : null;
    const count = Array.isArray(items) ? items.length : 0;

    const activeSection =
      state.selection?.kind === 'section' && state.selection.id === group.id;
    const selectionPath = state.selection?.kind === 'block' ? state.selection.path : state.selection?.path || '';
    const containsSelection = Boolean(selectionPath) && selectionPath.startsWith(`${group.id}.`);
    const open = Boolean(group.items) && (ui.opened.has(group.id) || containsSelection);

    const row = document.createElement('div');
    row.className = `lyr${hidden ? ' is-off' : ''}${activeSection || containsSelection ? ' is-active' : ''}`;

    const head = document.createElement('div');
    head.className = `lyr__row${activeSection ? ' is-active' : ''}`;

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = `lyr__caret${open ? ' is-open' : ''}`;
    caret.textContent = '▶';
    caret.title = open ? 'Свернуть' : 'Развернуть';
    caret.disabled = !group.items || !count;
    caret.addEventListener('click', (event) => {
      event.stopPropagation();
      if (ui.opened.has(group.id)) ui.opened.delete(group.id);
      else ui.opened.add(group.id);
      renderLayers();
    });

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'lyr__name';
    name.append(h('span', {}, label));
    if (count) name.append(h('span', { class: 'lyr__count' }, String(count)));
    name.addEventListener('click', () => {
      if (group.noSection) {
        if (group.id === 'modal') goSettings('modal');
        else goSettings('general');
        return;
      }
      select({ kind: 'section', id: group.id }, { scroll: true });
    });

    head.append(caret, name);

    if (!group.noSection && !group.fixed) {
      head.draggable = true;
      head.addEventListener('dragstart', (event) => {
        ui.drag = { kind: 'section', id: group.id };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', group.id);
        row.classList.add('is-dragging');
      });
      head.addEventListener('dragend', () => {
        ui.drag = null;
        row.classList.remove('is-dragging');
        document.querySelectorAll('.lyr__drag-over').forEach((el) => el.classList.remove('lyr__drag-over'));
      });
      name.addEventListener('dragover', (event) => {
        if (!ui.drag || ui.drag.kind !== 'section') return;
        event.preventDefault();
        name.classList.add('lyr__drag-over');
      });
      name.addEventListener('dragleave', () => name.classList.remove('lyr__drag-over'));
      name.addEventListener('drop', (event) => {
        if (!ui.drag || ui.drag.kind !== 'section') return;
        event.preventDefault();
        name.classList.remove('lyr__drag-over');
        const rect = name.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        const movedFrom = ui.drag.id;
        ui.drag = null;
        reorderSection(movedFrom, group.id, before);
      });
    }

    if (!group.noSection && group.id !== 'hero') {
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'lyr__eye';
      eye.title = hidden ? 'Показать секцию' : 'Скрыть секцию';
      eye.textContent = hidden ? '○' : '◉';
      eye.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleSection(group.id);
      });
      head.append(eye);
    }

    row.append(head);

    if (group.items && count) {
      const children = document.createElement('div');
      children.className = 'lyr__children';
      if (open) {
        const spec = resolveListSpec(group.items);
        items.forEach((item, index) => {
          const title = spec?.itemTitle ? spec.itemTitle(item, index) : '';
          const itemPath = `${group.items}.${index}`;

          const button = document.createElement('button');
          button.type = 'button';
          button.className = `lyr__item${
            state.selection?.kind === 'block' && state.selection.path === itemPath ? ' is-active' : ''
          }`;
          button.draggable = true;
          button.append(
            h('span', { class: 'lyr__grip' }, '≡'),
            h('span', {}, title || `Элемент ${index + 1}`)
          );

          button.addEventListener('click', () =>
            select({ kind: 'block', path: itemPath, list: group.items, index }, { scroll: true })
          );

          button.addEventListener('dragstart', (event) => {
            ui.drag = { list: group.items, index };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', itemPath);
            button.classList.add('is-dragging');
          });
          button.addEventListener('dragend', () => {
            ui.drag = null;
            button.classList.remove('is-dragging');
            document.querySelectorAll('.lyr__drag-over').forEach((el) => el.classList.remove('lyr__drag-over'));
          });
          button.addEventListener('dragover', (event) => {
            if (!ui.drag || ui.drag.list !== group.items) return;
            event.preventDefault();
            button.classList.add('lyr__drag-over');
          });
          button.addEventListener('dragleave', () => button.classList.remove('lyr__drag-over'));
          button.addEventListener('drop', (event) => {
            if (!ui.drag || ui.drag.list !== group.items) return;
            event.preventDefault();
            button.classList.remove('lyr__drag-over');
            const from = ui.drag.index;
            ui.drag = null;
            reorderBlock(group.items, from, index);
          });

          children.append(button);
        });
      }
      row.append(children);
    }

    layersEl.append(row);
  });
}

/* --------------------------------------------------------------- инспектор */

function inspHeader(eyebrow, title, sub) {
  return h(
    'div',
    { class: 'insp__head' },
    h('p', { class: 'insp__eyebrow' }, eyebrow),
    h('h2', { class: 'insp__title' }, title),
    sub ? h('p', { class: 'insp__sub' }, sub) : null
  );
}

function inspBlock(label, ...children) {
  return h(
    'div',
    { class: 'insp__block' },
    label ? h('p', { class: 'insp__label' }, label) : null,
    ...children
  );
}

function inspButton(label, handler, options = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: `insp__btn${options.variant ? ` insp__btn--${options.variant}` : ''}`,
      disabled: options.disabled,
      title: options.title,
      onclick: handler,
    },
    label
  );
}

function renderInspector() {
  if (!inspectorEl) return;
  inspectorEl.textContent = '';
  if (!state.content) return;

  const selection = state.selection;
  if (!selection) return renderInspectorWelcome();
  if (selection.kind === 'field') return renderTextInspector(selection);
  if (selection.kind === 'image') return renderImageInspector(selection);
  if (selection.kind === 'block') return renderBlockInspector(selection);
  if (selection.kind === 'section') return renderSectionInspector(selection);
}

function renderInspectorWelcome() {
  inspectorEl.append(
    inspHeader('Редактор', 'Начните на странице', 'Кликните по элементу слева — свойства появятся здесь.')
  );

  inspectorEl.append(
    inspBlock(
      '',
      h(
        'div',
        { class: 'insp__tip' },
        h('span', {}, '💡'),
        h(
          'p',
          {},
          'Текст печатается прямо на сайте, фото меняется по клику, блоки переставляются перетаскиванием за ручку ≡.'
        )
      )
    )
  );

  const quick = h('div', { class: 'insp__row' });
  [
    ['general', 'SEO и контакты'],
    ['modal', 'Форма записи'],
    ['design', 'Цвета сайта'],
    ['backup', 'Резервная копия'],
  ].forEach(([id, label]) => quick.append(inspButton(label, () => goSettings(id))));

  inspectorEl.append(inspBlock('Все настройки', quick));

  inspectorEl.append(
    inspBlock(
      'Помощь',
      h(
        'div',
        { class: 'insp__row' },
        inspButton('Показать подсказки', showTour),
        inspButton('Открыть сайт', () => window.open('/', '_blank', 'noopener'))
      )
    )
  );
}

function editorCtx(pathFor) {
  return {
    markDirty,
    toast,
    beforeChange: pushHistory,
    rerender: () => {
      renderLayers();
      renderInspector();
    },
    changed: (path) => {
      const absolute = pathFor(path);
      if (!patchFrame(absolute)) scheduleRefresh();
      renderLayers();
    },
  };
}

function renderTextInspector(selection) {
  const ctx = resolveFieldContext(selection.path);
  const title = ctx?.spec?.label || 'Текст';

  inspectorEl.append(inspHeader('Текст', title, sectionTitle(selection.path)));

  if (!ctx) {
    inspectorEl.append(h('p', { class: 'insp__hint' }, 'Для этого элемента нет полей — правьте его на странице.'));
    return;
  }

  inspectorEl.append(
    inspBlock(
      '',
      h(
        'div',
        { class: 'insp__row' },
        inspButton('✏️ Печатать на странице', () => {
          const el = elementFor(selection);
          if (el) beginTextEdit(selection.path, el);
        }, { variant: 'accent' }),
        inspButton('Найти', () => scrollToSelection(selection))
      )
    )
  );

  const fields = h('div', { class: 'fields' });
  renderFields(fields, [ctx.spec], ctx.object, editorCtx(() => selection.path));
  inspectorEl.append(inspBlock('Содержание', fields));

  if (ctx.spec.html) {
    inspectorEl.append(
      h('p', { class: 'insp__hint' }, 'Можно выделять слова жирным и делать перенос строки Shift+Enter.')
    );
  }
}

function renderImageInspector(selection) {
  const current = getPath(state.content, selection.path);
  const title = resolveFieldContext(selection.path)?.spec?.label || 'Изображение';

  inspectorEl.append(inspHeader('Фото', title, sectionTitle(selection.path)));

  inspectorEl.append(
    inspBlock(
      '',
      h(
        'div',
        { class: 'insp__row' },
        inspButton('Заменить фото', () => pickImage(selection.path), { variant: 'accent' }),
        inspButton('Убрать', () => clearImage(selection.path), { variant: 'danger', disabled: !current })
      )
    )
  );

  inspectorEl.append(
    h('p', { class: 'insp__hint' }, 'Совет: файл можно просто перетащить с рабочего стола прямо на фото в макете.')
  );

  const fields = h('div', { class: 'fields' });
  renderFields(
    fields,
    [{ type: 'image', path: selection.path, label: 'Файл изображения' }],
    state.content,
    editorCtx(() => selection.path)
  );
  inspectorEl.append(inspBlock('', fields));
}

function describePathText(path) {
  const spec = resolveFieldContext(path)?.spec;
  return spec?.hint || '';
}

function renderBlockInspector(selection) {
  const spec = resolveListSpec(selection.list);
  const item = getPath(state.content, selection.path);
  const array = getPath(state.content, selection.list);

  if (!spec || !item || !Array.isArray(array)) {
    inspectorEl.append(inspHeader('Блок', 'Неизвестный блок', ''));
    return;
  }

  const name = spec.itemTitle ? spec.itemTitle(item, selection.index) : `Элемент ${selection.index + 1}`;
  inspectorEl.append(
    inspHeader(spec.label || 'Блок', name, `Позиция ${selection.index + 1} из ${array.length}`)
  );

  inspectorEl.append(
    inspBlock(
      'Порядок',
      h(
        'div',
        { class: 'insp__row insp__row--grid' },
        inspButton('↑ Выше', () => moveBlock(-1), { disabled: selection.index === 0 }),
        inspButton('↓ Ниже', () => moveBlock(1), { disabled: selection.index >= array.length - 1 }),
        inspButton('⧉ Дублировать', () => duplicateBlock()),
        inspButton('✕ Удалить', () => deleteBlock(), { variant: 'danger' })
      )
    )
  );

  const fields = h('div', { class: 'fields' });
  renderFields(fields, spec.fields, item, editorCtx((path) => `${selection.path}.${path}`));
  inspectorEl.append(inspBlock('Содержание', fields));

  inspectorEl.append(
    inspBlock(
      '',
      h(
        'div',
        { class: 'insp__row' },
        inspButton(`+ ${spec.addLabel || 'Добавить'}`, () => addBlock()),
        inspButton('Найти на странице', () => scrollToSelection(selection))
      )
    )
  );
}

function renderSectionInspector(selection) {
  const meta = SECTIONS.find((section) => section.id === selection.id);
  const title = meta?.title || selection.id;

  inspectorEl.append(inspHeader('Секция', title, 'Видимость и общие настройки блока'));

  if (selection.id === 'hero') {
    inspectorEl.append(h('p', { class: 'insp__hint' }, 'Главный экран показывается всегда — его можно только наполнять.'));
  } else {
    const visible = state.content.sections[selection.id] !== false;
    inspectorEl.append(
      inspBlock(
        'На сайте',
        h(
          'div',
          { class: 'insp__row' },
          inspButton(visible ? '◉ Показывать' : '○ Скрыта', () => toggleSection(selection.id)),
          inspButton('⚙ Настройки секции', () => goSettings(selection.id))
        )
      )
    );
  }

  if (MOVABLE_SECTIONS.includes(selection.id)) {
    const order = sectionOrder();
    const position = order.indexOf(selection.id);
    inspectorEl.append(
      inspBlock(
        'Порядок на странице',
        h(
          'div',
          { class: 'insp__row insp__row--grid' },
          inspButton('↑ Выше', () => reorderSection(selection.id, order[position - 1], true), {
            disabled: position <= 0,
          }),
          inspButton('↓ Ниже', () => reorderSection(selection.id, order[position + 1], false), {
            disabled: position === -1 || position >= order.length - 1,
          })
        )
      )
    );
  }

  const group = SECTION_GROUPS.find((entry) => entry.id === selection.id);
  const items = group?.items ? getPath(state.content, group.items) : null;

  if (Array.isArray(items) && items.length) {
    const spec = resolveListSpec(group.items);
    const list = h('div', { class: 'insp__row' });
    items.slice(0, 12).forEach((item, index) => {
      const label = spec?.itemTitle ? spec.itemTitle(item, index) : `Элемент ${index + 1}`;
      list.append(
        inspButton(label, () =>
          select({ kind: 'block', path: `${group.items}.${index}`, list: group.items, index }, { scroll: true })
        )
      );
    });
    inspectorEl.append(inspBlock('Внутри секции', list));
  }

  if (selection.id !== 'hero' && meta?.fields) {
    inspectorEl.append(
      inspBlock(
        '',
        inspButton('Открыть все тексты секции', () => goSettings(selection.id), { variant: 'accent' })
      )
    );
  }

  inspectorEl.append(
    inspBlock(
      '',
      h(
        'div',
        { class: 'insp__row' },
        inspButton('← Слои', () => toggleDrawer('layers')),
        inspButton('Вписать в экран', () => scrollToSelection(selection))
      )
    )
  );
}

/* ------------------------------------------------------- загрузка страницы */

function onFrameLoad() {
  const doc = frameDoc();
  if (!doc) return;

  state.editing = null;
  mountChrome(doc);

  doc.addEventListener('click', onFrameClick, true);
  doc.addEventListener('dblclick', onFrameDblClick, true);
  doc.addEventListener('mouseover', onFrameOver, true);
  doc.addEventListener('mouseout', onFrameOut, true);
  doc.addEventListener('keydown', onFrameKeydown, true);
  doc.addEventListener('input', onFrameInput, true);
  doc.addEventListener('dragover', onFrameDragOver, true);
  doc.addEventListener('drop', onFrameDrop, true);
  doc.addEventListener('dragend', onFrameDragEnd, true);
  doc.addEventListener(
    'dragleave',
    (event) => {
      if (!ui.photoDrop) return;
      const related = event.relatedTarget;
      if (related && related.closest && related.closest('[data-img]') === ui.photoDrop) return;
      clearPhotoDrop();
    },
    true
  );
  doc.addEventListener('dragstart', (event) => {
    if (!state.editing) return;
    event.preventDefault();
  }, true);

  doc.querySelectorAll('[data-block]').forEach((el) => {
    el.draggable = true;
    el.addEventListener('dragstart', onBlockDragStart);
    el.addEventListener('dragend', onFrameDragEnd);
  });

  doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', scheduleLayout));

  const resizeObserver = new ResizeObserver(scheduleLayout);
  if (doc.body) resizeObserver.observe(doc.body);

  layoutFrame();

  if (ui.scrollTop != null) canvasScrollEl.scrollTop = ui.scrollTop;

  paintBar();
  renderInspector();
}

/* ------------------------------------------------------------- режимы */

function setMode(mode) {
  if (state.editing) commitInline();
  state.mode = mode;

  const editorView = document.getElementById('editor-view');
  const settingsView = document.getElementById('settings-view');
  if (editorView) editorView.hidden = mode !== 'editor';
  if (settingsView) settingsView.hidden = mode !== 'settings';

  const shortcut = document.getElementById('settings-shortcut');
  if (shortcut) shortcut.classList.toggle('is-active', mode === 'settings');

  if (mode === 'settings') {
    renderNav();
    renderSection();
    window.scrollTo({ top: 0 });
    return;
  }

  layoutFrame();
  paintBar();
  updateOverlays();
}

function goSettings(sectionId) {
  setMode('settings');
  if (sectionId) openSection(sectionId);
  toggleDrawer(null);
}

function toggleDrawer(which) {
  const layers = document.getElementById('layers-panel');
  const inspector = document.getElementById('inspector-panel');
  const isMobile = window.matchMedia('(max-width: 1080px)').matches;
  if (!isMobile) return;

  layers?.classList.toggle('is-open', which === 'layers');
  inspector?.classList.toggle('is-open', which === 'inspector');
}

/* --------------------------------------------------------------- подсказки */

function showTour() {
  const tour = document.getElementById('tour');
  if (tour) tour.hidden = false;
}

function hideTour() {
  const tour = document.getElementById('tour');
  if (tour) tour.hidden = true;
  try {
    localStorage.setItem('lfk-tour-v2', 'done');
  } catch {
    /* приватный режим */
  }
}

function maybeShowTour() {
  let seen = true;
  try {
    seen = localStorage.getItem('lfk-tour-v2') === 'done';
  } catch {
    seen = true;
  }
  if (!seen) showTour();
}

/* ---------------------------------------------------------------- запуск */

function bindEditorChrome() {
  if (ui.bound) return;
  ui.bound = true;

  document.getElementById('device-switch')?.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    state.device = button.dataset.device;
    document.querySelectorAll('#device-switch button').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.device === state.device);
    });
    ui.zoom = null;
    layoutFrame();
  });

  document.getElementById('lang-switch')?.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.dataset.lang === state.lang) return;
    if (state.editing) commitInline();
    state.lang = button.dataset.lang;
    document.querySelectorAll('#lang-switch button').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.lang === state.lang);
    });
    refreshPreview();
  });

  document.getElementById('zoom-in')?.addEventListener('click', () => stepZoom(1));
  document.getElementById('zoom-out')?.addEventListener('click', () => stepZoom(-1));
  document.getElementById('zoom-fit')?.addEventListener('click', () => setZoom(null));

  document.getElementById('zoom-bar-in')?.addEventListener('click', () => stepZoom(1));
  document.getElementById('zoom-bar-out')?.addEventListener('click', () => stepZoom(-1));
  document.getElementById('zoom-bar-fit')?.addEventListener('click', () => setZoom(null));
  document.getElementById('zoom-bar-value')?.addEventListener('click', () => {
    const presets = [null, 0.5, 0.75, 1];
    const current = ui.zoom;
    const index = presets.findIndex((value) => value === current);
    setZoom(presets[(index + 1) % presets.length]);
  });

  document.getElementById('undo-btn')?.addEventListener('click', undo);
  document.getElementById('redo-btn')?.addEventListener('click', redo);
  document.getElementById('help-btn')?.addEventListener('click', showTour);
  document.getElementById('tour-close')?.addEventListener('click', hideTour);
  document.getElementById('tour-settings')?.addEventListener('click', () => {
    hideTour();
    goSettings('general');
  });

  document.getElementById('settings-shortcut')?.addEventListener('click', () => goSettings('general'));
  document.getElementById('footer-settings')?.addEventListener('click', () => goSettings('general'));
  document.getElementById('back-to-editor')?.addEventListener('click', () => setMode('editor'));

  document.getElementById('toggle-layers')?.addEventListener('click', () => toggleDrawer('layers'));
  document.getElementById('toggle-inspector')?.addEventListener('click', () => toggleDrawer('inspector'));
  document.getElementById('close-layers')?.addEventListener('click', () => toggleDrawer(null));
  document.getElementById('close-inspector')?.addEventListener('click', () => toggleDrawer(null));

  document.getElementById('hint-close')?.addEventListener('click', () => {
    const hint = document.getElementById('canvas-hint');
    if (hint) hint.hidden = true;
  });

  frameEl.addEventListener('load', onFrameLoad);
  window.addEventListener('resize', scheduleLayout);

  document.addEventListener('mousedown', (event) => {
    if (state.editing && !event.target.closest('#preview-frame')) commitInline();
  }, true);

  document.addEventListener('focusin', (event) => {
    if (!state.content) return;
    if (!event.target.matches('input, textarea, select')) return;
    if (!event.target.closest('#inspector-body, #section-body')) return;
    const now = Date.now();
    if (now - (ui.historyAt || 0) < 500) return;
    ui.historyAt = now;
    pushHistory();
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const typing = isTypingTarget(event.target);

    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (state.dirty) save();
      return;
    }

    if (typing) return;

    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }

    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }

    if (mod && event.key.toLowerCase() === 'd') {
      if (state.selection?.kind === 'block') {
        event.preventDefault();
        duplicateBlock();
      }
      return;
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && state.selection?.kind === 'block') {
      event.preventDefault();
      deleteBlock();
      return;
    }

    if (event.key === 'Escape') {
      if (state.selection) select(null);
      toggleDrawer(null);
    }
  });
}

function initEditor() {
  bindEditorChrome();
  setMode('editor');
  state.selection = null;
  renderLayers();
  renderInspector();
  paintBar();
  updateOverlays();
  updateHistoryButtons();
  refreshPreview();
  maybeShowTour();

  const hint = document.getElementById('canvas-hint');
  if (hint) {
    try {
      hint.hidden = localStorage.getItem('lfk-hint-v2') === 'done';
    } catch {
      hint.hidden = true;
    }
  }
}
