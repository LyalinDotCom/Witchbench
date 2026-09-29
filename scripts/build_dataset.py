#!/usr/bin/env python3
"""Build a score-free, evidence-linked static dataset from archived sources."""
from collections import defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import unicodedata
from urllib.parse import urljoin
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = '2026-09-29'
ARCHIVE = ROOT / 'Data/archive' / SNAPSHOT
PUBLIC = ROOT / 'site/dist'
REPOSITORY = 'https://github.com/LyalinDotCom/Witchbench'


def normal(text):
    text = unicodedata.normalize('NFKC', text).replace('’', "'").replace('‘', "'")
    text = re.sub(r'[‐‑‒–—−]', '-', text)
    return re.sub(r'\s+', ' ', text).strip().lower()


def identifier(text):
    return re.sub(r'[^a-z0-9]+', '-', normal(text)).strip('-')


def read_inventory(filename):
    artifacts = []
    current = None
    category = None
    for line in (ROOT / 'Data' / filename).read_text().splitlines():
        if line.startswith('### '):
            current = dict(id=line[4:].strip(), mentions=[])
            artifacts.append(current)
        elif current and line.startswith('- Source: '):
            current['url'] = line[len('- Source: '):].strip()
        elif current and line.startswith('**'):
            category = line.strip('*')
        elif current and category and line.startswith('- ') and re.search(r'\((?:line|PDF p\.)', line):
            name, location = line[2:].split(' (', 1)
            current['mentions'].append(dict(name=name, location=location.rstrip(')'), category=category))
    return artifacts


def read_releases(artifacts):
    by_url = {a['url']: a['id'] for a in artifacts}
    releases = []
    for line in (ROOT / 'Data/release-index.md').read_text().splitlines():
        if not re.match(r'\| 2026-', line):
            continue
        date, lab, name, blog, card = [x.strip() for x in line.strip('|').split('|')]
        blog_url = re.search(r'\((https?[^)]+)\)', blog).group(1)
        match = re.search(r'\((https?[^)]+)\)', card)
        card_url = match.group(1) if match else None
        note = re.sub(r'\[card\]\([^)]+\)', '', card).strip(' ()') or None
        releases.append(dict(id=f'{date}-{identifier(name)}', date=date, lab=lab, name=name,
                             blogArtifactId=by_url[blog_url], cardArtifactId=by_url.get(card_url),
                             cardNote=note, blogUrl=blog_url, cardUrl=card_url))
    return releases


CANONICAL = {
    'hle': "Humanity's Last Exam", "humanity's last exam": "Humanity's Last Exam",
    'bias benchmark for question answering': 'BBQ',
    'epoch capabilities index': 'ECI',
    'terminal-bench science 0.1': 'Terminal-Bench-Science 0.1',
    'terminal-bench science': 'Terminal-Bench-Science',
    'toolathlon-verified': 'Toolathlon Verified',
    'swe-bench pro': 'SWE-bench Pro', 'swe-bench verified': 'SWE-bench Verified',
    'swe-bench': 'SWE-bench',
    'terminal-bench': 'Terminal-Bench',
    'terminal-bench 2.0': 'Terminal-Bench 2.0',
    'terminal-bench 2.1': 'Terminal-Bench 2.1',
    'terminal-bench 4.0': 'Terminal-Bench 4.0',
    'gdpval-aa v2': 'GDPval-AA v2',
    'frontier-bench v0.1': 'FrontierBench v0.1',
    'frontiercode v1.1 (main)': 'FrontierCode 1.1 Main',
    'tau2-bench': 'τ2-bench',
    'indic language understanding benchmark': 'MILU',
}
EXTRA_NAMES = ['FrontierSWE v2','DRACO','Chartography','OfficeQA','AA-Briefcase','GMMLU',
               'MILU','LatchBio Bioinformatics','ProteinGym Hard','CursorBench 4.0',
               'CritPT-Corrected','Terminal-Bench Science 0.1','FrontierCode 1.1 Main',
               'FrontierCode v1.1 (Main)','GDPval-AA v2.1','OSWorld 2.1',
               'Rakuten-SWE-Bench','OfficeQA Pro']


