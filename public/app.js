let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let token = localStorage.getItem('token') || null;

let currentTournamentId = null;
let activeDraftPoll = null;

// Zoom & Pan Canvas State
let scale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startX, startY;

// Drag state for Admin
let isDraggingCard = false;
let draggedCard = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

document.addEventListener('DOMContentLoaded', () => {
  setupAuthUI();
  setupCanvasEvents();
  loadTournaments();
  
  document.getElementById('tournamentSelect').addEventListener('change', (e) => {
    currentTournamentId = e.target.value;
    if (currentTournamentId) loadBracket();
  });

  // Forms
  document.getElementById('addMapForm').addEventListener('submit', createMap);
  document.getElementById('addTeamForm').addEventListener('submit', createTeam);
  document.getElementById('addTournamentForm').addEventListener('submit', createTournament);
  document.getElementById('authForm').addEventListener('submit', handleAuth);
});

// --- Auth Handling ---
function setupAuthUI() {
  const authBlock = document.getElementById('authBlock');
  const adminTabs = document.getElementById('adminTabs');

  if (token && currentUser) {
    authBlock.innerHTML = `
      <span class="text-sm text-slate-300">Привет, <b class="text-cyan-400">${currentUser.username}</b> (${currentUser.role})</span>
      <button onclick="logout()" class="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded">Выйти</button>
    `;
    if (currentUser.role === 'admin') adminTabs.classList.remove('hidden');
    else adminTabs.classList.add('hidden');
  } else {
    authBlock.innerHTML = `
      <button onclick="openAuthModal()" class="btn-cyan text-sm">Войти / Регистрация</button>
    `;
    adminTabs.classList.add('hidden');
  }
}

function openAuthModal() { document.getElementById('authModal').classList.remove('hidden'); }
function closeAuthModal() { document.getElementById('authModal').classList.add('hidden'); }

async function handleAuth(e) {
  e.preventDefault();
  const username = document.getElementById('authUsername').value;
  const password = document.getElementById('authPassword').value;
  const role = document.getElementById('authRole').value;

  let res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) {
    res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
  }

  const data = await res.json();
  if (data.token) {
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    closeAuthModal();
    setupAuthUI();
  } else {
    alert(data.error || 'Ошибка входа');
  }
}

function logout() {
  localStorage.clear();
  token = null;
  currentUser = null;
  setupAuthUI();
  switchTab('grid');
}

// --- Navigation Tabs ---
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active', 'text-cyan-400'));
  
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');
  event.target.classList.add('active', 'text-cyan-400');

  if (tabId === 'maps') loadMaps();
  if (tabId === 'teams') loadTeams();
  if (tabId === 'tournaments') loadAdminTournaments();
}

// --- Canvas Zoom & Pan & Line Renderer ---
function setupCanvasEvents() {
  const viewport = document.getElementById('viewport');

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = 0.1;
    if (e.deltaY < 0) scale = Math.min(scale + zoomFactor, 2.5);
    else scale = Math.max(scale - zoomFactor, 0.4);
    updateTransform();
  });

  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.match-card')) return; // Ignore drag if clicked on match block
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      updateTransform();
    } else if (isDraggingCard && draggedCard) {
      const matchId = draggedCard.dataset.id;
      const x = (e.clientX - panX - dragOffsetX) / scale;
      const y = (e.clientY - panY - dragOffsetY) / scale;

      draggedCard.style.left = `${x}px`;
      draggedCard.style.top = `${y}px`;
      drawSvgLines();
    }
  });

  window.addEventListener('mouseup', async (e) => {
    isPanning = false;
    if (isDraggingCard && draggedCard) {
      const matchId = draggedCard.dataset.id;
      const x = parseFloat(draggedCard.style.left);
      const y = parseFloat(draggedCard.style.top);
      
      await fetch(`/api/matches/${matchId}/position`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ x, y })
      });

      isDraggingCard = false;
      draggedCard = null;
    }
  });
}

function updateTransform() {
  const canvas = document.getElementById('bracketCanvas');
  canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  drawSvgLines();
}

