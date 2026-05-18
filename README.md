# Agent Hub — Visual Dashboard

A browser-based galaxy-view dashboard for the multi-agent AI ecosystem. Navigate agents, universes, and tickers on your phone; make changes on your computer with Claude Code.

## Architecture

```
hub-site/
  index.html          — shell (canvas + bars + side panel)
  style.css           — design tokens + all component styles
  game.js             — canvas engine, state machine, interaction
  export_hub_data.py  — generates the data/ JSON files from the DB
  data/
    meta.json                     — hub metadata + aggregate counts
    build_guide.json              — template version + known gaps
    universes.json                — 16 universe planets
    tickers.json                  — 434 tickers sorted by DA
    planet_data.json              — galaxy orbit params per universe
    agents/
      financial-analysis-agent.json
      email-agent.json
      meeting-prep-agent.json
      decision-memo-agent.json
      text-agent.json
```

## Navigation levels

| Level | How to get there |
|-------|-----------------|
| Galaxy | Default — 6 agent planets |
| Agent / Financial | Tap financial planet — shows 16 universe sub-planets |
| Universe | Tap a universe sub-planet — shows ticker ring |
| Ticker | Tap a ticker dot — opens side panel |
| Reactive agents | Tap any reactive agent planet |
| Build Guide | Tap the Build Guide planet |

## Plugin pattern

Each agent is one JSON file in `data/agents/`. To add a new agent:
1. Add its entry to `agents.json` in the repo root
2. Add a JSON config to `hub-site/data/agents/`
3. Re-run `export_hub_data.py` to regenerate all feeds
4. No changes to `game.js` required

## Data refresh

```bash
cd C:\Users\Eric\email-agent
python hub-site/export_hub_data.py
```

Run this after any backtest or forward-test run to update the hub. The script reads from `financial-analysis-agent/data/financial_analysis.db` and writes all JSON files under `hub-site/data/`.

## Scheduled tasks

| Task | Schedule | Script |
|------|----------|--------|
| Daily forward-test | 09:35 ET weekdays | `financial-analysis-agent/scripts/daily_forward_test.py` |
| Reconcile predictions | 16:30 ET weekdays | `financial-analysis-agent/scripts/reconcile_predictions.py` |

Import the XML files from `financial-analysis-agent/data/exports/` into Windows Task Scheduler to activate.

## Design decisions

- **Phone = navigate / ideate only.** The upgrade button in each panel links back to Claude Code on your computer — no in-browser editing.
- **Canvas rendering** with `requestAnimationFrame` for smooth 60fps orbit animation.
- **Seeded RNG** (`mulberry32`) keeps the star field deterministic across refreshes.
- **No build step.** Plain HTML + CSS + JS — open `index.html` directly in a browser, or serve with any static server.
