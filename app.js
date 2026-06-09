const socket = io('https://z-zone-online.onrender.com');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- НАСТРОЙКИ НАШЕГО 3D ДВИЖКА ---
const FOV = 400; // Фокусное расстояние (угол обзора)
const PLAYER_HEIGHT = 20; // Высота глаз игрока над землей

// Позиция нашей камеры в 3D мире
let player3D = {
    x: 1500,
    y: PLAYER_HEIGHT,
    z: 1500,
    yaw: 0,   // Поворот головы влево/вправо
    pitch: 0  // Поворот головы вверх/вниз
};

let localPlayers = {};
let myId = "local_player";
localPlayers[myId] = { x: player3D.x, z: player3D.z, yaw: 0 };

const TILE_SIZE = 60;
const CHUNK_SIZE = 6;
const CHUNK_PIXELS = CHUNK_SIZE * TILE_SIZE;
const loadedChunks = {};
let networkZombies = [];

function isHost() {
    return Object.keys(localPlayers).sort()[0] === myId;
}

// Генератор 3D чанков
function getChunk(chunkX, chunkY) {
    const chunkKey = `${chunkX},${chunkY}`;
    if (loadedChunks[chunkKey]) return loadedChunks[chunkKey];

    const tiles = [];
    const zombies = [];

    for (let x = 0; x < CHUNK_SIZE; x++) {
        tiles[x] = [];
        for (let y = 0; y < CHUNK_SIZE; y++) {
            const worldX = chunkX * CHUNK_SIZE + x;
            const worldZ = chunkY * CHUNK_SIZE + y;
            const noise = Math.abs(Math.sin(worldX * 12.9898 + worldZ * 78.233)) * 43758.5453 % 1;

            let color = '#2c5e1a';
            let objType = null;

            if (noise > 0.85) color = '#387822';
            if (noise < 0.15) color = '#1e4011';

            if (noise > 0.97) objType = 'tree';
            else if (noise < 0.015) objType = 'stone';

            tiles[x][y] = { color: color, object: objType };

            if (!objType && noise > 0.94 && noise < 0.952) {
                zombies.push({
                    id: `z3d_${worldX}_${worldZ}`,
                    x: worldX * TILE_SIZE + TILE_SIZE/2,
                    z: worldZ * TILE_SIZE + TILE_SIZE/2,
                    speed: 1.0,
                    state: 'idle',
                    targetX: worldX * TILE_SIZE + TILE_SIZE/2,
                    targetZ: worldZ * TILE_SIZE + TILE_SIZE/2,
                    lastDecision: 0
                });
            }
        }
    }
    loadedChunks[chunkKey] = { tiles: tiles, zombies: zombies };
    return loadedChunks[chunkKey];
}

// --- МАТЕМАТИКА СВОЕГО 3D ДВИЖКА (ПРОЕКЦИЯ ТОЧКИ НА ЭКРАН) ---
function project3D(worldX, worldY, worldZ) {
    // 1. Сдвиг относительно позиции игрока (камеры)
    let dx = worldX - player3D.x;
    let dy = worldY - player3D.y;
    let dz = worldZ - player3D.z;

    // 2. Вращение по горизонтали (Yaw - влево/вправо)
    const cosY = Math.cos(player3D.yaw);
    const sinY = Math.sin(player3D.yaw);
    let rx = dx * cosY - dz * sinY;
    let rz = dx * sinY + dz * cosY;

    // 3. Вращение по вертикали (Pitch - вверх/вниз)
    const cosP = Math.cos(player3D.pitch);
    const sinP = Math.sin(player3D.pitch);
    let ry = dy * cosP - rz * sinP;
    rz = dy * sinP + rz * cosP;

    // Если объект находится за спиной камеры, не рисуем его
    if (rz <= 0.1) return null;

    // 4. Перспективная проекция на плоскость экрана телефона
    const screenX = (rx * FOV) / rz + canvas.width / 2;
    const screenY = (ry * FOV) / rz + canvas.height / 2;

    return { x: screenX, y: screenY, size: FOV / rz, depth: rz };
}

