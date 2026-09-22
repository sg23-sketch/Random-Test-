// ---------- storage ----------
const STORE_KEY = 'vision.items.v1';
const SETTINGS_KEY = 'vision.settings.v1';

function loadItems() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { return []; }
}
function saveItems(items) { localStorage.setItem(STORE_KEY, JSON.stringify(items)); }

function loadSettings() {
  try {
    return Object.assign(
      { freq: 'daily', time: '09:00', notifGranted: false, lastFired: null },
      JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
    );
  } catch {
    return { freq: 'daily', time: '09:00', notifGranted: false, lastFired: null };
  }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

let items = loadItems();
let settings = loadSettings();

// ---------- quarter helpers ----------
function currentQuarterInfo(date = new Date()) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return { q, year: date.getFullYear() };
}
function quarterKey(q, year) { return `Q${q}-${year}`; }
function quarterBounds(key) {
  const [qPart, yPart] = key.split('-');
  const q = parseInt(qPart.replace('Q', ''), 10);
  const year = parseInt(yPart, 10);
  const startMonth = (q - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return { start, end };
}
function upcomingQuarters(count = 6) {
  const { q, year } = currentQuarterInfo();
  const list = [];
  let curQ = q, curY = year;
  for (let i = 0; i < count; i++) {
    list.push(quarterKey(curQ, curY));
    curQ++;
    if (curQ > 4) { curQ = 1; curY++; }
  }
  return list;
}
function quarterLabel(key) {
  const [qPart, yPart] = key.split('-');
  return `${qPart} ${yPart}`;
}
function daysLeftInQuarter(key) {
  const { end } = quarterBounds(key);
  const diff = Math.ceil((end - new Date()) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 0);
}

// ---------- local "AI-assisted" breakdown heuristic ----------
// NOTE: this is a deterministic, rule-based generator that runs entirely in
// the browser — there is no external AI API call wired up in this prototype.
// To swap in a real LLM, replace generateBreakdown() with a fetch() to your
// backend, which should call the model server-side (never expose an API key
// in client-side code).
function extractNumber(text) {
  const m = text.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function detectVerbTheme(text) {
  const t = text.toLowerCase();
  const themes = [
    { key: 'save', words: ['save', 'saving', 'savings'] },
    { key: 'lose', words: ['lose weight', 'lose ', 'weight loss'] },
    { key: 'run', words: ['run', 'marathon', 'race', '5k', '10k'] },
    { key: 'read', words: ['read', 'book'] },
    { key: 'learn', words: ['learn', 'study', 'course', 'certification'] },
    { key: 'launch', words: ['launch', 'ship', 'ship it', 'start a business', 'side project'] },
    { key: 'earn', words: ['earn', 'income', 'salary', 'raise', 'promotion'] },
    { key: 'write', words: ['write', 'book', 'blog'] },
  ];
  for (const th of themes) if (th.words.some(w => t.includes(w))) return th.key;
  return 'general';
}
function generateBreakdownLocal(title, desc, quarterKeyVal) {
  const text = `${title} ${desc}`;
  const num = extractNumber(text);
  const theme = detectVerbTheme(text);
  const { start, end } = quarterBounds(quarterKeyVal);
  const span = end - start;
  const checkpoints = [0.25, 0.5, 0.75, 1].map(f => new Date(start.getTime() + span * f));

  let goalStatement = title.trim();
  if (!/by end of|by q/i.test(goalStatement)) {
    goalStatement += ` — by end of ${quarterLabel(quarterKeyVal)}`;
  }

  let milestoneLabels;
  if (theme === 'save' && num) {
    const step = Math.round(num / 4);
    milestoneLabels = [
      `Set up separate savings tracking, save first $${step}`,
      `Reach $${step * 2} saved`,
      `Reach $${step * 3} saved`,
      `Hit target: $${num} saved`,
    ];
  } else if ((theme === 'run') && num) {
    milestoneLabels = [
      `Baseline run + build a training plan toward ${num}`,
      `Complete 25% of training plan, first race-pace test`,
      `Complete 75% of training plan, longest training run`,
      `Race day — hit the ${num} target`,
    ];
  } else if (theme === 'read' && num) {
    const step = Math.max(1, Math.round(num / 4));
    milestoneLabels = [
      `Finish book ${step}`,
      `Finish book ${step * 2}`,
      `Finish book ${step * 3}`,
      `Finish all ${num} books`,
    ];
  } else if (theme === 'learn') {
    milestoneLabels = [
      'Pick course/resource and set a weekly study block',
      'Complete first 25% of material',
      'Complete practice project or mock assessment',
      'Finish course / sit certification',
    ];
  } else if (theme === 'launch') {
    milestoneLabels = [
      'Define scope and validate the idea with 3–5 people',
      'Build minimum version',
      'Get it in front of real users, collect feedback',
      'Public launch',
    ];
  } else if (theme === 'earn') {
    milestoneLabels = [
      'Research target range and identify the ask/path',
      'Document impact and have the first conversation',
      'Follow up, adjust based on feedback',
      'Land the raise/promotion/offer',
    ];
  } else {
    milestoneLabels = [
      'Define what "done" looks like and set a baseline',
      'Complete first third of the work',
      'Reassess progress, adjust the plan',
      'Final push and close it out',
    ];
  }

  return {
    source: 'local-heuristic',
    goalStatement,
    metricHint: num ? `Detected target number: ${num}` : null,
    milestones: milestoneLabels.map((text, i) => ({
      text,
      due: checkpoints[i].toISOString(),
      done: false,
    })),
  };
}

// Tries the real Claude API via the local server first (see server.js);
// falls back to the local heuristic above if the server isn't running,
// there's no network, or the request fails for any reason (e.g. no
// ANTHROPIC_API_KEY configured). This keeps the app usable as a static
// site even with no backend.
async function generateBreakdown(title, desc, quarterKeyVal) {
  try {
    const res = await fetch('/api/breakdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, desc, quarterLabel: quarterLabel(quarterKeyVal) }),
    });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    const { start, end } = quarterBounds(quarterKeyVal);
    const span = end - start;
    return {
      source: 'llm',
      model: data.model,
      goalStatement: data.goalStatement,
      metricHint: data.metricHint,
      milestones: data.milestones.map(m => ({
        text: m.text,
        due: new Date(start.getTime() + span * (m.percentThroughQuarter / 100)).toISOString(),
        done: false,
      })),
    };
  } catch (err) {
    console.warn('Claude API breakdown unavailable, using local heuristic:', err.message);
    return generateBreakdownLocal(title, desc, quarterKeyVal);
  }
}

// ---------- rendering: board ----------
const boardGrid = document.getElementById('boardGrid');
const boardEmpty = document.getElementById('boardEmpty');

function itemProgress(item) {
  if (!item.goal || !item.goal.milestones.length) return 0;
  const done = item.goal.milestones.filter(m => m.done).length;
  return Math.round((done / item.goal.milestones.length) * 100);
}

function renderBoard() {
  boardGrid.innerHTML = '';
  boardEmpty.style.display = items.length ? 'none' : 'block';
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'vision-card';
    const progress = itemProgress(item);
    card.innerHTML = `
      ${item.image
        ? `<img src="${escapeAttr(item.image)}" alt="" onerror="this.style.display='none'" />`
        : `<div class="no-image">✦</div>`}
      <div class="vision-card-body">
        <h3>${escapeHtml(item.title)}</h3>
        <div class="meta">
          <span class="pill">${escapeHtml(item.category)}</span>
          <span class="pill">${quarterLabel(item.quarter)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="vision-card-actions">
          <button data-action="goto-goal" data-id="${item.id}">View goal (${progress}%)</button>
          <button data-action="delete" data-id="${item.id}">Remove</button>
        </div>
      </div>
    `;
    boardGrid.appendChild(card);
  });
}

boardGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'delete') {
    items = items.filter(i => i.id !== id);
    saveItems(items);
    renderBoard();
    renderGoals();
  } else if (btn.dataset.action === 'goto-goal') {
    const item = items.find(i => i.id === id);
    if (item) {
      setActiveTab('goals');
      activeQuarter = item.quarter;
      renderGoals();
    }
  }
});

// ---------- rendering: goals by quarter ----------
const quarterSelector = document.getElementById('quarterSelector');
const goalsList = document.getElementById('goalsList');
let activeQuarter = quarterKey(currentQuarterInfo().q, currentQuarterInfo().year);

function renderQuarterSelector() {
  const quarters = upcomingQuarters(6);
  quarterSelector.innerHTML = '';
  quarters.forEach(qk => {
    const chip = document.createElement('button');
    chip.className = 'quarter-chip' + (qk === activeQuarter ? ' active' : '');
    chip.textContent = quarterLabel(qk);
    chip.addEventListener('click', () => { activeQuarter = qk; renderGoals(); });
    quarterSelector.appendChild(chip);
  });
}

function renderGoals() {
  renderQuarterSelector();
  const inQuarter = items.filter(i => i.quarter === activeQuarter);
  goalsList.innerHTML = '';
  if (!inQuarter.length) {
    goalsList.innerHTML = `<div class="empty-state">No goals targeting ${quarterLabel(activeQuarter)} yet.</div>`;
    return;
  }
  inQuarter.forEach(item => {
    const card = document.createElement('div');
    card.className = 'goal-card';
    const milestonesHtml = (item.goal?.milestones || []).map((m, idx) => `
      <div class="milestone-row ${m.done ? 'done' : ''}">
        <input type="checkbox" data-item="${item.id}" data-idx="${idx}" ${m.done ? 'checked' : ''} />
        <label>${escapeHtml(m.text)}</label>
        <span class="milestone-due">${formatDate(m.due)}</span>
      </div>
    `).join('');
    card.innerHTML = `
      <h3>${escapeHtml(item.goal?.goalStatement || item.title)}</h3>
      <div class="goal-source">From board item · ${escapeHtml(item.category)}</div>
      ${milestonesHtml || '<p class="muted">No milestones defined.</p>'}
    `;
    goalsList.appendChild(card);
  });
}

