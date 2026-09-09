#!/usr/bin/env python3
"""Anand Clinic desktop shell (PyWebView) — Office or Reception.
Usage: python desktop_app.py office
       python desktop_app.py reception
Starts FastAPI/stdlib server in a thread, opens native window (no browser chrome).
"""
from __future__ import annotations
import os, sys, time, threading, subprocess

ROLE = sys.argv[1].lower() if len(sys.argv) > 1 and sys.argv[1].lower() in ("office", "reception") else "office"
PORT = 8787 if ROLE == "office" else 8789
BASE = os.path.dirname(os.path.abspath(__file__))
START = "office.html" if ROLE == "office" else "reception.html"
URL = f"http://127.0.0.1:{PORT}/{START}?v=77"


def start_server():
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    subprocess.Popen(
        [sys.executable, os.path.join(BASE, "server.py"), ROLE],
        cwd=BASE,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_ready(timeout=20):
    import urllib.request

    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


def main():
    start_server()
    if not wait_ready():
        print("Server failed to start. Check that port is free and dependencies are installed.")
        print("  pip install -r requirements.txt")
        sys.exit(1)
    try:
        import webview

        webview.create_window(
            f"Anand Clinic — {ROLE.title()}",
            URL,
            width=1280,
            height=840,
            min_size=(960, 600),
        )
        webview.start()
    except ImportError:
        print("pywebview not installed — opening system browser.")
        print("  pip install pywebview")
        import webbrowser

        webbrowser.open(URL)
        print("Server running. Press Ctrl+C to stop.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
