/* ============================================================
   FIREBASE RTDB INITIALIZATION & REAL-TIME PRESENCE CONFIG
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyDpCAXfhldRc1nCZDWlWNRbcMFjqAh8uPc",
  authDomain: "cloud-db-studio.firebaseapp.com",
  databaseURL: "https://cloud-db-studio-default-rtdb.firebaseio.com",
  projectId: "cloud-db-studio",
  storageBucket: "cloud-db-studio.firebasestorage.app",
  messagingSenderId: "343326148662",
  appId: "1:343326148662:web:987738ccc8f9d6a8253097"
};

/* ============================================================
   RUNTIME CONFIGURATION (safe to edit)
   ============================================================ */
const APP_CONFIG = {
  /* Optional TURN relay endpoint (see functions/api/turn.js). Falls back to STUN-only when absent. */
  turnEndpoint: '/api/turn',
  /* Extra static ICE servers, e.g. [{ urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }] */
  extraIceServers: [],
  /* How long a viewer waits for the WebRTC tunnel before giving up. */
  connectTimeoutMs: 12000,
  /* Idle tabs release their realtime connection after this long (Firebase free tier caps concurrent connections). */
  idleOfflineAfterMs: 120000
};

/* localStorage can throw (private mode, blocked cookies, quota) — never let that break the app. */
const storage = (() => {
  const mem = new Map();
  return {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return mem.has(key) ? mem.get(key) : null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) { mem.set(key, String(value)); }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { mem.delete(key); }
    }
  };
})();

/* If the Firebase CDN is blocked the UI still loads and explains what is wrong. */
const FIREBASE_READY = typeof firebase !== 'undefined' && !!firebase.database;
let db;
if (FIREBASE_READY) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
} else {
  db = createOfflineDb();
}
const SERVER_TIMESTAMP = FIREBASE_READY ? firebase.database.ServerValue.TIMESTAMP : Date.now();

function createOfflineDb() {
  const noop = () => {};
  const rejected = () => Promise.reject(new Error('offline'));
  const ref = {
    on: noop, off: noop,
    once: () => Promise.resolve({ val: () => null }),
    set: rejected, update: rejected, remove: rejected, push: rejected,
    child: () => ref,
    onDisconnect: () => ({ remove: () => Promise.resolve() })
  };
  return { ref: () => ref, goOffline: noop, goOnline: noop };
}

const RTDB_HOSTS_PATH = 'stream-yours-hosts';
const RTDB_SIGNALS_PATH = 'stream-yours-signals';
const VIEW_MODE_STORAGE_KEY = 'sy_view_mode_v1';
const HOST_HEARTBEAT_MS = 5000;
const HOST_TTL_MS = 30000;

const BASE_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

/* Resolve ICE servers once and reuse them. When /api/turn exists (Cloudflare Pages Function) viewers and hosts
   behind strict NATs / mobile carriers get a TURN relay as a last-resort path; direct P2P is always tried first. */
const rtcConfigState = { cfg: null, expiresAt: 0, pending: null };

async function getRtcConfig() {
  const now = Date.now();
  if (rtcConfigState.cfg && now < rtcConfigState.expiresAt) return rtcConfigState.cfg;
  if (rtcConfigState.pending) return rtcConfigState.pending;

  rtcConfigState.pending = (async () => {
    let servers = [...BASE_ICE_SERVERS, ...APP_CONFIG.extraIceServers];
    let expiresAt = Date.now() + 10 * 60 * 1000;

    if (APP_CONFIG.turnEndpoint && /^https?:$/.test(location.protocol)) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch(APP_CONFIG.turnEndpoint, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);
        const isJson = (res.headers.get('content-type') || '').includes('json');
        if (res.ok && isJson) {
          const data = await res.json();
          if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
            servers = servers.concat(data.iceServers);
            const exp = Number(data.expiresAt) || (Date.now() + 3600 * 1000);
            expiresAt = Math.max(Date.now() + 60 * 1000, exp - 5 * 60 * 1000);
          }
        }
      } catch (e) { /* no TURN endpoint — STUN-only is fine */ }
    }

    rtcConfigState.cfg = { iceServers: servers };
    rtcConfigState.expiresAt = expiresAt;
    return rtcConfigState.cfg;
  })();

  try { return await rtcConfigState.pending; } finally { rtcConfigState.pending = null; }
}

const VIDEO_EXTS = new Set([
  'mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'flv', 'wmv', 'ts', 'm2ts', 'ogv', '3gp'
]);

/* ============================================================
   ISO-639 EMBEDDED AUDIO LANGUAGE DICTIONARY
   ============================================================ */
const ISO_LANG_MAP = {
  eng: 'English', en: 'English',
  hin: 'Hindi', hi: 'Hindi',
  jpn: 'Japanese', ja: 'Japanese',
  kor: 'Korean', ko: 'Korean',
  spa: 'Spanish', es: 'Spanish',
  fra: 'French', fre: 'French', fr: 'French',
  deu: 'German', ger: 'German', de: 'German',
  ita: 'Italian', it: 'Italian',
  por: 'Portuguese', pt: 'Portuguese',
  rus: 'Russian', ru: 'Russian',
  ara: 'Arabic', ar: 'Arabic',
  zho: 'Chinese', chi: 'Chinese', zh: 'Chinese', cmn: 'Mandarin', yue: 'Cantonese',
  tam: 'Tamil', ta: 'Tamil',
  tel: 'Telugu', te: 'Telugu',
  mal: 'Malayalam', ml: 'Malayalam',
  kan: 'Kannada', kn: 'Kannada',
  ben: 'Bengali', bn: 'Bengali',
  mar: 'Marathi', mr: 'Marathi',
  pan: 'Punjabi', pa: 'Punjabi',
  guj: 'Gujarati', gu: 'Gujarati',
  urd: 'Urdu', ur: 'Urdu',
  nep: 'Nepali', ne: 'Nepali',
  tha: 'Thai', th: 'Thai',
  vie: 'Vietnamese', vi: 'Vietnamese',
  ind: 'Indonesian', id: 'Indonesian',
  msa: 'Malay', may: 'Malay', ms: 'Malay',
  tur: 'Turkish', tr: 'Turkish',
  pol: 'Polish', pl: 'Polish',
  nld: 'Dutch', dut: 'Dutch', nl: 'Dutch',
  swe: 'Swedish', sv: 'Swedish',
  nor: 'Norwegian', no: 'Norwegian',
  dan: 'Danish', da: 'Danish',
  fin: 'Finnish', fi: 'Finnish',
  ell: 'Greek', gre: 'Greek', el: 'Greek',
  heb: 'Hebrew', he: 'Hebrew',
  fas: 'Persian', per: 'Persian', fa: 'Persian',
  ukr: 'Ukrainian', uk: 'Ukrainian',
  ces: 'Czech', cze: 'Czech', cs: 'Czech',
  hun: 'Hungarian', hu: 'Hungarian',
  ron: 'Romanian', rum: 'Romanian', ro: 'Romanian',
  fil: 'Filipino', tgl: 'Tagalog', tl: 'Filipino'
};

function formatLanguageName(code, rawName, idx) {
  const cleanCode = String(code || '').trim().toLowerCase();
  const mapped = ISO_LANG_MAP[cleanCode] || (cleanCode && cleanCode !== 'und' ? cleanCode.toUpperCase() : '');
  const cleanTitle = String(rawName || '').replace(/[\x00-\x1F]/g, '').trim();
  const isGenericTitle = !cleanTitle || /^(soundhandler|track\s*\d+|audio\s*\d+|und)$/i.test(cleanTitle);

  if (mapped && !isGenericTitle && !cleanTitle.toLowerCase().includes(mapped.toLowerCase())) {
    return `${mapped} (${cleanTitle})`;
  }
  if (mapped) return mapped;
  if (!isGenericTitle) return cleanTitle;
  return `Audio Track ${idx + 1}`;
}

function formatChannelLayout(channels) {
  const ch = Number(channels || 0);
  if (ch === 1) return 'Mono';
  if (ch === 2) return 'Stereo';
  if (ch === 6) return '5.1';
  if (ch === 8) return '7.1';
  return ch > 0 ? `${ch}ch` : '';
}

function formatAudioCodec(codec) {
  const c = String(codec || '').toLowerCase();
  if (c.startsWith('mp4a')) return 'AAC';
  if (c === 'ac-3' || c === 'ac3') return 'AC3';
  if (c === 'ec-3' || c === 'eac3') return 'EAC3';
  if (c === 'opus') return 'Opus';
  if (c === 'flac') return 'FLAC';
  if (c === 'mp3' || c === 'mp4a.6b') return 'MP3';
  if (c.startsWith('dts')) return 'DTS';
  return c ? c.toUpperCase() : 'AUDIO';
}

/* ============================================================
   GLOBAL APPLICATION & HOSTING STATE
   ============================================================ */
function generateShortId(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

function detectDeviceLabel() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Node';
}

const LOCAL_HOST_ID = `host_${generateShortId(10)}`;
const LOCAL_DEVICE_NAME = `${detectDeviceLabel()}-${LOCAL_HOST_ID.slice(-4).toUpperCase()}`;

let isHosting = false;
let localFileMap = new Map(); // fileId -> File
let localCatalogItems = [];
let hostHeartbeatTimer = null;
let hostSignalRef = null;
let hostPeerConns = new Map(); // sessionKey -> { pc, dc, streams: Map<streamId, { aborted: boolean, paused: boolean }> }
let hostBytesSentWindow = 0;
let hostUploadMbps = 0;

let serverTimeOffsetMs = 0;
let rawHostsSnapshot = {};
let onlineHosts = [];
let deadHostIds = new Set();
let allRootItems = [];

let typeFilter = 'ALL';
let hostFilterId = 'ALL';
let sortField = 'DEFAULT';
let sortDir = 'ASC';
let viewMode = storage.get(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid';
let searchQuery = '';

let activeSeriesFolder = null;
let activeSeriesEpisodes = [];

/* Active Player State */
let activePlayerList = [];
let activeIndex = -1;
let activeMedia = null;
let activePlaybackEngine = null;
let availableAudioTracks = [];
let activeAudioTrackIndex = 0;
let activeSpeed = 1;
let isLooping = false;
let lastSavedTick = 0;
let savedVol = 1;
let isMuted = false;
let localObjectUrl = null;
let activeRemoteSession = null;
let isSeekScrubbing = false;
let activeSubtitle = null;
let subtitleSelectToken = 0;
let subtitleRequestSeq = 1000;
const localSubtitleIds = new Set();
const SUB_EXTS = new Set(['srt', 'vtt']);
const SUB_MAX_BYTES = 3 * 1024 * 1024;
let deferredInstallPrompt = null;
let lastHostsSignature = null; /* null = nothing rendered yet, so the first pass always draws the UI */

/* Fullscreen State */
let isFullscreenMode = false;
let fsButtonVisible = true;
let orientationLockedByPlayer = false;

const SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x', sub: 'Slow' },
  { value: 0.75, label: '0.75x', sub: 'Relaxed' },
  { value: 1, label: '1x', sub: 'Normal' },
  { value: 1.25, label: '1.25x', sub: 'Brisk' },
  { value: 1.5, label: '1.5x', sub: 'Fast' },
  { value: 2, label: '2x', sub: 'Double' }
];

/* ============================================================
   TIME SYNC & IMMEDIATE DISCONNECTION CLEANUP
   ============================================================ */
db.ref('.info/serverTimeOffset').on('value', (snap) => {
  serverTimeOffsetMs = snap.val() || 0;
});

function getServerNowMs() {
  return Date.now() + serverTimeOffsetMs;
}

let rtdbConnected = false;
let rtdbConnectedSince = 0;

db.ref('.info/connected').on('value', (snap) => {
  rtdbConnected = snap.val() === true;
  if (rtdbConnected) rtdbConnectedSince = performance.now();
  if (rtdbConnected && isHosting && localCatalogItems.length > 0) {
    publishHostCatalog();
  }
});

function immediateDisconnectCleanup() {
  if (!isHosting) return;
  try {
    db.ref(`${RTDB_HOSTS_PATH}/${LOCAL_HOST_ID}`).remove().catch(() => {});
    db.ref(`${RTDB_SIGNALS_PATH}/${LOCAL_HOST_ID}`).remove().catch(() => {});
    const url = `${firebaseConfig.databaseURL}/${RTDB_HOSTS_PATH}/${LOCAL_HOST_ID}.json`;
    fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
    const sigUrl = `${firebaseConfig.databaseURL}/${RTDB_SIGNALS_PATH}/${LOCAL_HOST_ID}.json`;
    fetch(sigUrl, { method: 'DELETE', keepalive: true }).catch(() => {});
  } catch (e) {}
}

window.addEventListener('beforeunload', immediateDisconnectCleanup);
window.addEventListener('pagehide', immediateDisconnectCleanup);

/* ============================================================
   SMART FILENAME & METADATA PARSER
   ============================================================ */
function isVideoFilename(name) {
  const m = String(name || '').match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? VIDEO_EXTS.has(m[1].toLowerCase()) : false;
}

