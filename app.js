/* ====================================================
   MangaZen — Lógica principal (MangaDex API)
   ==================================================== */

'use strict';

// =====================================================
// CONFIGURACIÓN Y CONSTANTES
// =====================================================
const API = 'https://api.mangadex.org';
const COVER_CDN = 'https://uploads.mangadex.org/covers';

// Detectar si estamos en un entorno externo (GitHub Pages, APK, etc.)
// En localhost no se necesita proxy. En producción sí para evitar bloqueos CORS.
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const CORS_PROXY = 'https://corsproxy.io/?';

function apiUrl(endpoint) {
  const full = `${API}${endpoint}`;
  return IS_LOCAL ? full : CORS_PROXY + encodeURIComponent(full);
}

const LANG_ES = ['es', 'es-la'];

const GENRES = [
  { id: 'Action',     name: '⚔️ Acción' },
  { id: 'Romance',    name: '💕 Romance' },
  { id: 'Comedy',     name: '😂 Comedia' },
  { id: 'Fantasy',    name: '🧙 Fantasía' },
  { id: 'Horror',     name: '👻 Terror' },
  { id: 'Mystery',    name: '🔍 Misterio' },
  { id: 'Sci-Fi',     name: '🚀 Ciencia Ficción' },
  { id: 'Slice of Life', name: '☀️ Slice of Life' },
  { id: 'Sports',     name: '⚽ Deportes' },
  { id: 'Supernatural', name: '✨ Sobrenatural' },
];

// =====================================================
// ESTADO GLOBAL
// =====================================================
const state = {
  currentPage: 'home',
  currentManga: null,
  currentChapters: [],
  currentChapterOffset: 0,
  currentChapterId: null,
  currentChapterIndex: 0,
  currentPageIndex: 0,
  pages: [],
  favorites: JSON.parse(localStorage.getItem('mz_favorites') || '{}'),
  readChapters: JSON.parse(localStorage.getItem('mz_read') || '{}'),
  searchOffset: 0,
  searchQuery: '',
  activeGenre: null,
  readerMode: localStorage.getItem('mz_reader_mode') || 'vertical',
  readerBg: localStorage.getItem('mz_reader_bg') || '#000',
  uiVisible: true,
  tagIds: {},
};

// =====================================================
// UTILIDADES
// =====================================================
function getCoverUrl(mangaId, filename, size = 256) {
  if (!filename) return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="384" viewBox="0 0 256 384"><rect fill="%231a1a2e" width="256" height="384"/><text fill="%236b6b88" font-family="sans-serif" font-size="40" x="128" y="200" text-anchor="middle">📖</text></svg>';
  return `${COVER_CDN}/${mangaId}/${filename}.${size}.jpg`;
}

function getTitle(manga) {
  const t = manga.attributes?.title;
  return t?.es || t?.['es-la'] || t?.en || t?.['ja-ro'] || t?.ja || Object.values(t || {})[0] || 'Sin título';
}

function getDescription(manga) {
  const d = manga.attributes?.description;
  return d?.es || d?.['es-la'] || d?.en || Object.values(d || {})[0] || '';
}

function getCoverRelation(manga) {
  return manga.relationships?.find(r => r.type === 'cover_art');
}

function formatDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return str; }
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

async function fetchJSON(url) {
  // Si la URL ya es completa (empieza con http), usarla directamente con proxy si aplica
  const finalUrl = url.startsWith('http')
    ? (IS_LOCAL ? url : CORS_PROXY + encodeURIComponent(url))
    : url;

  try {
    const res = await fetch(finalUrl, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    // Reintento con proxy alternativo si el primero falla
    if (!IS_LOCAL && !finalUrl.includes('allorigins')) {
      const fallbackUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(url);
      const res2 = await fetch(fallbackUrl);
      if (!res2.ok) throw err;
      const data = await res2.json();
      return JSON.parse(data.contents);
    }
    throw err;
  }
}

// =====================================================
// NAVEGACIÓN
// =====================================================
function navigateTo(pageId, pushHistory = true) {
  // Ocultar bottom nav en reader
  const nav = document.getElementById('bottom-nav');
  const prevPage = state.currentPage;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');

  state.currentPage = pageId;

  nav.style.display = pageId === 'reader' ? 'none' : '';

  // Nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === pageId);
  });

  if (pushHistory) {
    history.pushState({ page: pageId }, '', `#${pageId}`);
  }
}

