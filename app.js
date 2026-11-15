'use strict';
// ─────────────────────────────────────────────────────────────
// 群聊 AI · 单文件客户端
// 数据全在浏览器 localStorage，不发往任何第三方服务器
// ─────────────────────────────────────────────────────────────

const LS_KEY = 'ac.app.v2';

// 常见 provider 预设（baseUrl 不含 /chat/completions）
const PRESETS = {
  deepseek:  { name: 'DeepSeek',   emoji: '🐳', color: '#1f6feb', type: 'openai',    baseUrl: 'https://api.deepseek.com/v1',                          models: ['deepseek-chat', 'deepseek-reasoner'], effort: ['low','medium','high'] },
  qwen:      { name: '通义千问',    emoji: '🅠', color: '#6b4ce6', type: 'openai',    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',   models: ['qwen3.8-max', 'qwen3.8-flash'], effort: [] },
  kimi:      { name: 'Kimi',       emoji: '🌙', color: '#2b3a67', type: 'openai',    baseUrl: 'https://api.moonshot.cn/v1',                          models: ['kimi-k3.1-pro', 'kimi-k2.6'], effort: [] },
  glm:       { name: 'GLM',        emoji: '✨', color: '#7a5cff', type: 'openai',    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                models: ['glm-5.3', 'glm-4.7', 'glm-5.3-flash'], effort: ['low','medium','high'] },
  openai:    { name: 'OpenAI',     emoji: '⬤', color: '#10a37f', type: 'openai',    baseUrl: 'https://api.openai.com/v1',                           models: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini'], effort: ['low','medium','high'] },
  anthropic: { name: 'Claude',     emoji: '🧠', color: '#c96442', type: 'anthropic', baseUrl: 'https://api.anthropic.com',                           models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], effort: [] },
  gemini:    { name: 'Gemini',     emoji: '✦', color: '#4285f4', type: 'openai',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], effort: [] },
  openrouter:{ name: 'OpenRouter', emoji: '🔀', color: '#5a5a5a', type: 'openai',    baseUrl: 'https://openrouter.ai/api/v1',                        models: ['deepseek/deepseek-chat'], effort: [] },
  groq:      { name: 'Groq',       emoji: '⚡', color: '#f55036', type: 'openai',    baseUrl: 'https://api.groq.com/openai/v1',                      models: ['llama-3.3-70b-versatile'], effort: [] },
  grok:      { name: 'Grok',       emoji: '✕', color: '#1a1a1a', type: 'openai',    baseUrl: 'https://api.x.ai/v1',                                 models: ['grok-4', 'grok-3-mini'], effort: [] },
  custom:    { name: '自定义',      emoji: '◆', color: '#6b7280', type: 'openai',    baseUrl: 'https://',                                            models: [], effort: [] },
};

// 内置头像：按 baseUrl 认模型，图在 ./avatars/ 下（没有图就自动回落到 emoji）
const PRESET_AVATARS = {
  deepseek:  'avatars/deepseek.jpg',
  qwen:      'avatars/qwen.jpg',
  kimi:      'avatars/kimi.jpg',
  glm:       'avatars/glm.jpg',
  openai:    'avatars/gpt.jpg',
  anthropic: 'avatars/claude.jpg',
  gemini:    'avatars/gemini.jpg',
  grok:      'avatars/grok.jpg',
};

const AVATAR_HINTS = [
  [/api\.deepseek\.com|deepseek/i, 'deepseek'],
  [/dashscope|aliyuncs|qwen|通义/i, 'qwen'],
  [/moonshot|kimi/i, 'kimi'],
  [/bigmodel|zhipu|glm|智谱/i, 'glm'],
  [/api\.openai\.com|openai/i, 'openai'],
  [/anthropic|claude/i, 'anthropic'],
  [/generativelanguage|gemini/i, 'gemini'],
  [/api\.x\.ai|\bxai\b|grok/i, 'grok'],
];

function avatarKeyOf(p) {
  if (!p) return '';
  const hay = String(p.baseUrl || '') + ' ' + String(p.name || '');
  for (const [re, key] of AVATAR_HINTS) if (re.test(hay)) return key;
  return '';
}

function presetAvatarUrl(p) {
  const key = avatarKeyOf(p);
  return key ? (PRESET_AVATARS[key] || '') : '';
}

// 粗估价格（¥ / 百万 token），仅供显示，不参与计费
const PRICE = {
  'deepseek-chat':     { in: 2.0,  out: 8.0 },
  'deepseek-reasoner': { in: 4.0,  out: 16.0 },
  default:             { in: 2.0,  out: 8.0 },
};

const EFFORTS = ['none', 'low', 'medium', 'high', 'max'];

// ── 状态 ─────────────────────────────────────────────────────
let S = load();

function defaultState() {
  return {
    providers: [],           // {id,name,type,baseUrl,apiKey,models:[]}
    sessions: [],
    activeId: null,
    lastModelKey: null,
    plugins: [],
    templates: [],           // 群聊模板 {id,name,members:[key],hostKey}
    provStatus: {},          // {providerId: {ok:boolean, at:number, msg:string}}
    params: { effort: 2, temp: 0.7, maxTokens: 2000, rounds: 'auto' },
    pricing: { ...PRICE },
  };
}
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const st = Object.assign(defaultState(), JSON.parse(raw)); st.plugins = st.plugins || []; st.templates = st.templates || []; st.provStatus = st.provStatus || {}; return st; }
  } catch (e) {
    console.warn('读本地数据失败', e);
  }
  return defaultState();
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(S)); }

const $ = (sel) => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);

// ── 会话 ─────────────────────────────────────────────────────
function newSession(mode = 'single') {
  const s = {
    id: uid(), title: '新对话', mode,
    members: S.lastModelKey ? [{ key: S.lastModelKey }] : [],   // [{key:'pid::model'}]
    hostKey: null,          // "providerId::model"
    messages: [],           // {role:'user'|'assistant', who, content, round, cost, ms, err}
    cost: 0, reqs: 0,
    createdAt: Date.now(),
  };
  S.sessions.unshift(s);
  S.activeId = s.id;
  save();
  return s;
}
const active = () => S.sessions.find((x) => x.id === S.activeId);

function ensureSession() {
  let s = active();
  if (!s) s = newSession('single');
  return s;
}

// ── 提供商 ───────────────────────────────────────────────────
function providerById(id) { return S.providers.find((p) => p.id === id); }
function allModelOptions() {
  const out = [];
  for (const p of S.providers) for (const m of p.models) out.push({ providerId: p.id, model: m, key: p.id + '::' + m });
  return out;
}
function labelOf(key) {
  const [pid, model] = key.split('::');
  const p = providerById(pid);
  return (p ? p.name : pid) + ' / ' + model;
}

// ── 渲染 ─────────────────────────────────────────────────────
function render() {
  const s = active();
  renderSessions();
  $('#title').textContent = s ? s.title : '新对话';
  document.querySelectorAll('.mode-switch button').forEach((b) => {
    b.classList.toggle('on', s && b.dataset.mode === s.mode);
  });
  $('#member-count').textContent = s ? s.members.length : 0;
  renderChat(s);
  renderPanel(s);
  $('#stat-cost').textContent = '¥' + (s ? s.cost : 0).toFixed(4);
  $('#stat-req').textContent = s ? s.reqs : 0;
  const ctxTok = s ? s.messages.reduce((n, m) => n + estimateTokens(m.content || ''), 0) : 0;
  $('#stat-ctx').textContent = ctxTok > 1000 ? (ctxTok / 1000).toFixed(1) + 'K tok' : ctxTok + ' tok';
  $('#stat-ctx').style.color = ctxTok > 90000 ? 'var(--err)' : '';
}

