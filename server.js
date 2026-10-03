const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');

const app = express();

// Подключение к PostgreSQL через переменную окружения Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Автоматическое создание таблиц при запуске
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'viewer'
      );

      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        tag VARCHAR(50),
        captain_name VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS maps (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        image_url TEXT
      );

      CREATE TABLE IF NOT EXISTS tournaments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        game VARCHAR(255),
        start_time VARCHAR(255),
        twitch_url TEXT,
        format VARCHAR(255),
        team_count INTEGER,
        prize_pool VARCHAR(255),
        prize_distribution TEXT,
        description TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        matches JSONB
      );
    `);

    // Дефолтный админ
    const adminRes = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (adminRes.rows.length === 0) {
      await pool.query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['admin', 'Chuvak_Lif3', 'admin']);
    }

    // Дефолтные карты
    const mapRes = await pool.query('SELECT COUNT(*) FROM maps');
    if (parseInt(mapRes.rows[0].count) === 0) {
      await pool.query('INSERT INTO maps (name, image_url) VALUES ($1, $2)', ['Mirage', 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500']);
      await pool.query('INSERT INTO maps (name, image_url) VALUES ($1, $2)', ['Inferno', 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=500']);
    }

    console.log('Database initialized successfully!');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

initDb();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'aether-super-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

let activeAnnouncement = null;

// Middleware проверки прав Админа
async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).redirect('/login.html');
  }
  
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
    const currentUser = userRes.rows[0];
    if (currentUser && currentUser.role === 'admin') {
      req.session.user.role = 'admin';
      return next();
    }
  } catch (e) {
    console.error(e);
  }
  
  return res.status(403).send('Недостаточно прав. Доступ только для Администраторов. <a href="/">На главную</a>');
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
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Заполните логин и пароль');

  const cleanUsername = username.trim();
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [cleanUsername]);
    let user = userRes.rows[0];

    if (user) {
      if (user.password !== password) {
        return res.status(401).send('Неверный пароль. <a href="/login.html">Попробовать снова</a>');
      }
    } else {
      const newUser = await pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING *',
        [cleanUsername, password, 'viewer']
      );
      user = newUser.rows[0];
    }

    req.session.user = { id: user.id, username: user.username, role: user.role };

    if (user.role === 'admin') {
      res.redirect('/admin.html');
    } else if (user.role === 'captain') {
      res.redirect('/teams.html');
    } else {
      res.redirect('/');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка сервера');
  }
});

app.get('/api/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

app.get('/api/me', async (req, res) => {
  if (!req.session || !req.session.user) return res.json(null);
  
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
    const currentUser = userRes.rows[0];
    if (currentUser) {
      req.session.user.role = currentUser.role;
      return res.json({ id: currentUser.id, username: currentUser.username, role: currentUser.role });
    }
  } catch (e) {
    console.error(e);
  }
  res.json(null);
});

// USERS & ROLES API
app.get('/api/users', requireAdmin, async (req, res) => {
  const usersRes = await pool.query('SELECT id, username, role FROM users');
  res.json(usersRes.rows);
});

app.post('/api/users/role', requireAdmin, async (req, res) => {
  const { userId, role } = req.body;
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
  res.redirect('/admin.html');
});

// ANNOUNCEMENTS
app.get('/api/announcement', (req, res) => res.json(activeAnnouncement));

// MAPS API
app.get('/api/maps', async (req, res) => {
  const mapsRes = await pool.query('SELECT * FROM maps');
  res.json(mapsRes.rows);
});

app.post('/api/maps', requireAdmin, async (req, res) => {
  const { name, image_url } = req.body;
  if (name) {
    await pool.query(
      'INSERT INTO maps (name, image_url) VALUES ($1, $2)',
      [name, image_url || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500']
    );
  }
  res.redirect('/maps.html');
});

app.post('/api/maps/delete', requireAdmin, async (req, res) => {
  const { mapId } = req.body;
  await pool.query('DELETE FROM maps WHERE id = $1', [mapId]);
  res.redirect('/maps.html');
});

// TOURNAMENTS API
app.get('/api/tournaments', async (req, res) => {
  const tRes = await pool.query('SELECT * FROM tournaments');
  res.json(tRes.rows);
});

app.post('/api/tournaments', requireAdmin, async (req, res) => {
  const { 
    name, game_select, game_custom, start_time, twitch_url, 
    format_select, format_custom, team_count_select, team_count_custom, 
    prize_pool, prize_distribution, description 
  } = req.body;

  const finalGame = game_select === 'custom' ? game_custom : game_select;
  const finalFormat = format_select === 'custom' ? format_custom : format_select;
  const finalTeamCount = team_count_select === 'custom' ? parseInt(team_count_custom) || 8 : parseInt(team_count_select);

  const teamsRes = await pool.query('SELECT * FROM teams');
  const teams = teamsRes.rows;
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
      winner: null,
      map: 'TBD (Не выбрана)',
      match_time: '',
      stream_url: ''
    });
  }

  await pool.query(`
    INSERT INTO tournaments 
    (name, game, start_time, twitch_url, format, team_count, prize_pool, prize_distribution, description, status, matches)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
  `, [
    name, finalGame || 'Разное', start_time, twitch_url, 
    finalFormat || 'Single Elimination', finalTeamCount, 
    prize_pool || '0 $', prize_distribution || '', description || '', 
    JSON.stringify(matches)
  ]);

  res.redirect('/admin.html');
});

app.post('/api/tournaments/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const tRes = await pool.query('SELECT * FROM tournaments WHERE id = $1', [req.params.id]);
  const tournament = tRes.rows[0];
  
  if (tournament) {
    await pool.query('UPDATE tournaments SET status = $1 WHERE id = $2', [status, req.params.id]);
    
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

// МАТЧИ
app.post('/api/tournaments/:id/match', requireAdmin, async (req, res) => {
  const { matchId, score1, score2, winner, map, match_time, stream_url } = req.body;
  const tRes = await pool.query('SELECT * FROM tournaments WHERE id = $1', [req.params.id]);
  const tournament = tRes.rows[0];
  
  if (tournament) {
    const matches = typeof tournament.matches === 'string' ? JSON.parse(tournament.matches) : tournament.matches;
    const match = matches.find(m => m.id == matchId);
    
    if (match) {
      match.score1 = parseInt(score1) || 0;
      match.score2 = parseInt(score2) || 0;
      match.winner = winner || null;
      match.map = map || 'TBD (Не выбрана)';
      match.match_time = match_time || '';
      match.stream_url = stream_url || '';

      await pool.query('UPDATE tournaments SET matches = $1 WHERE id = $2', [JSON.stringify(matches), req.params.id]);
    }
  }
  res.redirect('/admin.html');
});

// TEAMS API
app.get('/api/teams', async (req, res) => {
  const teamsRes = await pool.query('SELECT * FROM teams');
  res.json(teamsRes.rows);
});

app.post('/api/teams', requireAuth, async (req, res) => {
  const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
  const currentUser = userRes.rows[0];
  
  if (!currentUser || (currentUser.role !== 'captain' && currentUser.role !== 'admin')) {
    return res.status(403).send('Только капитан команды или админ может регистрировать команду.');
  }

  const { name, tag, captain_name } = req.body;
  await pool.query(
    'INSERT INTO teams (name, tag, captain_name) VALUES ($1, $2, $3)',
    [name, tag, captain_name || currentUser.username]
  );
  
  res.redirect('/teams.html');
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
