const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';
const SIM_MODE = process.env.MODE || 'normal';
const TICK_MS = parseInt(process.env.TICK_MS) || 60000;

const MODES = {
  normal: {
    rainStartChance: 0.04,
    rainIntensityRange: [3, 20],
    rainDurationRange: [10, 45],
    floodRiskMultiplier: 1.0,
    drainageMultiplier: 1.0,
    label: '正常模式'
  },
  storm: {
    rainStartChance: 0.25,
    rainIntensityRange: [25, 80],
    rainDurationRange: [30, 120],
    floodRiskMultiplier: 1.8,
    drainageMultiplier: 0.4,
    label: '暴雨模式'
  }
};

const points = [
  { code: 'P001', name: '人民路与建设路交叉口', baseLevel: 2, floodRisk: 0.8 },
  { code: 'P002', name: '火车站站前广场', baseLevel: 3, floodRisk: 0.7 },
  { code: 'P003', name: '市政府门前', baseLevel: 1, floodRisk: 0.5 },
  { code: 'P004', name: '中心公园北门', baseLevel: 4, floodRisk: 0.9 },
  { code: 'P005', name: '商业步行街北口', baseLevel: 2, floodRisk: 0.6 },
  { code: 'P006', name: '第一中学门口', baseLevel: 2, floodRisk: 0.65 },
  { code: 'P007', name: '人民医院急诊入口', baseLevel: 3, floodRisk: 0.75 },
  { code: 'P008', name: '体育馆西门', baseLevel: 2, floodRisk: 0.55 },
  { code: 'P009', name: '立交桥下', baseLevel: 5, floodRisk: 0.95 },
  { code: 'P010', name: '地铁站出口', baseLevel: 3, floodRisk: 0.7 },
  { code: 'P011', name: '科技园区南门', baseLevel: 1, floodRisk: 0.4 },
  { code: 'P012', name: '居民区入口', baseLevel: 2, floodRisk: 0.6 },
  { code: 'P013', name: '高速出口', baseLevel: 4, floodRisk: 0.85 },
  { code: 'P014', name: '批发市场门前', baseLevel: 3, floodRisk: 0.7 },
  { code: 'P015', name: '旅游景区入口', baseLevel: 2, floodRisk: 0.5 },
  { code: 'P016', name: '购物中心停车场', baseLevel: 4, floodRisk: 0.8 },
  { code: 'P017', name: '公交枢纽', baseLevel: 2, floodRisk: 0.55 },
  { code: 'P018', name: '工业区主干道', baseLevel: 3, floodRisk: 0.65 },
  { code: 'P019', name: '河岸边道路', baseLevel: 5, floodRisk: 0.9 },
  { code: 'P020', name: '学校周边路段', baseLevel: 2, floodRisk: 0.6 }
];

const mode = MODES[SIM_MODE] || MODES.normal;

const state = {
  isRaining: false,
  rainIntensity: 0,
  rainDuration: 0,
  pointLevels: {},
  lastRainfallTime: {},
  tickCount: 0
};

points.forEach(p => {
  state.pointLevels[p.code] = p.baseLevel;
  state.lastRainfallTime[p.code] = 0;
});

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function updateRainState() {
  if (!state.isRaining) {
    if (Math.random() < mode.rainStartChance) {
      state.isRaining = true;
      state.rainIntensity = random(...mode.rainIntensityRange);
      state.rainDuration = random(...mode.rainDurationRange);
      console.log(`\n${SIM_MODE === 'storm' ? '⛈️' : '🌧️'}  开始下雨！强度: ${state.rainIntensity.toFixed(1)}mm/h, 持续约: ${state.rainDuration.toFixed(0)}分钟`);
    }
  } else {
    state.rainDuration--;
    if (state.rainDuration <= 0) {
      state.isRaining = false;
      state.rainIntensity = 0;
      console.log('\n☀️  雨停了');
    } else {
      state.rainIntensity *= random(0.93, 1.07);
      const maxIntensity = mode.rainIntensityRange[1] * 1.5;
      state.rainIntensity = Math.max(0, Math.min(maxIntensity, state.rainIntensity));
    }
  }
}

function calculateWaterLevelChange(point) {
  let change = 0;

  if (state.isRaining) {
    const rainEffect = state.rainIntensity * point.floodRisk * mode.floodRiskMultiplier * random(0.06, 0.14);
    change += rainEffect;
  }

  const drainage = random(0.1, 0.3) * mode.drainageMultiplier;
  change -= drainage;

  change += random(-0.3, 0.3);

  return change;
}

async function sendWaterLevel(pointCode, waterLevel) {
  try {
    await axios.post(`${API_BASE_URL}/water-level`, {
      pointCode,
      waterLevel: Math.round(waterLevel * 100) / 100,
      timestamp: new Date().toISOString()
    }, { timeout: 5000 });
    return true;
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn(`  ⚠ [${pointCode}] 被限流，跳过本次上报`);
    } else {
      console.error(`  ✗ [${pointCode}] 水位上报失败: ${error.message}`);
    }
    return false;
  }
}