function renderSessions() {
  const box = $('#sessions');
  box.innerHTML = '';
  const q = (($('#sess-search') || {}).value || '').trim().toLowerCase();
  const list = q ? S.sessions.filter((s) => matchesQuery(s, q)) : S.sessions;
  if (q && !list.length) box.innerHTML = '<p class="hint" style="padding:8px">没有匹配的会话</p>';
  for (const s of list) {
    const d = document.createElement('div');
    d.className = 'sess' + (s.id === S.activeId ? ' on' : '');
    const tag = document.createElement('span');
    tag.className = 'tag' + (s.mode === 'group' ? ' group' : '');
    tag.textContent = s.mode === 'group' ? '群' : '单';
    const t = document.createElement('span');
    t.textContent = s.title;
    t.style.flex = '1';
    t.style.overflow = 'hidden'; t.style.textOverflow = 'ellipsis';
    t.title = '双击改名';
    const ren = document.createElement('button');
    ren.className = 'sess-btn';
    ren.textContent = '✎';
    ren.title = '改名';
    ren.onclick = (e) => { e.stopPropagation(); renameSession(s); };
    const del = document.createElement('button');
    del.className = 'sess-btn del';
    del.textContent = '×';
    del.title = '删除这个会话';
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirm('删掉「' + s.title + '」？删了就找不回来了。')) return;
      const i = S.sessions.indexOf(s);
      if (i >= 0) S.sessions.splice(i, 1);
      if (S.activeId === s.id) S.activeId = S.sessions[0]?.id || null;
      save(); render();
    };
    d.append(tag, t, ren, del);
    d.onclick = () => { S.activeId = s.id; save(); render(); };
    d.ondblclick = (e) => { e.stopPropagation(); renameSession(s); };
    box.append(d);
  }
}

// 搜索：标题或任意消息内容命中
function matchesQuery(s, q) {
  if ((s.title || '').toLowerCase().includes(q)) return true;
  return (s.messages || []).some((m) => (m.content || '').toLowerCase().includes(q));
}


// ── 群聊模板 ─────────────────────────────────────────────────
function saveTemplate() {
  const s = active();
  if (!s || !s.members.length) { alert('先建一个群聊、把成员加好，再来存模板。'); return; }
  const name = prompt('给这个群聊组合起个名字', (s.title || '群聊') + '组合');
  if (name === null) return;
  const v = name.trim();
  if (!v) return;
  S.templates = S.templates || [];
  S.templates.unshift({ id: uid(), name: v.slice(0, 40), members: s.members.map((m) => ({ ...m })), hostKey: s.hostKey || null });
  save();
  toast('存好了：' + v);
  openTemplates();
}

function applyTemplate(t) {
  const s = newSession('group');
  s.members = t.members.map((m) => ({ ...m }));
  s.hostKey = t.hostKey || null;
  s.title = t.name;
  save();
  closeModal();
  render();
  toast('开好了：' + t.name);
}

function openTemplates() {
  const s = active();
  let box = document.querySelector('#modal .tpl-list');
  if (!box) return;
  box.innerHTML = '';
  if (!S.templates.length) {
    box.innerHTML = '<p class="hint">还没有模板。把当前群聊的成员配好，点下面的「存当前群聊」。</p>';
  }
  for (const t of S.templates) {
    const row = document.createElement('div');
    row.className = 'tpl-row';
    const name = document.createElement('b');
    name.textContent = t.name;
    const who = document.createElement('span');
    who.className = 'hint';
    who.textContent = t.members.map((m) => labelOf(m.key)).join('、');
    const use = document.createElement('button');
    use.textContent = '用这个';
    use.onclick = () => applyTemplate(t);
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '删';
    del.onclick = () => {
      if (!confirm('删掉模板「' + t.name + '」？')) return;
      S.templates = S.templates.filter((x) => x.id !== t.id);
      save(); openTemplates();
    };
    row.append(name, who, use, del);
    box.append(row);
  }
}

function openTemplateModal() {
  openModal('群聊模板', `
    <p class="hint">存一套成员和群主，下次一键开同样的群聊。</p>
    <div class="tpl-list"></div>
    <div class="row" style="margin-top:12px">
      <button id="btn-tpl-save">存当前群聊</button>
      <button id="btn-tpl-new">新建群聊</button>
    </div>`);
  document.querySelector('#btn-tpl-save').onclick = saveTemplate;
  document.querySelector('#btn-tpl-new').onclick = () => { closeModal(); newSession('group'); render(); };
  openTemplates();
}

// ── 提供商连通状态 ───────────────────────────────────────────
function statusDot(pid) {
  const st = (S.provStatus || {})[pid];
  if (!st) return '○';
  return st.ok ? '●' : '✕';
}
function statusTitle(pid) {
  const st = (S.provStatus || {})[pid];
  if (!st) return '还没测过连通性';
  return (st.ok ? '上次测通了' : '上次没测通') + '（' + new Date(st.at).toLocaleString() + '）' + (st.msg ? '：' + st.msg : '');
}

function renameSession(s) {
  const name = prompt('给这个会话起个名字', s.title);
  if (name === null) return;
  const v = name.trim();
  if (!v) return;
  s.title = v.slice(0, 60);
  save(); render();
}

function welcomeCard(s) {
  const box = document.createElement('div');
  box.className = 'welcome';
  const hasProv = S.providers.length > 0;
  const withKey = S.providers.filter((p) => p.apiKey).length;

  if (!hasProv || !withKey) {
    box.innerHTML = `
      <h2>还差一步</h2>
      <p class="sub">加一个模型提供商，填上密钥，就能开始了。</p>
      <ol>
        <li><b>加提供商</b>——点下面的按钮，选 DeepSeek / 千问 / Kimi / GLM，地址和模型名会自动填好</li>
        <li><b>粘贴密钥</b>——只剩这一个框要你填</li>
        <li><b>关掉弹窗，直接在下面说话</b></li>
      </ol>
      <button class="btn" id="wc-open">打开设置</button>
      <p class="sub small">密钥只存在这台电脑的浏览器里，不上传</p>`;
    setTimeout(() => { const b = box.querySelector('#wc-open'); if (b) b.onclick = openSettings; }, 0);
    return box;
  }

  const opts = allModelOptions();
  const samples = ['帮我解释一下量子纠缠，用高中生听得懂的话', '这段代码为什么报空指针，我贴给你', '写个一百字的自我介绍，别用形容词'];
  box.innerHTML = `
    <h2>准备好了</h2>
    <p class="sub">已配置 ${S.providers.length} 个提供商，${opts.length} 个模型可用。</p>
    <p class="sub">想开群聊：点右上「群聊」，加 2 个成员，选一个群主，然后提问——群主会主持讨论、最后给结论。</p>
    <div class="samples"></div>`;
  const wrap = box.querySelector('.samples');
  for (const q of samples) {
    const b = document.createElement('button');
    b.className = 'sample';
    b.textContent = q;
    b.onclick = () => { $('#input').value = q; send(); };
    wrap.append(b);
  }
  return box;
}

