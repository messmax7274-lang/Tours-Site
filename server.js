const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new FileStore({
    path: './sessions',
    ttl: 86400,
    retries: 0
  }),
  secret: 'aether-super-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Базовые пользователи (Главный админ сразу в системе)
let users = [
  { id: 1, username: 'admin', password: 'Chuvak_Lif3', role: 'admin' }
];

let teams = [];
let maps = [];
let tournaments = [];

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).redirect('/login.html?error=forbidden');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
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
    // Проверка пароля для существующего пользователя
    if (user.password && user.password !== password) {
      return res.status(401).send('Неверный пароль');
    }
  } else {
    // Автоматическая регистрация нового пользователя КАК ЗРИТЕЛЬ
    user = { id: Date.now(), username, password, role: 'viewer' };
    users.push(user);
  }

  req.session.user = user;

  if (user.role === 'admin') {
    res.redirect('/admin.html');
  } else if (user.role === 'captain') {
    res.redirect('/teams.html');
  } else {
    res.redirect('/');
  }
});

app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

app.get('/api/me', (req, res) => {
  res.json(req.session.user || null);
});

// Управление ролями (Только для Админа)
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(users.map(u => ({ id: u.id, username: u.username, role: u.role })));
});

app.post('/api/users/role', requireAdmin, (req, res) => {
  const { userId, role } = req.body;
  const user = users.find(u => u.id == userId);
  if (user) {
    user.role = role;
  }
  res.redirect('/admin.html');
});

// TEAMS API
app.get('/api/teams', (req, res) => res.json(teams));

app.post('/api/teams', requireAuth, (req, res) => {
  const { name, tag, captain_name } = req.body;
  teams.push({ id: Date.now(), name, tag, captain_name: captain_name || req.session.user.username });
  res.redirect('/teams.html');
});

// MAPS API
app.get('/api/maps', (req, res) => res.json(maps));

app.post('/api/maps', requireAdmin, (req, res) => {
  const { name, image_url } = req.body;
  maps.push({ id: Date.now(), name, image_url });
  res.redirect('/maps.html');
});

// TOURNAMENTS API
app.get('/api/tournaments', (req, res) => res.json(tournaments));

app.post('/api/tournaments', requireAdmin, (req, res) => {
  const { name, team_count } = req.body;
  tournaments.push({ id: Date.now(), name, team_count });
  res.redirect('/admin.html');
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
