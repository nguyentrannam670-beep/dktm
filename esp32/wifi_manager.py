"""Wi-Fi provisioning for ESP32. Local setup never exposes Firebase credentials."""
import socket
import time
import os
try:
    import ujson as json
except ImportError:
    import json
try:
    import ubinascii as binascii
except ImportError:
    import binascii


def decode_form(data):
    def decode(raw):
        raw = raw.replace(b'+', b' ')
        result = bytearray()
        index = 0
        while index < len(raw):
            if raw[index:index + 1] == b'%':
                if index + 2 >= len(raw):
                    raise ValueError('Invalid form encoding')
                result.append(int(raw[index + 1:index + 3], 16))
                index += 3
            else:
                result.append(raw[index])
                index += 1
        return bytes(result).decode('utf-8')
    values = {}
    for pair in data.split(b'&'):
        parts = pair.split(b'=', 1)
        if len(parts) == 2:
            values[decode(parts[0])] = decode(parts[1])
    return values


def validate_credentials(ssid, password):
    if not isinstance(ssid, str) or not 1 <= len(ssid.encode('utf-8')) <= 32:
        raise ValueError('Ten Wi-Fi phai dai 1-32 byte.')
    if not isinstance(password, str):
        raise ValueError('Mat khau Wi-Fi khong hop le.')
    size = len(password.encode('utf-8'))
    if size not in (0, 64) and not 8 <= size <= 63:
        raise ValueError('Mat khau Wi-Fi can 8-63 byte, hoac de trong neu mang mo.')
    if size == 64 and any(char not in '0123456789abcdefABCDEF' for char in password):
        raise ValueError('Khoa Wi-Fi 64 ky tu phai la chuoi hex.')


def escape_html(text):
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", '&#39;')