function parseMediaMetadata(rawFilename, isFolder = false) {
  const extMatch = !isFolder ? rawFilename.match(/\.([a-zA-Z0-9]{2,5})$/) : null;
  const ext = extMatch ? extMatch[1].toUpperCase() : '';
  const base = !isFolder ? rawFilename.replace(/\.[^/.]+$/, '') : rawFilename;

  let year = '';
  const bracketYearMatch = base.match(/[\(\[]\s*(19[2-9]\d|20[0-2]\d)\s*[\)\]]/);
  if (bracketYearMatch) year = bracketYearMatch[1];

  const working = base.replace(/[._]+/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

  let seasonEp = '';
  const seMatch = working.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) || working.match(/\b(\d{1,2})x(\d{2})\b/i);
  if (seMatch) {
    seasonEp = `S${seMatch[1].padStart(2, '0')}·E${seMatch[2].padStart(2, '0')}`;
  }

  let res = '';
  if (/\b(2160p|4K|UHD)\b/i.test(working)) res = '4K';
  else if (/\b1440p\b/i.test(working)) res = '2K';
  else if (/\b1080p\b/i.test(working)) res = '1080p';
  else if (/\b720p\b/i.test(working)) res = '720p';
  else if (/\b480p\b/i.test(working)) res = '480p';

  let codec = '';
  if (/\b(HDR10|HDR|DV|Dolby\s*Vision)\b/i.test(working)) codec = 'HDR';
  else if (/\b(HEVC|x265|H\s*265)\b/i.test(working)) codec = 'HEVC';

  let audioTag = '';
  if (/\b(Dual\s*Audio|Multi\s*Audio)\b/i.test(working)) audioTag = 'DUAL';
  else if (/\bHindi\b/i.test(working)) audioTag = 'HIN';
  else if (/\bJapanese\b/i.test(working)) audioTag = 'JPN';
  else if (/\bKorean\b/i.test(working)) audioTag = 'KOR';

  if (!year) {
    const allYears = [...working.matchAll(/\b(19[2-9]\d|20[0-2]\d)\b/g)];
    if (allYears.length > 0) year = allYears[allYears.length - 1][1];
  }

  const releaseYear = year ? parseInt(year, 10) : 0;

  let stripped = working
    .replace(/\b(2160p|1440p|1080p|720p|480p|4K|UHD|WEB-?DL|WEBRip|BluRay|BRRip|BDRip|HDRip|DVDRip|HDTV|CAMRip|CAM|TS|HEVC|x265|x264|H264|H265|10bit|10-bit|8bit|AAC|AC3|DTS|DDP5\s*1|DD5\s*1|Atmos|TrueHD|Dual\s*Audio|Multi\s*Audio|ESub|ESubs|YIFY|RARBG|PSA|EVO|FGT|SPARKS|AMIABLE|EXTENDED|REMASTERED|UNRATED|DIRECTORS\s*CUT)\b/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (year) {
    const lastYearRegex = new RegExp(`\\(?\\b${year}\\b\\)?(?![\\s\\S]*\\b${year}\\b)`);
    const withoutReleaseYear = stripped.replace(lastYearRegex, ' ').replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (withoutReleaseYear.length >= 1) stripped = withoutReleaseYear;
  }

  const cleanName = stripped.length >= 1 ? stripped : working;
  const specs = [year, res, audioTag, codec].filter(Boolean);

  return { cleanName, year, releaseYear, res, codec, audioTag, seasonEp, ext, specs };
}

/* ============================================================
   PROCEDURAL SQUIRCLE THUMBNAILS
   ============================================================ */
const POSTER_PALETTES = [
  { c1: '#162f4f', c2: '#356a9c', accent: '#90cdf4' },
  { c1: '#10233c', c2: '#2b5b88', accent: '#75b0e6' },
  { c1: '#1b3658', c2: '#42769c', accent: '#bee3f8' },
  { c1: '#132842', c2: '#316085', accent: '#8bbce8' },
  { c1: '#1a2f4b', c2: '#44688e', accent: '#a3cef1' },
  { c1: '#0e2239', c2: '#275580', accent: '#6aa9e3' }
];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getMonogram(title) {
  const words = title.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'SY';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function buildCodedThumbnailSvg(item, epNumber = null) {
  const meta = item.meta || parseMediaMetadata(item.name, item.type === 'folder');
  const seed = hashString(`${meta.cleanName}_${item.serverName}`);
  const pal = POSTER_PALETTES[seed % POSTER_PALETTES.length];
  const patternType = seed % 3;
  const isSeries = item.type === 'folder';
  const mono = epNumber !== null ? `E${String(epNumber).padStart(2, '0')}` : getMonogram(meta.cleanName);

  const topLeftBadge = epNumber !== null
    ? (meta.seasonEp || `EP ${String(epNumber).padStart(2, '0')}`)
    : (isSeries ? `${item.count || 0} EP` : (meta.res || meta.ext || 'HD'));

  const topRightBadge = meta.year || (isSeries ? 'SERIES' : meta.ext);

  let progressPct = 0;
  if (item.type === 'file') {
    const prog = getSavedProgress(item);
    if (prog && prog.pos > 15 && prog.dur > 30 && prog.pos < prog.dur - 25) {
      progressPct = Math.min(100, Math.max(4, Math.round((prog.pos / prog.dur) * 100)));
    }
  }

  let motifSvg = '';
  if (patternType === 0) {
    motifSvg = `
      <circle cx="255" cy="22" r="82" fill="none" stroke="${pal.accent}" stroke-opacity="0.14" stroke-width="14"/>
      <circle cx="255" cy="22" r="46" fill="none" stroke="${pal.accent}" stroke-opacity="0.18" stroke-width="5"/>
    `;
  } else if (patternType === 1) {
    motifSvg = `
      <path d="M-20 142 Q 95 58, 185 118 T 340 68 L 340 200 L -20 200 Z" fill="${pal.accent}" fill-opacity="0.12"/>
      <path d="M-20 166 Q 115 96, 215 144 T 340 104 L 340 200 L -20 200 Z" fill="${pal.accent}" fill-opacity="0.09"/>
    `;
  } else {
    motifSvg = `
      <rect x="200" y="-20" width="122" height="122" rx="28" transform="rotate(22 200 -20)" fill="${pal.accent}" fill-opacity="0.1"/>
      <rect x="225" y="16" width="96" height="96" rx="22" transform="rotate(22 225 16)" fill="none" stroke="${pal.accent}" stroke-opacity="0.2" stroke-width="2"/>
    `;
  }

  const centerArtwork = isSeries
    ? `
      <rect x="128" y="48" width="64" height="14" rx="6" fill="#ffffff" fill-opacity="0.24"/>
      <rect x="122" y="54" width="76" height="16" rx="7" fill="#ffffff" fill-opacity="0.38"/>
      <path d="M116 70 C116 64 120 60 126 60 L145 60 L152 67 L194 67 C200 67 204 71 204 77 L204 112 C204 118 200 122 194 122 L126 122 C120 122 116 118 116 112 Z" fill="#ffffff" fill-opacity="0.94"/>
      <polygon points="154,84 171,94 154,104" fill="${pal.c1}"/>
    `
    : `
      <circle cx="160" cy="88" r="27" fill="#ffffff" fill-opacity="0.18"/>
      <circle cx="160" cy="88" r="20" fill="#ffffff" fill-opacity="0.95"/>
      <polygon points="155,79 170,88 155,97" fill="${pal.c1}"/>
    `;

  const progressBarSvg = progressPct > 0
    ? `
      <rect x="0" y="174" width="320" height="6" fill="#070b14" fill-opacity="0.65"/>
      <rect x="0" y="174" width="${Math.round((progressPct / 100) * 320)}" height="6" fill="#75b0e6"/>
    `
    : '';

  const gradId = `pg_${seed}`;
  return `
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${pal.c1}"/>
          <stop offset="100%" stop-color="${pal.c2}"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#${gradId})"/>
      ${motifSvg}
      <text x="16" y="158" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="44" font-weight="900" fill="#ffffff" fill-opacity="0.12" letter-spacing="-1">${escapeHtml(mono)}</text>
      ${centerArtwork}
      <rect x="13" y="13" width="66" height="23" rx="8" fill="#0c1320" fill-opacity="0.54"/>
      <text x="46" y="28.5" text-anchor="middle" font-family="ui-monospace, Consolas, sans-serif" font-size="11" font-weight="800" fill="#edf2f8">${escapeHtml(topLeftBadge)}</text>
      ${topRightBadge ? `
        <rect x="245" y="13" width="62" height="23" rx="8" fill="#0c1320" fill-opacity="0.42"/>
        <text x="276" y="28.5" text-anchor="middle" font-family="ui-monospace, Consolas, sans-serif" font-size="10.5" font-weight="800" fill="#bee3f8">${escapeHtml(topRightBadge)}</text>
      ` : ''}
      ${progressBarSvg}
    </svg>
  `;
}

function renderSignalBarsHtml(isLocal) {
  return `<span class="sig-bars s3" title="${isLocal ? 'Local' : 'P2P'}"><i></i><i></i><i></i></span>`;
}

function formatCompactBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

/* ============================================================
   FOLDER & FILE INGESTION + HOST BROADCASTING
   ============================================================ */
function ingestSelectedFiles(fileList, clearExisting = true) {
  const allInput = Array.from(fileList || []);
  const files = allInput.filter(f => isVideoFilename(f.name));
  const subtitleFiles = allInput.filter(f => isSubtitleFilename(f.name) && f.size > 0 && f.size <= SUB_MAX_BYTES);
  if (files.length === 0) {
    showToast('No supported video files found');
    return;
  }

  if (clearExisting) {
    localFileMap.clear();
    localSubtitleIds.clear();
  }

  const folderGroups = new Map();
  const standaloneMovies = [];

  if (!clearExisting && localCatalogItems.length > 0) {
    localCatalogItems.forEach(item => {
      if (item.type === 'folder') {
        folderGroups.set(item.name, [...(item.episodes || [])]);
      } else {
        standaloneMovies.push(item);
      }
    });
  }

  const ingestedVideos = [];

  files.forEach((file) => {
    const relPath = (file.webkitRelativePath || file.customRelPath || file.name).replace(/^\/+/, '');
    const parts = relPath.split('/').filter(Boolean);
    const fileId = `f_${generateShortId(8)}`;
    localFileMap.set(fileId, file);

    const entry = {
      id: fileId,
      name: file.name,
      path: relPath,
      size: file.size,
      sizeLabel: formatCompactBytes(file.size),
      type: 'file'
    };
    ingestedVideos.push({ entry, relPath });

    if (parts.length >= 3) {
      const seriesName = parts[parts.length - 2];
      if (!folderGroups.has(seriesName)) folderGroups.set(seriesName, []);
      folderGroups.get(seriesName).push(entry);
    } else {
      standaloneMovies.push(entry);
    }
  });

  attachSubtitlesToEntries(ingestedVideos, subtitleFiles);

  const nextCatalog = [];

  folderGroups.forEach((episodes, folderName) => {
    episodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const totalBytes = episodes.reduce((s, ep) => s + (ep.size || 0), 0);
    nextCatalog.push({
      id: `dir_${hashString(folderName).toString(36)}`,
      name: folderName,
      path: folderName,
      size: totalBytes,
      sizeLabel: formatCompactBytes(totalBytes),
      type: 'folder',
      count: episodes.length,
      episodes
    });
  });

  standaloneMovies.forEach(mov => nextCatalog.push(mov));
  localCatalogItems = nextCatalog;
  isHosting = true;

  document.getElementById('btnStopHost').style.display = 'inline-flex';
  startHostSignalingListener();
  publishHostCatalog();
  startHostHeartbeat();
  acquireHostKeepAwake();
  showToast(`Hosting ${files.length} video${files.length === 1 ? '' : 's'}`);
}

document.getElementById('folderInput').addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    ingestSelectedFiles(e.target.files, true);
  }
  e.target.value = '';
});

document.getElementById('filesInput').addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    ingestSelectedFiles(e.target.files, !isHosting);
  }
  e.target.value = '';
});

/* Full-window Recursive Drag & Drop */
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  document.getElementById('dropOverlay').classList.add('show');
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.getElementById('dropOverlay').classList.remove('show');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.getElementById('dropOverlay').classList.remove('show');

  const items = e.dataTransfer && e.dataTransfer.items;
  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const collected = [];
    async function readEntry(entry, prefix = '') {
      if (!entry) return;
      if (entry.isFile) {
        await new Promise((res) => {
          entry.file((file) => {
            file.customRelPath = prefix ? `${prefix}/${file.name}` : file.name;
            collected.push(file);
            res();
          }, () => res());
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readBatch = () => new Promise((res) => reader.readEntries(res, () => res([])));
        let batch = await readBatch();
        while (batch && batch.length > 0) {
          for (const child of batch) {
            await readEntry(child, prefix ? `${prefix}/${entry.name}` : entry.name);
          }
          batch = await readBatch();
        }
      }
    }
    for (const item of Array.from(items)) {
      const entry = item.webkitGetAsEntry();
      if (entry) await readEntry(entry, '');
    }
    if (collected.length > 0) {
      ingestSelectedFiles(collected, true);
      return;
    }
  }

  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    ingestSelectedFiles(e.dataTransfer.files, true);
  }
});

let hostPublishedOnce = false;
let hostSelfHealRef = null;
let hostSelfHealTimer = null;

function publishHostCatalog() {
  if (!isHosting || localCatalogItems.length === 0) return;
  const hostRef = db.ref(`${RTDB_HOSTS_PATH}/${LOCAL_HOST_ID}`);
  hostRef.onDisconnect().remove().catch(() => {});
  hostRef.set({
    id: LOCAL_HOST_ID,
    name: LOCAL_DEVICE_NAME,
    updatedAt: SERVER_TIMESTAMP,
    items: localCatalogItems
  }).then(() => {
    hostPublishedOnce = true;
  }).catch(() => {
    if (isHosting) showToast('Could not publish your library — check your connection');
  });

  /* Self-heal: if anything removes this host record while we are still live, publish it again. */
  if (!hostSelfHealRef) {
    hostSelfHealRef = hostRef.child('id');
    hostSelfHealRef.on('value', (snap) => {
      if (!isHosting || !hostPublishedOnce || snap.val() !== null) return;
      clearTimeout(hostSelfHealTimer);
      hostSelfHealTimer = setTimeout(() => { if (isHosting) publishHostCatalog(); }, 700);
    });
  }
}

function stopHostSelfHeal() {
  clearTimeout(hostSelfHealTimer);
  hostSelfHealTimer = null;
  if (hostSelfHealRef) {
    try { hostSelfHealRef.off(); } catch (e) {}
    hostSelfHealRef = null;
  }
  hostPublishedOnce = false;
}

let hostHeartbeatWorker = null;
let hostLastBeatAt = 0;

function hostHeartbeatBeat() {
  if (!isHosting) return;
  const now = performance.now();
  const elapsedSec = Math.max(1, (now - (hostLastBeatAt || now - HOST_HEARTBEAT_MS)) / 1000);
  hostLastBeatAt = now;
  hostUploadMbps = +(hostBytesSentWindow / (1024 * 1024) / elapsedSec).toFixed(1);
  hostBytesSentWindow = 0;
  updateGlobalTelemetry();

  const hostRef = db.ref(`${RTDB_HOSTS_PATH}/${LOCAL_HOST_ID}`);
  hostRef.onDisconnect().remove().catch(() => {});
  /* id + name are rewritten too, so a record that was removed is never left half-built. */
  hostRef.update({
    id: LOCAL_HOST_ID,
    name: LOCAL_DEVICE_NAME,
    updatedAt: SERVER_TIMESTAMP
  }).catch(() => {});
}

function startHostHeartbeat() {
  stopHostHeartbeat();
  hostLastBeatAt = performance.now();

  /* A dedicated Worker keeps ticking at full speed while the tab is in the background,
     where normal timers are throttled to once a minute and would make the host look offline. */
  try {
    const src = `setInterval(function(){ postMessage(1); }, ${HOST_HEARTBEAT_MS});`;
    const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    hostHeartbeatWorker = new Worker(blobUrl);
    hostHeartbeatWorker.onmessage = hostHeartbeatBeat;
    hostHeartbeatWorker.onerror = () => {
      stopHostHeartbeat();
      hostHeartbeatTimer = setInterval(hostHeartbeatBeat, HOST_HEARTBEAT_MS);
    };
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
  } catch (e) {
    hostHeartbeatWorker = null;
    hostHeartbeatTimer = setInterval(hostHeartbeatBeat, HOST_HEARTBEAT_MS);
  }
}

function stopHostHeartbeat() {
  clearInterval(hostHeartbeatTimer);
  hostHeartbeatTimer = null;
  if (hostHeartbeatWorker) {
    try { hostHeartbeatWorker.terminate(); } catch (e) {}
    hostHeartbeatWorker = null;
  }
}

/* While hosting, ask the browser not to sleep or freeze this tab (phones suspend backgrounded tabs). */
let hostWakeLock = null;
let hostLockRelease = null;

async function acquireHostKeepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !hostWakeLock) {
      hostWakeLock = await navigator.wakeLock.request('screen');
      hostWakeLock.addEventListener('release', () => { hostWakeLock = null; });
    }
  } catch (e) { hostWakeLock = null; }

  try {
    if (navigator.locks && !hostLockRelease) {
      navigator.locks.request(`stream-yours-host-${LOCAL_HOST_ID}`, () => new Promise((resolve) => { hostLockRelease = resolve; })).catch(() => {});
    }
  } catch (e) {}
}

function releaseHostKeepAwake() {
  try { if (hostWakeLock) hostWakeLock.release(); } catch (e) {}
  hostWakeLock = null;
  if (hostLockRelease) { hostLockRelease(); hostLockRelease = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isHosting) acquireHostKeepAwake();
});

function stopHosting() {
  isHosting = false;
  stopHostHeartbeat();
  stopHostSelfHeal();
  releaseHostKeepAwake();
  localFileMap.clear();
  localSubtitleIds.clear();
  localCatalogItems = [];
  hostBytesSentWindow = 0;
  hostUploadMbps = 0;

  if (hostSignalRef) {
    hostSignalRef.off();
    hostSignalRef = null;
  }

  hostPeerConns.forEach((peer) => {
    peer.streams.forEach(s => { s.aborted = true; });
    try { peer.dc && peer.dc.close(); } catch (e) {}
    try { peer.pc && peer.pc.close(); } catch (e) {}
  });
  hostPeerConns.clear();

  db.ref(`${RTDB_HOSTS_PATH}/${LOCAL_HOST_ID}`).remove().catch(() => {});
  db.ref(`${RTDB_SIGNALS_PATH}/${LOCAL_HOST_ID}`).remove().catch(() => {});

  document.getElementById('btnStopHost').style.display = 'none';
  updateGlobalTelemetry();
  showToast('Stopped hosting');
}

/* ============================================================
   HOST-SIDE NATIVE WEBRTC MULTI-VIEWER ENGINE (EVENT-DRIVEN SCTP)
   ============================================================ */
function startHostSignalingListener() {
  if (hostSignalRef) hostSignalRef.off();
  hostSignalRef = db.ref(`${RTDB_SIGNALS_PATH}/${LOCAL_HOST_ID}`);
  hostSignalRef.onDisconnect().remove().catch(() => {});

  hostSignalRef.on('child_added', async (snap) => {
    const sessionKey = snap.key;
    const data = snap.val();
    if (!data || !data.offer || hostPeerConns.has(sessionKey)) return;

    const peerState = { pc: null, dc: null, streams: new Map() };
    hostPeerConns.set(sessionKey, peerState);
    updateGlobalTelemetry();

    const pc = new RTCPeerConnection(await getRtcConfig());
    peerState.pc = pc;
    if (!isHosting || hostPeerConns.get(sessionKey) !== peerState) {
      try { pc.close(); } catch (e) {}
      return;
    }

    const sessionRef = db.ref(`${RTDB_SIGNALS_PATH}/${LOCAL_HOST_ID}/${sessionKey}`);
    const hostCandRef = sessionRef.child('hostCandidates');
    const viewerCandRef = sessionRef.child('viewerCandidates');

    const cleanupPeer = () => {
      peerState.streams.forEach(s => { s.aborted = true; });
      peerState.streams.clear();
      viewerCandRef.off();
      try { peerState.dc && peerState.dc.close(); } catch (e) {}
      try { pc.close(); } catch (e) {}
      hostPeerConns.delete(sessionKey);
      sessionRef.remove().catch(() => {});
      updateGlobalTelemetry();
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        hostCandRef.push(ev.candidate.toJSON()).catch(() => {});
      }
    };

    /* 'disconnected' is often a brief network blip — give it a few seconds to recover before tearing down. */
    let disconnectTimer = null;
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      } else if (st === 'failed' || st === 'closed') {
        clearTimeout(disconnectTimer);
        cleanupPeer();
      } else if (st === 'disconnected' && !disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          disconnectTimer = null;
          if (pc.connectionState !== 'connected') cleanupPeer();
        }, 8000);
      }
    };

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      dc.binaryType = 'arraybuffer';
      peerState.dc = dc;

      dc.onopen = () => {
        viewerCandRef.off();
        sessionRef.remove().catch(() => {});
      };

      dc.onclose = cleanupPeer;
      dc.onerror = cleanupPeer;

      dc.onmessage = (msgEv) => {
        if (typeof msgEv.data !== 'string') return;
        let cmd;
        try { cmd = JSON.parse(msgEv.data); } catch (e) { return; }
        handleHostStreamCommand(peerState, cmd);
      };
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sessionRef.child('answer').set({ type: answer.type, sdp: answer.sdp });

      viewerCandRef.on('child_added', (cSnap) => {
        const cand = cSnap.val();
        if (cand && pc.remoteDescription) {
          pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
      });
    } catch (err) {
      cleanupPeer();
    }
  });
}