// --- Bracket & Matches Rendering ---
async function loadBracket() {
  if (!currentTournamentId) return;
  const res = await fetch(`/api/tournaments/${currentTournamentId}/matches`);
  const matches = await res.json();

  const canvas = document.getElementById('bracketCanvas');
  canvas.innerHTML = '';

  matches.forEach(m => {
    const card = document.createElement('div');
    card.className = `match-card p-3 flex flex-col justify-between text-xs cursor-pointer ${m.winner_id ? (m.winner_id === m.team1_id ? 'winner-1' : 'winner-2') : ''}`;
    card.style.left = `${m.x}px`;
    card.style.top = `${m.y}px`;
    card.dataset.id = m.id;
    card.dataset.nextId = m.next_match_id || '';

    card.innerHTML = `
      <div class="flex justify-between text-slate-400 border-b border-slate-700 pb-1 mb-2">
        <span>Раунд ${m.round} - М#${m.match_num + 1}</span>
        <button onclick="openDraftModal(${m.id})" class="text-cyan-400 hover:underline">Драфт</button>
      </div>
      <div class="space-y-1">
        <div class="team-1 p-1.5 rounded bg-slate-900 flex justify-between items-center">
          <span>${m.team1_name ? `[${m.team1_tag}]${m.team1_name}` : 'TBD'}</span>
          ${currentUser?.role === 'admin' && m.team1_id && !m.winner_id ? `<button onclick="setWinner(${m.id},${m.team1_id})" class="text-xs bg-cyan-500 text-black font-bold px-1 rounded">✓</button>` : ''}
        </div>
        <div class="team-2 p-1.5 rounded bg-slate-900 flex justify-between items-center">
          <span>${m.team2_name ? `[${m.team2_tag}]${m.team2_name}` : 'TBD'}</span>
          ${currentUser?.role === 'admin' && m.team2_id && !m.winner_id ? `<button onclick="setWinner(${m.id},${m.team2_id})" class="text-xs bg-cyan-500 text-black font-bold px-1 rounded">✓</button>` : ''}
        </div>
      </div>
    `;

    // Setup Dragging for Admins
    if (currentUser?.role === 'admin') {
      card.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDraggingCard = true;
        draggedCard = card;
        dragOffsetX = e.clientX - panX - (parseFloat(card.style.left) * scale);
        dragOffsetY = e.clientY - panY - (parseFloat(card.style.top) * scale);
      });
    }

    canvas.appendChild(card);
  });

  drawSvgLines();
}

function drawSvgLines() {
  const svg = document.getElementById('svgLines');
  svg.innerHTML = '';

  const cards = document.querySelectorAll('.match-card');
  const cardMap = {};
  cards.forEach(c => cardMap[c.dataset.id] = c);

  cards.forEach(card => {
    const nextId = card.dataset.nextId;
    if (nextId && cardMap[nextId]) {
      const nextCard = cardMap[nextId];

      const x1 = parseFloat(card.style.left) + 220;
      const y1 = parseFloat(card.style.top) + 40;
      const x2 = parseFloat(nextCard.style.left);
      const y2 = parseFloat(nextCard.style.top) + 40;

      // Transform world coords to screen
      const sx1 = x1 * scale + panX;
      const sy1 = y1 * scale + panY;
      const sx2 = x2 * scale + panX;
      const sy2 = y2 * scale + panY;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dx = (sx2 - sx1) / 2;
      path.setAttribute('d', `M ${sx1} ${sy1} C ${sx1 + dx} ${sy1}, ${sx2 - dx} ${sy2}, ${sx2} ${sy2}`);
      path.setAttribute('stroke', '#06b6d4');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.6');
      svg.appendChild(path);
    }
  });
}

async function setWinner(matchId, winnerId) {
  await fetch(`/api/matches/${matchId}/winner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ winner_id: winnerId })
  });
  loadBracket();
}

// --- Map Draft Logic (Polling 2s) ---
let currentDraftMatchId = null;

function openDraftModal(matchId) {
  currentDraftMatchId = matchId;
  document.getElementById('draftModal').classList.remove('hidden');
  pollDraft();
  activeDraftPoll = setInterval(pollDraft, 2000);
}

function closeDraftModal() {
  document.getElementById('draftModal').classList.add('hidden');
  if (activeDraftPoll) clearInterval(activeDraftPoll);
}

async function pollDraft() {
  if (!currentDraftMatchId) return;
  const res = await fetch(`/api/matches/${currentDraftMatchId}/draft`);
  const data = await res.json();

  const { match, maps, bans } = data;
  const bannedMapIds = bans.map(b => b.map_id);

  document.getElementById('draftStatus').innerHTML = `
    Статус драфта: <b class="text-cyan-400">Забанено ${match.current_ban_index} / ${match.ban_count} карт</b> (Порядок: ${match.ban_order})
  `;

  const grid = document.getElementById('mapsDraftGrid');
  grid.innerHTML = '';

  maps.forEach(m => {
    const isBanned = bannedMapIds.includes(m.id);
    const mapCard = document.createElement('div');
    mapCard.className = `map-card ${isBanned ? 'banned' : ''}`;
    mapCard.innerHTML = `
      <img src="${m.image_url}" class="w-full h-24 object-cover">
      <div class="p-2 text-center text-xs font-bold bg-slate-900">${m.name}</div>
    `;

    if (!isBanned) {
      mapCard.onclick = () => banMap(match.id, m.id);
    }

    grid.appendChild(mapCard);
  });

  const logs = document.getElementById('bannedLogs');
  logs.innerHTML = bans.map((b, idx) => {
    const mapName = maps.find(m => m.id === b.map_id)?.name || 'Карта';
    return `<div class="text-slate-400">#${idx + 1}: Забанена <b>${mapName}</b></div>`;
  }).join('');
}

async function banMap(matchId, mapId) {
  if (!token) return alert('Авторизуйтесь!');
  const res = await fetch(`/api/matches/${matchId}/ban`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ map_id: mapId })
  });
  const data = await res.json();
  if (data.error) alert(data.error);
  else pollDraft();
}

