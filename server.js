require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const DataIngestor = require('./lib/data-ingestor');
const FloodPredictor = require('./lib/flood-predictor');
const AlarmEvaluator = require('./lib/alarm-evaluator');
const bus = require('./lib/event-bus');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: '请求过于频繁，每分钟最多120次上报' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.pointCode || req.ip
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: '请求过于频繁，每分钟最多300次查询' },
  standardHeaders: true,
  legacyHeaders: false
});

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

pool.on('error', (err) => {
  console.error('数据库连接错误:', err);
});

const pointsConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'points-config.json'), 'utf-8')
);

const predictionConfig = pointsConfig.prediction || {};

const dataIngestor = new DataIngestor(pool);
const floodPredictor = new FloodPredictor(pool, predictionConfig);
const alarmEvaluator = new AlarmEvaluator(pool);

const recentAlerts = new Map();
alarmEvaluator.onNotification((alertData) => {
  recentAlerts.set(alertData.alertId, {
    ...alertData,
    timestamp: Date.now()
  });
  setTimeout(() => {
    recentAlerts.delete(alertData.alertId);
  }, 300000);
});

bus.on(bus.EVENTS.WATER_LEVEL_REJECTED, (data) => {
  console.log(`[滤波] ${data.pointCode}: ${data.reason}`);
});

bus.on(bus.EVENTS.ALERT_TRIGGERED, (data) => {
  console.log(`[告警] ${data.alertLevel.toUpperCase()} ${data.message}`);
});

bus.on(bus.EVENTS.ALERT_RESOLVED, (data) => {
  console.log(`[解除] ${data.pointName} ${data.alertLevel}告警已恢复`);
});

app.post('/api/water-level', ingestLimiter, async (req, res) => {
  try {
    const { pointCode, waterLevel, timestamp } = req.body;
    const result = await dataIngestor.ingestWaterLevel(pointCode, waterLevel, timestamp);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('水位数据接收错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.post('/api/rainfall', ingestLimiter, async (req, res) => {
  try {
    const { pointCode, rainfall, timestamp } = req.body;
    const result = await dataIngestor.ingestRainfall(pointCode, rainfall, timestamp);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('雨量数据接收错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/config', apiLimiter, (req, res) => {
  res.json(pointsConfig);
});

app.get('/api/points', apiLimiter, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.code,
        p.address,
        ST_X(p.location::geometry) as lng,
        ST_Y(p.location::geometry) as lat,
        p.warning_threshold_orange,
        p.warning_threshold_red,
        w.water_level,
        w.recorded_at as last_report_time,
        pr.predicted_peak,
        COALESCE(
          (SELECT SUM(rainfall) 
           FROM rainfall_data 
           WHERE point_id = p.id AND recorded_at >= NOW() - INTERVAL '1 hour'),
          0
        ) as rainfall_last_hour
      FROM monitoring_points p
      LEFT JOIN LATERAL (
        SELECT water_level, recorded_at 
        FROM water_level_data 
        WHERE point_id = p.id 
        ORDER BY recorded_at DESC 
        LIMIT 1
      ) w ON true
      LEFT JOIN LATERAL (
        SELECT predicted_peak 
        FROM predictions 
        WHERE point_id = p.id AND valid_until > NOW()
        ORDER BY prediction_time DESC 
        LIMIT 1
      ) pr ON true
      WHERE p.is_active = TRUE
      ORDER BY p.id
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('获取点位列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/points/:id/water-level-history', apiLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { hours = 2 } = req.query;

    const maxHours = Math.min(parseInt(hours) || 2, 48);

    const result = await pool.query(
      `SELECT water_level, recorded_at 
       FROM water_level_data 
       WHERE point_id = $1 AND recorded_at >= NOW() - $2::interval
       ORDER BY recorded_at ASC
       LIMIT 5000`,
      [id, `${maxHours} hours`]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('获取水位历史错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/points/:id/flood-records', apiLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT w.water_level, w.recorded_at 
       FROM water_level_data w
       WHERE w.point_id = $1 AND w.water_level >= 5
       ORDER BY w.recorded_at DESC 
       LIMIT 10`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('获取积水记录错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/alerts', apiLimiter, async (req, res) => {
  try {
    const { level, startDate, endDate, resolved } = req.query;

    const validLevels = ['red', 'orange'];
    let sql = `
      SELECT 
        a.id,
        a.point_id,
        p.name as point_name,
        p.code as point_code,
        a.alert_level,
        a.alert_type,
        a.water_level,
        a.predicted_level,
        a.message,
        a.triggered_at,
        a.resolved_at,
        a.is_resolved
      FROM alerts a
      JOIN monitoring_points p ON a.point_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (level && level !== 'all' && validLevels.includes(level)) {
      sql += ` AND a.alert_level = $${paramIndex}`;
      params.push(level);
      paramIndex++;
    }

    if (startDate) {
      const parsedStart = new Date(startDate);
      if (!isNaN(parsedStart.getTime())) {
        sql += ` AND a.triggered_at >= $${paramIndex}`;
        params.push(parsedStart);
        paramIndex++;
      }
    }

    if (endDate) {
      const parsedEnd = new Date(endDate);
      if (!isNaN(parsedEnd.getTime())) {
        sql += ` AND a.triggered_at <= $${paramIndex}`;
        params.push(parsedEnd);
        paramIndex++;
      }
    }

    if (resolved !== undefined) {
      sql += ` AND a.is_resolved = $${paramIndex}`;
      params.push(resolved === 'true');
      paramIndex++;
    }

    sql += ' ORDER BY a.triggered_at DESC LIMIT 200';

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error('获取告警列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/alerts/active', apiLimiter, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id,
        a.point_id,
        p.name as point_name,
        p.code as point_code,
        a.alert_level,
        a.alert_type,
        a.water_level,
        a.predicted_level,
        a.message,
        a.triggered_at
      FROM alerts a
      JOIN monitoring_points p ON a.point_id = p.id
      WHERE a.is_resolved = FALSE
      ORDER BY 
        CASE a.alert_level 
          WHEN 'red' THEN 1 
          WHEN 'orange' THEN 2 
          ELSE 3 
        END,
        a.triggered_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('获取活动告警错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/api/alerts/recent', (req, res) => {
  const alerts = Array.from(recentAlerts.values());
  res.json(alerts);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`模块: DataIngestor / FloodPredictor / AlarmEvaluator`);
  console.log(`事件总线: ${Object.keys(bus.EVENTS).length} 个事件已注册`);
});

module.exports = { app, pool, dataIngestor, floodPredictor, alarmEvaluator };
