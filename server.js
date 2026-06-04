const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 8080 });
console.log('WebSocket server is running on ws://localhost:8080');

const rooms = new Map();

const emojiPool = {
  animals: ['🐶', '🐱', '🦊', '🐻', '🐼', '🦁', '🐯', '🦋', '🐸', '🦄'],
  nature: ['🌸', '🌊', '⚡', '🔥', '🌙', '⭐', '🌈', '🍀'],
  food: ['🍕', '🍔', '🍣', '🍩', '🍦', '🎂', '🍓', '🍉'],
  objects: ['🎮', '🎸', '🚀', '💎', '🎯', '🏆', '🎪', '🎭'],
  symbols: ['♟️', '🎲', '🧩', '🎴', '🃏', '🔮', '🎱', '🎰']
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
  const allEmojis = [
    ...emojiPool.animals,
    ...emojiPool.nature,
    ...emojiPool.food,
    ...emojiPool.objects,
    ...emojiPool.symbols
  ];
  
  // Pick 18 unique emojis
  const shuffledPool = shuffle(allEmojis);
  const selectedEmojis = shuffledPool.slice(0, 18);
  
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

        case 'join_room': {
          const { name, code } = payload;
          const upperCode = code ? code.trim().toUpperCase() : '';
          const room = rooms.get(upperCode);

          if (!room) {
            sendToClient(ws, 'join_error', { message: 'Geçersiz kod' });
            return;
          }
          if (room.players.length >= 2) {
            sendToClient(ws, 'join_error', { message: 'Oda dolu' });
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

          // Once 2nd player joins, we are in 'ready' phase
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

          // Check if both players are ready
          const bothReady = room.players.length === 2 && room.players.every(p => p.ready);
          
          if (bothReady) {
            // Setup the board but keep it ready, we can let client countdown first, or start play
            // Let's initialize the game
            initGame(room);
          }

          broadcastRoomState(room);
          break;
        }

        case 'start_game': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;
          // In case start_game message is received to kick off the game phase
          if (room.gameState.phase !== 'playing') {
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

          // Ignore if 2 cards already flipped (waiting for timer)
          if (room.gameState.flipped.length >= 2) return;

          const index = parseInt(payload.index);
          if (isNaN(index) || index < 0 || index >= 36) return;

          // Ignore if already matched or already flipped
          if (room.gameState.matched.includes(index) || room.gameState.flipped.includes(index)) {
            return;
          }

          room.gameState.flipped.push(index);
          broadcastRoomState(room);

          // If 2 cards are flipped, evaluate match
          if (room.gameState.flipped.length === 2) {
            const idx1 = room.gameState.flipped[0];
            const idx2 = room.gameState.flipped[1];
            const card1 = room.gameState.cards[idx1];
            const card2 = room.gameState.cards[idx2];

            const activePlayer = room.players.find(p => p.name === room.gameState.currentTurn);
            const passivePlayer = room.players.find(p => p.name !== room.gameState.currentTurn);

            if (card1 === card2) {
              // MATCH - 0.5 seconds delay before updating state
              setTimeout(() => {
                const currentRoom = rooms.get(ws.roomCode);
                if (!currentRoom || currentRoom.gameState.phase !== 'playing') return;

                // Ensure they haven't disconnected or state changed in-between
                if (currentRoom.gameState.flipped.includes(idx1) && currentRoom.gameState.flipped.includes(idx2)) {
                  currentRoom.gameState.matched.push(idx1, idx2);
                  currentRoom.gameState.flipped = [];

                  if (activePlayer) {
                    activePlayer.score += 1;
                    activePlayer.combo += 1;
                  }

                  // Check if game over
                  if (currentRoom.gameState.matched.length === 36) {
                    currentRoom.gameState.phase = 'finished';
                  }

                  broadcastRoomState(currentRoom);
                }
              }, 500);
            } else {
              // MISMATCH - 1.0 second delay before flipping back and changing turn
              setTimeout(() => {
                const currentRoom = rooms.get(ws.roomCode);
                if (!currentRoom || currentRoom.gameState.phase !== 'playing') return;

                if (currentRoom.gameState.flipped.includes(idx1) && currentRoom.gameState.flipped.includes(idx2)) {
                  currentRoom.gameState.flipped = [];

                  if (activePlayer) {
                    activePlayer.combo = 0;
                  }

                  // Switch turn
                  if (passivePlayer) {
                    currentRoom.gameState.currentTurn = passivePlayer.name;
                  }

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

          const allPlayAgain = room.players.length === 2 && room.players.every(p => p.playAgain);

          if (allPlayAgain) {
            // Reset player fields
            room.players.forEach(p => {
              p.score = 0;
              p.combo = 0;
              p.ready = false;
              p.playAgain = false;
            });
            // Return to ready phase
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
          const opponent = room.players.find(p => p.ws !== ws);
          if (opponent) {
            sendToClient(opponent.ws, 'cursor_move', {
              x: payload.x,
              y: payload.y,
              sender: ws.playerName
            });
          }
          break;
        }

        case 'card_hover': {
          const room = rooms.get(ws.roomCode);
          if (!room) return;
          const opponent = room.players.find(p => p.ws !== ws);
          if (opponent) {
            sendToClient(opponent.ws, 'card_hover', {
              index: payload.index,
              sender: ws.playerName
            });
          }
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

  // Find remaining player
  const remainingPlayer = room.players.find(p => p.ws !== ws);

  if (remainingPlayer) {
    // Notify opponent
    const msgType = isDisconnect ? 'opponent_disconnected' : 'opponent_left';
    sendToClient(remainingPlayer.ws, msgType, { message: 'Rakip odadan ayrıldı' });
    
    // Clean up opponent room link
    remainingPlayer.ws.roomCode = null;
  }

  // Clear room
  rooms.delete(code);
}
