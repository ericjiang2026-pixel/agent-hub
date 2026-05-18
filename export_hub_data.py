"""
hub-site/export_hub_data.py
Reads all agent + financial data and writes JSON feeds for the hub.
Run from ~/email-agent/:  python hub-site/export_hub_data.py
"""
import sys, json, math
from pathlib import Path
from datetime import datetime, timezone

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / 'financial-analysis-agent'))

from scripts.db import get_connection

OUT_DIR      = Path(__file__).parent / 'data'
AGENTS_DIR   = OUT_DIR / 'agents'
UNIVERSE_DIR = REPO_ROOT / 'financial-analysis-agent' / 'data' / 'universes'

UNIVERSE_COLORS = [
    '#E74C3C', '#3498DB', '#2ECC71', '#9B59B6', '#F39C12', '#1ABC9C',
    '#E67E22', '#34495E', '#E91E63', '#00BCD4', '#8BC34A', '#FF5722',
    '#607D8B', '#795548', '#FF9800', '#9C27B0',
]

AGENT_FUNCTIONS = {
    'email-agent': {
        'functions': [
            {'id': 'triage', 'label': 'Triage',
             'description': 'Decide if email needs a response or can be ignored'},
            {'id': 'draft',  'label': 'Draft',
             'description': 'Write reply in user\'s tone'},
            {'id': 'learn',  'label': 'Learn',
             'description': 'Absorb edits as permanent rules'},
        ],
        'color': '#4A9EFF', 'icon': '✉',
        'description': 'Drafts email replies. Never sends. Learns from edits.',
        'stats': {'edits_logged': 0, 'patterns_promoted': 0, 'style_samples': 0},
    },
    'meeting-prep-agent': {
        'functions': [
            {'id': 'classify',  'label': 'Classify',
             'description': 'Categorise meeting type and stakeholders'},
            {'id': 'prep_doc',  'label': 'Prep Doc',
             'description': 'Generate structured pre-meeting brief'},
            {'id': 'live_notes','label': 'Live Notes',
             'description': 'Capture decisions and action items during meeting'},
            {'id': 'followup',  'label': 'Follow-up',
             'description': 'Draft follow-up email from meeting notes'},
        ],
        'color': '#9B59B6', 'icon': '\U0001f4c5',
        'description': 'Prepares meeting briefs and captures live notes.',
        'stats': {'meetings_prepped': 0, 'follow_ups_drafted': 0},
    },
    'text-agent': {
        'functions': [
            {'id': 'triage_gate', 'label': 'Triage Gate',
             'description': 'Decide if text needs a reply (two-step gate)'},
            {'id': 'formality',   'label': 'Formality',
             'description': 'Classify tone: casual / semi-formal / formal'},
            {'id': 'draft',       'label': 'Draft',
             'description': 'Write reply matched to sender\'s tone'},
        ],
        'color': '#2ECC71', 'icon': '\U0001f4ac',
        'description': 'Drafts text message replies. Learns tone per contact.',
        'stats': {'texts_triaged': 0, 'drafts_produced': 0},
    },
    'decision-memo-agent': {
        'functions': [
            {'id': 'strategic',    'label': 'Strategic Memo',
             'description': 'Structured analysis for high-stakes strategic choices'},
            {'id': 'tactical',     'label': 'Tactical Memo',
             'description': 'Rapid decision write-up for operational choices'},
            {'id': 'interpersonal','label': 'Interpersonal Memo',
             'description': 'Framing for people / relationship decisions'},
        ],
        'color': '#E67E22', 'icon': '\U0001f4cb',
        'description': 'Produces decision memos. Three memo types.',
        'stats': {'memos_produced': 0},
    },
}

GENERIC_FUNCTIONS = [
    {'id': 'classify', 'label': 'Classify',  'description': 'Classify incoming input'},
    {'id': 'produce',  'label': 'Produce',   'description': 'Generate output'},
    {'id': 'learn',    'label': 'Learn',     'description': 'Absorb feedback'},
]


def _display_name(universe_id):
    return universe_id.replace('_', ' ').replace('us ', 'US ').title()


def _sector_from_id(universe_id):
    mapping = {
        'us_semiconductors':     'Semiconductors',
        'us_large_cap_tech':     'Technology',
        'us_financials':         'Financials',
        'us_biotech':            'Biotech',
        'us_energy':             'Energy',
        'us_consumer':           'Consumer',
        'us_industrials':        'Industrials',
        'us_real_estate':        'Real Estate',
        'us_utilities':          'Utilities',
        'us_healthcare_services':'Healthcare',
        'us_communication':      'Communication',
        'us_aerospace_defense':  'Aerospace & Defense',
        'us_materials':          'Materials',
        'us_transportation':     'Transportation',
        'us_etfs':               'ETFs',
        'global_large_cap_crypto':'Crypto',
    }
    return mapping.get(universe_id, universe_id.replace('_', ' ').title())


