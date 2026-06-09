/**
 * Ali3D.js - Самодельный 3D-Движок на чистом Canvas 2D
 * Поддерживает режимы: 1-е лицо, 3-е лицо, 2D/Изометрия сверху.
 */
class Ali3D {
    constructor(canvasId, fov = 400, playerHeight = 20) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.fov = fov;
        this.playerHeight = playerHeight;

        // Положение камеры в пространстве (вычисляется автоматически движком)
        this.camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
        
        // Режимы камеры: 1 - первое лицо, 3 - третье лицо, 2 - вид сверху (2D)
        this.viewMode = 1; 
        this.cameraDistance = 70; // Расстояние для 3-го лица

        this.renderQueue = [];
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    // Метод переключения режима камеры (1, 2 или 3)
    setViewMode(mode) {
        if ([1, 2, 3].includes(mode)) {
            this.viewMode = mode;
        }
    }

    // Обновление матрицы камеры на основе координат игрока
    updateCamera(playerX, playerZ, playerYaw, playerPitch) {
        this.camera.yaw = playerYaw;
        
        if (this.viewMode === 1) {
            // 1-е лицо: камера в голове
            this.camera.x = playerX;
            this.camera.y = this.playerHeight;
            this.camera.z = playerZ;
            this.camera.pitch = playerPitch;
        } 
        else if (this.viewMode === 3) {
            // 3-е лицо: камера за спиной
            this.camera.pitch = playerPitch + 0.2; // Чуть наклоняем вниз
            this.camera.x = playerX - Math.sin(playerYaw) * this.cameraDistance;
            this.camera.z = playerZ + Math.cos(playerYaw) * this.cameraDistance;
            this.camera.y = this.playerHeight + 35; // Приподнимаем над игроком
        } 
        else if (this.viewMode === 2) {
            // Вид сверху (2D / Изометрия)
            this.camera.pitch = Math.PI / 2.3; // Смотрим почти строго вниз
            this.camera.yaw = 0; // Блокируем вращение по горизонтали
            this.camera.x = playerX;
            this.camera.z = playerZ + 120; // Сдвиг для обзора
            this.camera.y = 250; // Высоко над землей
        }
    }

    // Магическая проекция 3D точки на 2D экран
    project(worldX, worldY, worldZ) {
        let dx = worldX - this.camera.x;
        let dy = worldY - this.camera.y;
        let dz = worldZ - this.camera.z;

        // Вращение Yaw (влево/вправо)
        const cosY = Math.cos(this.camera.yaw);
        const sinY = Math.sin(this.camera.yaw);
        let rx = dx * cosY - dz * sinY;
        let rz = dx * sinY + dz * cosY;

        // Вращение Pitch (вверх/вниз)
        const cosP = Math.cos(this.camera.pitch);
        const sinP = Math.sin(this.camera.pitch);
        let ry = dy * cosP - rz * sinP;
        rz = dy * sinP + rz * cosP;

        if (rz <= 0.1) return null; // Отсекаем то, что сзади

        const screenX = (rx * this.fov) / rz + this.canvas.width / 2;
        const screenY = (ry * this.fov) / rz + this.canvas.height / 2;

        return { x: screenX, y: screenY, size: this.fov / rz, depth: rz };
    }

