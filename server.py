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
from starlette.requests import Request
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
    """Last-write-wins by _updated, but NEVER resurrect tombstoned ids."""
    deleted = set(deleted or [])
    m = {}
    for src in (a or [], b or []):
        for x in src:
            if not isinstance(x, dict):
                continue
            xid = x.get("id")
            if not xid:
                continue
            if xid in deleted or x.get("_deleted") is True:
                deleted.add(xid)
                m.pop(xid, None)
                continue
            old = m.get(xid)
            if old is None or str(x.get("_updated", "")) > str(old.get("_updated", "")):
                m[xid] = x
    return [x for x in m.values() if x.get("id") not in deleted and not x.get("_deleted")]


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
    for src in (out, incoming or {}):
        for k in ("patients", "payments", "medicines", "expenses"):
            for x in (src.get(k) or []):
                if isinstance(x, dict) and x.get("id") and x.get("_deleted") is True:
                    deleted.add(x["id"])
    for k in ("patients", "payments", "medicines", "expenses"):
        out[k] = merge_lists(out.get(k, []), (incoming or {}).get(k, []), deleted)
    for k in ("settings", "clinic"):
        iv = (incoming or {}).get(k) or {}
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
    try:
        state.setdefault("meta", {})["serverMergedAt"] = now()
    except Exception:
        pass
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
        time.sleep(15)  # was 3s — too aggressive, caused hang under load
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