window.addEventListener('popstate', (e) => {
  const page = e.state?.page || 'home';
  navigateTo(page, false);
});

// =====================================================
// CREAR MANGA CARD
// =====================================================
function createMangaCard(manga) {
  const cover = getCoverRelation(manga);
  const coverFilename = cover?.attributes?.fileName;
  const title = getTitle(manga);
  const status = manga.attributes?.status;
  const statusMap = { ongoing: '🔄 En curso', completed: '✅ Completo', hiatus: '⏸️ Hiatus', cancelled: '❌ Cancelado' };

  const card = document.createElement('div');
  card.className = 'manga-card';
  card.dataset.id = manga.id;

  const imgSrc = getCoverUrl(manga.id, coverFilename, 256);

  card.innerHTML = `
    <div class="manga-card-cover-wrap">
      <img class="cover" src="${imgSrc}" alt="${title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22384%22><rect fill=%22%231a1a2e%22 width=%22256%22 height=%22384%22/><text fill=%22%236b6b88%22 font-family=%22sans-serif%22 font-size=%2240%22 x=%22128%22 y=%22200%22 text-anchor=%22middle%22>📖</text></svg>'" />
      ${statusMap[status] ? `<span class="manga-card-badge">${statusMap[status]}</span>` : ''}
    </div>
    <div class="manga-card-info">
      <div class="manga-card-title">${title}</div>
    </div>
  `;

  card.addEventListener('click', () => openMangaDetail(manga));
  return card;
}

function renderSkeletonCards(container, count = 6) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'manga-card';
    card.innerHTML = '<div class="manga-card-cover-wrap shimmer"></div>';
    container.appendChild(card);
  }
}

// =====================================================
// HOME — CARGAR DATOS
// =====================================================
async function loadHome() {
  loadPopular();
  loadRecent();
  loadGenreChips();
  loadHero();
}

async function loadHero() {
  try {
    // Sin filtro de idioma — muestra los más seguidos globalmente
    const data = await fetchJSON(`${API}/manga?limit=20&order[followedCount]=desc&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`);
    const mangas = data.data || [];
    if (!mangas.length) return;
    const manga = mangas[Math.floor(Math.random() * Math.min(8, mangas.length))];
    renderHero(manga);
  } catch (e) {
    console.warn('Hero load error:', e);
  }
}

function renderHero(manga) {
  const cover = getCoverRelation(manga);
  const coverFilename = cover?.attributes?.fileName;
  const imgSrc = getCoverUrl(manga.id, coverFilename, 512);
  const title = getTitle(manga);
  const desc = getDescription(manga);

  const heroCard = document.getElementById('hero-card');
  heroCard.classList.remove('shimmer');
  heroCard.innerHTML = `
    <img class="hero-bg" src="${imgSrc}" alt="${title}" loading="lazy" />
    <div class="hero-overlay">
      <span class="hero-badge">⭐ Destacado</span>
      <h2 class="hero-title">${title}</h2>
      <p class="hero-desc">${desc}</p>
      <button class="btn-primary" id="btn-hero-read">Leer ahora →</button>
    </div>
  `;
  document.getElementById('btn-hero-read').addEventListener('click', () => openMangaDetail(manga));
}