def model_aliases(release):
    name = normal(release['name'])
    name = re.sub(r'\([^)]*\)', '', name).strip()
    aliases = set()
    if 'mythos preview' in name:
        aliases.add('mythos preview')
    # Shared releases are kept as one event. Never inherit unrelated parent-card results.
    for family, version in re.findall(r'(opus|sonnet|fable|mythos|gemini)\s+([\d.]+(?:\s+pro|\s+flash(?:-lite)?)?)', name):
        aliases.add(f'{family} {version}')
    for token in re.findall(r'gpt-[\d.]+(?:-[a-z]+|\s+[a-z]+)?', name):
        aliases.add(token.strip())
    if 'gpt-6 sol' in name:
        aliases.update(['gpt-6 sol','gpt-6 luna'])
    if 'gpt-5.4 mini' in name:
        aliases = {'gpt-5.4 mini','gpt-5.4 nano'}
    if 'gpt-5.6' in name:
        aliases.update(['gpt-5.6 sol','gpt-5.6 terra','gpt-5.6 luna'])
    if 'gemini' in name:
        aliases = {name.replace(' (limited)','')}
        aliases.add(name.removeprefix('gemini ').strip())
    return sorted(aliases, key=len, reverse=True)


NUMERICAL = re.compile(r'(?<![a-z\d])(?:\d+\.\d+\s*%?|\d+\s*%)(?![a-z])', re.I)
RESULT_WORDS = re.compile(r'achiev|scor(?:e|es|ed|ing)|outperform|surpass|state.of.the.art|lead|improv|perform|saturat|success|accuracy|pass.rate|solv|reach|regress|worse|best|better|lower|higher|evalua',re.I)
BLOG_WORDS = re.compile(r'achiev|outperform|surpass|state.of.the.art|lead|improv|perform|saturat|success|scor|solv|reach|regress|worse|best|better|lower|higher|new.high|excel|strong',re.I)


def names_in(text, patterns):
    value = normal(text)
    matches = []
    occupied = []
    for variant, name, pattern in patterns:
        if variant == 'mask' and not re.search(r'\bMASK\b',text):
            continue
        for match in pattern.finditer(value):
            start, end = match.span()
            if any(start >= a and end <= b for a,b in occupied):
                continue
            # A generic name is not an additional benchmark when immediately version-qualified.
            tail = value[end:end+25]
            if re.match(r'\s+(?:v?\d+\.\d+|verified|multilingual|multimodal|professional|diamond|extended|tier \d)',tail) and not re.search(r'\d|verified|multilingual|multimodal|professional|diamond|extended|tier',variant):
                continue
            occupied.append((start,end))
            matches.append(name)
    return set(matches)


def has_model(text, aliases):
    value = normal(text)
    return any(re.search(r'(?<![a-z0-9])'+re.escape(a)+r'(?![a-z0-9.]|\s+(?:cyber|flash-lite|mini|nano)\b)',value) for a in aliases)


def has_result_number(text, patterns, aliases):
    value=normal(text)
    for variant,name,pattern in patterns:
        value=pattern.sub(' benchmark ',value)
    for alias in aliases:
        value=value.replace(alias,' model ')
    value=re.sub(r'\b(?:gpt-|(?:claude\s+)?(?:opus|sonnet|fable|mythos|gemini)\s+)\d+(?:\.\d+)*(?:-\w+|\s+(?:sol|terra|luna|pro|flash(?:-lite)?|mini|nano))?', ' model ',value)
    return bool(NUMERICAL.search(value))


