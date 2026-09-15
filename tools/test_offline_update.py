#!/usr/bin/env python3
# Offline and update test for the published app (audit A10, A11, A15 to A18;
# Fable A4: A09, A19 and A12 reproduced).
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

        # Fable A4, 2026-09-15: A09 and A19 reproduced, not read from the code.
        # A save that fails on the phone is simulated by making IndexedDB's put
        # throw QuotaExceededError (storage full), the real failure iOS gives.
        FAIL_PUT = "window.__put ||= IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('simulated full storage', 'QuotaExceededError'); };"
        FIX_PUT = "if (window.__put) IDBObjectStore.prototype.put = window.__put;"

        # A09: Force update stops while the latest change is not saved.
        c.navigate(BASE + '/m.html#settings', settle=3)
        js(c, "document.querySelectorAll('details[data-setg]').forEach(d=>d.open=true); window.__mark = 1; await new Promise(r=>setTimeout(r,300)); return 1")
        stage('gen4')
        js(c, FAIL_PUT + " document.querySelector('[data-app-refresh]').click(); return 1")
        time.sleep(4)
        st = js(c, ASK + "return { mark: window.__mark || 0, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '), v: (await ask(navigator.serviceWorker.controller,'version'))?.version }")
        check('A09: an unsaved change stops Force update (no reload)', st.get('mark'), 1)
        check('A09: and says why', 'not saved' in (st.get('toast') or ''), True)
        check('A09: the running generation stays', st.get('v'), 'gen3')
        js(c, FIX_PUT + " document.querySelector('[data-app-refresh]').click(); return 1")
        deadline = time.time() + 60
        v = None
        while time.time() < deadline:
            time.sleep(2)
            try:
                v = js(c, ASK + "return window.__mark ? 'same page' : (navigator.serviceWorker.controller ? (await ask(navigator.serviceWorker.controller,'version'))?.version : null)")
            except Exception:
                v = None
            if v == 'gen4':
                break
        check('A09: once saved, Force update goes ahead', v, 'gen4')

        # A19: a deploy that lands mid-workout waits for the player to close,
        # then still waits for a save that has not landed.
        c.navigate(BASE + '/m.html#today', settle=3)
        opened = js(c, """
          const s = (ms) => new Promise(r => setTimeout(r, ms));
          window.__mark = 1;
          navigator.serviceWorker.addEventListener('controllerchange', () => { window.__cc = 1; });
          const b = document.querySelector('[data-act="start"]:not([disabled]), [data-act="resume"]');
          if (!b) return 'no start';
          b.click(); await s(1200);
          // Started and past the get ready, so leaving asks what to keep.
          document.querySelector('[data-p="pause"]')?.click(); await s(400);
          for (let i = 0; i < 3; i++) { document.querySelector('[data-p="skip"]:not([disabled])')?.click(); await s(400); }
          await s(1200);
          return document.querySelector('.player') ? 'open' : 'not open';
        """)
        check('A19 setup: the player is open', opened, 'open')
        stage('gen5')
        js(c, "const reg = await navigator.serviceWorker.getRegistration('./'); try { await reg.update(); } catch {} for (let i = 0; i < 40 && !window.__cc; i++) await new Promise(r => setTimeout(r, 250)); await new Promise(r => setTimeout(r, 1500)); return 1")
        st = js(c, "return { cc: window.__cc || 0, mark: window.__mark || 0, player: !!document.querySelector('.player') }")
        check('A19: the new generation took control', st.get('cc'), 1)
        check('A19: no reload while the player is open', [st.get('mark'), st.get('player')], [1, True])
        pending = js(c, FAIL_PUT + """
          const store = await import('./js/store.js');
          store.queueSave(); await new Promise(r => setTimeout(r, 1200));
          return store.saveOutstanding();
        """)
        check('A19 setup: a save is still owed', pending, True)
        asked = js(c, """
          const s = (ms) => new Promise(r => setTimeout(r, ms));
          document.querySelector('#nav-back, [data-p="close"]')?.click(); await s(600);
          const later = document.querySelector('[data-s="later"]');
          later?.click(); await s(600);
          return !!later;
        """)
        check('A19 setup: leaving asked, and Finish later was chosen', asked, True)
        time.sleep(3)
        st = js(c, "return { mark: window.__mark || 0, player: !!document.querySelector('.player') }")
        check('A19: player closed, reload still waits for the owed save', [st.get('mark'), st.get('player')], [1, False])
        js(c, FIX_PUT + " const store = await import('./js/store.js'); await store.flushSave(); return 1")
        deadline = time.time() + 15
        mark = 1
        while time.time() < deadline:
            time.sleep(1)
            try:
                mark = js(c, "return window.__mark || 0")
            except Exception:
                mark = 1
            if mark == 0:
                break
        check('A19: once saved, the page reloads into the new generation', mark, 0)
        v = js(c, ASK + "return (await ask(navigator.serviceWorker.controller,'version'))?.version")
        check('A19: on generation 5', v, 'gen5')
        draft = js(c, "return !!localStorage.getItem('rehab.player.v1')")
        check('A19: the workout left for later is still kept', draft, True)

    # A12: IndexedDB cannot be opened. A database of a newer version on the
    # origin makes the app's open fail with a real VersionError (nothing is
    # patched). The app must open read only and write nothing.
    with cdp.Chrome(tempfile.mkdtemp(prefix='rehab-offline-a12-'), headless=True) as c:
        c.assert_is_ours()
        c.navigate(BASE + '/manifest.webmanifest', settle=1.5)
        js(c, "await new Promise((res, rej) => { const r = indexedDB.open('rehab', 99); r.onupgradeneeded = () => r.result.createObjectStore('marker'); r.onsuccess = () => { r.result.close(); res(); }; r.onerror = () => rej(r.error); }); return 1")
        c.navigate(BASE + '/m.html#today', settle=4)
        st = js(c, """
          const store = await import('./js/store.js');
          const chip = document.getElementById('sync-btn');
          return { ro: store.state.readOnly, chip: chip ? (chip.textContent.trim() + ' ' + (chip.getAttribute('aria-label') || '')) : null };
        """)
        check('A12: a store that will not open is read only', st.get('ro'), True)
        check('A12: the header chip says Read only', 'Read only' in (st.get('chip') or ''), True)
        js(c, """
          const s = (ms) => new Promise(r => setTimeout(r, ms));
          const t = document.querySelector('input.tick');
          if (t) { t.click(); await s(1500); }
          const store = await import('./js/store.js');
          store.queueSave(); await s(1200);
          return 1;
        """)
        after = js(c, "return await new Promise((res) => { const r = indexedDB.open('rehab'); r.onsuccess = () => { const db = r.result; const out = { v: db.version, stores: [...db.objectStoreNames] }; db.close(); res(out); }; r.onerror = () => res({ err: String(r.error) }); })")
        check('A12: nothing was written (the database is as it was)', [after.get('v'), after.get('stores')], [99, ['marker']])
finally:
    srv.shutdown()
    shutil.rmtree(ROOT, ignore_errors=True)

bad = [r for r in results if not r[0]]
print(f"\n{len(results) - len(bad)} of {len(results)} pass")
sys.exit(1 if bad else 0)
