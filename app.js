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
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    hp: 100
};

const joystickZone = document.getElementById('joystick-zone');
let joystickActive = false;
let joystickStart = { x: 0, y: 0 };
let joystickCurrent = { x: 0, y: 0 };

socket.on('connect', () => {
    console.log("Успешно подключились к Render серверу!");
    const currentX = localPlayers[myId].x;
    const currentY = localPlayers[myId].y;
    delete localPlayers[myId];
    myId = socket.id;
    
    localPlayers[myId] = {
        id: myId,
        x: currentX,
        y: currentY,
        hp: 100
    };
});

socket.on('currentPlayers', (serverPlayers) => {
    Object.keys(serverPlayers).forEach((id) => {
        if (id !== myId) {
            // Для чужих игроков создаем не только текущие координаты, но и "целевые" (target)
            localPlayers[id] = {
                id: id,
                x: serverPlayers[id].x,
                y: serverPlayers[id].y,
                targetX: serverPlayers[id].x,
                targetY: serverPlayers[id].y,
                hp: serverPlayers[id].hp
            };
        }
    });
});

socket.on('newPlayer', (playerInfo) => {
    if (playerInfo.id !== myId) {
        localPlayers[playerInfo.id] = {
            id: playerInfo.id,
            x: playerInfo.x,
            y: playerInfo.y,
            targetX: playerInfo.x,
            targetY: playerInfo.y,
            hp: playerInfo.hp
        };
    }
});

// Когда кто-то движется, мы НЕ телепортируем его, а просто записываем новую ЦЕЛЬ
socket.on('playerMoved', (playerInfo) => {
    if (playerInfo.id !== myId) {
        if (!localPlayers[playerInfo.id]) {
            localPlayers[playerInfo.id] = { x: playerInfo.x, y: playerInfo.y };
        }
        // Запоминаем точку, куда игрок ДОЛЖЕН прийти по версии сервера
        localPlayers[playerInfo.id].targetX = playerInfo.x;
        localPlayers[playerInfo.id].targetY = playerInfo.y;
    }
});

socket.on('playerDisconnected', (id) => {
    delete localPlayers[id];
});

// --- УПРАВЛЕНИЕ ДЖОЙСТИКОМ ---
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

let lastUpdateTime = 0;

// --- ИГРОВОЙ ЦИКЛ С ИНТЕРПОЛЯЦИЕЙ ---
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Движение нашего игрока (клиентский просчет — мгновенный и плавный)
    if (joystickActive && localPlayers[myId]) {
        const dx = joystickCurrent.x - joystickStart.x;
        const dy = joystickCurrent.y - joystickStart.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            const speed = 5;
            localPlayers[myId].x += (dx / distance) * speed;
            localPlayers[myId].y += (dy / distance) * speed;

            const now = Date.now();
            if (myId !== "local_player" && now - lastUpdateTime > 40) { // Оптимальный шаг отправки пакетов
                socket.emit('playerMovement', {
                    x: localPlayers[myId].x,
                    y: localPlayers[myId].y
                });
                lastUpdateTime = now;
            }
        }
    }

    // Рисуем и ПЛАВНО двигаем всех игроков
    Object.keys(localPlayers).forEach((id) => {
        const p = localPlayers[id];

        if (id === myId) {
            ctx.fillStyle = '#00ff66'; // Мы зеленые
        } else {
            ctx.fillStyle = '#ff3333'; // Чужие игроки — красные
            
            // МАГИЯ ИНТЕРПОЛЯЦИИ: если координаты не совпадают с целью от сервера,
            // мы плавно двигаем игрока к этой цели на 15% за кадр
            if (p.targetX !== undefined && p.targetY !== undefined) {
                p.x += (p.targetX - p.x) * 0.15;
                p.y += (p.targetY - p.y) * 0.15;
            }
        }

        // Отрисовка круга
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Никнейм
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(id === myId ? "Вы" : `Игрок_${id.substring(0, 4)}`, p.x, p.y - 35);
    });

    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

function toggleCraftMenu() {
    const menu = document.getElementById('craft-menu');
    menu.classList.toggle('hidden');
}