def html_evidence(release, extraction, patterns, kind, releases):
    aliases = model_aliases(release)
    blocks = extraction['blocks']
    records = []
    minimum = 1
    maximum = 10**9
    if kind=='card' and release['cardArtifactId']=='openai-gpt-5-4-card' and 'mini' in release['name']:
        minimum = next((b['index'] for b in blocks if 'This section was added on March 17' in b['text']),10**9)
    if kind=='card' and release['cardArtifactId']=='openai-gpt-6-astra-card' and 'Sol' in release['name']:
        minimum = next((b['index'] for b in blocks if b['index']>100 and 'treating GPT-6 Sol and GPT-6 Luna' in b['text']),10**9)
    if kind=='card' and release['cardArtifactId']=='openai-gpt-6-astra-card' and 'Astra' in release['name']:
        maximum = next((b['index'] for b in blocks if b['index']>100 and 'treating GPT-6 Sol and GPT-6 Luna' in b['text']),10**9)
    if kind=='card' and release['cardArtifactId']=='openai-gpt-5-4-card' and 'mini' not in release['name']:
        maximum = next((b['index'] for b in blocks if 'This section was added on March 17' in b['text']),10**9)
    for pos, block in enumerate(blocks):
        if block['index'] < minimum or block['index'] >= maximum:
            continue
        text = block['text']
        names = names_in(text,patterns)
        if not names:
            continue
        eligible = False
        reason = 'Named mention only; no qualifying evidence at this location.'
        if kind=='blog':
            # In multi-model announcements, pronouns inherit the nearest model section.
            # Explicit sibling-model discussion must never count for the other variant.
            heading = block.get('heading','')
            siblings = [r for r in releases if r['blogArtifactId']==release['blogArtifactId'] and r['id']!=release['id']]
            shared = bool(siblings)
            target_context = has_model(text, aliases) or has_model(heading, aliases)
            if shared and not has_model(text,aliases) and any(has_model(text,model_aliases(r)) for r in siblings):
                target_context = False
            if not shared:
                target_context = target_context or bool(re.search(r'\b(we|our|the model|this model)\b',text,re.I))
            eligible = (block['tag'] in ['p','li','div'] and not block.get('isFootnote') and
                        normal(block.get('heading','')) not in ['footnotes','notes','evaluation methodology'] and
                        bool(BLOG_WORDS.search(text)) and
                        target_context)
            # Footnote-style setup notes do not imply excitement about performance.
            if re.match(r'^\s*[^:]{0,80}:\s*(The standard error|We (?:use|used|run|ran)|Results (?:are|were))',text,re.I):
                eligible=False
            reason = 'Launch prose describes the model’s performance or a meaningful limitation.' if eligible else reason
        elif block['tag']=='tr':
            cells = block.get('cells',[])
            for header in block.get('tableHeaders',[]):
                indices = [i for i,cell in enumerate(header) if has_model(cell,aliases)]
                if any(i<len(cells) and re.search(r'\d',cells[i]) for i in indices):
                    eligible=True
            reason = 'A numerical evaluation row includes the released model’s own column.' if eligible else reason
        elif block['tag'] in ['p','li','div'] and has_result_number(text,patterns,aliases) and RESULT_WORDS.search(text) and has_model(text, aliases):
            eligible=True
            reason='Card prose reports a numerical evaluation for the released model.'
        for name in names:
            records.append(dict(name=name,verified=bool(eligible),location=f'HTML block {block["index"]} ({block["tag"]})',
                                rawEvidence=text,reason=reason,mentionType='table' if block['tag']=='tr' else 'caption' if block['tag']=='figcaption' else 'narrative'))
    return records


