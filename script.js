/* =============================================
   XAUUSD Pro — Complete Trading Logic
   ============================================= */

'use strict';

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const CONFIG = {
  BASE_PRICE:    3342.50,
  SPREAD:        0.30,
  PIP_VALUE:     0.10,          // Gold: 1 pip = $0.10 per 0.01 lot
  DEFAULT_RISK:  1,             // %
  UPDATE_MS:     3000,          // price tick interval
  CANDLE_MS:     15 * 60 * 1000,
  SESSIONS: {
    Sydney:  { start: 22, end: 7 },
    Tokyo:   { start: 0,  end: 9 },
    London:  { start: 8,  end: 17 },
    NewYork: { start: 13, end: 22 },
  }
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let state = {
  currentPrice: CONFIG.BASE_PRICE,
  currentTF: 'M15',
  chartTF: 'M15',
  candles: {},
  signal: null,
  zoom: 1,
  panOffset: 0,
  activeTool: 'cursor',
  drawings: { lines: [], hlines: [], zones: [] },
  trades: [],
  performance: { daily: [], weekly: [], monthly: [] },
  perfPeriod: 'daily',
};

// ─── SEED CANDLES ─────────────────────────────────────────────────────────────
function seedCandles(tf, count = 60) {
  const intervals = { M15: 15, H1: 60, H4: 240, D1: 1440 };
  const ms = (intervals[tf] || 15) * 60000;
  const now = Date.now();
  let price = CONFIG.BASE_PRICE + (Math.random() - 0.5) * 40;
  const candles = [];

  for (let i = count - 1; i >= 0; i--) {
    const t = now - i * ms;
    const body = (Math.random() - 0.48) * 8;
    const open = price;
    const close = price + body;
    const high = Math.max(open, close) + Math.random() * 4;
    const low  = Math.min(open, close) - Math.random() * 4;
    candles.push({ time: t, open, high, low, close });
    price = close;
  }
  return candles;
}

function initCandles() {
  ['M15','H1','H4','D1'].forEach(tf => {
    state.candles[tf] = seedCandles(tf, 60);
  });
}

// ─── PRICE SIMULATION ─────────────────────────────────────────────────────────
function tickPrice() {
  const drift = (Math.random() - 0.495) * 0.6;
  state.currentPrice = Math.round((state.currentPrice + drift) * 100) / 100;

  // Update last candle
  ['M15','H1','H4','D1'].forEach(tf => {
    const c = state.candles[tf];
    const last = c[c.length - 1];
    last.close = state.currentPrice;
    last.high  = Math.max(last.high, state.currentPrice);
    last.low   = Math.min(last.low, state.currentPrice);
  });

  updatePriceTicker();
  updateOHLC();
  renderChart();
  computeAndRenderSignal();
  updateCandlesTable();
}

function addNewCandle(tf) {
  const intervals = { M15: 15, H1: 60, H4: 240, D1: 1440 };
  const ms = (intervals[tf] || 15) * 60000;
  const c = state.candles[tf];
  const last = c[c.length - 1];
  const open = last.close;
  c.push({ time: last.time + ms, open, high: open, low: open, close: open });
  if (c.length > 80) c.shift();
}

// ─── PRICE TICKER ─────────────────────────────────────────────────────────────
function updatePriceTicker() {
  const prev = parseFloat(document.getElementById('livePrice').textContent.replace(/,/g,'')) || CONFIG.BASE_PRICE;
  const el = document.getElementById('livePrice');
  el.textContent = state.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const diff = state.currentPrice - CONFIG.BASE_PRICE;
  const pct  = ((diff / CONFIG.BASE_PRICE) * 100).toFixed(2);
  const sign = diff >= 0 ? '+' : '';
  const ch = document.getElementById('priceChange');
  ch.textContent = `${sign}${diff.toFixed(2)} (${sign}${pct}%)`;
  ch.className = 'ticker-change ' + (diff >= 0 ? 'positive' : 'negative');

  // Day High/Low simulation
  const dh = Math.max(state.currentPrice + Math.random() * 4, parseFloat(document.getElementById('dayHigh').textContent.replace(/,/g,'')) || 0);
  const dl = Math.min(state.currentPrice - Math.random() * 4, parseFloat(document.getElementById('dayLow').textContent.replace(/,/g,'')) || 9999);
  document.getElementById('dayHigh').textContent = dh.toFixed(2);
  document.getElementById('dayLow').textContent  = dl.toFixed(2);
}

function updateOHLC() {
  const tf = state.currentTF;
  const candles = state.candles[tf];
  if (!candles || !candles.length) return;
  const last = candles[candles.length - 1];
  document.getElementById('ohlcOpen').textContent  = last.open.toFixed(2);
  document.getElementById('ohlcHigh').textContent  = last.high.toFixed(2);
  document.getElementById('ohlcLow').textContent   = last.low.toFixed(2);
  document.getElementById('ohlcClose').textContent = last.close.toFixed(2);
}

// ─── CANDLES TABLE ─────────────────────────────────────────────────────────────
function updateCandlesTable() {
  const tf = state.chartTF;
  const candles = state.candles[tf] || [];
  const recent = candles.slice(-12).reverse();
  const tbody = document.getElementById('candlesBody');
  document.getElementById('candleTF').textContent = tf;

  tbody.innerHTML = recent.map(c => {
    const bull = c.close >= c.open;
    const dir  = bull ? '▲' : '▼';
    const dirCls = bull ? 'dir-bull' : 'dir-bear';
    const timeStr = new Date(c.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    return `<tr>
      <td>${timeStr}</td>
      <td>${c.open.toFixed(2)}</td>
      <td class="dir-bull">${c.high.toFixed(2)}</td>
      <td class="dir-bear">${c.low.toFixed(2)}</td>
      <td>${c.close.toFixed(2)}</td>
      <td class="${dirCls}">${dir}</td>
    </tr>`;
  }).join('');
}

// ─── CHART RENDERING ─────────────────────────────────────────────────────────
const canvas = document.getElementById('mainChart');
const ctx    = canvas.getContext('2d');
let chartMouse = { x: 0, y: 0, inChart: false };
let isDrawing = false;
let drawStart = null;

function resizeCanvas() {
  const wrapper = canvas.parentElement;
  canvas.width  = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
  renderChart();
}

function renderChart() {
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  const candles = state.candles[state.chartTF];
  if (!candles || !candles.length) return;

  const PAD_LEFT  = 10;
  const PAD_RIGHT = 60;
  const PAD_TOP   = 20;
  const PAD_BOT   = 30;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP  - PAD_BOT;

  const visibleCount = Math.min(Math.floor(50 / state.zoom), candles.length);
  const startIdx = Math.max(0, candles.length - visibleCount - state.panOffset);
  const endIdx   = Math.min(candles.length, startIdx + visibleCount);
  const visible  = candles.slice(startIdx, endIdx);

  if (!visible.length) return;

  const allH = visible.map(c => c.high);
  const allL = visible.map(c => c.low);
  const maxP = Math.max(...allH) + 2;
  const minP = Math.min(...allL) - 2;
  const range = maxP - minP || 1;

  const toY = p => PAD_TOP + chartH - ((p - minP) / range) * chartH;

  // Grid lines
  const gridLines = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridLines; i++) {
    const y = PAD_TOP + (i / gridLines) * chartH;
    ctx.beginPath(); ctx.moveTo(PAD_LEFT, y); ctx.lineTo(W - PAD_RIGHT, y); ctx.stroke();
    const price = maxP - (i / gridLines) * range;
    ctx.fillStyle = '#445060'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'left';
    ctx.fillText(price.toFixed(2), W - PAD_RIGHT + 4, y + 3);
  }

  // Supply/Demand zones on chart
  const zones = computeZones();
  zones.supply.forEach(z => {
    const y1 = toY(z.high), y2 = toY(z.low);
    ctx.fillStyle = 'rgba(239,83,80,0.06)';
    ctx.fillRect(PAD_LEFT, Math.min(y1,y2), chartW, Math.abs(y2-y1));
    ctx.strokeStyle = 'rgba(239,83,80,0.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(PAD_LEFT, Math.min(y1,y2), chartW, Math.abs(y2-y1));
  });
  zones.demand.forEach(z => {
    const y1 = toY(z.high), y2 = toY(z.low);
    ctx.fillStyle = 'rgba(38,166,154,0.06)';
    ctx.fillRect(PAD_LEFT, Math.min(y1,y2), chartW, Math.abs(y2-y1));
    ctx.strokeStyle = 'rgba(38,166,154,0.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(PAD_LEFT, Math.min(y1,y2), chartW, Math.abs(y2-y1));
  });

  // Candles
  const cw = Math.max(2, (chartW / visible.length) * 0.7);
  visible.forEach((c, i) => {
    const x    = PAD_LEFT + (i / (visible.length - 1 || 1)) * chartW;
    const bull = c.close >= c.open;
    const col  = bull ? '#26a69a' : '#ef5350';
    const oY   = toY(c.open), clY = toY(c.close);
    const hY   = toY(c.high), lY  = toY(c.low);

    // Wick
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();

    // Body
    const bodyH = Math.max(1, Math.abs(clY - oY));
    ctx.fillStyle = col;
    ctx.fillRect(x - cw/2, Math.min(oY, clY), cw, bodyH);
  });

  // Current price line
  const priceY = toY(state.currentPrice);
  ctx.strokeStyle = 'rgba(240,192,64,0.6)';
  ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD_LEFT, priceY); ctx.lineTo(W - PAD_RIGHT, priceY); ctx.stroke();
  ctx.setLineDash([]);

  // Price label
  ctx.fillStyle = '#f0c040';
  ctx.fillRect(W - PAD_RIGHT + 1, priceY - 8, 56, 16);
  ctx.fillStyle = '#080b0f'; ctx.font = 'bold 9px JetBrains Mono'; ctx.textAlign = 'center';
  ctx.fillText(state.currentPrice.toFixed(2), W - PAD_RIGHT + 29, priceY + 3);
  ctx.textAlign = 'left';

  // User drawings
  drawUserLines(PAD_LEFT, PAD_RIGHT, PAD_TOP, PAD_BOT, chartW, chartH, toY, W, H);

  // Crosshair
  if (chartMouse.inChart) {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(chartMouse.x, PAD_TOP); ctx.lineTo(chartMouse.x, H - PAD_BOT); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD_LEFT, chartMouse.y); ctx.lineTo(W - PAD_RIGHT, chartMouse.y); ctx.stroke();
    ctx.setLineDash([]);

    const hoverPrice = minP + ((H - PAD_BOT - chartMouse.y) / chartH) * range;
    const info = document.getElementById('crosshairInfo');
    info.style.display = 'block';
    info.textContent = hoverPrice.toFixed(2);
    info.style.top  = Math.min(chartMouse.y - 20, H - 50) + 'px';
    info.style.right = '4px';

    // Update legend if hovering candle
    const hIdx = Math.round(((chartMouse.x - PAD_LEFT) / chartW) * (visible.length - 1));
    if (hIdx >= 0 && hIdx < visible.length) {
      const hc = visible[hIdx];
      document.getElementById('legO').textContent = hc.open.toFixed(2);
      document.getElementById('legH').textContent = hc.high.toFixed(2);
      document.getElementById('legL').textContent = hc.low.toFixed(2);
      document.getElementById('legC').textContent = hc.close.toFixed(2);
    }
  } else {
    document.getElementById('crosshairInfo').style.display = 'none';
    const last = visible[visible.length - 1];
    if (last) {
      document.getElementById('legO').textContent = last.open.toFixed(2);
      document.getElementById('legH').textContent = last.high.toFixed(2);
      document.getElementById('legL').textContent = last.low.toFixed(2);
      document.getElementById('legC').textContent = last.close.toFixed(2);
    }
  }
}