// --- Admin Module Logic ---
async function loadTournaments() {
  const res = await fetch('/api/tournaments');
  const tournaments = await res.json();
  const select = document.getElementById('tournamentSelect');
  select.innerHTML = '<option value="">Выберите турнир...</option>';
  tournaments.forEach(t => {
    select.innerHTML += `<option value="${t.id}">${t.game} (${t.size}T - ${t.format})</option>`;
  });
}

async function loadMaps() {
  const res = await fetch('/api/maps');
  const maps = await res.json();
  const list = document.getElementById('mapsList');
  list.innerHTML = maps.map(m => `
    <div class="bg-slate-800 border border-slate-700 rounded overflow-hidden">
      <img src="${m.image_url}" class="w-full h-28 object-cover">
      <div class="p-2 font-bold text-center text-sm">${m.name}</div>
    </div>
  `).join('');
}

async function createMap(e) {
  e.preventDefault();
  const name = document.getElementById('mapName').value;
  const image_url = document.getElementById('mapUrl').value;

  await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name, image_url })
  });
  loadMaps();
}

async function loadTeams() {
  const res = await fetch('/api/teams');
  const teams = await res.json();
  const usersRes = await fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } });
  const users = await usersRes.json();

  const captainSelect = document.getElementById('captainSelect');
  captainSelect.innerHTML = '<option value="">Выберите Капитана...</option>';
  users.forEach(u => {
    captainSelect.innerHTML += `<option value="${u.id}">${u.username} (${u.role})</option>`;
  });

  const list = document.getElementById('teamsList');
  list.innerHTML = teams.map(t => `
    <div class="bg-slate-800 p-4 rounded border border-slate-700">
      <h3 class="font-bold text-cyan-400">[${t.tag}] ${t.name}</h3>
      <p class="text-xs text-slate-400">Капитан: ${t.captain_name || 'Не назначен'}</p>
    </div>
  `).join('');
}

async function createTeam(e) {
  e.preventDefault();
  const name = document.getElementById('teamName').value;
  const tag = document.getElementById('teamTag').value;
  const captain_id = document.getElementById('captainSelect').value;

  await fetch('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name, tag, captain_id })
  });
  loadTeams();
}

async function loadAdminTournaments() {
  const mapsRes = await fetch('/api/maps');
  const maps = await mapsRes.json();
  const mapsContainer = document.getElementById('tournamentMapsSelect');
  mapsContainer.innerHTML = maps.map(m => `
    <label class="flex items-center gap-2 text-xs bg-slate-900 p-2 rounded">
      <input type="checkbox" value="${m.id}" class="map-checkbox"> ${m.name}
    </label>
  `).join('');

  const res = await fetch('/api/tournaments');
  const tourns = await res.json();
  const list = document.getElementById('tournamentsList');
  list.innerHTML = tourns.map(t => `
    <div class="bg-slate-800 p-4 rounded border border-slate-700 flex justify-between items-center">
      <div>
        <h4 class="font-bold text-cyan-400">${t.game}</h4>
        <span class="text-xs text-slate-400">${t.size} Команд | ${t.format} | Ban Order: ${t.ban_order}</span>
      </div>
      <button onclick="generateGrid(${t.id})" class="btn-cyan text-xs">Сгенерировать сетку</button>
    </div>
  `).join('');
}

async function createTournament(e) {
  e.preventDefault();
  const game = document.getElementById('tournGame').value;
  const size = document.getElementById('tournSize').value;
  const format = document.getElementById('tournFormat').value;
  const ban_order = document.getElementById('tournBanOrder').value;

  const map_ids = Array.from(document.querySelectorAll('.map-checkbox:checked')).map(cb => cb.value);

  await fetch('/api/tournaments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ game, size, format, ban_count: 3, ban_order, map_ids })
  });
  loadAdminTournaments();
  loadTournaments();
}

async function generateGrid(id) {
  const res = await fetch(`/api/tournaments/${id}/generate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  alert(data.message || data.error);
  currentTournamentId = id;
  document.getElementById('tournamentSelect').value = id;
  switchTab('grid');
  loadBracket();
}

// 1. Переключение вкладок
document.querySelectorAll('.nav-tab').forEach(button => {
  button.addEventListener('click', () => {
    // Снимаем активный класс со всех
    document.querySelectorAll('.nav-tab').forEach(b => {
      b.classList.remove('border-b-2', 'border-cyan-400', 'text-cyan-400');
      b.classList.add('text-slate-400');
    });
    // Активируем нажатую
    button.classList.add('border-b-2', 'border-cyan-400', 'text-cyan-400');
    button.classList.remove('text-slate-400');

    // Прячем весь контент и показываем нужный
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    const tabId = button.getAttribute('data-tab');
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
  });
});

// 2. Показ админских блоков только после входа с ролью 'admin'
function updateUIForRole(user) {
  if (user && user.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
  }
}
