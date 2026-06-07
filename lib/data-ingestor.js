const bus = require('./event-bus');

class DataIngestor {
  constructor(pool) {
    this.pool = pool;
    this.maxJump = 20;
  }

  async query(text, params) {
    const start = Date.now();
    const res = await this.pool.query(text, params);
    const duration = Date.now() - start;
    console.log('执行查询:', { text: text.substring(0, 80), duration, rows: res.rowCount });
    return res;
  }

  async resolvePointId(pointCode) {
    const result = await this.query(
      'SELECT id, name FROM monitoring_points WHERE code = $1',
      [pointCode]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async validateWaterLevel(pointId, newLevel) {
    const result = await this.query(
      `SELECT water_level 
       FROM water_level_data 
       WHERE point_id = $1 
       ORDER BY recorded_at DESC 
       LIMIT 1`,
      [pointId]
    );

    if (result.rows.length === 0) {
      return { valid: true, filteredLevel: newLevel, reason: '首条数据' };
    }

    const lastLevel = parseFloat(result.rows[0].water_level);
    const diff = Math.abs(newLevel - lastLevel);

    if (diff > this.maxJump) {
      return {
        valid: false,
        filteredLevel: lastLevel,
        reason: `跳变过大: ${lastLevel}cm → ${newLevel}cm (差值${diff.toFixed(1)}cm > ${this.maxJump}cm)`
      };
    }

    return { valid: true, filteredLevel: newLevel, reason: '正常' };
  }

  async ingestWaterLevel(pointCode, waterLevel, timestamp) {
    if (!pointCode || waterLevel === undefined) {
      return { error: '缺少必要参数', status: 400 };
    }

    const point = await this.resolvePointId(pointCode);
    if (!point) {
      return { error: '点位不存在', status: 404 };
    }

    const pointId = point.id;
    const recordedAt = timestamp ? new Date(timestamp) : new Date();

    bus.emit(bus.EVENTS.WATER_LEVEL_RECEIVED, {
      pointId,
      pointCode,
      pointName: point.name,
      rawLevel: waterLevel,
      recordedAt
    });

    const validation = await this.validateWaterLevel(pointId, waterLevel);

    if (!validation.valid) {
      console.log(`[滤波] 点位${pointCode}丢弃异常数据: ${validation.reason}`);
      bus.emit(bus.EVENTS.WATER_LEVEL_REJECTED, {
        pointId,
        pointCode,
        pointName: point.name,
        rawLevel: waterLevel,
        reason: validation.reason
      });
      return {
        success: true,
        filtered: true,
        reason: validation.reason,
        usedLevel: validation.filteredLevel
      };
    }

    const finalWaterLevel = validation.filteredLevel;

    await this.query(
      'INSERT INTO water_level_data (point_id, water_level, recorded_at) VALUES ($1, $2, $3)',
      [pointId, finalWaterLevel, recordedAt]
    );

    bus.emit(bus.EVENTS.WATER_LEVEL_VALIDATED, {
      pointId,
      pointCode,
      pointName: point.name,
      waterLevel: finalWaterLevel,
      recordedAt
    });

    return {
      success: true,
      pointId,
      pointName: point.name,
      waterLevel: finalWaterLevel,
      filtered: false
    };
  }

  async ingestRainfall(pointCode, rainfall, timestamp) {
    if (!pointCode || rainfall === undefined) {
      return { error: '缺少必要参数', status: 400 };
    }

    const point = await this.resolvePointId(pointCode);
    if (!point) {
      return { error: '点位不存在', status: 404 };
    }

    const pointId = point.id;
    const recordedAt = timestamp ? new Date(timestamp) : new Date();

    await this.query(
      'INSERT INTO rainfall_data (point_id, rainfall, recorded_at) VALUES ($1, $2, $3)',
      [pointId, rainfall, recordedAt]
    );

    bus.emit(bus.EVENTS.RAINFALL_STORED, {
      pointId,
      pointCode,
      pointName: point.name,
      rainfall,
      recordedAt
    });

    return { success: true };
  }
}

module.exports = DataIngestor;
