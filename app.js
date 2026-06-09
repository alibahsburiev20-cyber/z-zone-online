const socket = io('https://z-zone-online.onrender.com');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let localPlayers = {};
let myId = "local_player"; 

// Стартовые координаты игрока в БОЛЬШОМ МИРУ (теперь мир бесконечный)
localPlayers[myId] = {
    id: myId,
    x: 2000, // Спавнимся глубоко в мире, чтобы было куда ходить
    y: 2000,
    hp: 100
};

// --- НАСТРОЙКИ МИРА И ЧАНКОВ ---
const TILE_SIZE = 64; // Размер одного блока земли (травы) в пикселях
const CHUNK_SIZE = 8; // Чанк состоит из 8х8 блоков
const CHUNK_PIXELS = CHUNK_SIZE * TILE_SIZE; // Размер чанка в пикселях (512х512)

// Хранилище сгенерированных чанков в памяти телефона
const loadedChunks = {};

// Функция псевдослучайной генерации чанка по его координатам (чтобы трава и объекты не менялись при возвращении)
function getChunk(chunkX, chunkY) {
    const chunkKey = `${chunkX},${chunkY}`;
    if (loadedChunks[chunkKey]) return loadedChunks[chunkKey];

    const tiles = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
        tiles[x] = [];
        for (let y = 0; y < CHUNK_SIZE; y++) {
            // Магическая формула генерации: делаем разные оттенки зеленого для реалистичности травы
            const worldTileX = chunkX * CHUNK_SIZE + x;
            const worldTileY = chunkY * CHUNK_SIZE + y;
            const noise = Math.abs(Math.sin(worldTileX * 12.9898 + worldTileY * 78.233)) * 43758.5453 % 1;
            
            let color = '#2e5c1e'; // Обычная трава
            if (noise > 0.85) color = '#3b6e2a'; // Светлая трава
            if (noise < 0.15) color = '#244717'; // Темная трава

            tiles[x][y] = { color: color };
        }
    }

    loadedChunks[chunkKey] = { tiles: tiles };
    return loadedChunks[chunkKey];
}

// --- УПРАВЛЕНИЕ ---
const joystickZone = document.getElementById('joystick-zone');
let joystickActive = false;
let joystickStart = { x: 0, y: 0 };
let joystickCurrent = { x: 0, y: 0 };

window.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    if (touch.clientX < window.innerWidth / 2) {
        joystickActive = true;
        joystickStart = { x: touch.clientX, y: touch.clientY };
        joystickCurrent = { x: touch.clientX, y: touch.clientY };
        
        joystickZone.style.left = (touch.clientX - 50) + 'px';
        joystickZone.style.bottom = (window.innerHeight - touch.clientY - 50) + 'px';
    }
});

window.addEventListener('touchmove', (e) => {
    if (!joystickActive) return;
    const touch = e.touches[0];
    joystickCurrent = { x: touch.clientX, y: touch.clientY };
});

window.addEventListener('touchend', () => {
    joystickActive = false;
    joystickZone.style.left = '40px';
    joystickZone.style.bottom = '30px';
});

// --- СЕТЕВЫЕ СОБЫТИЯ ---
socket.on('connect', () => {
    const currentX = localPlayers[myId].x;
    const currentY = localPlayers[myId].y;
    delete localPlayers[myId];
    myId = socket.id;
    
    localPlayers[myId] = { id: myId, x: currentX, y: currentY, hp: 100 };
});

socket.on('currentPlayers', (serverPlayers) => {
    Object.keys(serverPlayers).forEach((id) => {
        if (id !== myId) {
            localPlayers[id] = {
                id: id, x: serverPlayers[id].x, y: serverPlayers[id].y,
                targetX: serverPlayers[id].x, targetY: serverPlayers[id].y, hp: serverPlayers[id].hp
            };
        }
    });
});

socket.on('newPlayer', (playerInfo) => {
    if (playerInfo.id !== myId) {
        localPlayers[playerInfo.id] = {
            id: playerInfo.id, x: playerInfo.x, y: playerInfo.y,
            targetX: playerInfo.x, targetY: playerInfo.y, hp: playerInfo.hp
        };
    }
});

