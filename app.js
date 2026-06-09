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

localPlayers[myId] = {
    id: myId,
    x: 1500, 
    y: 1500,
    hp: 100
};

// --- НАСТРОЙКИ МИРА, КОЛЛИЗИЙ И СЕТИ ---
const TILE_SIZE = 48;       
const CHUNK_SIZE = 8;      
const CHUNK_PIXELS = CHUNK_SIZE * TILE_SIZE; 

const PLAYER_RADIUS = 14;
const TREE_RADIUS = 16;
const STONE_RADIUS = 12;
const ZOMBIE_RADIUS = 14;

const loadedChunks = {};
let networkZombies = []; // Сюда складываем зомби, если мы НЕ хост

function toIso(x, y) {
    return { x: (x - y), y: (x + y) / 2 };
}

// Проверяем, являемся ли мы хостом (самым главным в сессии)
function isHost() {
    const playerIds = Object.keys(localPlayers).sort();
    return playerIds[0] === myId; 
}

// Генератор чанков
function getChunk(chunkX, chunkY) {
    const chunkKey = `${chunkX},${chunkY}`;
    if (loadedChunks[chunkKey]) return loadedChunks[chunkKey];

    const tiles = [];
    const zombies = [];

    for (let x = 0; x < CHUNK_SIZE; x++) {
        tiles[x] = [];
        for (let y = 0; y < CHUNK_SIZE; y++) {
            const worldTileX = chunkX * CHUNK_SIZE + x;
            const worldTileY = chunkY * CHUNK_SIZE + y;
            
            const noise = Math.abs(Math.sin(worldTileX * 12.9898 + worldTileY * 78.233)) * 43758.5453 % 1;
            
            let color = '#3c7a2b'; 
            let hasStaticObject = null;

            if (noise > 0.88) color = '#488e35'; 
            if (noise < 0.12) color = '#326623'; 
            
            if (noise > 0.96) {
                hasStaticObject = 'tree';
            } else if (noise < 0.02) {
                hasStaticObject = 'stone';
            }
            
            tiles[x][y] = { color: color, object: hasStaticObject };

            // Локальный спавн зомби для генерации базовых ID
            if (!hasStaticObject && noise > 0.94 && noise < 0.955) {
                zombies.push({
                    id: `zombie_${worldTileX}_${worldTileY}`, // Уникальный ID зомби по его координате спавна
                    x: worldTileX * TILE_SIZE + TILE_SIZE / 2,
                    y: worldTileY * TILE_SIZE + TILE_SIZE / 2,
                    targetX: worldTileX * TILE_SIZE + TILE_SIZE / 2,
                    targetY: worldTileY * TILE_SIZE + TILE_SIZE / 2,
                    speed: 1.5,
                    hp: 50,
                    state: 'idle',
                    lastDecision: 0
                });
            }
        }
    }

    loadedChunks[chunkKey] = { tiles: tiles, zombies: zombies };
    return loadedChunks[chunkKey];
}