goalsList.addEventListener('change', (e) => {
  const cb = e.target.closest('input[type="checkbox"]');
  if (!cb) return;
  const item = items.find(i => i.id === cb.dataset.item);
  if (!item) return;
  item.goal.milestones[cb.dataset.idx].done = cb.checked;
  saveItems(items);
  renderGoals();
  renderBoard();
});

// ---------- tabs ----------
function setActiveTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${tab}`).classList.add('active');
  if (tab === 'goals') renderGoals();
}
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));

// ---------- modal ----------
const modal = document.getElementById('itemModal');
const itemTitle = document.getElementById('itemTitle');
const itemDesc = document.getElementById('itemDesc');
const itemImage = document.getElementById('itemImage');
const itemCategory = document.getElementById('itemCategory');
const itemQuarter = document.getElementById('itemQuarter');
const aiSuggestion = document.getElementById('aiSuggestion');
const aiSuggestionBody = document.getElementById('aiSuggestionBody');
let pendingBreakdown = null;

function populateQuarterOptions() {
  itemQuarter.innerHTML = '';
  upcomingQuarters(6).forEach(qk => {
    const opt = document.createElement('option');
    opt.value = qk;
    opt.textContent = quarterLabel(qk);
    itemQuarter.appendChild(opt);
  });
}

function openModal() {
  itemTitle.value = ''; itemDesc.value = ''; itemImage.value = '';
  itemCategory.value = 'Health';
  populateQuarterOptions();
  pendingBreakdown = null;
  aiSuggestion.classList.add('hidden');
  modal.classList.remove('hidden');
  itemTitle.focus();
}
function closeModal() { modal.classList.add('hidden'); }

document.getElementById('addItemBtn').addEventListener('click', openModal);
document.getElementById('cancelItemBtn').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

const generateBreakdownBtn = document.getElementById('generateBreakdownBtn');
const saveItemBtn = document.getElementById('saveItemBtn');
const aiSuggestionSource = document.querySelector('#aiSuggestion .muted.small');

function renderSuggestion(breakdown) {
  aiSuggestionSource.textContent = breakdown.source === 'llm'
    ? `Generated by Claude (${breakdown.model}) — review and edit before accepting.`
    : 'Local heuristic fallback (Claude API unavailable) — review and edit before accepting.';
  aiSuggestionBody.innerHTML = `
    <div class="suggestion-goal">${escapeHtml(breakdown.goalStatement)}</div>
    ${breakdown.milestones.map(m => `
      <div class="suggestion-milestone"><span>${escapeHtml(m.text)}</span><span>${formatDate(m.due)}</span></div>
    `).join('')}
  `;
  aiSuggestion.classList.remove('hidden');
}

generateBreakdownBtn.addEventListener('click', async () => {
  if (!itemTitle.value.trim()) { itemTitle.focus(); return; }
  generateBreakdownBtn.disabled = true;
  generateBreakdownBtn.textContent = 'Generating…';
  try {
    pendingBreakdown = await generateBreakdown(itemTitle.value, itemDesc.value, itemQuarter.value);
    renderSuggestion(pendingBreakdown);
  } finally {
    generateBreakdownBtn.disabled = false;
    generateBreakdownBtn.textContent = 'Generate goal breakdown';
  }
});

saveItemBtn.addEventListener('click', async () => {
  if (!itemTitle.value.trim()) { itemTitle.focus(); return; }
  saveItemBtn.disabled = true;
  const goal = pendingBreakdown || await generateBreakdown(itemTitle.value, itemDesc.value, itemQuarter.value);
  saveItemBtn.disabled = false;
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title: itemTitle.value.trim(),
    desc: itemDesc.value.trim(),
    image: itemImage.value.trim(),
    category: itemCategory.value,
    quarter: itemQuarter.value,
    createdAt: new Date().toISOString(),
    goal,
  };
  items.push(item);
  saveItems(items);
  renderBoard();
  activeQuarter = item.quarter;
  renderGoals();
  closeModal();
  showToast(`Added "${item.title}" to your board and ${quarterLabel(item.quarter)} goals.`);
});

// ---------- reminders ----------
const notifPermBtn = document.getElementById('notifPerm');
const notifStatus = document.getElementById('notifStatus');
const reminderFreq = document.getElementById('reminderFreq');
const reminderTime = document.getElementById('reminderTime');
const dueCard = document.getElementById('dueCard');

function refreshNotifStatus() {
  const supported = 'Notification' in window;
  const perm = supported ? Notification.permission : 'unsupported';
  notifStatus.textContent = perm;
  notifStatus.className = 'status-pill' + (perm === 'granted' ? ' granted' : perm === 'denied' ? ' denied' : '');
}
notifPermBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) { showToast('This browser does not support notifications.'); return; }
  const result = await Notification.requestPermission();
  settings.notifGranted = result === 'granted';
  saveSettings(settings);
  refreshNotifStatus();
});

reminderFreq.value = settings.freq;
reminderTime.value = settings.time;
reminderFreq.addEventListener('change', () => { settings.freq = reminderFreq.value; saveSettings(settings); });
reminderTime.addEventListener('change', () => { settings.time = reminderTime.value; saveSettings(settings); });

function nextIncompleteMilestone() {
  const candidates = [];
  items.forEach(item => {
    (item.goal?.milestones || []).forEach(m => {
      if (!m.done) candidates.push({ item, milestone: m });
    });
  });
  candidates.sort((a, b) => new Date(a.milestone.due) - new Date(b.milestone.due));
  return candidates[0] || null;
}

function reminderMessage() {
  const next = nextIncompleteMilestone();
  if (!next) return "You're all caught up — add a new vision board item to set your next goal.";
  const daysLeft = daysLeftInQuarter(next.item.quarter);
  return `"${next.item.title}": next step is "${next.milestone.text}" — ${daysLeft} day(s) left in ${quarterLabel(next.item.quarter)}.`;
}

function fireReminder() {
  const msg = reminderMessage();
  showToast(msg, true);
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Vision board check-in', { body: msg });
  }
  settings.lastFired = new Date().toISOString();
  saveSettings(settings);
  renderDueCard();
}
document.getElementById('testReminderBtn').addEventListener('click', fireReminder);

function shouldFireScheduled() {
  const now = new Date();
  const [h, m] = settings.time.split(':').map(Number);
  if (now.getHours() !== h || now.getMinutes() !== m) return false;
  const today = now.toDateString();
  if (settings.lastFired && new Date(settings.lastFired).toDateString() === today) return false;
  const day = now.getDay(); // 0 Sun - 6 Sat
  if (settings.freq === 'weekdays' && (day === 0 || day === 6)) return false;
  if (settings.freq === 'weekly' && day !== 1) return false; // Mondays
  return true;
}
setInterval(() => { if (shouldFireScheduled()) fireReminder(); }, 20000);

function renderDueCard() {
  const next = nextIncompleteMilestone();
  dueCard.innerHTML = next
    ? `<h3 style="margin-top:0">Next up</h3><p class="muted">${escapeHtml(reminderMessage())}</p>`
    : `<h3 style="margin-top:0">Nothing due</h3><p class="muted">${escapeHtml(reminderMessage())}</p>`;
}

// ---------- toasts ----------
function showToast(msg, persistent = false) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), persistent ? 8000 : 4000);
}

// ---------- utils ----------
function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str = '') { return escapeHtml(str); }
function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- init ----------
refreshNotifStatus();
renderBoard();
renderGoals();
renderDueCard();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
