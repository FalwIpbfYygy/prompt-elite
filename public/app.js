/* =========================================================
 * Prompt Elite — 前端逻辑
 * 纯原生 JS，无框架依赖
 * ========================================================= */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------- 全局状态 ---------------- */
const state = {
  items: [],
  view: 'all',          // all | favorite | recent
  category: '全部',
  tag: '',              // 标签筛选（''=不过滤）
  search: '',
  editing: null,        // 正在编辑的 prompt 对象（null=新建）
  lastResult: ''        // 最近一次 AI 结果（用于迭代）
};

/* ---------------- 配置（模型） ---------------- */
const CFG_KEY = 'pe_model_cfg';
function getCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (_) {}
  return Object.assign({
    mainModel: 'deepseek-v4.1-flash',
    mainPreset: 'private',
    mainBase: '', mainKey: '',
    subModel: '', subPreset: 'private',
    subBase: '', subKey: '',
    temp: 0.7, maxTok: 2000
  }, c);
}
function setCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

/* ---------------- 主题（浅色 / 深色，带中文标签） ---------------- */
const THEMES = ['light', 'dark'];
const THEME_NAME = { light: '浅色', dark: '深色' };
function applyTheme(t) {
  if (!THEMES.includes(t)) t = 'light';
  document.documentElement.dataset.theme = t;
  const btn = $('#btn-theme');
  if (btn) btn.textContent = THEME_NAME[t];
}
function cycleTheme() {
  const cur = document.documentElement.dataset.theme;
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  applyTheme(next);
  try { localStorage.setItem('pe_theme', next); } catch (_) {}
}

/* ---------------- 极光视差 ---------------- */
function initAurora() {
  const aurora = $('#aurora');
  if (!aurora) return;
  const blobs = $$('.blob', aurora);
  const speeds = [0.06, 0.11, 0.04, 0.09];
  const phases = [0, 1.7, 3.1, 4.4];
  let scrollY = 0;
  const grid = $('#grid');
  if (grid) grid.addEventListener('scroll', () => { scrollY = grid.scrollTop; });
  function tick(t) {
    blobs.forEach((b, i) => {
      const driftY = Math.sin(t / 3000 + phases[i]) * 22;
      const px = Math.cos(t / 3500 + phases[i]) * 20;
      const py = scrollY * speeds[i] + driftY;
      b.style.transform = `translate(${px}px, ${py}px)`;
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, opts));
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  if (res.headers.get('content-type')?.includes('application/json')) return res.json();
  return res;
}

async function loadItems() {
  const { items } = await api('/api/prompts');
  state.items = items || [];
  renderAll();
}

/* ---------------- 工具 ---------------- */
function estTokens(s) { return Math.max(1, Math.ceil((s || '').length / 2)); }
function timeAgo(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) { const h = Math.floor((Date.now() - ts) / 3600000); return h <= 0 ? '刚刚' : h + ' 小时前'; }
  if (d === 1) return '昨天';
  if (d < 30) return d + ' 天前';
  if (d < 365) return Math.floor(d / 30) + ' 个月前';
  return Math.floor(d / 365) + ' 年前';
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ---------------- Markdown 渲染（轻量、安全） ---------------- */
function renderInline(s) {
  s = s.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^_])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
  return s;
}
function renderMarkdown(src) {
  const lines = esc(src).split(/\r?\n/);
  let html = '', i = 0, inList = false, listType = null;
  const closeList = () => { if (inList) { html += listType === 'ol' ? '</ol>' : '</ul>'; inList = false; listType = null; } };
  while (i < lines.length) {
    let line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html += '<pre><code>' + buf.join('\n') + '</code></pre>';
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const l = h[1].length; html += `<h${l}>${renderInline(h[2])}</h${l}>`; i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); html += '<hr>'; i++; continue; }
    if (/^>\s?/.test(line)) { closeList(); html += '<blockquote>' + renderInline(line.replace(/^>\s?/, '')) + '</blockquote>'; i++; continue; }
    if (/^[-*]\s+/.test(line)) {
      if (!inList || listType !== 'ul') { closeList(); html += '<ul>'; inList = true; listType = 'ul'; }
      html += '<li>' + renderInline(line.replace(/^[-*]\s+/, '')) + '</li>'; i++; continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (!inList || listType !== 'ol') { closeList(); html += '<ol>'; inList = true; listType = 'ol'; }
      html += '<li>' + renderInline(line.replace(/^\d+\.\s+/, '')) + '</li>'; i++; continue;
    }
    if (line.trim() === '') { closeList(); i++; continue; }
    closeList();
    html += '<p>' + renderInline(line) + '</p>';
    i++;
  }
  closeList();
  return '<div class="md">' + html + '</div>';
}

