#!/usr/bin/env python3
"""Validate published coverage, provenance, export consistency, and original hashes."""
import csv
import hashlib
import json
from pathlib import Path
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'site/dist'
ARCHIVE=ROOT/'Data/archive/2026-09-29'
d=json.loads((ROOT/'Data/dataset.json').read_text())
assert len(d['releases'])==32
assert len(d['artifacts'])==54
assert {r['lab'] for r in d['releases']}=={'OpenAI','Anthropic','Google'}
assert all(r['date'].startswith('2026-') and r['date']<=d['snapshot'] for r in d['releases'])
release_ids={r['id'] for r in d['releases']}
benchmark_ids={b['id'] for b in d['benchmarks']}
source_ids={a['id'] for a in d['artifacts']}
assert len(release_ids)==len(d['releases']) and len(benchmark_ids)==len(d['benchmarks'])
cells=set()
usage=defaultdict(set)
for f in d['findings']:
    assert f['releaseId'] in release_ids and f['benchmarkId'] in benchmark_ids and f['sourceId'] in source_ids
    assert f['tier'] in ['blog','card'] and f['location'] and f['sourceUrl'].startswith('https://')
    cell=(f['releaseId'],f['benchmarkId'],f['tier'])
    assert cell not in cells
    cells.add(cell); usage[f['benchmarkId']].add(f['releaseId'])
    assert not any(k in f for k in ['score','scores','value','values','rawEvidence','result','results'])
    for key in ['archiveUrl','textUrl','readerUrl']:
        if f.get(key): assert (PUBLIC/f[key].split('#')[0]).is_file(),f[key]
for b in d['benchmarks']:
    assert b['releaseCount']==len(usage[b['id']])
counts=[b['releaseCount'] for b in d['benchmarks']]
assert counts==sorted(counts,reverse=True)
with (ROOT/'Data/witchbench-2026.csv').open(newline='') as handle:
    reader=csv.DictReader(handle); rows=list(reader)
    assert not {'score','scores','value','results'} & set(reader.fieldnames)
assert len(rows)==len(d['releases'])*len(d['benchmarks'])
by_name={b['name']:b['id'] for b in d['benchmarks']}
for row in rows:
    for tier,key in [('blog','blog_highlight'),('card','card_evaluation')]:
        assert (row[key]=='true')==((row['release_id'],by_name[row['benchmark']],tier) in cells)
for a in json.loads((ARCHIVE/'manifest.json').read_text()):
    raw=ROOT/a['localPath']
    assert hashlib.sha256(raw.read_bytes()).hexdigest()==a['sha256']
    public=PUBLIC/f'archive/2026-09-29/raw/{raw.name}'
    assert hashlib.sha256(public.read_bytes()).hexdigest()==a['sha256']
    assert (ROOT/a['textPath']).read_bytes()==(PUBLIC/'archive/2026-09-29/text'/Path(a['textPath']).name).read_bytes()
for a in json.loads((ARCHIVE/'assets-manifest.json').read_text()):
    assert a['status']=='archived',a['sourceUrl']
    assert hashlib.sha256((ARCHIVE/'assets'/a['file']).read_bytes()).hexdigest()==a['sha256']
    assert (PUBLIC/'archive/2026-09-29/assets'/a['file']).is_file()
for name in ['dataset.json','witchbench-2026.csv']:
    assert (ROOT/'Data'/name).read_bytes()==(PUBLIC/'data'/name).read_bytes()
print(f"Validated {len(d['releases'])} releases, {len(d['benchmarks'])} benchmarks, {len(d['findings'])} findings, {len(rows)} CSV rows, and all source/media hashes.")
