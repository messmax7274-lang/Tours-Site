const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database('tournament.db');

// Парсинг данных из форм и JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Раздача статических файлов из текущей директории
app.use(express.static(__dirname));

// Инициализация базы данных
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'viewer'
  );
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    tag TEXT,
    captain_name TEXT
  );
  CREATE TABLE IF NOT EXISTS maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    image_url TEXT
  );
  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    team_count INTEGER
  );
`);

// --- АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ ---
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).send('Заполните логин и пароль');
  }

  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user) {
    const info = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
                   .run(username, password, role || 'viewer');
    user = { id: info.lastInsertRowid, username, role: role || 'viewer' };
  }

  // Редирект в зависимости от роли
  if (user.role === 'admin') {
    res.redirect('/admin.html');
  } else if (user.role === 'captain') {
    res.redirect('/teams.html');
  } else {
    res.redirect('/');
  }
});

// --- API ЭНДПОИНТЫ ---

// Получить и создать команды
app.get('/api/teams', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams').all();
  res.json(teams);
});

app.post('/api/teams', (req, res) => {
  const { name, tag, captain_name } = req.body;
  db.prepare('INSERT INTO teams (name, tag, captain_name) VALUES (?, ?, ?)').run(name, tag, captain_name || 'Капитан');
  res.redirect('/teams.html');
});

// Получить и создать карты
app.get('/api/maps', (req, res) => {
  const maps = db.prepare('SELECT * FROM maps').all();
  res.json(maps);
});

app.post('/api/maps', (req, res) => {
  const { name, image_url } = req.body;
  db.prepare('INSERT INTO maps (name, image_url) VALUES (?, ?)').run(name, image_url);
  res.redirect('/maps.html');
});

// Создание турнира
app.post('/api/tournaments', (req, res) => {
  const { name, team_count } = req.body;
  db.prepare('INSERT INTO tournaments (name, team_count) VALUES (?, ?)').run(name, team_count);
  res.redirect('/admin.html');
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
