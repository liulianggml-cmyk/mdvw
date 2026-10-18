// mdvw front-end glue — three-mode viewer/editor.

const html = document.documentElement;
const preview = document.getElementById('preview');
preview.tabIndex = -1;
const editor = document.getElementById('editor');
const toast = document.getElementById('toast');
const fileChip = document.getElementById('file-chip');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const assocDialog = document.getElementById('assoc-prompt');
const helpDialog = document.getElementById('help-dialog');
const segs = document.querySelectorAll('.segmented .seg');
const mainEl = document.getElementById('main');

// Defense in depth: scope bootstrap lookups to the specific <script> tags
// we injected, so a user document with `<div id="md-source">...` can't
// shadow our data during sanitizer edge cases.
const bootstrapEl = (id) =>
  document.querySelector(`script#${id}`) ||
  document.getElementById(id);

const mdSource = JSON.parse(bootstrapEl('md-source').textContent || '""');
const mdPath = bootstrapEl('md-path').textContent.trim();
let currentPath = mdPath;
let browseRoot = (bootstrapEl('md-browse-root')?.textContent || '').trim();
const uiState = JSON.parse(bootstrapEl('md-ui-state')?.textContent || '{}');

const getApi = () => (window.pywebview && window.pywebview.api) || null;
let zoomLevel = Number(uiState.zoom_level);
if (!Number.isFinite(zoomLevel) || zoomLevel < 0.5 || zoomLevel > 3) zoomLevel = 1;
const zoomValue = document.getElementById('zoom-value');
zoomValue.textContent = `${Math.round(zoomLevel * 100)}%`;
window.addEventListener('DOMContentLoaded', () => {
  whenApiReady().then(api => api?.set_zoom(zoomLevel));
});

function changeZoom(delta) {
  zoomLevel = Math.max(0.5, Math.min(3, Math.round((zoomLevel + delta) * 10) / 10));
  zoomValue.textContent = `${Math.round(zoomLevel * 100)}%`;
  whenApiReady().then(api => api?.set_zoom(zoomLevel));
  persistState();
}

document.getElementById('btn-zoom-out').addEventListener('click', () => changeZoom(-0.1));
document.getElementById('btn-zoom-in').addEventListener('click', () => changeZoom(0.1));
zoomValue.addEventListener('click', () => changeZoom(1 - zoomLevel));

let currentSource = mdSource;
let currentMode = 'read';
let dirty = false;

const documentTabsEl = document.getElementById('document-tabs');
const documentTabs = [];
const documentTabScroll = new Map();

function renderDocumentTabs() {
  documentTabsEl.replaceChildren();
  for (const tab of documentTabs) {
    const item = document.createElement('div');
    item.className = 'document-tab';
    if (sameBrowserPath(tab.path, currentPath)) item.classList.add('active');
    item.setAttribute('role', 'tab');
    item.tabIndex = 0;
    item.setAttribute('aria-selected', item.classList.contains('active') ? 'true' : 'false');
    item.title = tab.path;
    const label = document.createElement('span');
    label.className = 'document-tab-label';
    label.textContent = tab.name;
    item.addEventListener('click', async (event) => {
      if (event.target.closest('.document-tab-close')) return;
      if (sameBrowserPath(tab.path, currentPath)) return;
      const api = await whenApiReady();
      if (api?.activate_tab && !await api.activate_tab(tab.path)) flash('Could not open tab');
    });
    item.addEventListener('keydown', event => {
      if (event.target !== item) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.click();
      } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = documentTabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? documentTabs.length - 1 :
          (index + (event.key === 'ArrowRight' ? 1 : -1) + documentTabs.length) % documentTabs.length;
        documentTabsEl.children[next]?.focus();
      }
    });
    item.appendChild(label);
    if (documentTabs.length > 1) {
      const close = document.createElement('button');
      close.className = 'document-tab-close';
      close.type = 'button';
      close.title = `Close ${tab.name}`;
      close.setAttribute('aria-label', close.title);
      close.textContent = '×';
      close.addEventListener('click', async () => {
        const index = documentTabs.indexOf(tab);
        if (index < 0) return;
        const wasActive = sameBrowserPath(tab.path, currentPath);
        const next = documentTabs[index === 0 ? 1 : index - 1];
        documentTabs.splice(index, 1);
        documentTabScroll.delete(tab.path);
        const api = await whenApiReady();
        if (wasActive && next && api?.activate_tab) await api.activate_tab(next.path);
        if (api?.close_tab) await api.close_tab(tab.path);
        renderDocumentTabs();
      });
      item.appendChild(close);
    }
    documentTabsEl.appendChild(item);
  }
}