/* 16-byte Binary Frame Header: [uint32 streamId, uint32 payloadLen, float64 byteOffset] */
function buildBinaryPacket(streamId, byteOffset, chunkBuffer) {
  const payload = new Uint8Array(chunkBuffer);
  const packet = new ArrayBuffer(16 + payload.byteLength);
  const view = new DataView(packet);
  view.setUint32(0, streamId >>> 0, true);
  view.setUint32(4, payload.byteLength >>> 0, true);
  view.setFloat64(8, byteOffset, true);
  new Uint8Array(packet, 16).set(payload);
  return packet;
}

function waitForDcDrain(dc, token) {
  const HIGH_WATER = 10 * 1024 * 1024;
  const LOW_WATER = 512 * 1024;
  if (dc.bufferedAmount < HIGH_WATER) return Promise.resolve();

  return new Promise((resolve) => {
    dc.bufferedAmountLowThreshold = LOW_WATER;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dc.removeEventListener('bufferedamountlow', finish);
      clearInterval(fallbackTimer);
      resolve();
    };
    dc.addEventListener('bufferedamountlow', finish);
    const fallbackTimer = setInterval(() => {
      if (token.aborted || dc.readyState !== 'open' || dc.bufferedAmount <= LOW_WATER) {
        finish();
      }
    }, 25);
  });
}

async function pumpFileSliceToViewer(peerState, streamId, file, startByte, endByte, token, tag = 'DATA') {
  const dc = peerState.dc;
  if (!dc || dc.readyState !== 'open') return;

  const CHUNK_SIZE = 192 * 1024;
  let cursor = Math.max(0, Math.floor(startByte));
  const limit = Math.min(file.size, Math.floor(endByte));

  while (cursor < limit && !token.aborted && dc.readyState === 'open') {
    if (token.paused) {
      await new Promise(r => setTimeout(r, 35));
      continue;
    }

    await waitForDcDrain(dc, token);
    if (token.aborted || dc.readyState !== 'open') break;

    const nextEnd = Math.min(limit, cursor + CHUNK_SIZE);
    let sliceBuf;
    try {
      sliceBuf = await file.slice(cursor, nextEnd).arrayBuffer();
    } catch (readErr) {
      /* The file was moved, deleted or became unreadable while streaming. */
      if (dc.readyState === 'open') {
        try { dc.send(JSON.stringify({ type: 'FILE_MISSING', streamId })); } catch (e) {}
      }
      return;
    }
    if (token.aborted || dc.readyState !== 'open') break;

    try {
      dc.send(buildBinaryPacket(streamId, cursor, sliceBuf));
    } catch (sendErr) {
      return; /* channel closed mid-send */
    }
    hostBytesSentWindow += sliceBuf.byteLength;
    cursor = nextEnd;
  }

  if (!token.aborted && dc.readyState === 'open') {
    try {
      dc.send(JSON.stringify({ type: 'SLICE_DONE', streamId, tag, endByte: cursor, fileSize: file.size }));
    } catch (e) {}
  }
}

function handleHostStreamCommand(peerState, cmd) {
  const dc = peerState.dc;
  if (!dc || dc.readyState !== 'open') return;

  if (cmd.type === 'STOP_STREAM') {
    const existing = peerState.streams.get(cmd.streamId);
    if (existing) {
      existing.aborted = true;
      peerState.streams.delete(cmd.streamId);
    }
    return;
  }

  if (cmd.type === 'PAUSE_STREAM') {
    const existing = peerState.streams.get(cmd.streamId);
    if (existing) existing.paused = true;
    return;
  }

  if (cmd.type === 'RESUME_STREAM') {
    const existing = peerState.streams.get(cmd.streamId);
    if (existing) existing.paused = false;
    return;
  }

  if (cmd.type === 'GET_SUB') {
    serveSubtitleToViewer(dc, cmd).catch(() => {});
    return;
  }

  const file = localFileMap.get(cmd.fileId);
  if (!file) {
    dc.send(JSON.stringify({ type: 'FILE_MISSING', streamId: cmd.streamId }));
    return;
  }

  const prev = peerState.streams.get(cmd.streamId);
  if (prev) prev.aborted = true;

  const token = { aborted: false, paused: false };
  peerState.streams.set(cmd.streamId, token);

  if (cmd.type === 'INIT_PROBE') {
    dc.send(JSON.stringify({
      type: 'FILE_META',
      streamId: cmd.streamId,
      fileSize: file.size,
      fileName: file.name,
      mimeType: file.type || 'video/mp4'
    }));

    const headEnd = Math.min(file.size, 2.5 * 1024 * 1024);
    pumpFileSliceToViewer(peerState, cmd.streamId, file, 0, headEnd, token, 'HEAD').catch(() => {});
    return;
  }

  if (cmd.type === 'PROBE_TAIL') {
    const tailStart = Math.max(0, file.size - 6 * 1024 * 1024);
    pumpFileSliceToViewer(peerState, cmd.streamId, file, tailStart, file.size, token, 'TAIL').catch(() => {});
    return;
  }

  if (cmd.type === 'STREAM_RANGE') {
    const start = Math.max(0, Number(cmd.start || 0));
    const end = cmd.end ? Math.min(file.size, Number(cmd.end)) : file.size;
    pumpFileSliceToViewer(peerState, cmd.streamId, file, start, end, token, 'RANGE').catch(() => {});
  }
}

/* ============================================================
   REAL-TIME GLOBAL HOST DISCOVERY & INSTANT STALE PRUNING
   ============================================================ */
function reconcileOnlineHosts(force = false) {
  const nowMs = getServerNowMs();
  const live = [];

  if (rawHostsSnapshot && typeof rawHostsSnapshot === 'object') {
    Object.entries(rawHostsSnapshot).forEach(([key, hostObj]) => {
      if (!hostObj || typeof hostObj !== 'object' || !hostObj.id) return;
      const isSelf = hostObj.id === LOCAL_HOST_ID;
      if (deadHostIds.has(hostObj.id) && !isSelf) return;

      const updatedAt = Number(hostObj.updatedAt || 0);
      if (!isSelf && updatedAt > 0 && nowMs > 1700000000000 && (nowMs - updatedAt) > HOST_TTL_MS) {
        /* Hide it either way, but only delete the shared record while we are demonstrably online and in sync —
           a stale local cache (after a network drop) must never wipe live hosts. */
        if (rtdbConnected && (performance.now() - rtdbConnectedSince) > 5000) {
          db.ref(`${RTDB_HOSTS_PATH}/${key}`).remove().catch(() => {});
        }
        return;
      }
      live.push({ key, hostObj, isSelf });
    });
  }

  /* Heartbeats rewrite updatedAt every few seconds; only rebuild the UI when something visible changed. */
  const signature = live.map(({ hostObj }) => {
    const items = Array.isArray(hostObj.items) ? hostObj.items : [];
    return `${hostObj.id}|${hostObj.name}|${items.length}|${items.map(i => (i && i.id) || '').join(',')}`;
  }).sort().join('~');
  if (!force && signature === lastHostsSignature) return;
  lastHostsSignature = signature;

  const nextHosts = [];
  const nextItems = [];
  let seq = 0;

  live.forEach(({ key, hostObj, isSelf }) => {
    try {
      const items = Array.isArray(hostObj.items) ? hostObj.items.filter(it => it && typeof it === 'object') : [];
      if (items.length === 0) return;

      const hostName = String(hostObj.name || key);
      const hostItems = [];

      items.forEach((rawItem) => {
        const rawName = String(rawItem.name == null ? '' : rawItem.name);
        const meta = parseMediaMetadata(rawName, rawItem.type === 'folder');
        const episodes = Array.isArray(rawItem.episodes)
          ? rawItem.episodes.filter(ep => ep && typeof ep === 'object').map((ep, epIdx) => {
              const epName = String(ep.name == null ? '' : ep.name);
              const epMeta = parseMediaMetadata(epName, false);
              return {
                ...ep,
                name: epName,
                subs: sanitizeSubs(ep.subs),
                defaultOrder: epIdx,
                meta: epMeta,
                cleanName: epMeta.cleanName,
                releaseYear: epMeta.releaseYear || meta.releaseYear || 0,
                bytes: Number(ep.size || 0),
                serverId: hostObj.id,
                serverName: hostName,
                isLocal: isSelf
              };
            })
          : [];

        hostItems.push({
          ...rawItem,
          name: rawName,
          subs: sanitizeSubs(rawItem.subs),
          episodes,
          defaultOrder: seq++,
          meta,
          cleanName: meta.cleanName,
          releaseYear: meta.releaseYear,
          bytes: Number(rawItem.size || 0),
          serverId: hostObj.id,
          serverName: hostName,
          isLocal: isSelf
        });
      });

      nextHosts.push({ id: hostObj.id, name: hostName, isLocal: isSelf });
      hostItems.forEach(it => nextItems.push(it));
    } catch (err) {
      /* One malformed host record must never take the whole catalog down. */
    }
  });

  nextHosts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  onlineHosts = nextHosts;
  allRootItems = nextItems;

  updateDeviceDropdown();
  updateGlobalTelemetry();
  renderExplorer();
}

db.ref(RTDB_HOSTS_PATH).on('value', (snap) => {
  rawHostsSnapshot = snap.val() || {};
  Object.entries(rawHostsSnapshot).forEach(([key, h]) => {
    if (h && h.id && deadHostIds.has(h.id)) {
      const age = getServerNowMs() - Number(h.updatedAt || 0);
      if (age < 6000) deadHostIds.delete(h.id);
    }
  });
  reconcileOnlineHosts();
});

setInterval(reconcileOnlineHosts, 2500);

/* Hide a host on THIS device only. (Deleting its shared record would let one flaky viewer knock a healthy host
   offline for everyone; real disconnects are already cleaned up via onDisconnect + the heartbeat TTL.) */
function markHostDead(hostId) {
  if (!hostId || hostId === LOCAL_HOST_ID) return;
  deadHostIds.add(hostId);
  reconcileOnlineHosts(true);
}

function updateGlobalTelemetry() {
  const el = document.getElementById('globalTelemetry');
  if (isHosting) {
    const viewers = hostPeerConns.size;
    const speedStr = hostUploadMbps > 0 ? ` · ${hostUploadMbps} MB/s` : '';
    el.innerHTML = `
      <span class="node-pip"></span>
      <span class="mono">LIVE · ${viewers} VIEWER${viewers === 1 ? '' : 'S'}${speedStr}</span>
      ${renderSignalBarsHtml(true)}
    `;
    return;
  }

  if (onlineHosts.length === 0) {
    el.innerHTML = `<span class="node-pip off"></span><span class="mono">0 HOSTS</span>`;
    return;
  }

  const label = onlineHosts.length === 1 ? onlineHosts[0].name : `${onlineHosts.length} HOSTS`;
  el.innerHTML = `
    <span class="node-pip"></span>
    <span>${escapeHtml(label)}</span>
    ${renderSignalBarsHtml(false)}
  `;
}

