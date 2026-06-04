/* =========================================================
   ONLINE HAFIZA OYUNU — game.js
   Single-player + up to 4-player online with:
   - Lobby settings (grid, theme, card back, max players, cursor mode)
   - 4-corner player profiles
   - Roulette starting player animation
   - Emoji reactions (float up)
   - Dynamic per-player cursors
   - Card back themes (classic / neon / cosmic)
   ========================================================= */

// ── WebSocket ──────────────────────────────────────────────
const socketUrl = window.location.hostname === 'localhost'
  ? 'ws://localhost:8080'
  : 'wss://online-card-production.up.railway.app';

let socket;

// ── State ──────────────────────────────────────────────────
let playerName  = '';
let roomCode    = '';
let players     = [];
let gameState   = null;
let roomSettings = { gridSize: '6x6', theme: 'mix', cardBack: 'classic', maxPlayers: 2, cursorMode: 'all' };
let isHost      = false;
let isSinglePlayer = false;

let gameStarted     = false;
let isTransitioning = false;
let latestState     = null;
let shakeTimeout    = null;

// Cursor
let currentlyHoveredCardIndex = null;
let lastCursorSendTime = 0;
const CURSOR_THROTTLE_MS = 30;
const SLOT_COLORS = ['#007aff', '#ef4444', '#ffcc00', '#34c759'];
const remoteCursors = {}; // name → DOM element

// Single-player
let spCards        = [];
let spFlipped      = [];
let spMatched      = [];
let spMoves        = 0;
let spTimerSec     = 0;
let spTimerHandle  = null;

// ── Emoji pool (client-side for single player) ─────────────
const clientEmojiPool = {
  mix: ['🐶','🐱','🦊','🐻','🐼','🦁','🐯','🦋','🐸','🦄',
        '🌸','🌊','⚡','🔥','🌙','⭐','🌈','🍀','☀️','☁️',
        '🍕','🍔','🍣','🍩','🍦','🎂','🍓','🍉','🍎','🍌',
        '🎮','🎸','🚀','💎','🎯','🏆','🎪','🎭','🎈','🎁',
        '♟️','🎲','🧩','🎴','🃏','🔮','🎱','🎰','❤️','🧡'],
  animals: ['🐶','🐱','🦊','🐻','🐼','🦁','🐯','🦋','🐸','🦄',
            '🐷','🐨','🐰','🐙','🐒','🐔','🐧','🐦','🐣','🦆',
            '🦅','🦉','🦇','🐺','🐗','🐴','🐝','🐛','🐌','🐞','🐢','🐠'],
  nature: ['🌸','🌊','⚡','🔥','🌙','⭐','🌈','🍀','☀️','☁️',
           '❄️','🍁','🍂','🍃','🎋','🌵','🎄','🌲','🌳','🌴',
           '🌻','🌹','🌷','🌼','🌾','🌿','🍄','🌕','☄️','🌋','🏔️','🏝️'],
  food: ['🍕','🍔','🍣','🍩','🍦','🎂','🍓','🍉','🍎','🍌',
         '🍒','🍇','🍍','🍑','🍈','🍊','🍟','🌭','🍿','🍪',
         '🍫','🍬','🍭','🍯','🍰','🥞','🍳','🧇','🥗','🌮','🍜','🥤'],
  objects: ['🎮','🎸','🚀','💎','🎯','🏆','🎪','🎭','🎈','🎁',
            '🔔','🔑','📦','📖','✏️','📐','🔍','💡','⏰','🛠️',
            '⚔️','🛡️','⚙️','🧪','📡','🔋','📸','🎨','🛹','⚽','🏀','🚗'],
  symbols: ['♟️','🎲','🧩','🎴','🃏','🔮','🎱','🎰','❤️','🧡',
            '💛','💚','💙','💜','🖤','🤍','💖','🌟','💢','🌀',
            '💤','🌐','💠','🔱','🔲','🔳','🔴','🔵','🟡','🟢','🟣','🟠']
};

// ── Boot ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  setupEventListeners();
  checkSavedName();
});