async function loadPopular() {
  const grid = document.getElementById('popular-grid');
  renderSkeletonCards(grid, 12);
  try {
    // Sin filtro de idioma = muestra los 100,000+ títulos más seguidos
    const data = await fetchJSON(`${API}/manga?limit=24&order[followedCount]=desc&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`);
    grid.innerHTML = '';
    (data.data || []).forEach(m => grid.appendChild(createMangaCard(m)));
  } catch (e) {
    grid.innerHTML = '<p style="color:var(--text3);font-size:14px;padding:12px">Error cargando contenido. Intenta más tarde.</p>';
    console.warn(e);
  }
}

async function loadRecent() {
  const grid = document.getElementById('recent-grid');
  renderSkeletonCards(grid, 12);
  try {
    // Esta sección SÍ filtra por ES — para ver actualizaciones reales en español
    const data = await fetchJSON(`${API}/manga?limit=24&order[latestUploadedChapter]=desc&availableTranslatedLanguage[]=es&availableTranslatedLanguage[]=es-la&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`);
    grid.innerHTML = '';
    (data.data || []).forEach(m => grid.appendChild(createMangaCard(m)));
  } catch (e) {
    console.warn(e);
    grid.innerHTML = '';
  }
}

async function loadGenreChips() {
  const row = document.getElementById('genre-chips');
  // Primero cargar IDs de tags desde la API
  try {
    const data = await fetchJSON(`${API}/manga/tag`);
    const tags = data.data || [];
    tags.forEach(tag => {
      const name = tag.attributes?.name?.en || '';
      state.tagIds[name] = tag.id;
    });
  } catch (e) {
    console.warn('Tags load error:', e);
  }

  GENRES.forEach(genre => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = genre.name;
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeGenre = genre.id;
      loadByGenre(genre.id);
    });
    row.appendChild(chip);
  });
}

async function loadByGenre(genreName) {
  const tagId = state.tagIds[genreName];
  if (!tagId) { toast('Género no disponible'); return; }

  const section = document.getElementById('search-results');
  const grid = document.getElementById('search-grid');
  const moreBtn = document.getElementById('btn-search-more');

  section.classList.remove('hidden');
  document.getElementById('home-content').querySelector('.hero-section').scrollIntoView({ behavior: 'smooth' });
  renderSkeletonCards(grid, 6);
  moreBtn.classList.add('hidden');
  state.searchOffset = 0;
  state.searchQuery = '';

  try {
    // Sin filtro de idioma — muestra todo el género, los capítulos cargarán en ES/EN
    const data = await fetchJSON(
      `${API}/manga?limit=30&offset=0&includedTags[]=${tagId}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[followedCount]=desc`
    );
    grid.innerHTML = '';
    (data.data || []).forEach(m => grid.appendChild(createMangaCard(m)));
    if ((data.total || 0) > 30) {
      moreBtn.classList.remove('hidden');
      moreBtn.onclick = () => loadMoreByGenre(tagId, data.data.length);
    }
    document.getElementById('search-results').querySelector('.section-title').textContent = `Resultados: ${GENRES.find(g=>g.id===genreName)?.name || genreName}`;
    section.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    console.warn(e);
  }
}

async function loadMoreByGenre(tagId, offset) {
  const grid = document.getElementById('search-grid');
  const moreBtn = document.getElementById('btn-search-more');
  moreBtn.textContent = 'Cargando...';
  try {
    const data = await fetchJSON(
      `${API}/manga?limit=30&offset=${offset}&includedTags[]=${tagId}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[followedCount]=desc`
    );
    (data.data || []).forEach(m => grid.appendChild(createMangaCard(m)));
    const newOffset = offset + (data.data?.length || 0);
    if (newOffset < (data.total || 0)) {
      moreBtn.textContent = 'Cargar más';
      moreBtn.onclick = () => loadMoreByGenre(tagId, newOffset);
    } else {
      moreBtn.classList.add('hidden');
    }
  } catch(e) { moreBtn.textContent = 'Error. Intentar de nuevo'; }
}

// =====================================================
// BÚSQUEDA
// =====================================================
let searchTimeout = null;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (!q) {
    document.getElementById('search-results').classList.add('hidden');
    return;
  }
  searchTimeout = setTimeout(() => performSearch(q, 0), 500);
});

