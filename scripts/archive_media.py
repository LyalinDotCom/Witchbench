#!/usr/bin/env python3
"""Capture article images and produce inert, offline-readable HTML snapshots."""
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from curl_cffi import requests

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'Data/archive/2026-09-29'
PUBLIC = ROOT / 'site/dist/archive/2026-09-29'
STYLE = 'body{font:16px/1.65 system-ui,sans-serif;color:#25292d;max-width:1000px;margin:40px auto;padding:0 24px}img,svg,video{max-width:100%;height:auto}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ddd;padding:8px}a{color:#6f431f}aside{font-size:13px;padding:16px;background:#f4f4f3;margin-bottom:32px}h1,h2,h3{line-height:1.25}figure{margin:24px 0}'


def capture(url):
    digest = hashlib.sha256(url.encode()).hexdigest()[:24]
    existing = list((ARCHIVE/'assets').glob(digest+'.*'))
    if existing:
        path = existing[0]
        meta = json.loads((ARCHIVE/'asset-records'/(digest+'.json')).read_text())
        return url, meta
    try:
        response = requests.get(url, impersonate='chrome', timeout=45)
        response.raise_for_status()
        data = response.content
        content_type = response.headers.get('Content-Type','').split(';')[0]
        if data.startswith(b'RIFF') and data[8:12]==b'WEBP':
            content_type='image/webp'
        elif data.startswith(b'\x89PNG'):
            content_type='image/png'
        elif data.startswith(b'\xff\xd8\xff'):
            content_type='image/jpeg'
        if not content_type.startswith('image/'):
            raise ValueError('Not an image response')
        ext = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg','image/avif':'.avif'}.get(content_type, '.img')
        path = ARCHIVE/'assets'/(digest+ext)
        path.write_bytes(data)
        meta = dict(sourceUrl=url,status='archived',file=path.name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),retrievedAt=dt.datetime.now(dt.timezone.utc).isoformat())
        (ARCHIVE/'asset-records'/(digest+'.json')).write_text(json.dumps(meta,indent=2))
        return url,meta
    except Exception as error:
        return url,dict(sourceUrl=url,status='failed',error=str(error))


def main():
    for name in ['assets','asset-records','pages']:
        (ARCHIVE/name).mkdir(parents=True,exist_ok=True)
    manifest = json.loads((ARCHIVE/'manifest.json').read_text())
    documents = {}
    urls = set()
    for a in manifest:
        if a['pages']:
            continue
        soup = BeautifulSoup((ROOT/a['localPath']).read_bytes(),'html.parser')
        main = soup.find('main') or soup.find('article') or soup.body
        documents[a['id']] = main
        for img in main.find_all('img'):
            src = img.get('src') or img.get('data-src')
            if src and not src.startswith('data:'):
                url = urljoin(a['sourceUrl'],src)
                if urlparse(url).scheme in ['https','http']:
                    urls.add(url)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        records = dict(pool.map(capture,sorted(urls)))
    (ARCHIVE/'assets-manifest.json').write_text(json.dumps(list(records.values()),indent=2))
    for a in manifest:
        if a['pages']:
            continue
        main = documents[a['id']]
        figure_number = 0
        for element in main.find_all(['script','style','noscript','template','iframe','form','nav','header','footer','video','audio','source']):
            element.decompose()
        for element in main.find_all(True):
            for key in list(element.attrs):
                if key.startswith('on') or key in ['style','srcset','class','id','loading']:
                    del element[key]
            if element.name=='img':
                figure_number += 1
                element['id']='figure-'+str(figure_number)
                url=urljoin(a['sourceUrl'],element.get('src') or element.get('data-src') or '')
                if records.get(url,{}).get('status')=='archived':
                    element['src']='../assets/'+records[url]['file']
                else:
                    element['src']=''
            if element.has_attr('href'):
                url=urljoin(a['sourceUrl'],element['href'])
                if urlparse(url).scheme in ['http','https']:
                    element['href']=url
                    element['rel']='noopener noreferrer'
                else:
                    del element['href']
        wrapper=BeautifulSoup('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title></title><style></style></head><body><aside></aside></body></html>','html.parser')
        wrapper.title.string=a['id']+' — archived source'
        wrapper.style.string=STYLE
        wrapper.aside.string='Archived source · captured '+a['retrievedAt']+' · original: '+a['sourceUrl']+' · layout simplified; original HTML preserved separately.'
        wrapper.body.append(main)
        (ARCHIVE/'pages'/(a['id']+'.html')).write_text(str(wrapper))
    for name in ['assets','pages']:
        shutil.copytree(ARCHIVE/name,PUBLIC/name,dirs_exist_ok=True)
    shutil.copy2(ARCHIVE/'assets-manifest.json',PUBLIC/'assets-manifest.json')
    print(json.dumps(dict(images=len(records),archived=sum(r['status']=='archived' for r in records.values()),failures=[r for r in records.values() if r['status']!='archived'],readablePages=len(documents))))


if __name__=='__main__':
    main()