/* ---------------- 渲染：侧边栏 / 滤镜 / 卡片 ---------------- */
function getFiltered() {
  let items = state.items.slice();
  if (state.view === 'favorite') items = items.filter(x => x.favorite);
  if (state.view === 'recent') items = items.filter(x => x.lastUsedAt).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  if (state.category !== '全部') items = items.filter(x => (x.category || '通用') === state.category);
  if (state.tag) items = items.filter(x => (x.tags || []).includes(state.tag));
  if (state.search) {
    const q = state.search.toLowerCase();
    items = items.filter(x =>
      (x.title || '').toLowerCase().includes(q) ||
      (x.content || '').toLowerCase().includes(q) ||
      (x.tags || []).some(t => t.toLowerCase().includes(q)));
  }
  if (state.view !== 'recent') items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return items;
}

function renderSidebar() {
  const cats = {};
  let fav = 0;
  for (const x of state.items) {
    const c = x.category || '通用';
    cats[c] = (cats[c] || 0) + 1;
    if (x.favorite) fav++;
  }
  $('#cnt-all').textContent = state.items.length;
  $('#cnt-fav').textContent = fav;
  const list = $('#cat-list');
  list.innerHTML = '';
  const order = ['通用', ...Object.keys(cats).filter(c => c !== '通用').sort()];
  for (const c of order) {
    const el = document.createElement('div');
    el.className = 'cat-item' + (state.category === c && state.view === 'all' ? ' active' : '');
    el.innerHTML = `<span class="cat-dot"></span>${esc(c)}<em>${cats[c] || 0}</em>`;
    el.onclick = () => { state.category = c; state.view = 'all'; setView('all'); renderAll(); };
    list.appendChild(el);
  }
}

function renderPills() {
  const cats = {};
  for (const x of state.items) cats[x.category || '通用'] = (cats[x.category || '通用'] || 0) + 1;
  const wrap = $('#filter-pills');
  wrap.innerHTML = '';
  const mk = (label, val) => {
    const b = document.createElement('button');
    b.className = 'pill' + (state.category === val && state.view === 'all' ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { state.category = val; state.view = 'all'; setView('all'); renderAll(); };
    return b;
  };
  wrap.appendChild(mk('全部', '全部'));
  for (const c of Object.keys(cats).filter(c => c !== '全部').sort()) wrap.appendChild(mk(c, c));
}

function renderCards() {
  const items = getFiltered();
  const grid = $('#grid');
  grid.innerHTML = '';
  $('#item-count').textContent = items.length;
  $('#empty').hidden = items.length > 0;
  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'card';
    const preview = (it.content || '').replace(/\s+/g, ' ').slice(0, 160);
    const tags = (it.tags || []).slice(0, 5).map(t => `<span class="tag tag-click" data-tag="${esc(t)}">${esc(t)}</span>`).join('');
    card.innerHTML = `
      <span class="cat-chip">${esc(it.category || '通用')}</span>
      <span class="star ${it.favorite ? 'on' : ''}" data-act="star">${it.favorite ? '★' : '☆'}</span>
      <span class="menu" data-act="menu">⋯</span>
      <h3>${esc(it.title || '未命名')}</h3>
      <div class="preview">${esc(preview)}</div>
      <div class="tags">${tags}</div>
      <div class="card-foot">
        <span>创建 ${fmtDate(it.createdAt)}</span>
        <span>更新 ${fmtDate(it.updatedAt)}</span>
      </div>`;
    card.onclick = (e) => {
      const tg = e.target.closest('.tag-click');
      if (tg) { e.stopPropagation(); setTagFilter(tg.dataset.tag); return; }
      const act = e.target.dataset.act;
      if (act === 'star') { e.stopPropagation(); toggleFav(it.id); return; }
      if (act === 'menu') { e.stopPropagation(); openCardMenu(e.target, it); return; }
      recordUse(it.id);
      openEdit(it);
    };
    grid.appendChild(card);
  }
}