// ── WebSocket ──────────────────────────────────────────────
function connectWebSocket() {
  socket = new WebSocket(socketUrl);

  socket.onopen = () => console.log('WS connected');

  socket.onmessage = (event) => {
    try {
      const { type, payload } = JSON.parse(event.data);
      switch (type) {
        case 'room_state':       handleRoomState(payload);          break;
        case 'join_error':       showJoinError(payload.message);    break;
        case 'player_left':      handlePlayerLeft(payload);         break;
        case 'opponent_disconnected': showDisconnectOverlay();      break;
        case 'opponent_left':
          showToast('Rakip odadan ayrıldı');
          setTimeout(resetToLobby, 2000);
          break;
        case 'cursor_move':      handleRemoteCursorMove(payload);   break;
        case 'card_hover':       handleRemoteCardHover(payload);    break;
        case 'receive_reaction': handleIncomingReaction(payload);   break;
        default: console.log('Unknown WS type:', type);
      }
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  socket.onclose = () => {
    console.log('WS closed. Reconnecting in 3s…');
    setTimeout(connectWebSocket, 3000);
  };
}

function sendMsg(type, payload = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
  }
}

// ── Screen helpers ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function checkSavedName() {
  const saved = localStorage.getItem('memory_game_username');
  if (saved) { playerName = saved; showLobby(); }
  else        { showScreen('screen-login'); }
}

function showLobby() {
  document.getElementById('lobby-username').textContent  = playerName;
  document.getElementById('lobby-avatar').textContent    = playerName.charAt(0).toUpperCase();
  showScreen('screen-lobby');
  hideCursors();
  hideReactionPanel();
}

// ── Event Listeners ────────────────────────────────────────
function setupEventListeners() {
  /* Login */
  const loginBtn      = document.getElementById('login-btn');
  const usernameInput = document.getElementById('username-input');

  const handleLogin = () => {
    const name = usernameInput.value.trim();
    if (name.length > 0) {
      playerName = name;
      localStorage.setItem('memory_game_username', name);
      showLobby();
    } else {
      usernameInput.classList.add('shake');
      usernameInput.style.borderColor = 'var(--red)';
      setTimeout(() => {
        usernameInput.classList.remove('shake');
        usernameInput.style.borderColor = '';
      }, 500);
    }
  };
  loginBtn.addEventListener('click', handleLogin);
  usernameInput.addEventListener('keydown', e => e.key === 'Enter' && handleLogin());

  /* Lobby: create room */
  document.getElementById('create-room-btn').addEventListener('click', () => {
    sendMsg('create_room', { name: playerName });
  });

  /* Lobby: single player */
  document.getElementById('single-player-btn').addEventListener('click', startSinglePlayer);

  /* Lobby: join room */
  const joinBtn   = document.getElementById('join-room-btn');
  const joinInput = document.getElementById('join-room-input');
  const handleJoin = () => {
    const code = joinInput.value.trim().toUpperCase();
    if (code.length === 6) sendMsg('join_room', { name: playerName, code });
    else showJoinError('6 haneli kod giriniz');
  };
  joinBtn.addEventListener('click', handleJoin);
  joinInput.addEventListener('keydown', e => e.key === 'Enter' && handleJoin());

  /* Room code copy badge */
  document.getElementById('lobby-room-code-badge').addEventListener('click', () => {
    const code = document.getElementById('lobby-room-code-val').textContent;
    if (code && code !== '------') {
      navigator.clipboard.writeText(code).then(() => showToast('Oda kodu kopyalandı!')).catch(() => {});
    }
  });

  /* Old copy code button (modal) */
  document.getElementById('copy-code-btn').addEventListener('click', () => {
    const code = document.getElementById('room-code-text').textContent;
    navigator.clipboard.writeText(code).then(() => showToast('Oda kodu kopyalandı!')).catch(() => {});
  });

  /* Ready screen: ready toggle */
  document.getElementById('ready-toggle-btn').addEventListener('click', () => {
    const me = players.find(p => p.name === playerName);
    const newReady = me ? !me.ready : true;
    sendMsg('set_ready', { ready: newReady });
  });

  /* Ready screen: host start */
  document.getElementById('host-start-btn').addEventListener('click', () => {
    sendMsg('start_game');
  });

  /* Settings (host only) */
  const settingIds = ['setting-grid-size','setting-theme','setting-card-back','setting-max-players','setting-cursor-mode'];
  settingIds.forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (!isHost) return;
      sendMsg('update_settings', {
        gridSize:   document.getElementById('setting-grid-size').value,
        theme:      document.getElementById('setting-theme').value,
        cardBack:   document.getElementById('setting-card-back').value,
        maxPlayers: parseInt(document.getElementById('setting-max-players').value),
        cursorMode: document.getElementById('setting-cursor-mode').value,
      });
    });
  });

  /* Card grid: click & hover */
  document.getElementById('card-grid').addEventListener('click', (e) => {
    const cardEl = e.target.closest('.memory-card');
    if (!cardEl) return;
    const index = parseInt(cardEl.getAttribute('data-index'));

    if (isSinglePlayer) {
      handleSinglePlayerFlip(index);
    } else {
      if (isTransitioning) return;
      if (!cardEl.classList.contains('interactable')) return;
      sendMsg('flip_card', { index });
    }
  });

  document.getElementById('card-grid').addEventListener('mousemove', (e) => {
    if (!gameStarted) return;
    const cardEl = e.target.closest('.memory-card');
    if (cardEl) {
      const idx = parseInt(cardEl.getAttribute('data-index'));
      if (currentlyHoveredCardIndex !== idx) {
        currentlyHoveredCardIndex = idx;
        if (!isSinglePlayer) sendMsg('card_hover', { index: idx });
      }
    } else if (currentlyHoveredCardIndex !== null) {
      currentlyHoveredCardIndex = null;
      if (!isSinglePlayer) sendMsg('card_hover', { index: null });
    }
  });

  document.getElementById('card-grid').addEventListener('mouseleave', () => {
    if (!gameStarted || isSinglePlayer) return;
    if (currentlyHoveredCardIndex !== null) {
      currentlyHoveredCardIndex = null;
      sendMsg('card_hover', { index: null });
    }
  });

  /* Emoji reaction buttons */
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-emoji');
      spawnFloatingEmoji(emoji, 'local');
      if (!isSinglePlayer) sendMsg('send_reaction', { emoji });
    });
  });

  /* Finish screen */
  document.getElementById('play-again-btn').addEventListener('click', () => {
    if (isSinglePlayer) {
      startSinglePlayer();
      return;
    }
    sendMsg('play_again');
    const btn = document.getElementById('play-again-btn');
    btn.textContent = 'Bekleniyor…';
    btn.disabled = true;
  });

  document.getElementById('exit-btn').addEventListener('click', () => {
    if (!isSinglePlayer) sendMsg('leave_room');
    resetToLobby();
  });

  /* Global mouse tracking for local cursor */
  window.addEventListener('mousemove', (e) => {
    const gameScreen = document.getElementById('screen-game');
    const localCursor = document.getElementById('local-cursor');
    if (gameScreen && gameScreen.classList.contains('active')) {
      if (localCursor) {
        localCursor.style.display = 'block';
        localCursor.style.left = `${e.clientX}px`;
        localCursor.style.top  = `${e.clientY}px`;
      }
      if (!isSinglePlayer && gameStarted && gameState && gameState.phase === 'playing') {
        const now = Date.now();
        if (now - lastCursorSendTime >= CURSOR_THROTTLE_MS) {
          lastCursorSendTime = now;
          sendMsg('cursor_move', {
            x: e.clientX / window.innerWidth,
            y: e.clientY / window.innerHeight
          });
        }
      }
    } else {
      if (localCursor) localCursor.style.display = 'none';
    }
  });

  document.addEventListener('mouseleave', () => {
    const localCursor = document.getElementById('local-cursor');
    if (localCursor) localCursor.style.display = 'none';
  });
}

