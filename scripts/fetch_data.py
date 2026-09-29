#!/usr/bin/env python3
"""Stáhne surová data (bez API klíčů).
1) Archiv datasetů Jeffa Sackmanna (originální repozitáře JeffSackmann/tennis_atp|wta
   jsou od léta 2026 nedostupné -> používáme veřejný mirror Aneeshers/tennis-sackmann-archive).
2) TennisMyLife CSV (ATP, Challenger, ATP kvalifikace, WTA) pro doplnění období po
   posledním snapshotu Sackmanna (do aktuálního týdne).
"""
import os, subprocess, sys, json, time, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw')
os.makedirs(RAW, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (tennis-app rebuild)'}

def sh(cmd, **kw):
    print('+', ' '.join(cmd)); return subprocess.run(cmd, check=True, **kw)

def fetch_sackmann():
    dst = os.path.join(RAW, 'sackmann')
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    if os.path.isdir(os.path.join(dst, '.git')):
        try: sh(['git', '-C', dst, 'pull', '--ff-only', '-q'], env=env)
        except Exception as e: print('git pull failed (using cached copy):', e)
        return
    for url in ['https://github.com/Aneeshers/tennis-sackmann-archive.git']:
        try:
            sh(['git', 'clone', '--depth', '1', '-q', url, dst], env=env); return
        except Exception as e: print('clone failed', url, e)
    sys.exit('Nelze stáhnout Sackmann data')

def get(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
    with open(path, 'wb') as f: f.write(data)
    return len(data)

def fetch_tml(year):
    dst = os.path.join(RAW, 'tml'); os.makedirs(dst, exist_ok=True)
    base = 'https://stats.tennismylife.org/data/'
    files = [f'{year}.csv', f'{year}_challenger.csv', f'atp_quali/{year}_atp_quali.csv', f'{year}_wta.csv',
             'ongoing_tourneys.csv', 'challenger_ongoing_tourneys.csv', 'wta_ongoing_tourneys.csv']
    for f in files:
        try:
            n = get(base + f, os.path.join(dst, os.path.basename(f)))
            print('TML', f, n, 'B')
        except Exception as e:
            print('TML fail', f, e)
        time.sleep(0.5)

if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(__file__))
    import fs
    fs.fetch_range(os.path.join(RAW, 'flashscore'))
    fetch_sackmann()
    y = time.localtime().tm_year
    fetch_tml(y)
    with open(os.path.join(RAW, 'fetched.json'), 'w') as f:
        json.dump({'fetched_at': time.strftime('%Y-%m-%d %H:%M:%S %Z')}, f)
