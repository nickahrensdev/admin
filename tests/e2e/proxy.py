"""Test-only stand-in for the Supabase gateway in front of PostgREST.

  /rest/v1/*      → PostgREST (default http://127.0.0.1:3011)
  /auth/v1/user   → the user in the bearer token (not verified; tests only)
  /functions/v1/* → 503 (Edge Functions aren't run in browser tests)
"""
import base64, http.server, json, os, urllib.error, urllib.request

TARGET = os.environ.get('POSTGREST_URL', 'http://127.0.0.1:3011')
PORT = int(os.environ.get('PROXY_PORT', '3012'))
CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*',
        'Access-Control-Expose-Headers': '*'}


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, status, body, ctype='application/json', headers=None):
        self.send_response(status)
        for k, v in {**CORS, **(headers or {})}.items():
            self.send_header(k, v)
        self.send_header('Content-Type', ctype)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200, b'')

    def _go(self):
        path = self.path
        if path.startswith('/auth/v1/user'):
            try:
                token = self.headers.get('Authorization', '').split()[-1]
                claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))
                user = {'id': claims['sub'], 'email': claims.get('email'), 'aud': 'authenticated', 'role': 'authenticated',
                        'app_metadata': {}, 'user_metadata': {}, 'created_at': '2026-01-01T00:00:00Z'}
                return self._send(200, json.dumps(user).encode())
            except Exception:
                return self._send(401, b'{"msg":"invalid token"}')
        if path.startswith('/functions/v1/'):
            return self._send(503, b'{"error":"Edge Functions are not available in browser tests."}')
        if not path.startswith('/rest/v1'):
            return self._send(404, b'{}')
        path = path[len('/rest/v1'):] or '/'
        length = int(self.headers.get('Content-Length') or 0)
        data = self.rfile.read(length) if length else None
        req = urllib.request.Request(TARGET + path, data=data, method=self.command)
        for k, v in self.headers.items():
            if k.lower() == 'authorization' and v.count('.') != 2:
                continue  # the publishable key isn't a JWT; PostgREST treats no token as anon
            if k.lower() not in ('host', 'content-length', 'apikey'):
                req.add_header(k, v)
        try:
            res = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            res = e
        body = res.read()
        headers = {k: v for k, v in res.headers.items() if k.lower() not in ('transfer-encoding', 'connection', 'content-type')}
        self._send(res.status if hasattr(res, 'status') else res.code, body, res.headers.get('Content-Type', 'application/json'), headers)

    do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = _go

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