function updateDeviceDropdown() {
  const sel = document.getElementById('deviceSelect');
  if (hostFilterId !== 'ALL' && !onlineHosts.some(s => s.id === hostFilterId)) {
    hostFilterId = 'ALL';
  }
  const opts = [`<option value="ALL">All Devices</option>`].concat(
    onlineHosts.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}${s.isLocal ? ' (You)' : ''}</option>`)
  );
  sel.innerHTML = opts.join('');
  sel.value = hostFilterId;
}

function refreshAllCatalog() {
  deadHostIds.clear();
  reconcileOnlineHosts(true);
  showToast('Refreshed');
}

/* ============================================================
   VIEWPORT & FULLSCREEN LAYOUT MANAGEMENT
   ============================================================ */
function getFullViewportDims() {
  const w = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
  const h = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  return { w, h };
}

function syncViewportLayout() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  if (isFullscreenMode) updateFullscreenRotationFallback();
}

function updateFullscreenRotationFallback() {
  const screenEl = document.getElementById('playerScreen');
  const stageEl = document.getElementById('videoStage');
  if (!isFullscreenMode) {
    screenEl.classList.remove('fs-rotate-fallback');
    stageEl.style.width = '';
    stageEl.style.height = '';
    return;
  }

  const { w, h } = getFullViewportDims();
  const isPortraitViewport = h > w;
  const needsRotateFallback = !orientationLockedByPlayer && isPortraitViewport;
  screenEl.classList.toggle('fs-rotate-fallback', needsRotateFallback);

  if (needsRotateFallback) {
    stageEl.style.width = `${h}px`;
    stageEl.style.height = `${w}px`;
  } else {
    stageEl.style.width = '';
    stageEl.style.height = '';
  }
}

function unlockMobileOrientation() {
  orientationLockedByPlayer = false;
  try {
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      screen.orientation.unlock();
    }
  } catch (e) {}
}

syncViewportLayout();
window.addEventListener('resize', syncViewportLayout, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewportLayout, { passive: true });
}
window.addEventListener('orientationchange', () => {
  setTimeout(syncViewportLayout, 60);
  setTimeout(syncViewportLayout, 260);
}, { passive: true });

/* ============================================================
   THEME, VIEW MODE & KEYBOARD ACCESSIBILITY
   ============================================================ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  storage.set('sy_theme_v1', theme);
  document.getElementById('btnTheme').textContent = theme === 'light' ? '☾' : '☀';
  document.getElementById('metaThemeColor').setAttribute('content', theme === 'light' ? '#e3e8ef' : '#0c1320');
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'light' ? 'dark' : 'light');
}

applyTheme(storage.get('sy_theme_v1') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

function syncViewModeButtonIcon() {
  const iconSvg = document.getElementById('viewIconSvg');
  const btnView = document.getElementById('btnView');
  if (!iconSvg) return;
  if (viewMode === 'list') {
    iconSvg.innerHTML = `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>`;
    if (btnView) btnView.setAttribute('title', 'Switch to Grid View');
  } else {
    iconSvg.innerHTML = `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`;
    if (btnView) btnView.setAttribute('title', 'Switch to List View');
  }
}

syncViewModeButtonIcon();

document.addEventListener('keydown', (e) => {
  if (e.target && e.target.getAttribute('role') === 'button' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    e.target.click();
  }
});

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2300);
}

function setLoader(show, label = 'BUFFERING') {
  const box = document.getElementById('loaderBox');
  const txt = document.getElementById('loaderText');
  if (txt) txt.textContent = label;
  box.classList.toggle('show', show);
}

/* ============================================================
   FILTERS, SMART SORT & SERIES FOLDER NAVIGATION
   ============================================================ */
function setTypeFilter(t) {
  typeFilter = t;
  ['ALL', 'MOVIES', 'SERIES'].forEach(key => {
    document.getElementById(`typeTab_${key}`).classList.toggle('active', key === t);
  });
  if (activeSeriesFolder) {
    activeSeriesFolder = null;
    activeSeriesEpisodes = [];
  }
  renderExplorer();
}

function setHostFilter(id) {
  hostFilterId = id;
  if (activeSeriesFolder) {
    activeSeriesFolder = null;
    activeSeriesEpisodes = [];
  }
  renderExplorer();
}

function getSortDirectionHint() {
  const isAsc = sortDir === 'ASC';
  if (sortField === 'ALPHA') return isAsc ? 'Ascending · A → Z' : 'Descending · Z → A';
  if (sortField === 'SIZE') return isAsc ? 'Ascending · Small → Large' : 'Descending · Large → Small';
  if (sortField === 'DATE') return isAsc ? 'Ascending · Old → New' : 'Descending · New → Old';
  return isAsc ? 'Ascending' : 'Descending';
}

function updateSortDirectionUI() {
  const btn = document.getElementById('sortDirBtn');
  const tip = document.getElementById('sortDirTip');
  if (!btn) return;
  if (sortField === 'DEFAULT') {
    btn.classList.remove('visible');
    return;
  }
  btn.classList.add('visible');
  btn.classList.toggle('desc', sortDir === 'DESC');
  const hint = getSortDirectionHint();
  btn.setAttribute('aria-label', hint);
  if (tip) tip.textContent = hint;
}

function setSortField(field) {
  const prevField = sortField;
  sortField = field || 'DEFAULT';
  if (prevField === 'DEFAULT' && sortField !== 'DEFAULT') sortDir = 'ASC';
  updateSortDirectionUI();
  renderExplorer();
}

function toggleSortDirection() {
  if (sortField === 'DEFAULT') return;
  sortDir = sortDir === 'ASC' ? 'DESC' : 'ASC';
  updateSortDirectionUI();
  renderExplorer();
}

function sortMediaCollection(items) {
  const arr = [...items];
  const mult = sortDir === 'ASC' ? 1 : -1;

  switch (sortField) {
    case 'ALPHA':
      arr.sort((a, b) => mult * a.cleanName.localeCompare(b.cleanName, undefined, { numeric: true, sensitivity: 'base' }));
      break;
    case 'SIZE':
      arr.sort((a, b) => {
        const diff = (a.bytes || 0) - (b.bytes || 0);
        return diff !== 0 ? mult * diff : ((a.defaultOrder ?? 0) - (b.defaultOrder ?? 0));
      });
      break;
    case 'DATE':
      arr.sort((a, b) => {
        const ya = a.releaseYear || 0;
        const yb = b.releaseYear || 0;
        if (ya === 0 && yb === 0) return (a.defaultOrder ?? 0) - (b.defaultOrder ?? 0);
        if (ya === 0) return 1;
        if (yb === 0) return -1;
        const diff = ya - yb;
        return diff !== 0 ? mult * diff : ((a.defaultOrder ?? 0) - (b.defaultOrder ?? 0));
      });
      break;
    default:
      arr.sort((a, b) => (a.defaultOrder ?? 0) - (b.defaultOrder ?? 0));
      break;
  }
  return arr;
}

function toggleViewMode() {
  viewMode = viewMode === 'grid' ? 'list' : 'grid';
  storage.set(VIEW_MODE_STORAGE_KEY, viewMode);
  syncViewModeButtonIcon();
  renderExplorer();
}

let searchRenderTimer = null;
function handleSearchInput(val) {
  searchQuery = val.trim().toLowerCase();
  clearTimeout(searchRenderTimer);
  searchRenderTimer = setTimeout(renderExplorer, 120); /* one redraw per pause in typing, not per keystroke */
}

function openSeriesFolder(seriesItem, scrollTop = true) {
  activeSeriesFolder = seriesItem;
  activeSeriesEpisodes = seriesItem.episodes || [];
  renderExplorer();
  if (scrollTop) {
    document.getElementById('explorerScroll').scrollTop = 0;
  }
}

function returnToRoot() {
  activeSeriesFolder = null;
  activeSeriesEpisodes = [];
  renderExplorer();
}

/* ============================================================
   EXPLORER RENDERER (SEPARATED SERIES & MOVIES)
   ============================================================ */
/* Resume points are keyed by file identity (relative path + size) rather than the host's per-session id,
   so they survive the host reloading or re-hosting the same folder. */
function progressKey(item) {
  const path = (item && item.path) || '';
  const size = Number((item && (item.size || item.bytes)) || 0);
  return `sy_prog2_${hashString(path).toString(36)}_${size}`;
}

function getSavedProgress(item) {
  try {
    return JSON.parse(storage.get(progressKey(item)) || 'null');
  } catch (e) {
    return null;
  }
}

/* Old builds stored resume points under a key that changed on every host session; drop those orphans. */
(function pruneLegacyProgressKeys() {
  try {
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sy_prog_')) stale.push(k);
    }
    stale.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
})();

function updateFooterTelemetry(items) {
  const totalBytes = items.reduce((acc, it) => acc + (it.bytes || 0), 0);
  document.getElementById('footerTelemetry').textContent = `${items.length} · ${formatCompactBytes(totalBytes)}`;
  const pct = items.length === 0 ? 0 : Math.min(100, Math.max(12, Math.round((totalBytes / (50 * (1024 ** 3))) * 100)));
  document.getElementById('storageFillBar').style.width = `${pct}%`;
}

function renderItemCollection(items, clickFnName, isEpisodeList = false) {
  if (viewMode === 'grid') {
    return `
      <div class="files-grid">
        ${items.map((item, idx) => {
          const epNum = isEpisodeList ? ((item.defaultOrder ?? idx) + 1) : null;
          const meta = item.meta || parseMediaMetadata(item.name, item.type === 'folder');
          const specPills = meta.specs.slice(0, 3).map(sp => `<span class="spec-pill mono">${escapeHtml(sp)}</span>`).join('');
          const fileBadge = item.type === 'folder'
            ? `${item.count || 0} EP · ${item.sizeLabel}`
            : `${meta.ext || 'VID'} · ${item.sizeLabel}`;

          return `
            <div class="file-tile" role="button" tabindex="0" onclick="${clickFnName}(${idx})" aria-label="Open ${escapeHtml(item.cleanName)} from ${escapeHtml(item.serverName)}">
              <div class="thumb-frame">
                ${buildCodedThumbnailSvg(item, epNum)}
              </div>
              <div class="tile-body">
                <div class="tile-name" title="${escapeHtml(item.name)}">${escapeHtml(item.cleanName)}</div>
                ${specPills ? `<div class="tile-tags">${specPills}</div>` : ''}
                <div class="tile-meta">
                  <span class="host-tag">${renderSignalBarsHtml(item.isLocal)}<span>${escapeHtml(item.serverName)}</span></span>
                  <span class="mono">${escapeHtml(fileBadge)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return `
    <div class="oneui-list-card">
      ${items.map((item, idx) => {
        const epNum = isEpisodeList ? ((item.defaultOrder ?? idx) + 1) : null;
        const meta = item.meta || parseMediaMetadata(item.name, item.type === 'folder');
        const specPills = meta.specs.slice(0, 3).map(sp => `<span class="spec-pill mono">${escapeHtml(sp)}</span>`).join('');
        const fileBadge = item.type === 'folder'
          ? `${item.count || 0} EP · ${item.sizeLabel}`
          : `${meta.ext || 'VID'} · ${item.sizeLabel}`;

        return `
          <div class="oneui-row" role="button" tabindex="0" onclick="${clickFnName}(${idx})" aria-label="Open ${escapeHtml(item.cleanName)} from ${escapeHtml(item.serverName)}">
            <div class="row-thumb">
              ${buildCodedThumbnailSvg(item, epNum)}
            </div>
            <div class="row-info">
              <div class="row-name" title="${escapeHtml(item.name)}">${escapeHtml(item.cleanName)}</div>
              <div class="row-sub">
                <span class="host-tag">${renderSignalBarsHtml(item.isLocal)}<span>${escapeHtml(item.serverName)}</span></span>
                ${specPills}
                <span class="mono">${escapeHtml(fileBadge)}</span>
              </div>
            </div>
            <div class="row-chevron">${item.type === 'folder' ? '›' : '▶'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

let lastExplorerHtml = null;
function setExplorerHtml(container, html) {
  if (html === lastExplorerHtml) return;
  lastExplorerHtml = html;
  container.innerHTML = html;
}

function renderExplorer() {
  const container = document.getElementById('explorerScroll');
  const filterBar = document.getElementById('filterBar');

  if (onlineHosts.length === 0) {
    filterBar.style.display = 'none';
    updateFooterTelemetry([]);
    setExplorerHtml(container, `
      <div class="empty-card">
        ${FIREBASE_READY
          ? "<h3>No Streams Online</h3><p>Select a folder or video files on your device to broadcast live across the globe.</p>"
          : "<h3>Connection service unavailable</h3><p>Stream Yours' could not load its realtime service. Check your network or content blocker, then reload.</p>"}
        <div style="display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;">
          <label for="folderInput" class="morph-btn accent" role="button" tabindex="0">Host Folder</label>
          <label for="filesInput" class="morph-btn" role="button" tabindex="0">Add Videos</label>
        </div>
      </div>
    `);
    return;
  }

  filterBar.style.display = 'flex';
  updateSortDirectionUI();

  if (activeSeriesFolder) {
    const s = activeSeriesFolder;
    if (!onlineHosts.some(h => h.id === s.serverId)) {
      activeSeriesFolder = null;
      activeSeriesEpisodes = [];
      renderExplorer();
      return;
    }

    const filteredEps = sortMediaCollection(
      activeSeriesEpisodes.filter(ep => {
        if (searchQuery && !ep.cleanName.toLowerCase().includes(searchQuery) && !ep.name.toLowerCase().includes(searchQuery)) return false;
        return true;
      })
    );
    window._visibleEpisodes = filteredEps;
    updateFooterTelemetry(filteredEps);

    let html = `
      <div class="series-head-card">
        <div class="series-head-left">
          <div class="morph-btn icon-sq" role="button" tabindex="0" onclick="returnToRoot()" title="Back" aria-label="Back to all movies and series">←</div>
          <div class="series-head-thumb">${buildCodedThumbnailSvg(s)}</div>
          <div style="min-width:0;">
            <div class="section-heading" style="font-size:16px;">${escapeHtml(s.cleanName)}</div>
            <div class="row-sub" style="margin-top:5px;">
              <span class="host-tag">${renderSignalBarsHtml(s.isLocal)}<span>${escapeHtml(s.serverName)}</span></span>
              <span class="mono">${activeSeriesEpisodes.length} EP · ${escapeHtml(s.sizeLabel)}</span>
            </div>
          </div>
        </div>
        ${filteredEps.length > 0 ? `
          <div class="morph-btn accent" role="button" tabindex="0" onclick="handleVisibleEpisodeClick(0)" aria-label="Play first episode of ${escapeHtml(s.cleanName)}">▶ Play</div>
        ` : ''}
      </div>
    `;

    if (filteredEps.length === 0) {
      html += `<div class="empty-card"><h3>Empty</h3><p>No matching episodes.</p></div>`;
    } else {
      html += renderItemCollection(filteredEps, 'handleVisibleEpisodeClick', true);
    }
    setExplorerHtml(container, html);
    return;
  }

  const matching = allRootItems.filter(item => {
    if (hostFilterId !== 'ALL' && item.serverId !== hostFilterId) return false;
    if (searchQuery && !item.cleanName.toLowerCase().includes(searchQuery) && !item.name.toLowerCase().includes(searchQuery) && !item.serverName.toLowerCase().includes(searchQuery)) return false;
    return true;
  });

  const seriesList = sortMediaCollection(matching.filter(i => i.type === 'folder'));
  const moviesList = sortMediaCollection(matching.filter(i => i.type === 'file'));

  window._visibleSeries = seriesList;
  window._visibleMovies = moviesList;

  const showSeries = (typeFilter === 'ALL' || typeFilter === 'SERIES');
  const showMovies = (typeFilter === 'ALL' || typeFilter === 'MOVIES');

  const visibleItems = [
    ...(showSeries ? seriesList : []),
    ...(showMovies ? moviesList : [])
  ];
  updateFooterTelemetry(visibleItems);

  if (visibleItems.length === 0) {
    setExplorerHtml(container, `<div class="empty-card"><h3>No Matches</h3><p>Adjust search or filter selection.</p></div>`);
    return;
  }

  let html = '';

  if (showSeries && seriesList.length > 0) {
    html += `
      <section class="category-section">
        <div class="section-header">
          <div class="section-title-group">
            <span class="section-heading">Series</span>
            <span class="count-badge mono">${seriesList.length}</span>
          </div>
        </div>
        ${renderItemCollection(seriesList, 'handleSeriesClick', false)}
      </section>
    `;
  }

  if (showMovies && moviesList.length > 0) {
    html += `
      <section class="category-section">
        <div class="section-header">
          <div class="section-title-group">
            <span class="section-heading">Movies</span>
            <span class="count-badge mono">${moviesList.length}</span>
          </div>
        </div>
        ${renderItemCollection(moviesList, 'handleMovieClick', false)}
      </section>
    `;
  }

  setExplorerHtml(container, html);
}

function handleSeriesClick(idx) {
  const series = window._visibleSeries[idx];
  if (series) openSeriesFolder(series, true);
}

function handleMovieClick(idx) {
  const movie = window._visibleMovies[idx];
  if (!movie) return;
  activePlayerList = [movie];
  openMediaAtIndex(0, false, false);
}

function handleVisibleEpisodeClick(idx) {
  const list = (window._visibleEpisodes && window._visibleEpisodes.length > 0)
    ? window._visibleEpisodes
    : activeSeriesEpisodes;
  if (!list.length) return;
  activePlayerList = list;
  openMediaAtIndex(Math.min(Math.max(0, idx), list.length - 1), true, false);
}

/* ============================================================
   SERIES EPISODE NAVIGATION IN PLAYER
   ============================================================ */
function isPlayingSeriesFolder() {
  return activeSeriesFolder !== null && Array.isArray(activePlayerList) && activePlayerList.length > 1;
}

function updateEpisodeNavigationUI() {
  const showSeriesUI = isPlayingSeriesFolder();
  const prevBtn = document.getElementById('prevEpBtn');
  const nextBtn = document.getElementById('nextEpBtn');
  const epPane = document.getElementById('episodePane');
  const workspace = document.getElementById('playerWorkspace');

  if (!showSeriesUI) {
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
    epPane.classList.remove('show');
    workspace.classList.add('no-episodes');
    return;
  }

  prevBtn.style.display = 'inline-flex';
  nextBtn.style.display = 'inline-flex';
  prevBtn.classList.toggle('disabled', activeIndex <= 0);
  nextBtn.classList.toggle('disabled', activeIndex >= activePlayerList.length - 1);

  epPane.classList.add('show');
  workspace.classList.remove('no-episodes');

  document.getElementById('epPaneTitle').textContent = activeSeriesFolder.cleanName;
  document.getElementById('epPaneCount').textContent = `${activeIndex + 1}/${activePlayerList.length}`;

  const listEl = document.getElementById('epList');
  listEl.innerHTML = activePlayerList.map((f, i) => {
    const isCur = i === activeIndex;
    const meta = f.meta || parseMediaMetadata(f.name, false);
    const dispNum = (f.defaultOrder ?? i) + 1;
    return `
      <div class="ep-card ${isCur ? 'active' : ''}" id="epCard_${i}" role="button" tabindex="0" onclick="selectEpisode(${i})" aria-label="Play episode ${dispNum}: ${escapeHtml(f.cleanName)}">
        <div class="ep-num mono">${String(dispNum).padStart(2, '0')}</div>
        <div class="ep-info">
          <div class="ep-name" title="${escapeHtml(f.name)}">${escapeHtml(f.cleanName)}</div>
          <div class="ep-meta mono">
            <span>${escapeHtml(meta.res || meta.ext || 'VID')}</span>
            <span>•</span>
            <span>${escapeHtml(f.sizeLabel)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  requestAnimationFrame(() => {
    const activeCard = document.getElementById(`epCard_${activeIndex}`);
    if (activeCard) activeCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function selectEpisode(idx) {
  if (idx === activeIndex) return;
  openMediaAtIndex(idx, true, false);
}

function playPrevEpisode() {
  if (!isPlayingSeriesFolder() || activeIndex <= 0) return;
  openMediaAtIndex(activeIndex - 1, true, false);
}

function playNextEpisode() {
  if (!isPlayingSeriesFolder() || activeIndex >= activePlayerList.length - 1) return;
  openMediaAtIndex(activeIndex + 1, true, false);
}

/* ============================================================
   FULLSCREEN & STAGE TAP / DOUBLE-TAP SKIP GESTURES
   ============================================================ */
function setFsExitButtonVisible(visible) {
  fsButtonVisible = Boolean(visible);
  const exitBtn = document.getElementById('fsExitBtn');
  if (exitBtn) exitBtn.classList.toggle('fs-hidden', !fsButtonVisible);
}

function enterFullscreenMode() {
  if (!activeMedia) return;
  isFullscreenMode = true;

  document.documentElement.classList.add('fs-lock');
  document.body.classList.add('fs-lock');

  const screenEl = document.getElementById('playerScreen');
  screenEl.classList.add('fs-active');
  setFsExitButtonVisible(true);

  const reqFs = screenEl.requestFullscreen || screenEl.webkitRequestFullscreen || screenEl.msRequestFullscreen;
  if (typeof reqFs === 'function') {
    try {
      const p = reqFs.call(screenEl);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
  }

  if (screen.orientation && typeof screen.orientation.lock === 'function') {
    screen.orientation.lock('landscape')
      .then(() => {
        orientationLockedByPlayer = true;
        updateFullscreenRotationFallback();
      })
      .catch(() => {
        orientationLockedByPlayer = false;
        updateFullscreenRotationFallback();
      });
  } else {
    orientationLockedByPlayer = false;
  }

  updateFullscreenRotationFallback();
  setTimeout(syncViewportLayout, 60);
}

function exitFullscreenMode(triggeredByNativeEvent = false) {
  isFullscreenMode = false;
  fsButtonVisible = true;

  document.documentElement.classList.remove('fs-lock');
  document.body.classList.remove('fs-lock');

  const screenEl = document.getElementById('playerScreen');
  const stageEl = document.getElementById('videoStage');
  screenEl.classList.remove('fs-active', 'fs-rotate-fallback');
  stageEl.style.width = '';
  stageEl.style.height = '';
  setFsExitButtonVisible(true);

  const nativeFsEl = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  if (nativeFsEl && !triggeredByNativeEvent) {
    const exitFn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (typeof exitFn === 'function') {
      try {
        const p = exitFn.call(document);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
    }
  }

  unlockMobileOrientation();
  setTimeout(syncViewportLayout, 60);
}

function flashSkipOsd(dir) {
  const el = document.getElementById(dir < 0 ? 'skipOsdLeft' : 'skipOsdRight');
  if (!el) return;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 450);
}

(function initStageGestures() {
  const stageEl = document.getElementById('videoStage');
  const exitBtn = document.getElementById('fsExitBtn');
  if (!stageEl || !exitBtn) return;

  let downX = 0;
  let downY = 0;
  let lastTapTime = 0;
  let singleTapTimer = null;

  exitBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  exitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exitFullscreenMode(false);
  });

  stageEl.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.closest('#fsExitBtn')) return;
    downX = e.clientX;
    downY = e.clientY;
  });

  stageEl.addEventListener('pointerup', (e) => {
    if (e.target && e.target.closest('#fsExitBtn')) return;
    if (typeof e.button === 'number' && e.button !== 0) return;

    const dist = Math.hypot((e.clientX || 0) - downX, (e.clientY || 0) - downY);
    if (dist > 16) return;

    const now = performance.now();
    const rect = stageEl.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / Math.max(1, rect.width);

    if (now - lastTapTime < 280) {
      clearTimeout(singleTapTimer);
      lastTapTime = 0;
      if (relX < 0.4) {
        skipBy(-10);
        flashSkipOsd(-10);
      } else if (relX > 0.6) {
        skipBy(10);
        flashSkipOsd(10);
      } else if (isFullscreenMode) {
        exitFullscreenMode(false);
      } else {
        enterFullscreenMode();
      }
      return;
    }

    lastTapTime = now;
    singleTapTimer = setTimeout(() => {
      if (isFullscreenMode) {
        setFsExitButtonVisible(!fsButtonVisible);
      } else {
        togglePlayPause();
      }
    }, 240);
  });
})();

document.addEventListener('fullscreenchange', () => {
  const nativeFsEl = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  if (!nativeFsEl && isFullscreenMode) exitFullscreenMode(true);
});
document.addEventListener('webkitfullscreenchange', () => {
  const nativeFsEl = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  if (!nativeFsEl && isFullscreenMode) exitFullscreenMode(true);
});

/* ============================================================
   SEEKBAR EXACT HH:MM:SS HOVER & SCRUB PREVIEW
   ============================================================ */
function getTotalMediaDuration() {
  if (activePlaybackEngine && activePlaybackEngine.duration > 0) {
    return activePlaybackEngine.duration;
  }
  const video = getActiveVideo();
  return (video && isFinite(video.duration) && video.duration > 0) ? video.duration : 0;
}

function updateSeekHoverPreview(clientX) {
  const seekArea = document.getElementById('seekArea');
  const tooltip = document.getElementById('seekTooltip');
  const hoverFill = document.getElementById('seekHoverFill');
  const total = getTotalMediaDuration();
  if (!seekArea || !tooltip || !total || total <= 0) return;

  const rect = seekArea.getBoundingClientRect();
  if (rect.width <= 0) return;

  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const targetSec = ratio * total;

  tooltip.textContent = formatExactHMS(targetSec);
  hoverFill.style.width = `${(ratio * 100).toFixed(2)}%`;
  seekArea.classList.add('hovering');

  const halfW = (tooltip.offsetWidth || 66) / 2;
  const rawPx = ratio * rect.width;
  const clampedPx = Math.min(Math.max(halfW, rawPx), Math.max(halfW, rect.width - halfW));
  tooltip.style.left = `${clampedPx}px`;
}

function hideSeekHoverPreview() {
  const seekArea = document.getElementById('seekArea');
  if (seekArea) seekArea.classList.remove('hovering');
}

(function initSeekbarInteractions() {
  const seekArea = document.getElementById('seekArea');
  if (!seekArea) return;

  /* Tap or drag anywhere on the bar. The timeline previews while dragging and seeks once on release. */
  const previewAt = (clientX) => {
    updateSeekHoverPreview(clientX);
    const total = getTotalMediaDuration();
    const rect = seekArea.getBoundingClientRect();
    if (total > 0 && rect.width > 0) {
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      document.getElementById('seekProgress').style.width = `${(ratio * 100).toFixed(2)}%`;
    }
  };

  seekArea.addEventListener('pointerdown', (e) => {
    if (typeof e.button === 'number' && e.button !== 0) return;
    if (getTotalMediaDuration() <= 0) return;
    isSeekScrubbing = true;
    try { seekArea.setPointerCapture(e.pointerId); } catch (err) {}
    previewAt(e.clientX);
  });

  seekArea.addEventListener('pointermove', (e) => {
    if (isSeekScrubbing) previewAt(e.clientX);
    else if (e.pointerType === 'mouse') updateSeekHoverPreview(e.clientX);
  }, { passive: true });

  const finishScrub = (e, commit) => {
    if (!isSeekScrubbing) return;
    isSeekScrubbing = false;
    try { seekArea.releasePointerCapture(e.pointerId); } catch (err) {}
    if (commit) seekFromClientX(e.clientX);
    if (e.pointerType !== 'mouse') hideSeekHoverPreview();
  };
  seekArea.addEventListener('pointerup', (e) => finishScrub(e, true));
  seekArea.addEventListener('pointercancel', (e) => finishScrub(e, false));
  seekArea.addEventListener('mouseleave', () => { if (!isSeekScrubbing) hideSeekHoverPreview(); }, { passive: true });
})();

/* ============================================================
   EMBEDDED AUDIO LANGUAGE TRACK UI UPDATER
   ============================================================ */
function setAvailableAudioTracks(tracks, selectedIdx = 0) {
  availableAudioTracks = Array.isArray(tracks) ? tracks : [];
  activeAudioTrackIndex = Math.min(Math.max(0, selectedIdx), Math.max(0, availableAudioTracks.length - 1));
  const audioBtn = document.getElementById('audioBtn');
  const audioLbl = document.getElementById('audioBtnLabel');

  if (availableAudioTracks.length > 0) {
    audioBtn.style.display = 'inline-flex';
    const chosen = availableAudioTracks[activeAudioTrackIndex];
    const countTag = availableAudioTracks.length > 1 ? ` (${availableAudioTracks.length})` : '';
    audioLbl.textContent = `${chosen.shortLabel}${countTag}`;
  } else {
    audioBtn.style.display = 'none';
  }
}

function openAudioPopup() {
  if (!availableAudioTracks || availableAudioTracks.length === 0) return;
  document.getElementById('modalTitle').textContent = 'Audio Language';
  const list = document.getElementById('modalList');
  list.innerHTML = availableAudioTracks.map((tr, idx) => `
    <div class="modal-option ${idx === activeAudioTrackIndex ? 'selected' : ''}" role="button" tabindex="0" onclick="selectAudioTrack(${idx})" aria-label="Select ${escapeHtml(tr.label)} audio track">
      <div class="opt-main">
        <div class="opt-title">${escapeHtml(tr.label)}</div>
        <div class="opt-sub">${escapeHtml(tr.meta)}</div>
      </div>
      <div class="opt-check">✓</div>
    </div>
  `).join('');
  document.getElementById('modalBackdrop').classList.add('open');
}

function selectAudioTrack(idx) {
  closeModal();
  if (idx === activeAudioTrackIndex || !availableAudioTracks[idx]) return;
  const chosen = availableAudioTracks[idx];
  activeAudioTrackIndex = idx;
  setAvailableAudioTracks(availableAudioTracks, idx);

  if (activePlaybackEngine && typeof activePlaybackEngine.switchAudioTrack === 'function') {
    activePlaybackEngine.switchAudioTrack(idx, chosen);
  }
  showToast(`Audio: ${chosen.shortLabel}`);
}

/* ============================================================
   PRO-GRADE DUAL-ENGINE STREAMING PLAYER
   ============================================================ */
function getActiveVideo() {
  return document.getElementById('videoEl');
}

function updateQualityBadge(label) {
  document.getElementById('qualityBadge').textContent = label || 'HD';
}

function destroyCurrentEngine(keepRemoteSession = false) {
  if (activePlaybackEngine) {
    try { activePlaybackEngine.destroy(); } catch (e) {}
    activePlaybackEngine = null;
  }
  /* Also tears down a WebRTC tunnel that is still connecting (no engine exists yet at that point). */
  if (!keepRemoteSession && activeRemoteSession) {
    try { activeRemoteSession.cleanup(); } catch (e) {}
    activeRemoteSession = null;
  }
  if (localObjectUrl) {
    try { URL.revokeObjectURL(localObjectUrl); } catch (e) {}
    localObjectUrl = null;
  }
}

function createFreshVideoElement(keepRemoteSession = false) {
  destroyCurrentEngine(keepRemoteSession);
  const stage = document.getElementById('videoStage');
  const oldVideo = document.getElementById('videoEl');
  if (oldVideo) {
    try { oldVideo.pause(); } catch (e) {}
    oldVideo.removeAttribute('src');
    oldVideo.load();
    oldVideo.remove();
  }

  const freshVideo = document.createElement('video');
  freshVideo.id = 'videoEl';
  freshVideo.setAttribute('playsinline', '');
  freshVideo.setAttribute('webkit-playsinline', '');
  freshVideo.setAttribute('preload', 'auto');
  freshVideo.volume = isMuted ? 0 : savedVol;
  freshVideo.muted = isMuted;
  freshVideo.loop = isLooping;

  const skipLeft = document.getElementById('skipOsdLeft');
  stage.insertBefore(freshVideo, skipLeft);
  attachVideoEvents(freshVideo);
  applySubtitleToVideo(freshVideo); /* a replacement <video> (fallback, new engine) keeps the chosen subtitles */
  return freshVideo;
}

function attachVideoEvents(video) {
  video.addEventListener('loadedmetadata', () => {
    if (video.videoHeight > 0) {
      const h = video.videoHeight;
      const res = h >= 2160 ? '4K' : (h >= 1440 ? '2K' : (h >= 1080 ? '1080p' : (h >= 720 ? '720p' : (h >= 480 ? '480p' : `${h}p`))));
      if (activePlaybackEngine) activePlaybackEngine.resolution = res;
      updateQualityBadge(res);
    }

    if (video.audioTracks && video.audioTracks.length > 0 && availableAudioTracks.length === 0) {
      const nativeTracks = Array.from(video.audioTracks).map((t, i) => {
        const langName = formatLanguageName(t.language, t.label, i);
        return {
          id: t.id || i,
          index: i,
          label: langName,
          shortLabel: langName.split(' (')[0],
          meta: `Track ${i + 1}${t.language ? ' · ' + t.language.toUpperCase() : ''}`,
          supported: true
        };
      });
      const enabledIdx = Math.max(0, Array.from(video.audioTracks).findIndex(t => t.enabled));
      setAvailableAudioTracks(nativeTracks, enabledIdx);
    }
  });

  video.addEventListener('playing', () => {
    setLoader(false);
    document.getElementById('playBtn').textContent = 'Pause';
  });

  video.addEventListener('pause', () => {
    document.getElementById('playBtn').textContent = 'Play';
  });

  video.addEventListener('waiting', () => {
    if (!video.ended) setLoader(true, 'BUFFERING');
  });

  video.addEventListener('ended', () => {
    if (activePlaybackEngine && activePlaybackEngine.isMse && !activePlaybackEngine.isStreamComplete) {
      return;
    }
    if (activeMedia) {
      storage.remove(progressKey(activeMedia));
    }
    if (!isLooping && isPlayingSeriesFolder() && activeIndex < activePlayerList.length - 1) {
      playNextEpisode();
    }
  });

  video.addEventListener('error', () => {
    const eng = activePlaybackEngine;
    if (eng && eng.progressive && !eng.progressiveDone) return; /* partial data while still downloading */
    if (!video.error) return;
    setLoader(false);
    showToast(video.error.code === 4 ? "This browser can't play this video format" : 'Playback error');
  });

  video.addEventListener('timeupdate', () => {
    const total = getTotalMediaDuration();
    const current = video.currentTime || 0;

    document.getElementById('clockText').textContent = `${formatClock(current)} / ${total > 0 ? formatClock(total) : '--:--'}`;

    if (total > 0) {
      const pct = Math.min(100, Math.max(0, (current / total) * 100));
      if (!isSeekScrubbing) document.getElementById('seekProgress').style.width = `${pct}%`;
      const seekAreaEl = document.getElementById('seekArea');
      if (seekAreaEl) seekAreaEl.setAttribute('aria-valuenow', String(Math.round(pct)));

      if (video.buffered && video.buffered.length > 0) {
        const bufEnd = video.buffered.end(video.buffered.length - 1);
        const bufPct = Math.min(100, Math.max(pct, (bufEnd / total) * 100));
        document.getElementById('seekBuffered').style.width = `${bufPct}%`;
      }
    }

    if (activePlaybackEngine && typeof activePlaybackEngine.onTimeUpdate === 'function') {
      activePlaybackEngine.onTimeUpdate(current, total);
    }

    if (activeMedia && total > 30 && Math.abs(current - lastSavedTick) >= 5) {
      lastSavedTick = current;
      if (current > 15 && current < total - 25) {
        storage.set(progressKey(activeMedia), JSON.stringify({ pos: current, dur: total }));
      } else if (current >= total - 25) {
        storage.remove(progressKey(activeMedia));
      }
    }
  });
}

/* ============================================================
   MP4BOX MULTI-AUDIO + KEYFRAME-ACCURATE MSE ENGINE
   ============================================================ */
function buildMp4MseEngine(video, fileSize, startSec, transport) {
  let mp4 = MP4Box.createFile(false);
  const ms = new MediaSource();
  const msUrl = URL.createObjectURL(ms);

  const state = {
    isMse: true,
    duration: 0,
    resolution: (activeMedia && activeMedia.meta && activeMedia.meta.res) || 'HD',
    isStreamComplete: false,
    mp4Info: null,
    videoTrack: null,
    audioTracks: [],
    selectedAudioIdx: 0,
    videoSb: null,
    audioSb: null,
    videoQueue: [],
    audioQueue: [],
    isInitialized: false,
    firstMediaAppended: false,
    expectedStartSec: Math.max(0, startSec || 0),
    nextExpectedByte: 0,
    probeChunks: [],
    usedTailProbe: false,
    isFeedingSequential: false,
    feedPaused: false,
    destroyed: false,
    bytesTransferred: 0,
    speedTimer: null
  };

  state.speedTimer = setInterval(() => {
    if (state.destroyed) return;
    const mbps = (state.bytesTransferred / (1024 * 1024) / 1.5).toFixed(1);
    state.bytesTransferred = 0;
    if (Number(mbps) > 0.1) {
      updateQualityBadge(`${state.resolution} · ${mbps} MB/s`);
    }
  }, 1500);

  function flushQueues() {
    if (state.destroyed || ms.readyState !== 'open') return;
    if (state.videoSb && !state.videoSb.updating && state.videoQueue.length > 0) {
      const buf = state.videoQueue.shift();
      try {
        state.videoSb.appendBuffer(buf);
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          state.videoQueue.unshift(buf);
          evictOldBuffers();
        }
      }
    }
    if (state.audioSb && !state.audioSb.updating && state.audioQueue.length > 0) {
      const buf = state.audioQueue.shift();
      try {
        state.audioSb.appendBuffer(buf);
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          state.audioQueue.unshift(buf);
          evictOldBuffers();
        }
      }
    }

    if (
      state.isStreamComplete &&
      state.videoQueue.length === 0 &&
      state.audioQueue.length === 0 &&
      (!state.videoSb || !state.videoSb.updating) &&
      (!state.audioSb || !state.audioSb.updating) &&
      ms.readyState === 'open'
    ) {
      try { ms.endOfStream(); } catch (e) {}
    }
  }

  function evictOldBuffers() {
    if (ms.readyState !== 'open') return;
    const cur = video.currentTime || 0;
    if (cur > 40) {
      try {
        if (state.videoSb && !state.videoSb.updating) state.videoSb.remove(0, cur - 30);
        if (state.audioSb && !state.audioSb.updating) state.audioSb.remove(0, cur - 30);
      } catch (e) {}
    }
  }

  function beginSequentialFeed(fromByte) {
    if (state.destroyed || state.isFeedingSequential) return;
    state.isFeedingSequential = true;
    state.probeChunks = [];
    state.nextExpectedByte = Math.max(0, Math.floor(fromByte));
    if (state.nextExpectedByte >= fileSize) {
      state.isStreamComplete = true;
      flushQueues();
      return;
    }
    transport.requestRange(state.nextExpectedByte, fileSize);
  }

  function bindMp4Callbacks(instance) {
    instance.onError = () => {
      if (!state.destroyed && typeof transport.onFallback === 'function') {
        transport.onFallback();
      }
    };

    instance.onSegment = (id, user, buffer) => {
      if (state.destroyed) return;
      if (user === 'video') state.videoQueue.push(buffer);
      else if (user === 'audio') state.audioQueue.push(buffer);
      flushQueues();
    };

    instance.onReady = (info) => {
      if (state.destroyed || state.isInitialized) return;
      state.mp4Info = info;

      const vTrack = info.videoTracks && info.videoTracks[0];
      if (!vTrack) {
        if (typeof transport.onFallback === 'function') transport.onFallback();
        return;
      }

      const vMime = `video/mp4; codecs="${vTrack.codec}"`;
      if (!MediaSource.isTypeSupported(vMime)) {
        if (typeof transport.onFallback === 'function') transport.onFallback();
        return;
      }

      const rawAudio = info.audioTracks || [];
      const mappedAudio = rawAudio.map((at, idx) => {
        const langLabel = formatLanguageName(at.language, at.name, idx);
        const chLabel = formatChannelLayout(at.audio && at.audio.channel_count);
        const codecLabel = formatAudioCodec(at.codec);
        const aMime = `audio/mp4; codecs="${at.codec}"`;
        const supported = MediaSource.isTypeSupported(aMime);
        return {
          id: at.id,
          index: idx,
          label: langLabel,
          shortLabel: langLabel.split(' (')[0],
          meta: [chLabel, codecLabel, !supported ? 'Unsupported Codec' : ''].filter(Boolean).join(' · '),
          codec: at.codec,
          mime: aMime,
          supported
        };
      });

      state.audioTracks = mappedAudio;
      setAvailableAudioTracks(mappedAudio, 0);

      let chosenAudio = mappedAudio.find(t => t.supported) || null;
      if (chosenAudio) {
        state.selectedAudioIdx = chosenAudio.index;
        setAvailableAudioTracks(mappedAudio, chosenAudio.index);
      } else if (mappedAudio.length > 0 && typeof transport.onFallback === 'function') {
        transport.onFallback();
        return;
      }

      state.videoTrack = vTrack;
      if (vTrack.track_height > 0) {
        const h = vTrack.track_height;
        state.resolution = h >= 2160 ? '4K' : (h >= 1440 ? '2K' : (h >= 1080 ? '1080p' : (h >= 720 ? '720p' : `${h}p`)));
        updateQualityBadge(state.resolution);
      }

      const setupBuffers = () => {
        if (state.destroyed || state.isInitialized || ms.readyState !== 'open') return;
        state.isInitialized = true;

        if (info.duration && info.timescale) {
          state.duration = info.duration / info.timescale;
          try { ms.duration = state.duration; } catch (e) {}
        }

        try {
          state.videoSb = ms.addSourceBuffer(vMime);
          state.videoSb.mode = 'segments';
          state.videoSb.addEventListener('updateend', () => {
            if (!state.firstMediaAppended && video.buffered.length > 0) {
              state.firstMediaAppended = true;
              const target = state.expectedStartSec;
              if (Math.abs((video.currentTime || 0) - target) > 1.5) {
                try { video.currentTime = target; } catch (e) {}
              }
              video.playbackRate = activeSpeed;
              video.play().catch(() => {});
            }
            flushQueues();
          });

          if (chosenAudio) {
            state.audioSb = ms.addSourceBuffer(chosenAudio.mime);
            state.audioSb.mode = 'segments';
            state.audioSb.addEventListener('updateend', flushQueues);
          }
        } catch (e) {
          if (typeof transport.onFallback === 'function') transport.onFallback();
          return;
        }

        instance.setSegmentOptions(vTrack.id, 'video', { nbSamples: 45, rapAlignement: true });
        if (chosenAudio) {
          instance.setSegmentOptions(chosenAudio.id, 'audio', { nbSamples: 60 });
        }

        const initSegs = instance.initializeSegmentation();
        initSegs.forEach((seg) => {
          if (seg.user === 'video') state.videoQueue.push(seg.buffer);
          else if (seg.user === 'audio') state.audioQueue.push(seg.buffer);
        });

        const seekInfo = instance.seek(state.expectedStartSec, true);
        instance.start();
        flushQueues();

        const resumeByte = (seekInfo && typeof seekInfo.offset === 'number') ? seekInfo.offset : 0;
        beginSequentialFeed(resumeByte);
      };

      if (ms.readyState === 'open') setupBuffers();
      else ms.addEventListener('sourceopen', setupBuffers, { once: true });
    };
  }

  bindMp4Callbacks(mp4);

  state.feedChunk = (byteOffset, arrayBuffer) => {
    if (state.destroyed) return;
    state.bytesTransferred += arrayBuffer.byteLength;
    if (!state.isInitialized) {
      state.probeChunks.push({ offset: byteOffset, buffer: arrayBuffer });
    }
    const copy = arrayBuffer.slice(0);
    copy.fileStart = byteOffset;
    const nextPos = mp4.appendBuffer(copy);
    if (state.isFeedingSequential) {
      state.nextExpectedByte = Math.max(state.nextExpectedByte, nextPos || (byteOffset + arrayBuffer.byteLength));
      if ((byteOffset + arrayBuffer.byteLength) >= fileSize) {
        state.isStreamComplete = true;
        flushQueues();
      }
    }
  };

  state.onSliceDone = (tag, endByte) => {
    if (state.destroyed) return;
    if (tag === 'HEAD' && !state.isInitialized && !state.usedTailProbe && fileSize > 4 * 1024 * 1024) {
      // moov atom resides at the end of the file; fetch trailing 6 MB
      state.usedTailProbe = true;
      if (typeof transport.requestTailProbe === 'function') {
        transport.requestTailProbe();
      }
    } else if (tag === 'RANGE' && endByte >= fileSize) {
      state.isStreamComplete = true;
      flushQueues();
    }
  };

  state.seekTo = (targetSec) => {
    if (state.destroyed || !state.isInitialized) return;
    const clamped = Math.max(0, state.duration > 0 ? Math.min(state.duration - 1, targetSec) : targetSec);

    if (video.buffered && video.buffered.length > 0) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (clamped >= video.buffered.start(i) && clamped <= video.buffered.end(i) - 0.5) {
          video.currentTime = clamped;
          return;
        }
      }
    }

    setLoader(true, 'SEEKING');
    state.isStreamComplete = false;
    state.isFeedingSequential = false;
    state.feedPaused = false;
    state.expectedStartSec = clamped;
    state.videoQueue.length = 0;
    state.audioQueue.length = 0;

    try {
      if (state.videoSb && !state.videoSb.updating) state.videoSb.abort();
      if (state.audioSb && !state.audioSb.updating) state.audioSb.abort();
    } catch (e) {}

    const seekRes = mp4.seek(clamped, true);
    mp4.start();
    video.currentTime = clamped;

    const byteOffset = (seekRes && typeof seekRes.offset === 'number') ? seekRes.offset : 0;
    state.isFeedingSequential = true;
    state.nextExpectedByte = byteOffset;
    transport.requestRange(byteOffset, fileSize);
  };

  state.switchAudioTrack = (trackIdx, trackObj) => {
    if (state.destroyed || !state.isInitialized || !trackObj || !trackObj.supported) return;
    const curTime = video.currentTime || 0;
    setLoader(true, 'AUDIO');

    state.selectedAudioIdx = trackIdx;
    state.isStreamComplete = false;
    state.isFeedingSequential = false;
    state.videoQueue.length = 0;
    state.audioQueue.length = 0;

    if (state.videoTrack) mp4.unsetSegmentOptions(state.videoTrack.id);
    state.audioTracks.forEach(t => {
      try { mp4.unsetSegmentOptions(t.id); } catch (e) {}
    });

    try {
      if (state.videoSb && !state.videoSb.updating) state.videoSb.abort();
      if (state.audioSb && !state.audioSb.updating) state.audioSb.abort();
    } catch (e) {}

    if (!state.audioSb && ms.readyState === 'open') {
      state.audioSb = ms.addSourceBuffer(trackObj.mime);
      state.audioSb.mode = 'segments';
      state.audioSb.addEventListener('updateend', flushQueues);
    }

    mp4.setSegmentOptions(state.videoTrack.id, 'video', { nbSamples: 45, rapAlignement: true });
    mp4.setSegmentOptions(trackObj.id, 'audio', { nbSamples: 60 });

    const initSegs = mp4.initializeSegmentation();
    initSegs.forEach((seg) => {
      if (seg.user === 'video') state.videoQueue.push(seg.buffer);
      else if (seg.user === 'audio') state.audioQueue.push(seg.buffer);
    });

    const seekRes = mp4.seek(curTime, true);
    mp4.start();
    flushQueues();

    const byteOffset = (seekRes && typeof seekRes.offset === 'number') ? seekRes.offset : 0;
    state.isFeedingSequential = true;
    state.nextExpectedByte = byteOffset;
    transport.requestRange(byteOffset, fileSize);
  };

  state.onTimeUpdate = (cur) => {
    if (state.destroyed || !state.isFeedingSequential || state.isStreamComplete) return;
    if (!video.buffered || video.buffered.length === 0) return;

    let ahead = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (cur >= video.buffered.start(i) - 0.5 && cur <= video.buffered.end(i)) {
        ahead = video.buffered.end(i) - cur;
        break;
      }
    }

    if (ahead >= 45 && !state.feedPaused) {
      state.feedPaused = true;
      transport.pause();
    } else if (ahead < 20 && state.feedPaused) {
      state.feedPaused = false;
      transport.resume();
    }

    if (cur > 60) evictOldBuffers();
  };

  state.destroy = () => {
    state.destroyed = true;
    clearInterval(state.speedTimer);
    try { transport.close(); } catch (e) {}
    try { mp4.stop(); } catch (e) {}
    try { URL.revokeObjectURL(msUrl); } catch (e) {}
  };

  /* Used when MSE cannot handle a file and we fall back to progressive playback over the SAME data channel. */
  state.detachForFallback = () => {
    state.destroyed = true;
    clearInterval(state.speedTimer);
    try { mp4.stop(); } catch (e) {}
    try { URL.revokeObjectURL(msUrl); } catch (e) {}
  };

  video.src = msUrl;
  transport.startProbe();
  return state;
}

/* ============================================================
   OPEN MEDIA ENTRYPOINT (LOCAL OR REMOTE WEBRTC P2P)
   ============================================================ */
async function openMediaAtIndex(idx, isSeries, forceStartZero = false) {
  const item = activePlayerList[idx];
  if (!item) return;

  unlockMobileOrientation();
  syncViewportLayout();

  activeIndex = idx;
  activeMedia = item;
  setAvailableAudioTracks([], 0);
  resetSubtitleState();

  let initialStart = 0;
  if (!forceStartZero) {
    const saved = getSavedProgress(item);
    if (saved && saved.pos > 15 && saved.dur > 30 && saved.pos < saved.dur - 25) {
      initialStart = Math.floor(saved.pos);
    }
  }

  const screenEl = document.getElementById('playerScreen');
  isFullscreenMode = false;
  document.documentElement.classList.remove('fs-lock');
  document.body.classList.remove('fs-lock');
  screenEl.classList.remove('fs-active', 'fs-rotate-fallback');

  document.getElementById('playerName').textContent = item.cleanName;
  setupMediaSession(item);
  document.getElementById('seekProgress').style.width = '0%';
  document.getElementById('seekBuffered').style.width = '0%';
  document.getElementById('clockText').textContent = '00:00 / --:--';
  hideSeekHoverPreview();
  updateQualityBadge((item.meta && item.meta.res) || 'HD');

  updateEpisodeNavigationUI();
  setLoader(true, item.isLocal ? 'LOADING' : 'CONNECTING');
  screenEl.classList.add('open');

  const video = createFreshVideoElement();
  refreshSubtitleButton();
  maybeAutoSelectSubtitle(item);
  const ext = (item.meta && item.meta.ext || '').toLowerCase();
  const isMp4Family = ['mp4', 'm4v', 'mov'].includes(ext);

  // 1. LOCAL HOST PLAYBACK
  if (item.isLocal) {
    const file = localFileMap.get(item.id);
    if (!file) {
      setLoader(false);
      showToast('File unavailable');
      return;
    }

    const playLocalNative = () => {
      destroyCurrentEngine();
      const v = createFreshVideoElement();
      localObjectUrl = URL.createObjectURL(file);
      activePlaybackEngine = {
        isMse: false,
        duration: 0,
        resolution: (item.meta && item.meta.res) || 'HD',
        seekTo: (sec) => { v.currentTime = sec; },
        switchAudioTrack: (trackIdx) => {
          if (v.audioTracks) {
            for (let i = 0; i < v.audioTracks.length; i++) {
              v.audioTracks[i].enabled = (i === trackIdx);
            }
          }
        },
        destroy: () => {}
      };
      v.src = localObjectUrl;
      v.addEventListener('loadedmetadata', () => {
        if (initialStart > 0 && v.duration > initialStart + 10) {
          v.currentTime = initialStart;
        }
        v.playbackRate = activeSpeed;
        v.play().catch(() => {});
      }, { once: true });
    };

    if (isMp4Family && window.MP4Box && window.MediaSource) {
      try {
        const probeMp4 = MP4Box.createFile(false);
        const headBuf = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
        headBuf.fileStart = 0;
        probeMp4.appendBuffer(headBuf);
        if (!probeMp4.moov && file.size > 4 * 1024 * 1024) {
          const tailStart = file.size - 5 * 1024 * 1024;
          const tailBuf = await file.slice(tailStart, file.size).arrayBuffer();
          tailBuf.fileStart = tailStart;
          probeMp4.appendBuffer(tailBuf);
        }
        if (probeMp4.moov && probeMp4.moov.traks) {
          const audioTraks = probeMp4.moov.traks.filter(t => t.mdia && t.mdia.hdlr && t.mdia.hdlr.handler === 'soun');
          if (audioTraks.length > 1) {
            let localPumpToken = { aborted: false, paused: false };
            const localTransport = {
              startProbe: async () => {
                const hEnd = Math.min(file.size, 2.5 * 1024 * 1024);
                const hb = await file.slice(0, hEnd).arrayBuffer();
                activePlaybackEngine && activePlaybackEngine.feedChunk(0, hb);
                activePlaybackEngine && activePlaybackEngine.onSliceDone('HEAD', hEnd);
              },
              requestTailProbe: async () => {
                const tStart = Math.max(0, file.size - 6 * 1024 * 1024);
                const tb = await file.slice(tStart, file.size).arrayBuffer();
                activePlaybackEngine && activePlaybackEngine.feedChunk(tStart, tb);
                activePlaybackEngine && activePlaybackEngine.onSliceDone('TAIL', file.size);
              },
              requestRange: async (startByte, endByte) => {
                localPumpToken.aborted = true;
                const tok = { aborted: false, paused: false };
                localPumpToken = tok;
                let pos = startByte;
                const STEP = 512 * 1024;
                while (pos < endByte && !tok.aborted) {
                  if (tok.paused) {
                    await new Promise(r => setTimeout(r, 30));
                    continue;
                  }
                  const next = Math.min(endByte, pos + STEP);
                  const slice = await file.slice(pos, next).arrayBuffer();
                  if (tok.aborted) break;
                  activePlaybackEngine && activePlaybackEngine.feedChunk(pos, slice);
                  pos = next;
                  await new Promise(r => setTimeout(r, 4));
                }
                if (!tok.aborted) {
                  activePlaybackEngine && activePlaybackEngine.onSliceDone('RANGE', pos);
                }
              },
              pause: () => { localPumpToken.paused = true; },
              resume: () => { localPumpToken.paused = false; },
              close: () => { localPumpToken.aborted = true; },
              onFallback: playLocalNative
            };
            activePlaybackEngine = buildMp4MseEngine(video, file.size, initialStart, localTransport);
            return;
          }
        }
      } catch (e) {}
    }

    playLocalNative();
    return;
  }

  // 2. REMOTE WEBRTC P2P STREAMING
  startRemoteWebRtcPlayback(item, video, initialStart, isMp4Family);
}

function progressiveBlobType(item) {
  const ext = ((item.meta && item.meta.ext) || '').toLowerCase();
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'ogv') return 'video/ogg';
  return 'video/mp4';
}

