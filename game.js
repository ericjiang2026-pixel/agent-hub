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
  H = window.innerHeight;
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
               p.scaleAnim, p.alphaAnim, false);
  });
}

function drawPlanet(x, y, r, color, label, icon, scale, alpha, pulse) {
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
function navigateTo(level, opts) {
  opts = opts || {};
  STATE.level = level;
  STATE.transitioning = false;
  STATE.zoomTarget = null;

  document.getElementById('btn-back').classList.toggle('hidden', level === 'GALAXY');

  const bc = document.getElementById('breadcrumb');
  const st = document.getElementById('status-text');

  if (level === 'GALAXY') {
    bc.textContent = 'Galaxy';
    st.textContent = `${Object.keys(HUB_DATA.agents).length} agents`;
    closePanel();
    STATE.selectedAgent = null;
    STATE.selectedUniverse = null;
    STATE.selectedTicker = null;

  } else if (level === 'AGENT_FINANCIAL') {
    STATE.selectedAgent = 'financial-analysis-agent';
    buildUnivPlanets();
    bc.textContent = 'Galaxy › Financial Analysis Agent';
    st.textContent = `${HUB_DATA.planetData.length} universes`;

  } else if (level === 'UNIVERSE') {
    const uid = opts.universeId || STATE.selectedUniverse;
    STATE.selectedUniverse = uid;
    buildTickerPlanets(uid);
    const udata = (HUB_DATA.universes || []).find(u => u.id === uid) || {};
    bc.textContent = `Galaxy › Financial Agent › ${udata.display_name || uid}`;
    const n = tickerPlanets.length;
    st.textContent = `${n} tickers`;

  } else if (level === 'TICKER') {
    const td = opts.tickerData;
    STATE.selectedTicker = td;
    openPanel(renderTickerPanel(td));
    st.textContent = td ? td.ticker : '';

  } else if (level === 'AGENT_REACTIVE') {
    const aid = opts.agentId;
    STATE.selectedAgent = aid;
    const agent = HUB_DATA.agents[aid] || {};
    bc.textContent = `Galaxy › ${agent.display_name || aid}`;
    st.textContent = `${(agent.functions || []).length} functions`;
    openPanel(renderReactivePanel(aid));

  } else if (level === 'BUILD_GUIDE') {
    bc.textContent = 'Galaxy › Build Guide';
    st.textContent = 'v3';
    openPanel(renderBuildGuideCard());
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
document.getElementById('btn-back').addEventListener('click', () => {
  if (STATE.level === 'AGENT_FINANCIAL' || STATE.level === 'AGENT_REACTIVE' || STATE.level === 'BUILD_GUIDE') {
    zoomTransition(() => navigateTo('GALAXY'));
  } else if (STATE.level === 'UNIVERSE') {
    zoomTransition(() => navigateTo('AGENT_FINANCIAL'));
  } else if (STATE.level === 'TICKER') {
    closePanel();
    STATE.level = 'UNIVERSE';
  }
});

// Refresh button
document.getElementById('btn-refresh').addEventListener('click', () => {
  loadAllData().then(() => {
    updateLastUpdated();
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

  loadAllData().then(() => {
    buildGalaxyPlanets();
    buildUnivPlanets();
    updateLastUpdated();
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