function renderChat(s) {
  const box = $('#chat');
  box.innerHTML = '';
  if (!s || !s.messages.length) {
    box.append(welcomeCard(s));
    return;
  }
  let lastRound = 0;
  for (const m of s.messages) {
    if (m.round && m.round !== lastRound && s.mode === 'group') {
      lastRound = m.round;
      const sep = document.createElement('div');
      sep.className = 'round-sep';
      sep.textContent = '第 ' + m.round + ' 轮';
      box.append(sep);
    }
    box.append(renderMsg(m, s));
  }
  box.scrollTop = box.scrollHeight;
}


// ── 头像：优先用自己上传的图，否则用预设 emoji + 品牌色 ──────────
const MODEL_EMOJI = [
  [/deepseek/i, '🐳'], [/qwen|通义/i, '🅠'], [/kimi|moonshot/i, '🌙'],
  [/glm|智谱|chatglm/i, '✨'], [/gpt|openai/i, '⬤'], [/claude|anthropic/i, '🧠'],
  [/gemini/i, '✦'], [/llama|groq/i, '⚡'], [/openrouter/i, '🔀'],
];

function providerOfMessage(m) {
  if (m.pid) {
    const p = providerById(m.pid);
    if (p) return p;
  }
  // 老消息没有 pid：按模型名反查
  const model = String(m.model || '');
  if (model) {
    const hit = S.providers.find((p) => (p.models || []).some((x) => x === model || model.endsWith('/' + x)));
    if (hit) return hit;
  }
  return null;
}

function avatarSpec(m) {
  if (m.role === 'user') return { emoji: '🙂', color: '#3a4250', name: '我' };
  const p = providerOfMessage(m);
  if (p) return { img: p.avatar || presetAvatarUrl(p), emoji: p.emoji || guessEmoji(p.name), color: p.color || '#39414d', name: p.name };
  return { emoji: guessEmoji(m.model || m.who), color: '#39414d', name: m.who || '' };
}

function guessEmoji(text) {
  const s = String(text || '');
  for (const [re, emo] of MODEL_EMOJI) if (re.test(s)) return emo;
  return '◆';
}

function avatarEl(m) {
  const spec = avatarSpec(m);
  const el = document.createElement('div');
  el.className = 'ava';
  el.style.background = spec.color;
  el.title = spec.name || '';
  if (spec.img) {
    const img = document.createElement('img');
    img.src = spec.img;
    img.alt = spec.name || '';
    // 图丢了（仓库里没带图、或被删了）就退回 emoji，别显示破图标
    img.onerror = () => {
      img.remove();
      el.textContent = spec.emoji;
    };
    el.append(img);
  } else {
    el.textContent = spec.emoji;
  }
  return el;
}

// 把用户选的图压成 128×128 的 jpeg，省 localStorage
function shrinkImage(file, size = 128) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读不了这个文件'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('这不是能显示的图片'));
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        const ctx = cv.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderMsg(m, s) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (m.role === 'user' ? 'user' : '') + (m.err ? ' err' : '');
  const who = document.createElement('div');
  who.className = 'who';
  const nameEl = document.createElement('div');
  nameEl.className = 'who-name';
  nameEl.textContent = m.who || (m.role === 'user' ? '我' : 'AI');
  who.append(avatarEl(m), nameEl);
  const body = document.createElement('div');
  body.className = 'body';

  if (m.role !== 'user') {
    const meta = document.createElement('div');
    meta.className = 'meta';
    const isHost = m.isHost;
    const badge = document.createElement('span');
    badge.className = 'badge' + (isHost ? ' host' : '');
    badge.textContent = isHost ? '群主' : '成员';
    if (s.mode === 'group') meta.append(badge);
    const info = document.createElement('span');
    info.textContent = [m.model, m.round ? 'R' + m.round : '', m.ms ? (m.ms / 1000).toFixed(1) + 's' : '', m.cost ? '¥' + m.cost.toFixed(4) : '']
      .filter(Boolean).join(' · ');
    meta.append(info);
    body.append(meta);
  }

  const c = document.createElement('div');
  c.className = 'content' + (m.role === 'user' ? '' : ' rich');
  if (m.role === 'user') c.textContent = m.content || '';
  else c.append(...formatRich(m.content || ''));
  body.append(c);

  // 悬浮操作
  const acts = document.createElement('div');
  acts.className = 'acts';
  if (m.role === 'user') {
    const b = document.createElement('button');
    b.textContent = '重发';
    b.onclick = () => resendFrom(m.id);
    acts.append(b);
  } else if (!m.isHost) {
    const b = document.createElement('button');
    b.textContent = '重新生成';
    b.onclick = () => regenerateFrom(m.id);
    acts.append(b);
  }
  if (acts.children.length) body.append(acts);

  wrap.append(who, body);
  return wrap;
}

