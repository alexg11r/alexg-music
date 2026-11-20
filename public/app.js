(() => {
  'use strict';

  const state = {
    profile: null,
    works: [],
    tracks: [],
    currentTrackId: null,
    expandedTrackId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 22,
    categoryFilter: 'all',
    hoverRatio: null,
    mouseX: 0.5,
    mouseY: 0.5,
    // Owner Auth state
    isOwner: false,
    studioKey: localStorage.getItem('alexg_studio_key') || '',
    // Author Cabinet working copy of disciplines & offers
    cabinetDisciplines: [],
    cabinetOffers: [],
    // Upload demo state
    pendingAudioFile: null,
    pendingPeaks: null,
    pendingDuration: null,
    pendingDemoCoverFile: null,
    // Change existing track cover state
    editingCoverTrackId: null,
    pendingTrackCoverFile: null,
    selectedPresetCoverUrl: '',
    // Add visual work state
    pendingWorkImage: null,
    mediaRecorder: null,
    recordedChunks: []
  };

  const audioEl = new Audio();
  audioEl.crossOrigin = 'anonymous';
  audioEl.preload = 'metadata';

  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let timeData = null;

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function resolveAssetUrl(u) {
    if (!u || /^https?:\/\//i.test(u) || u.startsWith('blob:') || u.startsWith('data:')) {
      return u || '';
    }
    return u.replace(/^\//, '');
  }

  function showToast(text) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast-msg';
    el.textContent = text;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function getCurrentTrack() {
    return state.tracks.find((t) => t.id === state.currentTrackId) || state.tracks[0] || null;
  }

  function getFeaturedHeroTrack() {
    const featId = state.profile?.featuredTrackId;
    if (featId) {
      const found = state.tracks.find((t) => t.id === featId);
      if (found) return found;
    }
    return state.tracks[0] || null;
  }

  const OWNER_KEY_SHA256 = '0d0c93964e2d4a4810ac14c019c48268299482f4ac0493297c06fe321ba153b3';

  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function verifyOwnerKeyValue(key) {
    if (!key) return false;
    try {
      const res = await fetch('api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      if (res.ok) return true;
      if (res.status === 401) return false;
    } catch {
      // Static host (e.g. GitHub Pages)
    }
    const hash = await sha256Hex(key);
    return hash === OWNER_KEY_SHA256;
  }

  function saveStaticOverride() {
    try {
      localStorage.setItem(
        'alexg_static_db_override',
        JSON.stringify({
          profile: state.profile,
          works: state.works,
          tracks: state.tracks
        })
      );
    } catch {
      // ignore quota error
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function authHeaders(extra = {}) {
    return {
      ...extra,
      'x-studio-key': state.studioKey || ''
    };
  }

  async function uploadImageFileToServer(file) {
    try {
      const res = await fetch(
        `api/upload-file?kind=cover&name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: file
        }
      );
      if (res.ok) {
        const data = await res.json();
        return data.url;
      }
    } catch {
      // Static fallback
    }
    return await fileToDataUrl(file);
  }

  async function verifyStoredOwnerKey() {
    if (!state.studioKey) {
      applyOwnerModeUI(false);
      return;
    }
    const ok = await verifyOwnerKeyValue(state.studioKey);
    if (ok) {
      applyOwnerModeUI(true);
    } else {
      state.studioKey = '';
      localStorage.removeItem('alexg_studio_key');
      applyOwnerModeUI(false);
    }
  }

  function applyOwnerModeUI(isOwner) {
    state.isOwner = isOwner;
    document.querySelectorAll('.owner-only').forEach((el) => {
      el.classList.toggle('hidden', !isOwner);
    });
    const authBtn = document.getElementById('ownerAuthBtn');
    if (authBtn) {
      authBtn.classList.toggle('is-owner', isOwner);
      authBtn.textContent = isOwner ? '🔓 Выйти' : '🔒 Автор';
      authBtn.title = isOwner
        ? 'Активен режим владельца Alex G. Нажмите, чтобы выйти в режим посетителя'
        : 'Вход для владельца сайта';
    }
    renderTracksArchive();
    renderVisualWorks();
  }

  function ensureWebAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      const src = audioCtx.createMediaElementSource(audioEl);
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      console.warn('Web Audio API fallback:', e);
    }
  }

  async function loadInitialState() {
    let data;
    try {
      const res = await fetch('api/state');
      if (!res.ok) throw new Error('Static fallback');
      data = await res.json();
    } catch {
      const resFallback = await fetch('data/db.json');
      data = await resFallback.json();
      try {
        const localOverride = JSON.parse(localStorage.getItem('alexg_static_db_override') || 'null');
        if (localOverride && localOverride.profile) {
          data = localOverride;
        }
      } catch {
        // ignore
      }
    }
    state.profile = data.profile;
    state.works = data.works || [];
    state.tracks = data.tracks || [];

    if (state.tracks.length && !state.currentTrackId) {
      selectTrack(state.tracks[0].id, false);
    }
    await verifyStoredOwnerKey();
    renderAll();
  }

  function renderAll() {
    renderProfileAndCraft();
    renderTracksArchive();
    renderVisualWorks();
    renderAudioBar();
  }

  // ==========================================================================
  // RENDER PROFILE, HERO PHOTOS & CRAFT DIRECTIONS
  // ==========================================================================
  function renderProfileAndCraft() {
    const p = state.profile;
    if (!p) return;

    const heroMain = document.getElementById('heroMainArt');
    if (heroMain) {
      heroMain.src = resolveAssetUrl(p.heroImage || '/assets/moodboard/hero-sketch.jpg');
    }
    const heroSec = document.getElementById('heroSecondaryArt');
    if (heroSec) {
      heroSec.src = resolveAssetUrl(p.heroSecondaryImage || '/assets/moodboard/alex-guitar-bw.jpg');
    }
    const heroCaptionEl = document.getElementById('heroArtCaptionText');
    if (heroCaptionEl) {
      heroCaptionEl.textContent = p.heroArtCaption || 'Art by Rusya для нового альбома';
    }

    updatePlayButtonsUI();

    document.getElementById('heroRoleLine').textContent = p.roleLine || '';
    document.getElementById('heroSubtitleText').textContent = p.heroSubtitle || '';
    document.getElementById('aboutHeadingName').textContent = p.name || 'Alex G';
    document.getElementById('aboutCityText').textContent = `${p.city || 'Ростов-на-Дону / Москва'} · Свободное плавание`;

    const antistressUrl =
      p.antistressUrl ||
      'https://vk.ru/antistressvibe?search_track_code=095fd038Kf2oTAsl7eGQCoi1yi-6oFmNK76OT5GHdP1-TtXpnuhBYjPpsdARJzgw8LfZOLOTWZ4cqJlxhJZz12lP5euH73Z-I--Y3hctJkOf-5lq6PQH20D60yiOhW7JfE68';

    const safeBio = (p.bio || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const linkedBio = safeBio.replace(
      /«Антистресс»|Антистресс/g,
      (match) =>
        `<a href="${antistressUrl}" target="_blank" rel="noopener" class="bio-inline-link">${match} ↗</a>`
    );
    document.getElementById('aboutBioParagraph').innerHTML = linkedBio;

    const aboutImg1 = document.getElementById('aboutPhoto1Img');
    if (aboutImg1) aboutImg1.src = resolveAssetUrl(p.aboutPhoto1 || '/assets/moodboard/alex-guitar-bw.jpg');
    const aboutImg2 = document.getElementById('aboutPhoto2Img');
    if (aboutImg2) aboutImg2.src = resolveAssetUrl(p.aboutPhoto2 || '/assets/moodboard/antistress-compromise-cover.jpg');
    const aboutLink2 = document.getElementById('aboutPhoto2Link');
    if (aboutLink2) aboutLink2.href = antistressUrl;

    // Offers in About section
    const defaultOffers = [
      { label: 'ГИТАРА И СЛАЙД', text: 'Сочинение и запись гитарных партий, слайд-гитары, психоделических текстур и соло' },
      { label: 'АРАНЖИРОВКИ', text: 'Доработка демок, построение структуры, драматургии и гитарного пространства трека' },
      { label: 'АФИШИ И МЕРЧ', text: 'Разработка стильных постеров и афиш для концертов и фестивалей, дизайн мерча и обложек' }
    ];
    const offers = Array.isArray(p.offers) && p.offers.length ? p.offers : defaultOffers;
    const offersContainer = document.getElementById('aboutOffersContainer');
    if (offersContainer) {
      offersContainer.innerHTML = offers
        .map(
          (o) => `
          <div class="offer-row">
            <span class="mono-small">${o.label}</span>
            <span>${o.text}</span>
          </div>`
        )
        .join('');
    }

    // Craft / Directions Grid
    const romans = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    const craftGrid = document.getElementById('craftGrid');
    craftGrid.innerHTML = (p.disciplines || [])
      .map(
        (d, idx) => `
        <article class="craft-card">
          <div>
            <span class="craft-num">${romans[idx] || d.num || idx + 1}</span>
            <h3 class="craft-title">${d.title}</h3>
            <p class="craft-desc">${d.desc}</p>
          </div>
          <div class="craft-img-wrap">
            <img src="${resolveAssetUrl(d.image || '/assets/moodboard/alex-guitar-bw.jpg')}" alt="${d.title}" loading="lazy" />
          </div>
        </article>`
      )
      .join('');

    const contactsEl = document.getElementById('aboutContactsList');
    contactsEl.innerHTML = (p.contacts || [])
      .map(
        (c) =>
          `<a href="${c.url}" target="_blank" rel="noopener" class="btn-minimal btn-minimal--sm">${c.label} ↗</a>`
      )
      .join('');
  }

  // ==========================================================================
  // AUTHOR CABINET (КАБИНЕТ АВТОРА: Фото, Блоки, Описание)
  // ==========================================================================
  function openAuthorCabinet(initialTab = 'hero') {
    if (!state.isOwner || !state.profile) return;
    const p = state.profile;

    // Switch tab
    switchCabinetTab(initialTab);

    // 1. Populate Hero Tab
    const mainUrl = p.heroImage || '/assets/moodboard/hero-sketch.jpg';
    const secUrl = p.heroSecondaryImage || '/assets/moodboard/alex-guitar-bw.jpg';
    document.getElementById('cabHeroMainPreview').src = mainUrl;
    document.getElementById('cabHeroMainUrl').value = mainUrl;
    document.getElementById('cabHeroSecPreview').src = secUrl;
    document.getElementById('cabHeroSecUrl').value = secUrl;
    document.getElementById('cabRoleLineInput').value = p.roleLine || '';
    document.getElementById('cabHeroSubtitleInput').value = p.heroSubtitle || '';
    document.getElementById('cabHeroArtCaptionInput').value = p.heroArtCaption || 'Art by Rusya для нового альбома';

    const featSelect = document.getElementById('cabFeaturedTrackSelect');
    if (featSelect) {
      const currentFeatId = getFeaturedHeroTrack()?.id || '';
      featSelect.innerHTML = state.tracks
        .map(
          (t) =>
            `<option value="${t.id}" ${t.id === currentFeatId ? 'selected' : ''}>${t.title}</option>`
        )
        .join('');
    }

    // 2. Populate Direction Blocks Tab
    state.cabinetDisciplines = JSON.parse(JSON.stringify(p.disciplines || []));
    renderCabinetBlocksEditor();

    // 3. Populate About & Description Tab
    document.getElementById('cabNameInput').value = p.name || 'Alex G';
    document.getElementById('cabCityInput').value = p.city || 'Ростов-на-Дону / Москва';
    document.getElementById('cabBioInput').value = p.bio || '';

    const ab1 = p.aboutPhoto1 || '/assets/moodboard/alex-guitar-bw.jpg';
    const ab2 = p.aboutPhoto2 || '/assets/moodboard/live-stage-film.jpg';
    document.getElementById('cabAboutPhoto1Preview').src = ab1;
    document.getElementById('cabAboutPhoto1Url').value = ab1;
    document.getElementById('cabAboutPhoto2Preview').src = ab2;
    document.getElementById('cabAboutPhoto2Url').value = ab2;

    const defaultOffers = [
      { label: 'ГИТАРА И СЛАЙД', text: 'Сочинение и запись гитарных партий, слайд-гитары, психоделических текстур и соло' },
      { label: 'АРАНЖИРОВКИ', text: 'Доработка демок, построение структуры, драматургии и гитарного пространства трека' },
      { label: 'АФИШИ И МЕРЧ', text: 'Разработка стильных постеров и афиш для концертов и фестивалей, дизайн мерча и обложек' }
    ];
    state.cabinetOffers = JSON.parse(
      JSON.stringify(Array.isArray(p.offers) && p.offers.length ? p.offers : defaultOffers)
    );
    renderCabinetOffersEditor();

    document.getElementById('authorCabinetModal').classList.remove('hidden');
  }

  function switchCabinetTab(tabName) {
    document.querySelectorAll('#cabinetTabs .cab-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cabtab === tabName);
    });
    document.getElementById('cabPaneHero').classList.toggle('active', tabName === 'hero');
    document.getElementById('cabPaneBlocks').classList.toggle('active', tabName === 'blocks');
    document.getElementById('cabPaneAbout').classList.toggle('active', tabName === 'about');
  }

  function renderCabinetBlocksEditor() {
    const container = document.getElementById('cabBlocksList');
    if (!container) return;

    container.innerHTML =
      state.cabinetDisciplines
        .map(
          (blk, idx) => `
        <div class="cab-block-item" data-idx="${idx}">
          <div class="cab-block-header">
            <span class="mono-small" style="color:var(--crimson-bright);">БЛОК НАПРАВЛЕНИЯ #${idx + 1}</span>
            ${
              state.cabinetDisciplines.length > 1
                ? `<button type="button" class="text-action-btn js-remove-cab-block" data-idx="${idx}" style="color:var(--crimson-bright);">Удалить блок</button>`
                : ''
            }
          </div>
          <div class="form-grid-2">
            <div class="field">
              <label>Заголовок блока</label>
              <input type="text" class="js-cab-blk-title" data-idx="${idx}" value="${(blk.title || '').replace(/"/g, '&quot;')}" required />
            </div>
            <div class="field">
              <label>Фотография блока</label>
              <div class="cab-photo-row">
                <img src="${blk.image || '/assets/moodboard/alex-guitar-bw.jpg'}" alt="Фото блока" class="cab-thumb js-cab-blk-img" data-idx="${idx}" style="width:46px; height:46px;" />
                <div class="cab-photo-controls">
                  <input type="file" class="js-cab-blk-file" data-idx="${idx}" accept="image/*" hidden />
                  <button type="button" class="btn-minimal btn-minimal--sm js-cab-blk-upload" data-idx="${idx}">Загрузить фото</button>
                </div>
              </div>
            </div>
          </div>
          <div class="field">
            <label>Описание блока</label>
            <textarea class="js-cab-blk-desc" data-idx="${idx}" rows="2">${blk.desc || ''}</textarea>
          </div>
        </div>`
        )
        .join('') +
      `<button type="button" class="btn-minimal btn-minimal--sm" id="addCabBlockBtn" style="align-self:flex-start;">+ Добавить ещё один блок направления</button>`;

    container.querySelectorAll('.js-cab-blk-title').forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = Number(inp.dataset.idx);
        state.cabinetDisciplines[i].title = inp.value;
      });
    });

    container.querySelectorAll('.js-cab-blk-desc').forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = Number(inp.dataset.idx);
        state.cabinetDisciplines[i].desc = inp.value;
      });
    });

    container.querySelectorAll('.js-remove-cab-block').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        state.cabinetDisciplines.splice(i, 1);
        renderCabinetBlocksEditor();
      });
    });

    container.querySelectorAll('.js-cab-blk-upload').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        const fileInp = container.querySelector(`.js-cab-blk-file[data-idx="${i}"]`);
        if (fileInp) fileInp.click();
      });
    });

    container.querySelectorAll('.js-cab-blk-file').forEach((fileInp) => {
      fileInp.addEventListener('change', async () => {
        const i = Number(fileInp.dataset.idx);
        const file = fileInp.files?.[0];
        if (!file) return;
        try {
          showToast('Загрузка фото блока...');
          const url = await uploadImageFileToServer(file);
          state.cabinetDisciplines[i].image = url;
          renderCabinetBlocksEditor();
          showToast('Фото блока загружено');
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    const addBtn = document.getElementById('addCabBlockBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        state.cabinetDisciplines.push({
          num: String(state.cabinetDisciplines.length + 1).padStart(2, '0'),
          title: 'Новое направление',
          desc: 'Описание направления деятельности...',
          image: '/assets/moodboard/poster-enter-the-void.jpg'
        });
        renderCabinetBlocksEditor();
      });
    }
  }

  function renderCabinetOffersEditor() {
    const container = document.getElementById('cabOffersList');
    if (!container) return;
    container.innerHTML = state.cabinetOffers
      .map(
        (o, idx) => `
        <div class="form-grid-3" style="grid-template-columns: 0.45fr 1fr;">
          <input type="text" class="js-cab-offer-label" data-idx="${idx}" value="${(o.label || '').replace(/"/g, '&quot;')}" placeholder="НАПРАВЛЕНИЕ" />
          <input type="text" class="js-cab-offer-text" data-idx="${idx}" value="${(o.text || '').replace(/"/g, '&quot;')}" placeholder="Описание..." />
        </div>`
      )
      .join('');

    container.querySelectorAll('.js-cab-offer-label').forEach((inp) => {
      inp.addEventListener('input', () => {
        state.cabinetOffers[Number(inp.dataset.idx)].label = inp.value;
      });
    });
    container.querySelectorAll('.js-cab-offer-text').forEach((inp) => {
      inp.addEventListener('input', () => {
        state.cabinetOffers[Number(inp.dataset.idx)].text = inp.value;
      });
    });
  }

  // ==========================================================================
  // RENDER AUDIO ARCHIVE (GUITAR PARTS, ARRANGEMENTS, DEMOS)
  // ==========================================================================
  function renderTracksArchive() {
    const container = document.getElementById('tracksContainer');
    if (!container) return;
    const filtered = state.tracks.filter((t) =>
      state.categoryFilter === 'all' ? true : t.category === state.categoryFilter
    );

    if (!filtered.length) {
      container.innerHTML = `<div style="padding:36px 0; color:var(--text-muted); font-family:var(--font-mono); font-size:0.78rem;">В этом разделе пока нет записей.</div>`;
      return;
    }

    container.innerHTML = filtered
      .map((t, idx) => {
        const isCurrent = t.id === state.currentTrackId;
        const isPlayingThis = isCurrent && state.isPlaying;
        const isExpanded = t.id === state.expandedTrackId;
        const numStr = String(idx + 1).padStart(2, '0');
        const playRatio = isCurrent && state.duration > 0 ? state.currentTime / state.duration : 0;

        const samplePeaks = (t.peaks || []).filter((_, i) => i % 2 === 0).slice(0, 48);
        const barsHtml = samplePeaks
          .map((p, bIdx) => {
            const r = bIdx / samplePeaks.length;
            const played = isCurrent && r <= playRatio ? 'played' : '';
            const h = Math.max(4, Math.round(p * 26));
            return `<span class="row-wave-bar ${played}" style="height:${h}px"></span>`;
          })
          .join('');

        return `
        <div class="track-item ${isCurrent ? 'is-active' : ''}" data-track-id="${t.id}">
          <div class="track-row">
            <button type="button" class="track-idx-btn js-play-track" data-id="${t.id}" title="Слушать / Пауза">
              ${isPlayingThis ? '❚❚' : isCurrent ? '▶' : numStr}
            </button>

            <img
              src="${resolveAssetUrl(t.coverImage || '/assets/moodboard/hero-sketch.jpg')}"
              alt="${t.title}"
              class="track-thumb ${state.isOwner ? 'owner-clickable js-change-cover' : ''}"
              data-id="${t.id}"
              title="${state.isOwner ? 'Нажмите, чтобы сменить обложку и описание трека' : t.title}"
            />

            <div class="track-primary">
              <div class="track-name js-play-track" data-id="${t.id}">${t.title}</div>
              <div class="track-sub">
                <span>${t.categoryLabel}</span> · ${t.context || 'Аудио-архив'}
              </div>
            </div>

            <div class="row-waveform js-row-seek" data-id="${t.id}" title="Перемотать">
              ${barsHtml}
            </div>

            <div class="track-tech">
              ${t.bpm} BPM · ${t.musicalKey} · ${formatTime(t.duration)}
            </div>

            <div class="track-actions-cell">
              ${
                state.isOwner
                  ? `<button type="button" class="row-expand-btn js-set-featured" data-id="${t.id}" style="${getFeaturedHeroTrack()?.id === t.id ? 'border-color:var(--crimson-bright); color:var(--parchment); background:rgba(200,40,41,0.18);' : ''}" title="Выбрать этот трек для кнопки Play на главном экране">${getFeaturedHeroTrack()?.id === t.id ? '★ На главном' : '☆ На главный'}</button>`
                  : ''
              }
              ${
                state.isOwner
                  ? `<button type="button" class="row-expand-btn js-change-cover" data-id="${t.id}" title="Сменить обложку и описание трека">Обложка / Править</button>`
                  : ''
              }
              <button type="button" class="row-expand-btn js-toggle-drawer" data-id="${t.id}">
                ${isExpanded ? 'Скрыть' : 'Детали'}
              </button>
              ${
                state.isOwner
                  ? `<button type="button" class="row-expand-btn js-delete-track" data-id="${t.id}" style="border-color:var(--crimson); color:var(--crimson-bright);" title="Удалить запись">✕</button>`
                  : ''
              }
            </div>
          </div>

          ${
            isExpanded
              ? `
            <div class="track-drawer">
              <div>
                <span class="drawer-label">О ПАРТИИ / АРАНЖИРОВКЕ</span>
                <p class="drawer-text">${t.note || 'Запись из студийного архива.'}</p>
                <span class="drawer-label">ИНСТРУМЕНТЫ И ЦЕПОЧКА ЗВУКА</span>
                <p class="drawer-text" style="font-family:var(--font-mono); font-size:0.76rem;">${t.gearUsed || 'Не указано'}</p>
              </div>
              <div>
                <span class="drawer-label">ЗАМЕТКИ НА ТАЙМЛАЙНЕ (${(t.comments || []).length})</span>
                <div class="drawer-comments">
                  ${
                    (t.comments || []).length
                      ? t.comments
                          .map(
                            (c) => `
                        <div class="drawer-comment-pill js-seek-comment" data-id="${t.id}" data-sec="${c.timestamp}">
                          <strong>[${formatTime(c.timestamp)}] ${c.author}:</strong> ${c.text}
                        </div>`
                          )
                          .join('')
                      : `<span class="mono-small">Вы можете оставить заметку к любой секунде через нижний плеер</span>`
                  }
                </div>
              </div>
            </div>`
              : ''
          }
        </div>`;
      })
      .join('');

    container.querySelectorAll('.js-play-track').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (state.currentTrackId === id) togglePlay();
        else selectTrack(id, true);
      });
    });

    container.querySelectorAll('.js-row-seek').forEach((el) => {
      el.addEventListener('click', (e) => {
        const id = el.dataset.id;
        const rect = el.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (state.currentTrackId !== id) selectTrack(id, true, ratio);
        else seekRatio(ratio);
      });
    });

    container.querySelectorAll('.js-toggle-drawer').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        state.expandedTrackId = state.expandedTrackId === id ? null : id;
        renderTracksArchive();
      });
    });

    container.querySelectorAll('.js-change-cover').forEach((btn) => {
      btn.addEventListener('click', () => {
        openChangeCoverModal(btn.dataset.id);
      });
    });

    container.querySelectorAll('.js-set-featured').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const res = await fetch('/api/profile', {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ featuredTrackId: id })
        });
        if (res.ok) {
          const data = await res.json();
          state.profile = data.profile;
          renderAll();
          const trk = state.tracks.find((t) => t.id === id);
          showToast(`Трек «${trk?.title || ''}» установлен на кнопку Play главного экрана`);
        }
      });
    });

    container.querySelectorAll('.js-delete-track').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (state.tracks.length <= 1) {
          showToast('В архиве должна оставаться хотя бы одна запись');
          return;
        }
        const res = await fetch(`/api/tracks/${id}`, {
          method: 'DELETE',
          headers: authHeaders()
        });
        if (res.ok) {
          state.tracks = state.tracks.filter((t) => t.id !== id);
          if (state.currentTrackId === id && state.tracks[0]) {
            selectTrack(state.tracks[0].id, false);
          }
          renderTracksArchive();
          showToast('Запись удалена');
        }
      });
    });

    container.querySelectorAll('.js-seek-comment').forEach((pill) => {
      pill.addEventListener('click', () => {
        const id = pill.dataset.id;
        const sec = Number(pill.dataset.sec) || 0;
        if (state.currentTrackId !== id) selectTrack(id, true);
        audioEl.currentTime = sec;
        state.currentTime = sec;
        if (!state.isPlaying) playAudio();
      });
    });
  }

  // ==========================================================================
  // CHANGE TRACK COVER & DESCRIPTION MODAL (OWNER ONLY)
  // ==========================================================================
  function openChangeCoverModal(trackId) {
    if (!state.isOwner) return;
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;

    state.editingCoverTrackId = track.id;
    state.pendingTrackCoverFile = null;
    state.selectedPresetCoverUrl = track.coverImage || '/assets/moodboard/hero-sketch.jpg';

    document.getElementById('changeCoverTrackTitle').textContent = `Обложка и трек: ${track.title}`;
    document.getElementById('changeCoverPreviewImg').src = state.selectedPresetCoverUrl;
    document.getElementById('changeCoverFileLabel').innerHTML =
      'Загрузить свою обложку с диска <span>(выбрать файл)</span>';

    document.getElementById('editTrackTitleInput').value = track.title || '';
    document.getElementById('editTrackContextInput').value = track.context || '';
    document.getElementById('editTrackNoteInput').value = track.note || '';

    const presetImages = [
      '/assets/moodboard/hero-sketch.jpg',
      '/assets/moodboard/antistress-compromise-cover.jpg',
      '/assets/moodboard/vortex-art.jpg',
      '/assets/moodboard/poster-enter-the-void.jpg',
      '/assets/moodboard/poster-midsummer.jpg',
      '/assets/moodboard/poster-podzemka.jpg',
      '/assets/moodboard/poster-borderline.jpg',
      '/assets/moodboard/alex-guitar-bw.jpg',
      '/assets/moodboard/live-stage-film.jpg'
    ];
    state.works.forEach((w) => {
      if (w.image && !presetImages.includes(w.image)) {
        presetImages.unshift(w.image);
      }
    });

    const grid = document.getElementById('coverPresetsGrid');
    grid.innerHTML = presetImages
      .slice(0, 8)
      .map(
        (imgUrl) => `
        <div class="cover-preset-item ${imgUrl === state.selectedPresetCoverUrl ? 'selected' : ''}" data-url="${imgUrl}">
          <img src="${imgUrl}" alt="Вариант обложки" />
        </div>`
      )
      .join('');

    grid.querySelectorAll('.cover-preset-item').forEach((item) => {
      item.addEventListener('click', () => {
        grid.querySelectorAll('.cover-preset-item').forEach((el) => el.classList.remove('selected'));
        item.classList.add('selected');
        state.selectedPresetCoverUrl = item.dataset.url;
        state.pendingTrackCoverFile = null;
        document.getElementById('changeCoverPreviewImg').src = state.selectedPresetCoverUrl;
        document.getElementById('changeCoverFileLabel').innerHTML =
          'Выбран арт с сайта <span>(или загрузите файл с диска)</span>';
      });
    });

    document.getElementById('changeCoverModal').classList.remove('hidden');
  }

  // ==========================================================================
  // RENDER LOOKBOOK GALLERY (POSTERS, VISUALS, RELEASES)
  // ==========================================================================
  function renderVisualWorks() {
    const grid = document.getElementById('worksGrid');
    if (!grid) return;
    grid.innerHTML = state.works
      .map(
        (w) => `
        <article class="work-card" data-work-id="${w.id}">
          ${
            state.isOwner
              ? `<button type="button" class="work-delete-btn js-delete-work" data-id="${w.id}" title="Удалить работу">✕ Удалить</button>`
              : ''
          }
          <div class="work-img-box">
            <img src="${resolveAssetUrl(w.image)}" alt="${w.title}" loading="lazy" />
          </div>
          <div class="work-caption">
            <div class="work-meta">
              <span class="mono-small" style="color:var(--crimson-bright);">${w.category}</span>
              <span class="mono-small">${w.year || ''}</span>
            </div>
            <h3 class="work-title">${w.title}</h3>
            <p class="work-desc">${w.description}</p>
          </div>
        </article>`
      )
      .join('');

    grid.querySelectorAll('.work-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('js-delete-work')) return;
        const work = state.works.find((w) => w.id === card.dataset.workId);
        if (!work) return;
        document.getElementById('lightboxImg').src = resolveAssetUrl(work.image);
        document.getElementById('lightboxCat').textContent = `${work.category} // ${work.year || ''}`;
        document.getElementById('lightboxTitle').textContent = work.title;
        document.getElementById('lightboxDesc').textContent = work.description;
        document.getElementById('lightboxModal').classList.remove('hidden');
      });
    });

    grid.querySelectorAll('.js-delete-work').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const res = await fetch(`/api/works/${id}`, {
          method: 'DELETE',
          headers: authHeaders()
        });
        if (res.ok) {
          state.works = state.works.filter((w) => w.id !== id);
          renderVisualWorks();
          showToast('Работа удалена из портфолио');
        }
      });
    });
  }

  // ==========================================================================
  // AUDIO PLAYBACK & MINIMALIST FLOATING BAR
  // ==========================================================================
  function selectTrack(trackId, autoPlay = false, initialRatio = null) {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;

    state.currentTrackId = track.id;
    state.currentTime = 0;
    state.duration = track.duration || 22;
    audioEl.src = resolveAssetUrl(track.audioUrl);
    audioEl.load();

    const idx = state.tracks.findIndex((t) => t.id === track.id);
    const numStr = String(idx + 1).padStart(2, '0');
    document.getElementById('heroNowPlayingCaption').textContent =
      `${numStr} // ${track.title.toUpperCase()}`;

    audioEl.onloadedmetadata = () => {
      if (audioEl.duration && Number.isFinite(audioEl.duration)) {
        state.duration = audioEl.duration;
      }
      if (initialRatio !== null) {
        audioEl.currentTime = initialRatio * state.duration;
      }
      renderAudioBar();
    };

    renderTracksArchive();
    renderAudioBar();

    if (autoPlay) playAudio();
  }

  async function playAudio() {
    ensureWebAudio();
    try {
      await audioEl.play();
      state.isPlaying = true;
      updatePlayButtonsUI();
      renderTracksArchive();
    } catch (e) {
      console.warn('Playback prevented:', e);
    }
  }

  function pauseAudio() {
    audioEl.pause();
    state.isPlaying = false;
    updatePlayButtonsUI();
    renderTracksArchive();
  }

  function togglePlay() {
    if (state.isPlaying) pauseAudio();
    else playAudio();
  }

  function seekRatio(ratio) {
    const clamped = Math.max(0, Math.min(1, ratio));
    const sec = clamped * (state.duration || 22);
    audioEl.currentTime = sec;
    state.currentTime = sec;
    drawBarWaveform();
    renderTracksArchive();
  }

  function updatePlayButtonsUI() {
    document.getElementById('barPlayIcon').textContent = state.isPlaying ? '❚❚' : '▶';
    document.getElementById('heroPlayIndicator').classList.toggle('playing', state.isPlaying);
    document.getElementById('heroListenBtnText').textContent = state.isPlaying
      ? 'Пауза'
      : 'Слушать демки';

    const featTrack = getFeaturedHeroTrack();
    const isFeatPlaying = Boolean(
      state.isPlaying && featTrack && state.currentTrackId === featTrack.id
    );
    const centerBtn = document.getElementById('heroCenterPlayBtn');
    const centerIcon = document.getElementById('heroCenterPlayIcon');
    const centerKicker = document.getElementById('heroCenterPlayKicker');
    const centerName = document.getElementById('heroCenterTrackName');

    if (centerBtn) centerBtn.classList.toggle('is-playing', isFeatPlaying);
    if (centerIcon) centerIcon.textContent = isFeatPlaying ? '❚❚' : '▶';
    if (centerKicker) centerKicker.textContent = isFeatPlaying ? 'СЕЙЧАС ИГРАЕТ' : 'СЛУШАТЬ ТРЕК';
    if (centerName) centerName.textContent = featTrack ? featTrack.title : 'Аудио-архив';
  }

  function renderAudioBar() {
    const track = getCurrentTrack();
    if (!track) return;

    document.getElementById('barTrackTitle').textContent = track.title;
    document.getElementById('barTrackMeta').textContent =
      `${track.categoryLabel} · ${track.bpm} BPM · ${track.musicalKey}`;
    document.getElementById('barCurrentTime').textContent = formatTime(state.currentTime);
    document.getElementById('barTotalTime').textContent = formatTime(track.duration || state.duration);
    updatePlayButtonsUI();
    drawBarWaveform();
    renderBarPins();
  }

  function drawBarWaveform() {
    const canvas = document.getElementById('barWaveCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const track = getCurrentTrack();
    if (!track) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const peaks = track.peaks && track.peaks.length ? track.peaks : Array(96).fill(0.35);
    const count = peaks.length;
    const gap = 2;
    const barW = Math.max(1.5, (w - (count - 1) * gap) / count);
    const playRatio = state.duration > 0 ? state.currentTime / state.duration : 0;

    for (let i = 0; i < count; i++) {
      const r = i / count;
      const barH = Math.max(3, peaks[i] * (h - 6));
      const x = i * (barW + gap);
      const y = (h - barH) / 2;

      if (r <= playRatio) {
        ctx.fillStyle = '#e33839';
      } else if (state.hoverRatio !== null && r <= state.hoverRatio) {
        ctx.fillStyle = 'rgba(236, 232, 225, 0.45)';
      } else {
        ctx.fillStyle = 'rgba(236, 232, 225, 0.16)';
      }
      ctx.fillRect(x, y, barW, barH);
    }
  }

  function renderBarPins() {
    const layer = document.getElementById('barPinsLayer');
    const tooltip = document.getElementById('barTooltip');
    const track = getCurrentTrack();
    if (!layer || !track) return;

    const dur = Math.max(1, track.duration || state.duration || 22);
    layer.innerHTML = (track.comments || [])
      .map((c) => {
        const pct = Math.min(97, Math.max(3, (c.timestamp / dur) * 100));
        return `<span class="bar-pin-dot" style="left:${pct.toFixed(1)}%" data-sec="${c.timestamp}" data-author="${c.author}" data-text="${c.text}"></span>`;
      })
      .join('');

    layer.querySelectorAll('.bar-pin-dot').forEach((dot) => {
      dot.addEventListener('mouseenter', () => {
        const sec = Number(dot.dataset.sec);
        tooltip.textContent = `[${formatTime(sec)}] ${dot.dataset.author}: ${dot.dataset.text}`;
        tooltip.style.left = dot.style.left;
        tooltip.classList.remove('hidden');
      });
      dot.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const sec = Number(dot.dataset.sec);
        audioEl.currentTime = sec;
        state.currentTime = sec;
        if (!state.isPlaying) playAudio();
      });
    });
  }

  audioEl.addEventListener('timeupdate', () => {
    state.currentTime = audioEl.currentTime || 0;
    if (audioEl.duration && Number.isFinite(audioEl.duration)) {
      state.duration = audioEl.duration;
    }
    document.getElementById('barCurrentTime').textContent = formatTime(state.currentTime);
    document.getElementById('barTotalTime').textContent = formatTime(state.duration);
    drawBarWaveform();
  });

  audioEl.addEventListener('ended', () => {
    if (!state.tracks.length) return;
    const idx = state.tracks.findIndex((t) => t.id === state.currentTrackId);
    const next = state.tracks[(idx + 1) % state.tracks.length];
    if (next) selectTrack(next.id, true);
  });

  // ==========================================================================
  // PSYCHEDELIC SACRED GEOMETRY & SOUND-REACTIVE VORTEX CANVAS
  // ==========================================================================
  function startPsychedelicCanvasLoop() {
    const heroCanvas = document.getElementById('psychedelicCanvas');
    const oscCanvas = document.getElementById('barOscCanvas');

    function resize() {
      if (!heroCanvas) return;
      heroCanvas.width = heroCanvas.clientWidth || window.innerWidth;
      heroCanvas.height = heroCanvas.clientHeight || window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    function frame(now) {
      const t = now * 0.00055;
      let audioEnergy = 0;

      if (analyser && state.isPlaying) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += freqData[i];
        audioEnergy = sum / (32 * 255);
      }

      if (heroCanvas) {
        const ctx = heroCanvas.getContext('2d');
        const w = heroCanvas.width;
        const h = heroCanvas.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w * (0.66 + (state.mouseX - 0.5) * 0.04);
        const cy = h * (0.5 + (state.mouseY - 0.5) * 0.04);

        const radial = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(w, h) * 0.48);
        radial.addColorStop(0, `rgba(200, 40, 41, ${0.14 + audioEnergy * 0.18})`);
        radial.addColorStop(0.55, 'rgba(120, 18, 22, 0.04)');
        radial.addColorStop(1, 'rgba(6, 6, 8, 0)');
        ctx.fillStyle = radial;
        ctx.fillRect(0, 0, w, h);

        const numRays = 16;
        ctx.strokeStyle = 'rgba(236, 232, 225, 0.045)';
        ctx.lineWidth = 1;
        for (let r = 0; r < numRays; r++) {
          const angle = (r / numRays) * Math.PI * 2 + t * 0.25;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(angle) * w, cy + Math.sin(angle) * w);
          ctx.stroke();
        }

        const ringCount = 9;
        for (let k = 1; k <= ringCount; k++) {
          const baseRadius = k * 46 + audioEnergy * 28 * k * 0.3;
          ctx.beginPath();
          const steps = 90;
          for (let s = 0; s <= steps; s++) {
            const a = (s / steps) * Math.PI * 2;
            const warp =
              Math.sin(a * 4 + t * 2.2 + k * 0.6) * (6 + audioEnergy * 22) +
              Math.cos(a * 3 - t * 1.7) * 4;
            const rad = baseRadius + warp;
            const px = cx + Math.cos(a) * rad;
            const py = cy + Math.sin(a) * rad;
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.strokeStyle =
            k % 2 === 0
              ? `rgba(200, 40, 41, ${0.19 - k * 0.015 + audioEnergy * 0.15})`
              : `rgba(216, 201, 180, ${0.09 - k * 0.007})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      if (oscCanvas) {
        const octx = oscCanvas.getContext('2d');
        const ow = oscCanvas.width;
        const oh = oscCanvas.height;
        octx.clearRect(0, 0, ow, oh);
        octx.strokeStyle = state.isPlaying ? '#e33839' : 'rgba(236, 232, 225, 0.25)';
        octx.lineWidth = 1.3;
        octx.beginPath();

        if (analyser && state.isPlaying && timeData) {
          const slice = ow / timeData.length;
          let x = 0;
          for (let i = 0; i < timeData.length; i++) {
            const v = timeData[i] / 128.0;
            const y = (v * oh) / 2;
            if (i === 0) octx.moveTo(x, y);
            else octx.lineTo(x, y);
            x += slice;
          }
        } else {
          octx.moveTo(0, oh / 2);
          octx.lineTo(ow, oh / 2);
        }
        octx.stroke();
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  // ==========================================================================
  // CLIENT-SIDE AUDIO DECODING FOR UPLOADED DEMOS
  // ==========================================================================
  async function extractPeaksFromAudioFile(file) {
    const buf = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const tempCtx = new Ctx();
    try {
      const decoded = await tempCtx.decodeAudioData(buf);
      const chan = decoded.getChannelData(0);
      const count = 96;
      const block = Math.max(1, Math.floor(chan.length / count));
      const peaks = [];
      for (let i = 0; i < count; i++) {
        let sum = 0;
        const start = i * block;
        for (let j = 0; j < block; j++) sum += Math.abs(chan[start + j] || 0);
        peaks.push(sum / block);
      }
      const max = Math.max(...peaks, 0.01);
      return {
        duration: Math.max(1, Math.round(decoded.duration)),
        peaks: peaks.map((v) => Math.max(0.12, Number((v / max).toFixed(2))))
      };
    } finally {
      tempCtx.close().catch(() => {});
    }
  }

  async function onAudioFileChosen(file) {
    if (!file) return;
    state.pendingAudioFile = file;
    document.getElementById('dropPromptText').classList.add('hidden');
    document.getElementById('dropFileSelected').classList.remove('hidden');
    document.getElementById('selectedAudioName').textContent = file.name;
    document.getElementById('selectedAudioInfo').textContent = 'Анализ звуковой волны...';

    const titleEl = document.getElementById('demoTitleInput');
    if (!titleEl.value.trim()) {
      titleEl.value = file.name.replace(/\.[^/.]+$/, '');
    }

    try {
      const res = await extractPeaksFromAudioFile(file);
      state.pendingPeaks = res.peaks;
      state.pendingDuration = res.duration;
      document.getElementById('selectedAudioInfo').textContent =
        `Длительность: ${formatTime(res.duration)} · ${(file.size / 1024).toFixed(0)} КБ · Волна построена`;
    } catch {
      state.pendingPeaks = null;
      state.pendingDuration = 20;
      document.getElementById('selectedAudioInfo').textContent =
        `Файл готов к загрузке (${(file.size / 1024).toFixed(0)} КБ)`;
    }
  }

  // ==========================================================================
  // UI EVENTS
  // ==========================================================================
  function bindEvents() {
    window.addEventListener('mousemove', (e) => {
      state.mouseX = e.clientX / Math.max(1, window.innerWidth);
      state.mouseY = e.clientY / Math.max(1, window.innerHeight);
    });

    document.getElementById('heroListenBtn').addEventListener('click', togglePlay);
    document.getElementById('heroCenterPlayBtn').addEventListener('click', () => {
      const feat = getFeaturedHeroTrack();
      if (!feat) return;
      if (state.currentTrackId === feat.id) {
        togglePlay();
      } else {
        selectTrack(feat.id, true);
      }
    });
    document.getElementById('barPlayBtn').addEventListener('click', togglePlay);
    document.getElementById('barNextBtn').addEventListener('click', () => {
      if (!state.tracks.length) return;
      const idx = state.tracks.findIndex((t) => t.id === state.currentTrackId);
      const next = state.tracks[(idx + 1) % state.tracks.length];
      if (next) selectTrack(next.id, true);
    });

    // Owner Authentication Modal & Toggle
    const authModal = document.getElementById('ownerAuthModal');
    document.getElementById('ownerAuthBtn').addEventListener('click', () => {
      if (state.isOwner) {
        state.studioKey = '';
        localStorage.removeItem('alexg_studio_key');
        applyOwnerModeUI(false);
        showToast('Вы вышли из кабинета автора (включён режим посетителя)');
      } else {
        authModal.classList.remove('hidden');
        document.getElementById('ownerKeyInput').focus();
      }
    });

    document.getElementById('closeOwnerAuthModalBtn').addEventListener('click', () => {
      authModal.classList.add('hidden');
    });

    document.getElementById('ownerAuthForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = document.getElementById('ownerKeyInput').value.trim();
      const ok = await verifyOwnerKeyValue(key);
      if (ok) {
        state.studioKey = key;
        localStorage.setItem('alexg_studio_key', key);
        authModal.classList.add('hidden');
        document.getElementById('ownerAuthForm').reset();
        applyOwnerModeUI(true);
        showToast('Кабинет автора активирован: теперь доступны смена фото, блоков, описания и загрузка демок');
      } else {
        showToast('Неверный ключ автора');
      }
    });

    // One-click publish to GitHub Pages button
    const pubBtn = document.getElementById('publishGithubHeaderBtn');
    if (pubBtn) {
      pubBtn.addEventListener('click', async () => {
        if (!state.isOwner) return;
        const origText = pubBtn.textContent;
        pubBtn.disabled = true;
        pubBtn.textContent = '☁ Выгрузка на GitHub...';
        try {
          const res = await fetch('api/publish-github', {
            method: 'POST',
            headers: authHeaders()
          });
          if (res.ok) {
            showToast('Изменения успешно выгружены на GitHub! Сайт в сети обновится через ~30 секунд');
          } else {
            showToast('Выгрузка напрямую доступна при запуске локального сервера (node server.js)');
          }
        } catch {
          showToast('Выгрузка напрямую доступна при запуске локального сервера (node server.js)');
        } finally {
          pubBtn.disabled = false;
          pubBtn.textContent = origText;
        }
      });
    }

    // Author Cabinet Triggers & Tabs
    document.getElementById('openCabinetHeaderBtn').addEventListener('click', () => openAuthorCabinet('hero'));
    document.getElementById('editHeroQuickBtn').addEventListener('click', () => openAuthorCabinet('hero'));
    document.getElementById('openEditBlocksModalBtn').addEventListener('click', () => openAuthorCabinet('blocks'));
    document.getElementById('openEditBioModalBtn').addEventListener('click', () => openAuthorCabinet('about'));
    document.getElementById('closeCabinetModalBtn').addEventListener('click', () => {
      document.getElementById('authorCabinetModal').classList.add('hidden');
    });

    document.querySelectorAll('#cabinetTabs .cab-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchCabinetTab(btn.dataset.cabtab));
    });

    // Cabinet Image Upload Buttons (Hero Main, Hero Secondary, About Photo 1, About Photo 2)
    function bindCabinetPhotoUploader(btnId, fileId, previewId, urlInputId) {
      const btn = document.getElementById(btnId);
      const fileInp = document.getElementById(fileId);
      const preview = document.getElementById(previewId);
      const urlInp = document.getElementById(urlInputId);
      if (!btn || !fileInp) return;

      btn.addEventListener('click', () => fileInp.click());
      urlInp.addEventListener('input', () => {
        if (urlInp.value.trim()) preview.src = urlInp.value.trim();
      });
      fileInp.addEventListener('change', async () => {
        const f = fileInp.files?.[0];
        if (!f) return;
        try {
          showToast('Загрузка фото...');
          const uploadedUrl = await uploadImageFileToServer(f);
          preview.src = uploadedUrl;
          urlInp.value = uploadedUrl;
          showToast('Фото загружено');
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    bindCabinetPhotoUploader('cabHeroMainUploadBtn', 'cabHeroMainFile', 'cabHeroMainPreview', 'cabHeroMainUrl');
    bindCabinetPhotoUploader('cabHeroSecUploadBtn', 'cabHeroSecFile', 'cabHeroSecPreview', 'cabHeroSecUrl');
    bindCabinetPhotoUploader('cabAboutPhoto1Btn', 'cabAboutPhoto1File', 'cabAboutPhoto1Preview', 'cabAboutPhoto1Url');
    bindCabinetPhotoUploader('cabAboutPhoto2Btn', 'cabAboutPhoto2File', 'cabAboutPhoto2Preview', 'cabAboutPhoto2Url');

    // Submit Author Cabinet Form
    document.getElementById('authorCabinetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('saveCabinetBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';

      try {
        const payload = {
          name: document.getElementById('cabNameInput').value.trim() || 'Alex G',
          city: document.getElementById('cabCityInput').value.trim(),
          roleLine: document.getElementById('cabRoleLineInput').value.trim(),
          heroSubtitle: document.getElementById('cabHeroSubtitleInput').value.trim(),
          bio: document.getElementById('cabBioInput').value.trim(),
          heroImage: document.getElementById('cabHeroMainUrl').value.trim() || '/assets/moodboard/hero-sketch.jpg',
          heroSecondaryImage: document.getElementById('cabHeroSecUrl').value.trim() || '/assets/moodboard/alex-guitar-bw.jpg',
          heroArtCaption: document.getElementById('cabHeroArtCaptionInput').value.trim() || 'Art by Rusya для нового альбома',
          featuredTrackId: document.getElementById('cabFeaturedTrackSelect').value || state.tracks[0]?.id || '',
          aboutPhoto1: document.getElementById('cabAboutPhoto1Url').value.trim() || '/assets/moodboard/alex-guitar-bw.jpg',
          aboutPhoto2: document.getElementById('cabAboutPhoto2Url').value.trim() || '/assets/moodboard/live-stage-film.jpg',
          disciplines: state.cabinetDisciplines,
          offers: state.cabinetOffers
        };

        let savedOnServer = false;
        try {
          const res = await fetch('api/profile', {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const data = await res.json();
            state.profile = data.profile;
            savedOnServer = true;
          }
        } catch {
          // Static fallback
        }

        if (!savedOnServer) {
          state.profile = { ...state.profile, ...payload };
          saveStaticOverride();
        }

        document.getElementById('authorCabinetModal').classList.add('hidden');
        renderProfileAndCraft();
        showToast('Все изменения (фото, блоки и описание) сохранены!');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить все изменения';
      }
    });

    // Category tabs
    document.querySelectorAll('#trackCategoryTabs .tab-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#trackCategoryTabs .tab-link').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.categoryFilter = btn.dataset.cat;
        renderTracksArchive();
      });
    });

    // Bottom bar waveform scrubbing
    const barWrap = document.getElementById('barWaveWrap');
    const barTooltip = document.getElementById('barTooltip');

    barWrap.addEventListener('mousemove', (e) => {
      if (e.target.classList.contains('bar-pin-dot')) return;
      const rect = barWrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      state.hoverRatio = ratio;
      drawBarWaveform();
      barTooltip.textContent = formatTime(ratio * (state.duration || 22));
      barTooltip.style.left = `${(ratio * 100).toFixed(1)}%`;
      barTooltip.classList.remove('hidden');
    });

    barWrap.addEventListener('mouseleave', () => {
      state.hoverRatio = null;
      drawBarWaveform();
      barTooltip.classList.add('hidden');
    });

    barWrap.addEventListener('click', (e) => {
      if (e.target.classList.contains('bar-pin-dot')) return;
      const rect = barWrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekRatio(ratio);
      if (!state.isPlaying) playAudio();
    });

    // Timestamped note submission on bottom bar
    document.getElementById('barNoteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('barNoteInput');
      const text = input.value.trim();
      const track = getCurrentTrack();
      if (!text || !track) return;

      const res = await fetch(`/api/tracks/${track.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: state.isOwner ? 'Alex G' : 'Слушатель',
          timestamp: Number(state.currentTime.toFixed(1)),
          text
        })
      });
      if (res.ok) {
        const data = await res.json();
        const idx = state.tracks.findIndex((t) => t.id === track.id);
        if (idx !== -1) state.tracks[idx] = data.track;
        input.value = '';
        renderAudioBar();
        renderTracksArchive();
        showToast(`Заметка сохранена на ${formatTime(state.currentTime)}`);
      }
    });

    // Upload Demo Modal (Owner Only)
    const uploadModal = document.getElementById('uploadModal');
    const openUpload = () => {
      if (!state.isOwner) return;
      uploadModal.classList.remove('hidden');
    };
    const closeUpload = () => uploadModal.classList.add('hidden');

    document.getElementById('openUploadModalBtn').addEventListener('click', openUpload);
    document.getElementById('archiveUploadBtn').addEventListener('click', openUpload);
    document.getElementById('closeUploadModalBtn').addEventListener('click', closeUpload);

    const dropArea = document.getElementById('audioDropArea');
    const fileInput = document.getElementById('audioFileInput');
    dropArea.addEventListener('click', () => fileInput.click());
    dropArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropArea.classList.add('dragover');
    });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
    dropArea.addEventListener('drop', (e) => {
      e.preventDefault();
      dropArea.classList.remove('dragover');
      const f = e.dataTransfer?.files?.[0];
      if (f) onAudioFileChosen(f);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.[0]) onAudioFileChosen(fileInput.files[0]);
    });

    // Cover image picker inside Upload Demo Modal
    const demoCoverDrop = document.getElementById('demoCoverDropArea');
    const demoCoverInput = document.getElementById('demoCoverFileInput');
    const demoCoverLabel = document.getElementById('demoCoverFileLabel');
    demoCoverDrop.addEventListener('click', () => demoCoverInput.click());
    demoCoverDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      demoCoverDrop.classList.add('dragover');
    });
    demoCoverDrop.addEventListener('dragleave', () => demoCoverDrop.classList.remove('dragover'));
    demoCoverDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      demoCoverDrop.classList.remove('dragover');
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        state.pendingDemoCoverFile = f;
        demoCoverLabel.textContent = `Обложка выбрана: ${f.name}`;
      }
    });
    demoCoverInput.addEventListener('change', () => {
      const f = demoCoverInput.files?.[0];
      if (f) {
        state.pendingDemoCoverFile = f;
        demoCoverLabel.textContent = `Обложка выбрана: ${f.name}`;
      }
    });

    // Microphone Recorder
    const micBtn = document.getElementById('micRecordToggleBtn');
    const micLabel = document.getElementById('micStatusLabel');
    micBtn.addEventListener('click', async () => {
      if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
        state.mediaRecorder.stop();
        micBtn.textContent = '● Записать с микрофона';
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        showToast('Запись с микрофона недоступна в этом браузере');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.recordedChunks = [];
        state.mediaRecorder = new MediaRecorder(stream);
        state.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) state.recordedChunks.push(e.data);
        };
        state.mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(state.recordedChunks, { type: 'audio/webm' });
          const file = new File([blob], `guitar-take-${Date.now()}.webm`, { type: 'audio/webm' });
          onAudioFileChosen(file);
          micLabel.textContent = 'Запись с микрофона прикреплена';
        };
        state.mediaRecorder.start();
        micLabel.textContent = 'Идёт запись... Нажмите кнопку ещё раз для остановки';
        micBtn.textContent = '■ Остановить запись';
      } catch {
        showToast('Нет доступа к микрофону');
      }
    });

    document.getElementById('uploadDemoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitDemoBtn');
      btn.disabled = true;
      btn.textContent = 'Сохранение...';

      try {
        let uploadedUrl = '';
        if (state.pendingAudioFile) {
          const upRes = await fetch(
            `/api/upload-file?kind=audio&name=${encodeURIComponent(state.pendingAudioFile.name)}`,
            {
              method: 'POST',
              headers: authHeaders(),
              body: state.pendingAudioFile
            }
          );
          if (upRes.ok) {
            const upData = await upRes.json();
            uploadedUrl = upData.url;
          }
        }

        let uploadedCoverUrl = '/assets/moodboard/hero-sketch.jpg';
        if (state.pendingDemoCoverFile) {
          uploadedCoverUrl = await uploadImageFileToServer(state.pendingDemoCoverFile);
        }

        const payload = {
          title: document.getElementById('demoTitleInput').value.trim(),
          category: document.getElementById('demoCategoryInput').value,
          context: document.getElementById('demoContextInput').value.trim(),
          bpm: Number(document.getElementById('demoBpmInput').value) || 84,
          musicalKey: document.getElementById('demoKeyInput').value.trim() || 'Dm',
          gearUsed: document.getElementById('demoGearInput').value.trim(),
          note: document.getElementById('demoNoteInput').value.trim(),
          audioUrl: uploadedUrl,
          coverImage: uploadedCoverUrl,
          duration: state.pendingDuration || 20,
          peaks: state.pendingPeaks
        };

        const res = await fetch('/api/tracks', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const { track } = await res.json();
          state.tracks.unshift(track);
          state.pendingAudioFile = null;
          state.pendingPeaks = null;
          state.pendingDemoCoverFile = null;
          demoCoverLabel.textContent = 'Нажмите или перетащите картинку для обложки трека';
          document.getElementById('uploadDemoForm').reset();
          document.getElementById('dropPromptText').classList.remove('hidden');
          document.getElementById('dropFileSelected').classList.add('hidden');
          closeUpload();
          selectTrack(track.id, true);
          showToast(`Запись «${track.title}» добавлена в архив`);
        } else {
          showToast('Ошибка доступа: требуется вход автора');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить в архив и включить';
      }
    });

    // Change Existing Track Cover & Description Modal Events (Owner Only)
    const changeCoverModal = document.getElementById('changeCoverModal');
    const changeCoverDrop = document.getElementById('changeCoverDropArea');
    const changeCoverInput = document.getElementById('changeCoverFileInput');
    const changeCoverPreview = document.getElementById('changeCoverPreviewImg');
    const changeCoverLabel = document.getElementById('changeCoverFileLabel');

    document.getElementById('closeChangeCoverModalBtn').addEventListener('click', () => {
      changeCoverModal.classList.add('hidden');
    });

    changeCoverDrop.addEventListener('click', () => changeCoverInput.click());
    changeCoverDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      changeCoverDrop.classList.add('dragover');
    });
    changeCoverDrop.addEventListener('dragleave', () => changeCoverDrop.classList.remove('dragover'));
    changeCoverDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      changeCoverDrop.classList.remove('dragover');
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        state.pendingTrackCoverFile = f;
        changeCoverPreview.src = URL.createObjectURL(f);
        changeCoverLabel.textContent = `Выбран файл: ${f.name}`;
      }
    });
    changeCoverInput.addEventListener('change', () => {
      const f = changeCoverInput.files?.[0];
      if (f) {
        state.pendingTrackCoverFile = f;
        changeCoverPreview.src = URL.createObjectURL(f);
        changeCoverLabel.textContent = `Выбран файл: ${f.name}`;
      }
    });

    document.getElementById('changeCoverForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.editingCoverTrackId) return;
      const saveBtn = document.getElementById('saveCoverBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Сохранение...';

      try {
        let finalCoverUrl = state.selectedPresetCoverUrl || '/assets/moodboard/hero-sketch.jpg';
        if (state.pendingTrackCoverFile) {
          finalCoverUrl = await uploadImageFileToServer(state.pendingTrackCoverFile);
        }

        const res = await fetch(`/api/tracks/${state.editingCoverTrackId}`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            coverImage: finalCoverUrl,
            title: document.getElementById('editTrackTitleInput').value.trim(),
            context: document.getElementById('editTrackContextInput').value.trim(),
            note: document.getElementById('editTrackNoteInput').value.trim()
          })
        });
        if (res.ok) {
          const { track } = await res.json();
          const idx = state.tracks.findIndex((t) => t.id === track.id);
          if (idx !== -1) state.tracks[idx] = track;
          changeCoverModal.classList.add('hidden');
          renderTracksArchive();
          renderAudioBar();
          showToast('Обложка и данные трека обновлены');
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить обложку и трек';
      }
    });

    // Add Visual Work / Poster Modal (Owner Only)
    const addWorkModal = document.getElementById('addWorkModal');
    const workImgInput = document.getElementById('workImageInput');
    document.getElementById('openAddWorkModalBtn').addEventListener('click', () => {
      if (!state.isOwner) return;
      addWorkModal.classList.remove('hidden');
    });
    document.getElementById('closeAddWorkModalBtn').addEventListener('click', () => {
      addWorkModal.classList.add('hidden');
    });
    document.getElementById('workImageDropArea').addEventListener('click', () => workImgInput.click());
    workImgInput.addEventListener('change', () => {
      const f = workImgInput.files?.[0];
      if (f) {
        state.pendingWorkImage = f;
        document.getElementById('workImageLabel').textContent = `Выбран файл: ${f.name}`;
      }
    });

    document.getElementById('addWorkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      let imageUrl = '/assets/moodboard/poster-enter-the-void.jpg';
      if (state.pendingWorkImage) {
        imageUrl = await uploadImageFileToServer(state.pendingWorkImage);
      }
      const res = await fetch('/api/works', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          title: document.getElementById('workTitleInput').value.trim(),
          category: document.getElementById('workCategoryInput').value.trim(),
          description: document.getElementById('workDescInput').value.trim(),
          image: imageUrl
        })
      });
      if (res.ok) {
        const { work } = await res.json();
        state.works.unshift(work);
        state.pendingWorkImage = null;
        document.getElementById('addWorkForm').reset();
        addWorkModal.classList.add('hidden');
        renderVisualWorks();
        showToast('Афиша / работа добавлена в портфолио');
      }
    });

    // Lightbox Close
    document.getElementById('closeLightboxBtn').addEventListener('click', () => {
      document.getElementById('lightboxModal').classList.add('hidden');
    });
    document.getElementById('lightboxModal').addEventListener('click', (e) => {
      if (e.target.id === 'lightboxModal') {
        document.getElementById('lightboxModal').classList.add('hidden');
      }
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadInitialState();
    startPsychedelicCanvasLoop();
  });
})();