// --- МОБИЛЬНОЕ ДВУХЗОННОЕ УПРАВЛЕНИЕ (SPLIT-TOUCH) ---
let joystickActive = false;
let joystickStart = { x: 0, y: 0 };
let joystickCurrent = { x: 0, y: 0 };

// Переменные для обзора правой частью экрана
let lookActive = false;
let lastLookTouch = { x: 0, y: 0 };

window.addEventListener('touchstart', (e) => {
    for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        // Левая половина экрана — джойстик ходьбы
        if (touch.clientX < window.innerWidth / 2 && !joystickActive) {
            joystickActive = true;
            joystickStart = { x: touch.clientX, y: touch.clientY };
            joystickCurrent = { x: touch.clientX, y: touch.clientY };
        }
        // Правая половина экрана — вращение камеры (обзор)
        if (touch.clientX >= window.innerWidth / 2 && !lookActive) {
            lookActive = true;
            lastLookTouch = { x: touch.clientX, y: touch.clientY };
        }
    }
});

window.addEventListener('touchmove', (e) => {
    for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (touch.clientX < window.innerWidth / 2 && joystickActive) {
            joystickCurrent = { x: touch.clientX, y: touch.clientY };
        }
        if (touch.clientX >= window.innerWidth / 2 && lookActive) {
            // Рассчитываем, на сколько сдвинулся палец, и вращаем камеру
            const movementX = touch.clientX - lastLookTouch.x;
            const movementY = touch.clientY - lastLookTouch.y;

            player3D.yaw += movementX * 0.007;
            player3D.pitch -= movementY * 0.007;

            // Ограничение, чтобы нельзя было сломать шею назад
            player3D.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, player3D.pitch));

            lastLookTouch = { x: touch.clientX, y: touch.clientY };
        }
    }
});