// ── Room State Router ──────────────────────────────────────
function handleRoomState(room) {
  roomCode     = room.code;
  players      = room.players;
  gameState    = room.gameState;
  latestState  = room;
  roomSettings = room.settings || roomSettings;

  isHost = players.length > 0 && players[0].name === playerName;

  const phase = gameState.phase;

  if (phase === 'waiting' || phase === 'ready') {
    gameStarted     = false;
    isTransitioning = false;
    clearShakeTimeout();
    showReadyRoom(room);

  } else if (phase === 'playing') {
    if (!gameStarted) {
      triggerCountdownSequence(room);
    } else {
      if (!isTransitioning) renderGameBoard(room);
    }

  } else if (phase === 'finished') {
    showFinishScreen(room);
  }
}

function handlePlayerLeft({ name }) {
  showToast(`${name} odadan ayrıldı`);
}

// ── Ready Room ─────────────────────────────────────────────
function showReadyRoom(room) {
  showScreen('screen-ready');

  // Update room code badge
  document.getElementById('lobby-room-code-val').textContent = room.code;

  // Host-only settings
  const settingsPanel = document.getElementById('lobby-settings-panel');
  const allSelects    = settingsPanel.querySelectorAll('select');
  if (isHost) {
    settingsPanel.style.opacity = '1';
    allSelects.forEach(s => s.disabled = false);
    // Sync selects to current settings
    document.getElementById('setting-grid-size').value  = roomSettings.gridSize;
    document.getElementById('setting-theme').value      = roomSettings.theme;
    document.getElementById('setting-card-back').value  = roomSettings.cardBack;
    document.getElementById('setting-max-players').value = String(roomSettings.maxPlayers);
    document.getElementById('setting-cursor-mode').value = roomSettings.cursorMode;
  } else {
    settingsPanel.style.opacity = '0.6';
    allSelects.forEach(s => s.disabled = true);
    // Show current settings as read-only
    document.getElementById('setting-grid-size').value  = roomSettings.gridSize;
    document.getElementById('setting-theme').value      = roomSettings.theme;
    document.getElementById('setting-card-back').value  = roomSettings.cardBack;
    document.getElementById('setting-max-players').value = String(roomSettings.maxPlayers);
    document.getElementById('setting-cursor-mode').value = roomSettings.cursorMode;
  }

  // Render player slots
  const slotsEl  = document.getElementById('players-slots');
  slotsEl.innerHTML = '';
  const maxSlots = roomSettings.maxPlayers;
  for (let i = 0; i < maxSlots; i++) {
    const p   = players[i];
    const slot = document.createElement('div');
    slot.className = 'player-slot ' + (p ? '' : 'empty');
    if (p && p.ready) slot.classList.add('ready-state');

    if (p) {
      const isMe = p.name === playerName;
      slot.innerHTML = `
        ${i === 0 ? '<span class="slot-host-badge">Host</span>' : ''}
        <span class="slot-num">Oyuncu ${i + 1}</span>
        <div class="slot-avatar slot-color-${i}">${p.name.charAt(0).toUpperCase()}</div>
        <div class="slot-name">${p.name}${isMe ? ' (Siz)' : ''}</div>
        <div class="slot-status">${p.ready ? '✓ Hazır' : 'Hazır Değil'}</div>
      `;
    } else {
      slot.innerHTML = `
        <span class="slot-num">Oyuncu ${i + 1}</span>
        <div class="slot-avatar" style="background:#ccc; font-size:18px">?</div>
        <div class="slot-name" style="color:var(--text-muted)">Bekleniyor…</div>
        <div class="slot-status"></div>
      `;
    }
    slotsEl.appendChild(slot);
  }

  // Ready toggle button
  const me      = players.find(p => p.name === playerName);
  const readyBtn = document.getElementById('ready-toggle-btn');
  if (me && me.ready) {
    readyBtn.textContent = '✓ Hazır (İptal Et)';
    readyBtn.classList.add('btn-primary');
    readyBtn.classList.remove('btn-secondary');
  } else {
    readyBtn.textContent = 'Hazır Ol';
    readyBtn.classList.add('btn-secondary');
    readyBtn.classList.remove('btn-primary');
  }

  // Host start button
  const startBtn = document.getElementById('host-start-btn');
  if (isHost) {
    const allReady = players.length >= 2 && players.every(p => p.ready);
    startBtn.disabled = !allReady;
    startBtn.style.display = '';
  } else {
    startBtn.style.display = 'none';
  }
}

