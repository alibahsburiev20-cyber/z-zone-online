// Подключаемся к нашему рабочему серверу в облаке Render
const socket = io('https://z-zone-online.onrender.com');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Подгоняем размер игрового поля под экран телефона
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Хранилище всех игроков, о которых нам скажет сервер
let localPlayers = {};
let myId = null;

// Координаты виртуального джойстика
const joystickZone = document.getElementById('joystick-zone');
let joystickActive = false;
let joystickStart = { x: 0, y: 0 };
let joystickCurrent = { x: 0, y: 0 };

// 1. Слушаем сервер: получаем список всех игроков при входе
socket.on('currentPlayers', (serverPlayers) => {
    localPlayers = serverPlayers;
    myId = socket.id; // Запоминаем, какой ID у нашего телефона
});

// 2. Слушаем сервер: зашел новый игрок
socket.on('newPlayer', (playerInfo) => {
    localPlayers[playerInfo.id] = playerInfo;
});

// 3. Слушаем сервер: кто-то сдвинулся
socket.on('playerMoved', (playerInfo) => {
    if (localPlayers[playerInfo.id]) {
        localPlayers[playerInfo.id].x = playerInfo.x;
        localPlayers[playerInfo.id].y = playerInfo.y;
    }
});

// 4. Слушаем сервер: игрок вышел
socket.on('playerDisconnected', (id) => {
    delete localPlayers[id];
});

// --- СИСТЕМА ТАЧ-УПРАВЛЕНИЯ (ДЖОЙСТИК ПОД ПАЛЕЦ) ---
window.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    // Если тач в левой нижней части экрана — включаем джойстик
    if (touch.clientX < window.innerWidth / 2 && touch.clientY > window.innerHeight / 2) {
        joystickActive = true;
        joystickStart = { x: touch.clientX, y: touch.clientY };
        joystickCurrent = { x: touch.clientX, y: touch.clientY };
    }
});

window.addEventListener('touchmove', (e) => {
    if (!joystickActive) return;
    const touch = e.touches[0];
    joystickCurrent = { x: touch.clientX, y: touch.clientY };
});

window.addEventListener('touchend', () => {
    joystickActive = false;
});

// --- ИГРОВОЙ ЦИКЛ (ОТРИСОВКА ГРАФИКИ) ---
function gameLoop() {
    // Очищаем экран каждый кадр
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Логика движения своего персонажа
    if (joystickActive && myId && localPlayers[myId]) {
        const dx = joystickCurrent.x - joystickStart.x;
        const dy = joystickCurrent.y - joystickStart.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            // Скорость бега нашего выжившего
            const speed = 4;
            localPlayers[myId].x += (dx / distance) * speed;
            localPlayers[myId].y += (dy / distance) * speed;

            // Отправляем наши новые координаты на Render сервер
            socket.emit('playerMovement', {
                x: localPlayers[myId].x,
                y: localPlayers[myId].y
            });
        }
    }

    // Рисуем всех игроков на карте
    Object.keys(localPlayers).forEach((id) => {
        const p = localPlayers[id];

        if (id === myId) {
            ctx.fillStyle = '#00ff66'; // Наш персонаж — зеленый круг
        } else {
            ctx.fillStyle = '#ff3333'; // Другие игроки — красные круги
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
        ctx.fill();

        // Рисуем маленький ник над головой (первые 4 символа ID)
        ctx.fillStyle = '#fff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`Player_${id.substring(0, 4)}`, p.x, p.y - 30);
    });

    requestAnimationFrame(gameLoop);
}
// Запускаем отрисовку
requestAnimationFrame(gameLoop);

// --- ИНТЕРФЕЙС МЕНЮ ---
function toggleCraftMenu() {
    const menu = document.getElementById('craft-menu');
    menu.classList.toggle('hidden');
}

function sendCraft(recipeId) {
    alert(`Запрос на крафт ${recipeId} отправлен на сервер! (Механика будет в следующем обновлении)`);
}
