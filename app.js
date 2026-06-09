const socket = io('https://z-zone-online.onrender.com');

// Инициализируем наш собственный 3D движок Ali3D!
const engine = new Ali3D('gameCanvas', 400, 20);

// Позиция локального игрока в мире
let player3D = { x: 1500, z: 1500, yaw: 0, pitch: 0 };

let localPlayers = {};
let myId = "local_player";
localPlayers[myId] = { x: player3D.x, z: player3D.z, yaw: 0 };

const TILE_SIZE = 60;
const CHUNK_SIZE = 6;
const CHUNK_PIXELS = CHUNK_SIZE * TILE_SIZE;
const loadedChunks = {};
let networkZombies = [];

function isHost() { return Object.keys(localPlayers).sort()[0] === myId; }

// Обработчик кнопки смены лица (цикл: 1 -> 3 -> 2 -> 1)
document.getElementById('cam-toggle').addEventListener('click', () => {
    let nextMode = engine.viewMode === 1 ? 3 : (engine.viewMode === 3 ? 2 : 1);
    engine.setViewMode(nextMode);
    
    const labels = { 1: "Камера: 1-е лицо", 3: "Камера: 3-е лицо", 2: "Камера: Вид сверху" };
    document.getElementById('cam-toggle').innerText = labels[nextMode];
});

function getChunk(chunkX, chunkY) {
    const chunkKey = `${chunkX},${chunkY}`;
    if (loadedChunks[chunkKey]) return loadedChunks[chunkKey];

    const tiles = []; const zombies = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
        tiles[x] = [];
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = chunkX * CHUNK_SIZE + x;
            const worldZ = chunkY * CHUNK_SIZE + z;
            const noise = Math.abs(Math.sin(worldX * 12.9898 + worldZ * 78.233)) * 43758.5453 % 1;

            let color = '#2c5e1a'; let objType = null;
            if (noise > 0.85) color = '#387822';
            if (noise < 0.15) color = '#1e4011';
            if (noise > 0.97) objType = 'tree';
            else if (noise < 0.015) objType = 'stone';

            tiles[x][z] = { color: color, object: objType };

            if (!objType && noise > 0.94 && noise < 0.952) {
                zombies.push({
                    id: `z3d_${worldX}_${worldZ}`, x: worldX * TILE_SIZE + TILE_SIZE/2, z: worldZ * TILE_SIZE + TILE_SIZE/2,
                    speed: 1.0, state: 'idle', targetX: worldX * TILE_SIZE + TILE_SIZE/2, targetZ: worldZ * TILE_SIZE + TILE_SIZE/2, lastDecision: 0
                });
            }
        }
    }
    loadedChunks[chunkKey] = { tiles: tiles, zombies: zombies };
    return loadedChunks[chunkKey];
}

// --- ДВУХЗОННЫЙ СЕНСОР (SPLIT-TOUCH) ---
let joystickActive = false; let joystickStart = { x: 0, y: 0 }; let joystickCurrent = { x: 0, y: 0 };
let lookActive = false; let lastLookTouch = { x: 0, y: 0 };

window.addEventListener('touchstart', (e) => {
    for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (touch.clientX < window.innerWidth / 2 && !joystickActive) {
            joystickActive = true; joystickStart = { x: touch.clientX, y: touch.clientY }; joystickCurrent = { x: touch.clientX, y: touch.clientY };
        }
        if (touch.clientX >= window.innerWidth / 2 && !lookActive) {
            lookActive = true; lastLookTouch = { x: touch.clientX, y: touch.clientY };
        }
    }
});

window.addEventListener('touchmove', (e) => {
    for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (touch.clientX < window.innerWidth / 2 && joystickActive) joystickCurrent = { x: touch.clientX, y: touch.clientY };
        if (touch.clientX >= window.innerWidth / 2 && lookActive) {
            const movementX = touch.clientX - lastLookTouch.x;
            const movementY = touch.clientY - lastLookTouch.y;
            player3D.yaw += movementX * 0.007;
            player3D.pitch -= movementY * 0.007;
            player3D.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, player3D.pitch));
            lastLookTouch = { x: touch.clientX, y: touch.clientY };
        }
    }
});

window.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) { joystickActive = false; lookActive = false; }
    else {
        let hasLeft = false; let hasRight = false;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].clientX < window.innerWidth / 2) hasLeft = true;
            if (e.touches[i].clientX >= window.innerWidth / 2) hasRight = true;
        }
        if (!hasLeft) joystickActive = false;
        if (!hasRight) lookActive = false;
    }
});

// --- СЕТЕВАЯ СИНХРОНИЗАЦИЯ ---
socket.on('connect', () => {
    const cx = localPlayers[myId].x; const cz = localPlayers[myId].z;
    delete localPlayers[myId]; myId = socket.id;
    localPlayers[myId] = { id: myId, x: cx, z: cz, yaw: player3D.yaw };
});
socket.on('currentPlayers', (serverPlayers) => {
    Object.keys(serverPlayers).forEach(id => {
        if (id !== myId) localPlayers[id] = { id: id, x: serverPlayers[id].x, z: serverPlayers[id].y, yaw: 0, targetX: serverPlayers[id].x, targetZ: serverPlayers[id].y };
    });
});
socket.on('newPlayer', p => { if (p.id !== myId) localPlayers[p.id] = { id: p.id, x: p.x, z: p.y, yaw: 0, targetX: p.x, targetZ: p.y }; });
socket.on('playerMoved', p => { if (localPlayers[p.id] && p.id !== myId) { localPlayers[p.id].targetX = p.x; localPlayers[p.id].targetZ = p.y; } });
socket.on('playerDisconnected', id => { delete localPlayers[id]; });
socket.on('zombiesUpdate', data => { if (!isHost()) networkZombies = data.zombies; });