async function sendRainfall(pointCode, rainfall) {
  try {
    await axios.post(`${API_BASE_URL}/rainfall`, {
      pointCode,
      rainfall: Math.round(rainfall * 100) / 100,
      timestamp: new Date().toISOString()
    }, { timeout: 5000 });
    return true;
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn(`  ⚠ [${pointCode}] 雨量上报被限流`);
    } else {
      console.error(`  ✗ [${pointCode}] 雨量上报失败: ${error.message}`);
    }
    return false;
  }
}

function fmt(level) {
  if (level >= 30) return `\x1b[31m${level.toFixed(1)}cm\x1b[0m`;
  if (level >= 15) return `\x1b[33m${level.toFixed(1)}cm\x1b[0m`;
  if (level >= 5) return `\x1b[33m${level.toFixed(1)}cm\x1b[0m`;
  return `\x1b[32m${level.toFixed(1)}cm\x1b[0m`;
}

async function tickWaterLevel() {
  let ok = 0;
  const alertPts = [];

  for (const point of points) {
    const prev = state.pointLevels[point.code];
    const change = calculateWaterLevelChange(point);
    let next = prev + change;
    next = Math.max(0, Math.min(50, next));
    state.pointLevels[point.code] = next;

    const success = await sendWaterLevel(point.code, next);
    if (success) ok++;
    if (next >= 15) alertPts.push({ point, level: next });

    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`  📊 水位: ${ok}/${points.length} 成功`);
  if (alertPts.length) {
    alertPts.forEach(({ point, level }) => {
      console.log(`     ⚠ ${point.name}: ${fmt(level)}`);
    });
  }
}

async function tickRainfall() {
  if (!state.isRaining) return;

  let ok = 0;
  const now = Date.now();

  for (const point of points) {
    const elapsed = (now - state.lastRainfallTime[point.code]) / 60000;
    if (elapsed >= 5 || state.lastRainfallTime[point.code] === 0) {
      const amount = state.rainIntensity * random(0.8, 1.2) / 12;
      const success = await sendRainfall(point.code, amount);
      if (success) {
        ok++;
        state.lastRainfallTime[point.code] = now;
      }
      await new Promise(r => setTimeout(r, 50));
    }
  }

  if (ok) console.log(`  🌧 雨量: ${ok}/${points.length} 成功 (${state.rainIntensity.toFixed(1)}mm/h)`);
}

function printDashboard() {
  const W = 60;
  const bar = '─'.repeat(W);
  console.log('\n┌' + bar + '┐');
  console.log(`│ 模式: ${mode.label.padEnd(W - 7)}│`);
  console.log(`│ 天气: ${(state.isRaining ? `🌧 降雨 ${state.rainIntensity.toFixed(1)}mm/h 剩余${state.rainDuration.toFixed(0)}min` : '☀ 晴朗').padEnd(W - 7)}│`);

  let maxLvl = 0, maxPt = null, alertCnt = 0;
  points.forEach(p => {
    const l = state.pointLevels[p.code];
    if (l > maxLvl) { maxLvl = l; maxPt = p; }
    if (l >= 15) alertCnt++;
  });
  console.log(`│ 最高: ${(maxPt ? `${maxPt.name} ${fmt(maxLvl)}` : '-').padEnd(W - 7)}│`);
  console.log(`│ 告警: ${`${alertCnt}/${points.length} 个点位超阈值`.padEnd(W - 7)}│`);
  console.log(`│ Tick: ${`${state.tickCount} (间隔${TICK_MS / 1000}s)`.padEnd(W - 7)}│`);
  console.log('└' + bar + '┘');
}

async function main() {
  console.log('┌' + '─'.repeat(60) + '┐');
  console.log('│          🌊 城市内涝监测预警系统 - 数据模拟器            │');
  console.log('├' + '─'.repeat(60) + '┤');
  console.log(`│ 模式:  ${mode.label.padEnd(50)}│`);
  console.log(`│ 点位:  ${`${points.length} 个监测点`.padEnd(50)}│`);
  console.log(`│ 降雨:  ${`起始概率${(mode.rainStartChance * 100).toFixed(0)}% / 强度${mode.rainIntensityRange[0]}~${mode.rainIntensityRange[1]}mm/h`.padEnd(50)}│`);
  console.log(`│ API:   ${API_BASE_URL.padEnd(50)}│`);
  console.log(`│ Tick:  ${`${TICK_MS / 1000}秒/次`.padEnd(50)}│`);
  console.log('└' + '─'.repeat(60) + '┘');

  const healthUrl = API_BASE_URL.replace('/api', '/health');
  try {
    await axios.get(healthUrl, { timeout: 5000 });
    console.log('✓ 服务器连接正常\n');
  } catch (error) {
    console.log('✗ 无法连接服务器，请确认已启动');
    console.log(`  检查地址: ${healthUrl}`);
    process.exit(1);
  }

  const timer = setInterval(async () => {
    state.tickCount++;
    updateRainState();
    await tickWaterLevel();
    if (state.tickCount % 5 === 0) await tickRainfall();
    if (state.tickCount % 10 === 0) printDashboard();
  }, TICK_MS);

  setTimeout(printDashboard, 500);

  process.on('SIGINT', () => {
    console.log('\n\n👋 模拟器已停止');
    clearInterval(timer);
    process.exit(0);
  });
}

main().catch(console.error);
