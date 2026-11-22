#!/usr/bin/env python3
import http.server
import socketserver
import os
import re

class RangeHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Simple HTTP request handler with byte range support for audio/video seeking."""

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, "File not found")
            return None

        fs = os.fstat(f.fileno())
        total_size = fs[6]

        range_header = self.headers.get('Range')
        if not range_header:
            self.send_response(200)
            self.send_header("Content-type", self.guess_type(path))
            self.send_header("Content-Length", str(total_size))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
            self.end_headers()
            return f

        match = re.match(r'^bytes=(\d*)-(\d*)$', range_header.strip())
        if not match:
            self.send_error(416, "Requested Range Not Satisfiable")
            f.close()
            return None

        start_str, end_str = match.groups()
        if start_str:
            start = int(start_str)
            end = int(end_str) if end_str else total_size - 1
        elif end_str:
            start = total_size - int(end_str)
            end = total_size - 1
        else:
            start = 0
            end = total_size - 1

        if start >= total_size or end >= total_size or start > end:
            self.send_error(416, "Requested Range Not Satisfiable")
            self.send_header("Content-Range", f"bytes */{total_size}")
            self.end_headers()
            f.close()
            return None

        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{total_size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
        self.end_headers()

        f.seek(start)
        return RangeFileWrapper(f, length)

class RangeFileWrapper:
    def __init__(self, f, length):
        self.f = f
        self.remaining = length

    def read(self, size=-1):
        if self.remaining <= 0:
            return b""
        if size < 0 or size > self.remaining:
            size = self.remaining
        data = self.f.read(size)
        self.remaining -= len(data)
        return data

    def close(self):
        self.f.close()

if __name__ == '__main__':
    port = 8080
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), RangeHTTPRequestHandler) as httpd:
        print(f"Serving HTTP on 0.0.0.0 port {port} (with HTTP 206 Byte-Range support)...")
        httpd.serve_forever()