# ===== STEP 1: Twocompo-style server-rendered Patients page =====
def _html_esc(s):
    return (
        str(s if s is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _case_no_key(p):
    raw = str((p or {}).get("caseNo") or (p or {}).get("linkedCaseNo") or "")
    digits = "".join(ch for ch in raw if ch.isdigit())
    try:
        return int(digits) if digits else 0
    except Exception:
        return 0


def _fmt_date_dmy(val):
    """Display as DD/MM/YYYY when possible."""
    s = str(val or "").strip()
    if not s:
        return "-"
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        # YYYY-MM-DD
        return s[8:10] + "/" + s[5:7] + "/" + s[0:4]
    return s




def _display_person_name(p):
    """Avoid 'rajan patel rajan patel' when title repeats name."""
    title = str((p or {}).get("title") or "").strip()
    name = str((p or {}).get("name") or "").strip()
    if not title:
        return name
    if not name:
        return title
    tl, nl = title.lower(), name.lower()
    if tl == nl or nl.startswith(tl + " ") or tl in nl:
        return name
    if nl in tl:
        return title
    return (title + " " + name).strip()


def _parse_date_key(val):
    """Sort key YYYYMMDD from common formats; higher = newer."""
    s = str(val or "").strip()
    if not s:
        return "00000000"
    # ISO YYYY-MM-DD or YYYY/MM/DD
    if len(s) >= 10 and s[4] in "-/" and s[7] in "-/":
        return s[0:4] + s[5:7] + s[8:10]
    # DD-MM-YYYY or DD/MM/YYYY
    if len(s) >= 10 and s[2] in "-/" and s[5] in "-/":
        return s[6:10] + s[3:5] + s[0:2]
    # YYYYMMDD
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) >= 8:
        return digits[:8]
    return "00000000"


def build_patient_page_html(view="new", page=1, page_size=25, q=""):
    """Server HTML for /patient — Twocompo model + Step 2 search."""
    try:
        page = max(1, int(page or 1))
    except Exception:
        page = 1
    view = (view or "new").lower()
    if view not in ("new", "followup", "renewal"):
        view = "new"
    q = str(q or "").strip()
    q_lower = q.lower()
    q_digits = "".join(ch for ch in q if ch.isdigit())

    st = load_state() or {}
    pts = [
        p
        for p in (st.get("patients") or [])
        if isinstance(p, dict) and p.get("id") and not p.get("_deleted")
    ]

    title = "New Cases"
    rows = []
    if view == "followup":
        title = "Follow-up Cases"
        rows = [p for p in pts if str(p.get("caseType") or "new") != "new" or p.get("linkedFromId")]
        rows.sort(key=lambda p: str(p.get("date") or ""), reverse=True)
    elif view == "renewal":
        title = "Renewal Cases"
        rows = [p for p in pts if float(p.get("renewal") or 0) > 0]
        rows.sort(key=lambda p: str(p.get("date") or ""), reverse=True)
    else:
        title = "New Cases"
        by_case = {}
        for p in pts:
            if str(p.get("caseType") or "new") != "new":
                continue
            key = _case_no_key(p) or str(p.get("caseNo") or p.get("id"))
            prev = by_case.get(key)
            if not prev or str(p.get("date") or "") < str(prev.get("date") or ""):
                by_case[key] = p
        rows = list(by_case.values())
        rows.sort(key=lambda p: _case_no_key(p), reverse=True)

    # Step 2: server-side search — flexible case no / mobile / name match
    def _digits(s):
        return "".join(ch for ch in str(s or "") if ch.isdigit())

    def _norm_case_digits(s):
        d = _digits(s).lstrip("0")
        return d if d else "0"

    def _patient_matches(p, q_lower, q_digits):
        name = str(p.get("name") or "").lower()
        title_p = str(p.get("title") or "").lower()
        mobile = str(p.get("mobile") or "")
        mobile_digits = _digits(mobile)
        case_no = str(p.get("caseNo") or "")
        case_no_l = case_no.lower()
        linked = str(p.get("linkedCaseNo") or "").lower()
        case_digits = _digits(case_no)
        linked_digits = _digits(linked)
        blob = f"{title_p} {name} {mobile} {case_no_l} {linked}"
        if q_lower and q_lower in blob:
            return True
        # case / mobile: exact digits, contains, or ignore leading zeros (0A000560 vs 560)
        if q_digits:
            qd = _norm_case_digits(q_digits)
            for cd in (case_digits, linked_digits, mobile_digits):
                if not cd:
                    continue
                if q_digits in cd or cd in q_digits:
                    return True
                if qd and qd == _norm_case_digits(cd):
                    return True
            # full string without separators e.g. 0a000560
            compact = "".join(ch for ch in case_no_l if ch.isalnum())
            q_compact = "".join(ch for ch in q_lower if ch.isalnum())
            if q_compact and q_compact in compact:
                return True
        return False

    if q_lower:
        # When searching by case/mobile/name: search FULL patient list first,
        # then keep current tab filter only if still useful; case-no hits always show.
        pool = pts  # all patients on server
        matched = [p for p in pool if _patient_matches(p, q_lower, q_digits)]
        if view == "new":
            # Prefer unique new registrations; if none, still show any matched visits
            by_case = {}
            for p in matched:
                if str(p.get("caseType") or "new") != "new":
                    continue
                key = _case_no_key(p) or str(p.get("caseNo") or p.get("id"))
                prev = by_case.get(key)
                if not prev or str(p.get("date") or "") < str(prev.get("date") or ""):
                    by_case[key] = p
            rows = list(by_case.values())
            if not rows:
                # fallback: show matched follow-ups / any so user is not stuck on "No records"
                rows = matched
            rows.sort(key=lambda p: _case_no_key(p), reverse=True)
        elif view == "followup":
            rows = [
                p for p in matched
                if str(p.get("caseType") or "new") != "new" or p.get("linkedFromId")
            ]
            if not rows:
                rows = matched
            rows.sort(key=lambda p: str(p.get("date") or ""), reverse=True)
        else:
            rows = [p for p in matched if float(p.get("renewal") or 0) > 0]
            if not rows:
                rows = matched
            rows.sort(key=lambda p: str(p.get("date") or ""), reverse=True)

    total = len(rows)
    total_pages = max(1, (total + page_size - 1) // page_size)
    if page > total_pages:
        page = total_pages
    start = (page - 1) * page_size
    slice_rows = rows[start : start + page_size]

    def row_html(p, i):
        case_no = _html_esc(p.get("caseNo") or "")
        date = _html_esc(_fmt_date_dmy(p.get("date")))
        ctype = _html_esc(str(p.get("caseType") or "new").upper())
        name = _html_esc(_display_person_name(p))
        age = _html_esc(p.get("age") or "-")
        mobile = _html_esc(p.get("mobile") or "-")
        pid = _html_esc(p.get("id") or "")
        view_href = f"/patient/view?id={pid}"
        return (
            f"<tr>"
            f"<td>{start + i + 1}</td>"
            f"<td><b>{case_no}</b></td>"
            f"<td>{date}</td>"
            f"<td>{ctype}</td>"
            f"<td>{name}</td>"
            f"<td>{age}</td>"
            f"<td>{mobile}</td>"
            f'<td><a class="viewBtn" href="{view_href}">View</a></td>'
            f"</tr>"
        )

    body_rows = "".join(row_html(p, i) for i, p in enumerate(slice_rows))
    if not body_rows:
        body_rows = '<tr><td colspan="8" style="text-align:center;color:#64748b">No records</td></tr>'

    q_param = ("&q=" + _html_esc(q).replace(" ", "+")) if q else ""
    # For href we need URL-encode lightly
    import urllib.parse
    q_qs = ("&q=" + urllib.parse.quote(q)) if q else ""

    def page_link(pnum, label=None, disabled=False):
        lab = label or str(pnum)
        if disabled:
            return f'<span class="pg disabled">{lab}</span>'
        return f'<a class="pg" href="/patient?view={view}&page={pnum}{q_qs}">{lab}</a>'

    pag = []
    pag.append(page_link(page - 1, "‹ Prev", disabled=(page <= 1)))
    for pnum in range(1, total_pages + 1):
        if total_pages > 9 and abs(pnum - page) > 2 and pnum not in (1, total_pages):
            if pnum == 2 or pnum == total_pages - 1:
                pag.append('<span class="pg ell">…</span>')
            continue
        if pnum == page:
            pag.append(f'<span class="pg active">{pnum}</span>')
        else:
            pag.append(page_link(pnum))
    pag.append(page_link(page + 1, "Next ›", disabled=(page >= total_pages)))
    pag_html = "".join(pag)

    def tab(v, label):
        cls = "tab active" if v == view else "tab"
        return f'<a class="{cls}" href="/patient?view={v}&page=1{q_qs}">{label}</a>'

    q_val = _html_esc(q)
    search_hint = f' · search “{_html_esc(q)}”' if q else ""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Patients — Anand Clinic</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin:0; font-family: Arial, system-ui, sans-serif; background:#f1f5f9; color:#0f172a; }}
    .top {{ background:#1e293b; color:#fff; padding:12px 16px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }}
    .top a {{ color:#e2e8f0; text-decoration:none; font-size:14px; }}
    .top a:hover {{ color:#fff; }}
    .brand {{ font-weight:bold; color:#38bdf8; margin-right:8px; }}
    .wrap {{ max-width:1100px; margin:16px auto; padding:0 12px; }}
    .card {{ background:#fff; border-radius:10px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,.08); }}
    h1 {{ margin:0 0 8px; font-size:22px; font-weight:600; }}
    .meta {{ color:#64748b; font-size:13px; margin-bottom:12px; }}
    .tabs {{ display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; }}
    .tab {{ padding:8px 12px; border-radius:8px; background:#e2e8f0; color:#0f172a; text-decoration:none; font-size:13px; }}
    .tab.active {{ background:#1d4ed8; color:#fff; }}
    .searchBar {{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; align-items:center; }}
    .searchBar input {{ flex:1; min-width:180px; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; }}
    .searchBar button, .searchBar a.btn {{ padding:10px 14px; border-radius:8px; border:none; background:#1d4ed8; color:#fff; font-size:14px; cursor:pointer; text-decoration:none; }}
    .searchBar a.btn.secondary {{ background:#64748b; }}
    table {{ width:100%; border-collapse:collapse; font-size:13px; }}
    th, td {{ border-bottom:1px solid #e2e8f0; padding:8px 6px; text-align:left; vertical-align:top; }}
    th {{ background:#f8fafc; font-weight:600; color:#334155; }}
    .pager {{ margin-top:14px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }}
    .pg {{ display:inline-block; padding:6px 10px; border-radius:6px; background:#e2e8f0; color:#0f172a; text-decoration:none; font-size:13px; }}
    .pg.active {{ background:#1d4ed8; color:#fff; }}
    .pg.disabled {{ opacity:.45; pointer-events:none; }}
    .pg.ell {{ background:transparent; }}
    .note {{ margin-top:12px; font-size:12px; color:#64748b; }}
    .viewBtn {{ display:inline-block; padding:4px 10px; border-radius:6px; background:#0f766e; color:#fff; text-decoration:none; font-size:12px; }}
    .viewBtn:hover {{ background:#0d9488; }}
  </style>
</head>
<body>
  <div class="top">
    <span class="brand">ANAND Clinic</span>
    <a href="/office.html">Dashboard (full app)</a>
    <a href="/patient?view=new">Patients (fast)</a>
    <a href="/reception.html">Reception</a>
  </div>
  <div class="wrap">
    <div class="card">
      <h1>{_html_esc(title)}</h1>
      <div class="meta">Server page · {_html_esc(total)} record(s) · page {page}/{total_pages}{search_hint} · Twocompo-style (no full app.js)</div>
      <form class="searchBar" method="get" action="/patient">
        <input type="hidden" name="view" value="{_html_esc(view)}"/>
        <input type="hidden" name="page" value="1"/>
        <input type="search" name="q" value="{q_val}" placeholder="Search name, mobile or case no…" autofocus/>
        <button type="submit">Search</button>
        <a class="btn secondary" href="/patient?view={_html_esc(view)}&page=1">Clear</a>
      </form>
      <div class="tabs">
        {tab("new", "New Cases")}
        {tab("followup", "Follow-up")}
        {tab("renewal", "Renewal")}
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Case No</th>
              <th>Date</th>
              <th>Type</th>
              <th>Patient</th>
              <th>Age</th>
              <th>Mobile</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {body_rows}
          </tbody>
        </table>
      </div>
      <div class="pager">{pag_html}</div>
      <p class="note">Step 2: search server pe filter hota hai (name / mobile / case no). Full app.js load nahi hota.</p>
    </div>
  </div>
</body>
</html>"""
    return html



def build_patient_view_html(patient_id: str):
    """Step 3: single patient + visit history — server HTML, no app.js."""
    import urllib.parse

    st = load_state() or {}
    pts = [p for p in (st.get("patients") or []) if isinstance(p, dict) and p.get("id") and not p.get("_deleted")]
    pays = [x for x in (st.get("payments") or []) if isinstance(x, dict) and not x.get("_deleted")]

    pid = str(patient_id or "").strip()
    root = next((p for p in pts if str(p.get("id")) == pid), None)
    if not root:
        return (
            "<!DOCTYPE html><html><body style='font-family:Arial;padding:24px'>"
            "<p>Patient not found on server.</p>"
            "<p><a href='/patient'>← Back to Patients</a></p>"
            "</body></html>"
        )

    # Same family / case: match permanent case number digits
    def case_digits(p):
        raw = str(p.get("caseNo") or p.get("linkedCaseNo") or "")
        d = "".join(ch for ch in raw if ch.isdigit()).lstrip("0")
        return d if d else "0"

    root_digits = case_digits(root)
    root_name = str(root.get("name") or "").strip().lower()
    root_mobile = "".join(ch for ch in str(root.get("mobile") or "") if ch.isdigit())

    visits = []
    for p in pts:
        same = str(p.get("id")) == pid
        if not same and root_digits and case_digits(p) == root_digits:
            same = True
        if not same and root_mobile and len(root_mobile) >= 8:
            pm = "".join(ch for ch in str(p.get("mobile") or "") if ch.isdigit())
            if pm == root_mobile and str(p.get("name") or "").strip().lower() == root_name:
                same = True
        if same:
            visits.append(p)

    # Latest visit first (handles DD-MM-YYYY and YYYY-MM-DD)
    visits.sort(key=lambda p: _parse_date_key(p.get("date")), reverse=True)

    def money(n):
        try:
            return f"₹{float(n or 0):,.0f}"
        except Exception:
            return "₹0"

    def visit_status(p):
        foc = p.get("foc") or str(p.get("paymentStatus") or "").lower() == "foc"
        if foc:
            return "FOC"
        cons = float(p.get("consultation") or 0)
        med = float(p.get("medicine") or 0)
        ren = float(p.get("renewal") or 0)
        pend = float(p.get("partialPending") or 0)
        total = cons + med + ren
        # payments linked
        paid = 0.0
        for x in pays:
            if str(x.get("patientId")) == str(p.get("id")):
                try:
                    paid += float(x.get("amount") or 0)
                except Exception:
                    pass
        if pend > 0:
            return f"Partial pending {money(pend)}"
        if total <= 0 and paid <= 0:
            return "—"
        if paid >= total - 0.01 or str(p.get("paymentStatus") or "").lower() in ("received", "paid", "complete"):
            return "Received"
        if str(p.get("status") or "").lower() in ("pending",):
            return "Pending"
        return "Pending" if total > 0 else "—"

    def type_label(p):
        ct = str(p.get("caseType") or "new").lower()
        if float(p.get("renewal") or 0) > 0:
            return "RENEWED"
        if ct == "new":
            return "NEW"
        return "FOLLOWUP"

    visit_rows = []
    for i, p in enumerate(visits):
        cons = float(p.get("consultation") or 0)
        med = float(p.get("medicine") or 0)
        ren = float(p.get("renewal") or 0)
        total = cons + med + ren
        visit_rows.append(
            "<tr>"
            f"<td>{i + 1}</td>"
            f"<td>{_html_esc(_fmt_date_dmy(p.get('date')))}</td>"
            f"<td>{_html_esc(type_label(p))}</td>"
            f"<td>{_html_esc(p.get('caseNo') or '')}</td>"
            f"<td>{money(cons)}</td>"
            f"<td>{money(med)}</td>"
            f"<td>{money(ren)}</td>"
            f"<td><b>{money(total)}</b></td>"
            f"<td>{_html_esc(visit_status(p))}</td>"
            "</tr>"
        )
    visits_html = "".join(visit_rows) or '<tr><td colspan="9" style="text-align:center;color:#64748b">No visits</td></tr>'

    display_name = _display_person_name(root)
    case_show = root.get("caseNo") or ""
    back_q = urllib.parse.quote(str(case_show))

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{_html_esc(display_name)} — Patient</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin:0; font-family: Arial, system-ui, sans-serif; background:#f1f5f9; color:#0f172a; }}
    .top {{ background:#1e293b; color:#fff; padding:12px 16px; display:flex; gap:12px; flex-wrap:wrap; align-items:center; }}
    .top a {{ color:#e2e8f0; text-decoration:none; font-size:14px; }}
    .brand {{ font-weight:bold; color:#38bdf8; }}
    .wrap {{ max-width:960px; margin:16px auto; padding:0 12px; }}
    .card {{ background:#fff; border-radius:10px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,.08); margin-bottom:14px; }}
    h1 {{ margin:0 0 6px; font-size:22px; }}
    .meta {{ color:#64748b; font-size:13px; margin-bottom:10px; }}
    .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; }}
    .field {{ background:#f8fafc; border-radius:8px; padding:10px; }}
    .field label {{ display:block; font-size:11px; color:#64748b; margin-bottom:4px; }}
    .field div {{ font-size:14px; font-weight:600; }}
    table {{ width:100%; border-collapse:collapse; font-size:13px; }}
    th, td {{ border-bottom:1px solid #e2e8f0; padding:8px 6px; text-align:left; }}
    th {{ background:#f8fafc; color:#334155; }}
    .note {{ font-size:12px; color:#64748b; margin-top:10px; }}
  </style>
</head>
<body>
  <div class="top">
    <span class="brand">ANAND Clinic</span>
    <a href="/patient?q={back_q}">← Patients (fast)</a>
    <a href="/office.html">Dashboard (full app)</a>
  </div>
  <div class="wrap">
    <div class="card">
      <h1>{_html_esc(display_name)}</h1>
      <div class="meta">Case {_html_esc(case_show)} · {_html_esc(len(visits))} visit(s) · server page (no full app.js)</div>
      <div class="grid">
        <div class="field"><label>Case No</label><div>{_html_esc(case_show)}</div></div>
        <div class="field"><label>Mobile</label><div>{_html_esc(root.get('mobile') or '-')}</div></div>
        <div class="field"><label>Age</label><div>{_html_esc(root.get('age') or '-')}</div></div>
        <div class="field"><label>Gender</label><div>{_html_esc(root.get('gender') or '-')}</div></div>
        <div class="field"><label>Address</label><div>{_html_esc(root.get('address') or '-')}</div></div>
        <div class="field"><label>Ref By</label><div>{_html_esc(root.get('refBy') or '-')}</div></div>
      </div>
    </div>
    <div class="card">
      <h1 style="font-size:18px">Visit history</h1>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Type</th>
              <th>Case No</th>
              <th>Consult</th>
              <th>Medicine</th>
              <th>Renewal</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visits_html}
          </tbody>
        </table>
      </div>
      <p class="note">Step 3: View = server HTML only. Edit / payment receive still full app (later steps).</p>
    </div>
  </div>
</body>
</html>"""
    return html



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

    @app.get("/api/meta")
    def get_meta():
        st = load_state()
        pts = st.get("patients") or []
        max_case = 0
        for p in pts:
            if not isinstance(p, dict):
                continue
            digits = "".join(ch for ch in str(p.get("caseNo") or "") if ch.isdigit())
            try:
                n = int(digits) if digits else 0
            except Exception:
                n = 0
            if n > max_case:
                max_case = n
        meta = st.get("meta") or {}
        return {
            "ok": True,
            "time": meta.get("serverMergedAt") or now(),
            "patients": len(pts),
            "payments": len(st.get("payments") or []),
            "medicines": len(st.get("medicines") or []),
            "expenses": len(st.get("expenses") or []),
            "maxCaseNo": max_case,
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
    async def sync(request: Request):
      try:
          body = await request.json()
      except Exception:
          body = {}
      current = load_state()
      merged = merge_state(current, body)
      if json.dumps(merged, sort_keys=True, separators=(",", ":")) != json.dumps(current, sort_keys=True, separators=(",", ":")):
          save_state(merged, body.get("deviceId", "unknown"))
      else:
          broadcast_ws({"type": "sync_ok", "time": now()})
      return merged

    @app.post("/api/replicate")
    async def replicate(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        current = load_state()
        merged = merge_state(current, body)
        if json.dumps(merged, sort_keys=True, separators=(",", ":")) != json.dumps(current, sort_keys=True, separators=(",", ":")):
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
        content = await request.body()
        body = json.loads(content.decode("utf-8"))
        current = load_state()
        merged = merge_state(current, body)
        save_state(merged, "restore")
        return {
            "ok": True,
            "count": len(merged.get("patients", []) or []),
            "payments": len(merged.get("payments", []) or []),
            "medicines": len(merged.get("medicines", []) or []),
            "expenses": len(merged.get("expenses", []) or []),
        }

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
        with WS_LOCK:
            WS_CLIENTS.add(ws)
        try:
            await ws.send_text(json.dumps({"type": "hello", "role": ROLE, "time": now()}))
            while True:
                msg = await ws.receive_text()
                if msg == "ping":
                    await ws.send_text("pong")
        except Exception:
            pass
        finally:
            with WS_LOCK:
                WS_CLIENTS.discard(ws)


    # STEP 1 — Twocompo-style Patients (server HTML, no full app.js)
    from fastapi.responses import HTMLResponse

    @app.get("/patient", response_class=HTMLResponse)
    def patient_server_page(view: str = "new", page: int = 1, q: str = ""):
        return HTMLResponse(
            content=build_patient_page_html(view=view, page=page, page_size=25, q=q),
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
            },
        )

    @app.get("/patients-fast", response_class=HTMLResponse)
    def patient_server_page_alias(view: str = "new", page: int = 1, q: str = ""):
        return patient_server_page(view=view, page=page, q=q)

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


    @app.get("/patient/view", response_class=HTMLResponse)
    def patient_view_page(id: str = ""):
        return HTMLResponse(
            content=build_patient_view_html(id),
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
            },
        )

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

    
    
    # Soft MPA HTML pages — each interface = separate URL (no SPA hang)
    @app.get("/patients.html")
    def mpa_patients():
        return _nocache_file("patients.html")
    @app.get("/payments.html")
    def mpa_payments():
        return _nocache_file("payments.html")
    @app.get("/history.html")
    def mpa_history():
        return _nocache_file("history.html")
    @app.get("/medicines.html")
    def mpa_medicines():
        return _nocache_file("medicines.html")
    @app.get("/clinic.html")
    def mpa_clinic():
        return _nocache_file("clinic.html")
    @app.get("/connection.html")
    def mpa_connection():
        return _nocache_file("connection.html")
    @app.get("/permissions.html")
    def mpa_permissions():
        return _nocache_file("permissions.html")
    @app.get("/bill.html")
    def mpa_bill():
        return _nocache_file("bill.html")
    @app.get("/yearly-growth.html")
    def mpa_yg():
        return _nocache_file("yearly-growth.html")
    @app.get("/reports.html")
    def mpa_reports():
        return _nocache_file("reports.html")
    @app.get("/backup.html")
    def mpa_backup():
        return _nocache_file("backup.html")
    @app.get("/r-history.html")
    def mpa_r_hist():
        return _nocache_file("r-history.html")
    @app.get("/r-payments.html")
    def mpa_r_pay():
        return _nocache_file("r-payments.html")
    @app.get("/r-medicines.html")
    def mpa_r_med():
        return _nocache_file("r-medicines.html")
    @app.get("/r-connection.html")
    def mpa_r_conn():
        return _nocache_file("r-connection.html")
    @app.get("/r-bill.html")
    def mpa_r_bill():
        return _nocache_file("r-bill.html")
    @app.get("/r-backup.html")
    def mpa_r_backup():
        return _nocache_file("r-backup.html")

    @app.get("/new-case.html")
    def mpa_new_case():
        return _nocache_file("new-case.html")
    @app.get("/old-case.html")
    def mpa_old_case():
        return _nocache_file("old-case.html")
    @app.get("/r-new-case.html")
    def mpa_r_new_case():
        return _nocache_file("r-new-case.html")
    @app.get("/r-old-case.html")
    def mpa_r_old_case():
        return _nocache_file("r-old-case.html")


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
            webbrowser.open(f"http://127.0.0.1:{PORT}/{START_PAGE}?v=pro1&_={int(time.time())}")
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
            webbrowser.open(f"http://127.0.0.1:{PORT}/{START_PAGE}?v=pro1&_={int(time.time())}")
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
