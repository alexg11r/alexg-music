const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const STUDIO_KEY = process.env.STUDIO_KEY || 'wN56r';

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const AUDIO_DIR = path.join(UPLOADS_DIR, 'audio');
const COVERS_DIR = path.join(UPLOADS_DIR, 'covers');
const DB_PATH = path.join(DATA_DIR, 'db.json');

[PUBLIC_DIR, DATA_DIR, UPLOADS_DIR, AUDIO_DIR, COVERS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Generates atmospheric psychedelic / art-rock / slide-guitar WAV audio tracks
 */
function synthesizeArtRockWav(filePath, config) {
  const sampleRate = 22050;
  const durationSec = config.duration || 22;
  const numSamples = sampleRate * durationSec;
  const samples = new Float32Array(numSamples);

  const bpm = config.bpm || 84;
  const beatDur = 60 / bpm;
  const chords = config.chords;
  const slideNotes = config.slideNotes;
  const fuzz = config.fuzz || 1.35;
  const isRawDemo = Boolean(config.isRawDemo);

  const delaySamples1 = Math.floor(sampleRate * (beatDur * 0.75));
  const delaySamples2 = Math.floor(sampleRate * (beatDur * 1.5));
  const delayBuf = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const beatPos = t / beatDur;
    const barIndex = Math.floor(beatPos / 4);
    const chord = chords[barIndex % chords.length];

    let masterEnv = 1.0;
    if (t < 1.2) masterEnv = t / 1.2;
    if (t > durationSec - 2.2) masterEnv = Math.max(0, (durationSec - t) / 2.2);

    let droneSig = 0;
    const lfo = Math.sin(2 * Math.PI * 0.35 * t) * 0.5 + 0.5;
    const tapeDrift = Math.sin(2 * Math.PI * 2.1 * t) * 0.003;
    for (let c = 0; c < chord.length; c++) {
      const f = chord[c] * (1 + tapeDrift);
      const w1 = Math.sin(2 * Math.PI * f * t);
      const w2 = Math.sin(2 * Math.PI * (f * 1.004) * t);
      const overtone = 0.28 * Math.sin(2 * Math.PI * (f * 2) * t) * lfo;
      droneSig += (w1 * 0.5 + w2 * 0.5 + overtone) / chord.length;
    }

    const noteIndex = Math.floor(beatPos);
    const nextNoteIndex = noteIndex + 1;
    const notePhase = beatPos - noteIndex;
    const fStart = slideNotes[noteIndex % slideNotes.length];
    const fEnd = slideNotes[nextNoteIndex % slideNotes.length];
    const glideFactor = notePhase > 0.65 ? Math.pow((notePhase - 0.65) / 0.35, 2) : 0;
    const slideFreq = fStart + (fEnd - fStart) * glideFactor;
    const vibrato = Math.sin(2 * Math.PI * 5.4 * t) * 0.006;
    const instFreq = slideFreq * (1 + vibrato);

    const noteEnv = Math.sin(Math.PI * Math.min(1, notePhase * 1.15));
    const rawGuitar =
      Math.sin(2 * Math.PI * instFreq * t) +
      0.52 * Math.sin(2 * Math.PI * instFreq * 2 * t) +
      0.24 * Math.sin(2 * Math.PI * instFreq * 3 * t);
    const slideGuitarSig = Math.tanh(rawGuitar * fuzz) * (0.28 + 0.14 * noteEnv);

    const bassFreq = chord[0] * 0.5;
    const halfBeatPhase = (beatPos * 0.5) % 1;
    const bassEnv = Math.exp(-halfBeatPhase * 2.2);
    const bassSig = Math.tanh(Math.sin(2 * Math.PI * bassFreq * t) * 1.8) * bassEnv * 0.36;

    let drumSig = 0;
    if (!isRawDemo) {
      const beatInBar = beatPos % 4;
      const kickDist = Math.min(beatInBar, beatInBar >= 2.5 ? beatInBar - 2.5 : 99);
      const kickT = kickDist * beatDur;
      if (kickT >= 0 && kickT < 0.24) {
        const kFreq = 46 + 110 * Math.exp(-kickT * 34);
        drumSig += Math.sin(2 * Math.PI * kFreq * kickT) * Math.exp(-kickT * 12) * 0.45;
      }

      const rimDist = beatInBar >= 2.0 ? beatInBar - 2.0 : 99;
      const rimT = rimDist * beatDur;
      if (rimT >= 0 && rimT < 0.2) {
        const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const body = Math.sin(2 * Math.PI * 172 * rimT) * Math.exp(-rimT * 20);
        drumSig += noise * Math.exp(-rimT * 18) * 0.2 + body * 0.22;
      }
    }

    const dry = droneSig * 0.32 + slideGuitarSig * 0.48 + bassSig + drumSig;
    const echo1 = i >= delaySamples1 ? delayBuf[i - delaySamples1] * 0.38 : 0;
    const echo2 = i >= delaySamples2 ? delayBuf[i - delaySamples2] * 0.22 : 0;
    delayBuf[i] = dry + echo1;

    const wet = dry * 0.72 + echo1 + echo2;
    samples[i] = Math.tanh(wet * 1.15) * masterEnv * 0.86;
  }

  const numPeaks = 96;
  const blockSize = Math.floor(numSamples / numPeaks);
  const peaks = [];
  for (let p = 0; p < numPeaks; p++) {
    let sum = 0;
    const start = p * blockSize;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(samples[start + j] || 0);
    }
    peaks.push(sum / blockSize);
  }
  const maxPeak = Math.max(...peaks, 0.01);
  const normalizedPeaks = peaks.map((v) => Math.max(0.12, Number((v / maxPeak).toFixed(2))));

  const dataByteLength = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataByteLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteLength, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const intVal = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    buffer.writeInt16LE(Math.round(intVal), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
  return { duration: durationSec, peaks: normalizedPeaks };
}

