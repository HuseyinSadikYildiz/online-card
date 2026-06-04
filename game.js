// WebSocket Connection
const socketUrl = 'ws://' + (window.location.hostname || 'localhost') + ':8080';
let socket;

let playerName = '';
let roomCode = '';
let players = [];
let gameState = null;

let gameStarted = false;
let isTransitioning = false;
let latestState = null;
let shakeTimeout = null;

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  setupEventListeners();
  checkSavedName();
});

function connectWebSocket() {
  socket = new WebSocket(socketUrl);

  socket.onopen = () => {
    console.log('Connected to WebSocket server');
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const { type, payload } = data;

      switch (type) {
        case 'room_state':
          handleRoomState(payload);
          break;
        case 'join_error':
          showJoinError(payload.message);
          break;
        case 'opponent_disconnected':
          showDisconnectOverlay();
          break;
        case 'opponent_left':
          showToast('Rakip odadan ayrıldı');
          setTimeout(() => {
            resetToLobby();
          }, 2000);
          break;
        case 'opponent_mouse_move':
          handleOpponentMouseMove(payload);
          break;
        case 'opponent_card_hover':
          handleOpponentCardHover(payload);
          break;
        default:
          console.log('Unknown message type:', type);
      }
    } catch (err) {
      console.error('Error parsing WS message:', err);
    }
  };

  socket.onclose = () => {
    console.log('Disconnected from WebSocket server. Reconnecting in 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

function sendMsg(type, payload = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
  }
}

// Helpers
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const activeScreen = document.getElementById(screenId);
  if (activeScreen) {
    activeScreen.classList.add('active');
  }
}

function checkSavedName() {
  const savedName = localStorage.getItem('memory_game_username');
  if (savedName) {
    playerName = savedName;
    showLobby();
  } else {
    showScreen('screen-login');
  }
}

function showLobby() {
  document.getElementById('lobby-username').textContent = playerName;
  document.getElementById('lobby-avatar').textContent = playerName.charAt(0).toUpperCase();
  showScreen('screen-lobby');
}

function setupEventListeners() {
  // Login Screen
  const loginBtn = document.getElementById('login-btn');
  const usernameInput = document.getElementById('username-input');

  const handleLoginSubmit = () => {
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

  loginBtn.addEventListener('click', handleLoginSubmit);
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLoginSubmit();
  });

  // Lobby: Create Room
  document.getElementById('create-room-btn').addEventListener('click', () => {
    sendMsg('create_room', { name: playerName });
  });

  // Lobby: Join Room
  const joinBtn = document.getElementById('join-room-btn');
  const joinInput = document.getElementById('join-room-input');

  const handleJoinSubmit = () => {
    const code = joinInput.value.trim().toUpperCase();
    if (code.length === 6) {
      sendMsg('join_room', { name: playerName, code });
    } else {
      showJoinError('6 haneli kod giriniz');
    }
  };

  joinBtn.addEventListener('click', handleJoinSubmit);
  joinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleJoinSubmit();
  });

  // Copy Code
  document.getElementById('copy-code-btn').addEventListener('click', () => {
    const codeText = document.getElementById('room-code-text').textContent;
    navigator.clipboard.writeText(codeText).then(() => {
      showToast('Oda kodu kopyalandı!');
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  });

  // Ready Screen Actions
  const readyBtnP1 = document.querySelector('#ready-p1 .ready-action-btn');
  readyBtnP1.addEventListener('click', () => {
    sendMsg('set_ready', { ready: true });
  });

  // Game Grid (Event Delegation)
  document.getElementById('card-grid').addEventListener('click', (e) => {
    if (isTransitioning) return;

    const cardEl = e.target.closest('.memory-card');
    if (!cardEl) return;

    // Check if card is interactable (face down, active turn)
    if (!cardEl.classList.contains('interactable')) return;

    const index = cardEl.getAttribute('data-index');
    if (index !== null) {
      sendMsg('flip_card', { index: parseInt(index) });
    }
  });

  // Finish screen: Play Again
  const playAgainBtn = document.getElementById('play-again-btn');
  playAgainBtn.addEventListener('click', () => {
    sendMsg('play_again');
    playAgainBtn.textContent = 'Bekleniyor...';
    playAgainBtn.disabled = true;
  });

  // Finish screen: Exit
  document.getElementById('exit-btn').addEventListener('click', () => {
    sendMsg('leave_room');
    resetToLobby();
  });

  // Custom mouse tracking
  const cursorSelf = document.getElementById('cursor-self');
  let lastMouseMoveTime = 0;
  const throttleLimit = 50;

  window.addEventListener('mousemove', (e) => {
    cursorSelf.style.display = 'block';
    cursorSelf.style.left = e.clientX + 'px';
    cursorSelf.style.top = e.clientY + 'px';

    // Throttle mouse moves to server
    const now = Date.now();
    if (now - lastMouseMoveTime > throttleLimit) {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      sendMsg('mouse_move', { x, y });
      lastMouseMoveTime = now;
    }
  });

  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) {
      cursorSelf.style.display = 'none';
    }
  });

  // Card hover tracking using mousemove on grid
  const cardGrid = document.getElementById('card-grid');
  let currentlyHoveredIndex = null;

  cardGrid.addEventListener('mousemove', (e) => {
    const cardEl = e.target.closest('.memory-card');
    if (cardEl && cardEl.classList.contains('interactable')) {
      const index = parseInt(cardEl.getAttribute('data-index'));
      if (currentlyHoveredIndex !== index) {
        if (currentlyHoveredIndex !== null) {
          const prevEl = cardGrid.children[currentlyHoveredIndex];
          if (prevEl) prevEl.classList.remove('self-hovered');
        }
        cardEl.classList.add('self-hovered');
        currentlyHoveredIndex = index;
        sendMsg('card_hover', { index });
      }
    } else {
      if (currentlyHoveredIndex !== null) {
        const prevEl = cardGrid.children[currentlyHoveredIndex];
        if (prevEl) prevEl.classList.remove('self-hovered');
        currentlyHoveredIndex = null;
        sendMsg('card_hover', { index: null });
      }
    }
  });

  cardGrid.addEventListener('mouseleave', () => {
    if (currentlyHoveredIndex !== null) {
      const prevEl = cardGrid.children[currentlyHoveredIndex];
      if (prevEl) prevEl.classList.remove('self-hovered');
      currentlyHoveredIndex = null;
      sendMsg('card_hover', { index: null });
    }
  });
}