// ── 轻量 Markdown：代码块 / 行内代码 / 粗体 ───────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatRich(text) {
  const nodes = [];
  const parts = String(text).split(/```/);
  parts.forEach((seg, i) => {
    if (i % 2 === 1) {
      // 代码块：第一行可能是语言名
      const nl = seg.indexOf('\n');
      let lang = '', code = seg;
      if (nl > -1 && nl < 20 && /^[\w+#.-]*$/.test(seg.slice(0, nl).trim())) {
        lang = seg.slice(0, nl).trim();
        code = seg.slice(nl + 1);
      }
      nodes.push(codeBlock(code.replace(/\n$/, ''), lang));
    } else if (seg.trim()) {
      nodes.push(inlineBlock(seg));
    }
  });
  if (!nodes.length) nodes.push(document.createTextNode(''));
  return nodes;
}

function codeBlock(code, lang) {
  const box = document.createElement('div');
  box.className = 'code';
  const head = document.createElement('div');
  head.className = 'code-head';
  const name = document.createElement('span');
  name.textContent = lang || 'code';
  const btn = document.createElement('button');
  btn.textContent = '复制';
  btn.onclick = async () => {
    try { await navigator.clipboard.writeText(code); btn.textContent = '已复制'; }
    catch { btn.textContent = '复制失败'; }
    setTimeout(() => (btn.textContent = '复制'), 1500);
  };
  head.append(name, btn);
  const pre = document.createElement('pre');
  const el = document.createElement('code');
  el.textContent = code;
  pre.append(el);
  box.append(head, pre);
  return box;
}

function inlineBlock(seg) {
  const div = document.createElement('div');
  div.className = 'para';
  // 先转义，再把 `code` 与 **bold** 换成标签（内容已转义，安全）
  let html = escapeHtml(seg);
  html = html.replace(/`([^`\n]+)`/g, '<code class="inl">$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  div.innerHTML = html;
  return div;
}

function renderPanel(s) {
  // 单聊模型选择
  const ms = $('#sel-model');
  if (ms) {
    ms.innerHTML = '';
    const opts = allModelOptions();
    if (!opts.length) {
      ms.innerHTML = '<option>（没有模型）</option>';
    } else {
      for (const o of opts) {
        const op = document.createElement('option');
        op.value = o.key;
        op.textContent = o.model;
        const cur = s && s.members[0] ? s.members[0].key : S.lastModelKey;
        if (cur ? cur === o.key : o === opts[0]) op.selected = true;
        ms.append(op);
      }
    }
  }

  $('#rg-effort').value = S.params.effort;
  $('#out-effort').textContent = EFFORTS[S.params.effort];
  $('#rg-temp').value = S.params.temp;
  $('#out-temp').textContent = S.params.temp.toFixed(1);
  $('#rg-max').value = S.params.maxTokens;
  $('#out-max').textContent = S.params.maxTokens;
  $('#sel-rounds').value = S.params.rounds;

  const sel = $('#sel-host');
  sel.innerHTML = '';
  const opts = allModelOptions();
  if (!opts.length) { sel.innerHTML = '<option>（先加模型）</option>'; return; }
  for (const o of opts) {
    const op = document.createElement('option');
    op.value = o.key; op.textContent = labelOf(o.key);
    if (s && s.hostKey === o.key) op.selected = true;
    sel.append(op);
  }
}

// ── 调用模型 ─────────────────────────────────────────────────
function priceOf(model) {
  return S.pricing[model] || S.pricing.default;
}

async function callModel({ providerId, model, messages, effort, temp, maxTokens }, onDelta) {
  const p = providerById(providerId);
  if (!p) throw new Error('找不到这个提供商配置');
  if (!p.apiKey) throw new Error(p.name + ' 没有填密钥');
  const t0 = performance.now();

  if (p.type === 'anthropic') {
    const url = apiUrl(p, 'anthropic');
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': p.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: temp,
        stream: true,
        system: '你是与会者之一。直接给答案，不要客套。',
        messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
      signal: currentAC ? currentAC.signal : undefined,
    });
    if (!r.ok) throw new Error(await httpErr(r, url));
    return await readSSE(r, (obj) => {
      if (obj.type === 'content_block_delta' && obj.delta?.text) return obj.delta.text;
      return '';
    }, t0, model);
  }

  // OpenAI 兼容
  const body = {
    model,
    messages,
    temperature: temp,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (p.supportsEffort && effort && effort !== 'none') body.reasoning_effort = effort;

  const r = await fetch(apiUrl(p, 'openai'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.apiKey },
    body: JSON.stringify(body),
    signal: currentAC ? currentAC.signal : undefined,
  });
  if (!r.ok && r.status === 400 && body.stream_options) {
    // 有的国产接口不认 stream_options，去掉再来一次
    delete body.stream_options;
    const r2 = await fetch(apiUrl(p, 'openai'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.apiKey },
      body: JSON.stringify(body),
      signal: currentAC ? currentAC.signal : undefined,
    });
    if (!r2.ok) throw new Error(await httpErr(r2, apiUrl(p, 'openai')));
    return finishStream(r2);
  }
  if (!r.ok) throw new Error(await httpErr(r, apiUrl(p, 'openai')));

  return finishStream(r);

  async function finishStream(resp) {
    let usage = null;
    const text = await readSSE(resp, (obj) => {
      if (obj.usage) usage = obj.usage;
      const d = obj.choices?.[0]?.delta;
      return d?.content || '';
    }, t0, model, (u) => { usage = u; });

    const pr = priceOf(model);
    let cost;
    if (usage) cost = (usage.prompt_tokens / 1e6) * pr.in + (usage.completion_tokens / 1e6) * pr.out;
    else cost = (estimateTokens(messages.map((m) => m.content).join('')) / 1e6) * pr.in + (estimateTokens(text) / 1e6) * pr.out;

    return { text, cost, ms: performance.now() - t0 };
  }
}

function estimateTokens(str) { return Math.ceil(str.length / 2.2); }

async function httpErr(r, url) {
  let body = '';
  try { body = await r.text(); } catch {}
  const where = url ? `（${url}）` : '';
  if (r.status === 404) {
    return `HTTP 404 找不到接口${where} ${body.slice(0, 160)} ← 多半是「地址」写错了：只填到 /v1 为止，不要带 /chat/completions`;
  }
  if (r.status === 401 || r.status === 403) {
    return `HTTP ${r.status} 密钥不对或没权限${where} ${body.slice(0, 160)}`;
  }
  return `HTTP ${r.status}${where} ${body.slice(0, 200)}`;
}

// 拼接口地址：容忍用户把完整路径也填进去（/chat/completions、/v1/messages、末尾斜杠）
function apiUrl(p, kind) {
  let base = String(p.baseUrl || '').trim().replace(/\/+$/, '');
  base = base.replace(/\/(chat\/completions|completions|messages|responses)$/i, '');
  if (kind === 'anthropic') {
    if (/\/v1$/i.test(base)) base = base.replace(/\/v1$/i, '');
    return base + '/v1/messages';
  }
  return base + '/chat/completions';
}

async function readSSE(resp, pick, t0, model, onUsage) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '', out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }
      if (onUsage && obj.usage) onUsage(obj.usage);
      const piece = pick(obj);
      if (piece) { out += piece; }
    }
  }
  return out;
}

// ── 发送 ─────────────────────────────────────────────────────
let busy = false;
let currentAC = null;      // 当前请求的 AbortController，用来"停止生成"

function setSendButton(running) {
  const b = $('#btn-send');
  if (!b) return;
  b.textContent = running ? '停止' : '发送';
  b.classList.toggle('stop', running);
}

function stopRun() {
  if (currentAC) { try { currentAC.abort(); } catch (e) {} }
}

async function send() {
  if (busy) { stopRun(); return; }          // 生成中再点就是"停止"
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  await dispatch(text);
}

async function dispatch(text) {
  const s = ensureSession();
  if (s.mode === 'group' && !s.members.length) { alert('群聊还没加成员，点右上角「成员」'); return; }
  if (!S.providers.length) { alert('先去设置里加一个模型提供商'); openSettings(); return; }

  s.messages.push({ id: uid(), role: 'user', who: '我', content: text });
  if (s.title === '新对话') s.title = text.slice(0, 16);
  save(); render();
  await runPart(s, text);
}

async function runPart(s, text) {
  busy = true; setSendButton(true);
  currentAC = new AbortController();
  try {
    if (s.mode === 'single') await runSingle(s, text);
    else await runGroup(s, text);
  } catch (e) {
    if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')))) {
      toast('已停止');
    } else {
      s.messages.push({ id: uid(), role: 'assistant', who: '系统', content: '出错了：' + e.message, err: true });
    }
  } finally {
    busy = false; currentAC = null; setSendButton(false);
    save(); render();
  }
}

// 重发：把这条用户消息之后的全删掉，重新跑
async function resendFrom(id) {
  if (busy) return;
  const s = ensureSession();
  const i = s.messages.findIndex((m) => m.id === id);
  if (i < 0) return;
  const drop = s.messages.length - i - 1;
  if (drop > 0 && !confirm(`重发这条，会把后面的 ${drop} 条消息删掉（不可恢复）。确定？`)) return;
  const text = s.messages[i].content;
  s.messages = s.messages.slice(0, i);
  save(); render();
  s.messages.push({ id: uid(), role: 'user', who: '我', content: text });
  save(); render();
  await runPart(s, text);
}

// 重新生成：保留提问，删掉这条回答及其之后
async function regenerateFrom(id) {
  if (busy) return;
  const s = ensureSession();
  const i = s.messages.findIndex((m) => m.id === id);
  if (i < 0) return;
  let j = i - 1;
  while (j >= 0 && s.messages[j].role !== 'user') j--;
  if (j < 0) { alert('这条前面没有提问，没法重新生成'); return; }
  const drop = s.messages.length - i;
  if (drop > 0 && !confirm(`重新生成会删掉这条回答及其后的 ${drop} 条消息（不可恢复）。确定？`)) return;
  const text = s.messages[j].content;
  s.messages = s.messages.slice(0, j + 1);
  save(); render();
  await runPart(s, text);
}

