const express = require('express');
const path = require('path');

const app = express();

// Парсинг JSON и данных из HTML-форм
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздача статических HTML/CSS/JS файлов из папки public
app.use(express.static(path.join(__dirname, 'public')));

// База данных в памяти
let users = [];
let teams = [];
let maps = [];
let tournaments = [];

// --- ЛОГИН / РЕГИСТРАЦИЯ ---
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).send('Заполните все поля');

  let user = users.find(u => u.username === username);
  if (!user) {
    user = { id: Date.now(), username, role: role || 'viewer' };
    users.push(user);
  }

  if (user.role === 'admin') {
    res.redirect('/admin.html');
  } else if (user.role === 'captain') {
    res.redirect('/teams.html');
  } else {
    res.redirect('/');
  }
});

// --- API КОМАНД ---
app.get('/api/teams', (req, res) => res.json(teams));

app.post('/api/teams', (req, res) => {
  const { name, tag, captain_name } = req.body;
  teams.push({ id: Date.now(), name, tag, captain_name: captain_name || 'Капитан' });
  res.redirect('/teams.html');
});

// --- API КАРТ ---
app.get('/api/maps', (req, res) => res.json(maps));

app.post('/api/maps', (req, res) => {
  const { name, image_url } = req.body;
  maps.push({ id: Date.now(), name, image_url });
  res.redirect('/maps.html');
});

// --- API ТУРНИРОВ ---
app.get('/api/tournaments', (req, res) => res.json(tournaments));

app.post('/api/tournaments', (req, res) => {
  const { name, team_count } = req.body;
  tournaments.push({ id: Date.now(), name, team_count });
  res.redirect('/admin.html');
});

// Главный роут
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