socket.on('playerMoved', (playerInfo) => {
    if (localPlayers[playerInfo.id] && playerInfo.id !== myId) {
        localPlayers[playerInfo.id].targetX = playerInfo.x;
        localPlayers[playerInfo.id].targetY = playerInfo.y;
    }
});

socket.on('playerDisconnected', (id) => { delete localPlayers[id]; });

let lastUpdateTime = 0;

// --- ИГРОВОЙ ЦИКЛ (КАМЕРА + ЧАНКИ) ---
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const me = localPlayers[myId];

    // 1. Движение нашего игрока
    if (joystickActive && me) {
        const dx = joystickCurrent.x - joystickStart.x;
        const dy = joystickCurrent.y - joystickStart.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            const speed = 5;
            me.x += (dx / distance) * speed;
            me.y += (dy / distance) * speed;

            const now = Date.now();
            if (myId !== "local_player" && now - lastUpdateTime > 45) {
                socket.emit('playerMovement', { x: me.x, y: me.y });
                lastUpdateTime = now;
            }
        }
    }

    if (!me) {
        requestAnimationFrame(gameLoop);
        return;
    }

    // 🔥 СИСТЕМА КАМЕРЫ: Вычисляем сдвиг мира. 
    // Центр экрана минус реальное положение нашего игрока в мире
    const cameraX = canvas.width / 2 - me.x;
    const cameraY = canvas.height / 2 - me.y;

    // 🔥 РЕНДЕР БЕСКОНЕЧНЫХ ЧАНКОВ
    // Определяем, в каком чанке сейчас находится центр экрана
    const currentChunkX = Math.floor(me.x / CHUNK_PIXELS);
    const currentChunkY = Math.floor(me.y / CHUNK_PIXELS);

    // Радиус видимости чанков вокруг игрока (1 чанк в каждую сторону — с головой для экрана телефона)
    const viewRadius = 2;

    for (let cx = currentChunkX - viewRadius; cx <= currentChunkX + viewRadius; cx++) {
        for (let cy = currentChunkY - viewRadius; cy <= currentChunkY + viewRadius; cy++) {
            const chunk = getChunk(cx, cy);

            // Отрисовка блоков внутри этого чанка
            for (let x = 0; x < CHUNK_SIZE; x++) {
                for (let y = 0; y < CHUNK_SIZE; y++) {
                    // Вычисляем мировые координаты каждого блока
                    const worldX = (cx * CHUNK_SIZE + x) * TILE_SIZE;
                    const worldY = (cy * CHUNK_SIZE + y) * TILE_SIZE;

                    // Экранные координаты блока с учетом сдвига камеры
                    const screenX = worldX + cameraX;
                    const screenY = worldY + cameraY;

                    // Рисуем блок только если он попадает на экран смартфона (оптимизация Culling)
                    if (screenX >= -TILE_SIZE && screenX <= canvas.width &&
                        screenY >= -TILE_SIZE && screenY <= canvas.height) {
                        
                        ctx.fillStyle = chunk.tiles[x][y].color;
                        ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);

                        // Рисуем легкую сетку блоков, чтобы видеть структуру мира
                        ctx.strokeStyle = 'rgba(0,0,0,0.05)';
                        ctx.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
                    }
                }
            }
        }
    }

    // 3. РЕНДЕР ИГРОКОВ (С учетом камеры!)
    Object.keys(localPlayers).forEach((id) => {
        const p = localPlayers[id];

        if (id !== myId && p.targetX !== undefined && p.targetY !== undefined) {
            p.x += (p.targetX - p.x) * 0.15;
            p.y += (p.targetY - p.y) * 0.15;
        }

        // Переводим мировые координаты игрока в координаты экрана
        const playerScreenX = p.x + cameraX;
        const playerScreenY = p.y + cameraY;

        ctx.fillStyle = (id === myId) ? '#00ff66' : '#ff3333';

        ctx.beginPath();
        ctx.arc(playerScreenX, playerScreenY, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(id === myId ? "Вы" : `Игрок_${id.substring(0, 4)}`, playerScreenX, playerScreenY - 35);
    });

    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

function toggleCraftMenu() {
    document.getElementById('craft-menu').classList.toggle('hidden');
}