function renderAll() {
  renderSidebar();
  renderPills();
  renderCards();
  renderTagFilter();
}

/* 标签筛选：点同一个取消 */
function setTagFilter(tag) {
  state.tag = (state.tag === tag) ? '' : tag;
  renderAll();
}
function renderTagFilter() {
  const el = $('#tag-filter');
  if (!el) return;
  if (state.tag) {
    el.hidden = false;
    el.innerHTML = `筛选标签：<b>${esc(state.tag)}</b> <span class="x">✕</span>`;
    el.onclick = () => { state.tag = ''; renderAll(); };
  } else {
    el.hidden = true;
  }
}

/* ---------------- 视图切换 ---------------- */
function setView(v) {
  state.view = v;
  state.category = v === 'all' ? state.category : '全部';
  state.tag = '';
  state.search = '';
  const sb = $('#search'); if (sb) sb.value = '';
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  const title = { all: '全部提示词', favorite: '我的收藏', recent: '最近使用' }[v];
  const vt = $('#view-title'); if (vt) vt.textContent = title;
  $('#h-title').textContent = title;
  renderAll();
}

/* ---------------- 收藏 / 菜单 ---------------- */
async function toggleFav(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  await api('/api/prompts/' + id, { method: 'PUT', body: JSON.stringify({ favorite: !it.favorite }) });
  it.favorite = !it.favorite;
  renderAll();
}
function openCardMenu(anchor, it) {
  closePopMenu();
  const m = document.createElement('div');
  m.className = 'popmenu';
  const r = anchor.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px';
  m.style.right = (window.innerWidth - r.right) + 'px';
  const acts = [
    ['编辑', () => openEdit(it)],
    ['复制内容', () => { copyText(it.content); }],
    ['复制为副本', () => duplicateItem(it.id)],
    ['标记已用', () => markUsed(it.id)],
    ['删除', () => deleteItem(it.id), true]
  ];
  for (const [label, fn, danger] of acts) {
    const b = document.createElement('button');
    b.textContent = label; if (danger) b.className = 'danger';
    b.onclick = () => { closePopMenu(); fn(); };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', closePopMenu, { once: true }), 0);
}
function closePopMenu() { $$('.popmenu').forEach(m => m.remove()); }

/* 静默记录“使用”（点开/复制都算），让「最近使用」视图真实可用 */
function recordUse(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  const now = Date.now();
  it.lastUsedAt = now;
  api('/api/prompts/' + id, { method: 'PUT', body: JSON.stringify({ lastUsedAt: now }) }).catch(() => {});
}

/* 复制为副本（基于已有提示词一键克隆） */
async function duplicateItem(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  try {
    const { item } = await api('/api/prompts', {
      method: 'POST',
      body: JSON.stringify({
        title: (it.title || '未命名') + ' (副本)',
        content: it.content || '',
        tags: it.tags || [],
        category: it.category || '通用'
      })
    });
    state.items.unshift(item);
    renderAll();
    toast('已复制为副本');
  } catch (e) { toast('复制失败：' + e.message); }
}

async function markUsed(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  await api('/api/prompts/' + id, { method: 'PUT', body: JSON.stringify({ lastUsedAt: Date.now() }) });
  it.lastUsedAt = Date.now();
  toast('已记录使用');
  renderAll();
}
async function deleteItem(id) {
  if (!confirm('确定删除这条提示词？')) return;
  await api('/api/prompts/' + id, { method: 'DELETE' });
  state.items = state.items.filter(x => x.id !== id);
  renderAll();
  toast('已删除');
}

/* ---------------- 编辑 / 新建 ---------------- */
function openEdit(it) {
  state.editing = it || null;
  $('#edit-mode-label').textContent = it ? '编辑提示词' : '新建提示词';
  $('#f-title').value = it ? it.title : '';
  // 新建时继承当前所在分类（在「全部」视图下才回退到「通用」）
  const inheritCat = (state.category && state.category !== '全部') ? state.category : '通用';
  $('#f-category').value = it ? (it.category || '通用') : inheritCat;
  $('#f-tags').value = it ? (it.tags || []).join(', ') : '';
  $('#f-content').value = it ? it.content : '';
  $('#edit-meta').textContent = it ? ('v' + (it.version || 1) + ' · ' + timeAgo(it.updatedAt) + '更新') : '';
  updateCounter();
  showModal('modal-edit');
}
function updateCounter() {
  const t = $('#f-content').value;
  $('#edit-counter').textContent = t.length + ' 字 · ≈' + estTokens(t) + ' tokens';
}
async function saveEdit() {
  const payload = {
    title: $('#f-title').value.trim() || '未命名提示词',
    category: $('#f-category').value.trim() || '通用',
    tags: $('#f-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    content: $('#f-content').value
  };
  if (state.editing) {
    const { item } = await api('/api/prompts/' + state.editing.id, { method: 'PUT', body: JSON.stringify(payload) });
    Object.assign(state.editing, item);
  } else {
    const { item } = await api('/api/prompts', { method: 'POST', body: JSON.stringify(payload) });
    state.items.unshift(item);
  }
  hideModal('modal-edit');
  renderAll();
  toast('已保存');
}

/* ---------------- 弹窗通用 ---------------- */
function showModal(id) {
  const m = $('#' + id);
  m.hidden = false;
  const card = m.querySelector('.modal-card');
  if (card) { card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; }
}
function hideModal(id) { $('#' + id).hidden = true; closePopMenu(); }
$$('.modal').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
});
$$('[data-close]').forEach(b => b.onclick = () => hideModal(b.dataset.close));

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 2200);
}
function copyText(s) {
  navigator.clipboard?.writeText(s).then(() => toast('已复制'), () => toast('复制失败'));
}