function drawUserLines(PL, PR, PT, PB, cW, cH, toY, W, H) {
  const d = state.drawings;
  ctx.strokeStyle = 'rgba(240,192,64,0.7)';
  ctx.lineWidth = 1.5;

  // Horizontal lines
  d.hlines.forEach(p => {
    const y = toY(p);
    if (y < PT || y > H - PB) return;
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
    ctx.fillStyle = '#f0c040'; ctx.font = '9px JetBrains Mono';
    ctx.fillText(p.toFixed(2), PL + 4, y - 3);
  });

  // Trend lines (just pairs of canvas coords stored)
  d.lines.forEach(l => {
    ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
  });
}

// ─── SIGNAL ENGINE ────────────────────────────────────────────────────────────
function analyzeTimeframe(tf) {
  const candles = state.candles[tf];
  if (!candles || candles.length < 20) return { trend: 'neutral', strength: 50 };

  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, Math.min(50, closes.length));
  const last   = closes[closes.length - 1];

  // Trend detection
  const shortEMA = ema20[ema20.length - 1];
  const longEMA  = ema50[ema50.length - 1];
  const priceAbove = last > shortEMA;
  const emaCross   = shortEMA > longEMA;

  let trend = 'neutral', strength = 50;
  if (priceAbove && emaCross) {
    trend = 'bullish';
    const diff = ((shortEMA - longEMA) / longEMA) * 100;
    strength = Math.min(95, 55 + diff * 200);
  } else if (!priceAbove && !emaCross) {
    trend = 'bearish';
    const diff = ((longEMA - shortEMA) / longEMA) * 100;
    strength = Math.min(95, 55 + diff * 200);
  }

  // Break of structure
  const highs = candles.slice(-10).map(c => c.high);
  const lows  = candles.slice(-10).map(c => c.low);
  const prevHigh = Math.max(...highs.slice(0,-1));
  const prevLow  = Math.min(...lows.slice(0,-1));
  const bos = last > prevHigh ? 'bullish' : last < prevLow ? 'bearish' : null;

  return { trend, strength, bos, ema: shortEMA, longEMA };
}