// ── Countdown + Roulette ───────────────────────────────────
function triggerCountdownSequence(room) {
  gameStarted     = true;
  isTransitioning = true;

  const overlay   = document.getElementById('overlay-countdown');
  const countText = document.getElementById('countdown-text');
  overlay.classList.add('active');

  const runStep = (text, delay, cb) => {
    setTimeout(() => {
      countText.classList.remove('countdown-animate');
      void countText.offsetWidth;
      countText.textContent = text;
      countText.classList.add('countdown-animate');
      if (cb) cb();
    }, delay);
  };

  runStep('3', 0);
  runStep('2', 500);
  runStep('1', 1000);
  runStep('BAŞLA!', 1500, () => {
    setTimeout(() => {
      overlay.classList.remove('active');
      showScreen('screen-game');
      buildCardGrid(room, true);

      // Preview 2s then roulette
      setTimeout(() => {
        document.querySelectorAll('.memory-card').forEach(c => c.classList.remove('flipped'));
        startRouletteAnimation(room, () => {
          isTransitioning = false;
          renderGameBoard(latestState || room);
          showReactionPanel();
          applyCardBackTheme(roomSettings.cardBack);
        });
      }, 2000);
    }, 500);
  });
}

function startRouletteAnimation(room, onDone) {
  const overlay = document.getElementById('overlay-roulette');
  const nameEl  = document.getElementById('roulette-name');
  overlay.classList.add('active');

  const names    = room.players.map(p => p.name);
  const winner   = room.gameState.currentTurn;
  let elapsed    = 0;
  const DURATION = 2400; // ms total spin
  let interval   = 60;   // start speed ms

  const tick = () => {
    nameEl.textContent = names[Math.floor(Math.random() * names.length)];
    elapsed += interval;
    // Slow down near the end
    if (elapsed > DURATION * 0.6) interval = 120;
    if (elapsed > DURATION * 0.85) interval = 220;

    if (elapsed >= DURATION) {
      nameEl.textContent = winner;
      nameEl.style.color = 'var(--accent-black)';
      setTimeout(() => {
        overlay.classList.remove('active');
        nameEl.style.color = '';
        if (onDone) onDone();
      }, 900);
    } else {
      setTimeout(tick, interval);
    }
  };
  tick();
}