function historyFor(s, upto) {
  // 把会话历史压成 [{role,content}]；群聊里别人的话用 "名字：内容" 形式以 user 身份注入
  const msgs = [];
  for (const m of s.messages) {
    if (m === upto) break;
    if (m.err) continue;
    if (m.role === 'user') msgs.push({ role: 'user', content: m.who === '我' ? m.content : (m.who + '：' + m.content) });
    else msgs.push({ role: 'assistant', content: m.content });
  }
  return msgs;
}

async function runSingle(s, text) {
  const key = s.members[0]?.key || allModelOptions()[0]?.key;
  if (!key) throw new Error('没有可用模型');
  const [providerId, model] = key.split('::');
  const p = providerById(providerId);
  const holder = { id: uid(), role: 'assistant', pid: providerId, who: p?.name || model, model, content: '', ms: 0, cost: 0 };
  s.messages.push(holder);
  const nodes = renderChat(s);
  const el = $('#chat');
  const live = appendLive(el, holder);

  const effort = EFFORTS[S.params.effort];
  const res = await callModel({
    providerId, model,
    messages: historyFor(s, holder),
    effort, temp: S.params.temp, maxTokens: S.params.maxTokens,
  }, (delta) => { live.textContent += delta; el.scrollTop = el.scrollHeight; });

  holder.content = res.text;
  holder.cost = res.cost; holder.ms = res.ms;
  s.cost += res.cost; s.reqs += 1;
  save(); render();
}

function appendLive(el, holder) {
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  wrap.innerHTML = `<div class="who"></div><div class="body"><div class="meta"></div><div class="content"></div></div>`;
  const whoBox = wrap.querySelector('.who');
  const nm = document.createElement('div');
  nm.className = 'who-name';
  nm.textContent = holder.who;
  whoBox.append(avatarEl(holder), nm);
  wrap.querySelector('.meta').textContent = [holder.model, '思考中…'].filter(Boolean).join(' · ');
  el.append(wrap);
  el.scrollTop = el.scrollHeight;
  return wrap.querySelector('.content');
}

// ── 群聊 ─────────────────────────────────────────────────────
async function runGroup(s, question) {
  const members = s.members.slice();
  const hostKey = s.hostKey || members[0]?.key;
  // 保证成员至少有一个
  if (!members.length) throw new Error('群聊成员为空');

  const roundsSetting = S.params.rounds;
  let rounds = roundsSetting === '2' ? 2 : 1;

  // 第 1 轮：各答各的（互相看不见）
  for (const m of members) {
    const [providerId, model] = m.key.split('::');
    const p = providerById(providerId);
    const holder = { id: uid(), role: 'assistant', pid: providerId, who: p?.name || model, model, content: '', round: 1, cost: 0, ms: 0 };
    s.messages.push(holder);
    const el = $('#chat');
    const live = appendLive(el, holder);
    try {
      const res = await callModel({
        providerId, model,
        messages: [
          ...historyFor(s, holder),
          { role: 'user', content: '（群聊）' + question + '\n\n给出你的答案，不要提及其他模型。' },
        ],
        effort: EFFORTS[S.params.effort], temp: S.params.temp, maxTokens: S.params.maxTokens,
      }, (d) => { live.textContent += d; el.scrollTop = el.scrollHeight; });
      holder.content = res.text; holder.cost = res.cost; holder.ms = res.ms;
      s.cost += res.cost; s.reqs += 1;
    } catch (e) {
      holder.content = `（${p?.name || ''}${p ? ' / ' : ''}${model} 没答上来）` + e.message;
      holder.err = true;
    }
    save(); render();
  }

  const round1 = s.messages.filter((m) => m.round === 1 && !m.err);
  if (!round1.length) throw new Error('第一轮全部失败');

  // 自动模式：问群主需不需要第二轮
  if (roundsSetting === 'auto' && round1.length > 1) {
    const judge = await askHostJson(s, hostKey, members,
      `下面是各模型对同一个问题的回答。判断它们之间是否存在实质分歧（结论不同或关键理由冲突）。\n\n` +
      round1.map((m) => `【${m.who} / ${m.model}】\n${m.content}`).join('\n\n') +
      `\n\n只输出 JSON，不要别的话：{"needRound2": true 或 false, "reason": "一句话"}`);
    if (judge?.needRound2) rounds = 2;
  }

  // 第 2 轮：互相看见，可反驳
  if (rounds === 2) {
    const transcript = round1.map((m) => `【${m.who} / ${m.model}】\n${m.content}`).join('\n\n');
    for (const m of members) {
      const [providerId, model] = m.key.split('::');
      const p = providerById(providerId);
      const holder = { id: uid(), role: 'assistant', pid: providerId, who: p?.name || model, model, content: '', round: 2, cost: 0, ms: 0 };
      s.messages.push(holder);
      const el = $('#chat');
      const live = appendLive(el, holder);
      try {
        const res = await callModel({
          providerId, model,
          messages: [
            { role: 'user', content: '（群聊）问题：' + question + '\n\n第一轮大家的回答：\n' + transcript + '\n\n现在看到别人的说法了。有人漏了什么、错在哪？如果改变结论就说改，不改就说清为什么。不要重复已经说过的。' },
          ],
          effort: EFFORTS[S.params.effort], temp: S.params.temp, maxTokens: S.params.maxTokens,
        }, (d) => { live.textContent += d; el.scrollTop = el.scrollHeight; });
        holder.content = res.text; holder.cost = res.cost; holder.ms = res.ms;
        s.cost += res.cost; s.reqs += 1;
      } catch (e) {
        holder.content = '（没接上）' + e.message; holder.err = true;
      }
      save(); render();
    }
  }

  // 群主总结
  const all = s.messages.filter((m) => (m.round === 1 || m.round === 2) && !m.err);
  const transcript = all.map((m) => `【${m.who} / ${m.model} · 第${m.round}轮】\n${m.content}`).join('\n\n');
  const [hp, hm] = hostKey.split('::');
  const hpObj = providerById(hp);
  const hostHolder = { id: uid(), role: 'assistant', pid: hp, who: (hpObj?.name || hm) + '（群主）', model: hm, content: '', isHost: true, cost: 0, ms: 0 };
  s.messages.push(hostHolder);
  const el = $('#chat');
  const live = appendLive(el, hostHolder);
  try {
    const res = await callModel({
      providerId: hp, model: hm,
      messages: [{ role: 'user', content:
        `你是这次讨论的主持人，不参与答题，只做裁判。\n\n用户的原始问题：${question}\n\n各模型发言：\n${transcript}\n\n请给出：\n1. 结论（一句话，能直接用的那种）\n2. 理由（两三句，说清为什么是这个结论）\n3. 分歧点（如果确实有）\n4. 保留意见（在什么条件下结论会变）\n\n不要复述过程，不要说"根据以上"。直接给。` }],
      effort: EFFORTS[S.params.effort], temp: 0.3, maxTokens: S.params.maxTokens,
    }, (d) => { live.textContent += d; el.scrollTop = el.scrollHeight; });
    hostHolder.content = res.text; hostHolder.cost = res.cost; hostHolder.ms = res.ms;
    s.cost += res.cost; s.reqs += 1;
  } catch (e) {
    hostHolder.content = '（群主总结失败）' + e.message; hostHolder.err = true;
  }
  save(); render();
}