function showJoinError(message) {
  const joinInput = document.getElementById('join-room-input');
  const errorMsg = document.getElementById('join-error-msg');

  joinInput.classList.add('shake');
  joinInput.style.borderColor = 'var(--red)';
  errorMsg.textContent = message;

  setTimeout(() => {
    joinInput.classList.remove('shake');
  }, 300);

  setTimeout(() => {
    joinInput.style.borderColor = '';
    errorMsg.textContent = '';
  }, 2000);
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  // Slide-out after 2 seconds
  setTimeout(() => {
    toast.classList.add('hide');
    // Remove from DOM after slide-out finishes
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2000);
}

// Room State Router
function handleRoomState(room) {
  roomCode = room.code;
  players = room.players;
  gameState = room.gameState;
  latestState = room;

  const phase = gameState.phase;

  // 1. Code modal display state
  const modalCode = document.getElementById('modal-code');
  if (phase === 'waiting' && players.length === 1 && players[0].name === playerName) {
    document.getElementById('room-code-text').textContent = roomCode;
    modalCode.classList.add('active');
  } else {
    modalCode.classList.remove('active');
  }

  // Phase Router
  if (phase === 'waiting' || phase === 'ready') {
    // Reset playing state flags
    gameStarted = false;
    isTransitioning = false;
    if (shakeTimeout) {
      clearTimeout(shakeTimeout);
      shakeTimeout = null;
    }

    if (phase === 'ready') {
      showReadyScreen(room);
    } else {
      showScreen('screen-lobby');
    }
  } else if (phase === 'playing') {
    if (!gameStarted) {
      triggerCountdownSequence(room);
    } else {
      if (!isTransitioning) {
        renderGameBoard(room);
      }
    }
  } else if (phase === 'finished') {
    showFinishScreen(room);
  }
}

// Ready Screen Details
function showReadyScreen(room) {
  showScreen('screen-ready');

  const selfPlayer = room.players.find(p => p.name === playerName);
  const oppPlayer = room.players.find(p => p.name !== playerName);

  // Self Player (Left Card)
  const readyP1 = document.getElementById('ready-p1');
  readyP1.querySelector('.avatar').textContent = playerName.charAt(0).toUpperCase();
  readyP1.querySelector('.username').textContent = playerName;

  const statusP1 = readyP1.querySelector('.status-indicator');
  const btnP1 = readyP1.querySelector('.ready-action-btn');

  if (selfPlayer.ready) {
    statusP1.textContent = 'Hazır ✓';
    statusP1.classList.add('ready');
    btnP1.textContent = 'Bekleniyor...';
    btnP1.disabled = true;
  } else {
    statusP1.textContent = 'Hazır Değil';
    statusP1.classList.remove('ready');
    btnP1.textContent = 'Hazır';
    btnP1.disabled = false;
  }

  // Opponent Player (Right Card)
  const readyP2 = document.getElementById('ready-p2');
  const statusP2 = readyP2.querySelector('.status-indicator');
  const btnP2 = readyP2.querySelector('.ready-action-btn');

  if (oppPlayer) {
    readyP2.querySelector('.avatar').textContent = oppPlayer.name.charAt(0).toUpperCase();
    readyP2.querySelector('.username').textContent = oppPlayer.name;

    if (oppPlayer.ready) {
      statusP2.textContent = 'Hazır ✓';
      statusP2.classList.add('ready');
    } else {
      statusP2.textContent = 'Hazır Değil';
      statusP2.classList.remove('ready');
    }
    btnP2.textContent = oppPlayer.ready ? 'Hazır' : 'Bekleniyor...';
  } else {
    readyP2.querySelector('.avatar').textContent = '?';
    readyP2.querySelector('.username').textContent = 'Rakip Bekleniyor';
    statusP2.textContent = 'Bağlanıyor...';
    statusP2.classList.remove('ready');
    btnP2.textContent = 'Bekleniyor...';
  }
}

// Countdown sequence
function triggerCountdownSequence(room) {
  gameStarted = true;
  isTransitioning = true;

  const overlay = document.getElementById('overlay-countdown');
  const countText = document.getElementById('countdown-text');

  overlay.classList.add('active');

  // Helper for text animations
  const runStep = (text, delay, callback) => {
    setTimeout(() => {
      countText.classList.remove('countdown-animate');
      // trigger reflow
      void countText.offsetWidth;
      countText.textContent = text;
      countText.classList.add('countdown-animate');
      if (callback) callback();
    }, delay);
  };

  // Run countdown steps: 3 -> 2 -> 1 -> BAŞLA!
  runStep('3', 0);
  runStep('2', 500);
  runStep('1', 1000);
  runStep('BAŞLA!', 1500, () => {
    // 0.5s after BAŞLA!, transition to game screen
    setTimeout(() => {
      overlay.classList.remove('active');
      showScreen('screen-game');

      // Initialize grid with all cards open for preview
      const cardGrid = document.getElementById('card-grid');
      cardGrid.innerHTML = '';

      for (let i = 0; i < 36; i++) {
        const cardEl = document.createElement('div');
        cardEl.className = 'memory-card flipped'; // show face-up initially
        cardEl.setAttribute('data-index', i);
        cardEl.innerHTML = `
          <div class="card-inner">
            <div class="card-front">${room.gameState.cards[i]}</div>
            <div class="card-back">?</div>
          </div>
        `;
        cardGrid.appendChild(cardEl);
      }

      // Preview open for 2 seconds
      setTimeout(() => {
        // Close all cards
        document.querySelectorAll('.memory-card').forEach(c => c.classList.remove('flipped'));

        // Start starting turn overlay selection
        const turnOverlay = document.getElementById('overlay-turn-start');
        const turnText = document.getElementById('turn-start-text');
        turnOverlay.classList.add('active');
        turnText.textContent = 'Başlayan seçiliyor...';

        // 1s starting player selected
        setTimeout(() => {
          const startingName = room.gameState.currentTurn;
          const displayStarterName = startingName === playerName ? 'Siz' : startingName;
          turnText.textContent = `${displayStarterName} başlıyor!`;

          // 0.8s hide turn selection overlay, start actual interactive game
          setTimeout(() => {
            turnOverlay.classList.remove('active');
            isTransitioning = false;

            // Render final synced game state
            renderGameBoard(latestState || room);
          }, 800);
        }, 1000);

      }, 2000);

    }, 500);
  });
}

// Render gameplay screen state
function renderGameBoard(room) {
  if (isTransitioning) return;

  const cardGrid = document.getElementById('card-grid');
  
  // Make sure grid card elements are initialized
  if (cardGrid.children.length === 0) {
    cardGrid.innerHTML = '';
    for (let i = 0; i < 36; i++) {
      const cardEl = document.createElement('div');
      cardEl.className = 'memory-card';
      cardEl.setAttribute('data-index', i);
      cardEl.innerHTML = `
        <div class="card-inner">
          <div class="card-front">${room.gameState.cards[i]}</div>
          <div class="card-back">?</div>
        </div>
      `;
      cardGrid.appendChild(cardEl);
    }
  }

  // Resolve players
  const selfPlayer = room.players.find(p => p.name === playerName);
  const oppPlayer = room.players.find(p => p.name !== playerName);

  // Update headers (Scores, Combos, Highlights)
  const selfProfile = document.getElementById('game-p-self');
  const oppProfile = document.getElementById('game-p-opp');

  if (selfPlayer) {
    selfProfile.querySelector('.avatar').textContent = playerName.charAt(0).toUpperCase();
    selfProfile.querySelector('.mini-name').textContent = playerName + ' (Siz)';
    selfProfile.querySelector('.score-val').textContent = selfPlayer.score;
    const badge = selfProfile.querySelector('.combo-badge');
    if (selfPlayer.combo >= 2) {
      badge.textContent = `🔥x${selfPlayer.combo}`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  if (oppPlayer) {
    oppProfile.querySelector('.avatar').textContent = oppPlayer.name.charAt(0).toUpperCase();
    oppProfile.querySelector('.mini-name').textContent = oppPlayer.name;
    oppProfile.querySelector('.score-val').textContent = oppPlayer.score;
    const badge = oppProfile.querySelector('.combo-badge');
    if (oppPlayer.combo >= 2) {
      badge.textContent = `🔥x${oppPlayer.combo}`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // Current turn name
  const isMyTurn = room.gameState.currentTurn === playerName;
  document.getElementById('current-turn-name').textContent = isMyTurn ? 'Siz' : (oppPlayer ? oppPlayer.name : 'Rakip');

  // Glowing profiles
  if (isMyTurn) {
    selfProfile.classList.add('active');
    selfProfile.classList.remove('inactive');
    if (oppPlayer) {
      oppProfile.classList.add('inactive');
      oppProfile.classList.remove('active');
    }
  } else {
    selfProfile.classList.add('inactive');
    selfProfile.classList.remove('active');
    if (oppPlayer) {
      oppProfile.classList.add('active');
      oppProfile.classList.remove('inactive');
    }
  }

  // Update cards
  const cards = cardGrid.children;
  const flipped = room.gameState.flipped;
  const matched = room.gameState.matched;
  const isFlippedPair = flipped.length === 2;

  // Cancel any existing shake timeout
  if (shakeTimeout) {
    clearTimeout(shakeTimeout);
    shakeTimeout = null;
  }

  for (let i = 0; i < 36; i++) {
    const cardEl = cards[i];
    if (!cardEl) continue;

    const isCardMatched = matched.includes(i);
    const isCardFlipped = flipped.includes(i);

    // Reset base classes
    cardEl.className = 'memory-card';

    if (isCardMatched) {
      cardEl.classList.add('flipped', 'matched');
    } else if (isCardFlipped) {
      cardEl.classList.add('flipped');
      // If we have 2 cards flipped, check match logic for styling
      if (isFlippedPair) {
        const idx1 = flipped[0];
        const idx2 = flipped[1];
        const isMatch = room.gameState.cards[idx1] === room.gameState.cards[idx2];
        if (isMatch) {
          cardEl.classList.add('match-pending');
        } else {
          // Delayed shake for unmatched cards
          shakeTimeout = setTimeout(() => {
            cardEl.classList.add('shake-pending');
          }, 700);
        }
      }
    } else {
      // Face-down card: is interactable only if my turn AND fewer than 2 cards are flipped
      if (isMyTurn && !isFlippedPair) {
        cardEl.classList.add('interactable');
      }
    }
  }
}

// Finished Screen
function showFinishScreen(room) {
  showScreen('screen-finish');

  // Reset play again button ready state
  const playAgainBtn = document.getElementById('play-again-btn');
  const selfPlayer = room.players.find(p => p.name === playerName);
  if (selfPlayer && selfPlayer.playAgain) {
    playAgainBtn.textContent = 'Bekleniyor...';
    playAgainBtn.disabled = true;
  } else {
    playAgainBtn.textContent = 'Tekrar Oyna';
    playAgainBtn.disabled = false;
  }

  const resultArea = document.getElementById('finish-result');
  resultArea.innerHTML = '';

  const p1 = room.players[0];
  const p2 = room.players[1];

  if (!p2) {
    // If opponent disconnected or left during finished screen
    resultArea.innerHTML = `
      <div class="ready-player-card winner">
        <div class="avatar">${p1.name.charAt(0).toUpperCase()}</div>
        <div class="username">${p1.name}</div>
        <div class="status-indicator">Skor: ${p1.score}</div>
        <div class="winner-banner-tag">🏆 Kazanan!</div>
      </div>
    `;
    return;
  }

  if (p1.score === p2.score) {
    // Tie
    resultArea.innerHTML = `
      <div class="ready-player-card tie">
        <div class="avatar">${p1.name.charAt(0).toUpperCase()}</div>
        <div class="username">${p1.name}</div>
        <div class="status-indicator">Skor: ${p1.score}</div>
        <div class="winner-banner-tag">🤝 Berabere!</div>
      </div>
      <div class="ready-player-card tie">
        <div class="avatar">${p2.name.charAt(0).toUpperCase()}</div>
        <div class="username">${p2.name}</div>
        <div class="status-indicator">Skor: ${p2.score}</div>
        <div class="winner-banner-tag">🤝 Berabere!</div>
      </div>
    `;
  } else {
    const winner = p1.score > p2.score ? p1 : p2;
    const loser = p1.score > p2.score ? p2 : p1;

    resultArea.innerHTML = `
      <div class="ready-player-card winner">
        <div class="avatar">${winner.name.charAt(0).toUpperCase()}</div>
        <div class="username">${winner.name}</div>
        <div class="status-indicator">Skor: ${winner.score}</div>
        <div class="winner-banner-tag">🏆 Kazanan!</div>
      </div>
      <div class="ready-player-card loser">
        <div class="avatar">${loser.name.charAt(0).toUpperCase()}</div>
        <div class="username">${loser.name}</div>
        <div class="status-indicator">Skor: ${loser.score}</div>
      </div>
    `;
  }
}

// Disconnection overlays
function showDisconnectOverlay() {
  const overlay = document.getElementById('overlay-disconnect');
  overlay.classList.add('active');
  setTimeout(() => {
    overlay.classList.remove('active');
    resetToLobby();
  }, 3000);
}

function resetToLobby() {
  roomCode = '';
  players = [];
  gameState = null;
  gameStarted = false;
  isTransitioning = false;
  latestState = null;
  
  if (shakeTimeout) {
    clearTimeout(shakeTimeout);
    shakeTimeout = null;
  }

  // Clear card grid cache
  document.getElementById('card-grid').innerHTML = '';

  // Reset modal inputs
  document.getElementById('join-room-input').value = '';
  document.getElementById('join-error-msg').textContent = '';

  const cursorOpp = document.getElementById('cursor-opp');
  if (cursorOpp) cursorOpp.style.display = 'none';

  // Return to lobby
  showLobby();
}

function handleOpponentMouseMove(payload) {
  const cursorOpp = document.getElementById('cursor-opp');
  if (cursorOpp) {
    cursorOpp.style.display = 'block';
    cursorOpp.style.left = (payload.x * window.innerWidth) + 'px';
    cursorOpp.style.top = (payload.y * window.innerHeight) + 'px';
  }
}

function handleOpponentCardHover(payload) {
  const cardGrid = document.getElementById('card-grid');
  if (!cardGrid) return;
  
  // Remove opponent-hovered from all cards
  Array.from(cardGrid.children).forEach(cardEl => {
    cardEl.classList.remove('opponent-hovered');
  });

  // Add to target card
  if (payload.index !== null && payload.index !== undefined) {
    const targetCard = cardGrid.children[payload.index];
    if (targetCard) {
      targetCard.classList.add('opponent-hovered');
    }
  }
}