let lastUpdateTime = 0; let lastZombieNetTime = 0;

// --- ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ ---
function gameLoop() {
    engine.clear('#1a1c1e', '#142410');

    const me = localPlayers[myId];
    if (!me) { requestAnimationFrame(gameLoop); return; }

    const activeObstacles = []; const localZombies = [];
    const currentChunkX = Math.floor(player3D.x / CHUNK_PIXELS);
    const currentChunkZ = Math.floor(player3D.z / CHUNK_PIXELS);
    const viewRadius = 3;

    for (let cx = currentChunkX - viewRadius; cx <= currentChunkX + viewRadius; cx++) {
        for (let cz = currentChunkZ - viewRadius; cz <= currentChunkZ + viewRadius; cz++) {
            const chunk = getChunk(cx, cz);
            for (let x = 0; x < CHUNK_SIZE; x++) {
                for (let z = 0; z < CHUNK_SIZE; z++) {
                    const wX = (cx * CHUNK_SIZE + x) * TILE_SIZE;
                    const wZ = (cz * CHUNK_SIZE + z) * TILE_SIZE;
                    if (chunk.tiles[x][z].object) {
                        activeObstacles.push({ type: chunk.tiles[x][z].object, x: wX + TILE_SIZE/2, z: wZ + TILE_SIZE/2, r: 15 });
                    }
                    // Пушим блоки земли прямо в движок
                    engine.pushFloor(wX, wZ, wX + TILE_SIZE, wZ, wX + TILE_SIZE, wZ + TILE_SIZE, wX, wZ + TILE_SIZE, chunk.tiles[x][z].color);
                }
            }
            chunk.zombies.forEach(z => localZombies.push(z));
        }
    }

    // Джойстик перемещения
    if (joystickActive) {
        const dx = joystickCurrent.x - joystickStart.x; const dy = joystickCurrent.y - joystickStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 5) {
            const speed = 3.5;
            const moveAngle = Math.atan2(dy, dx) + player3D.yaw + Math.PI / 2;
            let nextX = player3D.x + Math.sin(moveAngle) * speed;
            let nextZ = player3D.z - Math.cos(moveAngle) * speed;

            let canMove = true;
            for (let obs of activeObstacles) {
                if (Math.sqrt(Math.pow(nextX - obs.x, 2) + Math.pow(nextZ - obs.z, 2)) < 16 + obs.r) { canMove = false; break; }
            }
            if (canMove) {
                player3D.x = nextX; player3D.z = nextZ;
                me.x = player3D.x; me.z = player3D.z;

                const now = Date.now();
                if (myId !== "local_player" && now - lastUpdateTime > 45) {
                    socket.emit('playerMovement', { x: player3D.x, y: player3D.z });
                    lastUpdateTime = now;
                }
            }
        }
    }

    // Расчет ИИ Зомби хостом
    const now = Date.now();
    if (isHost()) {
        localZombies.forEach(z => {
            const distToMe = Math.sqrt(Math.pow(player3D.x - z.x, 2) + Math.pow(player3D.z - z.z, 2));
            if (distToMe < 250) { z.state = 'chase'; z.targetX = player3D.x; z.targetZ = player3D.z; } 
            else {
                if (z.state === 'chase') z.state = 'idle';
                if (now - z.lastDecision > 2500) {
                    z.lastDecision = now; z.targetX = z.x + (Math.random() * 80 - 40); z.targetZ = z.z + (Math.random() * 80 - 40);
                }
            }
            const zDx = z.targetX - z.x; const zDz = z.targetZ - z.z; const zDist = Math.sqrt(zDx * zDx + zDz * zDz);
            if (zDist > 3) { z.x += (zDx / zDist) * z.speed; z.z += (zDz / zDist) * z.speed; }
        });

        if (now - lastZombieNetTime > 60 && myId !== "local_player") {
            socket.emit('shareZombies', localZombies.map(z => ({ id: z.id, x: z.x, y: z.z, state: z.state })));
            lastZombieNetTime = now;
        }
    }

    // Синхронизируем положение камеры движка с позицией игрока
    engine.updateCamera(player3D.x, player3D.z, player3D.yaw, player3D.pitch);

    // Загружаем статичные объекты чанка в движок
    activeObstacles.forEach(obs => engine.pushSprite(obs.type, obs.x, obs.z));

    // Загружаем зомби в движок
    const currentZombies = isHost() ? localZombies : networkZombies;
    currentZombies.forEach(z => engine.pushSprite('zombie', z.x, z.z || z.y, { state: z.state }));

    // Если включено 3-е лицо или вид сверху — рисуем зеленое тело самого себя!
    if (engine.viewMode !== 1) {
        engine.pushSprite('local_body', player3D.x, player3D.z, { name: "Вы" });
    }

    // Загружаем сетевых игроков в движок
    Object.keys(localPlayers).forEach(id => {
        if (id !== myId) {
            const p = localPlayers[id];
            if (p.targetX !== undefined) { p.x += (p.targetX - p.x)*0.1; p.z += (p.targetZ - p.z)*0.1; }
            engine.pushSprite('net_player', p.x, p.z, { id: id, name: `Игрок_${id.substring(0,4)}` });
        }
    });

    // Отрисовываем сцену
    engine.render();

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

function toggleCraftMenu() { document.getElementById('craft-menu').classList.toggle('hidden'); }
