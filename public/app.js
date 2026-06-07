const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');
const chartCanvas = document.getElementById('chartCanvas');
const chartCtx = chartCanvas.getContext('2d');

let mapBounds = null;
let roads = [];

let viewState = {
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
    isDragging: false,
    lastX: 0,
    lastY: 0
};

let points = [];
let activeAlerts = [];
let selectedPoint = null;
let notificationPermission = false;
let notificationSupported = false;
let rafId = null;
let needsRedraw = false;
let canvasDPR = 1;

async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        mapBounds = config.mapBounds;
        if (config.roads) {
            roads = config.roads;
        } else {
            roads = generateDefaultRoads(mapBounds);
        }
    } catch (error) {
        console.error('加载配置失败，使用默认值:', error);
        mapBounds = {
            minLng: 116.365,
            maxLng: 116.440,
            minLat: 39.880,
            maxLat: 39.935
        };
        roads = generateDefaultRoads(mapBounds);
    }
}

function generateDefaultRoads(bounds) {
    const lngSpan = bounds.maxLng - bounds.minLng;
    const latSpan = bounds.maxLat - bounds.minLat;
    const cx = (bounds.minLng + bounds.maxLng) / 2;
    const cy = (bounds.minLat + bounds.maxLat) / 2;
    return [
        [[bounds.minLng + lngSpan * 0.1, cy], [bounds.maxLng - lngSpan * 0.1, cy]],
        [[cx, bounds.minLat + latSpan * 0.1], [cx, bounds.maxLat - latSpan * 0.1]],
        [[bounds.minLng + lngSpan * 0.3, bounds.minLat + latSpan * 0.3], [bounds.maxLng - lngSpan * 0.3, bounds.maxLat - latSpan * 0.3]],
        [[bounds.minLng + lngSpan * 0.4, bounds.maxLat - latSpan * 0.1], [bounds.maxLng - lngSpan * 0.3, bounds.minLat + latSpan * 0.2]]
    ];
}

async function init() {
    await loadConfig();
    resizeCanvas();
    setupEventListeners();
    requestNotificationPermission();
    loadPoints();
    loadActiveAlerts();
    setInterval(loadPoints, 10000);
    setInterval(loadActiveAlerts, 5000);
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    requestDraw();
}

function requestDraw() {
    if (!needsRedraw) {
        needsRedraw = true;
        rafId = requestAnimationFrame(() => {
            needsRedraw = false;
            drawMap();
        });
    }
}

function resizeCanvas() {
    const container = mapCanvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvasDPR = window.devicePixelRatio || 1;
    mapCanvas.width = w * canvasDPR;
    mapCanvas.height = h * canvasDPR;
    mapCanvas.style.width = w + 'px';
    mapCanvas.style.height = h + 'px';
    mapCtx.setTransform(canvasDPR, 0, 0, canvasDPR, 0, 0);
    requestDraw();
}

function setupEventListeners() {
    window.addEventListener('resize', resizeCanvas);

    mapCanvas.addEventListener('mousedown', (e) => {
        viewState.isDragging = true;
        viewState.lastX = e.clientX;
        viewState.lastY = e.clientY;
        mapCanvas.style.cursor = 'grabbing';
    });

    mapCanvas.addEventListener('mousemove', handleMouseMove);

    mapCanvas.addEventListener('mouseup', () => {
        viewState.isDragging = false;
        mapCanvas.style.cursor = 'grab';
    });

    mapCanvas.addEventListener('mouseleave', () => {
        viewState.isDragging = false;
        mapCanvas.style.cursor = 'grab';
    });

    mapCanvas.addEventListener('click', handleMapClick);

    mapCanvas.addEventListener('wheel', handleZoom);

    document.getElementById('zoomIn').addEventListener('click', () => {
        viewState.zoom = Math.min(viewState.zoom * 1.2, 5);
        requestDraw();
    });

    document.getElementById('zoomOut').addEventListener('click', () => {
        viewState.zoom = Math.max(viewState.zoom / 1.2, 0.5);
        requestDraw();
    });

    document.getElementById('resetView').addEventListener('click', () => {
        viewState.zoom = 1;
        viewState.offsetX = 0;
        viewState.offsetY = 0;
        requestDraw();
    });

    document.querySelector('.close-btn').addEventListener('click', closeModal);
    document.getElementById('pointModal').addEventListener('click', (e) => {
        if (e.target.id === 'pointModal') closeModal();
    });

    document.getElementById('searchAlertsBtn').addEventListener('click', searchAlerts);
}

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        notificationSupported = false;
        console.info('浏览器不支持 Notification API，告警通知将降级为页面内提示');
        return;
    }
    notificationSupported = true;

    if (Notification.permission === 'granted') {
        notificationPermission = true;
        return;
    }

    if (Notification.permission === 'denied') {
        notificationPermission = false;
        console.info('用户已拒绝通知权限，告警通知将降级为页面内提示');
        return;
    }

    Notification.requestPermission().then(permission => {
        notificationPermission = permission === 'granted';
        if (!notificationPermission) {
            console.info('未获得通知权限，告警通知将降级为页面内提示');
        }
    });
}