function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i-1] * (1-k));
  }
  return result;
}

function computeZones() {
  const candles = state.candles['H4'] || [];
  const supply = [], demand = [];
  const n = candles.length;
  if (n < 5) return { supply, demand };

  for (let i = 2; i < n - 2; i++) {
    const c = candles[i];
    const prev1 = candles[i-1], prev2 = candles[i-2];
    const next1 = candles[i+1], next2 = candles[i+2];

    // Supply: bearish after range
    if (c.high > prev1.high && c.high > prev2.high && c.close < c.open) {
      const zHigh = c.high + 0.5;
      const zLow  = c.open - 0.5;
      supply.push({ high: zHigh, low: zLow, strength: 'Strong', idx: i });
    }
    // Demand: bullish after range
    if (c.low < prev1.low && c.low < prev2.low && c.close > c.open) {
      const zHigh = c.open + 0.5;
      const zLow  = c.low - 0.5;
      demand.push({ high: zHigh, low: zLow, strength: 'Strong', idx: i });
    }
  }

  return {
    supply: supply.slice(-3),
    demand: demand.slice(-3),
  };
}

function computeAndRenderSignal() {
  const d1  = analyzeTimeframe('D1');
  const h4  = analyzeTimeframe('H4');
  const h1  = analyzeTimeframe('H1');
  const m15 = analyzeTimeframe('M15');

  renderMTF(d1, h4, h1, m15);
  renderStructure(m15);
  renderZones();

  // Alignment score
  const trends = [d1, h4, h1, m15].map(t => t.trend);
  const bullCount = trends.filter(t => t === 'bullish').length;
  const bearCount = trends.filter(t => t === 'bearish').length;

  const zones = computeZones();
  const price = state.currentPrice;

  // BUY conditions
  const buyConditions = [
    d1.trend  === 'bullish',
    h4.trend  === 'bullish',
    zones.demand.some(z => price >= z.low && price <= z.high + 5),
    m15.bos   === 'bullish',
    bullCount >= 3,
  ];

  // SELL conditions
  const sellConditions = [
    d1.trend  === 'bearish',
    h4.trend  === 'bearish',
    zones.supply.some(z => price <= z.high && price >= z.low - 5),
    m15.bos   === 'bearish',
    bearCount >= 3,
  ];

  const buyScore  = buyConditions.filter(Boolean).length;
  const sellScore = sellConditions.filter(Boolean).length;

  let signal, confidence, entry, sl, tp;

  if (buyScore >= 3) {
    signal = 'BUY';
    confidence = Math.round(55 + buyScore * 8 + Math.random() * 5);
    entry = price;
    const demandZone = zones.demand[zones.demand.length - 1];
    sl = demandZone ? demandZone.low - 1 : price - 8;
    tp = entry + (entry - sl) * 2.5;
  } else if (sellScore >= 3) {
    signal = 'SELL';
    confidence = Math.round(55 + sellScore * 8 + Math.random() * 5);
    entry = price;
    const supplyZone = zones.supply[zones.supply.length - 1];
    sl = supplyZone ? supplyZone.high + 1 : price + 8;
    tp = entry - (sl - entry) * 2.5;
  } else {
    signal = 'WAIT';
    confidence = Math.round(30 + Math.random() * 25);
    entry = price;
    sl = price - 5;
    tp = price + 10;
  }

  confidence = Math.min(97, confidence);

  const slPips = Math.abs(entry - sl) * 10;
  const tpPips = Math.abs(tp - entry) * 10;
  const rr     = tpPips / slPips;

  state.signal = { signal, confidence, entry, sl, tp, slPips, tpPips, rr };
  renderSignalPanel(state.signal);
}

