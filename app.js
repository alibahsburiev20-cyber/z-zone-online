// Подключение к серверу Render
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

// Стартовые координаты в плоском мире (внутри изометрии они развернутся)
localPlayers[myId] = {
    id: myId,
    x: 1500, 
    y: 1500,
    hp: 100
};

// --- НАСТРОЙКИ ИЗОМЕТРИЧЕСКОГО МИРА ---
const TILE_SIZE = 48;       // Ширина/высота стороны плоского ромба
const CHUNK_SIZE = 8;      // Сколько тайлов в одном чанке
const CHUNK_PIXELS = CHUNK_SIZE * TILE_SIZE; 

const loadedChunks = {};

// Магическая функция перевода плоских координат (X, Y) в Изометрию (2.5D)
function toIso(x, y) {
    return {
        x: (x - y),
        y: (x + y) / 2
    };
}

// Генератор чанков (срез текстуры по Сиду)
function getChunk(chunkX, chunkY) {
    const chunkKey = `${chunkX},${chunkY}`;
    if (loadedChunks[chunkKey]) return loadedChunks[chunkKey];

    const tiles = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
        tiles[x] = [];
        for (let y = 0; y < CHUNK_SIZE; y++) {
            const worldTileX = chunkX * CHUNK_SIZE + x;
            const worldTileY = chunkY * CHUNK_SIZE + y;
            
            // Псевдослучайный генератор шума
            const noise = Math.abs(Math.sin(worldTileX * 12.9898 + worldTileY * 78.233)) * 43758.5453 % 1;
            
            let color = '#3c7a2b'; // Базовая трава
            let hasStaticObject = null;

            if (noise > 0.88) color = '#488e35'; // Светлая трава
            if (noise < 0.12) color = '#326623'; // Тёмная трава
            
            // Вшиваем редкий спавн декораций (деревья/камни) по шуму
            if (noise > 0.96) {
                hasStaticObject = 'tree';
            } else if (noise < 0.03) {
                hasStaticObject = 'stone';
            }

            tiles[x][y] = { color: color, object: hasStaticObject };
        }
    }

    loadedChunks[chunkKey] = { tiles: tiles };
    return loadedChunks[chunkKey];
}

