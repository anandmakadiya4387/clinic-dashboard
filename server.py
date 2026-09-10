#!/usr/bin/env python3
"""Anand Homoeopathy Clinic — FastAPI sync server (v70)
- SQLite WAL mode
- REST API + WebSocket real-time push
- Role-aware Office / Reception
- Local backups (last 5) + optional nightly snapshot folder
Falls back to stdlib HTTP server if FastAPI/uvicorn are unavailable.
"""
from __future__ import annotations
import os, sys, time, json, socket, sqlite3, threading, webbrowser, hashlib, secrets
from datetime import datetime
from pathlib import Path

HOST = "0.0.0.0"
ROLE = sys.argv[1].lower() if len(sys.argv) > 1 and sys.argv[1].lower() in ("office", "reception") else "office"
if getattr(sys, "frozen", False):
    n = os.path.splitext(os.path.basename(sys.executable))[0].lower()
    if "reception" in n:
        ROLE = "reception"
    elif "office" in n:
        ROLE = "office"
PORT = 8787 if ROLE == "office" else 8789
BASE_DIR = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
os.chdir(BASE_DIR)
START_PAGE = "office.html" if ROLE == "office" else "reception.html"
DBFILE = os.path.join(BASE_DIR, "clinic-sync.sqlite3")
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
os.makedirs(BACKUP_DIR, exist_ok=True)
# --- SUPABASE STORAGE SYNC ---
try:
    from supabase import create_client
    _sb_url = os.environ.get("SUPABASE_URL")
    _sb_key = os.environ.get("SUPABASE_KEY")
    sb_client = create_client(_sb_url, _sb_key) if _sb_url and _sb_key else None
except Exception as e:
    sb_client = None
    print(f"Supabase init error: {e}")

def pull_db_from_supabase():
    """Startup par cloud se SQLite database restore karega"""
    if not sb_client:
        return
    try:
        res = sb_client.storage.from_("clinic-backups").download("clinic-sync.sqlite3")
        with open(DBFILE, "wb") as f:
            f.write(res)
        print(">>> Restored database from Supabase cloud!")
    except Exception as e:
        print(f">>> Supabase download note (may be first run): {e}")

def push_db_to_supabase():
    """Naya data aate hi cloud bucket par backup upload karega"""
    if not sb_client or not os.path.exists(DBFILE):
        return
    try:
        with open(DBFILE, "rb") as f:
            file_bytes = f.read()
        sb_client.storage.from_("clinic-backups").upload(
            file=file_bytes,
            path="clinic-sync.sqlite3",
            file_options={"upsert": "true"}
        )
        print(">>> Database backed up to Supabase cloud!")
    except Exception as e:
        print(f">>> Supabase sync error: {e}")

pull_db_from_supabase()
LOCK = threading.RLock()
PEERS: dict[str, float] = {}
DISCOVERY_PORT = 8788
WS_CLIENTS: set = set()
WS_LOCK = threading.Lock()
# Simple session tokens: token -> {role, exp}
SESSIONS: dict[str, dict] = {}
# Default PINs (change in Clinic / env)
DEFAULT_OFFICE_PIN = os.environ.get("ANAND_OFFICE_PIN", "1234")
DEFAULT_RECEPTION_PIN = os.environ.get("ANAND_RECEPTION_PIN", "5678")


def now() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def merge_lists(a, b, deleted):
    m = {}
    for x in a or []:
        if isinstance(x, dict) and x.get("id"):
            m[x["id"]] = x
    for x in b or []:
        if not isinstance(x, dict) or not x.get("id"):
            continue
        old = m.get(x["id"])
        if old is None or str(x.get("_updated", "")) > str(old.get("_updated", "")):
            m[x["id"]] = x
    return [x for x in m.values() if x.get("id") not in deleted]


