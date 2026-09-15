#!/usr/bin/env python3
# Offline and update test for the published app (audit A10, A11, A15 to A18).
#     python3 tools/test_offline_update.py
# Builds deploy-style copies of app/ into a scratch folder, serves them on the
# IPv6 loopback (a secure context that is not "localhost", so the app registers
# its service worker and uses IndexedDB, never the Mac server), and drives a
# throwaway headless Chrome profile. Nothing touches live data or the network.
import sys, os, re, shutil, tempfile, threading, time, json, http.server, socketserver, socket
from pathlib import Path
# The headless Chrome driver lives in the Fringe Planner's tools, beside this project.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'fringe-planner' / 'tools'))
import cdp

APP = str(Path(__file__).resolve().parents[1] / 'app')
ROOT = tempfile.mkdtemp(prefix='rehab-offline-')
SITE = os.path.join(ROOT, 'site')
PORT = 8791
results = []

def check(label, got, want):
    ok = got == want
    results.append((ok, label, got, want))
    print(('  ok   ' if ok else '  FAIL ') + label + ('' if ok else f'  got={got!r} want={want!r}'))

def stage(version, drop=None):
    if os.path.exists(SITE):
        shutil.rmtree(SITE)
    shutil.copytree(APP, SITE, ignore=shutil.ignore_patterns('dev-*', 'case.local.js'))
    sw = open(os.path.join(SITE, 'sw.js')).read()
    sw = re.sub(r"const SHELL_VERSION = '[^']*';", f"const SHELL_VERSION = '{version}';", sw)
    sw = sw.replace("  './index.html',\n", "  './index.html',\n  './desktop.html',\n")
    open(os.path.join(SITE, 'sw.js'), 'w').write(sw)
    os.rename(os.path.join(SITE, 'index.html'), os.path.join(SITE, 'desktop.html'))
    shutil.copy(os.path.join(SITE, 'm.html'), os.path.join(SITE, 'index.html'))
    if drop:
        os.remove(os.path.join(SITE, drop))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