function renderSignalPanel(s) {
  document.getElementById('signalValue').textContent = s.signal;
  document.getElementById('signalValue').className   = 'signal-value ' + 
    (s.signal === 'BUY' ? 'bull-sig' : s.signal === 'SELL' ? 'bear-sig' : 'wait-sig');

  document.getElementById('confBarFill').style.width = s.confidence + '%';
  document.getElementById('confPct').textContent = s.confidence + '%';

  document.getElementById('sigEntry').textContent  = s.entry.toFixed(2);
  document.getElementById('sigSL').textContent     = s.sl.toFixed(2);
  document.getElementById('sigTP').textContent     = s.tp.toFixed(2);
  document.getElementById('sigRR').textContent     = '1:' + s.rr.toFixed(1);
  document.getElementById('sigSLPips').textContent = s.slPips.toFixed(0) + ' pips';
  document.getElementById('sigTPPips').textContent = s.tpPips.toFixed(0) + ' pips';

  // Header badge
  const hdr = document.getElementById('headerSignal');
  hdr.className = 'signal-badge ' + (s.signal === 'BUY' ? 'bull' : s.signal === 'SELL' ? 'bear' : '');
  hdr.querySelector('.sb-text').textContent = s.signal;
}

function renderMTF(d1, h4, h1, m15) {
  const rows = [
    { id: 'mtfD1',  data: d1  },
    { id: 'mtfH4',  data: h4  },
    { id: 'mtfH1',  data: h1  },
    { id: 'mtfM15', data: m15 },
  ];
  rows.forEach(r => {
    const el     = document.getElementById(r.id);
    const bar    = el.querySelector('.mtf-bar');
    const trend  = el.querySelector('.mtf-trend');
    const badge  = el.querySelector('.mtf-badge');
    const str    = r.data.strength || 50;
    bar.style.width      = str + '%';
    bar.style.background = r.data.trend === 'bullish' ? 'linear-gradient(90deg,#1a7a75,#26a69a)' 
                         : r.data.trend === 'bearish' ? 'linear-gradient(90deg,#b33a38,#ef5350)'
                         : 'rgba(255,255,255,0.2)';
    trend.textContent = r.data.trend.toUpperCase();
    badge.textContent = r.data.trend === 'bullish' ? '↑ BULL' : r.data.trend === 'bearish' ? '↓ BEAR' : '→ NEUT';
    badge.className   = 'mtf-badge ' + (r.data.trend === 'bullish' ? 'bull' : r.data.trend === 'bearish' ? 'bear' : 'neutral');
  });

  const bulls = [d1,h4,h1,m15].filter(t => t.trend === 'bullish').length;
  const bears = [d1,h4,h1,m15].filter(t => t.trend === 'bearish').length;
  const pill  = document.getElementById('alignPill');
  if (bulls === 4) pill.textContent = '✦ FULL BULLISH ALIGNMENT — HIGH PROBABILITY BUY';
  else if (bears === 4) pill.textContent = '✦ FULL BEARISH ALIGNMENT — HIGH PROBABILITY SELL';
  else if (bulls >= 3) pill.textContent = `✦ ${bulls}/4 Bullish — Watch for BUY setup`;
  else if (bears >= 3) pill.textContent = `✦ ${bears}/4 Bearish — Watch for SELL setup`;
  else pill.textContent = '⊘ Mixed signals — Wait for alignment';
}