def merge_state(local, incoming):
    out = dict(local or {})
    out.setdefault("patients", [])
    out.setdefault("payments", [])
    out.setdefault("medicines", [])
    out.setdefault("expenses", [])
    out.setdefault("settings", {})
    out.setdefault("clinic", {})
    out.setdefault("meta", {})
    deleted = set(out["meta"].get("deleted", []) or []) | set((incoming.get("meta") or {}).get("deleted", []) or [])
    for k in ("patients", "payments", "medicines", "expenses"):
        out[k] = merge_lists(out.get(k, []), incoming.get(k, []), deleted)
    for k in ("settings", "clinic"):
        iv = incoming.get(k) or {}
        lv = out.get(k) or {}
        if str(iv.get("_updated", "")) > str(lv.get("_updated", "")):
            out[k] = iv
    out["meta"] = {"deleted": sorted(deleted), "serverMergedAt": now()}
    if "schemaVersion" in (incoming or {}):
        out["schemaVersion"] = incoming.get("schemaVersion") or out.get("schemaVersion") or 30
    return out


def connect_db():
    c = sqlite3.connect(DBFILE, check_same_thread=False, timeout=30)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA busy_timeout=30000")
    return c


def db_init():
    with LOCK, connect_db() as c:
        c.execute(
            "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated TEXT NOT NULL)"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, changed_at TEXT, device_id TEXT, summary TEXT)"
        )
        row = c.execute("SELECT payload FROM state WHERE id=1").fetchone()
        if not row:
            empty = {
                "schemaVersion": 30,
                "patients": [],
                "payments": [],
                "medicines": [],
                "expenses": [],
                "settings": {},
                "clinic": {},
                "meta": {"deleted": []},
            }
            c.execute(
                "INSERT INTO state(id,payload,updated) VALUES(1,?,?)",
                (json.dumps(empty), now()),
            )
        c.commit()


def load_state():
    with LOCK, connect_db() as c:
        row = c.execute("SELECT payload FROM state WHERE id=1").fetchone()
        return json.loads(row[0]) if row else {}