/* ---------------- AI 工作台 ---------------- */
const SYS = {
  basic: '你是一位资深提示词工程师。请优化用户给出的提示词，使其更清晰、具体、可执行，提升与 AI 沟通的质量。保持原意，不要私自改变任务目标。直接输出优化后的提示词正文，可适当使用 Markdown 结构（标题/列表/加粗）。',
  structured: '你是一位专业且严谨的 AI 大模型提示词工程师。请对用户提供的提示词进行结构化优化，优化后的提示词必须包含以下部分（使用 Markdown 标题）：\n# Role（角色）\n# Goals（目标）\n# Skills（技能）\n# Workflows（工作流程）\n# Attention（注意事项）\n# Initialization（初始化）\n要求：表达清晰具体、各部分言简意赅、全文上下一致。直接输出结构化提示词，不要额外寒暄。',
  plan: '你是一位任务规划专家。请将用户提示词中隐含的目标拆解为清晰、可执行的步骤计划，输出结构化任务清单（含阶段、动作、预期产出），使用 Markdown 编号列表与小标题。',
  translate: '你是一位中英翻译专家，译文专业、准确、自然。请将用户输入在中文与英文之间互译。仅输出译文本身，不要任何解释或标点以外的多余内容。',
  inspire: '你是一位创意与行业分析专家。用户给出一个简短想法和所属领域。请结合该领域的专业框架，将想法扩展为结构化的提示词草稿，使其可直接作为更细化的 AI 提示词使用。\n领域框架指引：\nbusiness：使用 SWOT、4P、商业模式画布等\ncreative：多维度发散（人物/冲突/场景/感官/情绪）\nproduct：用户旅程、功能拆解、价值主张\nresearch：研究问题、方法、文献结构\nmarketing：AARRR、用户画像、核心卖点\ngeneral：通用 MECE 拆解\n输出使用 Markdown，包含：目标、适用框架、细化提示词草稿。'
};