class V6(socketserver.ThreadingTCPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = True
    daemon_threads = True

stage('gen1')
srv = V6(('::1', PORT), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://[::1]:{PORT}'

def js(c, code, t=0):
    return c.eval('(async () => {' + code + '})()')

ASK = """const ask=(w,kind)=>new Promise(r=>{const ch=new MessageChannel();const t=setTimeout(()=>r(null),3000);ch.port1.onmessage=e=>{clearTimeout(t);r(e.data)};w.postMessage({kind},[ch.port2]);});"""

try:
    with cdp.Chrome(tempfile.mkdtemp(prefix='rehab-offline-chrome-'), headless=True) as c:
        c.assert_is_ours()
        c.call('Network.enable')
        c.navigate(BASE + '/m.html', settle=4)
        # A cache that belongs to another app on the same origin.
        js(c, "await (await caches.open('fringe-shell-test')).put('/x', new Response('fringe')); return 1")
        ready = js(c, "for (let i=0;i<40 && !navigator.serviceWorker.controller;i++) await new Promise(r=>setTimeout(r,250)); return !!navigator.serviceWorker.controller")
        check('the worker takes control', ready, True)
        info = js(c, ASK + "return await ask(navigator.serviceWorker.controller,'version')")
        check('generation 1 installed complete', (info or {}).get('version'), 'gen1')
        check('with every file', (info or {}).get('complete'), True)
        keys = js(c, "return (await caches.keys()).sort()")
        check('cache names are this app\'s own', [k for k in keys if not k.startswith('fringe')], ['acl-rehab-shell-gen1'])

        # Phone storage guards (A15), on a page that does not run the app, so
        # nothing else writes while the checks run.
        c.navigate(BASE + '/manifest.webmanifest', settle=1.5)
        idb = js(c, """
          const m = await import('./js/sync/idb.js');
          const out = {};
          const a = await m.idbGetDoc();
          const two = { days: { '2026-09-01': { entries: [{ id: 'x' }] }, '2026-09-02': { entries: [{ id: 'y' }] } } };
          const r1 = await m.idbPutDoc(two, a.rev);
          try { await m.idbPutDoc(two, a.rev); out.stale = 'written'; } catch (e) { out.stale = e.constructor.name; out.staleHasDoc = !!e.doc; }
          try { await m.idbPutDoc({}, r1); out.empty = 'written'; } catch (e) { out.empty = e.constructor.name; }
          const one = { days: { '2026-09-01': { entries: [{ id: 'x' }] } } };
          await m.idbPutDoc(one, r1);
          const db = await new Promise((res, rej) => { const q = indexedDB.open('rehab'); q.onsuccess = () => res(q.result); q.onerror = rej; });
          const keys = await new Promise((res) => { const q = db.transaction('snapshots').objectStore('snapshots').getAllKeys(); q.onsuccess = () => res(q.result); });
          db.close();
          out.reduceSnap = keys.some((k) => String(k).startsWith('before-reduce-'));
          out.daySnap = keys.some((k) => String(k).startsWith('day-'));
          out.after = Object.keys((await m.idbGetDoc()).doc.days).length;
          return out;
        """)
        check('a write from a stale read is refused with the newer document', [idb.get('stale'), idb.get('staleHasDoc')], ['StaleWrite', True])
        check('an empty document never replaces records', idb.get('empty'), 'RefusedWrite')
        check('a save holding fewer records keeps a restore point', idb.get('reduceSnap'), True)
        check('the first save of the day keeps one too', idb.get('daySnap'), True)
        check('the store holds the latest good save', idb.get('after'), 1)

        # Offline cold start (A11 art included).
        c.call('Network.emulateNetworkConditions', offline=True, latency=0, downloadThroughput=-1, uploadThroughput=-1)
        c.navigate(BASE + '/m.html?cold=1', settle=3)
        check('offline: the app draws', js(c, "return !!document.querySelector('.mtop') && !!document.querySelector('#view').children.length"), True)
        check('offline: the dial art loads', js(c, "return (await fetch('./img/dial/dial-bezel-light.svg')).status"), 200)
        c.navigate(BASE + '/desktop.html', settle=3)
        check('offline: the desktop page is its own page', js(c, "return !!document.querySelector('.topbar, #tabs')"), True)
        c.call('Network.emulateNetworkConditions', offline=False, latency=0, downloadThroughput=-1, uploadThroughput=-1)

        # A broken deploy: one module missing (A10). The working generation stays.
        stage('gen2', drop='js/trend.js')
        c.navigate(BASE + '/m.html?try=2', settle=2)
        js(c, "const reg = await navigator.serviceWorker.getRegistration('./'); try { await reg.update(); } catch {} await new Promise(r=>setTimeout(r,4000)); return 1")
        info = js(c, ASK + "return await ask(navigator.serviceWorker.controller,'version')")
        check('a failed install leaves generation 1 in charge', (info or {}).get('version'), 'gen1')
        keys = js(c, "return (await caches.keys()).sort()")
        check('and its cache, with nothing half built', 'acl-rehab-shell-gen1' in keys and 'acl-rehab-shell-gen2' not in keys, True)
        c.call('Network.emulateNetworkConditions', offline=True, latency=0, downloadThroughput=-1, uploadThroughput=-1)
        c.navigate(BASE + '/m.html?cold=2', settle=3)
        check('offline still works after the failed deploy', js(c, "return !!document.querySelector('.mtop') && !!document.querySelector('#view').children.length"), True)
        c.call('Network.emulateNetworkConditions', offline=False, latency=0, downloadThroughput=-1, uploadThroughput=-1)

        # A good deploy through Force update (A16, A17): waits for a complete
        # generation, then reloads into it.
        stage('gen3')
        c.navigate(BASE + '/m.html#settings', settle=3)
        js(c, "document.querySelectorAll('details[data-setg]').forEach(d=>d.open=true); await new Promise(r=>setTimeout(r,300)); return 1")
        js(c, "document.querySelector('[data-app-refresh]').click(); return 1")
        deadline = time.time() + 60
        v = None
        while time.time() < deadline:
            time.sleep(2)
            try:
                v = js(c, ASK + "return navigator.serviceWorker.controller ? await ask(navigator.serviceWorker.controller,'version') : null")
            except Exception:
                v = None
            if v and v.get('version') == 'gen3':
                break
        check('Force update lands on the new generation', (v or {}).get('version'), 'gen3')
        check('complete', (v or {}).get('complete'), True)
        check('and the page reloaded into it', 'u=' in js(c, "return location.search"), True)
        keys = js(c, "return (await caches.keys()).sort()")
        check('the old generation is gone', [k for k in keys if 'shell' in k and not k.startswith('fringe')], ['acl-rehab-shell-gen3'])
        check('another app\'s cache on the origin is untouched (A18)', 'fringe-shell-test' in keys, True)
        probe = js(c, "return (await fetch('./sw.js?probe='+Date.now(), {cache:'no-store'}).then(r=>r.text())).match(/SHELL_VERSION = '([^']+)'/)[1]")
        check('the version probe reads the server, not a cache (A17)', probe, 'gen3')
finally:
    srv.shutdown()
    shutil.rmtree(ROOT, ignore_errors=True)

bad = [r for r in results if not r[0]]
print(f"\n{len(results) - len(bad)} of {len(results)} pass")
sys.exit(1 if bad else 0)
