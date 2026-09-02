#!/usr/bin/env python3
"""CryptoTA dev-server — порт 8092 (отдельно от cryptotracker:8088 и cryptoview)."""
import os, sys, socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(os.environ.get('PORT', '8092'))
    host = os.environ.get('BIND', '0.0.0.0')
    print('▶ CryptoTA — Технический анализ')
    print(f'  Local:   http://localhost:{port}/')
    print(f'  Network: http://{get_lan_ip()}:{port}/')
    server = ThreadingHTTPServer((host, port), NoCacheHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)