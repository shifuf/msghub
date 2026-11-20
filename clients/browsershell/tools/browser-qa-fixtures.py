"""Loopback-only HTTP fixtures for Prism's browser runtime checks."""

import argparse
import html
import io
import math
import re
import struct
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs


def page(title, content):
    safe_title = html.escape(title)
    return f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{safe_title}</title>
<style>
  body {{ font: 1rem system-ui, sans-serif; margin: 1.25rem; }}
  main {{ max-width: 45rem; }}
  li {{ margin: .45rem 0; }}
  button {{ margin: .25rem 0; padding: .6rem; }}
  audio {{ display: block; margin: .5rem 0 1rem; max-width: 100%; }}
</style>
<main>
<h1>{safe_title}</h1>
{content}
<p><a href="/">Fixture index</a></p>
</main>
</html>""".encode("utf-8")


INDEX = page("Prism browser QA fixtures", """
<p>This page stays visible when a no-content navigation or download is canceled.</p>
<ul>
  <li><a href="/status/200">HTTP 200</a></li>
  <li><a href="/status/204">HTTP 204 (no content)</a></li>
  <li><a href="/status/404">HTTP 404 with a body</a></li>
  <li><a href="/status/503">HTTP 503 with a body</a></li>
  <li><a href="/broken-image">HTTP 200 with a broken image</a></li>
  <li><a href="/spa">Same document history</a></li>
  <li><a href="/forms">POST navigation</a></li>
  <li><a href="/attachment">Open HTTP attachment</a></li>
  <li><a href="/audio">Audio: direct and typed</a></li>
  <li><a href="/tabs">Two tabs at the same URL</a></li>
</ul>
""")

SPA = page("Same document history", """
<p id="location" aria-live="polite"></p>
<button id="push">Push state</button>
<button id="fragment">Add fragment</button>
<script>
const render = () => {
  document.getElementById('location').textContent = location.pathname + location.search + location.hash;
};
document.getElementById('push').onclick = () => {
  history.pushState({}, '', '/spa/pushed?step=2');
  render();
};
document.getElementById('fragment').onclick = () => { location.hash = 'fixture-fragment'; };
addEventListener('popstate', render);
addEventListener('hashchange', render);
render();
</script>
""")

FORMS = page("GET /forms (HTTP 200)", """
<form method="post" action="/forms">
  <button type="submit" name="fixture" value="same">POST to this URL</button>
</form>
<form method="post" action="/post-redirect">
  <button type="submit" name="fixture" value="redirect">POST through HTTP 307</button>
</form>
""")

AUDIO = page("Audio: direct and typed", """
<h2>Direct WAV</h2>
<audio controls preload="none" src="/media/track.wav?fixture=direct"></audio>
<h2>Extensionless URL with an explicit audio type</h2>
<audio controls preload="none">
  <source src="/media/stream" type="audio/wav">