// ── Build Card Grid ────────────────────────────────────────
function buildCardGrid(room, faceUp = false) {
  const cards    = room.gameState.cards;
  const gridEl   = document.getElementById('card-grid');
  const gridSize = roomSettings.gridSize || '6x6';
  const cols     = parseInt(gridSize.split('x')[0]);

  gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  gridEl.style.gridTemplateRows    = `repeat(${cols}, 1fr)`;

  gridEl.innerHTML = '';
  const back = roomSettings.cardBack || 'classic';
  cards.forEach((emoji, i) => {
    const card = document.createElement('div');
    card.className = 'memory-card' + (faceUp ? ' flipped' : '');
    card.setAttribute('data-index', i);
    card.innerHTML = `
      <div class="card-inner">
        <div class="card-front">${emoji}</div>
        <div class="card-back theme-${back}">✦</div>
      </div>`;
    gridEl.appendChild(card);
  });
}

function applyCardBackTheme(theme) {
  document.querySelectorAll('.card-back').forEach(el => {
    el.className = `card-back theme-${theme}`;
    el.textContent = theme === 'neon' ? 'NEON' : theme === 'cosmic' ? '✦' : '?';
  });
}

// ── Render Game Board ──────────────────────────────────────
function renderGameBoard(room) {
  if (isTransitioning) return;

  const cardGrid = document.getElementById('card-grid');
  if (cardGrid.children.length === 0) {
    buildCardGrid(room, false);
    applyCardBackTheme(roomSettings.cardBack);
  }

  const { flipped, matched, currentTurn, cards } = room.gameState;
  const isMyTurn    = currentTurn === playerName;
  const isFlipPair  = flipped.length === 2;

  clearShakeTimeout();

  // Update corner profiles
  updateCornerProfiles(room);

  // Turn HUD
  const turnDisplayName = currentTurn === playerName ? 'Siz' : currentTurn;
  document.getElementById('current-turn-name').textContent = turnDisplayName;

  // Update cards
  Array.from(cardGrid.children).forEach((cardEl, i) => {
    const isMatched = matched.includes(i);
    const isFlipped = flipped.includes(i);

    cardEl.className = 'memory-card';

    if (isMatched) {
      cardEl.classList.add('flipped', 'matched');
    } else if (isFlipped) {
      cardEl.classList.add('flipped');
      if (isFlipPair) {
        const isMatch = cards[flipped[0]] === cards[flipped[1]];
        if (isMatch) cardEl.classList.add('match-pending');
        else {
          shakeTimeout = setTimeout(() => cardEl.classList.add('shake-pending'), 700);
        }
      }
    } else {
      if (isMyTurn && !isFlipPair) cardEl.classList.add('interactable');
    }
  });

  // Cursor visibility based on mode
  updateCursorVisibility(room);
}

// ── Corner Profiles ────────────────────────────────────────
function updateCornerProfiles(room) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`game-p-${i}`);
    if (!el) continue;

    const p = room.players[i];
    if (!p) {
      el.classList.remove('visible', 'active-turn', 'inactive-turn');
      continue;
    }

    el.classList.add('visible');
    el.style.setProperty('--slot-color', SLOT_COLORS[i]);

    const isTurn = room.gameState.currentTurn === p.name;
    el.classList.toggle('active-turn',   isTurn);
    el.classList.toggle('inactive-turn', !isTurn);

    const meTag   = p.name === playerName ? ' <small>(Siz)</small>' : '';
    const comboHtml = p.combo >= 2 ? `<span class="cp-combo show">🔥x${p.combo}</span>` : '';

    el.innerHTML = `
      <div class="cp-top-row">
        <div class="cp-avatar slot-color-${i}">${p.name.charAt(0).toUpperCase()}</div>
        <div class="cp-name">${p.name}${meTag}</div>
      </div>
      <div class="cp-score">Skor: <b>${p.score}</b> ${comboHtml}</div>
    `;
  }
}

// ── Cursor Visibility ──────────────────────────────────────
function updateCursorVisibility(room) {
  const mode        = (room.settings && room.settings.cursorMode) || 'all';
  const currentTurn = room.gameState.currentTurn;

  Object.entries(remoteCursors).forEach(([name, el]) => {
    if (mode === 'active_only') {
      el.style.display = name === currentTurn ? 'block' : 'none';
    } else {
      // show all
      // visibility is already set when moved
    }
  });
}

function getPlayerSlotIndex(name, room) {
  const ps = room ? room.players : players;
  return ps.findIndex(p => p.name === name);
}

