const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 8080 });
console.log('WebSocket server is running on ws://localhost:8080');

const rooms = new Map();

const emojiPool = {
  animals: ['🐶', '🐱', '🦊', '🐻', '🐼', '🦁', '🐯', '🦋', '🐸', '🦄', '🐷', '🐨', '🐰', '🐙', '🐒', '🐔', '🐧', '🐦', '🐣', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🐝', '🐛', '🐌', '🐞', '🐢', '🐠'],
  nature: ['🌸', '🌊', '⚡', '🔥', '🌙', '⭐', '🌈', '🍀', '☀️', '☁️', '❄️', '🍁', '🍂', '🍃', '🎋', '🌵', '🎄', '🌲', '🌳', '🌴', '🌻', '🌹', '🌷', '🌼', '🌾', '🌿', '🍄', '🌕', '☄️', '🌋', '🏔️', '🏝️'],
  food: ['🍕', '🍔', '🍣', '🍩', '🍦', '🎂', '🍓', '🍉', '🍎', '🍌', '🍒', '🍇', '🍍', '🍑', '🍈', '🍊', '🍟', '🌭', '🍿', '🍪', '🍫', '🍬', '🍭', '🍯', '🍰', '🥞', '🍳', '🧇', '🥗', '🌮', '🍜', '🥤'],
  objects: ['🎮', '🎸', '🚀', '💎', '🎯', '🏆', '🎪', '🎭', '🎈', '🎁', '🔔', '🔑', '📦', '📖', '✏️', '📐', '🔍', '💡', '⏰', '🛠️', '⚔️', '🛡️', '⚙️', '🧪', '📡', '🔋', '📸', '🎨', '🛹', '⚽', '🏀', '🚗'],
  symbols: ['♟️', '🎲', '🧩', '🎴', '🃏', '🔮', '🎱', '🎰', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '🌟', '💢', '🌀', '💤', '🌐', '💠', '🔱', '🔲', '🔳', '🔴', '🔵', '🟡', '🟢', '🟣', '🟠']
};

function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function initGame(room) {
  let pool = [];
  const theme = room.settings.theme;
  if (theme === 'mix') {
    pool = [
      ...emojiPool.animals,
      ...emojiPool.nature,
      ...emojiPool.food,
      ...emojiPool.objects,
      ...emojiPool.symbols
    ];
  } else {
    pool = emojiPool[theme] || emojiPool.animals;
  }
  
  // Determine card pairs needed
  let pairsCount = 18; // Default 6x6
  const gridSize = room.settings.gridSize;
  if (gridSize === '4x4') {
    pairsCount = 8;
  } else if (gridSize === '8x8') {
    pairsCount = 32;
  }

  // Pick unique emojis from pool
  const shuffledPool = shuffle(pool);
  const selectedEmojis = shuffledPool.slice(0, pairsCount);
  
  // Duplicate and shuffle
  const gameCards = shuffle([...selectedEmojis, ...selectedEmojis]);
  
  // Determine starting player
  const startingPlayer = room.players[Math.floor(Math.random() * room.players.length)].name;
  
  room.gameState = {
    cards: gameCards,
    flipped: [],
    matched: [],
    currentTurn: startingPlayer,
    phase: 'playing'
  };

  // Reset scores and combos
  room.players.forEach(p => {
    p.score = 0;
    p.combo = 0;
    p.playAgain = false;
  });
}

function broadcastRoomState(room) {
  const state = {
    id: room.id,
    code: room.code,
    players: room.players.map(p => ({
      name: p.name,
      score: p.score,
      combo: p.combo,
      ready: p.ready,
      playAgain: p.playAgain
    })),
    settings: room.settings,
    gameState: room.gameState
  };

  const message = JSON.stringify({
    type: 'room_state',
    payload: state
  });

  room.players.forEach(p => {
    if (p.ws.readyState === 1) { // OPEN
      p.ws.send(message);
    }
  });
}

function sendToClient(ws, type, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', (messageStr) => {
    try {
      const message = JSON.parse(messageStr);
      const { type, payload } = message;

      switch (type) {
        case 'create_room': {
          const { name } = payload;
          const code = generateRoomCode();
          const room = {
            id: Math.random().toString(36).slice(2, 9),
            code: code,
            players: [
              {
                ws: ws,
                name: name,
                score: 0,
                combo: 0,
                ready: false,
                playAgain: false
              }
            ],
            settings: {
              maxPlayers: 2,
              gridSize: '6x6',
              theme: 'mix',
              cardBack: 'classic',
              cursorMode: 'all'
            },
            gameState: {
              cards: [],
              flipped: [],
              matched: [],
              currentTurn: '',
              phase: 'waiting'
            }
          };
          rooms.set(code, room);
          ws.roomCode = code;
          ws.playerName = name;
          broadcastRoomState(room);
          break;
        }

        case 'update_settings': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;
          // Only host (first player in list) can update settings
          if (room.players[0] && room.players[0].ws === ws) {
            room.settings = {
              ...room.settings,
              ...payload
            };
            broadcastRoomState(room);
          }
          break;
        }

        case 'join_room': {
          const { name, code } = payload;
          const upperCode = code ? code.trim().toUpperCase() : '';
          const room = rooms.get(upperCode);

          if (!room) {
            sendToClient(ws, 'join_error', { message: 'Geçersiz kod' });
            return;
          }
          if (room.players.length >= room.settings.maxPlayers) {
            sendToClient(ws, 'join_error', { message: 'Oda dolu' });
            return;
          }
          if (room.gameState.phase === 'playing') {
            sendToClient(ws, 'join_error', { message: 'Oyun devam ediyor' });
            return;
          }

          // Add player
          room.players.push({
            ws: ws,
            name: name,
            score: 0,
            combo: 0,
            ready: false,
            playAgain: false
          });

          ws.roomCode = upperCode;
          ws.playerName = name;

          // Once players join, change phase to 'ready'
          room.gameState.phase = 'ready';
          broadcastRoomState(room);
          break;
        }

        case 'set_ready': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;

          const player = room.players.find(p => p.ws === ws);
          if (player) {
            player.ready = payload.ready;
          }

          // Auto-start if all joined players are ready AND room is full
          const allReady = room.players.length >= 2 && room.players.every(p => p.ready);
          const roomFull = room.players.length === room.settings.maxPlayers;
          if (allReady && roomFull) {
            initGame(room);
          }

          broadcastRoomState(room);
          break;
        }

        case 'start_game': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;
          
          const isHost = room.players[0] && room.players[0].ws === ws;
          const allReady = room.players.length >= 2 && room.players.every(p => p.ready);
          if (isHost && allReady) {
            initGame(room);
            broadcastRoomState(room);
          }
          break;
        }

        case 'flip_card': {
          const room = rooms.get(ws.roomCode);
          if (!room || room.gameState.phase !== 'playing') return;

          // Check turn
          if (room.gameState.currentTurn !== ws.playerName) return;

          // Ignore if 2 cards already flipped
          if (room.gameState.flipped.length >= 2) return;

          const index = parseInt(payload.index);
          const cardCount = room.gameState.cards.length;
          if (isNaN(index) || index < 0 || index >= cardCount) return;

          // Ignore if already matched or already flipped
          if (room.gameState.matched.includes(index) || room.gameState.flipped.includes(index)) {
            return;
          }

          room.gameState.flipped.push(index);
          broadcastRoomState(room);

          // Evaluate match if 2 cards are flipped
          if (room.gameState.flipped.length === 2) {
            const idx1 = room.gameState.flipped[0];
            const idx2 = room.gameState.flipped[1];
            const card1 = room.gameState.cards[idx1];
            const card2 = room.gameState.cards[idx2];

            const activePlayer = room.players.find(p => p.name === room.gameState.currentTurn);

            if (card1 === card2) {
              // MATCH - 0.5s delay
              setTimeout(() => {
                const currentRoom = rooms.get(ws.roomCode);
                if (!currentRoom || currentRoom.gameState.phase !== 'playing') return;

                if (currentRoom.gameState.flipped.includes(idx1) && currentRoom.gameState.flipped.includes(idx2)) {
                  currentRoom.gameState.matched.push(idx1, idx2);
                  currentRoom.gameState.flipped = [];

                  if (activePlayer) {
                    activePlayer.score += 1;
                    activePlayer.combo += 1;
                  }

                  // Check if game over
                  if (currentRoom.gameState.matched.length === currentRoom.gameState.cards.length) {
                    currentRoom.gameState.phase = 'finished';
                  }

                  broadcastRoomState(currentRoom);
                }
              }, 500);
            } else {
              // MISMATCH - 1.0s delay
              setTimeout(() => {
                const currentRoom = rooms.get(ws.roomCode);
                if (!currentRoom || currentRoom.gameState.phase !== 'playing') return;

                if (currentRoom.gameState.flipped.includes(idx1) && currentRoom.gameState.flipped.includes(idx2)) {
                  currentRoom.gameState.flipped = [];

                  if (activePlayer) {
                    activePlayer.combo = 0;
                  }

                  // Cycle turn to next player in room
                  const currentIdx = currentRoom.players.findIndex(p => p.name === currentRoom.gameState.currentTurn);
                  const nextIdx = (currentIdx + 1) % currentRoom.players.length;
                  currentRoom.gameState.currentTurn = currentRoom.players[nextIdx].name;

                  broadcastRoomState(currentRoom);
                }
              }, 1000);
            }
          }
          break;
        }

        case 'play_again': {
          const room = rooms.get(ws.roomCode);
          if (!room || room.gameState.phase !== 'finished') return;

          const player = room.players.find(p => p.ws === ws);
          if (player) {
            player.playAgain = true;
          }

          const allPlayAgain = room.players.every(p => p.playAgain);

          if (allPlayAgain) {
            room.players.forEach(p => {
              p.score = 0;
              p.combo = 0;
              p.ready = false;
              p.playAgain = false;
            });
            room.gameState.phase = 'ready';
            room.gameState.cards = [];
            room.gameState.flipped = [];
            room.gameState.matched = [];
            room.gameState.currentTurn = '';
          }

          broadcastRoomState(room);
          break;
        }

        case 'leave_room': {
          handleLeave(ws);
          break;
        }

        case 'cursor_move': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;
          room.players.forEach(p => {
            if (p.ws !== ws) {
              sendToClient(p.ws, 'cursor_move', {
                x: payload.x,
                y: payload.y,
                sender: ws.playerName
              });
            }
          });
          break;
        }

        case 'card_hover': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;
          room.players.forEach(p => {
            if (p.ws !== ws) {
              sendToClient(p.ws, 'card_hover', {
                index: payload.index,
                sender: ws.playerName
              });
            }
          });
          break;
        }

        case 'send_reaction': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;
          room.players.forEach(p => {
            if (p.ws !== ws) {
              sendToClient(p.ws, 'receive_reaction', {
                emoji: payload.emoji,
                sender: ws.playerName
              });
            }
          });
          break;
        }

        default:
          console.log('Unhandled message type:', type);
      }
    } catch (err) {
      console.error('Error handling websocket message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    handleLeave(ws, true);
  });
});

function handleLeave(ws, isDisconnect = false) {
  const code = ws.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) return;

  // Find index of leaving player
  const leaveIdx = room.players.findIndex(p => p.ws === ws);
  if (leaveIdx !== -1) {
    room.players.splice(leaveIdx, 1);
  }

  // Clean up leaving player's link
  ws.roomCode = null;

  if (room.players.length === 0) {
    // Clear room if no players left
    rooms.delete(code);
  } else {
    // If game was playing and leaving player made active players < 2, finish game
    if (room.gameState.phase === 'playing' && room.players.length < 2) {
      room.gameState.phase = 'finished';
      broadcastRoomState(room);
    } else {
      // If it was the leaving player's turn, change turn
      if (room.gameState.phase === 'playing' && room.gameState.currentTurn === ws.playerName) {
        const nextIdx = leaveIdx % room.players.length;
        room.gameState.currentTurn = room.players[nextIdx].name;
      }
      // Notify remaining players
      room.players.forEach(p => {
        sendToClient(p.ws, 'player_left', { name: ws.playerName });
      });
      broadcastRoomState(room);
    }
  }
}