class WifiManager:
    def __init__(self, station, access_point, setup_password, setup_ssid='SmartHome-Setup',
                 config_path='wifi.json', fallback_ssid='', fallback_password=''):
        if not 8 <= len(setup_password) <= 63:
            raise ValueError('SETUP_AP_PASSWORD must contain 8-63 characters.')
        self.station = station
        self.access_point = access_point
        self.setup_password = setup_password
        self.setup_ssid = setup_ssid
        self.config_path = config_path
        self.ssid = fallback_ssid if fallback_ssid and not fallback_ssid.startswith('TEN_WIFI') else ''
        self.password = fallback_password if self.ssid else ''
        try:
            with open(config_path) as handle:
                saved = json.load(handle)
            validate_credentials(saved.get('ssid'), saved.get('password'))
            self.ssid, self.password = saved['ssid'], saved['password']
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        self.station.active(True)
        try:
            self.station.config(reconnects=0)
        except (OSError, ValueError, TypeError):
            pass
        self.started = time.ticks_ms()
        self.last_attempt = None
        self.last_cloud_ok = None
        self.connected_since = None
        self.setup_started = None
        self.server = None
        self.client = None
        self.request = b''
        self.response = b''
        self.client_started = None
        self.pending = None
        self.notice = 'Chon Wi-Fi 2.4 GHz co Internet hoac diem phat song tu dien thoai.'
        self.csrf = binascii.hexlify(os.urandom(16)).decode()

    def cloud_ok(self):
        self.last_cloud_ok = time.ticks_ms()

    def isconnected(self):
        return self.station.isconnected()

    def start_setup(self):
        if self.server is not None:
            return
        self.access_point.active(True)
        try:
            self.access_point.config(essid=self.setup_ssid, password=self.setup_password, authmode=3)
        except (TypeError, ValueError, OSError):
            self.access_point.config(ssid=self.setup_ssid, key=self.setup_password, security=3)
        self.access_point.ifconfig(('192.168.4.1', '255.255.255.0', '192.168.4.1', '192.168.4.1'))
        server = socket.socket()
        try:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except (AttributeError, OSError):
            pass
        try:
            server.bind(socket.getaddrinfo('192.168.4.1', 80, 0, socket.SOCK_STREAM)[0][-1])
            server.listen(2)
            server.setblocking(False)
        except Exception:
            server.close()
            self.access_point.active(False)
            raise
        self.server = server
        self.setup_started = time.ticks_ms()
        print('Wi-Fi setup:', self.setup_ssid, 'http://192.168.4.1')

    def close_client(self):
        if self.client is not None:
            try:
                self.client.close()
            except OSError:
                pass
        self.client = None
        self.request = b''
        self.response = b''

    def stop_setup(self):
        self.close_client()
        if self.server is not None:
            self.server.close()
            self.server = None
        self.access_point.active(False)

    def save(self, ssid, password):
        validate_credentials(ssid, password)
        temporary = self.config_path + '.tmp'
        with open(temporary, 'w') as handle:
            json.dump({'ssid': ssid, 'password': password}, handle)
        getattr(os, 'replace', os.rename)(temporary, self.config_path)

    def page(self):
        return ('''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cai Wi-Fi Smart Home</title><style>body{font:16px system-ui;background:#eaf3fa;color:#17344e;margin:0;padding:28px}main{max-width:440px;margin:5vh auto;background:white;padding:28px;border-radius:20px}h1{font-size:26px}p{line-height:1.7;color:#627d93}label{display:block;margin-top:20px}input,button{box-sizing:border-box;width:100%;padding:13px;margin-top:8px;border:1px solid #cfdeea;border-radius:9px;font:inherit}button{background:#0ea5e9;color:white;font-weight:bold;border:0}small{display:block;color:#7d91a5;line-height:1.7;margin-top:20px}</style><main><h1>Cai Wi-Fi cho ESP32</h1><p>''' + escape_html(self.notice) + '''</p><form method="post" action="/save"><input type="hidden" name="token" value="''' + self.csrf + '''"><label>Ten Wi-Fi (SSID)<input name="ssid" required autocomplete="off" value="''' + escape_html(self.ssid) + '''"></label><label>Mat khau Wi-Fi<input name="password" type="password" maxlength="64" autocomplete="new-password" placeholder="De trong neu mang khong co mat khau"></label><button>Luu va ket noi</button></form><small>Mat khau Wi-Fi cu khong hien thi tren trang nay. Khi ESP32 len mang, quay lai Wi-Fi/4G thong thuong va mo https://smart-room-4899a.web.app. Mang doanh nghiep hoac Wi-Fi yeu cau dang nhap qua trang web chua duoc ho tro.</small></main></html>''').encode('utf-8')

    def reply(self, status, body):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.response = ('HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n'.format(status, len(body))).encode() + body

    def handle_request(self):
        if b'\r\n\r\n' not in self.request:
            return
        header, body = self.request.split(b'\r\n\r\n', 1)
        lines = header.split(b'\r\n')
        first = lines[0].split()
        if len(first) != 3:
            self.reply('400 Bad Request', 'Yeu cau khong hop le.'); return
        method, target = first[:2]
        headers = {}
        for line in lines[1:]:
            parts = line.split(b':', 1)
            if len(parts) == 2:
                headers[parts[0].strip().lower()] = parts[1].strip()
        if method == b'GET':
            self.reply('200 OK' if target == b'/' else '404 Not Found', self.page() if target == b'/' else 'Khong tim thay.'); return
        if method != b'POST' or target != b'/save':
            self.reply('405 Method Not Allowed', 'Chi ho tro luu qua bieu mau.'); return
        try:
            length = int(headers.get(b'content-length', b'0'))
        except ValueError:
            self.reply('400 Bad Request', 'Do dai khong hop le.'); return
        if not 1 <= length <= 2048:
            self.reply('413 Payload Too Large', 'Bieu mau qua dai.'); return
        if len(body) < length:
            return
        if headers.get(b'origin', b'http://192.168.4.1') != b'http://192.168.4.1':
            self.reply('403 Forbidden', 'Hay mo trang cai dat truc tiep.'); return
        if headers.get(b'content-type', b'').split(b';', 1)[0] != b'application/x-www-form-urlencoded':
            self.reply('400 Bad Request', 'Dinh dang khong ho tro.'); return
        try:
            fields = decode_form(body[:length])
            if fields.get('token') != self.csrf:
                self.reply('403 Forbidden', 'Phien cai dat het han. Hay tai lai trang.'); return
            ssid, password = fields.get('ssid', ''), fields.get('password', '')
            self.save(ssid, password)
            self.pending = (ssid, password)
            self.notice = 'Da luu. ESP32 dang thu ket noi. Neu sai mat khau, nhap lai tai day. Khi ket noi Firebase thanh cong, mang cai dat se tu tat.'
            self.reply('200 OK', self.page())
        except (ValueError, UnicodeError) as error:
            self.reply('400 Bad Request', escape_html(str(error)))
        except OSError:
            self.reply('500 Internal Server Error', 'Khong luu duoc cau hinh. Hay thu lai.')

    def serve(self):
        if self.server is None:
            return
        if self.client is None:
            try:
                client, address = self.server.accept()
                if not address[0].startswith('192.168.4.'):
                    client.close(); return
                client.setblocking(False)
                self.client = client
                self.client_started = time.ticks_ms()
            except OSError:
                return
        if time.ticks_diff(time.ticks_ms(), self.client_started) > 8000:
            self.close_client(); return
        try:
            if self.response:
                sent = self.client.send(self.response[:1024])
                if sent == 0:
                    self.close_client(); return
                self.response = self.response[sent:]
                if not self.response:
                    self.close_client()
                return
            part = self.client.recv(512)
            if not part:
                self.close_client(); return
            self.request += part
            if len(self.request) > 4096:
                self.reply('413 Payload Too Large', 'Yeu cau qua dai.')
            else:
                self.handle_request()
        except OSError as error:
            if not error.args or error.args[0] not in (11, 35, 10035):
                self.close_client()

    def poll(self):
        now = time.ticks_ms()
        self.serve()
        if self.pending is not None and self.client is None:
            self.ssid, self.password = self.pending
            self.pending = None
            self.station.disconnect()
            self.last_attempt = None
            self.last_cloud_ok = None
            self.connected_since = None
        if self.station.isconnected():
            if self.connected_since is None:
                self.connected_since = now
            cloud_reference = self.last_cloud_ok if self.last_cloud_ok is not None else self.connected_since
            if time.ticks_diff(now, cloud_reference) >= 60000:
                self.start_setup()
            elif self.server is not None and self.last_cloud_ok is not None and time.ticks_diff(now, self.setup_started) >= 30000 and self.client is None:
                self.stop_setup()
            return
        self.connected_since = None
        if not self.ssid or time.ticks_diff(now, self.started) >= 20000 or self.server is not None:
            self.start_setup()
        if self.ssid and (self.last_attempt is None or time.ticks_diff(now, self.last_attempt) >= 20000):
            self.last_attempt = now
            try:
                self.station.disconnect()
                self.station.connect(self.ssid, self.password)
            except OSError:
                self.notice = 'Chua ket noi duoc. Kiem tra ten Wi-Fi va mat khau, mang phai la 2.4 GHz.'
