const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new FileStore({ path: './sessions', ttl: 86400, retries: 0 }),
  secret: 'aether-super-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

let users = [
  { id: 1, username: 'admin', password: 'Chuvak_Lif3', role: 'admin' }
];

let teams = [];
let maps = [];
let tournaments = [];
let activeAnnouncement = null;

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).redirect('/login.html?error=forbidden');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).redirect('/login.html');
}

app.get('/admin.html', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// AUTH API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Заполните все поля');

  let user = users.find(u => u.username === username);
  if (user) {
    if (user.password && user.password !== password) return res.status(401).send('Неверный пароль');
  } else {
    user = { id: Date.now(), username, password, role: 'viewer' };
    users.push(user);
  }

  req.session.user = user;
  if (user.role === 'admin') res.redirect('/admin.html');
  else if (user.role === 'captain') res.redirect('/teams.html');
  else res.redirect('/');
});

app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

app.get('/api/me', (req, res) => res.json(req.session.user || null));

// USER ROLES
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(users.map(u => ({ id: u.id, username: u.username, role: u.role })));
});

app.post('/api/users/role', requireAdmin, (req, res) => {
  const { userId, role } = req.body;
  const user = users.find(u => u.id == userId);
  if (user) user.role = role;
  res.redirect('/admin.html');
});

// ANNOUNCEMENTS
app.get('/api/announcement', (req, res) => res.json(activeAnnouncement));

// TOURNAMENTS API
app.get('/api/tournaments', (req, res) => res.json(tournaments));

app.post('/api/tournaments', requireAdmin, (req, res) => {
  const { 
    name, game_select, game_custom, start_time, twitch_url, 
    format_select, format_custom, team_count_select, team_count_custom, 
    prize_pool, prize_distribution, description 
  } = req.body;

  const finalGame = game_select === 'custom' ? game_custom : game_select;
  const finalFormat = format_select === 'custom' ? format_custom : format_select;
  const finalTeamCount = team_count_select === 'custom' ? parseInt(team_count_custom) || 8 : parseInt(team_count_select);

  // Генерация стартовых матчей
  const matches = [];
  const round1Matches = Math.max(1, Math.floor(finalTeamCount / 2));

  for (let i = 0; i < round1Matches; i++) {
    matches.push({
      id: i + 1,
      round: 1,
      team1: teams[i * 2] ? teams[i * 2].name : `Команда ${i * 2 + 1}`,
      team2: teams[i * 2 + 1] ? teams[i * 2 + 1].name : `Команда ${i * 2 + 2}`,
      score1: 0,
      score2: 0,
      winner: null
    });
  }

  const tournament = {
    id: Date.now(),
    name,
    game: finalGame || 'Разное',
    start_time,
    twitch_url,
    format: finalFormat || 'Single Elimination',
    team_count: finalTeamCount,
    prize_pool: prize_pool || '0 $',
    prize_distribution: prize_distribution || '',
    description: description || '',
    status: 'pending', // pending, active, paused, finished
    matches
  };

  tournaments.push(tournament);
  res.redirect('/admin.html');
});

// Изменение статуса и запуск
app.post('/api/tournaments/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const tournament = tournaments.find(t => t.id == req.params.id);
  
  if (tournament) {
    tournament.status = status;
    if (status === 'active') {
      activeAnnouncement = {
        tournamentName: tournament.name,
        twitchUrl: tournament.twitch_url,
        game: tournament.game
      };
    } else if (activeAnnouncement && activeAnnouncement.tournamentName === tournament.name && status === 'finished') {
      activeAnnouncement = null;
    }
  }
  res.redirect('/admin.html');
});

// Обновление счета и результатов матчей
app.post('/api/tournaments/:id/match', requireAdmin, (req, res) => {
  const { matchId, score1, score2, winner } = req.body;
  const tournament = tournaments.find(t => t.id == req.params.id);
  if (tournament) {
    const match = tournament.matches.find(m => m.id == matchId);
    if (match) {
      match.score1 = parseInt(score1) || 0;
      match.score2 = parseInt(score2) || 0;
      match.winner = winner || null;
    }
  }
  res.redirect('/admin.html');
});

// Остальные API
app.get('/api/teams', (req, res) => res.json(teams));
app.post('/api/teams', requireAuth, (req, res) => {
  const { name, tag, captain_name } = req.body;
  teams.push({ id: Date.now(), name, tag, captain_name: captain_name || req.session.user.username });
  res.redirect('/teams.html');
});

app.get('/api/maps', (req, res) => res.json(maps));
app.post('/api/maps', requireAdmin, (req, res) => {
  const { name, image_url } = req.body;
  maps.push({ id: Date.now(), name, image_url });
  res.redirect('/maps.html');
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
