/* game.js — Agent Hub visual engine */
'use strict';

// ══════════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════════
window.HUB_DATA = {
  meta: null, agents: {}, universes: [], tickers: [],
  planetData: [], buildGuide: null,
};

const DATA_FILES = [
  ['meta',        './data/meta.json'],
  ['buildGuide',  './data/build_guide.json'],
  ['universes',   './data/universes.json'],
  ['tickers',     './data/tickers.json'],
  ['planetData',  './data/planet_data.json'],
  ['email-agent',              './data/agents/email-agent.json'],
  ['meeting-prep-agent',       './data/agents/meeting-prep-agent.json'],
  ['text-agent',               './data/agents/text-agent.json'],
  ['decision-memo-agent',      './data/agents/decision-memo-agent.json'],
  ['financial-analysis-agent', './data/agents/financial-analysis-agent.json'],
];

function loadAllData() {
  const promises = DATA_FILES.map(([key, url]) =>
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => ({ key, data: d }))
      .catch(e => { showToast(`Failed to load ${url}: ${e.message}`); return { key, data: null }; })
  );
  return Promise.all(promises).then(results => {
    results.forEach(({ key, data }) => {
      if (!data) return;
      if (['meta','buildGuide','universes','tickers','planetData'].includes(key)) {
        HUB_DATA[key] = data;
      } else {
        HUB_DATA.agents[key] = data;
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════
let dashboardData = null;

const STATE = {
  level:           'GALAXY',   // GALAXY | AGENT_FINANCIAL | UNIVERSE | TICKER | AGENT_REACTIVE | BUILD_GUIDE
  selectedAgent:   null,
  selectedUniverse:null,
  selectedTicker:  null,
  panelOpen:       false,
  transitioning:   false,
  // animation
  frame:           0,
  transitionAlpha: 1.0,   // 1=fully visible, 0=faded
  zoomTarget:      null,  // planet being zoomed in/out
};

// ══════════════════════════════════════════════════════════════════
// CANVAS
// ══════════════════════════════════════════════════════════════════
const canvas = document.getElementById('galaxy');
const ctx    = canvas.getContext('2d');
let DPR = window.devicePixelRatio || 1;
let W, H, CX, CY;

function resizeCanvas() {
  DPR = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight - 84; // subtract top bar (48px) + quick-nav (36px)
  CX = W / 2;
  CY = H / 2;
  canvas.width  = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// ══════════════════════════════════════════════════════════════════
// STARS (static)
// ══════════════════════════════════════════════════════════════════
const STARS = [];
function initStars() {
  STARS.length = 0;
  const rng = mulberry32(42);
  for (let i = 0; i < 150; i++) {
    STARS.push({
      x: rng() * W,
      y: rng() * H,
      r: 0.5 + rng() * 1.0,
      a: 0.3 + rng() * 0.5,
    });
  }
}

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function drawStars() {
  for (const s of STARS) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.fill();
  }
}

// ══════════════════════════════════════════════════════════════════
// PLANETS — GALAXY LEVEL
// ══════════════════════════════════════════════════════════════════
const AGENT_ORDER = [
  'email-agent', 'meeting-prep-agent', 'text-agent',
  'decision-memo-agent', 'financial-analysis-agent', 'build-guide',
];
const ORBIT_SPEEDS = {
  'email-agent':               0.65,
  'meeting-prep-agent':        0.50,
  'text-agent':                0.80,
  'decision-memo-agent':       0.55,
  'financial-analysis-agent':  0.20,
  'build-guide':               0.40,
};
const ORBIT_RADIUS_GALAXY = 180;
let galaxyPlanets = [];

function buildGalaxyPlanets() {
  galaxyPlanets = [];
  AGENT_ORDER.forEach((id, i) => {
    const baseDeg = (360 / AGENT_ORDER.length) * i;
    const isFin   = id === 'financial-analysis-agent';
    const isBG    = id === 'build-guide';
    let agentData;
    if (id === 'build-guide') {
      agentData = HUB_DATA.buildGuide || { display_name: 'Build Guide', color: '#FFFFFF', icon: '📖', description: '' };
    } else {
      agentData = HUB_DATA.agents[id] || { display_name: id, color: '#888', icon: '?', description: '' };
    }
    galaxyPlanets.push({
      id,
      label:  agentData.display_name || id,
      icon:   agentData.icon  || '?',
      color:  agentData.color || '#888',
      desc:   agentData.description || '',
      radius: isFin ? 32 : isBG ? 26 : 22,
      orbitR: ORBIT_RADIUS_GALAXY,
      speed:  ORBIT_SPEEDS[id] || 0.5,
      angleDeg: baseDeg,
      x: 0, y: 0,
      scaleAnim: 1.0,
      alphaAnim: 1.0,
    });
  });
}

function updateGalaxyPlanets() {
  galaxyPlanets.forEach(p => {
    p.angleDeg += p.speed * 0.015;
    const rad = (p.angleDeg * Math.PI) / 180;
    p.x = CX + Math.cos(rad) * p.orbitR;
    p.y = CY + Math.sin(rad) * p.orbitR;
  });
}

function drawGalaxy() {
  // Background
  ctx.fillStyle = '#0A0A1A';
  ctx.fillRect(0, 0, W, H);
  drawStars();

  const t = STATE.frame;

  // Center node
  const pulseT  = (t % 120) / 120;
  const pulseR  = 30 + pulseT * 8;
  const pulseA  = 0.3 * (1 - pulseT);
  ctx.beginPath();
  ctx.arc(CX, CY, pulseR, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,${pulseA})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.shadowBlur   = 20;
  ctx.shadowColor  = '#ffffff';
  ctx.beginPath();
  ctx.arc(CX, CY, 28, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle  = '#0A0A1A';
  ctx.font       = 'bold 11px system-ui';
  ctx.textAlign  = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⬡', CX, CY);

  ctx.fillStyle   = '#E8E8F0';
  ctx.font        = '13px system-ui';
  ctx.textBaseline = 'top';
  ctx.fillText('Agent Hub', CX, CY + 33);

  // Orbit ring (faint)
  ctx.beginPath();
  ctx.arc(CX, CY, ORBIT_RADIUS_GALAXY, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Agent planets
  updateGalaxyPlanets();
  galaxyPlanets.forEach(p => {
    drawPlanet(p.x, p.y, p.radius, p.color, p.label, p.icon,
               p.scaleAnim, p.alphaAnim, false, p.id);
  });
}

function drawPlanet(x, y, r, color, label, icon, scale, alpha, pulse, agentId) {
  const ef = scale * alpha;
  if (ef < 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (pulse) {
    const pt = (STATE.frame % 120) / 120;
    const pr = r + pt * 8;
    const pa = 0.35 * (1 - pt);
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${pa})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Glow
  ctx.shadowBlur  = 12;
  ctx.shadowColor = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Health ring
  if (agentId && HUB_DATA.agents[agentId]) {
    const health = agentHealthColor(HUB_DATA.agents[agentId].last_updated || null);
    const ringColor = health === 'green'  ? 'rgba(46,204,113,0.8)'
                    : health === 'yellow' ? 'rgba(243,156,18,0.8)'
                    : 'rgba(231,76,60,0.8)';
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Icon
  if (icon) {
    ctx.font = `${Math.round(r * 0.9)}px system-ui`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(icon, 0, 1);
  }

  // Label
  ctx.fillStyle   = '#E8E8F0';
  ctx.font        = `11px system-ui`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'top';
  const lines = wrapText(label, 80, '11px system-ui');
  lines.forEach((line, i) => {
    ctx.fillText(line, 0, r + 6 + i * 14);
  });

  // Timestamp
  if (agentId && HUB_DATA.agents[agentId]) {
    const timeStr = formatRelativeTime(HUB_DATA.agents[agentId].last_updated || null);
    ctx.font      = '9px system-ui';
    ctx.fillStyle = 'rgba(136,136,170,0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(timeStr, 0, r + 6 + lines.length * 14);
  }

  ctx.restore();
}

function wrapText(text, maxW, font) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  ctx.save();
  ctx.font = font;
  words.forEach(w => {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  });
  if (cur) lines.push(cur);
  ctx.restore();
  return lines.slice(0, 2);
}

// ══════════════════════════════════════════════════════════════════
// FINANCIAL AGENT LEVEL — universe planets
// ══════════════════════════════════════════════════════════════════
let univPlanets = [];

function buildUnivPlanets() {
  univPlanets = [];
  const pd = HUB_DATA.planetData || [];
  pd.forEach(p => {
    const r = 15 + (p.size || 0.5) * 25;
    univPlanets.push({
      id:       p.id,
      label:    p.display_name,
      color:    p.color,
      radius:   r,
      orbitR:   p.orbit_radius || 200,
      angleDeg: p.orbit_angle_deg || 0,
      speed:    (p.orbit_radius || 200) / 800,
      xp:       p.xp || 0,
      da:       (p.resource_yield || 0) / 100,
      tierCounts: p.tier_counts || {},
      x: 0, y: 0,
      scaleAnim: 1.0,
      alphaAnim: 1.0,
    });
  });
}

function drawFinancialLevel() {
  ctx.fillStyle = '#0A0A1A';
  ctx.fillRect(0, 0, W, H);
  drawStars();

  // Orbit rings (faint)
  const radii = [...new Set(univPlanets.map(p => p.orbitR))];
  radii.forEach(r => {
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Center: financial agent
  const finData = HUB_DATA.agents['financial-analysis-agent'] || {};
  ctx.save();
  ctx.shadowBlur = 18; ctx.shadowColor = '#F39C12';
  ctx.beginPath();
  ctx.arc(CX, CY, 32, 0, Math.PI * 2);
  ctx.fillStyle = '#F39C12';
  ctx.fill();
  ctx.restore();
  ctx.font = '20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText('📈', CX, CY);
  ctx.fillStyle = '#E8E8F0'; ctx.font = '12px system-ui'; ctx.textBaseline = 'top';
  ctx.fillText('Financial Agent', CX, CY + 37);

  // Universe planets
  univPlanets.forEach(p => {
    p.angleDeg += p.speed * 0.015;
    const rad = (p.angleDeg * Math.PI) / 180;
    p.x = CX + Math.cos(rad) * p.orbitR;
    p.y = CY + Math.sin(rad) * p.orbitR;
    drawPlanet(p.x, p.y, p.radius, p.color, p.label, null,
               p.scaleAnim, p.alphaAnim, false);
  });
}

// ══════════════════════════════════════════════════════════════════
// UNIVERSE LEVEL — ticker planets
// ══════════════════════════════════════════════════════════════════
let tickerPlanets = [];
const TIER_RINGS = { significant_edge: 120, candidate: 200, weak: 280 };
const TIER_RADII = { significant_edge: 20, candidate: 16, weak: 12 };
const TIER_MAX   = { significant_edge: 8,  candidate: 12, weak: 9999 };

function buildTickerPlanets(universeId) {
  tickerPlanets = [];
  const tickers = (HUB_DATA.tickers || []).filter(t => t.universe_id === universeId);
  const byTier  = { significant_edge: [], candidate: [], weak: [] };
  tickers.forEach(t => byTier[t.tier || 'weak'].push(t));

  Object.entries(byTier).forEach(([tier, list]) => {
    const ring  = TIER_RINGS[tier];
    const r     = TIER_RADII[tier];
    const max   = TIER_MAX[tier];
    const shown = list.slice(0, max);
    shown.forEach((t, i) => {
      const angleDeg = (360 / shown.length) * i;
      const da = t.da_1w || 0;
      const color = da >= 0.60 ? '#2ECC71' : da >= 0.52 ? '#F39C12' : '#E74C3C';
      tickerPlanets.push({
        ticker:   t.ticker,
        tier,
        da,
        ring,
        radius:   r,
        angleDeg,
        speed:    0.3 + Math.random() * 0.3,
        color,
        pulse:    t.forward_test_active || false,
        data:     t,
        x: 0, y: 0,
        scaleAnim: 1.0, alphaAnim: 1.0,
      });
    });
  });
}

function drawUniverseLevel() {
  ctx.fillStyle = '#0A0A1A';
  ctx.fillRect(0, 0, W, H);
  drawStars();

  // Orbit rings
  [120, 200, 280].forEach(r => {
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Center: universe planet
  const uid   = STATE.selectedUniverse;
  const udata = (HUB_DATA.universes || []).find(u => u.id === uid) || {};
  const uColor = udata.color || '#888';
  ctx.save();
  ctx.shadowBlur = 18; ctx.shadowColor = uColor;
  ctx.beginPath();
  ctx.arc(CX, CY, 32, 0, Math.PI * 2);
  ctx.fillStyle = uColor;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#E8E8F0'; ctx.font = '12px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(udata.display_name || uid, CX, CY + 37);

  // Ticker planets
  tickerPlanets.forEach(p => {
    p.angleDeg += p.speed * 0.015;
    const rad = (p.angleDeg * Math.PI) / 180;
    p.x = CX + Math.cos(rad) * p.ring;
    p.y = CY + Math.sin(rad) * p.ring;

    const showLabel = p.tier !== 'weak';
    drawTickerPlanet(p.x, p.y, p.radius, p.color, p.ticker,
                     p.scaleAnim, p.alphaAnim, p.pulse, showLabel);
  });
}

function drawTickerPlanet(x, y, r, color, label, scale, alpha, pulse, showLabel) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (pulse) {
    const pt = (STATE.frame % 120) / 120;
    ctx.beginPath();
    ctx.arc(0, 0, r + pt * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.4 * (1 - pt)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.shadowBlur = 8; ctx.shadowColor = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;

  if (showLabel) {
    ctx.fillStyle = '#E8E8F0';
    ctx.font = '8px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, 0, r + 3);
  }
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// REACTIVE AGENT LEVEL — HTML overlay
// ══════════════════════════════════════════════════════════════════
function drawReactiveLevel() {
  ctx.fillStyle = '#0A0A1A';
  ctx.fillRect(0, 0, W, H);
  drawStars();
}

// ══════════════════════════════════════════════════════════════════
// BUILD GUIDE LEVEL
// ══════════════════════════════════════════════════════════════════
function drawBuildGuideLevel() {
  ctx.fillStyle = '#0A0A1A';
  ctx.fillRect(0, 0, W, H);
  drawStars();
}

// ══════════════════════════════════════════════════════════════════
// PANEL CONTENT
// ══════════════════════════════════════════════════════════════════
function openPanel(html) {
  document.getElementById('panel-content').innerHTML = html;
  document.getElementById('side-panel').classList.add('panel-open');
  STATE.panelOpen = true;
}

function closePanel() {
  document.getElementById('side-panel').classList.remove('panel-open');
  STATE.panelOpen = false;
  if (STATE.level === 'TICKER') {
    STATE.level = 'UNIVERSE';
    STATE.selectedTicker = null;
    updateBreadcrumb();
  }
  if (STATE.level === 'AGENT_REACTIVE') {
    navigateTo('GALAXY');
  }
}

function renderTickerPanel(tickerData) {
  if (!tickerData) return '<p>No data</p>';
  const da     = tickerData.da_1w || 0;
  const pct    = Math.round(da * 100);
  const tier   = tickerData.tier || 'weak';
  const lp     = tickerData.last_prediction;
  const ft     = tickerData.forward_test_active;
  const uid    = tickerData.universe_id || '';
  const udata  = (HUB_DATA.universes || []).find(u => u.id === uid) || {};

  const tierLabel = { significant_edge: 'Significant Edge', candidate: 'Candidate', weak: 'Weak' }[tier] || tier;
  const tierClass = { significant_edge: 'tier-significant', candidate: 'tier-candidate', weak: 'tier-weak' }[tier] || 'tier-weak';

  let scorersHtml = '';
  // Scorers not stored in tickers.json — show placeholder
  scorersHtml = `
    <div class="panel-section">
      <div class="panel-section-title">Scorers</div>
      <p class="text-muted" style="font-size:11px">Run daily_forward_test.py to populate scorer data</p>
    </div>`;

  let predHtml = '';
  if (lp) {
    const dirIcon = lp.direction === 'up' ? '↑' : lp.direction === 'down' ? '↓' : '→';
    const dirClass = lp.direction === 'up' ? 'up' : lp.direction === 'down' ? 'down' : '';
    const dateStr  = lp.created_at ? lp.created_at.slice(0,10) : '—';
    predHtml = `
      <div class="panel-section">
        <div class="panel-section-title">Last Prediction</div>
        <div class="stat-row"><span class="stat-label">Direction</span><span class="stat-value ${dirClass}">${lp.direction.toUpperCase()} ${dirIcon}</span></div>
        <div class="stat-row"><span class="stat-label">Confidence</span><span class="stat-value">${lp.confidence || '—'}</span></div>
        <div class="stat-row"><span class="stat-label">Composite</span><span class="stat-value">${(lp.composite || 0).toFixed(3)}</span></div>
        <div class="stat-row"><span class="stat-label">Date</span><span class="stat-value">${dateStr}</span></div>
      </div>`;
  } else {
    predHtml = `
      <div class="panel-section">
        <div class="panel-section-title">Last Prediction</div>
        <p class="text-muted" style="font-size:11px">No predictions yet — run daily_forward_test.py</p>
      </div>`;
  }

  const ftLabel = ft ? '<span class="stat-value active">ACTIVE</span>' : '<span class="stat-value inactive">OFF</span>';
  const upgradeDisabled = ft ? 'disabled style="opacity:0.4"' : '';
  const upgradeLabel    = ft ? 'Already in Forward Test ✓' : 'Add to Forward Test';

  return `
    <div class="panel-ticker-header">
      <span class="panel-ticker-symbol">${tickerData.ticker}</span>
      <span class="tier-badge ${tierClass}">${tierLabel}</span>
    </div>
    <div class="panel-sub">${tickerData.sector || '—'} · ${udata.display_name || uid}</div>

    <div class="stat-row" style="margin-top:4px">
      <span class="stat-label">Resource Yield (DA)</span>
      <span class="stat-value">${pct}%</span>
    </div>
    <div class="progress-wrap">
      <div class="progress-fill" style="width:${pct}%"></div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Stats</div>
      <div class="stat-row"><span class="stat-label">XP (correct calls)</span><span class="stat-value">${tickerData.n_windows_1w ? Math.round((tickerData.da_1w||0) * tickerData.n_windows_1w) : '—'}</span></div>
      <div class="stat-row"><span class="stat-label">Backtest Windows</span><span class="stat-value">${tickerData.n_windows_1w || '—'}</span></div>
      <div class="stat-row"><span class="stat-label">Forward Test</span>${ftLabel}</div>
    </div>

    ${scorersHtml}
    ${predHtml}

    <div class="panel-section">
      <div class="panel-section-title">Upgrade Track</div>
      <button class="upgrade-btn" ${upgradeDisabled}>${upgradeLabel}</button>
    </div>`;
}

function renderReactivePanel(agentId) {
  const agent = HUB_DATA.agents[agentId] || {};
  const fns   = agent.functions || [];
  const fnRows = fns.map(f => `
    <li class="fn-row" data-fn="${f.id}">
      <div>
        <div class="fn-label">${f.label}</div>
        <div class="fn-desc">${f.description}</div>
      </div>
    </li>`).join('');

  return `
    <div class="reactive-card">
      <div class="reactive-icon">${agent.icon || '?'}</div>
      <div class="reactive-name">${agent.display_name || agentId}</div>
      <div class="reactive-desc">${agent.description || ''}</div>
      <input class="search-input" id="fn-search" placeholder="Search functions…" oninput="filterFunctions(this.value)">
      <ul class="fn-list" id="fn-list">${fnRows}</ul>
    </div>`;
}

function renderFunctionPanel(agentId, fnId) {
  const agent = HUB_DATA.agents[agentId] || {};
  const fn    = (agent.functions || []).find(f => f.id === fnId) || {};
  return `
    <div style="padding-top:8px">
      <div class="panel-ticker-header">
        <span class="panel-ticker-symbol">${fn.label || fnId}</span>
        <span class="tier-badge tier-significant">Active</span>
      </div>
      <div class="panel-sub">${agent.display_name || agentId}</div>
      <div class="panel-section">
        <div class="panel-section-title">Description</div>
        <p style="font-size:13px;line-height:1.5;color:var(--text)">${fn.description || '—'}</p>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">How to Improve</div>
        <p style="font-size:12px;color:var(--text-muted)">Edit <code>${agentId}/classify.md</code> or <code>produce.md</code> in Claude Code</p>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Status</div>
        <div class="stat-row"><span class="stat-label">Active</span><span class="stat-value active">Yes</span></div>
      </div>
    </div>`;
}

function renderBuildGuideCard() {
  const bg = HUB_DATA.buildGuide || {};
  return `
    <div class="bg-card">
      <div class="bg-title">📖 Build Guide <span class="version-badge">${bg.template_version || 'v3'}</span></div>
      <div class="branch-btns">
        <button class="branch-btn">⚡ Reactive Agents</button>
        <button class="branch-btn">📊 Analytical Agents</button>
      </div>
      <div class="stat-row"><span class="stat-label">Agents Built</span><span class="stat-value">${bg.agents_built || 0}</span></div>
      <div class="stat-row"><span class="stat-label">Known Gaps</span><span class="stat-value">${bg.known_gaps || 0}</span></div>
      <div class="stat-row"><span class="stat-label">Last Updated</span><span class="stat-value">${bg.last_updated || '—'}</span></div>
      <p class="bg-desc">The operating manual for this agent ecosystem. Every agent built here follows this guide. Every pattern proven in a real agent gets promoted back here.</p>
      <p class="bg-activity">Recent: Build Guide refactored 2026-05-17 — reactive vs analytical branches added</p>
      <a class="view-guide-btn" href="../agent-template/BUILD-GUIDE.md" target="_blank">View Full Guide →</a>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════
function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  let html = '<span class="bc-link" onclick="navigateTo(\'GALAXY\')">Galaxy</span>';

  if (STATE.level === 'DASHBOARD') {
    html += ' › <span class="bc-current">Dashboard</span>';

  } else if (STATE.level === 'AGENT_FINANCIAL' ||
             STATE.level === 'UNIVERSE' ||
             STATE.level === 'TICKER') {
    html += ' › <span class="bc-link" onclick="navigateTo(\'AGENT_FINANCIAL\')">Financial Agent</span>';

  } else if (STATE.level === 'AGENT_REACTIVE') {
    const agent = HUB_DATA.agents[STATE.selectedAgent] || {};
    const name  = agent.display_name || STATE.selectedAgent || 'Agent';
    html += ' › <span class="bc-current">' + name + '</span>';

  } else if (STATE.level === 'BUILD_GUIDE') {
    html += ' › <span class="bc-current">Build Guide</span>';
  }

  if (STATE.level === 'UNIVERSE' || STATE.level === 'TICKER') {
    const u = (HUB_DATA.universes || []).find(u => u.id === STATE.selectedUniverse);
    const uName = u ? u.display_name : (STATE.selectedUniverse || '');
    html += ' › <span class="bc-link" onclick="navigateTo(\'UNIVERSE\')">' + uName + '</span>';
  }

  if (STATE.level === 'TICKER' && STATE.selectedTicker) {
    html += ' › <span class="bc-current">' + STATE.selectedTicker.ticker + '</span>';
  }

  bc.innerHTML = html;
}

function navigateTo(level, opts) {
  if (STATE.transitioning) return;
  opts = opts || {};
  STATE.level = level;
  STATE.transitioning = false;
  STATE.zoomTarget = null;

  document.getElementById('btn-back').classList.toggle('hidden', level === 'GALAXY');
  document.getElementById('mobile-back').classList.toggle('hidden', level === 'GALAXY');
  const st = document.getElementById('status-text');

  if (level === 'GALAXY') {
    STATE.selectedAgent    = null;
    STATE.selectedUniverse = null;
    STATE.selectedTicker   = null;
    hideTickerList();
    closePanel();
    st.textContent = `${Object.keys(HUB_DATA.agents).length} agents`;

  } else if (level === 'AGENT_FINANCIAL') {
    STATE.selectedAgent    = 'financial-analysis-agent';
    STATE.selectedUniverse = null;
    STATE.selectedTicker   = null;
    hideTickerList();
    buildUnivPlanets();
    st.textContent = `${HUB_DATA.planetData.length} universes`;

  } else if (level === 'UNIVERSE') {
    const uid = opts.universeId || STATE.selectedUniverse;
    STATE.selectedUniverse = uid;
    STATE.selectedTicker   = null;
    const n = (HUB_DATA.tickers || []).filter(t => t.universe_id === uid).length;
    st.textContent = `${n} tickers`;
    showTickerList(uid);

  } else if (level === 'TICKER') {
    const td = opts.tickerData;
    STATE.selectedTicker = td;
    openTickerPanel(td);
    st.textContent = td ? td.ticker : '';

  } else if (level === 'AGENT_REACTIVE') {
    const aid = opts.agentId;
    STATE.selectedAgent = aid;
    const agent = HUB_DATA.agents[aid] || {};
    st.textContent = `${(agent.functions || []).length} functions`;
    openPanel(renderReactivePanel(aid));

  } else if (level === 'BUILD_GUIDE') {
    st.textContent = 'v3';
    openPanel(renderBuildGuideCard());

  } else if (level === 'DASHBOARD') {
    st.textContent = 'Dashboard';
    showDashboard();
  }

  updateBreadcrumb();
}

// ══════════════════════════════════════════════════════════════════
// TICKER LIST VIEW
// ══════════════════════════════════════════════════════════════════
let _currentTickerList  = [];
let _filteredTickerList = [];
let _currentSortKey     = 'da';

function showTickerList(universeId) {
  document.getElementById('galaxy').style.display = 'none';
  const allTickers = window.HUB_DATA.tickers || [];
  _currentTickerList  = allTickers.filter(t => t.universe_id === universeId);
  _filteredTickerList = [..._currentTickerList];
  _currentSortKey     = 'da';
  sortTickerList('da');
  document.getElementById('ticker-list-container').classList.remove('hidden');
  const searchBox = document.getElementById('ticker-search');
  if (searchBox) searchBox.value = '';
}

function hideTickerList() {
  document.getElementById('ticker-list-container').classList.add('hidden');
  document.getElementById('galaxy').style.display = 'block';
}

function filterTickerList(query) {
  const q = query.toLowerCase().trim();
  _filteredTickerList = q
    ? _currentTickerList.filter(t => t.ticker.toLowerCase().includes(q))
    : [..._currentTickerList];
  renderTickerList();
}

function sortTickerList(key) {
  _currentSortKey = key;
  document.querySelectorAll('.sort-btn').forEach(b => {
    b.classList.remove('active');
    if (b.getAttribute('onclick') === `sortTickerList('${key}')`) b.classList.add('active');
  });
  _filteredTickerList.sort((a, b) => {
    if (key === 'da')      return (b.da_1w || 0) - (a.da_1w || 0);
    if (key === 'name')    return a.ticker.localeCompare(b.ticker);
    if (key === 'windows') return (b.n_windows_1w || 0) - (a.n_windows_1w || 0);
    return 0;
  });
  renderTickerList();
}

function renderTickerList() {
  const body = document.getElementById('ticker-list-body');
  if (!body) return;

  let html = `
    <div class="ticker-list-cols">
      <div>Ticker</div><div>Sector</div>
      <div style="text-align:right">DA %</div>
      <div style="text-align:right">Windows</div>
      <div style="text-align:center">Tier</div>
      <div style="text-align:right">Forward Test</div>
    </div>`;

  if (_filteredTickerList.length === 0) {
    html += '<div style="padding:20px;color:var(--text-muted);text-align:center">No tickers found</div>';
    body.innerHTML = html;
    return;
  }

  _filteredTickerList.forEach(ticker => {
    const da      = ticker.da_1w || 0;
    const daStr   = (da * 100).toFixed(1) + '%';
    const daClass = da >= 0.60 ? 'strong' : da >= 0.52 ? 'mid' : 'weak';
    const n       = ticker.n_windows_1w || 0;
    let tierHtml  = '';
    if (ticker.tier === 'significant_edge') {
      tierHtml = '<span class="tier-badge significant">Edge</span>';
    } else if (ticker.tier === 'candidate') {
      tierHtml = '<span class="tier-badge candidate">Cand.</span>';
    } else {
      tierHtml = '<span class="tier-badge weak">Weak</span>';
    }
    const fwdHtml = ticker.forward_test_active
      ? '<span class="tr-fwd active">● ACTIVE</span>'
      : '<span class="tr-fwd inactive">○ Inactive</span>';
    let predStr = '';
    if (ticker.last_prediction) {
      const dir = ticker.last_prediction.direction;
      predStr = dir === 'up' ? ' ↑' : dir === 'down' ? ' ↓' : '';
    }
    html += `
      <div class="ticker-row" onclick="selectTickerFromList('${ticker.ticker}')">
        <div class="tr-ticker">${ticker.ticker}${predStr}</div>
        <div class="tr-name">${ticker.sector || ''}</div>
        <div class="tr-da ${daClass}">${daStr}</div>
        <div class="tr-windows">${n}</div>
        <div class="tr-badge">${tierHtml}</div>
        ${fwdHtml}
      </div>`;
  });

  body.innerHTML = html;
}

function selectTickerFromList(tickerSymbol) {
  const ticker = (window.HUB_DATA.tickers || []).find(t => t.ticker === tickerSymbol);
  if (!ticker) return;
  STATE.selectedTicker = ticker;
  STATE.level = 'TICKER';
  updateBreadcrumb();
  openTickerPanel(ticker);
}

function openTickerPanel(ticker) {
  if (!ticker) return;
  STATE.panelOpen = true;
  const da      = ticker.da_1w || 0;
  const daStr   = (da * 100).toFixed(1) + '%';
  const detail  = ticker.detail || {};
  const scores  = detail.scorer_snapshot || {};
  const regimes = detail.regime_breakdown || {};
  const yearly  = detail.yearly_breakdown || {};
  const summary = detail.backtest_summary || {};
  const csvPath = ticker.csv_path || null;
  const lp      = ticker.last_prediction;

  const tierLabel = ticker.tier === 'significant_edge' ? 'Significant Edge'
                  : ticker.tier === 'candidate'         ? 'Candidate' : 'Weak';
  const tierClass = ticker.tier === 'significant_edge' ? 'significant'
                  : ticker.tier === 'candidate'         ? 'candidate' : 'weak';

  const regimeRows = Object.entries(regimes).map(([name, r]) => {
    const rda = parseFloat(r.da || 0);
    const c   = rda >= 0.60 ? 'var(--success)' : rda >= 0.52 ? 'var(--warning)' : 'var(--danger)';
    return `<tr><td style="text-transform:capitalize">${name.replace(/_/g,' ')}</td><td style="text-align:right">${r.n}</td><td style="text-align:right;color:${c}">${(rda*100).toFixed(1)}%</td></tr>`;
  }).join('');

  const yearRows = Object.entries(yearly).map(([yr, r]) => {
    const yda = parseFloat(r.da || 0);
    const c   = yda >= 0.60 ? 'var(--success)' : yda >= 0.52 ? 'var(--warning)' : 'var(--danger)';
    return `<tr><td>${yr}</td><td style="text-align:right">${r.n}</td><td style="text-align:right;color:${c}">${(yda*100).toFixed(1)}%</td></tr>`;
  }).join('');

  const scorerNames  = ['momentum','value','growth','mean_reversion','macro','quality'];
  const scorerLabels = { momentum:'Momentum', value:'Value', growth:'Growth', mean_reversion:'Mean Rev', macro:'Macro ⚠', quality:'Quality' };
  const scorerBars   = scorerNames.map(s => {
    const val = scores[s] !== undefined ? scores[s] : null;
    const valStr = val !== null ? parseFloat(val).toFixed(0) : '—';
    const pct    = val !== null ? parseFloat(val) : 0;
    const color  = pct >= 65 ? 'var(--success)' : pct >= 45 ? 'var(--warning)' : 'var(--danger)';
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="color:var(--text-muted)">${scorerLabels[s]}</span>
        <span style="color:var(--text)">${valStr}/100</span>
      </div>
      <div style="height:4px;background:var(--border);border-radius:2px">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:2px"></div>
      </div></div>`;
  }).join('');

  const csvLink = csvPath
    ? `<a href="${csvPath}" download="${ticker.ticker}_backtest.csv"
          style="display:block;margin-top:8px;padding:8px 12px;background:rgba(74,158,255,0.1);
                 border:1px solid var(--border);border-radius:6px;color:var(--accent);
                 text-decoration:none;font-size:13px;text-align:center">
         ⬇ Download Full Backtest Data (CSV)</a>`
    : '';

  const predHtml = lp ? `
    <div style="margin-bottom:16px">
      <div class="panel-section-title">Last Prediction</div>
      <div class="stat-row"><span class="stat-label">Direction</span>
        <span class="stat-value" style="color:${lp.direction==='up'?'var(--success)':lp.direction==='down'?'var(--danger)':'var(--text-muted)'}">
          ${lp.direction==='up'?'UP ↑':lp.direction==='down'?'DOWN ↓':'NEUTRAL'}</span></div>
      <div class="stat-row"><span class="stat-label">Confidence</span><span class="stat-value">${lp.confidence||'—'}</span></div>
      <div class="stat-row"><span class="stat-label">Composite</span><span class="stat-value">${lp.composite?(+lp.composite).toFixed(3):'—'}</span></div>
      <div class="stat-row"><span class="stat-label">Date</span><span class="stat-value">${lp.created_at?lp.created_at.split('T')[0]:'—'}</span></div>
    </div>` : '';

  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <h2 style="margin:0;font-size:22px">${ticker.ticker}</h2>
      <span class="tier-badge ${tierClass}">${tierLabel}</span>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">${ticker.sector||''} · ${ticker.universe_id||''}</div>

    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:13px;color:var(--text-muted)">Resource Yield (1w DA)</span>
        <span style="font-size:18px;font-weight:700;color:${da>=0.60?'var(--success)':da>=0.52?'var(--warning)':'var(--danger)'}">${daStr}</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px">
        <div style="width:${da*100}%;height:100%;background:${da>=0.60?'var(--success)':da>=0.52?'var(--warning)':'var(--danger)'};border-radius:3px"></div>
      </div>
    </div>

    <div class="stat-row"><span class="stat-label">XP (correct calls)</span><span class="stat-value">${ticker.n_windows_1w?Math.round((ticker.da_1w||0)*ticker.n_windows_1w):'—'}</span></div>
    <div class="stat-row"><span class="stat-label">Backtest Windows</span><span class="stat-value">${ticker.n_windows_1w||'—'}</span></div>
    <div class="stat-row"><span class="stat-label">Forward Test</span><span class="stat-value" style="color:${ticker.forward_test_active?'var(--success)':'var(--text-muted)'}">${ticker.forward_test_active?'● ACTIVE':'○ Inactive'}</span></div>
    ${summary.mean_actual_return!==undefined?`<div class="stat-row"><span class="stat-label">Mean Actual Return</span><span class="stat-value">${(summary.mean_actual_return*100).toFixed(2)}%</span></div>`:''}

    ${Object.keys(scores).length>0?`
    <div style="margin:16px 0">
      <div class="panel-section-title">Scorers</div>
      ${scorerBars}
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">⚠ Macro scorer inactive — defaults to 50</div>
    </div>`:`<div class="panel-section"><div class="panel-section-title">Scorers</div><p class="text-muted" style="font-size:11px">Run build_scored_windows.py to generate scorer data.</p></div>`}

    ${predHtml}

    ${regimeRows?`
    <div style="margin-bottom:16px">
      <div class="panel-section-title">DA by Market Regime</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="color:var(--text-muted)"><th style="text-align:left;padding:4px 0">Regime</th><th style="text-align:right;padding:4px 0">N</th><th style="text-align:right;padding:4px 0">DA</th></tr>
        ${regimeRows}
      </table>
    </div>`:''}

    ${yearRows?`
    <div style="margin-bottom:16px">
      <div class="panel-section-title">DA by Year</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="color:var(--text-muted)"><th style="text-align:left;padding:4px 0">Year</th><th style="text-align:right;padding:4px 0">N</th><th style="text-align:right;padding:4px 0">DA</th></tr>
        ${yearRows}
      </table>
    </div>`:''}

    <div style="margin-bottom:16px">
      <div class="panel-section-title">Upgrade Track</div>
      <div style="padding:8px 12px;background:rgba(74,158,255,0.05);border-radius:6px;font-size:12px;color:var(--text-muted);text-align:center">
        ${ticker.forward_test_active?'Already in Forward Test ✓':'Add to Forward Test (make change in Claude Code)'}
      </div>
    </div>

    ${csvLink}

    <div style="margin-top:16px;padding:10px;background:rgba(74,158,255,0.05);border-radius:6px;font-size:11px;color:var(--text-muted);line-height:1.5">
      Navigate here on your phone.<br>Make edits in Claude Code on your computer.
    </div>`;

  openPanel(html);
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════
function showDashboard() {
  const panel = document.getElementById('dashboard-panel');
  if (panel) {
    panel.classList.remove('hidden');
    showDashTab('overview');
  }
}

function hideDashboard() {
  const panel = document.getElementById('dashboard-panel');
  if (panel) panel.classList.add('hidden');
}

function showDashTab(tab) {
  document.querySelectorAll('.dash-tab').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('onclick') === `showDashTab('${tab}')`) {
      btn.classList.add('active');
    }
  });

  const content = document.getElementById('dashboard-content');
  if (!content) return;
  const d = dashboardData;
  const stats = d ? d.backtest_stats : {};

  if (tab === 'overview') {
    const totalW = stats.total_windows ? stats.total_windows.toLocaleString() : '—';
    const totalT = stats.total_tickers || '—';
    const bestDA = stats.best_da_1w ? (stats.best_da_1w * 100).toFixed(1) + '%' : '—';
    const meanDA = stats.mean_da_1w  ? (stats.mean_da_1w  * 100).toFixed(1) + '%' : '—';
    const fwdN   = stats.forward_test_predictions || 0;
    const bestT  = stats.best_ticker_1w || '—';

    content.innerHTML = `
      <h3>Ecosystem Overview</h3>
      <div class="dash-stat-grid">
        <div class="dash-stat-card"><div class="dash-stat-value">${totalW}</div><div class="dash-stat-label">Backtest Windows (1w)</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">${totalT}</div><div class="dash-stat-label">Tickers Analyzed</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">16</div><div class="dash-stat-label">Industries</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">${meanDA}</div><div class="dash-stat-label">Mean 1w Accuracy</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">${bestDA}</div><div class="dash-stat-label">Best Ticker DA (${bestT})</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">${fwdN}</div><div class="dash-stat-label">Live Predictions</div></div>
      </div>
      <h3>How to Navigate</h3>
      <div class="dash-section">
        <p><strong>Galaxy view</strong> — shows all your AI agents as planets. Click any agent to explore it.</p>
        <p><strong>Financial Agent</strong> — click to see 16 industry universes as orbiting planets. Planet size = number of tickers. Color = accuracy (green = strong, yellow = neutral, red = weak).</p>
        <p><strong>Industry view</strong> — click any universe planet to see a list of all tickers in that industry with their stats.</p>
        <p><strong>Ticker detail</strong> — click any ticker row to see full analysis: accuracy by regime, by year, scorer breakdown, and a link to download the raw backtest data as a spreadsheet.</p>
        <p><strong>Quick nav bar</strong> — the strip below the top bar lets you jump directly to any level. Use ☰ Dashboard to open this panel from anywhere.</p>
        <p><strong>Phone</strong> — navigate and explore on your phone. Make edits on your computer in Claude Code.</p>
      </div>
      <h3>Agent Roster</h3>
      <div class="dash-section">
        <p>📈 <strong>Financial Analysis Agent</strong> — analytical. Evaluates stocks using 6 scorers + Monte Carlo simulation.</p>
        <p>✉ <strong>Email Agent</strong> — reactive. Drafts email replies. Needs Gmail connection to go live.</p>
        <p>📅 <strong>Meeting Prep Agent</strong> — reactive. Generates prep docs, live notes, follow-ups.</p>
        <p>💬 <strong>Text Agent</strong> — reactive. Triages and drafts text message replies.</p>
        <p>📋 <strong>Decision Memo Agent</strong> — reactive. Produces structured decision memos.</p>
        <p>📖 <strong>Build Guide</strong> — the operating manual for adding new agents. Currently v3 with reactive and analytical branches.</p>
      </div>`;

  } else if (tab === 'methodology') {
    const m = d ? d.methodology : {};
    content.innerHTML = `
      <h3>How Backtesting Works</h3>
      <div class="dash-section"><p>${m.backtesting || ''}</p></div>
      <h3>Directional Accuracy (DA)</h3>
      <div class="dash-section">
        <p>${m.directional_accuracy || ''}</p>
        <p>A DA of 50% = coin flip. A DA of 60%+ = meaningful edge. Only GE has passed all statistical gates (bootstrap CI + permutation test) confirming its edge is real, not lucky.</p>
      </div>
      <h3>Monte Carlo Simulation</h3>
      <div class="dash-section"><p>${m.monte_carlo || ''}</p></div>
      <h3>Composite Score</h3>
      <div class="dash-section">
        <p>${m.composite_score || ''}</p>
        <p>Formula: <code>(data_completeness + scorer_agreement + monte_carlo_win_rate + historical_calibration) / 4</code></p>
        <p>The historical calibration floor is max(0.50, actual) so a ticker with no history doesn't drag the score below what random chance would give.</p>
      </div>
      <h3>Forward Testing</h3>
      <div class="dash-section">
        <p>${m.forward_testing || ''}</p>
        <p>39 tickers currently in forward test. Predictions started 2026-05-18. First resolutions expected ~21 days later. Results will appear in the Forward Test tab once available.</p>
      </div>
      <h3>Tiers</h3>
      <div class="dash-section">
        <p><span class="dash-tag">Significant Edge</span> DA >= 60% with 10+ windows. Strongest confirmed signal.</p>
        <p><span class="dash-tag">Candidate</span> DA >= 55% with 5+ windows. Promising, needs more data.</p>
        <p><span class="dash-tag">Weak</span> Below threshold. No reliable edge — but model still runs predictions for data accumulation.</p>
      </div>`;

  } else if (tab === 'sources') {
    const s = d ? d.data_sources : {};
    content.innerHTML = `
      <h3>Data Sources</h3>
      <div class="dash-section">
        <p><strong>Price data (OHLCV)</strong><br>${s.price_ohlcv || 'yfinance'}<br><em>Open, High, Low, Close, Volume — daily bars going back to 2018.</em></p>
        <p><strong>Fundamental data</strong><br>${s.fundamentals || 'yfinance Ticker.info'}<br><em>Note: fetched at current date, not historical point-in-time. This may introduce slight look-ahead bias in fundamental scorers.</em></p>
        <p><strong>Macro data</strong><br>${s.macro || 'FRED API — not active'}<br><em>Not currently active. Macro scorer defaults to 50/100. To activate: configure FRED_API_KEY environment variable.</em></p>
        <p><strong>Database</strong><br>${s.backtest_db || 'SQLite'}</p>
      </div>
      <h3>What Each Number Means</h3>
      <div class="dash-section">
        <table class="dash-table">
          <tr><th>Field</th><th>Source</th><th>Meaning</th></tr>
          <tr><td>DA %</td><td>backtest_windows table</td><td>% of directional predictions correct on 1-week horizon</td></tr>
          <tr><td>XP</td><td>backtest_windows table</td><td>Total correct predictions across all backtest windows</td></tr>
          <tr><td>Composite</td><td>Computed at prediction time</td><td>Confidence score 0-1 from 4 components</td></tr>
          <tr><td>Momentum score</td><td>scored_windows table</td><td>RSI, MACD, MA crossover (0-100)</td></tr>
          <tr><td>Value score</td><td>scored_windows table</td><td>P/E, P/B, FCF yield (0-100)</td></tr>
          <tr><td>Growth score</td><td>scored_windows table</td><td>Revenue growth, earnings growth (0-100)</td></tr>
          <tr><td>Mean Rev score</td><td>scored_windows table</td><td>Bollinger Bands, RSI extremes (0-100)</td></tr>
          <tr><td>Macro score</td><td>scored_windows table</td><td>Yield curve, rates — INACTIVE, always 50</td></tr>
          <tr><td>Quality score</td><td>scored_windows table</td><td>ROE, margins, leverage (0-100)</td></tr>
          <tr><td>Regime</td><td>Computed from ATR + moving averages</td><td>Market condition: bull/bear/chop/volatile/crisis</td></tr>
        </table>
      </div>`;

  } else if (tab === 'scorers') {
    const sc = d ? d.scorers : {};
    const scorerRows = Object.entries(sc).map(([name, desc]) => `
      <div style="margin-bottom:14px">
        <strong style="color:var(--accent);text-transform:capitalize">${name}</strong><br>
        <span style="color:var(--text-muted);font-size:13px">${desc}</span>
      </div>`).join('');
    content.innerHTML = `
      <h3>The 6 Scorers (0-100 each)</h3>
      <p>Every ticker is evaluated across 6 dimensions. The scores feed into the composite confidence score for each prediction.</p>
      <div class="dash-section">${scorerRows}</div>
      <div class="dash-warning">⚠ Macro scorer is currently inactive. All macro scores default to 50. This means the composite score is effectively based on 5 scorers, not 6. To activate: set FRED_API_KEY in your environment and re-run the analysis.</div>
      <h3>How Scores Combine</h3>
      <p>The 6 scorer outputs (0-100 each) are combined with a weight profile. Default weights are equal (1/6 each). The weighted average is normalized to 0-1 and feeds into the composite score alongside Monte Carlo win rate, data completeness, and historical calibration.</p>
      <p>Bootstrap testing showed weight optimization requires 1000+ scored windows to be meaningful. Currently at 720 windows — more accumulates automatically with each forward-test run.</p>`;

  } else if (tab === 'backtest') {
    const totalW = stats.total_windows ? stats.total_windows.toLocaleString() : '—';
    const totalT = stats.total_tickers || '—';
    const meanDA = stats.mean_da_1w ? (stats.mean_da_1w * 100).toFixed(1) + '%' : '—';
    const bestT  = stats.best_ticker_1w || '—';
    const bestDA = stats.best_da_1w ? (stats.best_da_1w * 100).toFixed(1) + '%' : '—';
    content.innerHTML = `
      <h3>Backtest Results Summary</h3>
      <div class="dash-stat-grid">
        <div class="dash-stat-card"><div class="dash-stat-value">${totalW}</div><div class="dash-stat-label">Total 1w Windows</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">${totalT}</div><div class="dash-stat-label">Tickers Analyzed</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">2018–2026</div><div class="dash-stat-label">Date Range</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">${meanDA}</div><div class="dash-stat-label">Mean Accuracy (1w)</div></div>
      </div>
      <h3>Key Findings</h3>
      <div class="dash-section">
        <p>• <strong>1-week horizon</strong> is the strongest interval. Very short (1-2 day) and short (2-5 day) windows produce only neutral signals — Monte Carlo win rates cluster too tightly around 50% to breach the prediction threshold.</p>
        <p>• <strong>Only GE</strong> passes all statistical gates: bootstrap 95% CI lower bound > 55%, permutation test p &lt; 0.05. All other tickers are in training mode.</p>
        <p>• <strong>Regime shift</strong> accounts for 56.9% of wrong predictions. The model itself is not the main bottleneck — timing relative to regime changes is.</p>
        <p>• <strong>Best performing</strong> ticker: ${bestT} at ${bestDA} DA.</p>
        <p>• <strong>High-volatility regime</strong> is the trap: highest Monte Carlo win rate but second-lowest realized accuracy. Treat high-volatility predictions with caution.</p>
      </div>
      <h3>Statistical Validation</h3>
      <div class="dash-section">
        <p>Every ticker was tested with:</p>
        <p>• <strong>Bootstrap CI</strong> — 1000 resamples. Tests if DA is genuinely above 50% vs lucky.</p>
        <p>• <strong>Permutation test</strong> — 1000 shuffles. Tests if the edge survives random label scrambling.</p>
        <p>• <strong>Multi-seed Monte Carlo</strong> — 30 seeds. Tests if win rate is stable across different random draws.</p>
        <p>• <strong>Look-ahead verification</strong> — oracle delta >= +0.20 on all tested tickers. Pipeline is confirmed clean.</p>
      </div>`;

  } else if (tab === 'forward') {
    const fwdN = stats.forward_test_predictions || 0;
    content.innerHTML = `
      <h3>Forward Test Status</h3>
      <div class="dash-stat-grid">
        <div class="dash-stat-card"><div class="dash-stat-value">${fwdN}</div><div class="dash-stat-label">Predictions Logged</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">39</div><div class="dash-stat-label">Tickers in Forward Test</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">21 days</div><div class="dash-stat-label">Resolution Horizon</div></div>
        <div class="dash-stat-card"><div class="dash-stat-value">0</div><div class="dash-stat-label">Resolved So Far</div></div>
      </div>
      <div class="dash-warning">⏳ Forward-test predictions started 2026-05-18. First resolutions expected ~2026-06-08 (21 days later). This tab will show live accuracy results once predictions resolve.</div>
      <h3>How Forward Testing Works</h3>
      <div class="dash-section">
        <p>Each morning at 9:35am ET (once Task Scheduler is configured), the system automatically:</p>
        <p>1. Fetches today's price for all 39 forward-test tickers</p>
        <p>2. Runs the full scoring pipeline on each</p>
        <p>3. Stores a prediction: UP, DOWN, or NEUTRAL with confidence</p>
        <p>After 21 calendar days, the reconciliation script runs at 4:30pm ET, fetches the actual price, and records whether the prediction was correct.</p>
      </div>
      <h3>Task Scheduler Setup</h3>
      <div class="dash-section">
        <p>To activate daily automation:</p>
        <p>1. Run: <code>python scripts/task_scheduler_setup.py</code></p>
        <p>2. Open Windows Task Scheduler</p>
        <p>3. Import the two XML files from <code>financial-analysis-agent/data/exports/</code></p>
        <p>4. Set laptop sleep to Never (Settings > System > Power & Sleep)</p>
        <p>Full instructions: <code>STEP4_INSTRUCTIONS.md</code> at repo root.</p>
      </div>`;

  } else if (tab === 'limits') {
    const limits = d ? d.known_limitations : [];
    const limitRows = limits.map(l => `<div class="dash-warning">⚠ ${l}</div>`).join('');
    content.innerHTML = `
      <h3>Known Limitations</h3>
      <p>These are confirmed gaps in the current system. Being transparent about them is part of the methodology.</p>
      <div class="dash-section">${limitRows}</div>
      <h3>What This Agent Can and Cannot Do</h3>
      <div class="dash-section">
        <p><strong>Can:</strong> Identify tickers where a statistical directional edge exists over a 1-week horizon based on historical price patterns and fundamentals.</p>
        <p><strong>Cannot:</strong> Predict news events, earnings surprises, macro shifts, or regime changes. Cannot account for real-time data, after-hours moves, or liquidity constraints.</p>
        <p><strong>Not financial advice.</strong> This is a research and learning system. All predictions are for educational purposes.</p>
      </div>`;
  }
}

// ══════════════════════════════════════════════════════════════════
// HIT TESTING
// ══════════════════════════════════════════════════════════════════
let tooltip = { visible: false, text: '', x: 0, y: 0 };

function hitTest(mx, my) {
  if (STATE.level === 'GALAXY') {
    for (const p of galaxyPlanets) {
      const dx = mx - p.x, dy = my - p.y;
      if (dx*dx + dy*dy <= (p.radius+6) * (p.radius+6)) return p;
    }
  } else if (STATE.level === 'AGENT_FINANCIAL') {
    for (const p of univPlanets) {
      const dx = mx - p.x, dy = my - p.y;
      if (dx*dx + dy*dy <= (p.radius+6)*(p.radius+6)) return p;
    }
  } else if (STATE.level === 'UNIVERSE' || STATE.level === 'TICKER') {
    for (const p of tickerPlanets) {
      const dx = mx - p.x, dy = my - p.y;
      if (dx*dx + dy*dy <= (p.radius+8)*(p.radius+8)) return p;
    }
  }
  return null;
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ══════════════════════════════════════════════════════════════════
// INTERACTIONS
// ══════════════════════════════════════════════════════════════════
canvas.addEventListener('mousemove', e => {
  const { x, y } = getCanvasPos(e);
  const hit = hitTest(x, y);
  if (hit) {
    canvas.style.cursor = 'pointer';
    let tipText = '';
    if (STATE.level === 'GALAXY') {
      tipText = `${hit.label}: ${hit.desc || ''}`;
    } else if (STATE.level === 'AGENT_FINANCIAL') {
      tipText = `${hit.label} — DA: ${(hit.da*100).toFixed(1)}%`;
    } else if (STATE.level === 'UNIVERSE' || STATE.level === 'TICKER') {
      tipText = `${hit.ticker} — DA: ${(hit.da*100).toFixed(1)}%`;
    }
    tooltip = { visible: true, text: tipText, x, y };
  } else {
    canvas.style.cursor = 'default';
    tooltip.visible = false;
  }
});

canvas.addEventListener('click', e => {
  if (STATE.transitioning) return;
  const { x, y } = getCanvasPos(e);
  handleClick(x, y);
});

canvas.addEventListener('touchend', e => {
  if (STATE.transitioning) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const touch = e.changedTouches[0];
  handleClick(touch.clientX - rect.left, touch.clientY - rect.top);
}, { passive: false });

function handleClick(x, y) {
  // Center hub click in GALAXY level → open dashboard
  if (STATE.level === 'GALAXY') {
    const dcx = x - CX, dcy = y - CY;
    if (dcx * dcx + dcy * dcy <= 28 * 28) {
      showDashboard();
      return;
    }
  }

  const hit = hitTest(x, y);
  if (!hit) return;

  if (STATE.level === 'GALAXY') {
    if (hit.id === 'financial-analysis-agent') {
      zoomTransition(() => navigateTo('AGENT_FINANCIAL'));
    } else if (hit.id === 'build-guide') {
      zoomTransition(() => navigateTo('BUILD_GUIDE'));
    } else {
      zoomTransition(() => navigateTo('AGENT_REACTIVE', { agentId: hit.id }));
    }

  } else if (STATE.level === 'AGENT_FINANCIAL') {
    STATE.selectedUniverse = hit.id;
    zoomTransition(() => navigateTo('UNIVERSE', { universeId: hit.id }));

  } else if (STATE.level === 'UNIVERSE' || STATE.level === 'TICKER') {
    const tdata = (HUB_DATA.tickers || []).find(t => t.ticker === hit.ticker);
    navigateTo('TICKER', { tickerData: tdata || hit.data || {} });
  }
}

function zoomTransition(callback) {
  STATE.transitioning = true;
  let elapsed = 0;
  const dur = 300;
  const start = performance.now();
  function step(now) {
    elapsed = now - start;
    const prog = Math.min(elapsed / dur, 1);
    STATE.transitionAlpha = 1 - prog;
    if (prog < 1) {
      requestAnimationFrame(step);
    } else {
      STATE.transitionAlpha = 1.0;
      STATE.transitioning = false;
      callback();
    }
  }
  requestAnimationFrame(step);
}

// Back button
function goBack() {
  if (STATE.level === 'AGENT_FINANCIAL' || STATE.level === 'AGENT_REACTIVE' || STATE.level === 'BUILD_GUIDE') {
    zoomTransition(() => navigateTo('GALAXY'));
  } else if (STATE.level === 'UNIVERSE') {
    zoomTransition(() => navigateTo('AGENT_FINANCIAL'));
  } else if (STATE.level === 'TICKER') {
    closePanel();
    STATE.level = 'UNIVERSE';
  }
}
document.getElementById('btn-back').addEventListener('click', goBack);
document.getElementById('mobile-back').addEventListener('click', goBack);

// Refresh button
document.getElementById('btn-refresh').addEventListener('click', () => {
  loadAllData().then(() => {
    updateLastUpdated();
    updateNotificationDots();
    const lvl = STATE.level;
    if (lvl === 'UNIVERSE') buildTickerPlanets(STATE.selectedUniverse);
    if (lvl === 'AGENT_FINANCIAL') buildUnivPlanets();
    buildGalaxyPlanets();
    showToast('Data refreshed', 'success');
  });
});

// Panel close
document.getElementById('panel-close').addEventListener('click', closePanel);

// Function search (delegated)
function filterFunctions(query) {
  const items = document.querySelectorAll('.fn-row');
  const q = query.toLowerCase();
  items.forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = text.includes(q) ? '' : 'none';
  });
}
window.filterFunctions = filterFunctions;

// Function row click (delegated)
document.getElementById('panel-content').addEventListener('click', e => {
  const row = e.target.closest('.fn-row');
  if (row && STATE.selectedAgent) {
    const fnId = row.dataset.fn;
    openPanel(renderFunctionPanel(STATE.selectedAgent, fnId));
  }
});

// ══════════════════════════════════════════════════════════════════
// TOOLTIP DRAW
// ══════════════════════════════════════════════════════════════════
function drawTooltip() {
  if (!tooltip.visible || !tooltip.text) return;
  const pad = 8, lh = 18;
  ctx.font = '12px system-ui';
  const tw = ctx.measureText(tooltip.text).width;
  let tx = tooltip.x + 12;
  let ty = tooltip.y - 32;
  if (tx + tw + pad * 2 > W) tx = tooltip.x - tw - pad * 2 - 12;
  if (ty < 55) ty = tooltip.y + 14;

  ctx.fillStyle = 'rgba(18,18,42,0.92)';
  ctx.strokeStyle = '#2A2A4A';
  ctx.lineWidth = 1;
  roundRect(ctx, tx, ty, tw + pad * 2, lh + pad, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#E8E8F0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(tooltip.text, tx + pad, ty + pad / 2);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

// ══════════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════════
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type === 'success' ? '#2ECC71' : '#E74C3C';
  t.style.color = '#000';
  t.classList.remove('hidden');
  t.classList.add('toast-show');
  setTimeout(() => {
    t.classList.remove('toast-show');
    setTimeout(() => t.classList.add('hidden'), 300);
  }, 2500);
}

// ══════════════════════════════════════════════════════════════════
// WELCOME MODAL
// ══════════════════════════════════════════════════════════════════
function maybeShowWelcome() {
  const key  = 'agenthub_last_visit';
  const last = localStorage.getItem(key);
  const now  = Date.now();
  const isFirst = !last;
  if (isFirst || (now - Number(last)) > 8 * 3600 * 1000) {
    const overlay = document.getElementById('modal-overlay');
    const title   = document.getElementById('modal-title');
    const stats   = document.getElementById('modal-stats');
    title.textContent = isFirst ? 'Welcome to Agent Hub' : 'Welcome back to Agent Hub';
    const meta = HUB_DATA.meta || {};
    const n    = meta.agent_count || Object.keys(HUB_DATA.agents).length;
    stats.textContent = `${n} agents in your ecosystem · 39 forward-test candidates ready`;
    overlay.classList.remove('hidden');
  }
}

document.getElementById('modal-close').addEventListener('click', () => {
  localStorage.setItem('agenthub_last_visit', Date.now().toString());
  document.getElementById('modal-overlay').classList.add('hidden');
});

// ══════════════════════════════════════════════════════════════════
// MORNING SUMMARY
// ══════════════════════════════════════════════════════════════════
const MORNING_AGENT_IDS = [
  'email-agent', 'meeting-prep-agent', 'text-agent',
  'decision-memo-agent', 'financial-analysis-agent',
];

function agentHealthColor(lastUpdated) {
  if (!lastUpdated) return 'red';
  const ageHours = (Date.now() - new Date(lastUpdated).getTime()) / 3600000;
  if (ageHours <= 24)  return 'green';
  if (ageHours <= 168) return 'yellow';
  return 'red';
}

function formatRelativeTime(lastUpdated) {
  if (!lastUpdated) return 'Never updated';
  const ms   = Date.now() - new Date(lastUpdated).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days  = Math.floor(ms / 86400000);
  return `${days}d ago`;
}

const SCRIPT_LABELS = {
  'daily_forward_test':    'Forward Test',
  'reconcile_predictions': 'Reconcile',
};
function scriptLabel(name) {
  return SCRIPT_LABELS[name] ||
    name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatEventTime(isoStr) {
  const d = new Date(isoStr);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

async function buildMorningSummaryContent() {
  // Fetch session log — silently fail if server is down
  let sessionLog = { events: [], last_session_start: null, streak: 0 };
  try {
    const r = await fetch('http://127.0.0.1:5000/session-log');
    if (r.ok) sessionLog = await r.json();
  } catch (_) {}

  // ── Section 1: Overnight Activity ──────────────────────────────
  const cutoff = sessionLog.last_session_start
    ? new Date(sessionLog.last_session_start)
    : new Date(Date.now() - 12 * 3600000);

  const recentEvents = (sessionLog.events || []).filter(
    ev => new Date(ev.timestamp) >= cutoff
  );

  let overnightHtml;
  if (recentEvents.length === 0) {
    overnightHtml = `<div class="summary-agent-status" style="padding:8px 0">No activity recorded yet — check back after 9:35am.</div>`;
  } else {
    overnightHtml = recentEvents.map(ev => {
      const icon   = ev.status === 'success' ? '✅' : '❌';
      const label  = scriptLabel(ev.script_name);
      const t      = formatEventTime(ev.timestamp);
      const detail = [
        ev.rows_added > 0 ? `${ev.rows_added} rows` : null,
        ev.message         ? ev.message              : null,
        ev.error           ? `Error: ${ev.error}`    : null,
      ].filter(Boolean).join(' · ');
      return `
        <div class="summary-agent-row">
          <div style="font-size:16px;line-height:1">${icon}</div>
          <div class="summary-agent-info">
            <div class="summary-agent-name">${label}</div>
            ${detail ? `<div class="summary-agent-status">${detail}</div>` : ''}
          </div>
          <div class="summary-agent-time">${t}</div>
        </div>`;
    }).join('');
  }

  // ── Section 2: Agent Health ─────────────────────────────────────
  const statuses = MORNING_AGENT_IDS.map(id => {
    const agent  = HUB_DATA.agents[id] || {};
    const health = agentHealthColor(agent.last_updated || null);
    return { id, agent, health };
  });

  const agentRowsHtml = statuses.map(({ id, agent, health }) => {
    const name       = agent.display_name || id;
    const icon       = agent.icon || '?';
    const timeStr    = formatRelativeTime(agent.last_updated || null);
    const statusText = health === 'green'  ? 'Active'
                     : health === 'yellow' ? 'Needs attention'
                     : 'Stale — check agent';
    return `
      <div class="summary-agent-row">
        <div class="summary-health-dot ${health}"></div>
        <div class="summary-agent-info">
          <div class="summary-agent-name">${icon} ${name}</div>
          <div class="summary-agent-status">${statusText}</div>
        </div>
        <div class="summary-agent-time">${timeStr}</div>
      </div>`;
  }).join('');

  const redAgents    = statuses.filter(s => s.health === 'red');
  const yellowAgents = statuses.filter(s => s.health === 'yellow');
  const errorEvents  = recentEvents.filter(ev => ev.status === 'error');

  let alertsHtml = '';
  if (redAgents.length > 0) {
    const names = redAgents.map(s => s.agent.display_name || s.id).join(', ');
    alertsHtml += `<div class="summary-alert">⚠ ${names} ${redAgents.length > 1 ? 'are' : 'is'} stale and may need attention.</div>`;
  }
  const fwdCount = (HUB_DATA.tickers || []).filter(tk => tk.forward_test_active).length;
  if (fwdCount > 0) {
    alertsHtml += `<div class="summary-alert" style="background:rgba(74,158,255,0.1);border-color:rgba(74,158,255,0.3);color:var(--accent)">📈 ${fwdCount} tickers in forward test — open Financial Agent to review.</div>`;
  }

  // ── Section 3: Recommended Action ──────────────────────────────
  let recText;
  if (errorEvents.length > 0) {
    const errLabel = scriptLabel(errorEvents[0].script_name);
    const errMsg   = errorEvents[0].error;
    recText = `${errLabel} encountered an error overnight${errMsg ? `: "${errMsg}"` : ''}. Check server.log for details.`;
  } else if (redAgents.length > 0) {
    const names = redAgents.map(s => s.agent.display_name || s.id).join(', ');
    recText = `${names} ${redAgents.length > 1 ? 'have' : 'has'} not been updated recently. Open Claude Code and run the agent${redAgents.length > 1 ? 's' : ''} to refresh.`;
  } else if (yellowAgents.length > 0) {
    const names = yellowAgents.map(s => s.agent.display_name || s.id).join(', ');
    recText = `${names} ${yellowAgents.length > 1 ? 'are' : 'is'} due for an update. Consider running ${yellowAgents.length > 1 ? 'them' : 'it'} today.`;
  } else {
    recText = 'All agents are active and up to date. Check the Financial Agent for today\'s forward-test predictions.';
  }

  return `
    <div class="summary-section-title">Overnight Activity</div>
    ${overnightHtml}
    <div class="summary-section-title" style="margin-top:20px">Agent Health</div>
    ${agentRowsHtml}
    ${alertsHtml ? `<div style="margin-top:12px">${alertsHtml}</div>` : ''}
    <div class="summary-recommendation">
      <div class="summary-rec-label">Recommended Action</div>
      <div class="summary-rec-text">${recText}</div>
    </div>`;
}

async function showMorningSummary() {
  const el = document.getElementById('morning-summary');
  if (!el) return;
  el.classList.remove('hidden');
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#mobile-bottom-nav .mobile-nav-btn:last-child').classList.add('active');
  document.getElementById('morning-summary-content').innerHTML =
    '<div style="padding:20px;text-align:center;color:var(--text-muted)">Loading…</div>';
  document.getElementById('morning-summary-content').innerHTML = await buildMorningSummaryContent();
}

function hideMorningSummary() {
  const el = document.getElementById('morning-summary');
  if (el) el.classList.add('hidden');
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#mobile-bottom-nav .mobile-nav-btn:first-child').classList.add('active');
}

// ══════════════════════════════════════════════════════════════════
// NOTIFICATION DOTS
// ══════════════════════════════════════════════════════════════════
const REACTIVE_AGENT_IDS = ['email-agent', 'meeting-prep-agent', 'text-agent', 'decision-memo-agent'];

function updateNotificationDots() {
  ['dot-hub', 'dot-financial', 'dot-agents', 'dot-morning'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  });

  const finAgent = HUB_DATA.agents['financial-analysis-agent'] || {};
  const finHealth = agentHealthColor(finAgent.last_updated || null);
  if (finHealth === 'yellow' || finHealth === 'red') {
    const df = document.getElementById('dot-financial');
    const dh = document.getElementById('dot-hub');
    if (df) df.classList.add('visible');
    if (dh) dh.classList.add('visible');
  }

  const anyReactiveBad = REACTIVE_AGENT_IDS.some(id => {
    const agent = HUB_DATA.agents[id] || {};
    const h = agentHealthColor(agent.last_updated || null);
    return h === 'yellow' || h === 'red';
  });
  if (anyReactiveBad) {
    const da = document.getElementById('dot-agents');
    const dh = document.getElementById('dot-hub');
    if (da) da.classList.add('visible');
    if (dh) dh.classList.add('visible');
  }
}

function fetchLiveStatus() {
  fetch('http://127.0.0.1:5000/status')
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(data => {
      (data.agents || []).forEach(agent => {
        if (HUB_DATA.agents[agent.id]) {
          HUB_DATA.agents[agent.id].last_updated = agent.last_updated;
        }
      });
      updateNotificationDots();
    })
    .catch(() => {});
}

// ══════════════════════════════════════════════════════════════════
// LAST UPDATED
// ══════════════════════════════════════════════════════════════════
function updateLastUpdated() {
  const meta = HUB_DATA.meta;
  if (!meta || !meta.generated_at) return;
  const d = new Date(meta.generated_at);
  document.getElementById('last-updated').textContent =
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ══════════════════════════════════════════════════════════════════
// MAIN RENDER LOOP
// ══════════════════════════════════════════════════════════════════
function draw() {
  STATE.frame++;
  ctx.save();
  ctx.globalAlpha = STATE.transitionAlpha;

  switch (STATE.level) {
    case 'GALAXY':           drawGalaxy();          break;
    case 'AGENT_FINANCIAL':  drawFinancialLevel();   break;
    case 'UNIVERSE':
    case 'TICKER':           drawUniverseLevel();    break;
    case 'AGENT_REACTIVE':   drawReactiveLevel();    break;
    case 'BUILD_GUIDE':      drawBuildGuideLevel();  break;
    default:                 drawGalaxy();
  }

  ctx.restore();
  drawTooltip();
  requestAnimationFrame(draw);
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
function init() {
  resizeCanvas();
  initStars();

  fetch('./data/dashboard.json')
    .then(r => r.json())
    .then(d => { dashboardData = d; })
    .catch(() => { dashboardData = null; });

  loadAllData().then(() => {
    buildGalaxyPlanets();
    buildUnivPlanets();
    updateLastUpdated();
    updateNotificationDots();
    fetchLiveStatus();
    fetch('http://127.0.0.1:5000/mark-session-start').catch(() => {});
    navigateTo('GALAXY');
    maybeShowWelcome();
    document.getElementById('status-text').textContent =
      `${Object.keys(HUB_DATA.agents).length} agents loaded`;
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
    initStars();
  });

  draw();
}

init();