// ── Remote Cursor ──────────────────────────────────────────
function handleRemoteCursorMove(payload) {
  const { x, y, sender } = payload;
  const gameScreen = document.getElementById('screen-game');
  if (!gameScreen || !gameScreen.classList.contains('active')) return;

  let cursorEl = remoteCursors[sender];
  if (!cursorEl) {
    cursorEl = document.createElement('div');
    cursorEl.className = 'custom-cursor';
    const slotIdx = getPlayerSlotIndex(sender, latestState);
    const colorIdx = slotIdx >= 0 ? slotIdx : 1;
    cursorEl.classList.add(`cursor-color-${colorIdx}`);

    const label = document.createElement('span');
    label.className = 'cursor-label';
    label.textContent = sender;
    cursorEl.appendChild(label);

    document.body.appendChild(cursorEl);
    remoteCursors[sender] = cursorEl;
  }

  const mode = roomSettings.cursorMode;
  const currentTurn = gameState ? gameState.currentTurn : null;
  if (mode === 'active_only' && sender !== currentTurn) {
    cursorEl.style.display = 'none';
    return;
  }

  cursorEl.style.display = 'block';
  cursorEl.style.left    = `${x * window.innerWidth}px`;
  cursorEl.style.top     = `${y * window.innerHeight}px`;
}

function handleRemoteCardHover(payload) {
  document.querySelectorAll('.memory-card').forEach(c => c.classList.remove('remote-hover'));
  if (payload.index !== null && payload.index !== undefined) {
    const card = document.querySelector(`.memory-card[data-index="${payload.index}"]`);
    if (card) card.classList.add('remote-hover');
  }
}

function hideCursors() {
  const local = document.getElementById('local-cursor');
  if (local) local.style.display = 'none';
  Object.values(remoteCursors).forEach(el => {
    el.style.display = 'none';
  });
}

function clearRemoteCursors() {
  Object.values(remoteCursors).forEach(el => el.remove());
  Object.keys(remoteCursors).forEach(k => delete remoteCursors[k]);
}

// ── Emoji Reactions ────────────────────────────────────────
function handleIncomingReaction({ emoji, sender }) {
  spawnFloatingEmoji(emoji, sender);
}

