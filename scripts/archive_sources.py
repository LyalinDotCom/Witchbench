#!/usr/bin/env python3
"""Archive every artifact listed in the research handoff. Never overwrite snapshots."""
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

from bs4 import BeautifulSoup
from curl_cffi import requests as browser_http
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'Data' / 'archive' / '2026-09-29'


def manifest_rows():
    rows = []
    for line in (ROOT / 'Data/source-manifest.md').read_text().splitlines():
        if not line.startswith('| `'):
            continue
        artifact_id, url, size, expected_hash, pages = [x.strip().strip('`') for x in line.strip('|').split('|')]
        rows.append(dict(id=artifact_id, sourceUrl=url, expectedBytes=int(size.replace(',', '')),
                         expectedSha256=expected_hash, expectedPages=int(pages) if pages else None,
                         kind='blog' if artifact_id.endswith('-blog') else 'card'))
    return rows


def html_blocks(data):
    soup = BeautifulSoup(data, 'html.parser')
    for element in soup(['script', 'style', 'noscript', 'template', 'nav', 'header', 'footer']):
        element.decompose()
    for element in soup.select('[aria-hidden="true"], [hidden]'):
        element.decompose()
    main = soup.find('main') or soup.find('article') or soup.body or soup
    blocks = []
    heading = ''
    for element in main.find_all(['h1','h2','h3','h4','h5','h6','p','li','figcaption','tr','div']):
        if element.find_parent(['p', 'li', 'figcaption', 'tr']):
            continue
        if element.name=='div' and (element.find(['div','p','li','table','h1','h2','h3','h4','h5','h6','figure','section']) or len(element.get_text(' ',strip=True))<60):
            continue
        if element.name == 'tr':
            text = ' | '.join(cell.get_text(' ', strip=True) for cell in element.find_all(['th','td']))
        else:
            text = element.get_text(' ', strip=True)
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            if element.name.startswith('h'):
                heading = text
            block = dict(index=len(blocks)+1, tag=element.name, text=text, heading=heading,
                         isFootnote=bool(element.find_parent(id=re.compile('citation|footnote', re.I))))
            if element.name=='tr':
                table = element.find_parent('table')
                block['cells'] = [c.get_text(' ',strip=True) for c in element.find_all(['th','td'])]
                block['tableHeaders'] = [[c.get_text(' ',strip=True) for c in tr.find_all(['th','td'])] for tr in table.find_all('tr')[:2]]
            blocks.append(block)
    return blocks


def archive_one(row):
    previous_record = {}
    record_path = ARCHIVE / 'records' / (row['id'] + '.json')
    if record_path.exists():
        record = json.loads(record_path.read_text())
        previous_record = record
        raw = ROOT / record['localPath']
        if raw.exists() and hashlib.sha256(raw.read_bytes()).hexdigest() == record['sha256'] and not ('--reextract-html' in sys.argv and raw.suffix=='.html'):
            return record
    temp = ARCHIVE / 'raw' / (row['id'] + '.download')
    record = dict(row)
    try:
        existing = next((p for p in [temp.with_suffix('.html'), temp.with_suffix('.pdf')] if p.exists()), None)
        if existing:
            meta = dict(url_effective=row['sourceUrl'], content_type='application/pdf' if existing.suffix=='.pdf' else 'text/html')
            data = existing.read_bytes()
        else:
            response = browser_http.get(row['sourceUrl'], impersonate='chrome', timeout=120)
            response.raise_for_status()
            data = response.content
            temp.write_bytes(data)
            meta = dict(url_effective=response.url, content_type=response.headers.get('Content-Type',''))
        if not data or len(data) < 1000:
            raise ValueError('Empty or unexpectedly short source')
        is_pdf = data.startswith(b'%PDF')
        extension = '.pdf' if is_pdf else '.html'
        raw = temp.with_suffix(extension)
        if raw.exists() and not existing:
            raise ValueError(f'Snapshot already exists without a valid record: {raw.name}')
        if not existing:
            temp.rename(raw)
        if is_pdf:
            reader = PdfReader(raw)
            pages = [{'page': i+1, 'text': page.extract_text(extraction_mode='layout')} for i, page in enumerate(reader.pages)]
            blocks = []
            text = '\n\n'.join(f'--- PDF page {p["page"]} ---\n{p["text"]}' for p in pages)
            extraction = dict(pages=pages, blocks=blocks)
            record['pages'] = len(pages)
        else:
            blocks = html_blocks(data)
            if len(blocks) < 3:
                raise ValueError('No readable article content extracted')
            text = '\n'.join(f'{block["index"]:04d} [{block["tag"]}] {block["text"]}' for block in blocks)
            extraction = dict(pages=[], blocks=blocks)
            record['pages'] = None
        if len(text) < 200:
            raise ValueError('No substantial extracted source text')
        text_path = ARCHIVE / 'text' / (row['id'] + '.txt')
        blocks_path = ARCHIVE / 'extracted' / (row['id'] + '.json')
        text_path.write_text(text)
        blocks_path.write_text(json.dumps(extraction, ensure_ascii=False, indent=2))
        record.update(status='archived', retrievedAt=previous_record.get('retrievedAt') or dt.datetime.now(dt.timezone.utc).isoformat(),
                      finalUrl=previous_record.get('finalUrl') or meta['url_effective'], contentType=meta['content_type'], bytes=len(data),
                      sha256=hashlib.sha256(data).hexdigest(), localPath=str(raw.relative_to(ROOT)),
                      textPath=str(text_path.relative_to(ROOT)), extractedPath=str(blocks_path.relative_to(ROOT)))
        record['matchesResearchHash'] = record['sha256'] == row['expectedSha256']
        record_path.write_text(json.dumps(record, indent=2))
        return record
    except Exception as error:
        record.update(status='failed', error=str(error))
        return record


def main():
    for name in ['raw', 'text', 'records', 'extracted']:
        (ARCHIVE / name).mkdir(parents=True, exist_ok=True)
    rows = manifest_rows()
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(archive_one, row): row for row in rows}
        for future in concurrent.futures.as_completed(futures):
            record = future.result()
            records.append(record)
            print(f'{len(records)}/{len(rows)} {record["status"]}: {record["id"]}' +
                  (f' ({record["error"]})' if record['status'] == 'failed' else ''), flush=True)
    records.sort(key=lambda r:r['id'])
    (ARCHIVE / 'manifest.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
    failures = [record for record in records if record['status'] != 'archived']
    changed = [record['id'] for record in records if record.get('matchesResearchHash') is False]
    print(json.dumps(dict(artifacts=len(records), failures=len(failures), changedSinceResearch=changed)))
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())