let activeTab = 'optimize';
let aiMode = 'basic';
let trDir = 'zh2en';
let streamCtrl = null; // {abort}

function buildPayload(messages) {
  const c = getCfg();
  return {
    messages,
    model: c.mainModel || 'deepseek-v4.1-flash',
    temperature: c.temp,
    max_tokens: c.maxTok,
    basePreset: c.mainPreset,
    baseUrl: c.mainPreset === 'custom' ? c.mainBase : undefined,
    apiKey: c.mainPreset === 'custom' ? c.mainKey : undefined
  };
}

async function streamChat(messages, onDelta, onDone, onError) {
  if (streamCtrl) streamCtrl.abort();
  const ctrl = new AbortController();
  streamCtrl = ctrl;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(messages)),
      signal: ctrl.signal
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error + (j.detail ? '：' + j.detail : ''); } catch (_) {}
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop();
      for (const line of parts) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') { onDone(); return; }
        try {
          const j = JSON.parse(data);
          const d = j.choices?.[0]?.delta?.content || '';
          if (d) { full += d; onDelta(full); }
        } catch (_) {}
      }
    }
    onDelta(full);
    onDone();
  } catch (e) {
    if (e.name === 'AbortError') { onDone(); return; }
    onError(e.message);
  } finally {
    streamCtrl = null;
  }
}

function setResult(el, text) {
  if (!text) { el.innerHTML = '<div class="ph">✨ 准备就绪</div>'; return; }
  el.innerHTML = renderMarkdown(text);
  el.scrollTop = el.scrollHeight;
}

function openAI(originText) {
  $('#ai-origin').value = originText || '';
  $('#tr-origin').value = originText || '';
  // 填充模型下拉
  const c = getCfg();
  const sel = $('#ai-model');
  sel.innerHTML = '';
  const add = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); };
  add(c.mainModel, '主模型：' + c.mainModel);
  if (c.subModel) add(c.subModel, '辅助模型：' + c.subModel);
  switchTab('optimize');
  showModal('modal-ai');
}

function switchTab(tab) {
  activeTab = tab;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.ai-panel').forEach(p => p.hidden = p.dataset.panel !== tab);
}

/* 优化运行 */
function runOptimize() {
  const origin = $('#ai-origin').value.trim();
  if (!origin) { toast('请先填写原始提示词'); return; }
  const sys = SYS[aiMode];
  const sysMsg = aiMode === 'translate' ? SYS.translate : sys;
  const resultEl = $('#ai-result');
  setResult(resultEl, '');
  $('#btn-ai-copy').disabled = true; $('#btn-ai-save').disabled = true;
  $('#btn-ai-stop').hidden = false;
  streamChat(
    [{ role: 'system', content: sysMsg }, { role: 'user', content: origin }],
    (full) => { setResult(resultEl, full); state.lastResult = full; },
    () => { $('#btn-ai-stop').hidden = true; $('#btn-ai-copy').disabled = false; $('#btn-ai-save').disabled = false; },
    (err) => { setResult(resultEl, '⚠️ 出错：' + err); $('#btn-ai-stop').hidden = true; }
  );
}

/* 迭代 */
function runIterate() {
  const base = state.lastResult || $('#ai-origin').value.trim();
  const extra = $('#it-extra').value.trim();
  if (!base) { toast('没有可迭代的内容'); return; }
  $('#it-base').value = base;
  const resultEl = $('#it-result');
  setResult(resultEl, '');
  $('#btn-it-copy').disabled = true; $('#btn-it-save').disabled = true;
  streamChat(
    [{ role: 'system', content: SYS.basic },
     { role: 'user', content: '以下是我已有的提示词：\n\n' + base + (extra ? '\n\n请在此基础上按以下补充需求继续优化：' + extra : '\n\n请进一步优化它，使其更完善。') }],
    (full) => { setResult(resultEl, full); state.lastResult = full; },
    () => { $('#btn-it-copy').disabled = false; $('#btn-it-save').disabled = false; },
    (err) => setResult(resultEl, '⚠️ 出错：' + err)
  );
}

