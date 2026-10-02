require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Persistent Disk setup for Render.com
const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'database.db'));
db.pragma('journal_mode = WAL');

// Init DB Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT CHECK(role IN ('admin', 'captain', 'member', 'viewer')) DEFAULT 'viewer'
  );

  CREATE TABLE IF NOT EXISTS maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tag TEXT NOT NULL,
    captain_id INTEGER,
    FOREIGN KEY(captain_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY(team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    size INTEGER NOT NULL,
    format TEXT CHECK(format IN ('Bo1', 'Bo3', 'Bo5')) DEFAULT 'Bo1',
    ban_count INTEGER DEFAULT 3,
    ban_order TEXT CHECK(ban_order IN ('ABAB', 'ABBA', 'random')) DEFAULT 'ABAB',
    status TEXT DEFAULT 'draft'
  );

  CREATE TABLE IF NOT EXISTS tournament_maps (
    tournament_id INTEGER,
    map_id INTEGER,
    PRIMARY KEY(tournament_id, map_id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    match_num INTEGER NOT NULL,
    team1_id INTEGER,
    team2_id INTEGER,
    winner_id INTEGER,
    next_match_id INTEGER,
    next_slot INTEGER,
    x REAL DEFAULT 0,
    y REAL DEFAULT 0,
    current_ban_index INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY(tournament_id) REFERENCES tournaments(id)
  );

  CREATE TABLE IF NOT EXISTS match_bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    map_id INTEGER NOT NULL,
    ban_order INTEGER NOT NULL
  );
`);

// Seed default Admin user if empty
const adminExists = db.prepare('SELECT * FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
}

app.use(express.json());
app.use(express.static('public'));

// Middleware JWT Authentication
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// --- Auth Routes ---
app.post('/api/auth/register', (req, res) => {
  const { username, password, role } = req.body;
  const userRole = ['captain', 'member', 'viewer'].includes(role) ? role : 'viewer';
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, userRole);
    const token = jwt.sign({ id: info.lastInsertRowid, username, role: userRole }, JWT_SECRET);
    res.json({ token, user: { id: info.lastInsertRowid, username, role: userRole } });
  } catch (err) {
    res.status(400).json({ error: 'Пользователь уже существует' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: 'Неверное имя или пароль' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/users', authenticateToken, (req, res) => {
  const users = db.prepare('SELECT id, username, role FROM users').all();
  res.json(users);
});

// --- Admin API: Maps ---
app.get('/api/maps', (req, res) => {
  res.json(db.prepare('SELECT * FROM maps').all());
});

app.post('/api/maps', authenticateToken, requireAdmin, (req, res) => {
  const { name, image_url } = req.body;
  const info = db.prepare('INSERT INTO maps (name, image_url) VALUES (?, ?)').run(name, image_url);
  res.json({ id: info.lastInsertRowid, name, image_url });
});

// --- Admin API: Teams ---
app.get('/api/teams', (req, res) => {
  const teams = db.prepare(`
    SELECT t.*, u.username as captain_name 
    FROM teams t LEFT JOIN users u ON t.captain_id = u.id
  `).all();
  for (let team of teams) {
    team.members = db.prepare(`
      SELECT u.id, u.username FROM users u
      JOIN team_members tm ON u.id = tm.user_id
      WHERE tm.team_id = ?
    `).all(team.id);
  }
  res.json(teams);
});

app.post('/api/teams', authenticateToken, requireAdmin, (req, res) => {
  const { name, tag, captain_id, member_ids } = req.body;
  const info = db.prepare('INSERT INTO teams (name, tag, captain_id) VALUES (?, ?, ?)').run(name, tag, captain_id);
  const teamId = info.lastInsertRowid;
  
  if (Array.isArray(member_ids)) {
    const insertMember = db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)');
    for (let id of member_ids) insertMember.run(teamId, id);
  }
  res.json({ id: teamId, name, tag });
});

// --- Admin API: Tournaments & Grid Generation ---
app.get('/api/tournaments', (req, res) => {
  res.json(db.prepare('SELECT * FROM tournaments').all());
});

app.post('/api/tournaments', authenticateToken, requireAdmin, (req, res) => {
  const { game, size, format, ban_count, ban_order, map_ids } = req.body;
  const info = db.prepare('INSERT INTO tournaments (game, size, format, ban_count, ban_order) VALUES (?, ?, ?, ?, ?)')
    .run(game, size, format, ban_count, ban_order);
  const tournamentId = info.lastInsertRowid;

  if (Array.isArray(map_ids)) {
    const stmt = db.prepare('INSERT INTO tournament_maps (tournament_id, map_id) VALUES (?, ?)');
    for (let mId of map_ids) stmt.run(tournamentId, mId);
  }
  res.json({ id: tournamentId, game, size, format });
});

app.post('/api/tournaments/:id/generate', authenticateToken, requireAdmin, (req, res) => {
  const tournamentId = req.params.id;
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) return res.status(404).json({ error: 'Турнир не найден' });

  // Clear existing matches
  db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(tournamentId);
  db.prepare('DELETE FROM match_bans WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ?)').run(tournamentId);

  const teams = db.prepare('SELECT id FROM teams').all();
  const size = parseInt(tournament.size);
  const totalRounds = Math.log2(size);

  let matchMap = {}; // key: "round-match_num" -> id

  // Generate Rounds from Final to First Round
  for (let r = totalRounds; r >= 1; r--) {
    const matchesInRound = Math.pow(2, totalRounds - r);
    for (let m = 0; m < matchesInRound; m++) {
      let nextMatchId = null;
      let nextSlot = null;
      if (r < totalRounds) {
        const parentMatchNum = Math.floor(m / 2);
        nextMatchId = matchMap[`${r + 1}-${parentMatchNum}`];
        nextSlot = (m % 2 === 0) ? 1 : 2;
      }

      const x = (r - 1) * 280 + 50;
      const y = m * (Math.pow(2, r - 1) * 100) + (Math.pow(2, r - 1) * 50);

      const info = db.prepare(`
        INSERT INTO matches (tournament_id, round, match_num, next_match_id, next_slot, x, y)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tournamentId, r, m, nextMatchId, nextSlot, x, y);

      matchMap[`${r}-${m}`] = info.lastInsertRowid;
    }
  }

  // Populate Round 1 with teams
  const round1Matches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round = 1 ORDER BY match_num ASC').all(tournamentId);
  for (let i = 0; i < round1Matches.length; i++) {
    const t1 = teams[i * 2] ? teams[i * 2].id : null;
    const t2 = teams[i * 2 + 1] ? teams[i * 2 + 1].id : null;
    db.prepare('UPDATE matches SET team1_id = ?, team2_id = ? WHERE id = ?').run(t1, t2, round1Matches[i].id);
  }

  db.prepare('UPDATE tournaments SET status = "active" WHERE id = ?').run(tournamentId);
  res.json({ message: 'Сетка успешно сгенерирована' });
});