function renderStructure(tf) {
  const candles = state.candles['H1'] || [];
  if (candles.length < 10) return;

  const recent = candles.slice(-15);
  const highs = recent.map(c => c.high);
  const lows  = recent.map(c => c.low);
  const n = recent.length;

  const hh = highs[n-1] > Math.max(...highs.slice(0,-1));
  const ll = lows[n-1]  < Math.min(...lows.slice(0,-1));
  const hl = !ll && lows[n-1]  > lows[n-4];
  const lh = !hh && highs[n-1] < highs[n-4];

  const bos   = tf.bos;
  const choch = bos && ((state.candles['H4'][state.candles['H4'].length-1]?.close > analyzeTimeframe('H4').longEMA) !== (tf.trend === 'bullish'));

  setStruct('sHH',    hh,    hh   ? 'CONFIRMED' : '—',    'bull-active');
  setStruct('sHL',    hl,    hl   ? 'CONFIRMED' : '—',    'bull-active');
  setStruct('sLH',    lh,    lh   ? 'CONFIRMED' : '—',    'bear-active');
  setStruct('sLL',    ll,    ll   ? 'CONFIRMED' : '—',    'bear-active');
  setStruct('sBOS',   !!bos, bos  ? bos.toUpperCase() : '—', bos === 'bullish' ? 'bull-active' : 'bear-active');
  setStruct('sCHOCH', choch, choch ? 'DETECTED' : '—',    'active');
}

function setStruct(id, active, text, cls) {
  const el = document.getElementById(id);
  el.className = 'struct-item' + (active ? ' ' + cls : '');
  el.querySelector('.struct-val').textContent = text;
}

function renderZones() {
  const zones = computeZones();

  const supplyEl  = document.getElementById('supplyZones');
  const demandEl  = document.getElementById('demandZones');

  if (zones.supply.length) {
    supplyEl.innerHTML = zones.supply.map(z => `
      <div class="zone-item supply">
        <div class="zone-range">${z.low.toFixed(2)} – ${z.high.toFixed(2)}</div>
        <div class="zone-strength">${z.strength} Supply Zone</div>
      </div>`).join('');
  } else {
    supplyEl.innerHTML = '<div style="color:var(--text-muted);font-size:10px">No zones detected</div>';
  }

  if (zones.demand.length) {
    demandEl.innerHTML = zones.demand.map(z => `
      <div class="zone-item demand">
        <div class="zone-range">${z.low.toFixed(2)} – ${z.high.toFixed(2)}</div>
        <div class="zone-strength">${z.strength} Demand Zone</div>
      </div>`).join('');
  } else {
    demandEl.innerHTML = '<div style="color:var(--text-muted);font-size:10px">No zones detected</div>';
  }
}