async function startRemoteWebRtcPlayback(item, video, initialStart, isMp4Family) {
  const hostId = item.serverId;
  const sessionKey = `v_${LOCAL_HOST_ID.slice(-5)}_${generateShortId(7)}`;
  const sessionRef = db.ref(`${RTDB_SIGNALS_PATH}/${hostId}/${sessionKey}`);
  const hostCandRef = sessionRef.child('hostCandidates');
  const answerRef = sessionRef.child('answer');
  const viewerCandRef = sessionRef.child('viewerCandidates');

  const session = { closed: false, pc: null, dc: null, cleanup: null };
  activeRemoteSession = session;

  let streamId = 1;
  let connTimeout = null;
  let disconnectTimer = null;

  /* Subtitle downloads share the data channel with the video stream. */
  const subRequests = new Map();
  const openWaiters = [];
  let channelOpen = false;
  session.requestSubtitle = async (sub) => {
    if (!channelOpen) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 15000);
        openWaiters.push({ resolve: () => { clearTimeout(t); resolve(); }, reject: (e) => { clearTimeout(t); reject(e); } });
      });
    }
    const sDc = session.dc;
    if (session.closed || !sDc || sDc.readyState !== 'open') throw new Error('closed');
    const reqId = ++subtitleRequestSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { subRequests.delete(reqId); reject(new Error('timeout')); }, 15000);
      subRequests.set(reqId, { parts: [], resolve, reject, timer });
      try {
        sDc.send(JSON.stringify({ type: 'GET_SUB', reqId, fileId: sub.id }));
      } catch (e) {
        clearTimeout(timer);
        subRequests.delete(reqId);
        reject(e);
      }
    });
  };

  const cleanupWebRtc = () => {
    if (session.closed) return;
    session.closed = true;
    clearTimeout(connTimeout);
    clearTimeout(disconnectTimer);
    subRequests.forEach((r) => { clearTimeout(r.timer); r.reject(new Error('closed')); });
    subRequests.clear();
    openWaiters.splice(0).forEach((w) => w.reject(new Error('closed')));
    hostCandRef.off();
    answerRef.off();
    const sDc = session.dc;
    const sPc = session.pc;
    try {
      if (sDc && sDc.readyState === 'open') sDc.send(JSON.stringify({ type: 'STOP_STREAM', streamId }));
    } catch (e) {}
    try { sDc && sDc.close(); } catch (e) {}
    try { sPc && sPc.close(); } catch (e) {}
    sessionRef.remove().catch(() => {});
    if (activeRemoteSession === session) activeRemoteSession = null;
  };
  session.cleanup = cleanupWebRtc;

  const failSession = (message) => {
    if (session.closed) return;
    setLoader(false);
    showToast(message);
    markHostDead(hostId);
    cleanupWebRtc();
  };

  sessionRef.onDisconnect().remove().catch(() => {});

  let rtcConfig;
  try { rtcConfig = await getRtcConfig(); } catch (e) { rtcConfig = { iceServers: BASE_ICE_SERVERS }; }
  if (session.closed) return; /* user closed the player or picked another title while we were setting up */

  const pc = new RTCPeerConnection(rtcConfig);
  const dc = pc.createDataChannel('media-stream', { ordered: true });
  dc.binaryType = 'arraybuffer';
  session.pc = pc;
  session.dc = dc;

  connTimeout = setTimeout(() => {
    if (!session.closed && dc.readyState !== 'open') {
      failSession('Could not reach the host — its network may block peer-to-peer');
    }
  }, APP_CONFIG.connectTimeoutMs);

  /* Host ICE candidates can arrive before the answer has been applied. Queue them instead of dropping them. */
  let remoteDescriptionApplied = false;
  let answerRequested = false;
  const pendingHostCandidates = [];

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      viewerCandRef.push(ev.candidate.toJSON()).catch(() => {});
    }
  };

  pc.onconnectionstatechange = () => {
    if (session.closed) return;
    const st = pc.connectionState;
    if (st === 'connected') {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    } else if (st === 'failed') {
      failSession('Connection to the host failed');
    } else if (st === 'disconnected' && !disconnectTimer) {
      disconnectTimer = setTimeout(() => {
        disconnectTimer = null;
        if (!session.closed && pc.connectionState !== 'connected') failSession('Host went offline');
      }, 6000);
    }
  };

  let fallbackActive = false;
  let fallbackChunks = [];
  let fallbackBytes = 0;
  let fallbackFileSize = item.bytes || 0;
  let fallbackLastSwapBytes = 0;

  const activateProgressiveFallback = () => {
    if (fallbackActive || session.closed) return;
    fallbackActive = true;

    /* Detach the MSE engine WITHOUT closing the data channel — the fallback still needs it. */
    if (activePlaybackEngine && typeof activePlaybackEngine.detachForFallback === 'function') {
      activePlaybackEngine.detachForFallback();
      activePlaybackEngine = null;
    }
    try {
      if (dc.readyState === 'open') dc.send(JSON.stringify({ type: 'STOP_STREAM', streamId }));
    } catch (e) {}
    streamId += 1; /* any late packets from the MSE stream are ignored from here on */

    const v = createFreshVideoElement(true);
    activePlaybackEngine = {
      isMse: false,
      progressive: true,
      progressiveDone: false,
      duration: 0,
      resolution: (item.meta && item.meta.res) || 'HD',
      seekTo: (sec) => {
        if (v.seekable && v.seekable.length > 0 && sec <= v.seekable.end(v.seekable.length - 1)) {
          v.currentTime = sec;
        } else {
          showToast('Buffering ahead...');
        }
      },
      destroy: cleanupWebRtc
    };
    fallbackChunks = [];
    fallbackBytes = 0;
    fallbackLastSwapBytes = 0;
    setLoader(true, 'LOADING STREAM');
    try {
      if (dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'STREAM_RANGE', streamId, fileId: item.id, start: 0, end: fallbackFileSize }));
      }
    } catch (e) {}
  };

  const flushProgressiveBlob = (forceFinal = false) => {
    if (session.closed || !activePlaybackEngine || !activePlaybackEngine.progressive) return;
    if (forceFinal) activePlaybackEngine.progressiveDone = true;
    if (fallbackChunks.length === 0) return;
    if (fallbackLastSwapBytes > 0 && fallbackBytes === fallbackLastSwapBytes) return; /* nothing new since last swap */
    const v = getActiveVideo();
    if (!v) return;

    const curTime = v.currentTime || initialStart;
    const wasPaused = v.paused && fallbackLastSwapBytes > 0;
    const blob = new Blob(fallbackChunks, { type: progressiveBlobType(item) });
    /* Collapse everything received so far into one Blob so the browser can keep it off the JS heap. */
    fallbackChunks = [blob];
    fallbackLastSwapBytes = fallbackBytes;

    const nextUrl = URL.createObjectURL(blob);
    const prevUrl = localObjectUrl;
    localObjectUrl = nextUrl;

    v.src = nextUrl;
    v.addEventListener('loadedmetadata', () => {
      if (curTime > 0 && v.duration > curTime) v.currentTime = curTime;
      v.playbackRate = activeSpeed;
      if (!wasPaused) v.play().catch(() => {});
      setLoader(false);
      if (prevUrl) setTimeout(() => URL.revokeObjectURL(prevUrl), 1000);
    }, { once: true });
  };

  dc.onopen = () => {
    if (session.closed) return;
    channelOpen = true;
    openWaiters.splice(0).forEach((w) => w.resolve());
    clearTimeout(connTimeout);
    hostCandRef.off();
    answerRef.off();
    sessionRef.remove().catch(() => {});
    setLoader(true, 'LOADING STREAM');

    if (isMp4Family && window.MP4Box && window.MediaSource) {
      const sendCmd = (cmd) => {
        try { if (dc.readyState === 'open') dc.send(JSON.stringify(cmd)); } catch (e) {}
      };
      const rtcTransport = {
        startProbe: () => sendCmd({ type: 'INIT_PROBE', streamId, fileId: item.id }),
        requestTailProbe: () => sendCmd({ type: 'PROBE_TAIL', streamId, fileId: item.id }),
        requestRange: (startByte, endByte) => sendCmd({ type: 'STREAM_RANGE', streamId, fileId: item.id, start: startByte, end: endByte }),
        pause: () => sendCmd({ type: 'PAUSE_STREAM', streamId }),
        resume: () => sendCmd({ type: 'RESUME_STREAM', streamId }),
        close: cleanupWebRtc,
        onFallback: activateProgressiveFallback
      };
      activePlaybackEngine = buildMp4MseEngine(video, item.bytes || 0, initialStart, rtcTransport);
    } else {
      activateProgressiveFallback();
    }
  };

  dc.onclose = () => {
    if (session.closed) return;
    setLoader(false);
    showToast('Host disconnected');
    cleanupWebRtc();
  };

  dc.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (msg.type === 'SUB_DONE' || msg.type === 'SUB_FAIL') {
        const req = subRequests.get(msg.reqId);
        if (!req) return;
        subRequests.delete(msg.reqId);
        clearTimeout(req.timer);
        if (msg.type === 'SUB_FAIL') { req.reject(new Error('unavailable')); return; }
        const total = req.parts.reduce((sum, part) => sum + part.byteLength, 0);
        const out = new Uint8Array(total);
        let pos = 0;
        req.parts.forEach((part) => { out.set(new Uint8Array(part), pos); pos += part.byteLength; });
        req.resolve(out.buffer);
        return;
      }

      if (msg.streamId !== undefined && msg.streamId !== streamId) return; /* stale stream */

      if (msg.type === 'FILE_MISSING') {
        setLoader(false);
        showToast('File no longer available');
        cleanupWebRtc();
        return;
      }
      if (msg.type === 'FILE_META') {
        fallbackFileSize = msg.fileSize || fallbackFileSize;
        return;
      }
      if (msg.type === 'SLICE_DONE') {
        if (fallbackActive && msg.tag === 'RANGE') {
          flushProgressiveBlob(true);
        } else if (!fallbackActive && activePlaybackEngine && activePlaybackEngine.onSliceDone) {
          activePlaybackEngine.onSliceDone(msg.tag, msg.endByte);
        }
      }
      return;
    }

    const buf = ev.data;
    if (!(buf instanceof ArrayBuffer) || buf.byteLength <= 16) return;
    const view = new DataView(buf);
    const packetId = view.getUint32(0, true);
    if (packetId >= 1000 && subRequests.has(packetId)) {
      subRequests.get(packetId).parts.push(buf.slice(16)); /* ordered channel: chunks arrive in sequence */
      return;
    }
    if (packetId !== streamId) return;
    const byteOffset = view.getFloat64(8, true);
    const payload = buf.slice(16);

    if (fallbackActive) {
      fallbackChunks.push(payload);
      fallbackBytes += payload.byteLength;
      const swapped = fallbackLastSwapBytes;
      const threshold = swapped === 0 ? 4 * 1024 * 1024 : (swapped < 32 * 1024 * 1024 ? 16 * 1024 * 1024 : 48 * 1024 * 1024);
      if (fallbackBytes - swapped >= threshold) flushProgressiveBlob(false);
    } else if (activePlaybackEngine && activePlaybackEngine.feedChunk) {
      activePlaybackEngine.feedChunk(byteOffset, payload);
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (session.closed) return;
    await sessionRef.set({
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: SERVER_TIMESTAMP
    });

    answerRef.on('value', (snap) => {
      const ans = snap.val();
      if (!ans || !ans.sdp || answerRequested || session.closed) return;
      answerRequested = true;
      pc.setRemoteDescription(new RTCSessionDescription(ans)).then(() => {
        remoteDescriptionApplied = true;
        pendingHostCandidates.splice(0).forEach((cand) => {
          pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        });
      }).catch(() => {
        failSession('Connection failed');
      });
    });

    hostCandRef.on('child_added', (cSnap) => {
      const cand = cSnap.val();
      if (!cand || session.closed) return;
      if (remoteDescriptionApplied) {
        pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      } else {
        pendingHostCandidates.push(cand);
      }
    });
  } catch (err) {
    failSession('Connection failed');
  }
}

