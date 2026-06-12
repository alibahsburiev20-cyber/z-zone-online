// ==========================================
// 1. ИНИЦИАЛИЗАЦИЯ И НАСТРОЙКИ (Mobile First)
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Функция подгонки экрана под телефон (вызывается при старте и перевороте экрана)
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Отключаем скроллинг и "щипок" (зум) на телефоне, чтобы канвас вел себя как игра
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// Глобальные переменные состояния
let players = {};
let gameObjects = []; 
let myId = null;

// Настройка сокетов
const socket = io();

socket.on('connect', () => {
    myId = socket.id;
});

socket.on('stateUpdate', (state) => {
    players = state.players || {};
    gameObjects = state.objects || [];
});

// ==========================================
// 2. ЗАГРУЗЧИК СПРАЙТОВ
// ==========================================
const images = {};
const imageNames = ['player_run']; // Твоя лента из 8 кадров
let imagesLoaded = 0;

imageNames.forEach(name => {
    images[name] = new Image();
    images[name].src = `assets/${name}.png`;
    images[name].onload = () => {
        imagesLoaded++;
        if (imagesLoaded === imageNames.length) {
            requestAnimationFrame(gameLoop);
        }
    };
});

// ==========================================
// 3. ВИРТУАЛЬНЫЙ ДЖОЙСТИК (Сенсорное управление)
// ==========================================
const joystick = {
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    maxRadius: 40 
};

let mobileDx = 0;
let mobileDy = 0;

window.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    // Джойстик работает только в левой половине экрана
    if (touch.clientX < window.innerWidth / 2) {
        joystick.active = true;
        joystick.startX = touch.clientX;
        joystick.startY = touch.clientY;
        joystick.currentX = touch.clientX;
        joystick.currentY = touch.clientY;
    }
});

window.addEventListener('touchmove', (e) => {
    if (!joystick.active) return;
    const touch = e.touches[0];
    
    let diffX = touch.clientX - joystick.startX;
    let diffY = touch.clientY - joystick.startY;
    let distance = Math.sqrt(diffX * diffX + diffY * diffY);

    if (distance > joystick.maxRadius) {
        diffX = (diffX / distance) * joystick.maxRadius;
        diffY = (diffY / distance) * joystick.maxRadius;
    }

    joystick.currentX = joystick.startX + diffX;
    joystick.currentY = joystick.startY + diffY;

    // Мертвая зона (10px), чтобы избежать случайных микро-шагов
    mobileDx = Math.abs(diffX) > 10 ? Math.sign(diffX) : 0;
    mobileDy = Math.abs(diffY) > 10 ? Math.sign(diffY) : 0;
});

window.addEventListener('touchend', () => {
    joystick.active = false;
    mobileDx = 0;
    mobileDy = 0;
});

// ==========================================
// 4. ИЗОМЕТРИЧЕСКАЯ МАТЕМАТИКА
// ==========================================
function toIso(x, y) {
    const isoX = x - y;
    const isoY = (x + y) / 2;
    return { 
        x: isoX + canvas.width / 2, 
        y: isoY + canvas.height / 4 
    };
}

// ==========================================
// 5. ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ (РЕНДЕР)
// ==========================================
function gameLoop() {
    // Фон (земля)
    ctx.fillStyle = '#2d4c1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderQueue = [];

    // Подготовка игроков
    for (let id in players) {
        let p = players[id];
        let screenPos = toIso(p.x, p.y);
        renderQueue.push({
            type: 'player',
            id: id,
            hp: p.hp || 100,
            x: p.x,
            y: p.y,
            screenX: screenPos.x,
            screenY: screenPos.y,
            sortY: screenPos.y 
        });
    }

    // Подготовка объектов
    gameObjects.forEach(obj => {
        let screenPos = toIso(obj.x, obj.y);
        renderQueue.push({
            type: obj.type, 
            screenX: screenPos.x,
            screenY: screenPos.y,
            sortY: screenPos.y
        });
    });

    // Сортировка (Z-Index) для правильного наложения объектов
    renderQueue.sort((a, b) => a.sortY - b.sortY);

    // Отрисовка
    renderQueue.forEach(obj => {
        const { screenX, screenY } = obj;

        if (obj.type === 'player') {
            // --- РЕНДЕР ИГРОКА (ALI STYLE) ---
            
            // Тень
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(screenX, screenY + 2, 16, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            // Анимация спрайта
            const totalFrames = 8;
            const spriteWidth = images['player_run'].width / totalFrames;
            const spriteHeight = images['player_run'].height;
            
            // Меняем кадр только если игрок движется (есть скорость сервера или зажат джойстик)
            // Пока делаем постоянную анимацию для проверки
            const currentFrame = Math.floor(Date.now() / 100) % totalFrames;

            ctx.drawImage(
                images['player_run'],
                currentFrame * spriteWidth, 0, 
                spriteWidth, spriteHeight,     
                screenX - (spriteWidth / 2),   
                screenY - spriteHeight + 8,    
                spriteWidth, spriteHeight      
            );

            // Никнейм
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(obj.id === myId ? "Вы" : `Игрок`, screenX, screenY - spriteHeight - 5);

            // Полоска здоровья
            const barW = 32;
            const barH = 4;
            ctx.fillStyle = '#222';
            ctx.fillRect(screenX - barW / 2, screenY - spriteHeight - 15, barW, barH);
            ctx.fillStyle = '#ff3333';
            ctx.fillRect(screenX - barW / 2, screenY - spriteHeight - 15, barW * (obj.hp / 100), barH);
        } 
        else if (obj.type === 'tree') {
            ctx.fillStyle = '#4a3018'; 
            ctx.fillRect(screenX - 5, screenY - 20, 10, 20);
            ctx.fillStyle = '#1e5928'; 
            ctx.beginPath();
            ctx.arc(screenX, screenY - 25, 15, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // Отрисовка UI джойстика ПОВЕРХ игры
    if (joystick.active) {
        ctx.beginPath();
        ctx.arc(joystick.startX, joystick.startY, joystick.maxRadius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(joystick.currentX, joystick.currentY, 15, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fill();
    }

    requestAnimationFrame(gameLoop);
}

// ==========================================
// 6. ОТПРАВКА ДАННЫХ НА СЕРВЕР
// ==========================================
setInterval(() => {
    let dx = 0;
    let dy = 0;

    // Конвертация направления джойстика в изометрические координаты сервера
    if (joystick.active) {
        if (mobileDy < 0 && mobileDx === 0) { dx = -1; dy = -1; } // Вверх
        if (mobileDy > 0 && mobileDx === 0) { dx = 1; dy = 1; }   // Вниз
        if (mobileDx < 0 && mobileDy === 0) { dx = -1; dy = 1; }  // Влево
        if (mobileDx > 0 && mobileDy === 0) { dx = 1; dy = -1; }  // Вправо
        
        // Диагональные направления джойстика
        if (mobileDy < 0 && mobileDx < 0) { dx = -1; dy = 0; } // Вверх-влево
        if (mobileDy < 0 && mobileDx > 0) { dx = 0; dy = -1; } // Вверх-вправо
        if (mobileDy > 0 && mobileDx < 0) { dx = 0; dy = 1; }  // Вниз-влево
        if (mobileDy > 0 && mobileDx > 0) { dx = 1; dy = 0; }  // Вниз-вправо
    }

    if (dx !== 0 || dy !== 0) {
        socket.emit('move', { dx, dy });
    }
}, 50);