document.getElementById('btn-search-toggle').addEventListener('click', () => {
  const bar = document.getElementById('search-bar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) {
    document.getElementById('search-input').focus();
  }
});

document.getElementById('btn-search-clear').addEventListener('click', () => {
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('search-bar').classList.add('hidden');
});

async function performSearch(query, offset = 0) {
  state.searchQuery = query;
  state.searchOffset = offset;
  const grid = document.getElementById('search-grid');
  const section = document.getElementById('search-results');
  const moreBtn = document.getElementById('btn-search-more');
  section.classList.remove('hidden');
  section.querySelector('.section-title').textContent = `Resultados: "${query}"`;

  if (offset === 0) renderSkeletonCards(grid, 6);

  try {
    // Búsqueda global — sin restricción de idioma para máximos resultados
    const data = await fetchJSON(
      `${API}/manga?title=${encodeURIComponent(query)}&limit=30&offset=${offset}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`
    );
    if (offset === 0) grid.innerHTML = '';
    (data.data || []).forEach(m => grid.appendChild(createMangaCard(m)));

    const newOffset = offset + (data.data?.length || 0);
    if (newOffset < (data.total || 0)) {
      moreBtn.classList.remove('hidden');
      moreBtn.textContent = 'Cargar más resultados';
      moreBtn.onclick = () => performSearch(query, newOffset);
    } else {
      moreBtn.classList.add('hidden');
    }

    if (!data.data?.length && offset === 0) {
      grid.innerHTML = '<p style="color:var(--text3);font-size:14px;padding:12px">Sin resultados. Intenta con otro término.</p>';
    }
  } catch(e) {
    console.warn(e);
    if (offset === 0) grid.innerHTML = '<p style="color:var(--text3);font-size:14px;padding:12px">Error en la búsqueda.</p>';
  }
}

// =====================================================
// MANGA DETAIL
// =====================================================
async function openMangaDetail(manga) {
  state.currentManga = manga;
  state.currentChapters = [];
  state.currentChapterOffset = 0;

  const cover = getCoverRelation(manga);
  const coverFilename = cover?.attributes?.fileName;
  const imgSrc = getCoverUrl(manga.id, coverFilename, 512);
  const title = getTitle(manga);
  const desc = getDescription(manga);

  document.getElementById('detail-bar-title').textContent = title;
  document.getElementById('detail-title').textContent = title;

  const coverImg = document.getElementById('detail-cover');
  coverImg.src = imgSrc;
  coverImg.alt = title;
  document.getElementById('detail-cover-blur').style.backgroundImage = `url(${imgSrc})`;

  // Meta pills
  const status = manga.attributes?.status;
  const year = manga.attributes?.year;
  const rating = manga.attributes?.contentRating;
  const statusMap = { ongoing: '🔄 En curso', completed: '✅ Completo', hiatus: '⏸️ Hiatus', cancelled: '❌ Cancelado' };
  const ratingColor = { safe: 'green', suggestive: 'yellow', erotica: 'purple', pornographic: 'purple' };

  document.getElementById('detail-meta').innerHTML = `
    ${status ? `<span class="meta-pill green">${statusMap[status] || status}</span>` : ''}
    ${year ? `<span class="meta-pill">📅 ${year}</span>` : ''}
    ${rating ? `<span class="meta-pill ${ratingColor[rating] || ''}">${rating}</span>` : ''}
  `;

  // Tags
  const tags = (manga.attributes?.tags || []).slice(0, 8);
  document.getElementById('detail-tags').innerHTML = tags.map(t =>
    `<span class="tag">${t.attributes?.name?.en || t.attributes?.name?.es || ''}</span>`
  ).join('');

  // Descripción
  const descEl = document.getElementById('detail-desc');
  descEl.textContent = desc || 'Sin descripción disponible.';
  descEl.classList.remove('expanded');
  document.getElementById('btn-expand-desc').style.display = desc && desc.length > 150 ? 'block' : 'none';

  // Favorito
  const favBtn = document.getElementById('btn-fav-toggle');
  favBtn.textContent = state.favorites[manga.id] ? '♥' : '♡';
  favBtn.classList.toggle('active', !!state.favorites[manga.id]);

  // Capítulos
  document.getElementById('chapters-list').innerHTML = '';
  document.getElementById('chapter-count').textContent = '';
  document.getElementById('btn-more-chapters').classList.add('hidden');

  navigateTo('detail');
  // Scroll al top
  document.getElementById('page-detail').scrollTo(0, 0);

  // Cargar capítulos en background
  loadChapters(manga.id, 0);
}