def image_evidence(release, artifact, patterns, media, ocr):
    """A card chart qualifies only when it has the target model and a numerical scale."""
    aliases=model_aliases(release)
    soup=BeautifulSoup((ROOT/artifact['localPath']).read_bytes(),'html.parser')
    main=soup.find('main') or soup.find('article') or soup
    evidence=[]
    image_indices={id(img):i for i,img in enumerate(main.find_all('img'),1)}
    for index,panel in enumerate(main.select('[data-data]'),1):
        if artifact['id']=='openai-gpt-6-astra-card':
            preceding=image_indices.get(id(panel.find_previous('img')),0)
            if ('Sol' in release['name'] and preceding<56) or ('Astra' in release['name'] and preceding>=56):
                continue
        try:
            datasets=json.loads(panel['data-data']).get('datasets',[])
        except ValueError:
            continue
        for dataset in datasets:
            own=any(has_model(model,aliases) and isinstance(score.get('value'),(int,float)) for model,score in dataset.get('modelScores',{}).items())
            if not own:
                continue
            for name in names_in(dataset.get('name','')+' '+dataset.get('chartTitle',''),patterns):
                evidence.append(dict(name=name,verified=True,location=f'HTML embedded table {index}',rawEvidence=json.dumps(dataset),
                                     reason='Embedded source table includes a numerical value in the target model’s own column.',mentionType='table',table=index))
    for index,img in enumerate(main.find_all('img'),1):
        if artifact['id']=='openai-gpt-6-astra-card':
            if ('Sol' in release['name'] and index<57) or ('Astra' in release['name'] and index>=57):
                continue
        image_url=urljoin(artifact['sourceUrl'],img.get('src') or img.get('data-src') or '')
        record=media.get(image_url,{})
        if record.get('status')!='archived':
            continue
        text='\n'.join(ocr.get(record['file'],[]))
        if not has_model(text,aliases) or not NUMERICAL.search(text):
            continue
        heading=img.find_previous(lambda e:e.name in ['h1','h2','h3','h4','h5','h6'] and not e.get_text(' ',strip=True).startswith('Figure '))
        context=(heading.get_text(' ',strip=True) if heading else '')+'\n'+img.get('alt','')+'\n'+text
        names=names_in(context,patterns)
        for name in names:
            evidence.append(dict(name=name,verified=True,location=f'HTML figure {index} (chart)',
                                 rawEvidence=context,reason='Archived chart text identifies the benchmark, target model and numerical evaluation scale.',
                                 mentionType='chart',figure=index,imageFile=record['file']))
    return evidence


def pdf_evidence(release, extraction, patterns):
    aliases=model_aliases(release)
    records=[]
    pages=extraction['pages']
    for page in pages:
        lines=page['text'].splitlines()
        toc=sum(bool(re.search(r'\s{4,}\d{1,3}\s*$',line)) for line in lines)
        if toc > max(5,len([x for x in lines if x.strip()])*0.3):
            continue
        page_names=names_in(page['text'],patterns)
        if not page_names:
            continue
        for i,line in enumerate(lines):
            names=names_in(line,patterns)
            if not names:
                continue
            # Keep the nearest paragraph/table neighborhood, excluding unrelated scores elsewhere on a page.
            start=max(0,i-3)
            end=min(len(lines),i+7)
            neighborhood='\n'.join(lines[start:end])
            table_line=bool(re.search(r'\s{3,}\d',line) and NUMERICAL.search(line))
            own_model=has_model(page['text'],aliases) or (page['page']>1 and has_model(pages[page['page']-2]['text'],aliases))
            narrative=bool(has_result_number(neighborhood,patterns,aliases) and RESULT_WORDS.search(neighborhood) and has_model(neighborhood,aliases))
            eligible=own_model and (table_line or narrative)
            for name in names:
                records.append(dict(name=name,verified=eligible,location=f'PDF p. {page["page"]}',
                                    rawEvidence=neighborhood,reason='The card reports a numerical evaluation for its released model.' if eligible else 'Named card mention; no qualifying numerical result in this context.',mentionType='card'))
    return records


