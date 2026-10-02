const express = require('express');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздаем все HTML/CSS/JS файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// База данных в памяти (чтобы ничего не ломалось без файла БД)
let users = [];
let teams = [];
let maps = [];
let tournaments = [];

// Авторизация
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).send('Заполните все поля');

  let user = users.find(u => u.username === username);
  if (!user) {
    user = { id: Date.now(), username, role: role || 'viewer' };
    users.push(user);
  }

  if (user.role === 'admin') res.redirect('/admin.html');
  else if (user.role === 'captain') res.redirect('/teams.html');
  else res.redirect('/');
});

// API Команд
app.get('/api/teams', (req, res) => res.json(teams));
app.post('/api/teams', (req, res) => {
  const { name, tag, captain_name } = req.body;
  teams.push({ id: Date.now(), name, tag, captain_name: captain_name || 'Капитан' });
  res.redirect('/teams.html');
});

// API Карт
app.get('/api/maps', (req, res) => res.json(maps));
app.post('/api/maps', (req, res) => {
  const { name, image_url } = req.body;
  maps.push({ id: Date.now(), name, image_url });
  res.redirect('/maps.html');
});

// Главная страница отдается из папки public
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
