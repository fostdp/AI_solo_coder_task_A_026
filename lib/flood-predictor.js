const bus = require('./event-bus');

class FloodPredictor {
  constructor(pool, config = {}) {
    this.pool = pool;
    this.config = {
      predictionTimeMinutes: config.predictionTimeMinutes || 30,
      rainfallInfluence: config.rainfallInfluence || 0.3,
      rateInfluence: config.rateInfluence || 0.7,
      decayFactor: config.decayFactor || 0.3,
      rainStopThreshold: config.rainStopThreshold || 0.5,
      rainStopWindowMinutes: config.rainStopWindowMinutes || 10,
      changeRateWindowMinutes: config.changeRateWindowMinutes || 30,
      changeRateSampleLimit: config.changeRateSampleLimit || 10,
      predictionValidMinutes: config.predictionValidMinutes || 30
    };

    this._bindEvents();
  }

  _bindEvents() {
    bus.on(bus.EVENTS.WATER_LEVEL_VALIDATED, (data) => {
      this.onWaterLevelValidated(data).catch(err => {
        console.error('预测计算错误:', err);
      });
    });
  }

  async query(text, params) {
    const start = Date.now();
    const res = await this.pool.query(text, params);
    const duration = Date.now() - start;
    console.log('执行查询:', { text: text.substring(0, 80), duration, rows: res.rowCount });
    return res;
  }

  calculateChangeRate(waterLevelHistory) {
    if (waterLevelHistory.length < 2) return 0;
    const latest = waterLevelHistory[0];
    const earliest = waterLevelHistory[waterLevelHistory.length - 1];
    const timeDiff = (new Date(latest.recorded_at) - new Date(earliest.recorded_at)) / (1000 * 60);
    if (timeDiff === 0) return 0;
    return (latest.water_level - earliest.water_level) / timeDiff;
  }

  async checkRainStopped(pointId) {
    const result = await this.query(
      `SELECT COALESCE(SUM(rainfall), 0) as total 
       FROM rainfall_data 
       WHERE point_id = $1 AND recorded_at >= NOW() - INTERVAL '${this.config.rainStopWindowMinutes} minutes'`,
      [pointId]
    );
    const recentRainfall = parseFloat(result.rows[0].total);
    return recentRainfall < this.config.rainStopThreshold;
  }

  predictWaterLevel(currentLevel, rainfallLastHour, changeRate, isRainStopped = false) {
    const {
      predictionTimeMinutes,
      rainfallInfluence,
      rateInfluence,
      decayFactor
    } = this.config;

    let rainfallFactor = rainfallLastHour * rainfallInfluence * 0.5;
    let rateFactor = changeRate * predictionTimeMinutes * rateInfluence;

    if (isRainStopped) {
      rainfallFactor *= decayFactor;
      rateFactor = Math.min(0, rateFactor * decayFactor);

      if (changeRate > 0) {
        rateFactor = -currentLevel * (1 - decayFactor) * 0.5;
      }
    }

    const predictedPeak = currentLevel + Math.max(0, rainfallFactor + rateFactor);
    return Math.max(0, Math.round(predictedPeak * 100) / 100);
  }

  async onWaterLevelValidated(data) {
    const { pointId, pointCode, pointName, waterLevel, recordedAt } = data;

    const historyResult = await this.query(
      `SELECT water_level, recorded_at 
       FROM water_level_data 
       WHERE point_id = $1 AND recorded_at >= NOW() - INTERVAL '${this.config.changeRateWindowMinutes} minutes'
       ORDER BY recorded_at DESC 
       LIMIT ${this.config.changeRateSampleLimit}`,
      [pointId]
    );

    const changeRate = this.calculateChangeRate(historyResult.rows);

    const rainfallResult = await this.query(
      `SELECT COALESCE(SUM(rainfall), 0) as total 
       FROM rainfall_data 
       WHERE point_id = $1 AND recorded_at >= NOW() - INTERVAL '1 hour'`,
      [pointId]
    );
    const rainfallLastHour = parseFloat(rainfallResult.rows[0].total);

    const isRainStopped = await this.checkRainStopped(pointId);

    const predictedPeak = this.predictWaterLevel(waterLevel, rainfallLastHour, changeRate, isRainStopped);

    const validUntil = new Date();
    validUntil.setMinutes(validUntil.getMinutes() + this.config.predictionValidMinutes);

    await this.query(
      `INSERT INTO predictions 
       (point_id, current_level, rainfall_last_hour, change_rate, predicted_peak, valid_until, rain_stopped) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [pointId, waterLevel, rainfallLastHour, changeRate, predictedPeak, validUntil, isRainStopped]
    );

    bus.emit(bus.EVENTS.PREDICTION_COMPLETED, {
      pointId,
      pointCode,
      pointName,
      waterLevel,
      predictedPeak,
      changeRate,
      rainfallLastHour,
      isRainStopped
    });
  }
}

module.exports = FloodPredictor;
