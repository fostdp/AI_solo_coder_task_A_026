const bus = require('./event-bus');

class AlarmEvaluator {
  constructor(pool) {
    this.pool = pool;
    this.notificationCallbacks = [];
    this._bindEvents();
  }

  onNotification(callback) {
    this.notificationCallbacks.push(callback);
  }

  _notify(data) {
    this.notificationCallbacks.forEach(cb => {
      try { cb(data); } catch (e) { console.error('通知回调错误:', e); }
    });
  }

  _bindEvents() {
    bus.on(bus.EVENTS.PREDICTION_COMPLETED, (data) => {
      this.evaluate(data).catch(err => {
        console.error('告警评估错误:', err);
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

  async evaluate(data) {
    const { pointId, pointName, waterLevel, predictedPeak } = data;

    const pointResult = await this.query(
      'SELECT * FROM monitoring_points WHERE id = $1',
      [pointId]
    );
    if (pointResult.rows.length === 0) return;

    const point = pointResult.rows[0];
    const now = new Date();

    const activeAlertsResult = await this.query(
      `SELECT * FROM alerts 
       WHERE point_id = $1 AND is_resolved = FALSE 
       ORDER BY triggered_at DESC`,
      [pointId]
    );
    const activeAlerts = activeAlertsResult.rows;

    await this._resolveStaleAlerts(activeAlerts, point, waterLevel, now);

    await this._triggerNewAlerts(activeAlerts, point, waterLevel, predictedPeak, now);
  }

  async _resolveStaleAlerts(activeAlerts, point, currentLevel, now) {
    for (const alert of activeAlerts) {
      let shouldResolve = false;

      if (alert.alert_type === 'actual') {
        if (alert.alert_level === 'red' && currentLevel < point.warning_threshold_red) {
          shouldResolve = true;
        }
        if (alert.alert_level === 'orange' && currentLevel < point.warning_threshold_orange) {
          shouldResolve = true;
        }
      }

      if (alert.alert_type === 'prediction') {
        if (currentLevel < point.warning_threshold_orange && alert.predicted_level !== null) {
          const latestPredictResult = await this.query(
            `SELECT predicted_peak FROM predictions 
             WHERE point_id = $1 AND valid_until > NOW() 
             ORDER BY prediction_time DESC LIMIT 1`,
            [point.id]
          );
          if (latestPredictResult.rows.length === 0 || latestPredictResult.rows[0].predicted_peak < 25) {
            shouldResolve = true;
          }
        }
      }

      if (shouldResolve) {
        await this.query(
          `UPDATE alerts SET is_resolved = TRUE, resolved_at = $1 WHERE id = $2`,
          [now, alert.id]
        );
        bus.emit(bus.EVENTS.ALERT_RESOLVED, {
          alertId: alert.id,
          pointId: point.id,
          pointName: point.name,
          alertLevel: alert.alert_level,
          alertType: alert.alert_type,
          resolvedAt: now
        });
        console.log('解除告警:', alert.message);
      }
    }
  }

  async _triggerNewAlerts(activeAlerts, point, currentLevel, predictedPeak, now) {
    let alertLevel = null;
    let alertType = null;
    let message = null;

    if (currentLevel >= point.warning_threshold_red) {
      alertLevel = 'red';
      alertType = 'actual';
      message = `${point.name}水位达到${currentLevel}cm，触发红色告警！`;
    } else if (currentLevel >= point.warning_threshold_orange) {
      alertLevel = 'orange';
      alertType = 'actual';
      message = `${point.name}水位达到${currentLevel}cm，触发橙色告警！`;
    } else if (predictedPeak >= 25) {
      const existingOrangePredict = activeAlerts.find(
        a => a.alert_type === 'prediction' && a.alert_level === 'orange' && !a.is_resolved
      );
      if (!existingOrangePredict) {
        alertLevel = 'orange';
        alertType = 'prediction';
        message = `预测${point.name}未来30分钟水位峰值将达到${predictedPeak}cm，触发橙色预警！`;
      }
    }

    if (alertLevel && alertType) {
      const existingAlert = activeAlerts.find(
        a => a.alert_level === alertLevel && a.alert_type === alertType && !a.is_resolved
      );

      if (!existingAlert) {
        const insertResult = await this.query(
          `INSERT INTO alerts 
           (point_id, alert_level, alert_type, water_level, predicted_level, message) 
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [point.id, alertLevel, alertType, currentLevel, predictedPeak, message]
        );

        const alertId = insertResult.rows[0].id;
        console.log('创建告警:', message);

        const alertData = {
          alertId,
          pointId: point.id,
          pointName: point.name,
          alertLevel,
          alertType,
          waterLevel: currentLevel,
          predictedLevel: predictedPeak,
          message,
          triggeredAt: now
        };

        bus.emit(bus.EVENTS.ALERT_TRIGGERED, alertData);
        this._notify(alertData);
      }
    }
  }
}

module.exports = AlarmEvaluator;