function drawIsoTile(screenX, screenY, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(screenX, screenY);                
    ctx.lineTo(screenX + size, screenY + size/2); 
    ctx.lineTo(screenX, screenY + size);         
    ctx.lineTo(screenX - size, screenY + size/2); 
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
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

// ПРИЕМ СИНХРОНИЗАЦИИ ЗОМБИ ОТ ХОСТА
socket.on('zombiesUpdate', (data) => {
    if (!isHost()) {
        networkZombies = data.zombies; // Записываем чужих зомби
    }
});

let lastUpdateTime = 0;
let lastZombieNetTime = 0;

// --- ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ ---
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const me = localPlayers[myId];
    if (!me) { requestAnimationFrame(gameLoop); return; }

    const activeObstacles = [];
    const localZombies = [];

    const currentChunkX = Math.floor(me.x / CHUNK_PIXELS);
    const currentChunkY = Math.floor(me.y / CHUNK_PIXELS);
    const viewRadius = 2; 

    // Сбор объектов из чанков
    for (let cx = currentChunkX - viewRadius; cx <= currentChunkX + viewRadius; cx++) {
        for (let cy = currentChunkY - viewRadius; cy <= currentChunkY + viewRadius; cy++) {
            const chunk = getChunk(cx, cy);

            for (let x = 0; x < CHUNK_SIZE; x++) {
                for (let y = 0; y < CHUNK_SIZE; y++) {
                    if (chunk.tiles[x][y].object) {
                        activeObstacles.push({
                            type: chunk.tiles[x][y].object,
                            x: (cx * CHUNK_SIZE + x) * TILE_SIZE + TILE_SIZE / 2,
                            y: (cy * CHUNK_SIZE + y) * TILE_SIZE + TILE_SIZE / 2,
                            radius: chunk.tiles[x][y].object === 'tree' ? TREE_RADIUS : STONE_RADIUS
                        });
                    }
                }
            }
            chunk.zombies.forEach(z => localZombies.push(z));
        }
    }

    // 1. ДВИЖЕНИЕ И КОЛЛИЗИИ ИГРОКА
    if (joystickActive) {
        const dx = joystickCurrent.x - joystickStart.x;
        const dy = joystickCurrent.y - joystickStart.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            const speed = 4;
            let nextX = me.x + (dx / distance) * speed;
            let nextY = me.y + (dy / distance) * speed;

            let canMoveX = true; let canMoveY = true;

            for (let obs of activeObstacles) {
                if (Math.sqrt(Math.pow(nextX - obs.x, 2) + Math.pow(me.y - obs.y, 2)) < PLAYER_RADIUS + obs.radius) canMoveX = false;
                if (Math.sqrt(Math.pow(me.x - obs.x, 2) + Math.pow(nextY - obs.y, 2)) < PLAYER_RADIUS + obs.radius) canMoveY = false;
            }

            if (canMoveX) me.x = nextX;
            if (canMoveY) me.y = nextY;

            const now = Date.now();
            if (myId !== "local_player" && now - lastUpdateTime > 45) {
                socket.emit('playerMovement', { x: me.x, y: me.y });
                lastUpdateTime = now;
            }
        }
    }

    // 2. РАСЧЁТ ИИ ЗОМБИ (ТОЛЬКО ЕСЛИ МЫ ХОСТ!)
    const now = Date.now();
    if (isHost()) {
        localZombies.forEach(z => {
            // Находим БЛИЖАЙШЕГО игрока среди всех в мультиплеере для агра зомби
            let closestPlayer = me;
            let minDist = Math.sqrt(Math.pow(me.x - z.x, 2) + Math.pow(me.y - z.y, 2));

            Object.keys(localPlayers).forEach(id => {
                const p = localPlayers[id];
                const d = Math.sqrt(Math.pow(p.x - z.x, 2) + Math.pow(p.y - z.y, 2));
                if (d < minDist) { minDist = d; closestPlayer = p; }
            });

            if (minDist < 300) {
                z.state = 'chase'; z.targetX = closestPlayer.x; z.targetY = closestPlayer.y;
            } else {
                if (z.state === 'chase') z.state = 'idle';
                if (now - z.lastDecision > 2000) {
                    z.lastDecision = now;
                    if (Math.random() > 0.5) {
                        z.targetX = z.x + (Math.random() * 120 - 60); z.targetY = z.y + (Math.random() * 120 - 60);
                    }
                }
            }

            const zDx = z.targetX - z.x; const zDy = z.targetY - z.y;
            const zDist = Math.sqrt(zDx * zDx + zDy * zDy);

            if (zDist > 5) {
                let zNextX = z.x + (zDx / zDist) * z.speed; let zNextY = z.y + (zDy / zDist) * z.speed;
                let zCanMoveX = true; let zCanMoveY = true;

                for (let obs of activeObstacles) {
                    if (Math.sqrt(Math.pow(zNextX - obs.x, 2) + Math.pow(z.y - obs.y, 2)) < ZOMBIE_RADIUS + obs.radius) zCanMoveX = false;
                    if (Math.sqrt(Math.pow(z.x - obs.x, 2) + Math.pow(zNextY - obs.y, 2)) < ZOMBIE_RADIUS + obs.radius) zCanMoveY = false;
                }
                if (zCanMoveX) z.x = zNextX; if (zCanMoveY) z.y = zNextY;
            }
        });

        // Отправляем наши расчеты зомби на сервер раз в 60мс
        if (now - lastZombieNetTime > 60 && myId !== "local_player") {
            // Передаем только самое нужное, чтобы разгрузить сеть
            const pack = localZombies.map(z => ({ id: z.id, x: z.x, y: z.y, state: z.state }));
            socket.emit('shareZombies', pack); 
            lastZombieNetTime = now;
        }
    }

    // РАСЧЁТ КАМЕРЫ
    const myIso = toIso(me.x, me.y);
    const cameraX = canvas.width / 2 - myIso.x;
    const cameraY = canvas.height / 2 - myIso.y;

    // 3. ОТРИСОВКА ЗЕМЛИ
    for (let cx = currentChunkX - viewRadius; cx <= currentChunkX + viewRadius; cx++) {
        for (let cy = currentChunkY - viewRadius; cy <= currentChunkY + viewRadius; cy++) {
            const chunk = getChunk(cx, cy);
            for (let x = 0; x < CHUNK_SIZE; x++) {
                for (let y = 0; y < CHUNK_SIZE; y++) {
                    const worldX = (cx * CHUNK_SIZE + x) * TILE_SIZE; const worldY = (cy * CHUNK_SIZE + y) * TILE_SIZE;
                    const isoTile = toIso(worldX, worldY);
                    const screenX = isoTile.x + cameraX; const screenY = isoTile.y + cameraY;

                    if (screenX >= -TILE_SIZE*2 && screenX <= canvas.width + TILE_SIZE*2 &&
                        screenY >= -TILE_SIZE*2 && screenY <= canvas.height + TILE_SIZE*2) {
                        drawIsoTile(screenX, screenY, TILE_SIZE, chunk.tiles[x][y].color);
                    }
                }
            }
        }
    }

    // 4. СБОРКА ДЛЯ Z-SORTING
    const renderQueue = [];

    activeObstacles.forEach(obs => {
        renderQueue.push({ type: obs.type, worldX: obs.x, worldY: obs.y, sortY: obs.x + obs.y });
    });

    // Отрисовка зомби: берем либо свои расчеты (если хост), либо данные из сети (если зашли к кому-то)
    const zombiesToRender = isHost() ? localZombies : networkZombies;
    zombiesToRender.forEach(z => {
        // Если мы не хост, плавно интерполируем движения зомби из сети, чтоб они не прыгали рывками
        if (!isHost()) {
            const localZombieRef = localZombies.find(lz => lz.id === z.id);
            if (localZombieRef) {
                localZombieRef.x += (z.x - localZombieRef.x) * 0.2;
                localZombieRef.y += (z.y - localZombieRef.y) * 0.2;
                z.x = localZombieRef.x; z.y = localZombieRef.y;
            }
        }
        renderQueue.push({ type: 'zombie', worldX: z.x, worldY: z.y, sortY: z.x + z.y, state: z.state });
    });

    Object.keys(localPlayers).forEach((id) => {
        const p = localPlayers[id];
        if (id !== myId && p.targetX !== undefined && p.targetY !== undefined) {
            p.x += (p.targetX - p.x) * 0.15; p.y += (p.targetY - p.y) * 0.15;
        }
        renderQueue.push({ type: 'player', id: id, worldX: p.x, worldY: p.y, sortY: p.x + p.y });
    });

    renderQueue.sort((a, b) => a.sortY - b.sortY);

    // 5. ОТРИСОВКА ВЕРХНЕГО СЛОЯ
    renderQueue.forEach((obj) => {
        const isoPos = toIso(obj.worldX, obj.worldY);
        const screenX = isoPos.x + cameraX; const screenY = isoPos.y + cameraY;

        if (obj.type === 'player') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'; ctx.beginPath(); ctx.ellipse(screenX, screenY + 2, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = (obj.id === myId) ? '#00ff66' : '#ff3333';
            ctx.beginPath(); ctx.arc(screenX, screenY - 12, 18, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center';
            ctx.fillText(obj.id === myId ? "Вы" : `Игрок_${obj.id.substring(0, 4)}`, screenX, screenY - 40);

        } else if (obj.type === 'zombie') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; ctx.beginPath(); ctx.ellipse(screenX, screenY + 2, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#4a753c'; ctx.beginPath(); ctx.arc(screenX, screenY - 12, 18, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#223d19'; ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = obj.state === 'chase' ? '#ff0000' : '#ff9900';
            ctx.beginPath(); ctx.arc(screenX - 5, screenY - 16, 3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(screenX + 5, screenY - 16, 3, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ff4444'; ctx.font = '900 11px Arial'; ctx.textAlign = 'center';
            ctx.fillText(obj.state === 'chase' ? "⚠️ ЗОМБИ" : "Zzz...", screenX, screenY - 38);

        } else if (obj.type === 'tree') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; ctx.beginPath(); ctx.ellipse(screenX, screenY, 20, 10, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#6e4720'; ctx.fillRect(screenX - 5, screenY - 35, 10, 35);
            ctx.fillStyle = '#1e5912'; ctx.beginPath(); ctx.arc(screenX, screenY - 50, 24, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#266e18'; ctx.beginPath(); ctx.arc(screenX - 6, screenY - 54, 18, 0, Math.PI * 2); ctx.fill();

        } else if (obj.type === 'stone') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; ctx.beginPath(); ctx.ellipse(screenX, screenY + 2, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#7a7a7a'; ctx.beginPath();
            ctx.moveTo(screenX - 12, screenY); ctx.lineTo(screenX, screenY - 14); ctx.lineTo(screenX + 12, screenY);
            ctx.lineTo(screenX + 6, screenY + 6); ctx.lineTo(screenX - 6, screenY + 6); ctx.closePath(); ctx.fill();
        }
    });

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

function toggleCraftMenu() {
    document.getElementById('craft-menu').classList.toggle('hidden');
}