async function askHostJson(s, hostKey, members, prompt) {
  const [hp, hm] = hostKey.split('::');
  try {
    const res = await callModel({ providerId: hp, model: hm, messages: [{ role: 'user', content: prompt }], effort: 'low', temp: 0, maxTokens: 200 });
    s.cost += res.cost; s.reqs += 1;
    const m = res.text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

// ── 设置弹窗 ─────────────────────────────────────────────────
function openModal(title, html, after) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  if (after) after();
}
function closeModal() { $('#modal').classList.add('hidden'); }

function openSettings() {
  const html = `
    <div id="prov-list"></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <select id="preset-sel" class="btn ghost" style="padding:8px">
        ${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
      </select>
      <button class="btn" id="btn-add-prov">加一个</button>
      <button class="btn ghost" id="btn-bulk-ava" title="一次选多张图，按文件名自动对应；对不上的会问你">批量导入头像</button>
    </div>
    <p class="hint" style="margin-top:14px">
      密钥只存在这台电脑的浏览器里（localStorage），不会上传。别在公共电脑上用，别把这个页面挂到公网上。
    </p>`;
  openModal('模型提供商', html, () => {
    renderProviders();
    $('#btn-bulk-ava').onclick = importAvatars;
    $('#btn-add-prov').onclick = () => {
      const k = $('#preset-sel').value;
      const p = PRESETS[k];
      S.providers.push({ id: uid(), name: p.name, type: p.type, baseUrl: p.baseUrl, apiKey: '', models: [...p.models], supportsEffort: p.effort.length > 0 });
      save(); renderProviders();
      // 光标直接落到刚加的密钥框
      const last = document.querySelectorAll('.prov');
      const box = last[last.length - 1];
      if (box) {
        const keyInput = box.querySelectorAll('.row')[2].querySelector('input');
        keyInput.focus();
        box.scrollIntoView({ block: 'nearest' });
      }
    };
  });
}

function renderProviders() {
  const box = $('#prov-list');
  if (!box) return;
  box.innerHTML = '';
  if (!S.providers.length) box.innerHTML = '<p class="hint">还没有提供商。下面选一个加进来。</p>';
  S.providers.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'prov';
    d.innerHTML = `
      <div class="row">
        <span class="pstat"></span>
        <input class="name" value="${esc(p.name)}" placeholder="名字">
        <select>
          <option value="openai" ${p.type === 'openai' ? 'selected' : ''}>OpenAI 兼容</option>
          <option value="anthropic" ${p.type === 'anthropic' ? 'selected' : ''}>Anthropic</option>
        </select>
        <button class="ava-btn">头像</button>
        <button class="test">测试</button>
        <button class="del">删除</button>
      </div>
      <div class="row"><input value="${esc(p.baseUrl)}" placeholder="接口地址 https://..."></div>
      <div class="row"><input type="password" value="${esc(p.apiKey)}" placeholder="API 密钥"></div>
      <div class="row"><input value="${esc(p.models.join(','))}" placeholder="模型名，逗号分隔"></div>
      <div class="models"></div>`;
    const stat = d.querySelector('.pstat');
    stat.textContent = statusDot(p.id);
    stat.title = statusTitle(p.id);
    stat.className = 'pstat ' + ((S.provStatus || {})[p.id] ? (S.provStatus[p.id].ok ? 'ok' : 'bad') : 'na');
    const [nameIn, typeSel] = d.querySelectorAll('.row')[0].querySelectorAll('input,select');
    const baseIn = d.querySelectorAll('.row')[1].querySelector('input');
    const keyIn = d.querySelectorAll('.row')[2].querySelector('input');
    const modelsIn = d.querySelectorAll('.row')[3].querySelector('input');
    nameIn.oninput = () => { p.name = nameIn.value; save(); renderPanel(active()); };
    typeSel.onchange = () => { p.type = typeSel.value; save(); };
    baseIn.oninput = () => { p.baseUrl = baseIn.value.trim(); save(); };
    keyIn.oninput = () => { p.apiKey = keyIn.value.trim(); save(); };
    modelsIn.oninput = () => { p.models = modelsIn.value.split(',').map((x) => x.trim()).filter(Boolean); save(); renderPanel(active()); };
    d.querySelector('.del').onclick = () => {
      if (!confirm('删掉 ' + p.name + ' ？')) return;
      S.providers.splice(i, 1);
      save(); renderProviders();
    };
    d.querySelector('.test').onclick = (e) => testProvider(p, e.target);
    d.querySelector('.ava-btn').onclick = () => pickAvatar(p);
    box.append(d);
  });
}



// 一次选多张图：文件名里带 deepseek / qwen / kimi / glm / gpt / claude / gemini 就自动对应，
// 对不上的弹框问你要给谁，留空跳过。
const AVA_ALIAS = {
  deepseek: ['deepseek', '鲸', 'whale'],
  qwen: ['qwen', 'tongyi', '千问', '通义'],
  kimi: ['kimi', 'moonshot', '月之暗面'],
  glm: ['glm', 'zhipu', '智谱', 'chatglm'],
  openai: ['openai', 'gpt', 'chatgpt'],
  anthropic: ['claude', 'anthropic'],
  gemini: ['gemini', '谷歌', 'bard'],
  groq: ['groq', 'llama'],
  openrouter: ['openrouter'],
};

function matchProviderByFile(p, fileName) {
  const n = String(fileName || '').toLowerCase();
  const names = [String(p.name || ''), String(p.id || '')].map((x) => x.toLowerCase()).filter(Boolean);
  if (names.some((x) => x && n.includes(x))) return true;
  for (const [key, words] of Object.entries(AVA_ALIAS)) {
    if (!names.includes(key) && !names.some((x) => x.includes(key))) continue;
    if (words.some((w) => n.includes(w))) return true;
  }
  return false;
}

function importAvatars() {
  if (!S.providers.length) { alert('先在下面加一个模型提供商'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.multiple = true;
  inp.onchange = async () => {
    const files = [...(inp.files || [])];
    if (!files.length) return;
    let done = 0;
    for (const file of files) {
      let p = S.providers.find((x) => matchProviderByFile(x, file.name));
      if (!p) {
        const menu = S.providers.map((x, i) => (i + 1) + '. ' + x.name).join('\n');
        const ans = prompt('「' + file.name + '」给哪个模型？输序号，留空跳过\n\n' + menu, '');
        if (!ans) continue;
        p = S.providers[Number(ans) - 1];
        if (!p) continue;
      }
      try {
        p.avatar = await shrinkImage(file, 160);
        done += 1;
      } catch (e) {
        console.warn('这张用不了', file.name, e);
      }
    }
    save(); renderProviders(); render();
    toast(done ? ('导入了 ' + done + ' 张头像') : '一张都没导入');
  };
  inp.click();
}

// 选一张图当这个提供商的脸；再点一次可以换，右键菜单式的"清除"放在提示里
function pickAvatar(p) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    try {
      const dataUrl = await shrinkImage(file);
      p.avatar = dataUrl;
      save(); renderProviders(); render();
      toast('头像已更新：' + p.name + '（想换就再点一次「头像」，想恢复 emoji 就点「清除头像」）');
    } catch (e) {
      alert('这张图用不了：' + e.message);
    }
  };
  inp.click();
  if (p.avatar) {
    // 已经有图时，给出清除入口，不打断当前选择
    setTimeout(() => {
      if (confirm('「' + p.name + '」已有头像。要清除这张图、改回 emoji 吗？\n\n点「确定」清除；点「取消」继续换图。')) {
        delete p.avatar;
        save(); renderProviders(); render();
        toast('已清除头像');
      }
    }, 60);
  }
}

