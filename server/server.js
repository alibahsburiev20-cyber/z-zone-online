const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Разрешаем подключение с любых сайтов (чтобы наш клиент на Vercel мог достучаться)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const players = {};

io.on('connection', (socket) => {
    console.log(`Игрок зашел: ${socket.id}`);

    // Создаем профиль выжившего в памяти сервера
    players[socket.id] = {
        id: socket.id,
        x: 150, // Стартовая позиция в пикселях
        y: 150,
        hp: 100,
        inventory: [
            { item: "wood", count: 10 },
            { item: "tape", count: 2 }
        ]
    };

    // Передаем новичку список всех, кто уже играет
    socket.emit('currentPlayers', players);
    // Остальным игрокам шлем инфу о новом выжившем
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Когда игрок идет, он шлет свои координаты сюда
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            // Сервер мгновенно транслирует это движение ВСЕМ остальным
            io.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Игрок вышел: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

// На Render.com порт выдается автоматически через process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