function initializePortfolioData() {
  const presets = [
    {
      filename: 'psych-slide-vortex.wav',
      duration: 24,
      bpm: 78,
      fuzz: 1.55,
      chords: [
        [146.83, 220.0, 261.63, 329.63],
        [138.59, 207.65, 246.94, 329.63],
        [174.61, 220.0, 261.63, 349.23],
        [164.81, 207.65, 246.94, 329.63]
      ],
      slideNotes: [293.66, 329.63, 349.23, 440.0, 415.3, 329.63, 293.66, 246.94]
    },
    {
      filename: 'antistress-compromise-guitar.wav',
      duration: 22,
      bpm: 96,
      fuzz: 1.4,
      chords: [
        [164.81, 246.94, 293.66, 369.99],
        [196.0, 246.94, 293.66, 392.0],
        [220.0, 261.63, 329.63, 440.0],
        [185.0, 246.94, 293.66, 369.99]
      ],
      slideNotes: [329.63, 392.0, 493.88, 440.0, 392.0, 369.99, 329.63, 293.66]
    },
    {
      filename: 'art-rock-arrangement-03.wav',
      duration: 21,
      bpm: 88,
      fuzz: 1.3,
      chords: [
        [130.81, 196.0, 246.94, 311.13],
        [155.56, 233.08, 293.66, 392.0],
        [174.61, 207.65, 261.63, 349.23],
        [146.83, 196.0, 246.94, 349.23]
      ],
      slideNotes: [261.63, 311.13, 392.0, 466.16, 392.0, 349.23, 311.13, 293.66]
    },
    {
      filename: 'japan-answers-slide.wav',
      duration: 20,
      bpm: 74,
      fuzz: 1.2,
      isRawDemo: true,
      chords: [
        [185.0, 220.0, 277.18, 329.63],
        [146.83, 220.0, 277.18, 369.99],
        [164.81, 207.65, 246.94, 329.63],
        [138.59, 207.65, 246.94, 329.63]
      ],
      slideNotes: [369.99, 440.0, 554.37, 493.88, 440.0, 369.99, 329.63, 277.18]
    },
    {
      filename: 'raw-lespaul-2am-demo.wav',
      duration: 19,
      bpm: 82,
      fuzz: 1.15,
      isRawDemo: true,
      chords: [
        [220.0, 261.63, 329.63, 392.0],
        [174.61, 220.0, 261.63, 329.63],
        [146.83, 220.0, 261.63, 349.23],
        [164.81, 207.65, 246.94, 329.63]
      ],
      slideNotes: [440.0, 523.25, 659.25, 587.33, 523.25, 440.0, 392.0, 329.63]
    }
  ];

  let needsInit = !fs.existsSync(DB_PATH);
  if (!needsInit) {
    try {
      const existing = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (existing.version !== 3) {
        needsInit = true;
      }
    } catch {
      needsInit = true;
    }
  }

  if (needsInit) {
    const meta = {};
    for (const p of presets) {
      const outPath = path.join(AUDIO_DIR, p.filename);
      meta[p.filename] = synthesizeArtRockWav(outPath, p);
    }
    const db = {
      version: 3,
      profile: {
        name: 'Alex G',
        shortName: 'ALEX G',
        heroImage: '/assets/moodboard/hero-sketch.jpg',
        roleLine: 'ГИТАРА · СЛАЙД-ГИТАРА · АРАНЖИРОВКИ · АФИШИ & МЕРЧ',
        heroSubtitle: 'В свободном плавании. Коплю авторский материал на стыке психоделии и арт-рока, пишу гитарные партии и аранжировки, создаю концертные афиши и мерч.',
        city: 'Ростов-на-Дону / Москва',
        bio: 'Музыкант, гитарист, аранжировщик и визуальный автор. Сейчас нахожусь в свободном плавании — коплю и записываю собственный материал, экспериментирую с психоделическим звуком, открытыми строями, слайд-гитарой и арт-роковыми структурами. За плечами более 40 живых концертов и студийная работа (ранее играл на гитаре и слайд-гитаре в группе «Антистресс»). Параллельно создаю визуал для музыкальной сцены: разрабатываю концертные афиши, постеры для фестивалей, дизайн мерча и оформление релизов.',
        disciplines: [
          {
            num: '01',
            title: 'Гитарные партии и Слайд',
            desc: 'Сочинение и запись лид-партий, тягучего психоделического слайда, перегруженных риффов и эмбиент-слоёв. Кастомный Les Paul, открытые строи, живой ламповый и пространственный звук.',
            image: '/assets/moodboard/alex-guitar-bw.jpg'
          },
          {
            num: '02',
            title: 'Аранжировки и Накопление материала',
            desc: 'Развитие сырой идеи или черновика в полноценную композицию с драматургией, динамикой, нестандартной ритмикой и плотной арт-роковой фактурой.',
            image: '/assets/moodboard/live-stage-film.jpg'
          },
          {
            num: '03',
            title: 'Концертные афиши и Мерч',
            desc: 'Разработка стильных постеров и афиш для концертов, фестивалей и ночных перформансов, дизайн мерча и визуальное оформление физических и цифровых релизов.',
            image: '/assets/moodboard/poster-enter-the-void.jpg'
          }
        ],
        contacts: [
          { label: 'Telegram', url: 'https://t.me' },
          { label: 'VK', url: 'https://vk.ru' }
        ]
      },
      works: [
        {
          id: 'w-void',
          title: 'ENTER THE VOID — Electrospirt',
          category: 'Афиша / 3D-Арт',
          year: '2026',
          image: '/assets/moodboard/poster-enter-the-void.jpg',
          description: 'Постер для ночного аудио-перформанса: брутальная 3D-геометрия с шипами, глубокий красный бархат и минималистичная типографика.'
        },
        {
          id: 'w-midsummer',
          title: 'MIDSUMMER // ГОРИМ! — Клуб Мотыга',
          category: 'Концертный постер',
          year: '2026',
          image: '/assets/moodboard/poster-midsummer.jpg',
          description: 'Афиша московского летнего фестиваля альтернативной сцены: эстетика жидкого хрома и колючей проволоки.'
        },
        {
          id: 'w-podzemka',
          title: 'PODЗЕМКА 17.01 — Концертная афиша',
          category: 'Афиша / Коллаж',
          year: '2026',
          image: '/assets/moodboard/poster-podzemka.jpg',
          description: 'Фактурный гранж-коллаж с рваной бумагой, гитарными грифами и контрастной ручной леттеринг-типографикой.'
        },
        {
          id: 'w-borderline',
          title: 'BORD///R LINE & NOVA — The Rock Bar',
          category: 'Афиша презентации альбома',
          year: '2025',
          image: '/assets/moodboard/poster-borderline.jpg',
          description: 'Неоновый глитч-постер и хроматическая аберрация для клубной презентации дебютного альбома.'
        },
        {
          id: 'w-vortex',
          title: '«Красный водоворот»',
          category: 'Психоделический арт / Концепт',
          year: '2026',
          image: '/assets/moodboard/vortex-art.jpg',
          description: 'Визуальный образ и эстетический ориентир для нового материала: сюрреализм, сакральная геометрия и тёмная психоделия.'
        },
        {
          id: 'w-posters-set',
          title: 'Серия афиш (Winter Noise и др.)',
          category: 'Дизайн постеров',
          year: '2025–2026',
          image: '/assets/moodboard/posters-work.jpg',
          description: 'Витрина разработанных афиш и постеров для концертов, фестивалей и вечеринок.'
        }
      ],
      tracks: [
        {
          id: 'trk-1',
          title: 'Красный водоворот (Slide Guitar Etude)',
          category: 'guitar',
          categoryLabel: 'Слайд-гитара / Психоделия',
          context: 'Накопление сольного материала',
          audioUrl: '/uploads/audio/psych-slide-vortex.wav',
          coverImage: '/assets/moodboard/vortex-art.jpg',
          duration: meta['psych-slide-vortex.wav'].duration,
          bpm: 78,
          musicalKey: 'Dm',
          gearUsed: 'Кастомный Les Paul, металлический слайд, аналоговый фузз и ленточный дилей',
          note: 'Тягучая психоделическая партия слайд-гитары с плавными глиссандо и глубоким пространственным эхом.',
          peaks: meta['psych-slide-vortex.wav'].peaks,
          comments: [
            { id: 'c-1', author: 'Alex G', timestamp: 4.2, text: 'Вход слайд-гитары с длинным хвостом дилея' },
            { id: 'c-2', author: 'Слушатель', timestamp: 13.5, text: 'Гипнотическое скольжение по ладам' }
          ]
        },
        {
          id: 'trk-2',
          title: 'Свободное плавание — Гитарная тема и фузз',
          category: 'guitar',
          categoryLabel: 'Гитарная партия',
          context: 'Авторский архив // Новый материал',
          audioUrl: '/uploads/audio/antistress-compromise-guitar.wav',
          coverImage: '/assets/moodboard/alex-guitar-bw.jpg',
          duration: meta['antistress-compromise-guitar.wav'].duration,
          bpm: 96,
          musicalKey: 'Em',
          gearUsed: 'Les Paul Custom, ламповый перегруз, стерео-реверберация',
          note: 'Сочетание плотного аккордового фундамента и мелодической лид-линии в верхнем регистре.',
          peaks: meta['antistress-compromise-guitar.wav'].peaks,
          comments: [
            { id: 'c-3', author: 'Alex G', timestamp: 7.0, text: 'Переход на верхний регистр с дабл-треком' }
          ]
        },
        {
          id: 'trk-3',
          title: 'Геометрия пустоты (Арт-рок аранжировка #03)',
          category: 'arrangement',
          categoryLabel: 'Аранжировка',
          context: 'Авторская аранжировка',
          audioUrl: '/uploads/audio/art-rock-arrangement-03.wav',
          coverImage: '/assets/moodboard/poster-enter-the-void.jpg',
          duration: meta['art-rock-arrangement-03.wav'].duration,
          bpm: 88,
          musicalKey: 'Cm',
          gearUsed: 'Две гитары, басовый дрон, перкуссия, пространственная обработка',
          note: 'Построение аранжировки с нуля: минималистичный рифф постепенно обрастает полифонией и плотным гитарным пространством.',
          peaks: meta['art-rock-arrangement-03.wav'].peaks,
          comments: []
        },
        {
          id: 'trk-4',
          title: 'Горизонт — Слайд и эмбиент-текстуры',
          category: 'arrangement',
          categoryLabel: 'Слайд & Аранжировка',
          context: 'Инструментальная зарисовка',
          audioUrl: '/uploads/audio/japan-answers-slide.wav',
          coverImage: '/assets/moodboard/live-stage-film.jpg',
          duration: meta['japan-answers-slide.wav'].duration,
          bpm: 74,
          musicalKey: 'F#m',
          gearUsed: 'Слайд-гитара, аналоговый хорус, длинный hall-реверб',
          note: 'Медленная, парящая партия без ударных, построенная на обертонах и естественном затухании струн.',
          peaks: meta['japan-answers-slide.wav'].peaks,
          comments: []
        },
        {
          id: 'trk-5',
          title: 'Ночной черновик 02:40 (Raw Demo)',
          category: 'demo',
          categoryLabel: 'Демка / Набросок',
          context: 'Копилка идей',
          audioUrl: '/uploads/audio/raw-lespaul-2am-demo.wav',
          coverImage: '/assets/moodboard/poster-midsummer.jpg',
          duration: meta['raw-lespaul-2am-demo.wav'].duration,
          bpm: 82,
          musicalKey: 'Am',
          gearUsed: 'Гитара напрямую в интерфейс, пружинный реверб',
          note: 'Сырая ночная идея для будущей композиции, записанная с первого дубля.',
          peaks: meta['raw-lespaul-2am-demo.wav'].peaks,
          comments: []
        }
      ]
    };

    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  }
}