/* 翻译 */
function runTranslate() {
  const origin = $('#tr-origin').value.trim();
  if (!origin) { toast('请先填写原文'); return; }
  const sys = SYS.translate + (trDir === 'zh2en' ? '\n任务：将下面的中文翻译为英文。' : '\n任务：将下面的英文翻译为中文。');
  const resultEl = $('#tr-result');
  setResult(resultEl, '');
  $('#btn-tr-copy').disabled = true; $('#btn-tr-save').disabled = true;
  streamChat(
    [{ role: 'system', content: sys }, { role: 'user', content: origin }],
    (full) => { setResult(resultEl, full); state.lastResult = full; },
    () => { $('#btn-tr-copy').disabled = false; $('#btn-tr-save').disabled = false; },
    (err) => setResult(resultEl, '⚠️ 出错：' + err)
  );
}

/* 灵感胶囊 */
function runInspire() {
  const idea = $('#insp-input').value.trim();
  if (!idea) { toast('先写一句话想法'); return; }
  const domain = $('#insp-domain').value;
  const resultEl = $('#insp-result');
  setResult(resultEl, '');
  $('#btn-insp-copy').disabled = true; $('#btn-insp-save').disabled = true;
  streamChat(
    [{ role: 'system', content: SYS.inspire },
     { role: 'user', content: '领域：' + domain + '\n想法：' + idea }],
    (full) => { setResult(resultEl, full); state.lastResult = full; },
    () => { $('#btn-insp-copy').disabled = false; $('#btn-insp-save').disabled = false; },
    (err) => setResult(resultEl, '⚠️ 出错：' + err)
  );
}

/* 保存 AI 结果为新提示词 */
async function saveResultAsPrompt(text, fallbackTitle) {
  if (!text) return;
  const title = (text.split('\n').find(l => l.trim()) || fallbackTitle || 'AI 生成提示词').replace(/^#+\s*/, '').slice(0, 60);
  const { item } = await api('/api/prompts', { method: 'POST', body: JSON.stringify({ title, content: text, category: '通用', tags: ['AI生成'] }) });
  state.items.unshift(item);
  // 确保用户一定看得到新卡片：切回「全部」、清空搜索、滚到顶部
  state.view = 'all';
  state.category = '全部';
  state.search = '';
  $('#search').value = '';
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === 'all'));
  renderSidebar();
  renderPills();
  renderCards();
  const grid = $('#grid');
  if (grid) grid.scrollTop = 0;
  toast('已保存到知识库（已加入「全部」顶部）');
}

/* ---------------- 导入 / 导出 ---------------- */
function exportJson() {
  window.location.href = '/api/prompts/export';
}
async function importJson(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await api('/api/prompts/import', { method: 'POST', body: JSON.stringify({ items: data, mode: 'merge' }) });
    await loadItems();
    toast('导入成功（已合并）');
  } catch (e) { toast('导入失败：' + e.message); }
}