async function loadChapters(mangaId, offset = 0) {
  const list = document.getElementById('chapters-list');
  const moreBtn = document.getElementById('btn-more-chapters');

  if (offset === 0) {
    list.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:12px 0">Cargando capítulos...</p>';
    state.currentChapters = [];
  }

  try {
    // Orden ASCENDENTE: capítulo 1 primero. Ambas variantes de español.
    const url = `${API}/manga/${mangaId}/feed?limit=500&offset=${offset}&translatedLanguage[]=es&translatedLanguage[]=es-la&order[chapter]=asc&order[volume]=asc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic`;
    const data = await fetchJSON(url);
    const chapters = data.data || [];
    const total = data.total || 0;

    // Deduplicar por número de capítulo (primera traducción encontrada)
    const seen = new Set(state.currentChapters.map(c => c.attributes?.chapter));
    const unique = chapters.filter(c => {
      const num = c.attributes?.chapter;
      if (seen.has(num)) return false;
      seen.add(num);
      return true;
    });

    state.currentChapters = [...state.currentChapters, ...unique];

    // Si no hay capítulos en ES en la primera página, intentar con inglés como respaldo
    if (state.currentChapters.length === 0 && offset === 0) {
      const fallbackUrl = `${API}/manga/${mangaId}/feed?limit=500&offset=0&translatedLanguage[]=en&order[chapter]=asc&order[volume]=asc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic`;
      const fallbackData = await fetchJSON(fallbackUrl);
      const fbChaps = fallbackData.data || [];
      const fbSeen = new Set();
      fbChaps.forEach(c => {
        const num = c.attributes?.chapter;
        if (!fbSeen.has(num)) { fbSeen.add(num); state.currentChapters.push(c); }
      });
      if (state.currentChapters.length > 0) {
        toast('⚠️ Solo disponible en inglés');
      }
      if (fallbackData.total > 500) {
        await loadAllChaptersEN(mangaId, 500, fallbackData.total);
      }
    }

    // Si aún hay más páginas en español, cargarlas automáticamente
    const newOffset = offset + chapters.length;
    if (newOffset < total) {
      // Cargar automáticamente sin que el usuario haga clic
      await loadChapters(mangaId, newOffset);
      return; // El render final lo hará la última llamada recursiva
    }

    // Render final: ya tenemos todos los capítulos
    renderAllChapters();
    moreBtn.classList.add('hidden');

  } catch (e) {
    console.warn(e);
    if (offset === 0) list.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:12px 0">Error cargando capítulos. Revisa tu conexión.</p>';
  }
}

async function loadAllChaptersEN(mangaId, offset, total) {
  try {
    while (offset < total) {
      const url = `${API}/manga/${mangaId}/feed?limit=500&offset=${offset}&translatedLanguage[]=en&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic`;
      const data = await fetchJSON(url);
      const chapters = data.data || [];
      const seen = new Set(state.currentChapters.map(c => c.attributes?.chapter));
      chapters.forEach(c => {
        const num = c.attributes?.chapter;
        if (!seen.has(num)) { seen.add(num); state.currentChapters.push(c); }
      });
      offset += chapters.length;
      if (!chapters.length) break;
    }
  } catch(e) { console.warn('EN fallback error:', e); }
}