def main():
    inventories=read_inventory('blog-posts.md')+read_inventory('model-cards.md')
    releases=read_releases(inventories)
    manifest=json.loads((ARCHIVE/'manifest.json').read_text())
    if len(manifest)!=54 or any(a['status']!='archived' for a in manifest):
        raise SystemExit('Cannot build: the complete 54-source archive is required.')
    archive_by_id={a['id']:a for a in manifest}
    media={r['sourceUrl']:r for r in json.loads((ARCHIVE/'assets-manifest.json').read_text())}
    ocr=json.loads((ARCHIVE/'image-text.json').read_text())
    variants={m['name'] for a in inventories for m in a['mentions']}|set(EXTRA_NAMES)
    canonical_by_normal={}
    for name in sorted(variants,key=lambda n:(n!=n.title(),n)):
        canonical_by_normal.setdefault(normal(name),CANONICAL.get(normal(name),name))
    patterns=[]
    for name in variants:
        canonical=CANONICAL.get(normal(name),canonical_by_normal[normal(name)])
        value=normal(name)
        pattern=re.compile(r'(?<![a-z0-9-])'+re.escape(value)+r'(?![a-z0-9-])')
        patterns.append((value,canonical,pattern))
    patterns.sort(key=lambda p:len(p[0]),reverse=True)
    extraction_by_id={a['id']:json.loads((ROOT/a['extractedPath']).read_text()) for a in manifest}
    all_evidence=[]
    findings=[]
    known_benchmarks={}
    for release in releases:
        for kind in ['blog','card']:
            source_id=release[kind+'ArtifactId']
            if not source_id:
                continue
            artifact=archive_by_id[source_id]
            extraction=extraction_by_id[source_id]
            evidence=pdf_evidence(release,extraction,patterns) if extraction['pages'] else html_evidence(release,extraction,patterns,kind,releases)
            if kind=='card' and not extraction['pages']:
                evidence += image_evidence(release,artifact,patterns,media,ocr)
            grouped=defaultdict(list)
            for e in evidence:
                grouped[e['name']].append(e)
            for name,items in grouped.items():
                verified=[e for e in items if e['verified']]
                all_evidence.append(dict(releaseId=release['id'],sourceId=source_id,kind=kind,benchmark=name,
                                         verified=bool(verified),candidates=items))
                if not verified:
                    continue
                # One finding per release/benchmark/tier. Retain several locators for review.
                e=min(verified,key=lambda e:len(e['rawEvidence']))
                benchmark_id=identifier(name)
                known_benchmarks[benchmark_id]=dict(id=benchmark_id,name=name)
                raw_name=Path(artifact['localPath']).name
                archive_url=f'archive/{SNAPSHOT}/raw/{raw_name}'
                if artifact['pages']:
                    archive_url+='#page='+e['location'].split()[-1]
                summary=(f'{name} is highlighted in launch-post discussion of this model.' if kind=='blog' else
                         f'{name} is used for a numerical evaluation of this model in its card.')
                finding=dict(id=identifier(release['id']+' '+benchmark_id+' '+kind),releaseId=release['id'],
                             benchmarkId=benchmark_id,tier=kind,status='verified',sourceId=source_id,
                             sourceUrl=artifact['sourceUrl'],archiveUrl=archive_url,
                             textUrl=f'archive/{SNAPSHOT}/text/{source_id}.txt',location=e['location'],
                             locations=sorted(set(x['location'] for x in verified)),excerpt=summary,mentionType=e['mentionType'])
                findings.append(finding)
                if not artifact['pages']:
                    anchor=f'#figure-{e["figure"]}' if e.get('figure') else f'#table-{e["table"]}' if e.get('table') else ''
                    finding['readerUrl']=f'archive/{SNAPSHOT}/pages/{source_id}.html'+anchor
    uses=defaultdict(set)
    for f in findings:
        uses[f['benchmarkId']].add(f['releaseId'])
    benchmarks=sorted(known_benchmarks.values(),key=lambda b:(-len(uses[b['id']]),normal(b['name'])))
    for b in benchmarks:
        b['releaseCount']=len(uses[b['id']])
    artifacts=[]
    for a in manifest:
        artifacts.append(dict(id=a['id'],kind=a['kind'],sourceUrl=a['sourceUrl'],finalUrl=a['finalUrl'],
                              archiveUrl=f'archive/{SNAPSHOT}/raw/{Path(a["localPath"]).name}',
                              textUrl=f'archive/{SNAPSHOT}/text/{a["id"]}.txt',sha256=a['sha256'],
                              retrievedAt=a['retrievedAt'],status=a['status'],pages=a['pages'],bytes=a['bytes'],
                              matchesResearchHash=a['matchesResearchHash']))
        if not a['pages']:
            artifacts[-1]['readerUrl']=f'archive/{SNAPSHOT}/pages/{a["id"]}.html'
    dataset=dict(title='Witchbench',year=2026,snapshot=SNAPSHOT,repositoryUrl=REPOSITORY,
                 releases=releases,benchmarks=benchmarks,findings=findings,artifacts=artifacts,
                 methodology=dict(blog='A benchmark receives a blog check only when launch prose discusses the model’s performance or limitations. Tables, image captions, setup notes and bare names do not qualify.',
                                  card='A card check requires numerical evaluation evidence for the released model. Table-of-contents entries, citations and results for other models do not qualify. Shared-card addenda are scoped to their own release.',
                                  ordering='Rows rank by the number of distinct release events with either qualifying tier. Version labels are preserved. A blank means no qualifying finding in this snapshot, not that a lab never ran the benchmark.',
                                  review='Deterministic source rules identify evidence candidates; classifications are open to correction. Raw sources and exact locations support review.'))
    (ROOT/'Data/classification-review.json').write_text(json.dumps(all_evidence,ensure_ascii=False,indent=2))
    (ROOT/'Data/dataset.json').write_text(json.dumps(dataset,ensure_ascii=False,indent=2))
    (PUBLIC/'data').mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/'Data/dataset.json',PUBLIC/'data/dataset.json')
    # The export contains coverage booleans and provenance, never model benchmark scores.
    output=io.StringIO(newline='')
    columns=['year','snapshot','release_id','release_date','lab','model_release','benchmark','blog_highlight','card_evaluation','card_status','blog_source','card_source','blog_location','card_location']
    writer=csv.DictWriter(output,fieldnames=columns)
    writer.writeheader()
    cells=defaultdict(dict)
    for f in findings:
        cells[(f['releaseId'],f['benchmarkId'])][f['tier']]=f
    for release in releases:
        for b in benchmarks:
            cell=cells[(release['id'],b['id'])]
            blog=cell.get('blog',{})
            card=cell.get('card',{})
            writer.writerow(dict(year=2026,snapshot=SNAPSHOT,release_id=release['id'],release_date=release['date'],lab=release['lab'],model_release=release['name'],benchmark=b['name'],
                                 blog_highlight=str(bool(blog)).lower(),card_evaluation=str(bool(card)).lower(),card_status='available' if release['cardArtifactId'] else 'no_dedicated_card_located',
                                 blog_source=release['blogUrl'],card_source=release['cardUrl'] or '',blog_location=blog.get('location',''),card_location=card.get('location','')))
    (ROOT/'Data/witchbench-2026.csv').write_text(output.getvalue())
    shutil.copy2(ROOT/'Data/witchbench-2026.csv',PUBLIC/'data/witchbench-2026.csv')
    for folder in ['raw','text']:
        destination=PUBLIC/'archive'/SNAPSHOT/folder
        destination.mkdir(parents=True,exist_ok=True)
        for a in manifest:
            source=ROOT/a['localPath' if folder=='raw' else 'textPath']
            target=destination/source.name
            if folder=='text' or not target.exists() or target.stat().st_size!=source.stat().st_size:
                shutil.copy2(source,target)
    shutil.copy2(ARCHIVE/'manifest.json',PUBLIC/'archive'/SNAPSHOT/'manifest.json')
    print(json.dumps(dict(releases=len(releases),benchmarks=len(benchmarks),findings=len(findings),blogChecks=sum(f['tier']=='blog' for f in findings),cardChecks=sum(f['tier']=='card' for f in findings),archivedSources=len(artifacts))))


if __name__=='__main__':
    main()