window.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
        joystickActive = false;
        lookActive = false;
    } else {
        // Если один палец убрали, проверяем какой остался
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
socket.on('newPlayer', p => {
    if (p.id !== myId) localPlayers[p.id] = { id: p.id, x: p.x, z: p.y, yaw: 0, targetX: p.x, targetZ: p.y };
});
socket.on('playerMoved', p => {
    if (localPlayers[p.id] && p.id !== myId) { localPlayers[p.id].targetX = p.x; localPlayers[p.id].targetZ = p.y; }
});
socket.on('playerDisconnected', id => { delete localPlayers[id]; });
socket.on('zombiesUpdate', data => { if (!isHost()) networkZombies = data.zombies; });

let lastUpdateTime = 0; let lastZombieNetTime = 0;

// --- ИГРОВОЙ ЦИКЛ НАШЕЙ 3D КОНСОЛИ ---
function gameLoop() {
    // Небо и земля (задний фон)
    ctx.fillStyle = '#1a1c1e'; // Ночное небо
    ctx.fillRect(0, 0, canvas.width, canvas.height / 2);
    ctx.fillStyle = '#142410'; // Темная дальняя земля
    ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height);

    const me = localPlayers[myId];
    if (!me) { requestAnimationFrame(gameLoop); return; }

    const activeObstacles = []; const localZombies = [];

    // Расчет видимых чанков вокруг 3D камеры
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
                }
            }
            chunk.zombies.forEach(z => localZombies.push(z));
        }
    }

    // 1. ДВИЖЕНИЕ В 3D С УЧЕТОМ НАПРАВЛЕНИЯ ВЗГЛЯДА
    if (joystickActive) {
        const dx = joystickCurrent.x - joystickStart.x;
        const dy = joystickCurrent.y - joystickStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 5) {
            const speed = 3.5;
            // Переводим вектор джойстика относительно угла взгляда камеры player3D.yaw
            const moveAngle = Math.atan2(dy, dx) + player3D.yaw + Math.PI / 2;

            let nextX = player3D.x + Math.sin(moveAngle) * speed;
            let nextZ = player3D.z - Math.cos(moveAngle) * speed;

            // Коллизии (Игрок упирается в 3D объекты)
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

    // 2. ИИ ЗОМБИ В 3D МИРЕ
    const now = Date.now();
    if (isHost()) {
        localZombies.forEach(z => {
            const distToMe = Math.sqrt(Math.pow(player3D.x - z.x, 2) + Math.pow(player3D.z - z.z, 2));
            if (distToMe < 250) {
                z.state = 'chase'; z.targetX = player3D.x; z.targetZ = player3D.z;
            } else {
                if (z.state === 'chase') z.state = 'idle';
                if (now - z.lastDecision > 2500) {
                    z.lastDecision = now;
                    z.targetX = z.x + (Math.random() * 80 - 40); z.targetZ = z.z + (Math.random() * 80 - 40);
                }
            }

            const zDx = z.targetX - z.x; const zDz = z.targetZ - z.z;
            const zDist = Math.sqrt(zDx * zDx + zDz * zDz);
            if (zDist > 3) {
                z.x += (zDx / zDist) * z.speed; z.z += (zDz / zDist) * z.speed;
            }
        });

        if (now - lastZombieNetTime > 60 && myId !== "local_player") {
            socket.emit('shareZombies', localZombies.map(z => ({ id: z.id, x: z.x, y: z.z, state: z.state })));
            lastZombieNetTime = now;
        }
    }

    // --- ОЧЕРЕДЬ КЛИППИНГА И СОРТИРОВКИ 3D ПОЛИГОНОВ ---
    const render3DQueue = [];

    // Собираем 3D Блоки Земли
    for (let cx = currentChunkX - viewRadius; cx <= currentChunkX + viewRadius; cx++) {
        for (let cz = currentChunkZ - viewRadius; cz <= currentChunkZ + viewRadius; cz++) {
            const chunk = getChunk(cx, cz);
            for (let x = 0; x < CHUNK_SIZE; x++) {
                for (let z = 0; z < CHUNK_SIZE; z++) {
                    const wX = (cx * CHUNK_SIZE + x) * TILE_SIZE;
                    const wZ = (cz * CHUNK_SIZE + z) * TILE_SIZE;

                    // Проецируем углы плитки земли в 3D
                    const p0 = project3D(wX, 0, wZ);
                    const p1 = project3D(wX + TILE_SIZE, 0, wZ);
                    const p2 = project3D(wX + TILE_SIZE, 0, wZ + TILE_SIZE);
                    const p3 = project3D(wX, 0, wZ + TILE_SIZE);

                    if (p0 && p1 && p2 && p3) {
                        const avgDepth = (p0.depth + p1.depth + p2.depth + p3.depth) / 4;
                        render3DQueue.push({
                            type: 'floor', points: [p0, p1, p2, p3], color: chunk.tiles[x][z].color, depth: avgDepth
                        });
                    }
                }
            }
        }
    }

    // Собираем декорации (Деревья и камни в 3D)
    activeObstacles.forEach(obs => {
        const p = project3D(obs.x, 0, obs.z);
        if (p) render3DQueue.push({ type: obs.type, p: p, depth: p.depth });
    });

    // Собираем Зомби в 3D
    const currentZombies = isHost() ? localZombies : networkZombies;
    currentZombies.forEach(z => {
        const p = project3D(z.x, 0, z.z || z.y); // фикс если сервер шлет y вместо z
        if (p) render3DQueue.push({ type: 'zombie', p: p, state: z.state, depth: p.depth });
    });

    // Собираем других игроков
    Object.keys(localPlayers).forEach(id => {
        if (id !== myId) {
            const p = localPlayers[id];
            // Интерполяция
            if (p.targetX !== undefined) { p.x += (p.targetX - p.x)*0.1; p.z += (p.targetZ - p.z)*0.1; }
            const proj = project3D(p.x, 0, p.z);
            if (proj) render3DQueue.push({ type: 'net_player', id: id, p: proj, depth: proj.depth });
        }
    });

    // 🔥 СОРТИРОВКА ГЛУБИНЫ ДЛЯ 3D (Z-Buffer наоборот): Сначала рисуем дальнее, потом ближнее
    render3DQueue.sort((a, b) => b.depth - a.depth);

    // 3. ОТРИСОВКА ВСЕЙ 3D СЦЕНЫ НА CANVAS
    render3DQueue.forEach(obj => {
        if (obj.type === 'floor') {
            // Рисуем 3D полигон земли
            ctx.fillStyle = obj.color;
            ctx.beginPath();
            ctx.moveTo(obj.points[0].x, obj.points[0].y);
            ctx.lineTo(obj.points[1].x, obj.points[1].y);
            ctx.lineTo(obj.points[2].x, obj.points[2].y);
            ctx.lineTo(obj.points[3].x, obj.points[3].y);
            ctx.closePath();
            ctx.fill();

            // Контур сетки в 3D перспективе
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();

        } else if (obj.type === 'tree') {
            // Дерево: Коричневый конус-ствол и Зеленый треугольник-крона
            const size = obj.p.size * 25;
            ctx.fillStyle = '#5c3a16'; // Ствол
            ctx.fillRect(obj.p.x - size*0.15, obj.p.y - size, size*0.3, size);
            
            ctx.fillStyle = '#1b4f10'; // Шапка листвы
            ctx.beginPath();
            ctx.moveTo(obj.p.x - size*0.8, obj.p.y - size);
            ctx.lineTo(obj.p.x + size*0.8, obj.p.y - size);
            ctx.lineTo(obj.p.x, obj.p.y - size * 2.3);
            ctx.closePath();
            ctx.fill();

        } else if (obj.type === 'stone') {
            // Камень: 3D серый трапециевидный блок
            const size = obj.p.size * 18;
            ctx.fillStyle = '#616161';
            ctx.beginPath();
            ctx.moveTo(obj.p.x - size, obj.p.y);
            ctx.lineTo(obj.p.x - size*0.6, obj.p.y - size);
            ctx.lineTo(obj.p.x + size*0.6, obj.p.y - size);
            ctx.lineTo(obj.p.x + size, obj.p.y);
            ctx.closePath();
            ctx.fill();

        } else if (obj.type === 'zombie') {
            // Зомби: Объемный зеленый прямоугольник с красными глазами, бегущий на тебя
            const size = obj.p.size * 22;
            ctx.fillStyle = '#325c27'; // Тело зомби
            ctx.fillRect(obj.p.x - size*0.4, obj.p.y - size * 1.5, size*0.8, size * 1.5);

            // Голова
            ctx.fillStyle = '#417534';
            ctx.fillRect(obj.p.x - size*0.25, obj.p.y - size * 2.1, size*0.5, size * 0.6);

            // Горящие глаза мертвеца
            ctx.fillStyle = obj.state === 'chase' ? '#ff0000' : '#ffaa00';
            ctx.fillRect(obj.p.x - size*0.15, obj.p.y - size * 1.9, size*0.08, size*0.08);
            ctx.fillRect(obj.p.x + size*0.07, obj.p.y - size * 1.9, size*0.08, size*0.08);

        } else if (obj.type === 'net_player') {
            // Чужой игрок в нашем 3D мире
            const size = obj.p.size * 22;
            ctx.fillStyle = '#e63946'; // Красный вражеский/союзный куб
            ctx.fillRect(obj.p.x - size*0.4, obj.p.y - size * 1.5, size*0.8, size * 1.5);
            
            ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
            ctx.fillText(`Игрок_${obj.id.substring(0,4)}`, obj.p.x, obj.p.y - size * 2.3);
        }
    });

    // Прицел по центру экрана (консольная классика)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(canvas.width/2 - 10, canvas.height/2); ctx.lineTo(canvas.width/2 + 10, canvas.height/2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(canvas.width/2, canvas.height/2 - 10); ctx.lineTo(canvas.width/2, canvas.height/2 + 10); ctx.stroke();

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

function toggleCraftMenu() {
    document.getElementById('craft-menu').classList.toggle('hidden');
}