// ─── SESSIONS ─────────────────────────────────────────────────────────────────
function updateSessions() {
  const now  = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const utcS = now.getUTCSeconds();
  const utcTotal = utcH * 3600 + utcM * 60 + utcS;

  document.getElementById('utcClock').textContent =
    `UTC ${String(utcH).padStart(2,'0')}:${String(utcM).padStart(2,'0')}:${String(utcS).padStart(2,'0')}`;

  const sessions = [
    { id: 'sessSydney',  name: 'Sydney',   start: 22*3600, end: (7+24)*3600,  cdId: 'cdSydney'  },
    { id: 'sessTokyo',   name: 'Tokyo',    start: 0,       end: 9*3600,        cdId: 'cdTokyo'   },
    { id: 'sessLondon',  name: 'London',   start: 8*3600,  end: 17*3600,       cdId: 'cdLondon'  },
    { id: 'sessNewYork', name: 'New York', start: 13*3600, end: 22*3600,       cdId: 'cdNewYork' },
  ];

  const activeSessions = [];

  sessions.forEach(sess => {
    const el = document.getElementById(sess.id);
    let isActive = false;

    if (sess.end > 24*3600) {
      // crosses midnight
      isActive = utcTotal >= sess.start || utcTotal < (sess.end - 24*3600);
    } else {
      isActive = utcTotal >= sess.start && utcTotal < sess.end;
    }

    el.className = 'session-item' + (isActive ? ' active' : '');
    el.querySelector('.sess-status').textContent = isActive ? 'OPEN' : 'CLOSED';

    // Countdown
    let countdown;
    if (isActive) {
      const remaining = sess.end > 24*3600
        ? (utcTotal >= sess.start ? sess.end - utcTotal - 24*3600 + 24*3600 - utcTotal + sess.end - 24*3600 - utcTotal : (sess.end - 24*3600) - utcTotal)
        : sess.end - utcTotal;
      const remFixed = sess.end > 24*3600
        ? (utcTotal >= sess.start ? (sess.end - 24*3600) - 0 + (24*3600 - utcTotal) : (sess.end - 24*3600) - utcTotal)
        : sess.end - utcTotal;
      const hh = Math.floor(remFixed / 3600), mm = Math.floor((remFixed % 3600) / 60);
      countdown = `Closes in ${hh}h ${mm}m`;
      activeSessions.push(sess.name);
    } else {
      let opens = sess.start - utcTotal;
      if (opens < 0) opens += 24 * 3600;
      const hh = Math.floor(opens / 3600), mm = Math.floor((opens % 3600) / 60);
      countdown = `Opens in ${hh}h ${mm}m`;
    }
    document.getElementById(sess.cdId).textContent = countdown;
  });

  // Overlap
  const ob = document.getElementById('overlapBar');
  const lbl = ob.querySelector('.overlap-label') || ob;
  const isLondonNY = activeSessions.includes('London') && activeSessions.includes('New York');
  const isTokyoLon = activeSessions.includes('Tokyo')  && activeSessions.includes('London');

  if (isLondonNY) {
    ob.className = 'overlap-bar active';
    ob.textContent = '⚡ London–New York Overlap (High Volume)';
  } else if (isTokyoLon) {
    ob.className = 'overlap-bar active';
    ob.textContent = '⚡ Tokyo–London Overlap';
  } else {
    ob.className = 'overlap-bar';
    ob.textContent = activeSessions.length ? `Active: ${activeSessions.join(', ')}` : 'No Active Session';
  }
}

// ─── PIP CALCULATOR ───────────────────────────────────────────────────────────
function calculate() {
  const entry   = parseFloat(document.getElementById('calcEntry').value);
  const sl      = parseFloat(document.getElementById('calcSL').value);
  const tp      = parseFloat(document.getElementById('calcTP').value);
  const account = parseFloat(document.getElementById('calcAccount').value) || 10000;
  const riskPct = parseFloat(document.getElementById('calcRisk').value) || 1;
  const lot     = parseFloat(document.getElementById('calcLot').value) || 0;

  if (isNaN(entry) || isNaN(sl) || isNaN(tp)) { showToast('Enter valid prices.'); return; }

  const riskPips   = Math.abs(entry - sl) * 10;
  const rewardPips = Math.abs(tp - entry) * 10;
  const rr         = rewardPips / riskPips;
  const dollarRisk = account * (riskPct / 100);
  const dollarRew  = dollarRisk * rr;
  const lotSize    = lot || (dollarRisk / (riskPips * 1)).toFixed(2);

  document.getElementById('crRiskPips').textContent   = riskPips.toFixed(1);
  document.getElementById('crRewardPips').textContent = rewardPips.toFixed(1);
  document.getElementById('crRR').textContent         = '1:' + rr.toFixed(2);
  document.getElementById('crDollarRisk').textContent = '$' + dollarRisk.toFixed(2);
  document.getElementById('crDollarReward').textContent = '$' + dollarRew.toFixed(2);
  document.getElementById('crLotSize').textContent    = parseFloat(lotSize).toFixed(2);

  showToast('Calculated ✓');
}

// Autofill calc from signal
function autofillCalc(sig) {
  document.getElementById('calcEntry').value = sig.entry.toFixed(2);
  document.getElementById('calcSL').value    = sig.sl.toFixed(2);
  document.getElementById('calcTP').value    = sig.tp.toFixed(2);
}

// ─── TRADE LOG ────────────────────────────────────────────────────────────────
function logTrade() {
  const sig = state.signal;
  if (!sig) return;

  const trade = {
    id:         Date.now(),
    type:       sig.signal,
    entry:      sig.entry,
    sl:         sig.sl,
    tp:         sig.tp,
    rr:         sig.rr,
    confidence: sig.confidence,
    time:       new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
    result:     'pending',
    pnl:        0,
  };

  state.trades.unshift(trade);
  saveTrades();
  renderTradeLog();
  updatePerformance();
  showToast('Trade logged ✓');

  // Auto-resolve after delay (simulation)
  setTimeout(() => resolveTradeRandom(trade.id), 3000 + Math.random() * 10000);
}