def _migrate(conn):
    try:
        conn.execute('ALTER TABLE predictions ADD COLUMN prediction_type TEXT DEFAULT "forward_test"')
        conn.commit()
    except Exception:
        pass


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load agents.json ────────────────────────────────────────────────────
    agents_json = json.loads((REPO_ROOT / 'agents.json').read_text(encoding='utf-8'))
    agents_list = agents_json.get('agents', [])

    # ── DB queries ──────────────────────────────────────────────────────────
    conn = get_connection()
    _migrate(conn)

    # All tickers with 1w data
    ticker_rows = conn.execute("""
        SELECT ticker,
               COUNT(*) as n_windows,
               ROUND(SUM(correct)*1.0/COUNT(*), 4) as da,
               SUM(correct) as xp
        FROM backtest_windows
        WHERE horizon_type='1w' AND predicted_direction != 'neutral'
        GROUP BY ticker
        ORDER BY da DESC
    """).fetchall()

    total_bw = conn.execute(
        "SELECT COUNT(*) FROM backtest_windows"
    ).fetchone()[0]

    unique_tickers = conn.execute(
        "SELECT COUNT(DISTINCT ticker) FROM backtest_windows WHERE horizon_type='1w'"
    ).fetchone()[0]

    candidates = [r for r in ticker_rows if r['da'] > 0.55 and r['n_windows'] >= 5]

    mean_da_1w = (
        sum(r['da'] for r in ticker_rows if r['da'] is not None) / len(ticker_rows)
        if ticker_rows else 0.0
    )

    # Last forward-test prediction
    last_pred = conn.execute("""
        SELECT created_at FROM predictions
        WHERE prediction_type='forward_test'
        ORDER BY created_at DESC LIMIT 1
    """).fetchone()
    last_forward_test = last_pred['created_at'] if last_pred else None

    # Forward-test active tickers (have a recent prediction)
    ft_active_rows = conn.execute("""
        SELECT DISTINCT ticker FROM predictions
        WHERE prediction_type='forward_test'
    """).fetchall()
    ft_active = {r['ticker'] for r in ft_active_rows}

    # Last prediction per ticker
    last_pred_rows = conn.execute("""
        SELECT ticker, created_at, composite_score, confidence_bucket
        FROM predictions
        WHERE prediction_type='forward_test'
        GROUP BY ticker
        HAVING created_at = MAX(created_at)
    """).fetchall()
    last_pred_by_ticker = {r['ticker']: dict(r) for r in last_pred_rows}

    conn.close()

    # ── Load universe files ─────────────────────────────────────────────────
    universe_files = sorted(UNIVERSE_DIR.glob('*.json'))
    universe_meta = {}
    for fpath in universe_files:
        uid = fpath.stem
        d = json.loads(fpath.read_text(encoding='utf-8'))
        universe_meta[uid] = {
            'tickers': [t['ticker'] for t in d.get('tickers', [])],
            'sector':  d.get('sector', _sector_from_id(uid)),
        }

    # Build DA lookup from DB rows
    da_by_ticker = {r['ticker']: {'da': r['da'], 'n': r['n_windows'], 'xp': r['xp']}
                    for r in ticker_rows}

    # Universe DA summary
    universe_da = {}
    for uid, umeta in universe_meta.items():
        das = [da_by_ticker[t]['da'] for t in umeta['tickers'] if t in da_by_ticker and da_by_ticker[t]['da'] is not None]
        universe_da[uid] = round(sum(das) / len(das), 4) if das else 0.0

    # Best ticker per universe
    universe_best = {}
    for uid, umeta in universe_meta.items():
        best = None
        best_da = -1
        for t in umeta['tickers']:
            if t in da_by_ticker and (da_by_ticker[t]['da'] or 0) > best_da:
                best_da = da_by_ticker[t]['da']
                best = t
        universe_best[uid] = (best, best_da)

    # ── Tier logic ──────────────────────────────────────────────────────────
    def get_tier(ticker):
        info = da_by_ticker.get(ticker)
        if not info:
            return 'weak'
        if info['da'] >= 0.60 and info['n'] >= 10:
            return 'significant_edge'
        if info['da'] >= 0.55 and info['n'] >= 5:
            return 'candidate'
        return 'weak'

    # ── ticker universe lookup ───────────────────────────────────────────────
    ticker_universe = {}
    for uid, umeta in universe_meta.items():
        for t in umeta['tickers']:
            if t not in ticker_universe:
                ticker_universe[t] = uid

    # ════════════════════════════════════════════════════════
    # 1. Reactive agent JSON files
    # ════════════════════════════════════════════════════════
    for agent in agents_list:
        aid = agent['id']
        if agent.get('category') == 'analytical-research':
            continue  # handled separately

        cfg = AGENT_FUNCTIONS.get(aid, {})
        payload = {
            'id':           aid,
            'display_name': agent.get('display_name', aid),
            'type':         'reactive',
            'category':     agent.get('category', ''),
            'status':       agent.get('status', 'live'),
            'version':      agent.get('version', '1.0.0'),
            'description':  cfg.get('description', ''),
            'functions':    cfg.get('functions', GENERIC_FUNCTIONS),
            'stats':        cfg.get('stats', {}),
            'color':        cfg.get('color', '#888888'),
            'icon':         cfg.get('icon', '?'),
        }
        out = AGENTS_DIR / f'{aid}.json'
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f'OK  {out.relative_to(REPO_ROOT)} ({out.stat().st_size}b)')

    # ════════════════════════════════════════════════════════
    # 2. Financial agent JSON
    # ════════════════════════════════════════════════════════
    top5 = [
        {'ticker': r['ticker'], 'da': r['da'],
         'universe': ticker_universe.get(r['ticker'], '')}
        for r in ticker_rows[:5]
    ]
    fin_payload = {
        'id':           'financial-analysis-agent',
        'display_name': 'Financial Analysis Agent',
        'type':         'analytical',
        'category':     'analytical-research',
        'status':       'live',
        'version':      '1.0.0',
        'description':  f'Evaluates stocks, ETFs, crypto. {total_bw:,} backtest windows.',
        'color':        '#F39C12',
        'icon':         '\U0001f4c8',
        'stats': {
            'total_backtest_windows':  total_bw,
            'unique_tickers':          unique_tickers,
            'forward_test_candidates': len(candidates),
            'mean_da_1w':              round(mean_da_1w, 4),
            'proven_tier_count':       sum(1 for r in ticker_rows
                                           if (r['da'] or 0) >= 0.60 and r['n_windows'] >= 10),
        },
        'top_tickers': top5,
    }
    fin_out = AGENTS_DIR / 'financial-analysis-agent.json'
    fin_out.write_text(json.dumps(fin_payload, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'OK  {fin_out.relative_to(REPO_ROOT)} ({fin_out.stat().st_size}b)')

    # ════════════════════════════════════════════════════════
    # 3. universes.json
    # ════════════════════════════════════════════════════════
    universes_out = []
    for i, (uid, umeta) in enumerate(sorted(universe_meta.items())):
        best_t, best_da = universe_best.get(uid, (None, 0))
        universes_out.append({
            'id':           uid,
            'display_name': _display_name(uid),
            'sector':       umeta['sector'],
            'ticker_count': len(umeta['tickers']),
            'mean_da_1w':   universe_da.get(uid, 0.0),
            'best_ticker':  best_t or '',
            'best_da':      round(best_da, 4),
            'color':        UNIVERSE_COLORS[i % len(UNIVERSE_COLORS)],
        })
    uf = OUT_DIR / 'universes.json'
    uf.write_text(json.dumps(universes_out, indent=2), encoding='utf-8')
    print(f'OK  {uf.relative_to(REPO_ROOT)} ({uf.stat().st_size}b)')

    # ════════════════════════════════════════════════════════
    # 4. tickers.json
    # ════════════════════════════════════════════════════════
    tickers_out = []
    for r in ticker_rows:
        tk = r['ticker']
        lp = last_pred_by_ticker.get(tk)
        last_pred_obj = None
        if lp:
            cs = lp.get('composite_score') or 0
            direction = 'up' if cs > 0.55 else ('down' if cs < 0.45 else 'neutral')
            last_pred_obj = {
                'direction':  direction,
                'confidence': lp.get('confidence_bucket', ''),
                'composite':  cs,
                'created_at': lp.get('created_at', ''),
            }
        uid = ticker_universe.get(tk, '')
        tickers_out.append({
            'ticker':              tk,
            'universe_id':         uid,
            'sector':              _sector_from_id(uid),
            'da_1w':               r['da'],
            'n_windows_1w':        r['n_windows'],
            'tier':                get_tier(tk),
            'forward_test_active': tk in ft_active,
            'last_prediction':     last_pred_obj,
        })
    tf = OUT_DIR / 'tickers.json'
    tf.write_text(json.dumps(tickers_out, indent=2), encoding='utf-8')
    print(f'OK  {tf.relative_to(REPO_ROOT)} ({tf.stat().st_size}b)')

    # ════════════════════════════════════════════════════════
    # 5. planet_data.json
    # ════════════════════════════════════════════════════════
    sorted_universes = sorted(universe_meta.keys())
    n_univ = len(sorted_universes)
    ticker_counts = [len(universe_meta[u]['tickers']) for u in sorted_universes]
    max_count = max(ticker_counts) if ticker_counts else 1
    min_count = min(ticker_counts) if ticker_counts else 1

    orbit_radii = [150 + (380 - 150) * i / max(n_univ - 1, 1) for i in range(n_univ)]
    orbit_angles = [360 * i / n_univ for i in range(n_univ)]

    planet_data = []
    for i, uid in enumerate(sorted_universes):
        umeta = universe_meta[uid]
        tks = umeta['tickers']
        # xp = total correct 1w predictions for universe tickers
        xp = sum(da_by_ticker[t]['xp'] for t in tks if t in da_by_ticker)
        # tier counts
        tc = {'significant_edge': 0, 'candidate': 0, 'weak': 0}
        for t in tks:
            tc[get_tier(t)] += 1
        # size normalized 0.4-1.0
        raw = len(tks)
        size = 0.4 + 0.6 * (raw - min_count) / max(max_count - min_count, 1)
        planet_data.append({
            'id':              uid,
            'display_name':    _display_name(uid),
            'size':            round(size, 3),
            'color':           UNIVERSE_COLORS[i % len(UNIVERSE_COLORS)],
            'xp':              int(xp),
            'resource_yield':  round(universe_da.get(uid, 0) * 100, 2),
            'tier_counts':     tc,
            'orbit_radius':    round(orbit_radii[i], 1),
            'orbit_angle_deg': round(orbit_angles[i], 1),
            'tickers':         tks,
        })
    pd_f = OUT_DIR / 'planet_data.json'
    pd_f.write_text(json.dumps(planet_data, indent=2), encoding='utf-8')
    print(f'OK  {pd_f.relative_to(REPO_ROOT)} ({pd_f.stat().st_size}b)')

    # ════════════════════════════════════════════════════════
    # 6. meta.json
    # ════════════════════════════════════════════════════════
    meta = {
        'generated_at':          datetime.now(timezone.utc).isoformat(),
        'agent_count':           len(agents_list),
        'total_backtest_windows':total_bw,
        'hub_version':           '1.0.0',
        'last_forward_test':     last_forward_test,
    }
    mf = OUT_DIR / 'meta.json'
    mf.write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(f'OK  {mf.relative_to(REPO_ROOT)} ({mf.stat().st_size}b)')

    # ════════════════════════════════════════════════════════
    # 7. build_guide.json
    # ════════════════════════════════════════════════════════
    bg = {
        'id':               'build-guide',
        'display_name':     'Build Guide',
        'type':             'build_guide',
        'description':      'Operating manual for the agent ecosystem. Learns from every agent built.',
        'color':            '#FFFFFF',
        'icon':             '\U0001f4d6',
        'template_version': 'v3',
        'agents_built':     len(agents_list),
        'known_gaps':       4,
        'last_updated':     '2026-05-17',
        'branches':         ['Reactive Agents', 'Analytical Agents'],
    }
    bgf = OUT_DIR / 'build_guide.json'
    bgf.write_text(json.dumps(bg, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'OK  {bgf.relative_to(REPO_ROOT)} ({bgf.stat().st_size}b)')

    # ════════════════════════════════════════════════════════
    # Validate all JSON files
    # ════════════════════════════════════════════════════════
    import glob as _glob
    all_json = _glob.glob(str(OUT_DIR / '**' / '*.json'), recursive=True)
    print(f'\nValidating {len(all_json)} JSON files...')
    for f in sorted(all_json):
        try:
            json.load(open(f, encoding='utf-8'))
            print(f'  VALID: {Path(f).relative_to(REPO_ROOT)}')
        except Exception as e:
            print(f'  INVALID: {f}: {e}')

    print(f'\nDone. {len(all_json)} files written to hub-site/data/')


if __name__ == '__main__':
    main()