// --- Bracket & Match Endpoints ---
app.get('/api/tournaments/:id/matches', (req, res) => {
  const matches = db.prepare(`
    SELECT m.*, 
      t1.name as team1_name, t1.tag as team1_tag,
      t2.name as team2_name, t2.tag as team2_tag
    FROM matches m
    LEFT JOIN teams t1 ON m.team1_id = t1.id
    LEFT JOIN teams t2 ON m.team2_id = t2.id
    WHERE m.tournament_id = ?
  `).all(req.params.id);
  res.json(matches);
});

app.patch('/api/matches/:id/position', authenticateToken, requireAdmin, (req, res) => {
  const { x, y } = req.body;
  db.prepare('UPDATE matches SET x = ?, y = ? WHERE id = ?').run(x, y, req.params.id);
  res.json({ success: true });
});

app.post('/api/matches/:id/winner', authenticateToken, requireAdmin, (req, res) => {
  const { winner_id } = req.body;
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Матч не найден' });

  db.prepare('UPDATE matches SET winner_id = ?, status = "completed" WHERE id = ?').run(winner_id, match.id);

  if (match.next_match_id) {
    if (match.next_slot === 1) {
      db.prepare('UPDATE matches SET team1_id = ? WHERE id = ?').run(winner_id, match.next_match_id);
    } else {
      db.prepare('UPDATE matches SET team2_id = ? WHERE id = ?').run(winner_id, match.next_match_id);
    }
  }

  res.json({ success: true });
});