function showBrowserNotification(title, message) {
    if (notificationSupported && notificationPermission) {
        try {
            const notification = new Notification(title, {
                body: message,
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%23f44336"/></svg>',
                tag: 'flood-alert'
            });
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        } catch (e) {
            showFallbackAlert(title, message);
        }
    } else {
        showFallbackAlert(title, message);
    }
}

function showFallbackAlert(title, message) {
    const banner = document.createElement('div');
    banner.className = 'notification-fallback';
    banner.innerHTML = `<strong>${title}</strong><br>${message}`;
    document.body.appendChild(banner);

    setTimeout(() => {
        banner.classList.add('fade-out');
        setTimeout(() => banner.remove(), 500);
    }, 8000);
}

function updateCurrentTime() {
    document.getElementById('currentTime').textContent = 
        new Date().toLocaleString('zh-CN');
}

function lngLatToCanvas(lng, lat) {
    if (!mapBounds) return { x: 0, y: 0 };

    const canvasWidth = mapCanvas.width / canvasDPR;
    const canvasHeight = mapCanvas.height / canvasDPR;

    const lngRange = mapBounds.maxLng - mapBounds.minLng;
    const latRange = mapBounds.maxLat - mapBounds.minLat;

    let x = ((lng - mapBounds.minLng) / lngRange) * canvasWidth;
    let y = ((mapBounds.maxLat - lat) / latRange) * canvasHeight;

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    x = centerX + (x - centerX) * viewState.zoom + viewState.offsetX;
    y = centerY + (y - centerY) * viewState.zoom + viewState.offsetY;

    return { x, y };
}

function canvasToLngLat(x, y) {
    if (!mapBounds) return { lng: 0, lat: 0 };

    const canvasWidth = mapCanvas.width / canvasDPR;
    const canvasHeight = mapCanvas.height / canvasDPR;

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    x = centerX + (x - centerX - viewState.offsetX) / viewState.zoom;
    y = centerY + (y - centerY - viewState.offsetY) / viewState.zoom;

    const lngRange = mapBounds.maxLng - mapBounds.minLng;
    const latRange = mapBounds.maxLat - mapBounds.minLat;

    const lng = mapBounds.minLng + (x / canvasWidth) * lngRange;
    const lat = mapBounds.maxLat - (y / canvasHeight) * latRange;

    return { lng, lat };
}

function getPointStatus(point) {
    const level = point.water_level || 0;
    const hasPredictionAlert = point.predicted_peak >= 25;

    if (level >= 30) return { color: '#f44336', status: 'red', glow: true };
    if (level >= 15) return { color: '#ff9800', status: 'orange', glow: true };
    if (hasPredictionAlert) return { color: '#ff9800', status: 'prediction', glow: true, isPrediction: true };
    if (level >= 5) return { color: '#ffc107', status: 'yellow', glow: false };
    return { color: '#4caf50', status: 'green', glow: false };
}

function drawMap() {
    if (!mapBounds) return;

    const width = mapCanvas.width / canvasDPR;
    const height = mapCanvas.height / canvasDPR;

    mapCtx.fillStyle = '#0f1729';
    mapCtx.fillRect(0, 0, width, height);

    drawGrid();
    drawRoads();
    drawPoints();
    updateStats();
}

function drawGrid() {
    const width = mapCanvas.width;
    const height = mapCanvas.height;

    mapCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    mapCtx.lineWidth = 1;

    const gridSize = 50 * viewState.zoom;
    const offsetX = viewState.offsetX % gridSize;
    const offsetY = viewState.offsetY % gridSize;

    for (let x = offsetX; x < width; x += gridSize) {
        mapCtx.beginPath();
        mapCtx.moveTo(x, 0);
        mapCtx.lineTo(x, height);
        mapCtx.stroke();
    }

    for (let y = offsetY; y < height; y += gridSize) {
        mapCtx.beginPath();
        mapCtx.moveTo(0, y);
        mapCtx.lineTo(width, y);
        mapCtx.stroke();
    }
}