/* ---------------- 模型配置 ---------------- */
function openModelCfg() {
  const c = getCfg();
  $('#cfg-main-model').value = c.mainModel;
  $('#cfg-main-preset').value = c.mainPreset;
  $('#cfg-main-base').value = c.mainBase; $('#cfg-main-key').value = c.mainKey;
  $('#cfg-sub-model').value = c.subModel;
  $('#cfg-sub-preset').value = c.subPreset;
  $('#cfg-sub-base').value = c.subBase; $('#cfg-sub-key').value = c.subKey;
  $('#cfg-temp').value = c.temp; $('#cfg-temp-val').textContent = (+c.temp).toFixed(2);
  $('#cfg-maxtok').value = c.maxTok; $('#cfg-maxtok-val').textContent = c.maxTok;
  toggleCustom();
  showModal('modal-model');
}
function toggleCustom() {
  $$('.cfg-block').forEach(block => {
    const sel = block.querySelector('.select');
    if (!sel) return;
    const customRow = block.querySelector('.custom-only');
    if (customRow) customRow.hidden = sel.value !== 'custom';
  });
}
function saveModelCfg() {
  const c = getCfg();
  c.mainModel = $('#cfg-main-model').value.trim() || 'deepseek-v4.1-flash';
  c.mainPreset = $('#cfg-main-preset').value;
  c.mainBase = $('#cfg-main-base').value.trim();
  c.mainKey = $('#cfg-main-key').value.trim();
  c.subModel = $('#cfg-sub-model').value.trim();
  c.subPreset = $('#cfg-sub-preset').value;
  c.subBase = $('#cfg-sub-base').value.trim();
  c.subKey = $('#cfg-sub-key').value.trim();
  c.temp = +$('#cfg-temp').value;
  c.maxTok = +$('#cfg-maxtok').value;
  setCfg(c);
  toast('模型配置已保存');
  hideModal('modal-model');
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  $('#btn-new').onclick = () => openEdit(null);
  $('#btn-save').onclick = saveEdit;
  $('#f-content').addEventListener('input', updateCounter);
  $('#btn-ai-workbench').onclick = () => { const c = $('#f-content').value; hideModal('modal-edit'); openAI(c); };

  $$('.nav-item').forEach(b => b.onclick = () => setView(b.dataset.view));

  // 搜索
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderCards(); });
  // Ctrl/Cmd + I 聚焦搜索
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
    if (e.key === 'Escape') { $$('.modal').forEach(m => m.hidden = true); closePopMenu(); }
  });

  // 主题切换（浅色 / 深色）
  $('#btn-theme').onclick = cycleTheme;

  // 导入导出
  $('#btn-export').onclick = exportJson;
  $('#btn-import').onclick = () => $('#file-input').click();
  $('#file-input').addEventListener('change', (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });

  // AI 工作台 tabs / segs
  $$('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $$('#opt-modes .seg-btn').forEach(b => b.onclick = () => {
    $$('#opt-modes .seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); aiMode = b.dataset.mode;
  });
  $$('#tr-dir .seg-btn').forEach(b => b.onclick = () => {
    $$('#tr-dir .seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); trDir = b.dataset.dir;
  });
  $('#btn-ai-run').onclick = runOptimize;
  $('#btn-ai-stop').onclick = () => { if (streamCtrl) streamCtrl.abort(); };
  $('#btn-it-run').onclick = runIterate;
  $('#btn-tr-run').onclick = runTranslate;
  $('#btn-ai-copy').onclick = () => copyText($('#ai-result').textContent);
  $('#btn-ai-save').onclick = () => saveResultAsPrompt(state.lastResult, 'AI 优化结果');
  $('#btn-it-copy').onclick = () => copyText($('#it-result').textContent);
  $('#btn-it-save').onclick = () => saveResultAsPrompt($('#it-result').textContent, 'AI 迭代结果');
  $('#btn-tr-copy').onclick = () => copyText($('#tr-result').textContent);
  $('#btn-tr-save').onclick = () => saveResultAsPrompt($('#tr-result').textContent, 'AI 译文');

  // 灵感胶囊
  $('#btn-inspire').onclick = () => { setResult($('#insp-result'), ''); $('#btn-insp-copy').disabled = true; $('#btn-insp-save').disabled = true; showModal('modal-inspire'); };
  $('#btn-insp-run').onclick = runInspire;
  $('#btn-insp-copy').onclick = () => copyText($('#insp-result').textContent);
  $('#btn-insp-save').onclick = () => saveResultAsPrompt($('#insp-result').textContent, '灵感胶囊产出');

  // 模型配置
  $('#btn-model').onclick = openModelCfg;
  $('#btn-cfg-save').onclick = saveModelCfg;
  $$('.cfg-block .select').forEach(s => s.addEventListener('change', toggleCustom));
  $('#cfg-temp').addEventListener('input', (e) => $('#cfg-temp-val').textContent = (+e.target.value).toFixed(2));
  $('#cfg-maxtok').addEventListener('input', (e) => $('#cfg-maxtok-val').textContent = e.target.value);
}

/* ---------------- 启动 ---------------- */
(function init() {
  applyTheme(localStorage.getItem('pe_theme') || 'light');
  bindEvents();
  initAurora();
  loadItems().catch(e => toast('加载失败：' + e.message));
})();