/* ============================================================
   OVERFLOW MENU & SPEED MODAL
   ============================================================ */
function openPlayerOverflowMenu() {
  document.getElementById('modalTitle').textContent = 'Options';
  const list = document.getElementById('modalList');
  list.innerHTML = `
    <div class="modal-option" role="button" tabindex="0" onclick="restartFromZero()" aria-label="Restart video from 00:00">
      <div class="opt-main">
        <div class="opt-title">Restart</div>
        <div class="opt-sub">Play from 00:00</div>
      </div>
      <span class="mono" style="color:#8bbce8; font-weight:800;">↺</span>
    </div>
    <div class="modal-option ${isLooping ? 'selected' : ''}" role="button" tabindex="0" onclick="toggleLoopPlayback()" aria-label="Toggle loop video playback">
      <div class="opt-main">
        <div class="opt-title">Loop Video</div>
        <div class="opt-sub">${isLooping ? 'Enabled' : 'Off'}</div>
      </div>
      <div class="opt-check">✓</div>
    </div>
    ${document.pictureInPictureEnabled ? `
    <div class="modal-option" role="button" tabindex="0" onclick="togglePictureInPicture()" aria-label="Toggle picture in picture">
      <div class="opt-main">
        <div class="opt-title">Picture in Picture</div>
        <div class="opt-sub">${document.pictureInPictureElement ? 'Return video to this page' : 'Keep watching in a floating window'}</div>
      </div>
      <span class="mono" style="color:#8bbce8; font-weight:800;">⧉</span>
    </div>` : ''}
  `;
  document.getElementById('modalBackdrop').classList.add('open');
}

