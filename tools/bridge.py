#!/usr/bin/env python3
"""
Respiro belt bridge: Arduino (USB serial) -> phone.

Reads lines such as "ADC:512" from the Arduino and forwards just the number to
  * a WebSocket server (for the WebXR app)         default ws://0.0.0.0:8765
  * optionally UDP packets (for the Unity app)     --udp PHONE_IP:5005

Needs:  pip install pyserial        (only for USB mode; the WebSocket server and Wi-Fi mode use the standard library)
Wi-Fi Arduino (UNO R4 WiFi sketch with /data):   python bridge.py --http 192.168.1.50
Test without hardware:  python bridge.py --fake
"""
import argparse, base64, hashlib, math, socket, struct, sys, threading, time

GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
clients, lock = [], threading.Lock()


def ws_frame(text: str) -> bytes:
    p = text.encode()
    n = len(p)
    head = b"\x81" + (bytes([n]) if n < 126 else b"\x7e" + struct.pack(">H", n))
    return head + p


def client_thread(conn, addr):
    try:
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = conn.recv(2048)
            if not chunk:
                return
            req += chunk
        key = None
        for line in req.split(b"\r\n"):
            if line.lower().startswith(b"sec-websocket-key:"):
                key = line.split(b":", 1)[1].strip()
        if not key:
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nRespiro bridge is running.\n")
            return
        acc = base64.b64encode(hashlib.sha1(key + GUID).digest())
        conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     b"Sec-WebSocket-Accept: " + acc + b"\r\n\r\n")
        with lock:
            clients.append(conn)
        print(f"[ws] phone connected from {addr[0]}")
        while conn.recv(1024):          # ignore anything the page sends; stop when it closes
            pass
    except OSError:
        pass
    finally:
        with lock:
            if conn in clients:
                clients.remove(conn)
        try:
            conn.close()
        except OSError:
            pass


def ws_server(port):
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", port))
    s.listen(5)
    while True:
        c, a = s.accept()
        threading.Thread(target=client_thread, args=(c, a), daemon=True).start()


def broadcast(value_text, udp):
    frame = ws_frame(value_text)
    with lock:
        for c in list(clients):
            try:
                c.sendall(frame)
            except OSError:
                clients.remove(c)
    if udp:
        sock, dest = udp
        try:
            sock.sendto((value_text + "\n").encode(), dest)
        except OSError:
            pass


def parse(line):
    import re
    m = re.search(r"[:=]\s*(-?\d+(?:\.\d+)?)", line) or re.search(r"-?\d+(?:\.\d+)?", line)
    return (m.group(1) if m.lastindex else m.group(0)) if m else None


def find_port():
    from serial.tools import list_ports
    ports = list(list_ports.comports())
    for p in ports:
        if any(k in (p.description + p.manufacturer if p.manufacturer else p.description).lower() for k in ("arduino", "ch340", "usb serial", "cp210", "ftdi")):
            return p.device
    return ports[0].device if ports else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", help="serial port, e.g. COM5 or /dev/ttyACM0 (auto-detected if omitted)")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--ws", type=int, default=8765, help="WebSocket port")
    ap.add_argument("--udp", help="also send UDP to PHONE_IP:PORT (for the Unity app), e.g. 192.168.1.50:5005")
    ap.add_argument("--http", metavar="ARDUINO_IP", help="poll http://ARDUINO_IP/data (Arduino Wi-Fi sketch) instead of USB serial")
    ap.add_argument("--fake", action="store_true", help="generate a breathing signal instead of reading serial")
    a = ap.parse_args()

    udp = None
    if a.udp:
        host, port = a.udp.rsplit(":", 1)
        udp = (socket.socket(socket.AF_INET, socket.SOCK_DGRAM), (host, int(port)))
    threading.Thread(target=ws_server, args=(a.ws,), daemon=True).start()
    print(f"[bridge] WebSocket on port {a.ws}" + (f", UDP to {a.udp}" if udp else ""))

    if a.fake:
        print("[bridge] FAKE mode: sending a 12 breaths/min test signal")
        t0 = time.time()
        while True:
            t = time.time() - t0
            v = 512 + 250 * math.sin(2 * math.pi * 0.2 * t) + 8 * math.sin(40 * t)
            broadcast(f"{v:.0f}", udp)
            time.sleep(0.02)

    if a.http:
        import json, urllib.request
        url = "http://" + a.http.strip().replace("http://", "").rstrip("/") + "/data"
        print(f"[bridge] polling {url} at 20 Hz")
        n, fails = 0, 0
        while True:
            t0 = time.time()
            try:
                with urllib.request.urlopen(url, timeout=1.5) as r:
                    v = json.loads(r.read().decode())["value"]
                broadcast(str(v), udp)
                n += 1; fails = 0
                if n % 100 == 1:
                    print(f"[bridge] value {v}   (phones connected: {len(clients)})")
            except Exception as e:
                fails += 1
                if fails in (1, 20):
                    print(f"[bridge] no reply from Arduino ({e}). Same Wi-Fi? Correct IP?")
            time.sleep(max(0.0, 0.05 - (time.time() - t0)))

    try:
        import serial
    except ImportError:
        sys.exit("Install pyserial first:  pip install pyserial")
    port = a.port or find_port()
    if not port:
        sys.exit("No serial port found. Plug in the Arduino, close the Arduino Serial Monitor, or pass --port COMx")
    print(f"[bridge] reading {port} at {a.baud} baud")
    n = 0
    with serial.Serial(port, a.baud, timeout=1) as ser:
        while True:
            line = ser.readline().decode(errors="ignore").strip()
            v = parse(line) if line else None
            if v is not None:
                broadcast(v, udp)
                n += 1
                if n % 250 == 1:
                    print(f"[bridge] {line}   (phones connected: {len(clients)})")


if __name__ == "__main__":
    main()