function resolveTradeRandom(id) {
  const trade = state.trades.find(t => t.id === id);
  if (!trade || trade.result !== 'pending') return;
  const won    = Math.random() > 0.4;
  trade.result = won ? 'win' : 'loss';
  trade.pnl    = won ? Math.abs(trade.tp - trade.entry) * 100 : -Math.abs(trade.sl - trade.entry) * 100;
  saveTrades();
  renderTradeLog();
  updatePerformance();
  showToast(won ? '✓ Trade closed: WIN' : '✗ Trade closed: LOSS');
}

function renderTradeLog() {
  const list = document.getElementById('tradeLogList');
  if (!state.trades.length) { list.innerHTML = '<div class="empty-state">No trades recorded yet.</div>'; return; }
  list.innerHTML = state.trades.slice(0,20).map(t => `
    <div class="trade-log-item">
      <span class="tli-type ${t.type === 'BUY' ? 'bull' : 'bear'}">${t.type}</span>
      <span class="tli-entry">${t.entry.toFixed(2)} @ ${t.time}</span>
      <span class="tli-rr">1:${t.rr.toFixed(1)}</span>
      <span class="tli-result ${t.result}">${t.result === 'pending' ? '⏳' : t.result === 'win' ? '+$'+t.pnl.toFixed(0) : '-$'+Math.abs(t.pnl).toFixed(0)}</span>
    </div>`).join('');
}

function saveTrades() {
  try { localStorage.setItem('xauusd_trades', JSON.stringify(state.trades)); } catch(e) {}
}

function loadTrades() {
  try {
    const d = localStorage.getItem('xauusd_trades');
    if (d) state.trades = JSON.parse(d);
  } catch(e) {}
}

function clearLog() {
  state.trades = [];
  saveTrades();
  renderTradeLog();
  updatePerformance();
  showToast('Trade log cleared.');
}

// ─── PERFORMANCE ──────────────────────────────────────────────────────────────
function updatePerformance() {
  const p = state.perfPeriod;
  const trades = state.trades.filter(t => t.result !== 'pending');

  const wins   = trades.filter(t => t.result === 'win').length;
  const losses = trades.filter(t => t.result === 'loss').length;
  const total  = wins + losses;
  const wr     = total ? Math.round((wins / total) * 100) : 0;
  const pnl    = trades.reduce((s, t) => s + t.pnl, 0);

  document.getElementById('perfWins').textContent    = wins;
  document.getElementById('perfLosses').textContent  = losses;
  document.getElementById('perfWinRate').textContent = wr + '%';
  const pnlEl = document.getElementById('perfPnL');
  pnlEl.textContent = (pnl >= 0 ? '+$' : '-$') + Math.abs(pnl).toFixed(2);
  pnlEl.className   = 'ps-value ' + (pnl >= 0 ? 'bull' : 'bear');

  renderPnLChart(trades);
}

function renderPnLChart(trades) {
  const c   = document.getElementById('pnlChart');
  const ctx2 = c.getContext('2d');
  c.width = c.parentElement.clientWidth;
  c.height = 80;
  ctx2.clearRect(0, 0, c.width, c.height);

  if (trades.length < 2) {
    ctx2.fillStyle = 'rgba(255,255,255,0.05)';
    ctx2.fillRect(0, 35, c.width, 1);
    ctx2.fillStyle = '#445060'; ctx2.font = '10px JetBrains Mono'; ctx2.textAlign = 'center';
    ctx2.fillText('No trade data', c.width/2, 45);
    return;
  }

  let running = 0;
  const points = trades.map(t => { running += t.pnl; return running; });
  const max = Math.max(...points, 1);
  const min = Math.min(...points, -1);
  const range2 = max - min || 1;
  const W2 = c.width, H2 = 80;
  const toY2 = v => H2 - 10 - ((v - min) / range2) * (H2 - 20);

  // Zero line
  const zeroY = toY2(0);
  ctx2.strokeStyle = 'rgba(255,255,255,0.1)'; ctx2.lineWidth = 1;
  ctx2.beginPath(); ctx2.moveTo(0, zeroY); ctx2.lineTo(W2, zeroY); ctx2.stroke();

  // Fill
  const grad = ctx2.createLinearGradient(0, 0, 0, H2);
  grad.addColorStop(0, 'rgba(38,166,154,0.4)');
  grad.addColorStop(1, 'rgba(38,166,154,0)');

  ctx2.beginPath();
  points.forEach((p, i) => {
    const x = (i / (points.length - 1)) * W2;
    const y = toY2(p);
    i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y);
  });
  ctx2.lineTo(W2, H2); ctx2.lineTo(0, H2); ctx2.closePath();
  ctx2.fillStyle = grad; ctx2.fill();

  // Line
  ctx2.beginPath();
  points.forEach((p, i) => {
    const x = (i / (points.length - 1)) * W2;
    const y = toY2(p);
    i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y);
  });
  ctx2.strokeStyle = '#26a69a'; ctx2.lineWidth = 2;
  ctx2.stroke();
}