async function togglePictureInPicture() {
  closeModal();
  const v = getActiveVideo();
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (v && document.pictureInPictureEnabled) await v.requestPictureInPicture();
  } catch (e) {
    showToast('Picture in picture is not available for this video');
  }
}

function restartFromZero() {
  closeModal();
  jumpToPosition(0);
}

function toggleLoopPlayback() {
  isLooping = !isLooping;
  const v = getActiveVideo();
  if (v) v.loop = isLooping;
  closeModal();
  showToast(isLooping ? 'Loop enabled' : 'Loop off');
}

function openSpeedPopup() {
  document.getElementById('modalTitle').textContent = 'Speed';
  const list = document.getElementById('modalList');
  list.innerHTML = SPEED_OPTIONS.map(opt => `
    <div class="modal-option ${opt.value === activeSpeed ? 'selected' : ''}" role="button" tabindex="0" onclick="selectPlaybackSpeed(${opt.value})" aria-label="Set playback speed to ${escapeHtml(opt.label)}">
      <div class="opt-main">
        <div class="opt-title">${escapeHtml(opt.label)}</div>
        <div class="opt-sub">${escapeHtml(opt.sub)}</div>
      </div>
      <div class="opt-check">✓</div>
    </div>
  `).join('');
  document.getElementById('modalBackdrop').classList.add('open');
}

function selectPlaybackSpeed(val) {
  closeModal();
  activeSpeed = val;
  const video = getActiveVideo();
  if (video) video.playbackRate = val;
  document.getElementById('speedBtn').textContent = `${val}x`;
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}

/* ============================================================
   PLAYBACK CONTROLS & TIMELINE SEEKING
   ============================================================ */
function jumpToPosition(targetSec) {
  const clamped = Math.max(0, targetSec);
  if (activePlaybackEngine && typeof activePlaybackEngine.seekTo === 'function') {
    activePlaybackEngine.seekTo(clamped);
    return;
  }
  const video = getActiveVideo();
  if (video) video.currentTime = clamped;
}

function seekFromClientX(clientX) {
  const total = getTotalMediaDuration();
  if (!total || total <= 0) return;
  const rect = document.getElementById('seekArea').getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  jumpToPosition(ratio * total);
}

function seekFromBar(e) {
  seekFromClientX(e.clientX);
}

function skipBy(delta) {
  const video = getActiveVideo();
  const total = getTotalMediaDuration();
  const current = video ? (video.currentTime || 0) : 0;
  const target = Math.max(0, total > 0 ? Math.min(total - 1, current + delta) : current + delta);
  jumpToPosition(target);
}