def save_state(state, device="server"):
    payload = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    with LOCK, connect_db() as c:
        c.execute("UPDATE state SET payload=?,updated=? WHERE id=1", (payload, now()))
        c.execute(
            "INSERT INTO changes(changed_at,device_id,summary) VALUES(?,?,?)",
            (now(), device, "record-level merge"),
        )
        c.commit()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    path = os.path.join(BACKUP_DIR, f"clinic-auto-{stamp}.json")
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        files = sorted([x for x in os.listdir(BACKUP_DIR) if x.endswith(".json")])
        for old in files[:-5]:
            try:
                os.remove(os.path.join(BACKUP_DIR, old))
            except OSError:
                pass
    except OSError:
        pass
    # Optional cloud/local mirror folder from settings
    try:
        mirror = (state.get("settings") or {}).get("cloudBackupPath") or os.environ.get("ANAND_CLOUD_BACKUP_PATH")
        if mirror and os.path.isdir(mirror):
            dest = os.path.join(mirror, f"anand-clinic-mirror-{ROLE}-{datetime.now().strftime('%Y%m%d')}.json")
            with open(dest, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    broadcast_ws({"type": "data_changed", "role": ROLE, "time": now(), "device": device})


def backup_files():
    return sorted([x for x in os.listdir(BACKUP_DIR) if x.endswith(".json")], reverse=True)


def broadcast_ws(msg: dict):
    data = json.dumps(msg)
    dead = []
    with WS_LOCK:
        clients = list(WS_CLIENTS)
    for ws in clients:
        try:
            # Starlette WebSocket
            import asyncio

            loop = getattr(ws, "_loop", None)
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(ws.send_text(data), loop)
            else:
                asyncio.get_event_loop().create_task(ws.send_text(data))
        except Exception:
            dead.append(ws)
    if dead:
        with WS_LOCK:
            for ws in dead:
                WS_CLIENTS.discard(ws)


def issue_token(role: str) -> str:
    tok = secrets.token_urlsafe(24)
    SESSIONS[tok] = {"role": role, "exp": time.time() + 12 * 3600}
    return tok


def check_token(token: str | None, need_role: str | None = None) -> bool:
    if not token:
        return False
    s = SESSIONS.get(token)
    if not s or s["exp"] < time.time():
        return False
    if need_role and s["role"] != need_role:
        return False
    return True


def pin_for_role(role: str) -> str:
    st = load_state()
    settings = st.get("settings") or {}
    if role == "office":
        return str(settings.get("officePin") or DEFAULT_OFFICE_PIN)
    return str(settings.get("receptionPin") or DEFAULT_RECEPTION_PIN)


def local_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def discovery_loop():
    ident = f"ANAND_CLINIC|{ROLE}|{local_lan_ip()}|{PORT}"

    def listen():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            s.bind(("", DISCOVERY_PORT))
            s.settimeout(1)
            while True:
                try:
                    data, _addr = s.recvfrom(2048)
                    msg = data.decode("utf-8", "ignore")
                    if msg.startswith("ANAND_CLINIC|"):
                        parts = msg.split("|")
                        if len(parts) >= 4 and parts[2] != local_lan_ip():
                            PEERS[f"http://{parts[2]}:{parts[3]}"] = time.time()
                except socket.timeout:
                    pass
                except OSError:
                    break
        except OSError:
            pass

    def broadcast():
        while True:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                s.sendto(ident.encode(), ("<broadcast>", DISCOVERY_PORT))
                s.close()
            except OSError:
                pass
            cutoff = time.time() - 15
            for u, t in list(PEERS.items()):
                if t < cutoff:
                    PEERS.pop(u, None)
            time.sleep(3)

    threading.Thread(target=listen, daemon=True).start()
    threading.Thread(target=broadcast, daemon=True).start()


def peer_sync_loop():
    import urllib.request

    while True:
        time.sleep(3)
        state = load_state()
        for url in list(PEERS):
            try:
                req = urllib.request.Request(
                    url.rstrip("/") + "/api/replicate",
                    data=json.dumps(state, ensure_ascii=False).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=1.5) as r:
                    remote = json.loads(r.read().decode())
                merged = merge_state(state, remote)
                if json.dumps(merged, sort_keys=True, separators=(",", ":")) != json.dumps(
                    state, sort_keys=True, separators=(",", ":")
                ):
                    save_state(merged, "peer-merge")
                    state = merged
            except Exception:
                pass


def nightly_backup_loop():
    last_day = ""
    while True:
        try:
            day = datetime.now().strftime("%Y-%m-%d")
            hour = datetime.now().hour
            if hour == 22 and day != last_day:
                st = load_state()
                path = os.path.join(BACKUP_DIR, f"clinic-nightly-{day}.json")
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(st, f, ensure_ascii=False, indent=2)
                last_day = day
                # prune
                files = sorted([x for x in os.listdir(BACKUP_DIR) if x.endswith(".json")])
                for old in files[:-5]:
                    try:
                        os.remove(os.path.join(BACKUP_DIR, old))
                    except OSError:
                        pass
        except Exception:
            pass
        time.sleep(300)


# ---------- FastAPI app ----------
def create_fastapi_app():
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Header, HTTPException
    from fastapi.responses import FileResponse, JSONResponse
    from fastapi.staticfiles import StaticFiles
    from fastapi.middleware.cors import CORSMiddleware

    app = FastAPI(title="Anand Clinic Sync API", version="53")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def role_guard(request: Request, x_role: str | None, x_token: str | None, office_only=False):
        # Token optional for LAN ease; if provided must match
        if x_token and not check_token(x_token):
            raise HTTPException(401, "Invalid or expired session")
        if office_only and ROLE != "office":
            raise HTTPException(403, "Office role required on this server")
        return True

    @app.get("/api/health")
    def health():
        return {
            "ok": True,
            "role": ROLE,
            "time": now(),
            "serverDb": os.path.basename(DBFILE),
            "wal": True,
            "framework": "fastapi",
            "ws": "/ws",
        }

    @app.post("/api/auth/login")
    async def login(request: Request):
        body = await request.json()
        role = (body.get("role") or ROLE).lower()
        pin = str(body.get("pin") or "")
        if pin != pin_for_role(role):
            raise HTTPException(401, "Wrong PIN")
        tok = issue_token(role)
        return {"ok": True, "token": tok, "role": role}

    @app.get("/api/data")
    def get_data(x_token: str | None = Header(default=None)):
        return load_state()

    @app.post("/api/sync")
    async def sync(request: Request, x_token: str | None = Header(default=None)):
        body = await request.json()
        current = load_state()
        merged = merge_state(current, body)
        if json.dumps(merged, sort_keys=True, separators=(",", ":")) != json.dumps(
            current, sort_keys=True, separators=(",", ":")
        ):
            save_state(merged, body.get("deviceId", "unknown"))
        else:
            # still notify mild heartbeat
            broadcast_ws({"type": "sync_ok", "time": now()})
        return merged

    @app.post("/api/replicate")
    async def replicate(request: Request):
        body = await request.json()
        current = load_state()
        merged = merge_state(current, body)
        if json.dumps(merged, sort_keys=True, separators=(",", ":")) != json.dumps(
            current, sort_keys=True, separators=(",", ":")
        ):
            save_state(merged, body.get("deviceId", "peer"))
        return merged

    @app.get("/api/backups")
    def list_backups():
        return {"backups": backup_files()}

    @app.post("/api/backup")
    async def do_backup(request: Request):
        save_state(load_state(), "manual-backup")
        return {"ok": True, "backups": backup_files()}

    @app.post("/api/restore")
    async def restore(request: Request):
        body = await request.json()
        current = load_state()
        merged = merge_state(current, body)
        save_state(merged, "restore")
        return merged

    @app.get("/api/backup/{name}")
    def get_backup(name: str):
        if name not in backup_files():
            raise HTTPException(404, "backup not found")
        with open(os.path.join(BACKUP_DIR, name), encoding="utf-8") as f:
            return json.load(f)

    @app.get("/api/peers")
    def peers():
        return {"peers": sorted(PEERS)}

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket):
        await ws.accept()
        # attach loop for cross-thread send
        try:
            import asyncio

            ws._loop = asyncio.get_running_loop()  # type: ignore
        except Exception:
            pass
        with WS_LOCK:
            WS_CLIENTS.add(ws)
        try:
            await ws.send_text(json.dumps({"type": "hello", "role": ROLE, "time": now()}))
            while True:
                msg = await ws.receive_text()
                # ping/pong or client notify
                if msg == "ping":
                    await ws.send_text(json.dumps({"type": "pong", "time": now()}))
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            with WS_LOCK:
                WS_CLIENTS.discard(ws)

    # Static files last — NO CACHE so UI upgrades always load
    from starlette.responses import Response

    def _nocache_file(path: str):
        full = os.path.join(BASE_DIR, path.lstrip("/"))
        if not os.path.isfile(full):
            return JSONResponse({"error": "not found"}, status_code=404)
        resp = FileResponse(full)
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

    @app.get("/")
    def root():
        return _nocache_file(START_PAGE)

    @app.get("/office.html")
    def office_html():
        return _nocache_file("office.html")

    @app.get("/reception.html")
    def reception_html():
        return _nocache_file("reception.html")

    @app.get("/app.js")
    def app_js():
        return _nocache_file("app.js")

    @app.get("/style.css")
    def style_css():
        return _nocache_file("style.css")

    app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")
    return app


