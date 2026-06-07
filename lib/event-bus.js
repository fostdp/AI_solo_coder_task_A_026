const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emitAsync(event, data) {
    setImmediate(() => {
      this.emit(event, data);
    });
  }
}

const bus = new EventBus();

bus.EVENTS = {
  WATER_LEVEL_RECEIVED: 'water_level_received',
  WATER_LEVEL_VALIDATED: 'water_level_validated',
  WATER_LEVEL_REJECTED: 'water_level_rejected',
  RAINFALL_RECEIVED: 'rainfall_received',
  RAINFALL_STORED: 'rainfall_stored',
  PREDICTION_COMPLETED: 'prediction_completed',
  ALERT_TRIGGERED: 'alert_triggered',
  ALERT_RESOLVED: 'alert_resolved'
};

module.exports = bus;