function drawRoads() {
    mapCtx.strokeStyle = 'rgba(79, 195, 247, 0.3)';
    mapCtx.lineWidth = 3 * viewState.zoom;
    mapCtx.lineCap = 'round';

    roads.forEach(road => {
        const start = lngLatToCanvas(road[0][0], road[0][1]);
        const end = lngLatToCanvas(road[1][0], road[1][1]);
        
        mapCtx.beginPath();
        mapCtx.moveTo(start.x, start.y);
        mapCtx.lineTo(end.x, end.y);
        mapCtx.stroke();
    });
}

function drawPoints() {
    points.forEach(point => {
        const pos = lngLatToCanvas(point.lng, point.lat);
        const status = getPointStatus(point);
        const radius = 10 * viewState.zoom;

        if (status.glow) {
            const gradient = mapCtx.createRadialGradient(
                pos.x, pos.y, 0,
                pos.x, pos.y, radius * 2.5
            );
            gradient.addColorStop(0, status.color + '80');
            gradient.addColorStop(1, status.color + '00');
            
            mapCtx.beginPath();
            mapCtx.arc(pos.x, pos.y, radius * 2.5, 0, Math.PI * 2);
            mapCtx.fillStyle = gradient;
            mapCtx.fill();
        }

        mapCtx.beginPath();
        mapCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        mapCtx.fillStyle = status.color;
        mapCtx.fill();

        if (status.isPrediction) {
            mapCtx.beginPath();
            mapCtx.arc(pos.x, pos.y, radius - 3 * viewState.zoom, 0, Math.PI * 2);
            mapCtx.fillStyle = '#9c27b0';
            mapCtx.fill();
        }

        mapCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        mapCtx.lineWidth = 2;
        mapCtx.stroke();

        if (viewState.zoom >= 1.5) {
            mapCtx.fillStyle = 'white';
            mapCtx.font = `${10 * viewState.zoom}px Arial`;
            mapCtx.textAlign = 'center';
            mapCtx.fillText(point.code, pos.x, pos.y + radius + 15 * viewState.zoom);
        }
    });
}

function handleMouseMove(e) {
    const rect = mapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (viewState.isDragging) {
        viewState.offsetX += e.clientX - viewState.lastX;
        viewState.offsetY += e.clientY - viewState.lastY;
        viewState.lastX = e.clientX;
        viewState.lastY = e.clientY;
        requestDraw();
    } else {
        let hoveredPoint = null;
        points.forEach(point => {
            const pos = lngLatToCanvas(point.lng, point.lat);
            const radius = 15 * viewState.zoom;
            const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
            if (dist <= radius) {
                hoveredPoint = point;
            }
        });

        if (hoveredPoint) {
            mapCanvas.style.cursor = 'pointer';
            showTooltip(e.clientX, e.clientY, hoveredPoint);
        } else {
            mapCanvas.style.cursor = 'grab';
            hideTooltip();
        }
    }
}

function handleMapClick(e) {
    if (viewState.isDragging) return;

    const rect = mapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    points.forEach(point => {
        const pos = lngLatToCanvas(point.lng, point.lat);
        const radius = 15 * viewState.zoom;
        const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
        if (dist <= radius) {
            openPointModal(point);
        }
    });
}

function handleZoom(e) {
    e.preventDefault();
    const rect = mapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.5, Math.min(5, viewState.zoom * zoomFactor));

    viewState.offsetX = x - (x - viewState.offsetX) * (newZoom / viewState.zoom);
    viewState.offsetY = y - (y - viewState.offsetY) * (newZoom / viewState.zoom);
    viewState.zoom = newZoom;

    requestDraw();
}

function showTooltip(x, y, point) {
    let tooltip = document.querySelector('.tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        document.body.appendChild(tooltip);
    }

    const status = getPointStatus(point);
    const level = point.water_level !== null ? `${point.water_level} cm` : '暂无数据';
    
    tooltip.innerHTML = `
        <strong>${point.name}</strong><br>
        当前水位: <span style="color: ${status.color}">${level}</span><br>
        ${point.predicted_peak ? `预测峰值: ${point.predicted_peak} cm` : ''}
    `;
    
    tooltip.style.left = (x + 15) + 'px';
    tooltip.style.top = (y + 15) + 'px';
    tooltip.style.display = 'block';
}