    // Очистка кадра и заливка фона
    clear(skyColor = '#1a1c1e', groundColor = '#142410') {
        this.renderQueue = [];
        // В режимах 1 и 3 рисуем горизонт, в режиме 2 (вид сверху) — всё заливаем землей
        if (this.viewMode === 2) {
            this.ctx.fillStyle = groundColor;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        } else {
            this.ctx.fillStyle = skyColor;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height / 2);
            this.ctx.fillStyle = groundColor;
            this.ctx.fillRect(0, this.canvas.height / 2, this.canvas.width, this.canvas.height);
        }
    }

    // Добавить полигон пола в очередь рендера
    pushFloor(p0x, p0z, p1x, p1z, p2x, p2z, p3x, p3z, color) {
        const p0 = this.project(p0x, 0, p0z);
        const p1 = this.project(p1x, 0, p1z);
        const p2 = this.project(p2x, 0, p2z);
        const p3 = this.project(p3x, 0, p3z);

        if (p0 && p1 && p2 && p3) {
            const avgDepth = (p0.depth + p1.depth + p2.depth + p3.depth) / 4;
            this.renderQueue.push({ type: 'floor', points: [p0, p1, p2, p3], color: color, depth: avgDepth });
        }
    }

    // Добавить объект (спрайт) в очередь рендера
    pushSprite(type, worldX, worldZ, extraData = {}) {
        const p = this.project(worldX, 0, worldZ);
        if (p) {
            this.renderQueue.push({ type: type, p: p, depth: p.depth, ...extraData });
        }
    }

    // Отрисовка всех объектов с сортировкой по глубине (Z-Buffer)
    render() {
        // Сортируем: сначала дальние, потом ближние
        this.renderQueue.sort((a, b) => b.depth - a.depth);

        this.renderQueue.forEach(obj => {
            if (obj.type === 'floor') {
                this.ctx.fillStyle = obj.color;
                this.ctx.beginPath();
                this.ctx.moveTo(obj.points[0].x, obj.points[0].y);
                this.ctx.lineTo(obj.points[1].x, obj.points[1].y);
                this.ctx.lineTo(obj.points[2].x, obj.points[2].y);
                this.ctx.lineTo(obj.points[3].x, obj.points[3].y);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.strokeStyle = 'rgba(0,0,0,0.12)';
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
            } 
            else if (obj.type === 'tree') {
                const size = obj.p.size * 25;
                this.ctx.fillStyle = '#5c3a16';
                this.ctx.fillRect(obj.p.x - size*0.15, obj.p.y - size, size*0.3, size);
                this.ctx.fillStyle = '#1b4f10';
                this.ctx.beginPath();
                this.ctx.moveTo(obj.p.x - size*0.8, obj.p.y - size);
                this.ctx.lineTo(obj.p.x + size*0.8, obj.p.y - size);
                this.ctx.lineTo(obj.p.x, obj.p.y - size * 2.3);
                this.ctx.closePath();
                this.ctx.fill();
            } 
            else if (obj.type === 'stone') {
                const size = obj.p.size * 18;
                this.ctx.fillStyle = '#616161';
                this.ctx.beginPath();
                this.ctx.moveTo(obj.p.x - size, obj.p.y);
                this.ctx.lineTo(obj.p.x - size*0.6, obj.p.y - size);
                this.ctx.lineTo(obj.p.x + size*0.6, obj.p.y - size);
                this.ctx.lineTo(obj.p.x + size, obj.p.y);
                this.ctx.closePath();
                this.ctx.fill();
            } 
            else if (obj.type === 'zombie') {
                const size = obj.p.size * 22;
                this.ctx.fillStyle = '#325c27';
                this.ctx.fillRect(obj.p.x - size*0.4, obj.p.y - size * 1.5, size*0.8, size * 1.5);
                this.ctx.fillStyle = '#417534';
                this.ctx.fillRect(obj.p.x - size*0.25, obj.p.y - size * 2.1, size*0.5, size * 0.6);
                this.ctx.fillStyle = obj.state === 'chase' ? '#ff0000' : '#ffaa00';
                this.ctx.fillRect(obj.p.x - size*0.15, obj.p.y - size * 1.9, size*0.08, size*0.08);
                this.ctx.fillRect(obj.p.x + size*0.07, obj.p.y - size * 1.9, size*0.08, size*0.08);
            } 
            else if (obj.type === 'net_player' || obj.type === 'local_body') {
                const size = obj.p.size * 22;
                this.ctx.fillStyle = (obj.type === 'local_body') ? '#00ff66' : '#e63946';
                this.ctx.fillRect(obj.p.x - size*0.4, obj.p.y - size * 1.5, size*0.8, size * 1.5);
                this.ctx.fillStyle = '#fff';
                this.ctx.font = 'bold 11px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(obj.name, obj.p.x, obj.p.y - size * 2.3);
            }
        });

        // В режиме от 1-го лица рисуем прицел
        if (this.viewMode === 1) {
            this.ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath(); this.ctx.moveTo(this.canvas.width/2 - 10, this.canvas.height/2); this.ctx.lineTo(this.canvas.width/2 + 10, this.canvas.height/2); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(this.canvas.width/2, this.canvas.height/2 - 10); this.ctx.lineTo(this.canvas.width/2, this.canvas.height/2 + 10); this.ctx.stroke();
        }
    }
}