// 用一个最小请求探活：能通就说明地址、密钥、模型名这三样没填错
async function testProvider(p, btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '测试中…';
  try {
    if (!p.apiKey) throw new Error('还没填密钥');
    if (!p.models || !p.models.length) throw new Error('还没填模型名');
    const model = p.models[0];
    const signal = AbortSignal.timeout(20000);
    if (p.type === 'anthropic') {
      const url = apiUrl(p, 'anthropic');
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': p.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: '嗨' }] }),
        signal,
      });
      if (!r.ok) throw new Error(await httpErr(r, url));
    } else {
      const url = apiUrl(p, 'openai');
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.apiKey },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: '嗨' }] }),
        signal,
      });
      if (!r.ok) throw new Error(await httpErr(r, url));
    }
    S.provStatus[p.id] = { ok: true, at: Date.now(), msg: '' }; save();
    toast('通了：' + p.name + ' / ' + model);
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? '等了 20 秒没响应（地址不通或被墙）' : e.message;
    S.provStatus[p.id] = { ok: false, at: Date.now(), msg: String(msg).slice(0, 120) }; save();
    alert('没通：' + p.name + '\n\n' + msg + '\n\n常见原因：密钥错、地址少了 /v1、模型名不存在。');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

function openMembers() {
  const s = ensureSession();
  const opts = allModelOptions();
  if (!opts.length) { alert('先去设置里加提供商'); return; }
  const rows = opts.map((o) => {
    const inGroup = s.members.some((m) => m.key === o.key);
    const isHost = s.hostKey === o.key;
    return `<div class="row" style="display:flex;gap:8px;align-items:center;margin:6px 0">
      <button class="chip ${inGroup ? 'in' : ''}" data-add="${o.key}">${inGroup ? '✓ 在群里' : '+ 加入'}</button>
      <button class="chip ${isHost ? 'host' : ''}" data-host="${o.key}">${isHost ? '群主' : '设为群主'}</button>
      <span style="font-size:12px;color:#9aa4b2">${esc(labelOf(o.key))}</span>
    </div>`;
  }).join('');
  openModal('群聊成员', `<p class="hint" style="margin-top:0">群主只主持和总结，不参与答题。建议 2~3 个成员。</p>${rows}`, () => {
    document.querySelectorAll('[data-add]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.add;
        const idx = s.members.findIndex((m) => m.key === k);
        if (idx >= 0) s.members.splice(idx, 1);
        else s.members.push({ key: k });
        if (!s.hostKey && s.members[0]) s.hostKey = s.members[0].key;
        save(); openMembers(); render();
      };
    });
    document.querySelectorAll('[data-host]').forEach((b) => {
      b.onclick = () => { s.hostKey = b.dataset.host; save(); openMembers(); render(); };
    });
  });
}

function esc(str) { return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ── 插件 ─────────────────────────────────────────────────────
// 插件格式：{ id, name, version, description, author, code }
// code 是一个 ES 模块，默认导出 function(api){ api.addCommand(id, title, fn) }
const pluginCommands = new Map();   // key: `${pid}:${cmdId}` → {pid, title, run}

const PLUGIN_WARNING = '第三方插件能看到这个页面里的一切，包括你填的 API 密钥。只安装你看得懂代码、或者信任来源的插件。装错了就卸载，或者点「停用」。';

// 内置示例（源码就在这儿，所见即所得）
const BUILTIN_PLUGINS = [
  {
    id: 'export-md', name: '导出会话为 Markdown', version: '1.0.0', author: '内置',
    description: '把当前会话导出成一个 .md 文件，方便存档或发给别人。',
    code: `export default function (api) {
  api.addCommand('export', '导出当前会话为 Markdown', () => {
    const s = api.session();
    if (!s || !s.messages.length) { api.toast('这个会话还是空的'); return; }
    const lines = ['# ' + s.title, ''];
    for (const m of s.messages) {
      const who = m.role === 'user' ? '我' : (m.who || 'AI');
      lines.push('## ' + who + (m.model ? ' · ' + m.model : ''));
      lines.push('');
      lines.push(m.content || '');
      lines.push('');
    }
    const blob = new Blob([lines.join('\\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (s.title || '会话').replace(/[\\\\/:*?"<>|]/g, '_') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
    api.toast('已导出');
  });
}`,
  },
  {
    id: 'session-stats', name: '会话统计', version: '1.0.0', author: '内置',
    description: '统计当前会话的消息数、字数、花费和每个模型的发言次数。',
    code: `export default function (api) {
  api.addCommand('stats', '查看当前会话统计', () => {
    const s = api.session();
    if (!s) { api.toast('没有会话'); return; }
    const byModel = {};
    let chars = 0;
    for (const m of s.messages) {
      chars += (m.content || '').length;
      const k = m.model || (m.role === 'user' ? '我' : '未知');
      byModel[k] = (byModel[k] || 0) + 1;
    }
    const rows = Object.entries(byModel).map(([k, v]) => k + '：' + v + ' 条').join('\\n');
    alert('消息 ' + s.messages.length + ' 条\\n字数 ' + chars + '\\n花费 ¥' + (s.cost || 0).toFixed(4) +
      '\\n请求 ' + (s.reqs || 0) + ' 次\\n\\n' + rows);
  });
}`,
  },
];

function openPlugins() {
  const html = `
    <p class="hint" style="margin-top:0;color:#ffb020">${esc(PLUGIN_WARNING)}</p>

    <div style="display:flex;gap:8px;margin:14px 0">
      <input id="plg-url" placeholder="插件地址（manifest.json 或 .js 的链接）" style="flex:1;background:#0f1115;color:#e6e9ef;border:1px solid #2a323d;border-radius:6px;padding:8px">
      <button class="btn" id="plg-install-url">从网址安装</button>
    </div>

    <h3 style="font-size:13px;color:#9aa4b2;margin:18px 0 8px">已安装</h3>
    <div id="plg-installed"></div>

    <h3 style="font-size:13px;color:#9aa4b2;margin:18px 0 8px">内置示例（源码在 app.js 里，可直接看）</h3>
    <div id="plg-builtin"></div>

    <h3 style="font-size:13px;color:#9aa4b2;margin:18px 0 8px">可用命令</h3>
    <div id="plg-cmds"></div>`;
  openModal('插件', html, () => {
    renderPlugins();
    $('#plg-install-url').onclick = () => {
      const url = $('#plg-url').value.trim();
      if (!url) return;
      installPluginFromUrl(url);
    };
  });
}

function renderPlugins() {
  // 已安装
  const inst = $('#plg-installed');
  inst.innerHTML = '';
  if (!S.plugins.length) inst.innerHTML = '<p class="hint">还没装任何插件。</p>';
  S.plugins.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'prov';
    row.innerHTML = `<div class="row"><b style="flex:1">${esc(p.name)} <span class="hint">v${esc(p.version || '0')} · ${esc(p.author || '未知')}</span></b></div>
      <div class="hint" style="margin:4px 0 8px">${esc(p.description || '')}</div>
      <div style="display:flex;gap:8px">
        <button class="chip ${p.enabled ? 'in' : ''}" data-toggle="${p.id}">${p.enabled ? '已启用' : '已停用'}</button>
        <button class="chip" data-del="${p.id}" style="border-color:#ff5c5c;color:#ff5c5c">卸载</button>
      </div>`;
    inst.append(row);
  });
  inst.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const p = S.plugins.find((x) => x.id === b.dataset.toggle);
      p.enabled = !p.enabled;
      save();
      refreshPluginCommands().then(() => { renderPlugins(); });
    };
  });
  inst.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      const p = S.plugins.find((x) => x.id === b.dataset.del);
      if (!p || !confirm('卸载「' + p.name + '」？')) return;
      S.plugins = S.plugins.filter((x) => x.id !== p.id);
      save();
      refreshPluginCommands().then(() => { renderPlugins(); });
    };
  });

  // 内置
  const bi = $('#plg-builtin');
  bi.innerHTML = '';
  BUILTIN_PLUGINS.forEach((p) => {
    const has = S.plugins.some((x) => x.id === p.id);
    const row = document.createElement('div');
    row.className = 'prov';
    row.innerHTML = `<div class="row"><b style="flex:1">${esc(p.name)}</b>
      <button class="chip ${has ? 'in' : ''}" ${has ? 'disabled' : ''} data-bi="${p.id}">${has ? '已安装' : '+ 安装'}</button></div>
      <div class="hint">${esc(p.description)}</div>`;
    bi.append(row);
  });
  bi.querySelectorAll('[data-bi]').forEach((b) => {
    b.onclick = () => installPlugin(BUILTIN_PLUGINS.find((x) => x.id === b.dataset.bi));
  });

  // 命令
  const cmds = $('#plg-cmds');
  cmds.innerHTML = '';
  if (!pluginCommands.size) cmds.innerHTML = '<p class="hint">没有可用命令（先装插件）。</p>';
  for (const [, c] of pluginCommands) {
    const b = document.createElement('button');
    b.className = 'sample';
    b.textContent = c.title;
    b.onclick = async () => {
      try { await c.run(); } catch (e) { alert('插件出错：' + e.message); }
    };
    cmds.append(b);
  }
}

