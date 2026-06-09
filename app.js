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
let myId = "local_player"; // Временный ID, пока сервер думает

// Сразу спавним себя по центру экрана, чтобы не смотреть на пустоту
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
    // Переключаемся на реальный ID от сервера
    if (localPlayers["local_player"]) {
        delete localPlayers["local_player"];
    }
    myId = socket.id;
});

socket.on('currentPlayers', (serverPlayers) => {
    localPlayers = serverPlayers;
    // Если сервера вернул пустые координаты, ставим центр
    if (localPlayers[myId] && (localPlayers[myId].x === 150)) {
        localPlayers[myId].x = window.innerWidth / 2;
        localPlayers[myId].y = window.innerHeight / 2;
    }
});

socket.on('newPlayer', (playerInfo) => {
    localPlayers[playerInfo.id] = playerInfo;
});

socket.on('playerMoved', (playerInfo) => {
    if (localPlayers[playerInfo.id]) {
        localPlayers[playerInfo.id].x = playerInfo.x;
        localPlayers[playerInfo.id].y = playerInfo.y;
    }
});

socket.on('playerDisconnected', (id) => {
    delete localPlayers[id];
});

// --- ДЖОЙСТИК ПОД ГОРИЗОНТАЛЬНЫЙ ЭКРАН ---
window.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    // Считываем нажатие в левой части экрана
    if (touch.clientX < window.innerWidth / 2) {
        joystickActive = true;
        joystickStart = { x: touch.clientX, y: touch.clientY };
        joystickCurrent = { x: touch.clientX, y: touch.clientY };
        
        // Визуально двигаем серый кружок под палец
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
    // Возвращаем джойстик на базу
    joystickZone.style.left = '40px';
    joystickZone.style.bottom = '30px';
});

// --- ОТРИСОВКА ---
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (joystickActive && localPlayers[myId]) {
        const dx = joystickCurrent.x - joystickStart.x;
        const dy = joystickCurrent.y - joystickStart.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            const speed = 5;
            localPlayers[myId].x += (dx / distance) * speed;
            localPlayers[myId].y += (dy / distance) * speed;

            // Шлем координаты на сервер, только если подключены
            if (myId !== "local_player") {
                socket.emit('playerMovement', {
                    x: localPlayers[myId].x,
                    y: localPlayers[myId].y
                });
            }
        }
    }

    // Рисуем игроков
    Object.keys(localPlayers).forEach((id) => {
        const p = localPlayers[id];

        if (id === myId) {
            ctx.fillStyle = '#00ff66'; // Мы зеленые
        } else {
            ctx.fillStyle = '#ff3333'; // Другие красные
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();

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