function togglePlayPause() {
  const video = getActiveVideo();
  if (!video) return;
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

function setVolume(val) {
  const num = Number(val);
  const video = getActiveVideo();
  isMuted = num === 0;
  if (num > 0) savedVol = num;
  if (video) {
    video.volume = num;
    video.muted = isMuted;
  }
  updateVolumeIcon();
}

function toggleMute() {
  const video = getActiveVideo();
  if (isMuted || savedVol === 0) {
    isMuted = false;
    savedVol = savedVol || 1;
    document.getElementById('volRange').value = String(savedVol);
    if (video) {
      video.muted = false;
      video.volume = savedVol;
    }
  } else {
    isMuted = true;
    document.getElementById('volRange').value = '0';
    if (video) video.muted = true;
  }
  updateVolumeIcon();
}

function updateVolumeIcon() {
  const icon = document.getElementById('volIcon');
  if (isMuted || savedVol === 0) {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
  } else {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`;
  }
}

function closePlayer() {
  exitFullscreenMode(false);
  closeModal();
  resetSubtitleState();
  createFreshVideoElement();
  activeMedia = null;
  refreshSubtitleButton();
  setAvailableAudioTracks([], 0);
  setLoader(false);
  clearMediaSession();
  document.getElementById('playerScreen').classList.remove('open');
  renderExplorer();
}

function formatClock(sec) {
  const s = Math.floor(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatExactHMS(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('playerScreen').classList.contains('open')) return;
  if (e.key === 'Escape') {
    if (document.getElementById('modalBackdrop').classList.contains('open')) closeModal();
    else if (isFullscreenMode) exitFullscreenMode(false);
    else closePlayer();
  } else if (e.key === ' ' && document.activeElement.getAttribute('role') !== 'button' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    togglePlayPause();
  } else if (e.key === 'ArrowRight') skipBy(10);
  else if (e.key === 'ArrowLeft') skipBy(-10);
  else if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
    const k = e.key.toLowerCase();
    if (k === 'f') {
      e.preventDefault();
      if (isFullscreenMode) exitFullscreenMode(false); else enterFullscreenMode();
    } else if (k === 'm') {
      e.preventDefault();
      toggleMute();
    } else if (k === 'c') {
      toggleSubtitles();
    } else if (k === 'j') {
      skipBy(-10);
    } else if (k === 'l') {
      skipBy(10);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = isMuted ? 0 : savedVol;
      const next = Math.min(1, Math.max(0, +(base + (e.key === 'ArrowUp' ? 0.05 : -0.05)).toFixed(2)));
      document.getElementById('volRange').value = String(next);
      setVolume(next);
    }
  }
});

function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true;
}

/* Escape also closes the Share / Options sheet when no video is open. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('playerScreen').classList.contains('open')) return;
  if (document.getElementById('modalBackdrop').classList.contains('open')) closeModal();
});

/* ============================================================
   SUBTITLES (sidecar .srt / .vtt files hosted next to the video)
   ============================================================ */
function isSubtitleFilename(name) {
  const m = String(name || '').match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? SUB_EXTS.has(m[1].toLowerCase()) : false;
}

function sanitizeSubs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === 'object' && s.id)
    .slice(0, 12)
    .map((s) => ({
      id: String(s.id).slice(0, 64),
      name: String(s.name || 'subtitles').slice(0, 200),
      lang: String(s.lang || 'Subtitles').slice(0, 40),
      size: Number(s.size) || 0
    }));
}

/* "Movie.2021.en.srt" → English, "2_Hindi.srt" → Hindi, "Movie.eng.forced.srt" → English (Forced) */
function detectSubtitleLanguage(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, '');
  const tokens = base.split(/[\s._\-()\[\]]+/).filter(Boolean).map((t) => t.toLowerCase());
  const FLAGS = { forced: 'Forced', sdh: 'SDH', cc: 'CC', hi: null, hearing: 'SDH' };
  let flag = '';
  let label = '';

  /* Language tags sit at the end of the name, so only the last couple of tokens are considered. */
  const tail = tokens.slice(-3);
  /* "Movie.en.hi.srt" means English for the hearing impaired, not Hindi. */
  if (tail.length >= 2 && tail[tail.length - 1] === 'hi' && ISO_LANG_MAP[tail[tail.length - 2]] && tail[tail.length - 2] !== 'hi') {
    flag = 'SDH';
    tail.pop();
  }
  for (let i = tail.length - 1; i >= 0; i--) {
    const t = tail[i];
    if (Object.prototype.hasOwnProperty.call(FLAGS, t) && FLAGS[t] && t !== 'hi') { flag = flag || FLAGS[t]; continue; }
    if (t.length >= 2 && ISO_LANG_MAP[t] && (i === tail.length - 1 || tail[i + 1] in FLAGS)) { label = ISO_LANG_MAP[t]; break; }
    const named = Object.values(ISO_LANG_MAP).find((v) => v.toLowerCase() === t);
    if (named && (i === tail.length - 1 || tail[i + 1] in FLAGS)) { label = named; break; }
  }
  if (!label) return { label: '', flag };
  return { label, flag };
}

function attachSubtitlesToEntries(videos, subtitleFiles) {
  if (!videos.length || !subtitleFiles.length) return;
  const lower = (s) => String(s).toLowerCase();
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const baseOf = (n) => lower(String(n).replace(/\.[^.]+$/, ''));
  const normDir = (p) => {
    const parts = lower(dirOf(p)).split('/').filter(Boolean);
    while (parts.length && /^(subs?|subtitles?)$/.test(parts[parts.length - 1])) parts.pop();
    return parts.join('/');
  };

  const infos = videos.map((v) => ({ entry: v.entry, dir: lower(dirOf(v.relPath)), base: baseOf(v.entry.name) }));

  subtitleFiles.forEach((file) => {
    const rel = String(file.webkitRelativePath || file.customRelPath || file.name).replace(/^\/+/, '');
    const subDir = normDir(rel);
    const subBase = baseOf(file.name);
    const fullLower = '/' + lower(rel);

    let targets = infos.filter((v) => v.dir === subDir && (subBase === v.base || (subBase.startsWith(v.base) && /^[.\s_\-]/.test(subBase.slice(v.base.length)))));
    if (!targets.length) targets = infos.filter((v) => v.base && fullLower.includes('/' + v.base + '/'));
    if (!targets.length) {
      const sameDir = infos.filter((v) => v.dir === subDir);
      if (sameDir.length === 1) targets = sameDir;
    }
    if (!targets.length) return;

    const subId = `s_${generateShortId(8)}`;
    localFileMap.set(subId, file);
    localSubtitleIds.add(subId);
    const { label, flag } = detectSubtitleLanguage(file.name);

    targets.forEach((t) => {
      if (!t.entry.subs) t.entry.subs = [];
      if (t.entry.subs.length >= 12) return;
      const nth = t.entry.subs.length + 1;
      const lang = label ? (flag ? `${label} (${flag})` : label) : `Subtitles ${nth}`;
      t.entry.subs.push({ id: subId, name: String(file.name).slice(0, 200), lang, size: file.size });
    });
  });
}

async function serveSubtitleToViewer(dc, cmd) {
  const reqId = Number(cmd.reqId);
  const fail = () => {
    try { if (dc.readyState === 'open') dc.send(JSON.stringify({ type: 'SUB_FAIL', reqId })); } catch (e) {}
  };
  const file = localSubtitleIds.has(cmd.fileId) ? localFileMap.get(cmd.fileId) : null;
  if (!file || !(reqId >= 1000) || file.size > SUB_MAX_BYTES) { fail(); return; }
  try {
    const buf = await file.arrayBuffer();
    const CHUNK = 48 * 1024;
    for (let off = 0; off < buf.byteLength; off += CHUNK) {
      if (dc.readyState !== 'open') return;
      await waitForDcDrain(dc, { aborted: false });
      dc.send(buildBinaryPacket(reqId, off, buf.slice(off, off + CHUNK)));
    }
    dc.send(JSON.stringify({ type: 'SUB_DONE', reqId, bytes: buf.byteLength }));
  } catch (e) {
    fail();
  }
}

function decodeSubtitleBytes(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(u8); /* older SRT files are usually Latin-1 */
  }
}

function subtitleBytesToVtt(buf) {
  let text = decodeSubtitleBytes(buf).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(text)) return text;
  text = text
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, (m, hms, ms) => `${hms.length < 8 ? '0' + hms : hms}.${ms.padEnd(3, '0')}`)
    .replace(/\{\\[^}]*\}/g, '');
  return `WEBVTT\n\n${text.trim()}\n`;
}

function applySubtitleToVideo(video) {
  if (!video) return;
  video.querySelectorAll('track').forEach((t) => t.remove());
  if (!activeSubtitle) return;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = activeSubtitle.label;
  track.srclang = activeSubtitle.srclang || 'und';
  track.src = activeSubtitle.url;
  track.default = true;
  video.appendChild(track);
  const show = () => { try { track.track.mode = 'showing'; } catch (e) {} };
  show();
  track.addEventListener('load', show);
}

function resetSubtitleState() {
  if (activeSubtitle && activeSubtitle.url) {
    try { URL.revokeObjectURL(activeSubtitle.url); } catch (e) {}
  }
  activeSubtitle = null;
  subtitleSelectToken++;
  applySubtitleToVideo(getActiveVideo());
  refreshSubtitleButton();
}

function refreshSubtitleButton() {
  const btn = document.getElementById('subBtn');
  if (!btn) return;
  const subs = (activeMedia && activeMedia.subs) || [];
  btn.style.display = subs.length > 0 ? 'inline-flex' : 'none';
  const lbl = document.getElementById('subBtnLabel');
  if (lbl) lbl.textContent = activeSubtitle ? activeSubtitle.shortLabel : 'CC';
  btn.setAttribute('aria-pressed', activeSubtitle ? 'true' : 'false');
}

function openSubtitlePopup() {
  const subs = (activeMedia && activeMedia.subs) || [];
  if (!subs.length) return;
  document.getElementById('modalTitle').textContent = 'Subtitles';
  document.getElementById('modalList').innerHTML = `
    <div class="modal-option ${activeSubtitle ? '' : 'selected'}" role="button" tabindex="0" onclick="selectSubtitle(-1)" aria-label="Turn subtitles off">
      <div class="opt-main"><div class="opt-title">Off</div><div class="opt-sub">No subtitles</div></div>
      <div class="opt-check">✓</div>
    </div>
    ${subs.map((s, i) => `
    <div class="modal-option ${activeSubtitle && activeSubtitle.id === s.id ? 'selected' : ''}" role="button" tabindex="0" onclick="selectSubtitle(${i})" aria-label="Show ${escapeHtml(s.lang)} subtitles">
      <div class="opt-main"><div class="opt-title">${escapeHtml(s.lang)}</div><div class="opt-sub">${escapeHtml(s.name)}</div></div>
      <div class="opt-check">✓</div>
    </div>`).join('')}
  `;
  document.getElementById('modalBackdrop').classList.add('open');
}

async function loadSubtitleBytes(item, sub) {
  if (item.isLocal) {
    const file = localFileMap.get(sub.id);
    if (!file) throw new Error('missing');
    return file.arrayBuffer();
  }
  /* the tunnel may still be connecting; wait up to ~8 s for it to exist */
  for (let i = 0; i < 160 && activeMedia === item; i++) {
    if (activeRemoteSession && activeRemoteSession.requestSubtitle) return activeRemoteSession.requestSubtitle(sub);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('not connected');
}

function subtitlePrefKey(sub) {
  return String(sub.lang || '').toLowerCase();
}

async function selectSubtitle(idx, silent = false) {
  if (!silent) closeModal();
  const item = activeMedia;
  if (!item) return;

  if (idx < 0) {
    resetSubtitleState();
    storage.set('sy_sub_on', '0'); /* off, but the chosen language is remembered for the next time they are switched on */
    if (!silent) showToast('Subtitles off');
    return;
  }
  const sub = (item.subs || [])[idx];
  if (!sub) return;

  const token = ++subtitleSelectToken;
  try {
    if (!silent) showToast('Loading subtitles…');
    const buf = await loadSubtitleBytes(item, sub);
    if (token !== subtitleSelectToken || activeMedia !== item) return; /* superseded or player closed */
    const vtt = subtitleBytesToVtt(buf);
    const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    if (activeSubtitle && activeSubtitle.url) { try { URL.revokeObjectURL(activeSubtitle.url); } catch (e) {} }
    const code = Object.keys(ISO_LANG_MAP).find((k) => k.length === 2 && sub.lang.startsWith(ISO_LANG_MAP[k]));
    activeSubtitle = { id: sub.id, label: sub.lang, srclang: code || 'und', shortLabel: (code || 'CC').toUpperCase(), url };
    applySubtitleToVideo(getActiveVideo());
    refreshSubtitleButton();
    if (!silent) {
      storage.set('sy_sub_lang', subtitlePrefKey(sub));
      storage.set('sy_sub_on', '1');
      showToast(`Subtitles: ${sub.lang}`);
    }
  } catch (e) {
    if (token === subtitleSelectToken && !silent) showToast('Could not load subtitles');
  }
}

function toggleSubtitles() {
  const subs = (activeMedia && activeMedia.subs) || [];
  if (!subs.length) { showToast('No subtitles for this video'); return; }
  if (activeSubtitle) { selectSubtitle(-1); return; }
  const lang = storage.get('sy_sub_lang');
  let idx = lang ? subs.findIndex((s) => subtitlePrefKey(s) === lang) : -1;
  if (idx < 0) idx = 0;
  selectSubtitle(idx);
}

/* Remember the language the viewer last chose and switch it on automatically for the next video that has it. */
function maybeAutoSelectSubtitle(item) {
  const subs = item.subs || [];
  if (!subs.length) return;
  if (storage.get('sy_sub_on') !== '1') return;
  const lang = storage.get('sy_sub_lang');
  if (!lang) return;
  const idx = subs.findIndex((s) => subtitlePrefKey(s) === lang);
  if (idx >= 0) selectSubtitle(idx, true);
}

/* ============================================================
   MEDIA SESSION (lock-screen / headset / keyboard media keys)
   ============================================================ */
function setupMediaSession(item) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.cleanName || item.name || "Stream Yours'",
      artist: item.serverName || "Stream Yours'",
      album: activeSeriesFolder ? activeSeriesFolder.cleanName : "Stream Yours'",
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
    });
  } catch (e) {}
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.metadata = null; } catch (e) {}
}

(function initMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  const bind = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) {} };
  bind('play', () => { const v = getActiveVideo(); if (v) v.play().catch(() => {}); });
  bind('pause', () => { const v = getActiveVideo(); if (v) v.pause(); });
  bind('seekbackward', (d) => skipBy(-((d && d.seekOffset) || 10)));
  bind('seekforward', (d) => skipBy((d && d.seekOffset) || 10));
  bind('seekto', (d) => { if (d && typeof d.seekTime === 'number') jumpToPosition(d.seekTime); });
  bind('previoustrack', () => playPrevEpisode());
  bind('nexttrack', () => playNextEpisode());
})();

/* ============================================================
   SHARE / INVITE / INSTALL
   ============================================================ */
function getShareUrl() {
  if (window.location.origin && window.location.origin !== 'null') {
    return `${window.location.origin}${window.location.pathname}`;
  }
  const canonical = document.getElementById('canonicalLink');
  return canonical ? canonical.getAttribute('href') : 'https://stream-yours.pages.dev/';
}

let qrLibPromise = null;
function loadQrLibrary() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (qrLibPromise) return qrLibPromise;
  qrLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/qrcode-1.4.4.min.js';
    s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('qr missing')));
    s.onerror = () => reject(new Error('qr failed'));
    document.head.appendChild(s);
  });
  qrLibPromise.catch(() => { qrLibPromise = null; });
  return qrLibPromise;
}

function isStandaloneDisplay() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

function openShareModal() {
  const url = getShareUrl();
  const canNativeShare = typeof navigator.share === 'function';
  const canInstall = !!deferredInstallPrompt && !isStandaloneDisplay();
  const iosHint = !canInstall && !isStandaloneDisplay() && /iPad|iPhone|iPod/.test(navigator.userAgent);

  document.getElementById('modalTitle').textContent = 'Share & Install';
  document.getElementById('modalList').innerHTML = `
    <div class="share-card">
      <div class="qr-box" id="qrBox" role="img" aria-label="QR code that opens ${escapeHtml(url)}"><span class="mono">…</span></div>
      <div class="share-url mono">${escapeHtml(url)}</div>
      <div class="share-hint">Scan or open this link on another phone, tablet or computer to browse and watch what you are hosting.</div>
    </div>
    <div class="modal-option" role="button" tabindex="0" onclick="copyShareLink()" aria-label="Copy the site link">
      <div class="opt-main"><div class="opt-title">Copy link</div><div class="opt-sub">Paste it anywhere</div></div>
      <span class="mono" style="color:#8bbce8; font-weight:800;">⧉</span>
    </div>
    ${canNativeShare ? `
    <div class="modal-option" role="button" tabindex="0" onclick="shareLinkNative()" aria-label="Share the site link with another app">
      <div class="opt-main"><div class="opt-title">Share…</div><div class="opt-sub">Messages, email, nearby devices</div></div>
      <span class="mono" style="color:#8bbce8; font-weight:800;">↗</span>
    </div>` : ''}
    ${canInstall ? `
    <div class="modal-option" role="button" tabindex="0" onclick="installApp()" aria-label="Install Stream Yours as an app">
      <div class="opt-main"><div class="opt-title">Install app</div><div class="opt-sub">Open it like a native app, full screen</div></div>
      <span class="mono" style="color:#8bbce8; font-weight:800;">＋</span>
    </div>` : ''}
    ${iosHint ? `
    <div class="share-hint" style="padding:2px 6px;">To install on iPhone or iPad: tap the Share button in Safari, then “Add to Home Screen”.</div>` : ''}
  `;
  document.getElementById('modalBackdrop').classList.add('open');

  loadQrLibrary().then((qrcode) => {
    const box = document.getElementById('qrBox');
    if (!box) return;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }).catch(() => {
    const box = document.getElementById('qrBox');
    if (box) box.textContent = 'QR unavailable';
  });
}

async function copyShareLink() {
  const url = getShareUrl();
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    ta.remove();
  }
  closeModal();
  showToast('Link copied');
}

async function shareLinkNative() {
  closeModal();
  try {
    await navigator.share({ title: "Stream Yours'", text: 'Stream movies and series straight between our devices.', url: getShareUrl() });
  } catch (e) { /* cancelled */ }
}

async function installApp() {
  closeModal();
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  try {
    promptEvent.prompt();
    await promptEvent.userChoice;
  } catch (e) {}
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  showToast('App installed');
});

/* ============================================================
   NETWORK AWARENESS, IDLE CONNECTION RELEASE & SERVICE WORKER
   ============================================================ */
window.addEventListener('offline', () => showToast('You are offline'));
window.addEventListener('online', () => showToast('Back online'));

/* Firebase's free tier limits how many tabs can hold a realtime connection at once. A tab that has been hidden for
   a while (and is not hosting or playing) releases its connection and reconnects the moment it is visible again. */
(function initIdleConnectionRelease() {
  if (!FIREBASE_READY) return;
  let idleTimer = null;
  let releasedByIdle = false;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const playerOpen = document.getElementById('playerScreen').classList.contains('open');
        if (document.hidden && !isHosting && !playerOpen) {
          try { db.goOffline(); releasedByIdle = true; } catch (e) {}
        }
      }, APP_CONFIG.idleOfflineAfterMs);
    } else {
      clearTimeout(idleTimer);
      if (releasedByIdle) {
        releasedByIdle = false;
        try { db.goOnline(); } catch (e) {}
      }
    }
  });
})();

if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

if (!FIREBASE_READY) {
  setTimeout(() => showToast('Realtime service could not be loaded'), 800);
}

/* ============================================================
   NON-BREAKING CANONICAL & DEEP-LINK URL STATE RESOLVER
   ============================================================ */
(function initSeoAndDeepLinkState() {
  try {
    const cleanBaseUrl = window.location.origin && window.location.origin !== 'null'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://stream-yours.pages.dev/';

    const canonicalEl = document.getElementById('canonicalLink');
    const ogUrlEl = document.getElementById('ogUrl');
    const metaDescEl = document.getElementById('metaDescription');

    const params = new URLSearchParams(window.location.search);
    const viewParam = (params.get('view') || '').toLowerCase();
    const modeParam = (params.get('mode') || '').toLowerCase();
    const queryParam = (params.get('q') || '').trim();

    if (viewParam === 'movies') {
      document.title = "Movies — Stream Yours' P2P Movie Streaming";
      if (metaDescEl) metaDescEl.setAttribute('content', "Browse and stream standalone HD & 4K movies peer-to-peer directly from connected host browsers with zero cloud uploads.");
      if (canonicalEl) canonicalEl.setAttribute('href', `${cleanBaseUrl}?view=movies`);
      if (ogUrlEl) ogUrlEl.setAttribute('content', `${cleanBaseUrl}?view=movies`);
      setTypeFilter('MOVIES');
    } else if (viewParam === 'series') {
      document.title = "TV Series — Stream Yours' P2P Episode Streaming";
      if (metaDescEl) metaDescEl.setAttribute('content', "Stream multi-season TV series folders peer-to-peer with automatic episode playlists, multi-language audio tracks, and resume sync.");
      if (canonicalEl) canonicalEl.setAttribute('href', `${cleanBaseUrl}?view=series`);
      if (ogUrlEl) ogUrlEl.setAttribute('content', `${cleanBaseUrl}?view=series`);
      setTypeFilter('SERIES');
    } else if (modeParam === 'host') {
      setTimeout(() => {
        showToast('Choose a folder or drop videos to start hosting');
        const hostBtn = document.querySelector('label[for="folderInput"]');
        if (hostBtn) {
          hostBtn.classList.add('attention');
          setTimeout(() => hostBtn.classList.remove('attention'), 7000);
        }
      }, 700);
      document.title = "Host Local Videos — Stream Yours' WebRTC P2P Broadcaster";
      if (metaDescEl) metaDescEl.setAttribute('content', "Host local movie and TV series folders directly from your browser using WebRTC DataChannels with zero server uploads.");
      if (canonicalEl) canonicalEl.setAttribute('href', `${cleanBaseUrl}?mode=host`);
      if (ogUrlEl) ogUrlEl.setAttribute('content', `${cleanBaseUrl}?mode=host`);
    } else {
      if (canonicalEl) canonicalEl.setAttribute('href', cleanBaseUrl);
      if (ogUrlEl) ogUrlEl.setAttribute('content', cleanBaseUrl);
    }

    if (queryParam) {
      const searchEl = document.getElementById('searchInput');
      if (searchEl) searchEl.value = queryParam;
      handleSearchInput(queryParam);
    }
  } catch (e) {}
})();