// --- Map Pick/Ban Draft API ---
app.get('/api/matches/:id/draft', (req, res) => {
  const match = db.prepare(`
    SELECT m.*, t.ban_count, t.ban_order, t.id as tournament_id
    FROM matches m
    JOIN tournaments t ON m.tournament_id = t.id
    WHERE m.id = ?
  `).get(req.params.id);

  if (!match) return res.status(404).json({ error: 'Матч не найден' });

  const maps = db.prepare(`
    SELECT m.* FROM maps m
    JOIN tournament_maps tm ON m.id = tm.map_id
    WHERE tm.tournament_id = ?
  `).all(match.tournament_id);

  const bans = db.prepare('SELECT * FROM match_bans WHERE match_id = ? ORDER BY ban_order ASC').all(match.id);

  res.json({ match, maps, bans });
});

app.post('/api/matches/:id/ban', authenticateToken, (req, res) => {
  const matchId = req.params.id;
  const { map_id } = req.body;

  const match = db.prepare(`
    SELECT m.*, t.ban_count, t.ban_order 
    FROM matches m 
    JOIN tournaments t ON m.tournament_id = t.id 
    WHERE m.id = ?
  `).get(matchId);

  if (!match || !match.team1_id || !match.team2_id) {
    return res.status(400).json({ error: 'Команды не готовы' });
  }

  const team1 = db.prepare('SELECT * FROM teams WHERE id = ?').get(match.team1_id);
  const team2 = db.prepare('SELECT * FROM teams WHERE id = ?').get(match.team2_id);

  // Check current ban sequence
  const currentBanIndex = match.current_ban_index;
  const maxBans = match.ban_count;

  if (currentBanIndex >= maxBans) {
    return res.status(400).json({ error: 'Драфт карт уже завершен' });
  }

  // Determine active captain turn
  let activeTeamId;
  let orderType = match.ban_order;

  if (orderType === 'ABAB') {
    activeTeamId = (currentBanIndex % 2 === 0) ? match.team1_id : match.team2_id;
  } else if (orderType === 'ABBA') {
    const seq = [match.team1_id, match.team2_id, match.team2_id, match.team1_id];
    activeTeamId = seq[currentBanIndex % 4];
  } else {
    activeTeamId = (currentBanIndex % 2 === 0) ? match.team1_id : match.team2_id;
  }

  // Permission Check: Must be captain of active team or Admin
  if (req.user.role !== 'admin') {
    const isCaptain = (activeTeamId === team1.id && team1.captain_id === req.user.id) ||
                      (activeTeamId === team2.id && team2.captain_id === req.user.id);
    if (!isCaptain) return res.status(403).json({ error: 'Сейчас не ваш черед или вы не капитан' });
  }

  // Check if map is already banned
  const alreadyBanned = db.prepare('SELECT * FROM match_bans WHERE match_id = ? AND map_id = ?').get(matchId, map_id);
  if (alreadyBanned) return res.status(400).json({ error: 'Карта уже забанена' });

  // Execute Ban
  db.prepare('INSERT INTO match_bans (match_id, team_id, map_id, ban_order) VALUES (?, ?, ?, ?)').run(matchId, activeTeamId, map_id, currentBanIndex + 1);
  db.prepare('UPDATE matches SET current_ban_index = current_ban_index + 1 WHERE id = ?').run(matchId);

  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));