async function installPlugin(p) {
  if (!confirm('安装「' + p.name + '」？\n\n' + PLUGIN_WARNING)) return;
  if (S.plugins.some((x) => x.id === p.id)) { alert('已经装过了'); return; }
  S.plugins.push({ ...p, enabled: true, source: 'builtin' });
  save();
  await refreshPluginCommands();
  renderPlugins();
  toast('已安装：' + p.name);
}

async function installPluginFromUrl(url) {
  try {
    let manifest;
    if (url.endsWith('.json')) {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      manifest = await r.json();
      if (!manifest.code) {
        // manifest 里只写了 codeUrl，去拉代码
        if (!manifest.codeUrl) throw new Error('清单里没有 code 也没有 codeUrl');
        const rc = await fetch(new URL(manifest.codeUrl, url).href);
        if (!rc.ok) throw new Error('拉代码失败 HTTP ' + rc.status);
        manifest.code = await rc.text();
      }
    } else {
      // 直接给 .js
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      manifest = { id: 'url-' + Math.random().toString(36).slice(2, 8), name: url.split('/').pop(), version: '0', author: '未知', description: '从网址安装', code: await r.text() };
    }
    if (!manifest.id || !manifest.code) throw new Error('清单格式不对（至少要有 id 和 code）');
    await installPlugin(manifest);
  } catch (e) {
    alert('安装失败：' + e.message + '\n\n常见原因：地址不是 raw 直链、跨域被拦、清单缺 id/code。');
  }
}

async function refreshPluginCommands() {
  pluginCommands.clear();
  for (const p of S.plugins) {
    if (!p.enabled) continue;
    try {
      const api = {
        version: 1,
        getState: () => S,
        session: () => active(),
        toast: (m) => toast(m),
        addCommand: (id, title, run) => pluginCommands.set(p.id + ':' + id, { pid: p.id, title, run }),
      };
      const blob = new Blob([p.code], { type: 'text/javascript' });
      const mod = await import(URL.createObjectURL(blob));
      (mod.default || (() => {}))(api);
    } catch (e) {
      console.warn('插件加载失败', p.name, e);
    }
  }
}

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── 事件绑定 ─────────────────────────────────────────────────
function bind() {
  $('#btn-new').onclick = () => { newSession(active()?.mode || 'single'); render(); };
  $('#btn-clear').onclick = () => {
    if (!S.sessions.length) { toast('本来就没有会话'); return; }
    if (!confirm(`清空全部 ${S.sessions.length} 个会话？聊天记录会一起删掉，不可恢复。`)) return;
    const mode = active()?.mode || 'single';
    S.sessions = []; S.activeId = null; save();
    newSession(mode); render();
    toast('已清空');
  };
  $('#sess-search').oninput = () => renderSessions();
  $('#btn-send').onclick = send;
  $('#btn-tpl').onclick = openTemplateModal;
$('#btn-settings').onclick = openSettings;
  $('#btn-members').onclick = openMembers;
  $('#btn-plugins').onclick = openPlugins;
  $('#btn-panel').onclick = () => $('#panel').classList.toggle('hidden');
  $('#btn-panel-close').onclick = () => $('#panel').classList.add('hidden');
  $('#modal-close').onclick = closeModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

  document.querySelectorAll('.mode-switch button').forEach((b) => {
    b.onclick = () => {
      const s = ensureSession();
      s.mode = b.dataset.mode;
      if (s.mode === 'group' && !s.hostKey) s.hostKey = s.members[0]?.key || null;
      save(); render();
      if (s.mode === 'group') openMembers();
    };
  });

  $('#rg-effort').oninput = (e) => { S.params.effort = +e.target.value; $('#out-effort').textContent = EFFORTS[S.params.effort]; save(); };
  $('#rg-temp').oninput = (e) => { S.params.temp = +e.target.value; $('#out-temp').textContent = S.params.temp.toFixed(1); save(); };
  $('#rg-max').oninput = (e) => { S.params.maxTokens = +e.target.value; $('#out-max').textContent = S.params.maxTokens; save(); };
  $('#sel-rounds').onchange = (e) => { S.params.rounds = e.target.value; save(); };
  $('#sel-host').onchange = (e) => { const s = ensureSession(); s.hostKey = e.target.value; save(); };

  $('#sel-model').onchange = (e) => {
    const s = ensureSession();
    const key = e.target.value;
    if (!key) return;
    if (s.members.length) s.members[0].key = key;
    else s.members.push({ key });
    S.lastModelKey = key;
    save();
  };

  const input = $('#input');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
}

// ── 启动 ─────────────────────────────────────────────────────
sanitize();

function sanitize() {
  // 1. 去掉指向已删除 provider 的成员
  for (const s of S.sessions) {
    const before = s.members.length;
    s.members = (s.members || []).filter((m) => {
      const [pid] = String(m.key || '').split('::');
      return !!providerById(pid);
    });
    if (s.members.length !== before) {
      if (!s.members.length && S.lastModelKey) s.members.push({ key: S.lastModelKey });
      if (!s.members.length) s.hostKey = null;
    }
    // 群主失效 → 落到第一个成员
    if (s.hostKey) {
      const [hp] = s.hostKey.split('::');
      if (!providerById(hp)) s.hostKey = s.members[0]?.key || null;
    } else if (s.members[0]) {
      s.hostKey = s.members[0].key;
    }
  }
  // 2. 老消息补 id（v2 早期数据没有 id）
  for (const s of S.sessions) for (const m of s.messages) if (!m.id) m.id = uid();
  // 3. activeId 失效就选第一个
  if (!S.sessions.some((s) => s.id === S.activeId)) S.activeId = S.sessions[0]?.id || null;
  save();
}

bind();
if (!S.sessions.length) newSession('single');
refreshPluginCommands();
render();