function renderAllChapters() {
  const list = document.getElementById('chapters-list');
  list.innerHTML = '';

  if (state.currentChapters.length === 0) {
    list.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:12px 0">😢 No hay capítulos disponibles para este manga.</p>';
    document.getElementById('chapter-count').textContent = '0';
    return;
  }

  document.getElementById('chapter-count').textContent = `${state.currentChapters.length}`;
  state.currentChapters.forEach((ch, idx) => {
    list.appendChild(createChapterItem(ch, idx));
  });
}

function createChapterItem(chapter, idx) {
  const num = chapter.attributes?.chapter || '?';
  const title = chapter.attributes?.title || '';
  const date = formatDate(chapter.attributes?.publishAt);
  const isRead = !!state.readChapters[chapter.id];

  const item = document.createElement('div');
  item.className = `chapter-item${isRead ? ' read' : ''}`;
  item.dataset.idx = idx;
  item.innerHTML = `
    <div class="chap-left">
      <span class="chap-num">Capítulo ${num}${title ? ` — ${title}` : ''}</span>
      ${date ? `<span class="chap-date">${date}</span>` : ''}
    </div>
    <div class="chap-read-dot"></div>
  `;
  item.addEventListener('click', () => openReader(idx));
  return item;
}

// Descripción expandible
document.getElementById('btn-expand-desc').addEventListener('click', function() {
  const desc = document.getElementById('detail-desc');
  desc.classList.toggle('expanded');
  this.textContent = desc.classList.contains('expanded') ? 'Ver menos ▴' : 'Ver más ▾';
});

// Favorito
document.getElementById('btn-fav-toggle').addEventListener('click', () => {
  const manga = state.currentManga;
  if (!manga) return;
  if (state.favorites[manga.id]) {
    delete state.favorites[manga.id];
    document.getElementById('btn-fav-toggle').textContent = '♡';
    document.getElementById('btn-fav-toggle').classList.remove('active');
    toast('Eliminado de biblioteca');
  } else {
    state.favorites[manga.id] = {
      id: manga.id,
      title: getTitle(manga),
      cover: getCoverRelation(manga)?.attributes?.fileName,
    };
    document.getElementById('btn-fav-toggle').textContent = '♥';
    document.getElementById('btn-fav-toggle').classList.add('active');
    toast('💜 Añadido a biblioteca');
  }
  localStorage.setItem('mz_favorites', JSON.stringify(state.favorites));
});

// Botón atrás
document.getElementById('btn-back-detail').addEventListener('click', () => navigateTo('home'));

// =====================================================
// READER
// =====================================================
async function openReader(chapterIdx) {
  state.currentChapterIndex = chapterIdx;
  state.currentPageIndex = 0;
  state.pages = [];
  state.uiVisible = true;

  const chapter = state.currentChapters[chapterIdx];
  if (!chapter) return;

  state.currentChapterId = chapter.id;
  const manga = state.currentManga;

  // Títulos
  document.getElementById('reader-manga-title').textContent = getTitle(manga);
  document.getElementById('reader-chapter-label').textContent = `Cap. ${chapter.attributes?.chapter || '?'}`;

  // Modo lector
  applyReaderMode(state.readerMode);
  applyReaderBg(state.readerBg);

  navigateTo('reader');

  // Cargar páginas
  const container = document.getElementById('pages-container');
  container.innerHTML = '<div style="color:var(--text2);text-align:center;padding:40px 20px;font-size:15px">Cargando capítulo...</div>';

  try {
    const serverData = await fetchJSON(`${API}/at-home/server/${chapter.id}`);
    const { baseUrl, chapter: ch } = serverData;
    const dataSaver = ch.dataSaver || ch.data || [];
    const pages = ch.data || dataSaver;
    const quality = ch.data ? 'data' : 'data-saver';

    state.pages = pages.map(p => `${baseUrl}/${quality}/${ch.hash}/${p}`);

    renderReaderPages(container, state.pages);

    // Marcar como leído
    state.readChapters[chapter.id] = true;
    localStorage.setItem('mz_read', JSON.stringify(state.readChapters));
    updateChapterReadState(chapter.id);

    updateProgress(0, state.pages.length);

    // Nav botones (orden ASC: índice 0 = cap 1, índice N = último)
    document.getElementById('btn-prev-chapter').disabled = chapterIdx <= 0;
    document.getElementById('btn-next-chapter').disabled = chapterIdx >= state.currentChapters.length - 1;

  } catch(e) {
    console.error('Reader error:', e);
    container.innerHTML = '<div style="color:#f87171;text-align:center;padding:40px 20px;font-size:15px">Error cargando capítulo. Intenta con otro.</div>';
  }
}