// Рисование изометрического ромба земли
function drawIsoTile(screenX, screenY, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(screenX, screenY);                // Верхний угол ромба
    ctx.lineTo(screenX + size, screenY + size/2); // Правый угол
    ctx.lineTo(screenX, screenY + size);         // Нижний угол
    ctx.lineTo(screenX - size, screenY + size/2); // Левый угол
    ctx.closePath();
    ctx.fill();

    // Легкая сетка между ромбами
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// --- МОБИЛЬНОЕ УПРАВЛЕНИЕ ---
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

// --- СЕТЕВАЯ СИНХРОНИЗАЦИЯ ---
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

// --- ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ ---
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const me = localPlayers[myId];

    // Логика бега (расчёт в 2D-осях, который плавно проецируется в изометрию)
    if (joystickActive && me) {
        const dx = joystickCurrent.x - joystickStart.x;
        const dy = joystickCurrent.y - joystickStart.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            const speed = 4;
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

    // РАСЧЁТ КАМЕРЫ ДЛЯ ИЗОМЕТРИИ
    const myIso = toIso(me.x, me.y);
    const cameraX = canvas.width / 2 - myIso.x;
    const cameraY = canvas.height / 2 - myIso.y;

    // Вычисляем, в каком плоском чанке мы находимся
    const currentChunkX = Math.floor(me.x / CHUNK_PIXELS);
    const currentChunkY = Math.floor(me.y / CHUNK_PIXELS);
    
    const viewRadius = 2; // Радиус рендера чанков вокруг игрока
    
    // Массив для Z-Sorting (сюда собираем игроков и объекты, чтобы рисовать их по глубине)
    const renderQueue = [];

    // 1. СНАЧАЛА РИСУЕМ ТОЛЬКО ЗЕМЛЮ (НИЖНИЙ СЛОЙ)
    for (let cx = currentChunkX - viewRadius; cx <= currentChunkX + viewRadius; cx++) {
        for (let cy = currentChunkY - viewRadius; cy <= currentChunkY + viewRadius; cy++) {
            const chunk = getChunk(cx, cy);

            for (let x = 0; x < CHUNK_SIZE; x++) {
                for (let y = 0; y < CHUNK_SIZE; y++) {
                    const worldX = (cx * CHUNK_SIZE + x) * TILE_SIZE;
                    const worldY = (cy * CHUNK_SIZE + y) * TILE_SIZE;

                    // Переводим координаты блока в 2.5D
                    const isoTile = toIso(worldX, worldY);
                    const screenX = isoTile.x + cameraX;
                    const screenY = isoTile.y + cameraY;

                    // Отрисовка ромба травы, если он виден на экране телефона
                    if (screenX >= -TILE_SIZE*2 && screenX <= canvas.width + TILE_SIZE*2 &&
                        screenY >= -TILE_SIZE*2 && screenY <= canvas.height + TILE_SIZE*2) {
                        
                        drawIsoTile(screenX, screenY, TILE_SIZE, chunk.tiles[x][y].color);

                        // Если на тайле есть объект (дерево/камень), кидаем его в очередь рендера верхнего слоя
                        if (chunk.tiles[x][y].object) {
                            renderQueue.push({
                                type: chunk.tiles[x][y].object,
                                worldX: worldX + TILE_SIZE/2,
                                worldY: worldY + TILE_SIZE/2,
                                sortY: worldX + worldY + TILE_SIZE // Глубина для изометрии
                            });
                        }
                    }
                }
            }
        }
    }

    // Добавляем всех активных игроков в ту же очередь рендера верхнего слоя
    Object.keys(localPlayers).forEach((id) => {
        const p = localPlayers[id];
        
        // Плавная интерполяция шагов для чужих игроков
        if (id !== myId && p.targetX !== undefined && p.targetY !== undefined) {
            p.x += (p.targetX - p.x) * 0.15;
            p.y += (p.targetY - p.y) * 0.15;
        }

        renderQueue.push({
            type: 'player',
            id: id,
            worldX: p.x,
            worldY: p.y,
            sortY: p.x + p.y // Сортировочная глубина персонажа
        });
    });

    // 🔥 СВЯТАЯ МАГИЯ ГЕЙМДЕВА: Сортируем объекты по глубине Y
    // Кто стоит дальше (выше на экране) — рендерится первым. Кто ближе — перекрывает их!
    renderQueue.sort((a, b) => a.sortY - b.sortY);

    // 2. РИСУЕМ ВЕРХНИЙ СЛОЙ (ИГРОКИ, ДЕРЕВЬЯ, КАМНИ) С УЧЕТОМ СОРТИРОВКИ
    renderQueue.forEach((obj) => {
        const isoPos = toIso(obj.worldX, obj.worldY);
        const screenX = isoPos.x + cameraX;
        const screenY = isoPos.y + cameraY;

        if (obj.type === 'player') {
            // --- РЕНДЕР ИГРОКА ---
            // 1. Овальная тень под ногами
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.beginPath();
            ctx.ellipse(screenX, screenY + 2, 16, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            // 2. Тело (Круг-фишка)
            ctx.fillStyle = (obj.id === myId) ? '#00ff66' : '#ff3333';
            ctx.beginPath();
            ctx.arc(screenX, screenY - 12, 18, 0, Math.PI * 2); // Смещаем чуть вверх относительно тени
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.stroke();

            // 3. Никнейм над головой
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(obj.id === myId ? "Вы" : `Игрок_${obj.id.substring(0, 4)}`, screenX, screenY - 40);

        } else if (obj.type === 'tree') {
            // --- РЕНДЕР ИЗОМЕТРИЧЕСКОГО ДЕРЕВА ---
            // Тень дерева
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(screenX, screenY, 20, 10, 0, 0, Math.PI * 2);
            ctx.fill();

            // Ствол дерева
            ctx.fillStyle = '#6e4720';
            ctx.fillRect(screenX - 5, screenY - 35, 10, 35);

            // Крона (Листва) — объемный ромб-шапка
            ctx.fillStyle = '#1e5912';
            ctx.beginPath();
            ctx.arc(screenX, screenY - 50, 24, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#266e18';
            ctx.beginPath();
            ctx.arc(screenX - 6, screenY - 54, 18, 0, Math.PI * 2);
            ctx.fill();

        } else if (obj.type === 'stone') {
            // --- РЕНДЕР КАМНЯ ---
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.beginPath();
            ctx.ellipse(screenX, screenY + 2, 14, 7, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#7a7a7a';
            ctx.beginPath();
            ctx.moveTo(screenX - 12, screenY);
            ctx.lineTo(screenX, screenY - 14);
            ctx.lineTo(screenX + 12, screenY);
            ctx.lineTo(screenX + 6, screenY + 6);
            ctx.lineTo(screenX - 6, screenY + 6);
            ctx.closePath();
            ctx.fill();
            
            ctx.fillStyle = '#949494'; // Блик на грани камня
            ctx.beginPath();
            ctx.moveTo(screenX, screenY - 14);
            ctx.lineTo(screenX + 12, screenY);
            ctx.lineTo(screenX + 6, screenY + 6);
            ctx.closePath();
            ctx.fill();
        }
    });

    requestAnimationFrame(gameLoop);
}

// Запуск обновленного движка
requestAnimationFrame(gameLoop);

function toggleCraftMenu() {
    document.getElementById('craft-menu').classList.toggle('hidden');
}