initializePortfolioData();

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function isOwnerAuthorized(req) {
  const key = req.headers['x-studio-key'] || '';
  return key === STUDIO_KEY;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm'
};

function serveStaticFile(req, res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range && contentType.startsWith('audio/')) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (isNaN(start) || start >= stat.size || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, readDb());
    }

    // Verify Owner Key endpoint
    if (pathname === '/api/auth' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      if ((body.key || '').trim() === STUDIO_KEY) {
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 401, { error: 'Неверный ключ автора' });
    }

    // Owner-only: One-click Git commit & push to GitHub Pages
    if (pathname === '/api/publish-github' && req.method === 'POST') {
      if (!isOwnerAuthorized(req)) {
        return sendJson(res, 403, { error: 'Доступно только автору' });
      }
      exec(
        'git add -A && git diff-index --quiet HEAD || git commit -m "Update portfolio from Author Cabinet" && git push origin main',
        { cwd: ROOT_DIR },
        (err, stdout, stderr) => {
          if (err) {
            return sendJson(res, 500, { error: 'Ошибка выгрузки на GitHub', details: stderr || err.message });
          }
          return sendJson(res, 200, { ok: true, output: stdout });
        }
      );
      return;
    }

    // Owner-only: Upload audio or image file
    if (pathname === '/api/upload-file' && req.method === 'POST') {
      if (!isOwnerAuthorized(req)) {
        return sendJson(res, 403, { error: 'Доступно только автору сайта (Alex G)' });
      }
      const kind = parsedUrl.searchParams.get('kind') || 'audio';
      const origName = parsedUrl.searchParams.get('name') || (kind === 'cover' ? 'art.jpg' : 'demo.wav');
      const safeExt = path.extname(origName).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase() || (kind === 'cover' ? '.jpg' : '.wav');
      const baseSlug = path
        .basename(origName, path.extname(origName))
        .toLowerCase()
        .replace(/[^a-z0-9а-яё_-]/gi, '-')
        .slice(0, 36) || kind;

      const uniqueName = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${baseSlug}${safeExt}`;
      const targetFolder = kind === 'cover' ? COVERS_DIR : AUDIO_DIR;
      const targetPath = path.join(targetFolder, uniqueName);

      const rawBuffer = await parseRawBody(req);
      if (!rawBuffer || rawBuffer.length === 0) {
        return sendJson(res, 400, { error: 'Пустой файл' });
      }
      fs.writeFileSync(targetPath, rawBuffer);
      const publicUrl = `/uploads/${kind === 'cover' ? 'covers' : 'audio'}/${uniqueName}`;
      return sendJson(res, 200, { url: publicUrl, filename: uniqueName });
    }

    // Owner-only: Create new track / demo
    if (pathname === '/api/tracks' && req.method === 'POST') {
      if (!isOwnerAuthorized(req)) {
        return sendJson(res, 403, { error: 'Загрузка демок доступна только владельцу сайта' });
      }
      const body = await parseJsonBody(req);
      const db = readDb();

      let audioUrl = body.audioUrl;
      let duration = Number(body.duration) || 20;
      let peaks = Array.isArray(body.peaks) && body.peaks.length > 10 ? body.peaks : null;

      if (!audioUrl) {
        const autoFile = `demo-artrock-${Date.now()}.wav`;
        const synthResult = synthesizeArtRockWav(path.join(AUDIO_DIR, autoFile), {
          duration: 20,
          bpm: Number(body.bpm) || 84,
          isRawDemo: body.category === 'demo',
          chords: [
            [146.83, 220.0, 261.63, 329.63],
            [174.61, 220.0, 261.63, 349.23],
            [164.81, 246.94, 293.66, 369.99],
            [138.59, 207.65, 246.94, 329.63]
          ],
          slideNotes: [293.66, 349.23, 440.0, 523.25, 440.0, 349.23, 329.63, 293.66]
        });
        audioUrl = `/uploads/audio/${autoFile}`;
        duration = synthResult.duration;
        peaks = synthResult.peaks;
      }

      if (!peaks) {
        peaks = Array.from({ length: 96 }, (_, idx) =>
          Number((0.2 + 0.7 * Math.abs(Math.sin(idx * 0.23) * Math.cos(idx * 0.09))).toFixed(2))
        );
      }

      const catLabels = {
        guitar: 'Гитарная партия / Слайд',
        arrangement: 'Аранжировка',
        demo: 'Демка / Набросок'
      };

      const newTrack = {
        id: 'trk-' + Date.now(),
        title: (body.title || 'Новый набросок').trim(),
        category: body.category || 'demo',
        categoryLabel: catLabels[body.category] || 'Демка / Набросок',
        context: (body.context || 'Копилка материала').trim(),
        audioUrl,
        coverImage: body.coverImage || '/assets/moodboard/vortex-art.jpg',
        duration: Math.max(1, Math.round(duration)),
        bpm: Number(body.bpm) || 85,
        musicalKey: (body.musicalKey || 'Dm').trim(),
        gearUsed: (body.gearUsed || 'Кастомный Les Paul, педалборд').trim(),
        note: (body.note || '').trim(),
        peaks,
        comments: []
      };

      db.tracks.unshift(newTrack);
      writeDb(db);
      return sendJson(res, 201, { track: newTrack });
    }

    // Owner-only: Update track (cover image, title, note, gear, etc.)
    if (pathname.startsWith('/api/tracks/') && !pathname.endsWith('/comments') && req.method === 'PUT') {
      if (!isOwnerAuthorized(req)) {
        return sendJson(res, 403, { error: 'Изменение обложки и трека доступно только автору' });
      }
      const trackId = pathname.split('/')[3];
      const body = await parseJsonBody(req);
      const db = readDb();
      const track = db.tracks.find((t) => t.id === trackId);
      if (!track) return sendJson(res, 404, { error: 'Трек не найден' });

      const catLabels = {
        guitar: 'Гитарная партия / Слайд',
        arrangement: 'Аранжировка',
        demo: 'Демка / Набросок'
      };

      ['title', 'category', 'context', 'coverImage', 'bpm', 'musicalKey', 'gearUsed', 'note'].forEach((k) => {
        if (body[k] !== undefined) {
          track[k] = body[k];
        }
      });
      if (body.category && catLabels[body.category]) {
        track.categoryLabel = catLabels[body.category];
      }

      writeDb(db);
      return sendJson(res, 200, { track });
    }

    // Owner-only: Delete track
    if (pathname.startsWith('/api/tracks/') && req.method === 'DELETE') {
      if (!isOwnerAuthorized(req)) {
        return sendJson(res, 403, { error: 'Удаление доступно только автору' });
      }
      const trackId = pathname.split('/')[3];
      const db = readDb();
      db.tracks = db.tracks.filter((t) => t.id !== trackId);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    // Public: Listeners can still leave a timestamped reaction/note on a track
    if (pathname.match(/^\/api\/tracks\/[^/]+\/comments$/) && req.method === 'POST') {
      const trackId = pathname.split('/')[3];
      const body = await parseJsonBody(req);
      const db = readDb();
      const track = db.tracks.find((t) => t.id === trackId);
      if (!track) return sendJson(res, 404, { error: 'Трек не найден' });

      const comment = {
        id: 'c-' + Date.now(),
        author: (body.author || 'Слушатель').trim(),
        timestamp: Math.max(0, Number(body.timestamp) || 0),
        text: (body.text || '').trim()
      };
      track.comments = track.comments || [];
      track.comments.push(comment);
      track.comments.sort((a, b) => a.timestamp - b.timestamp);
      writeDb(db);
      return sendJson(res, 201, { comment, track });
    }

    // Owner-only: Add visual work / poster
    if (pathname === '/api/works' && req.method === 'POST') {
      if (!isOwnerAuthorized(req)) {
        return sendJson(res, 403, { error: 'Управление портфолио доступно только автору' });
      }
      const body = await parseJsonBody(req);
      const db = readDb();
      const work = {
        id: 'w-' + Date.now(),
        title: (body.title || 'Новая афиша / работа').trim(),
        category: (body.category || 'Концертная афиша').trim(),
        year: (body.year || '2026').trim(),
        image: body.image || '/assets/moodboard/poster-enter-the-void.jpg',
        description: (body.description || '').trim()
      };
      db.works.unshift(work);
      writeDb(db);
      return sendJson(res, 201, { work });
    }

    // Owner-only: Delete visual work
    if (pathname.startsWith('/api/works/') && req.method === 'DELETE') {
      if (!isOwnerAuthorized(req)) {
        return sendJson(res, 403, { error: 'Удаление доступно только автору' });
      }
      const workId = pathname.split('/')[3];
      const db = readDb();
      db.works = db.works.filter((w) => w.id !== workId);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    // Owner-only: Update profile, hero, bio, or direction blocks
    if (pathname === '/api/profile' && req.method === 'PUT') {
      if (!isOwnerAuthorized(req)) {
        return sendJson(res, 403, { error: 'Редактирование блоков доступно только автору' });
      }
      const body = await parseJsonBody(req);
      const db = readDb();
      db.profile = { ...db.profile, ...body };
      writeDb(db);
      return sendJson(res, 200, { profile: db.profile });
    }

    if (pathname.startsWith('/uploads/')) {
      const rel = pathname.replace(/^\/uploads\//, '');
      const safePath = path.normalize(path.join(UPLOADS_DIR, rel));
      if (!safePath.startsWith(UPLOADS_DIR)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      return serveStaticFile(req, res, safePath);
    }

    const targetFile = pathname === '/'
      ? path.join(PUBLIC_DIR, 'index.html')
      : path.normalize(path.join(PUBLIC_DIR, pathname));

    if (!targetFile.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    return serveStaticFile(req, res, targetFile);
  } catch (err) {
    console.error('Server error:', err);
    return sendJson(res, 500, { error: 'Ошибка сервера', details: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`ALEX G // PORTFOLIO SERVER RUNNING AT http://localhost:${PORT}`);
});