function renderReaderPages(container, pages) {
  container.innerHTML = '';
  pages.forEach((url, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'page-img-wrap';

    const placeholder = document.createElement('div');
    placeholder.className = 'page-img-placeholder';
    wrap.appendChild(placeholder);

    const img = new Image();
    img.className = 'page-img';
    img.alt = `Página ${i + 1}`;
    img.loading = i < 3 ? 'eager' : 'lazy';
    img.onload = () => {
      placeholder.replaceWith(img);
    };
    img.onerror = () => {
      placeholder.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--text3);font-size:13px">Error página ${i+1}</div>`;
    };
    img.src = url;

    container.appendChild(wrap);
  });

  // Scroll progress tracking (vertical mode)
  if (state.readerMode === 'vertical') {
    container.addEventListener('scroll', handleReaderScroll, { passive: true });
  }
}

function handleReaderScroll() {
  const container = document.getElementById('pages-container');
  const { scrollTop, scrollHeight, clientHeight } = container;
  const progress = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
  updateProgress(progress, 1, true);

  // Calcular página visible aproximada
  const wraps = container.querySelectorAll('.page-img-wrap');
  let current = 0;
  wraps.forEach((w, i) => {
    const rect = w.getBoundingClientRect();
    if (rect.top <= window.innerHeight / 2) current = i;
  });
  document.getElementById('reader-page-indicator').textContent = `${current + 1} / ${state.pages.length}`;
}

function updateProgress(val, total, isRatio = false) {
  const pct = isRatio ? val * 100 : (val / total) * 100;
  document.getElementById('reader-progress-fill').style.width = `${Math.min(100, pct)}%`;
  if (!isRatio) {
    document.getElementById('reader-page-indicator').textContent = `${val + 1} / ${total}`;
  }
}

function updateChapterReadState(chapterId) {
  document.querySelectorAll('.chapter-item').forEach(item => {
    const idx = parseInt(item.dataset.idx);
    const ch = state.currentChapters[idx];
    if (ch && ch.id === chapterId) item.classList.add('read');
  });
}

// Toggle UI con tap en el centro
document.getElementById('pages-container').addEventListener('click', (e) => {
  const x = e.clientX / window.innerWidth;
  if (state.readerMode === 'paged') {
    // Paged mode: tap left/right
    if (x < 0.35) prevPage();
    else if (x > 0.65) nextPage();
    else toggleReaderUI();
  } else {
    // Vertical: toggle UI
    if (x > 0.3 && x < 0.7) toggleReaderUI();
  }
});

function toggleReaderUI() {
  state.uiVisible = !state.uiVisible;
  const overlay = document.getElementById('reader-ui-overlay');
  overlay.classList.toggle('hidden-ui', !state.uiVisible);
}