function hideTooltip() {
    const tooltip = document.querySelector('.tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}

async function loadPoints() {
    try {
        const response = await fetch('/api/points');
        points = await response.json();
        requestDraw();
    } catch (error) {
        console.error('加载点位数据失败:', error);
    }
}

async function loadActiveAlerts() {
    try {
        const response = await fetch('/api/alerts/active');
        const newAlerts = await response.json();

        const oldAlertIds = activeAlerts.map(a => a.id);
        const newAlertIds = newAlerts.map(a => a.id);

        newAlerts.forEach(alert => {
            if (!oldAlertIds.includes(alert.id)) {
                const levelText = alert.alert_level === 'red' ? '红色' : '橙色';
                const typeText = alert.alert_type === 'prediction' ? '预测' : '';
                showBrowserNotification(
                    `${typeText}${levelText}告警`,
                    alert.message
                );
            }
        });

        activeAlerts = newAlerts;
        renderActiveAlerts();
    } catch (error) {
        console.error('加载活动告警失败:', error);
    }
}

function renderActiveAlerts() {
    const container = document.getElementById('activeAlerts');
    
    if (activeAlerts.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无告警</div>';
        return;
    }

    container.innerHTML = activeAlerts.map(alert => `
        <div class="alert-item ${alert.alert_level}">
            <div class="alert-title">
                ${alert.alert_level === 'red' ? '🔴' : '🟠'} 
                ${alert.alert_type === 'prediction' ? '(预测)' : ''}
                ${alert.point_name}
            </div>
            <div class="alert-time">${new Date(alert.triggered_at).toLocaleString('zh-CN')}</div>
            <div class="alert-message">${alert.message}</div>
        </div>
    `).join('');
}

function updateStats() {
    let normal = 0, warning = 0, alert = 0;

    points.forEach(point => {
        const status = getPointStatus(point);
        if (status.status === 'green') normal++;
        else if (status.status === 'yellow') warning++;
        else alert++;
    });

    document.getElementById('totalPoints').textContent = points.length;
    document.getElementById('normalPoints').textContent = normal;
    document.getElementById('warningPoints').textContent = warning;
    document.getElementById('alertPoints').textContent = alert;
}

async function openPointModal(point) {
    selectedPoint = point;
    const modal = document.getElementById('pointModal');

    document.getElementById('modalTitle').textContent = point.name;
    document.getElementById('pointCode').textContent = point.code;
    document.getElementById('pointName').textContent = point.name;
    document.getElementById('pointWaterLevel').textContent = 
        point.water_level !== null ? `${point.water_level} cm` : '-- cm';
    document.getElementById('pointPredicted').textContent = 
        point.predicted_peak ? `${point.predicted_peak} cm` : '-- cm';
    document.getElementById('pointRainfall').textContent = 
        point.rainfall_last_hour !== null ? `${point.rainfall_last_hour} mm` : '-- mm';
    document.getElementById('pointLastUpdate').textContent = 
        point.last_report_time ? new Date(point.last_report_time).toLocaleString('zh-CN') : '--';

    modal.classList.add('show');

    await Promise.all([
        loadPointHistory(point.id),
        loadFloodRecords(point.id)
    ]);
}

function closeModal() {
    document.getElementById('pointModal').classList.remove('show');
    selectedPoint = null;
}

async function loadPointHistory(pointId) {
    try {
        const response = await fetch(`/api/points/${pointId}/water-level-history?hours=2`);
        const history = await response.json();
        drawChart(history);
    } catch (error) {
        console.error('加载历史数据失败:', error);
    }
}

async function loadFloodRecords(pointId) {
    try {
        const response = await fetch(`/api/points/${pointId}/flood-records`);
        const records = await response.json();
        renderFloodRecords(records);
    } catch (error) {
        console.error('加载积水记录失败:', error);
    }
}

function drawChart(data) {
    const width = chartCanvas.width;
    const height = chartCanvas.height;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    chartCtx.clearRect(0, 0, width, height);

    if (data.length === 0) {
        chartCtx.fillStyle = '#666';
        chartCtx.font = '14px Arial';
        chartCtx.textAlign = 'center';
        chartCtx.fillText('暂无数据', width / 2, height / 2);
        return;
    }

    if (data.length === 1) {
        const d = data[0];
        chartCtx.fillStyle = '#4fc3f7';
        chartCtx.font = '14px Arial';
        chartCtx.textAlign = 'center';
        chartCtx.fillText(`水位: ${d.water_level} cm`, width / 2, height / 2 - 10);
        chartCtx.fillStyle = '#888';
        chartCtx.font = '12px Arial';
        chartCtx.fillText(
            new Date(d.recorded_at).toLocaleString('zh-CN'),
            width / 2, height / 2 + 15
        );
        return;
    }

    const maxLevel = Math.max(...data.map(d => d.water_level), 20);

    chartCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    chartCtx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        chartCtx.beginPath();
        chartCtx.moveTo(padding.left, y);
        chartCtx.lineTo(width - padding.right, y);
        chartCtx.stroke();

        const value = Math.round(maxLevel - (maxLevel / 5) * i);
        chartCtx.fillStyle = '#888';
        chartCtx.font = '10px Arial';
        chartCtx.textAlign = 'right';
        chartCtx.fillText(`${value} cm`, padding.left - 5, y + 3);
    }

    chartCtx.strokeStyle = '#ff9800';
    chartCtx.lineWidth = 1;
    chartCtx.setLineDash([5, 5]);
    const orangeY = padding.top + chartHeight * (1 - 15 / maxLevel);
    chartCtx.beginPath();
    chartCtx.moveTo(padding.left, orangeY);
    chartCtx.lineTo(width - padding.right, orangeY);
    chartCtx.stroke();
    chartCtx.setLineDash([]);

    const gradient = chartCtx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    gradient.addColorStop(0, 'rgba(244, 67, 54, 0.5)');
    gradient.addColorStop(0.5, 'rgba(255, 152, 0, 0.3)');
    gradient.addColorStop(1, 'rgba(76, 175, 80, 0.2)');

    chartCtx.beginPath();
    chartCtx.moveTo(padding.left, height - padding.bottom);

    data.forEach((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartWidth;
        const y = padding.top + chartHeight * (1 - d.water_level / maxLevel);
        chartCtx.lineTo(x, y);
    });

    chartCtx.lineTo(width - padding.right, height - padding.bottom);
    chartCtx.closePath();
    chartCtx.fillStyle = gradient;
    chartCtx.fill();

    chartCtx.beginPath();
    chartCtx.strokeStyle = '#4fc3f7';
    chartCtx.lineWidth = 2;

    data.forEach((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartWidth;
        const y = padding.top + chartHeight * (1 - d.water_level / maxLevel);
        if (i === 0) {
            chartCtx.moveTo(x, y);
        } else {
            chartCtx.lineTo(x, y);
        }
    });
    chartCtx.stroke();

    data.forEach((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartWidth;
        const y = padding.top + chartHeight * (1 - d.water_level / maxLevel);
        
        chartCtx.beginPath();
        chartCtx.arc(x, y, 4, 0, Math.PI * 2);
        chartCtx.fillStyle = '#4fc3f7';
        chartCtx.fill();
    });

    if (data.length >= 2) {
        const timeStep = Math.max(1, Math.floor(data.length / 4));
        for (let i = 0; i < data.length; i += timeStep) {
            const x = padding.left + (i / (data.length - 1)) * chartWidth;
            const time = new Date(data[i].recorded_at);
            chartCtx.fillStyle = '#888';
            chartCtx.font = '10px Arial';
            chartCtx.textAlign = 'center';
            chartCtx.fillText(time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), x, height - 10);
        }
    }
}