def main_fastapi():
    import uvicorn

    db_init()
    discovery_loop()
    threading.Thread(target=peer_sync_loop, daemon=True).start()
    threading.Thread(target=nightly_backup_loop, daemon=True).start()
    app = create_fastapi_app()
    print("=" * 60)
    print(" ANAND Homoeopathy Multi Speciality Clinic — v53 FastAPI")
    print(f" MODE: {ROLE.upper()}")
    print(f" LAN SERVER: http://0.0.0.0:{PORT}")
    print(f" DATABASE: {DBFILE} (WAL)")
    print(f" WebSocket: ws://127.0.0.1:{PORT}/ws")
    print(f" API docs: http://127.0.0.1:{PORT}/docs")
    print(" Keep this window open.")
    print("=" * 60)

    def open_local():
        time.sleep(0.9)
        try:
            webbrowser.open(f"http://127.0.0.1:{PORT}/{START_PAGE}?v=77&_={int(time.time())}")
        except Exception:
            pass

    threading.Thread(target=open_local, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


def main_legacy():
    """Stdlib fallback if FastAPI not installed."""
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    db_init()
    discovery_loop()
    threading.Thread(target=peer_sync_loop, daemon=True).start()
    threading.Thread(target=nightly_backup_loop, daemon=True).start()

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {
            **getattr(SimpleHTTPRequestHandler, "extensions_map", {}),
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }

        def log_message(self, fmt, *args):
            try:
                if str(args[1]).startswith(("4", "5")):
                    super().log_message(fmt, *args)
            except Exception:
                pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            super().end_headers()

        def _json(self, obj, status=200):
            raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

        def _read(self):
            n = int(self.headers.get("Content-Length", "0") or 0)
            return json.loads(self.rfile.read(n) or b"{}")

        def do_GET(self):
            p = self.path.split("?", 1)[0]
            if p == "/api/health":
                return self._json(
                    {
                        "ok": True,
                        "role": ROLE,
                        "time": now(),
                        "serverDb": os.path.basename(DBFILE),
                        "wal": True,
                        "framework": "stdlib",
                    }
                )
            if p == "/api/data":
                return self._json(load_state())
            if p == "/api/backups":
                return self._json({"backups": backup_files()})
            if p == "/api/peers":
                return self._json({"peers": sorted(PEERS)})
            if p.startswith("/api/backup/"):
                name = p.rsplit("/", 1)[-1]
                if name not in backup_files():
                    return self._json({"error": "backup not found"}, 404)
                with open(os.path.join(BACKUP_DIR, name), encoding="utf-8") as f:
                    return self._json(json.load(f))
            return super().do_GET()

        def do_POST(self):
            p = self.path.split("?", 1)[0]
            try:
                body = self._read()
            except Exception as e:
                return self._json({"error": str(e)}, 400)
            if p == "/api/sync":
                current = load_state()
                merged = merge_state(current, body)
                if json.dumps(merged, sort_keys=True, separators=(",", ":")) != json.dumps(
                    current, sort_keys=True, separators=(",", ":")
                ):
                    save_state(merged, body.get("deviceId", "unknown"))
                return self._json(merged)
            if p == "/api/backup":
                save_state(load_state(), "manual-backup")
                return self._json({"ok": True, "backups": backup_files()})
            if p == "/api/restore":
                current = load_state()
                merged = merge_state(current, body)
                save_state(merged, "restore")
                return self._json(merged)
            if p == "/api/replicate":
                current = load_state()
                merged = merge_state(current, body)
                if json.dumps(merged, sort_keys=True, separators=(",", ":")) != json.dumps(
                    current, sort_keys=True, separators=(",", ":")
                ):
                    save_state(merged, body.get("deviceId", "peer"))
                return self._json(merged)
            if p == "/api/auth/login":
                role = (body.get("role") or ROLE).lower()
                pin = str(body.get("pin") or "")
                if pin != pin_for_role(role):
                    return self._json({"error": "Wrong PIN"}, 401)
                return self._json({"ok": True, "token": issue_token(role), "role": role})
            return self._json({"error": "not found"}, 404)

    print("=" * 60)
    print(" ANAND Clinic v53 (stdlib fallback — install fastapi for full features)")
    print(f" MODE: {ROLE.upper()}  PORT: {PORT}")
    print("=" * 60)
    srv = ThreadingHTTPServer((HOST, PORT), Handler)

    def open_local():
        time.sleep(0.8)
        try:
            webbrowser.open(f"http://127.0.0.1:{PORT}/{START_PAGE}?v=77&_={int(time.time())}")
        except Exception:
            pass

    threading.Thread(target=open_local, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


def main():
    try:
        import fastapi  # noqa: F401
        import uvicorn  # noqa: F401

        main_fastapi()
    except ImportError:
        print("FastAPI/uvicorn not found — using built-in server. For full upgrade run:")
        print("  pip install fastapi uvicorn[standard] pywebview")
        main_legacy()


if __name__ == "__main__":
    main()