// Prev/next page (paged mode)
function prevPage() {
  const container = document.getElementById('pages-container');
  const wraps = container.querySelectorAll('.page-img-wrap');
  state.currentPageIndex = Math.max(0, state.currentPageIndex - 1);
  wraps[state.currentPageIndex]?.scrollIntoView({ behavior: 'smooth' });
  document.getElementById('reader-page-indicator').textContent = `${state.currentPageIndex + 1} / ${state.pages.length}`;
  updateProgress(state.currentPageIndex, state.pages.length);
}
function nextPage() {
  const container = document.getElementById('pages-container');
  const wraps = container.querySelectorAll('.page-img-wrap');
  state.currentPageIndex = Math.min(state.pages.length - 1, state.currentPageIndex + 1);
  wraps[state.currentPageIndex]?.scrollIntoView({ behavior: 'smooth' });
  document.getElementById('reader-page-indicator').textContent = `${state.currentPageIndex + 1} / ${state.pages.length}`;
  updateProgress(state.currentPageIndex, state.pages.length);
}

// Chapter nav (orden ASC: índice crece = capítulo más nuevo)
document.getElementById('btn-next-chapter').addEventListener('click', () => {
  // next = índice mayor (capítulo más nuevo)
  const next = state.currentChapterIndex + 1;
  if (next < state.currentChapters.length) openReader(next);
  else toast('🎉 ¡Ya leíste el último capítulo!');
});
document.getElementById('btn-prev-chapter').addEventListener('click', () => {
  // prev = índice menor (capítulo más antiguo)
  const prev = state.currentChapterIndex - 1;
  if (prev >= 0) openReader(prev);
  else toast('Estás en el capítulo 1');
});

// Back from reader
document.getElementById('btn-back-reader').addEventListener('click', () => navigateTo('detail'));

// Reader settings
document.getElementById('btn-reader-settings').addEventListener('click', () => {
  document.getElementById('reader-settings-panel').classList.toggle('hidden');
});
document.getElementById('reader-mode-select').addEventListener('change', (e) => {
  state.readerMode = e.target.value;
  localStorage.setItem('mz_reader_mode', state.readerMode);
  applyReaderMode(state.readerMode);
});
document.querySelectorAll('.color-pick').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-pick').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.readerBg = btn.dataset.color;
    localStorage.setItem('mz_reader_bg', state.readerBg);
    applyReaderBg(state.readerBg);
  });
});

// Close settings on outside click
document.addEventListener('click', (e) => {
  const panel = document.getElementById('reader-settings-panel');
  const btn = document.getElementById('btn-reader-settings');
  if (!panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btn) {
    panel.classList.add('hidden');
  }
});

function applyReaderMode(mode) {
  const container = document.getElementById('pages-container');
  container.classList.remove('vertical-mode', 'paged-mode');
  container.classList.add(mode === 'paged' ? 'paged-mode' : 'vertical-mode');
  document.getElementById('reader-mode-select').value = mode;
}

function applyReaderBg(color) {
  document.getElementById('page-reader').style.background = color;
  document.getElementById('pages-container').style.background = color;
  document.querySelectorAll('.color-pick').forEach(b => {
    b.classList.toggle('active', b.dataset.color === color);
  });
}

// =====================================================
// LIBRARY
// =====================================================
function renderLibrary() {
  const favs = Object.values(state.favorites);
  const empty = document.getElementById('library-empty');
  const grid = document.getElementById('library-grid');
  empty.style.display = favs.length ? 'none' : '';
  grid.innerHTML = '';
  favs.forEach(fav => {
    const fakeManga = {
      id: fav.id,
      attributes: { title: { es: fav.title } },
      relationships: fav.cover ? [{ type: 'cover_art', attributes: { fileName: fav.cover } }] : [],
    };
    grid.appendChild(createMangaCard(fakeManga));
  });
}

// =====================================================
// BOTTOM NAVIGATION
// =====================================================
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if (page === 'library') renderLibrary();
    navigateTo(page);
  });
});

// =====================================================
// INIT
// =====================================================
function init() {
  // Ocultar splash después de la animación
  setTimeout(() => {
    document.getElementById('splash-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
    navigateTo('home', false);
    loadHome();
  }, 2500);

  // Inicializar colores del reader
  applyReaderBg(state.readerBg);
  document.getElementById('reader-mode-select').value = state.readerMode;
}

init();