function selectDocumentTab(path, name) {
  if (!path) return;
  let tab = documentTabs.find(item => sameBrowserPath(item.path, path));
  if (!tab) {
    tab = { path, name: name || path.split(/[\\/]/).pop() };
    documentTabs.push(tab);
  } else if (name) {
    tab.name = name;
  }
  renderDocumentTabs();
}

// ---------- Document navigation history ----------

const navigationHistory = [];
let navigationIndex = -1;
let pendingHistoryTraversal = null;
let navigationBusy = false;

function navigationEntry(path, name = '') {
  if (!path) return null;
  const fallback = String(path).split(/[\\/]/).filter(Boolean).pop() || String(path);
  return { path: String(path), name: name || fallback };
}

function updateNavigationControls() {
  const back = navigationHistory[navigationIndex - 1] || null;
  const forward = navigationHistory[navigationIndex + 1] || null;
  btnBack.disabled = !back || navigationBusy;
  btnForward.disabled = !forward || navigationBusy;
  btnBack.title = back ? `返回 ${back.name} (Alt+←)` : '后退 (Alt+←)';
  btnForward.title = forward ? `前往 ${forward.name} (Alt+→)` : '前进 (Alt+→)';
}

function recordDocumentNavigation(path, name = '', reason = 'open') {
  const entry = navigationEntry(path, name);
  if (!entry) { updateNavigationControls(); return; }

  if (pendingHistoryTraversal && sameBrowserPath(entry.path, pendingHistoryTraversal.path)) {
    navigationHistory[pendingHistoryTraversal.index] = entry;
    navigationIndex = pendingHistoryTraversal.index;
    pendingHistoryTraversal = null;
    updateNavigationControls();
    return;
  }
  if (pendingHistoryTraversal) pendingHistoryTraversal = null;

  if (reason === 'watch') {
    if (navigationIndex >= 0) navigationHistory[navigationIndex] = entry;
    else {
      navigationHistory.push(entry);
      navigationIndex = 0;
    }
    updateNavigationControls();
    return;
  }

  const current = navigationHistory[navigationIndex] || null;
  if (current && sameBrowserPath(current.path, entry.path)) {
    navigationHistory[navigationIndex] = entry;
    updateNavigationControls();
    return;
  }

  navigationHistory.splice(navigationIndex + 1);
  navigationHistory.push(entry);
  if (navigationHistory.length > 100) navigationHistory.shift();
  navigationIndex = navigationHistory.length - 1;
  updateNavigationControls();
}

async function openHistoryPath(path) {
  const api = await whenApiReady();
  if (!api) return false;
  if (api.open_path) {
    try {
      if (await api.open_path(path)) return true;
    } catch { /* fall back to recent-file allowlist */ }
  }
  if (api.open_recent) {
    try {
      return !!(await api.open_recent(path));
    } catch { return false; }
  }
  return false;
}

async function navigateHistory(delta) {
  if (navigationBusy) return;
  const targetIndex = navigationIndex + delta;
  const target = navigationHistory[targetIndex];
  if (!target) return;
  if (!(await confirmDiscardIfDirty())) return;

  const previousIndex = navigationIndex;
  pendingHistoryTraversal = { index: targetIndex, path: target.path };
  navigationIndex = targetIndex;
  navigationBusy = true;
  updateNavigationControls();
  const ok = await openHistoryPath(target.path);
  navigationBusy = false;
  if (!ok) {
    pendingHistoryTraversal = null;
    navigationIndex = previousIndex;
    updateNavigationControls();
    flash(`Could not open ${target.name}`);
    return;
  }
  updateNavigationControls();
}

recordDocumentNavigation(mdPath, fileChip.textContent || mdPath, 'initial');

// ---------- Mode switching ----------