</audio>
<img src="/icon.svg" alt="Ordinary image">
<script src="/ordinary.js" defer></script>
""")

TABS = page("Two tabs at the same URL", """
<p>Open this address in two tabs. Play a different cue in each.</p>
<button id="cue-a">Play cue A</button>
<button id="cue-b">Play cue B</button>
<p id="cue" aria-live="polite">No cue selected.</p>
<audio id="player" controls></audio>
<script>
const player = document.getElementById('player');
function playCue(cue) {
  document.getElementById('cue').textContent = 'Cue ' + cue.toUpperCase();
  player.src = '/media/cue-' + cue + '.wav';
  player.play().catch(() => {});
}
document.getElementById('cue-a').onclick = () => playCue('a');
document.getElementById('cue-b').onclick = () => playCue('b');
</script>
""")


def make_wav(frequency):
    sample_rate = 16_000
    frames = b"".join(
        struct.pack("<h", int(2600 * math.sin(2 * math.pi * frequency * i / sample_rate)))
        for i in range(3 * sample_rate)
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
        wav.writeframes(frames)
    return buf.getvalue()


WAVS = {
    "/media/track.wav": make_wav(440),
    "/media/stream": make_wav(523),
    "/media/cue-a.wav": make_wav(330),
    "/media/cue-b.wav": make_wav(660),
}


class FixtureHandler(BaseHTTPRequestHandler):
    def respond(self, status, body=b"", content_type=None, headers=()):
        try:
            self.send_response(status)
            self.send_header("Cache-Control", "no-store")
            if content_type:
                self.send_header("Content-Type", content_type)
            if status != 204:
                self.send_header("Content-Length", str(len(body)))
            for name, value in headers:
                self.send_header(name, value)
            self.end_headers()
            if self.command != "HEAD" and status != 204 and body:
                self.wfile.write(body)
        except ConnectionError:
            # A WebView may close the request when the tester navigates away.
            pass

    def respond_html(self, status, body):
        self.respond(status, body, "text/html; charset=utf-8")

    def respond_audio(self, data):
        size = len(data)
        headers = (("Accept-Ranges", "bytes"),)
        range_header = self.headers.get("Range", "") if self.command == "GET" else ""
        byte_range = re.fullmatch(r"bytes=(\d{0,10})-(\d{0,10})", range_header)
        if byte_range and any(byte_range.groups()):
            first, last = byte_range.groups()
            start = int(first) if first else max(0, size - int(last))
            end = min(size - 1, int(last)) if first and last else size - 1
            if start > end:
                self.respond(416, headers=headers + (("Content-Range", f"bytes */{size}"),))
            else:
                self.respond(206, data[start:end + 1], "audio/wav",
                             headers + (("Content-Range", f"bytes {start}-{end}/{size}"),))
            return
        self.respond(200, data, "audio/wav", headers)

    def do_GET(self):
        path = self.path.partition("?")[0]
        if path == "/":
            self.respond_html(200, INDEX)
        elif path == "/status/204":
            self.respond(204)
        elif path in ("/status/200", "/status/404", "/status/503"):
            status = int(path.rsplit("/", 1)[1])
            self.respond_html(status, page(f"HTTP {status}", f"<p>Visible HTTP {status} response body.</p>"))
        elif path == "/broken-image":
            self.respond_html(200, page("HTTP 200 with a broken image", """
<p>The image below returns HTTP 404. The main document remains HTTP 200.</p>
<img src="/missing.png" alt="Missing fixture image">
"""))
        elif path == "/missing.png":
            self.respond(404, b"Missing fixture image\n", "text/plain; charset=utf-8")
        elif path in ("/spa", "/spa/pushed"):
            self.respond_html(200, SPA)
        elif path == "/forms":
            self.respond_html(200, FORMS)
        elif path == "/post-503":
            self.respond(405, headers=(("Allow", "POST"),))
        elif path == "/attachment":
            self.respond(200, b"Prism QA fixture attachment\n", "application/octet-stream",
                         (("Content-Disposition", 'attachment; filename="prism-qa.txt"'),))
        elif path == "/audio":
            self.respond_html(200, AUDIO)
        elif path == "/tabs":
            self.respond_html(200, TABS)
        elif path in WAVS:
            self.respond_audio(WAVS[path])
        elif path == "/icon.svg":
            self.respond(200, b'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">'
                         b'<circle cx="12" cy="12" r="10" fill="steelblue"/></svg>', "image/svg+xml")
        elif path == "/ordinary.js":
            self.respond(200, b"document.documentElement.dataset.fixtureScriptLoaded = 'yes';\n", "text/javascript")
        else:
            self.respond_html(404, page("Unknown fixture path", "<p>Try a link from the index.</p>"))

    do_HEAD = do_GET

    def do_POST(self):
        path = self.path.partition("?")[0]
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.respond(400)
            return
        if not 0 <= length <= 4096:
            self.respond(413)
            return
        payload = self.rfile.read(length).decode("utf-8", errors="replace")
        if path == "/post-redirect":
            self.respond(307, headers=(("Location", "/post-503"),))
        elif path in ("/forms", "/post-503"):
            value = html.escape(parse_qs(payload).get("fixture", [""])[0])
            self.respond_html(503, page(f"HTTP 503: POST {path}", f"<p>Submitted fixture: {value}</p>"))
        else:
            self.respond(404)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18765, help="loopback HTTP port (default: 18765)")
    args = parser.parse_args()
    if not 0 <= args.port <= 65_535:
        parser.error("--port must be between 0 and 65535")
    with ThreadingHTTPServer(("127.0.0.1", args.port), FixtureHandler) as server:
        print(f"Prism QA fixture: http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