function renderFloodRecords(records) {
    const container = document.getElementById('floodRecords');

    if (records.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无积水记录</div>';
        return;
    }

    container.innerHTML = records.map(record => `
        <div class="record-item">
            <span class="record-level">${record.water_level} cm</span>
            <span class="record-time">${new Date(record.recorded_at).toLocaleString('zh-CN')}</span>
        </div>
    `).join('');
}

async function searchAlerts() {
    const level = document.getElementById('alertLevelFilter').value;
    const startDate = document.getElementById('startDateFilter').value;
    const endDate = document.getElementById('endDateFilter').value;

    let params = new URLSearchParams();
    if (level !== 'all') params.append('level', level);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    try {
        const response = await fetch(`/api/alerts?${params.toString()}`);
        const alerts = await response.json();
        renderAlertHistory(alerts);
    } catch (error) {
        console.error('搜索告警失败:', error);
    }
}

function renderAlertHistory(alerts) {
    const container = document.getElementById('alertHistory');

    if (alerts.length === 0) {
        container.innerHTML = '<div class="empty-state">未找到告警记录</div>';
        return;
    }

    container.innerHTML = alerts.slice(0, 20).map(alert => `
        <div class="alert-item ${alert.alert_level}">
            <div class="alert-title">
                ${alert.alert_level === 'red' ? '🔴' : '🟠'} 
                ${alert.is_resolved ? '✓' : ''}
                ${alert.point_name}
            </div>
            <div class="alert-time">${new Date(alert.triggered_at).toLocaleString('zh-CN')}</div>
            <div class="alert-message">${alert.message}</div>
        </div>
    `).join('');
}

init();