async function setMode(mode) {
  if (mode !== 'read') return;
  if (!['read', 'edit', 'source'].includes(mode)) mode = 'read';
  if (mode === currentMode) return;
  // Sync source from editor if leaving edit/source
  if ((currentMode === 'edit' || currentMode === 'source')) {
    currentSource = editor.value;
  }
  currentMode = mode;
  html.dataset.mode = mode;
  segs.forEach(b => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (mode === 'edit' || mode === 'source') {
    editor.value = currentSource;
    if (mode === 'edit') {
      await rerender();
      editor.focus();
    } else {
      editor.focus();
    }
  } else {
    await rerender();
    preview.focus({ preventScroll: true });
  }
  updateStatusBar();
}

segs.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

// Cycle on E, but only when not typing in textarea/input
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab' && documentTabs.length > 1) {
    e.preventDefault();
    const index = documentTabs.findIndex(tab => sameBrowserPath(tab.path, currentPath));
    const next = (index + (e.shiftKey ? -1 : 1) + documentTabs.length) % documentTabs.length;
    documentTabsEl.children[next]?.click();
    return;
  }
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
      e.preventDefault();
      changeZoom(0.1);
      return;
    }
    if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
      e.preventDefault();
      changeZoom(-0.1);
      return;
    }
    if (e.key === '0' || e.code === 'Numpad0') {
      e.preventDefault();
      changeZoom(1 - zoomLevel);
      return;
    }
  }
  if (e.key === 'Escape' && paletteOpen) { closePalette(); e.preventDefault(); return; }
  if (e.key === 'Escape' && document.body.classList.contains('graph-fullscreen')) {
    exitFullscreenGraph();
    e.preventDefault();
    return;
  }
  const typing = document.activeElement &&
    (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') &&
    document.activeElement.getClientRects().length > 0;
  if (!typing && currentMode === 'read' && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(preview);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  if (!typing && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    navigateHistory(-1);
    return;
  }
  if (!typing && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowRight') {
    e.preventDefault();
    navigateHistory(1);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    if (paletteOpen) closePalette(); else openPalette();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F') && !e.altKey) {
    e.preventDefault();
    openFind();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 's' || e.key === 'n')) { e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'o') {
    e.preventDefault();
    openFile();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    preview.classList.toggle('narrow');
    persistState();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F') && !e.altKey) {
    e.preventDefault();
    openWorkspaceSearch();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'g' || e.key === 'G') && !e.altKey) {
    e.preventDefault();
    toggleFullscreenGraph();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'o' || e.key === 'O') && !e.altKey) {
    e.preventDefault();
    openDirectory();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'h' || e.key === 'H') && !e.altKey) {
    e.preventDefault();
    openPalette('heading');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'i' || e.key === 'I')) {
    e.preventDefault();
    toggleRightPane();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && ['1','2','3'].includes(e.key)) {
    e.preventDefault();
    return;
  }
});

// ---------- KaTeX / Mermaid / highlight.js ----------

function renderMath(root) {
  if (window.renderMathInElement) {
    window.renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      ignoredClasses: ['mermaid'],
    });
  }
  for (const el of root.querySelectorAll('.math')) {
    if (el.dataset.rendered) continue;
    const display = el.classList.contains('math-display');
    try {
      window.katex.render(el.textContent, el, { displayMode: display, throwOnError: false });
      el.dataset.rendered = '1';
    } catch { /* leave raw */ }
  }
}

let mermaidInited = false;
async function renderMermaid(root) {
  if (!window.mermaid) return;
  if (!mermaidInited) {
    const dark = html.dataset.resolvedTheme === 'dark';
    window.mermaid.initialize({
      startOnLoad: false,
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'var(--font-serif)',
    });
    mermaidInited = true;
  }
  const blocks = root.querySelectorAll('pre.mermaid');
  let i = 0;
  for (const el of blocks) {
    if (el.dataset.rendered) continue;
    const id = `mermaid-${Date.now()}-${i++}`;
    try {
      const { svg } = await window.mermaid.render(id, el.textContent);
      el.innerHTML = svg;
      el.dataset.rendered = '1';
    } catch (e) {
      el.textContent = `Mermaid error: ${e.message || e}`;
    }
  }
}

function highlightAndDecorate(root) {
  const blocks = root.querySelectorAll('pre.code-block > code[class*="language-"]');
  for (const code of blocks) {
    const pre = code.parentElement;
    if (pre.dataset.decorated) continue;
    const lang = (code.className.match(/language-(\S+)/) || [])[1] || '';
    // Highlight
    if (window.hljs) {
      try { window.hljs.highlightElement(code); } catch { /* ignore */ }
    }
    // Add language chip + copy header
    const header = document.createElement('div');
    header.className = 'code-header';
    const langSpan = document.createElement('span');
    langSpan.className = 'lang';
    langSpan.textContent = lang || 'text';
    const copy = document.createElement('button');
    copy.className = 'copy-btn';
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      } catch {
        flash('Copy failed');
      }
    });
    header.appendChild(langSpan);
    header.appendChild(copy);
    pre.insertBefore(header, code);
    pre.dataset.decorated = '1';
  }
}

async function enhance(root) {
  renderMath(root);
  await renderMermaid(root);
  highlightAndDecorate(root);
  buildOutline(root);
  observeHeadings(root);
}