// ─── CLOCK ────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  document.getElementById('currentTime').textContent = t;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────

// TF selector (overview)
document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentTF = btn.dataset.tf;
    updateOHLC();
    updateCandlesTable();
  });
});

// Chart TF
document.querySelectorAll('.ctf').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ctf').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.chartTF = btn.dataset.ctf;
    state.panOffset = 0;
    renderChart();
    updateCandlesTable();
    document.getElementById('candleTF').textContent = btn.dataset.ctf;
  });
});

// Zoom
document.getElementById('zoomIn').addEventListener('click',    () => { state.zoom = Math.min(5, state.zoom * 1.3); renderChart(); });
document.getElementById('zoomOut').addEventListener('click',   () => { state.zoom = Math.max(0.3, state.zoom / 1.3); renderChart(); });
document.getElementById('zoomReset').addEventListener('click', () => { state.zoom = 1; state.panOffset = 0; renderChart(); });

// Tools
document.querySelectorAll('.chart-tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeTool = btn.id.replace('tool','').toLowerCase();
  });
});

// Canvas mouse
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  chartMouse.x = e.clientX - rect.left;
  chartMouse.y = e.clientY - rect.top;
  chartMouse.inChart = true;
  renderChart();

  if (isDrawing && state.activeTool === 'trend' && drawStart) {
    // Preview line
    const lines = state.drawings.lines;
    if (lines.length && lines[lines.length-1]._preview) {
      lines[lines.length-1].x2 = chartMouse.x;
      lines[lines.length-1].y2 = chartMouse.y;
    }
    renderChart();
  }
});
canvas.addEventListener('mouseleave', () => { chartMouse.inChart = false; renderChart(); });

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  if (state.activeTool === 'trend') {
    isDrawing = true;
    drawStart = { x: mx, y: my };
    state.drawings.lines.push({ x1: mx, y1: my, x2: mx, y2: my, _preview: true });
  } else if (state.activeTool === 'hline') {
    // Price from Y coord
    const H = canvas.height;
    const PAD_TOP = 20, PAD_BOT = 30;
    const chartH = H - PAD_TOP - PAD_BOT;
    const candles = state.candles[state.chartTF];
    const visibleCount = Math.min(Math.floor(50 / state.zoom), candles.length);
    const visible = candles.slice(-visibleCount);
    const allH = visible.map(c => c.high), allL = visible.map(c => c.low);
    const maxP = Math.max(...allH) + 2, minP = Math.min(...allL) - 2;
    const range = maxP - minP;
    const price = minP + ((H - PAD_BOT - my) / chartH) * range;
    state.drawings.hlines.push(price);
    renderChart();
  }
});

canvas.addEventListener('mouseup', e => {
  if (isDrawing && state.activeTool === 'trend') {
    const lines = state.drawings.lines;
    if (lines.length) delete lines[lines.length-1]._preview;
    isDrawing = false; drawStart = null;
  }
});

// Scroll to pan
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  state.panOffset = Math.max(0, Math.min(state.candles[state.chartTF].length - 20, state.panOffset + (e.deltaY > 0 ? 2 : -2)));
  renderChart();
}, { passive: false });

// Pip calculator
document.getElementById('calcBtn').addEventListener('click', calculate);
['calcEntry','calcSL','calcTP','calcAccount','calcRisk','calcLot'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });
});

// Log trade
document.getElementById('logTradeBtn').addEventListener('click', () => {
  logTrade();
  if (state.signal) autofillCalc(state.signal);
});

// Clear log
document.getElementById('clearLog').addEventListener('click', clearLog);

// Performance period
document.querySelectorAll('.pp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pp-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.perfPeriod = btn.dataset.period;
    updatePerformance();
  });
});

// Resize
window.addEventListener('resize', () => { resizeCanvas(); renderPnLChart(state.trades.filter(t => t.result !== 'pending')); });

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  initCandles();
  loadTrades();
  resizeCanvas();
  updateOHLC();
  updateCandlesTable();
  computeAndRenderSignal();
  updateSessions();
  updateClock();
  renderTradeLog();
  updatePerformance();

  // Intervals
  setInterval(tickPrice,      CONFIG.UPDATE_MS);
  setInterval(updateSessions, 1000);
  setInterval(updateClock,    1000);

  // New candle every interval
  setInterval(() => {
    ['M15','H1','H4','D1'].forEach(addNewCandle);
  }, CONFIG.CANDLE_MS);

  showToast('XAUUSD Pro initialized ◈');
}

document.addEventListener('DOMContentLoaded', init);