function spawnFloatingEmoji(emoji, sender) {
  // Find corner profile of sender to anchor the emoji
  let anchorX = window.innerWidth / 2;
  let anchorY = window.innerHeight - 120;

  if (sender !== 'local') {
    const slotIdx = getPlayerSlotIndex(sender, latestState);
    const profileEl = document.getElementById(`game-p-${slotIdx}`);
    if (profileEl) {
      const rect = profileEl.getBoundingClientRect();
      anchorX = rect.left + rect.width / 2;
      anchorY = rect.top;
    }
  }

  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left  = `${anchorX}px`;
  el.style.top   = `${anchorY}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function showReactionPanel() {
  document.getElementById('reaction-panel').classList.add('visible');
}

function hideReactionPanel() {
  document.getElementById('reaction-panel').classList.remove('visible');
}

// ── Finish Screen ──────────────────────────────────────────
function showFinishScreen(room) {
  showScreen('screen-finish');
  hideCursors();
  hideReactionPanel();

  const playAgainBtn = document.getElementById('play-again-btn');
  if (isSinglePlayer) {
    playAgainBtn.textContent = 'Tekrar Oyna';
    playAgainBtn.disabled    = false;
  } else {
    const me = room.players.find(p => p.name === playerName);
    if (me && me.playAgain) {
      playAgainBtn.textContent = 'Bekleniyor…';
      playAgainBtn.disabled    = true;
    } else {
      playAgainBtn.textContent = 'Tekrar Oyna';
      playAgainBtn.disabled    = false;
    }
  }

  const resultArea = document.getElementById('finish-result');
  resultArea.innerHTML = '';

  // Single player finish
  if (isSinglePlayer) {
    const mins = String(Math.floor(spTimerSec / 60)).padStart(2, '0');
    const secs = String(spTimerSec % 60).padStart(2, '0');
    resultArea.innerHTML = `
      <div class="ready-player-card winner" style="text-align:center; width:100%;">
        <div class="avatar" style="margin:0 auto;">${playerName.charAt(0).toUpperCase()}</div>
        <div class="username">${playerName}</div>
        <div class="status-indicator ready">Tebrikler!</div>
        <div style="font-size:15px; color:var(--text-secondary); margin-top:4px;">
          ⏱ ${mins}:${secs} &nbsp;|&nbsp; 🃏 ${spMoves} hamle
        </div>
      </div>`;
    return;
  }

  // Multi-player finish
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const top    = sorted[0];
  const isTie  = sorted.length > 1 && sorted[0].score === sorted[1].score;

  if (isTie) {
    resultArea.innerHTML = sorted.map((p, i) => `
      <div class="ready-player-card tie">
        <div class="avatar" style="background:${SLOT_COLORS[room.players.findIndex(rp=>rp.name===p.name)]}">
          ${p.name.charAt(0).toUpperCase()}
        </div>
        <div class="username">${p.name}</div>
        <div class="status-indicator">Skor: ${p.score}</div>
        <div class="winner-banner-tag">🤝 Berabere!</div>
      </div>`).join('');
  } else {
    resultArea.innerHTML = sorted.map((p, i) => {
      const slotIdx = room.players.findIndex(rp => rp.name === p.name);
      const isWinner = i === 0;
      return `
        <div class="ready-player-card ${isWinner ? 'winner' : 'loser'}">
          <div class="avatar" style="background:${SLOT_COLORS[slotIdx]}">
            ${p.name.charAt(0).toUpperCase()}
          </div>
          <div class="username">${p.name}</div>
          <div class="status-indicator">Skor: ${p.score}</div>
          ${isWinner ? '<div class="winner-banner-tag">🏆 Kazanan!</div>' : ''}
        </div>`;
    }).join('');
  }
}

// ── Disconnect ─────────────────────────────────────────────
function showDisconnectOverlay() {
  const overlay = document.getElementById('overlay-disconnect');
  overlay.classList.add('active');
  setTimeout(() => {
    overlay.classList.remove('active');
    resetToLobby();
  }, 3000);
}

// ── Reset ──────────────────────────────────────────────────
function resetToLobby() {
  roomCode            = '';
  players             = [];
  gameState           = null;
  gameStarted         = false;
  isTransitioning     = false;
  latestState         = null;
  isHost              = false;
  isSinglePlayer      = false;
  currentlyHoveredCardIndex = null;

  clearShakeTimeout();
  stopSinglePlayerTimer();
  hideCursors();
  clearRemoteCursors();
  hideReactionPanel();

  document.getElementById('card-grid').innerHTML = '';
  document.getElementById('join-room-input').value = '';
  document.getElementById('join-error-msg').textContent = '';

  // Hide corner profiles
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`game-p-${i}`);
    if (el) el.classList.remove('visible', 'active-turn', 'inactive-turn');
  }

  // Reset HUD items
  document.getElementById('hud-timer-info').classList.add('hidden');
  document.getElementById('hud-moves-info').classList.add('hidden');
  document.getElementById('hud-turn-info').classList.remove('hidden');

  showLobby();
}

// ── Helpers ────────────────────────────────────────────────
function clearShakeTimeout() {
  if (shakeTimeout) { clearTimeout(shakeTimeout); shakeTimeout = null; }
}

function showJoinError(message) {
  const input    = document.getElementById('join-room-input');
  const errorMsg = document.getElementById('join-error-msg');
  input.classList.add('shake');
  input.style.borderColor = 'var(--red)';
  errorMsg.textContent = message;
  setTimeout(() => input.classList.remove('shake'), 300);
  setTimeout(() => { input.style.borderColor = ''; errorMsg.textContent = ''; }, 2500);
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ── Single Player Mode ─────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startSinglePlayer() {
  isSinglePlayer  = true;
  isHost          = false;
  gameStarted     = false;
  isTransitioning = true;

  // Reset sp state
  spFlipped  = [];
  spMatched  = [];
  spMoves    = 0;
  spTimerSec = 0;
  stopSinglePlayerTimer();

  // Pick grid & theme
  const gridSize   = document.getElementById('setting-grid-size') ?
    document.getElementById('setting-grid-size').value : '6x6';
  const theme      = document.getElementById('setting-theme') ?
    document.getElementById('setting-theme').value : 'mix';
  const cardBack   = document.getElementById('setting-card-back') ?
    document.getElementById('setting-card-back').value : 'classic';

  const cols      = parseInt(gridSize.split('x')[0]);
  const pairsNeeded = (cols * cols) / 2;
  const pool      = shuffle(clientEmojiPool[theme] || clientEmojiPool.mix);
  const selected  = pool.slice(0, pairsNeeded);
  spCards         = shuffle([...selected, ...selected]);

  // Build mock room object
  const mockRoom = {
    players: [{ name: playerName, score: 0, combo: 0, ready: true, playAgain: false }],
    settings: { gridSize, theme, cardBack, cursorMode: 'all', maxPlayers: 1 },
    gameState: { cards: spCards, flipped: [], matched: [], currentTurn: playerName, phase: 'playing' }
  };
  roomSettings = mockRoom.settings;

  // Countdown then show board
  const overlay   = document.getElementById('overlay-countdown');
  const countText = document.getElementById('countdown-text');
  overlay.classList.add('active');

  const runStep = (text, delay, cb) => {
    setTimeout(() => {
      countText.classList.remove('countdown-animate');
      void countText.offsetWidth;
      countText.textContent = text;
      countText.classList.add('countdown-animate');
      if (cb) cb();
    }, delay);
  };

  runStep('3', 0);
  runStep('2', 500);
  runStep('1', 1000);
  runStep('BAŞLA!', 1500, () => {
    setTimeout(() => {
      overlay.classList.remove('active');
      showScreen('screen-game');

      // Corner: just self
      for (let i = 0; i < 4; i++) {
        const el = document.getElementById(`game-p-${i}`);
        if (el) el.classList.remove('visible', 'active-turn', 'inactive-turn');
      }
      const p0 = document.getElementById('game-p-0');
      if (p0) {
        p0.classList.add('visible', 'active-turn');
        p0.style.setProperty('--slot-color', SLOT_COLORS[0]);
        p0.innerHTML = `
          <div class="cp-top-row">
            <div class="cp-avatar slot-color-0">${playerName.charAt(0).toUpperCase()}</div>
            <div class="cp-name">${playerName} (Siz)</div>
          </div>
          <div class="cp-score">Skor: <b id="sp-score-val">0</b></div>`;
      }

      // HUD: show timer & moves, hide turn indicator
      document.getElementById('hud-turn-info').classList.add('hidden');
      document.getElementById('hud-timer-info').classList.remove('hidden');
      document.getElementById('hud-moves-info').classList.remove('hidden');

      // Build grid (face-up preview)
      const gridEl = document.getElementById('card-grid');
      gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      gridEl.style.gridTemplateRows    = `repeat(${cols}, 1fr)`;
      gridEl.innerHTML = '';
      spCards.forEach((emoji, i) => {
        const card = document.createElement('div');
        card.className = 'memory-card flipped';
        card.setAttribute('data-index', i);
        card.innerHTML = `
          <div class="card-inner">
            <div class="card-front">${emoji}</div>
            <div class="card-back theme-${cardBack}">✦</div>
          </div>`;
        gridEl.appendChild(card);
      });

      // Close after 2s
      setTimeout(() => {
        document.querySelectorAll('.memory-card').forEach(c => c.classList.remove('flipped'));
        isTransitioning = false;
        gameStarted     = true;
        showReactionPanel();
        startSinglePlayerTimer();
      }, 2000);
    }, 500);
  });
}

function handleSinglePlayerFlip(index) {
  if (isTransitioning) return;
  if (spMatched.includes(index) || spFlipped.includes(index)) return;
  if (spFlipped.length >= 2) return;

  spFlipped.push(index);
  spMoves++;
  document.getElementById('single-moves').textContent = spMoves;

  const card = document.querySelector(`.memory-card[data-index="${index}"]`);
  if (card) card.classList.add('flipped');

  if (spFlipped.length === 2) {
    isTransitioning = true;
    const [i1, i2]  = spFlipped;

    if (spCards[i1] === spCards[i2]) {
      // Match
      setTimeout(() => {
        const c1 = document.querySelector(`.memory-card[data-index="${i1}"]`);
        const c2 = document.querySelector(`.memory-card[data-index="${i2}"]`);
        if (c1) c1.classList.add('matched');
        if (c2) c2.classList.add('matched');
        spMatched.push(i1, i2);
        spFlipped = [];
        isTransitioning = false;

        // Update score
        const scoreEl = document.getElementById('sp-score-val');
        if (scoreEl) scoreEl.textContent = Math.floor(spMatched.length / 2);

        if (spMatched.length === spCards.length) {
          stopSinglePlayerTimer();
          setTimeout(() => {
            showFinishScreen({
              players: [{ name: playerName, score: Math.floor(spMatched.length / 2), combo: 0, ready: true, playAgain: false }],
              settings: roomSettings,
              gameState: { phase: 'finished' }
            });
          }, 600);
        }
      }, 500);
    } else {
      // Mismatch
      setTimeout(() => {
        const c1 = document.querySelector(`.memory-card[data-index="${i1}"]`);
        const c2 = document.querySelector(`.memory-card[data-index="${i2}"]`);
        if (c1) { c1.classList.add('shake-pending'); setTimeout(() => c1.classList.remove('flipped','shake-pending'), 400); }
        if (c2) { c2.classList.add('shake-pending'); setTimeout(() => c2.classList.remove('flipped','shake-pending'), 400); }
        spFlipped = [];
        isTransitioning = false;
      }, 900);
    }
  }
}

function startSinglePlayerTimer() {
  spTimerHandle = setInterval(() => {
    spTimerSec++;
    const mins = String(Math.floor(spTimerSec / 60)).padStart(2, '0');
    const secs = String(spTimerSec % 60).padStart(2, '0');
    const el = document.getElementById('single-timer');
    if (el) el.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopSinglePlayerTimer() {
  if (spTimerHandle) { clearInterval(spTimerHandle); spTimerHandle = null; }
}
