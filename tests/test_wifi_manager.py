import json
import pathlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlencode

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'esp32'))
import wifi_manager


class Station:
    def __init__(self):
        self.connected = False
        self.connections = []
    def active(self, value):
        pass
    def config(self, **values):
        pass
    def isconnected(self):
        return self.connected
    def disconnect(self):
        self.connected = False
    def connect(self, ssid, password):
        self.connections.append((ssid, password))


class AccessPoint:
    def __init__(self):
        self.enabled = False
        self.settings = {}
    def active(self, value):
        self.enabled = value
    def config(self, **values):
        self.settings.update(values)
    def ifconfig(self, values):
        self.address = values


class Server:
    def __init__(self):
        self.clients = []
        self.closed = False
    def setsockopt(self, *args):
        pass
    def bind(self, address):
        self.address = address
    def listen(self, count):
        pass
    def setblocking(self, value):
        pass
    def accept(self):
        if not self.clients:
            raise OSError(11)
        return self.clients.pop(0), ('192.168.4.2', 12345)
    def close(self):
        self.closed = True


class Client:
    def __init__(self, request):
        self.incoming = request
        self.outgoing = b''
        self.closed = False
    def setblocking(self, value):
        pass
    def recv(self, limit):
        data, self.incoming = self.incoming[:limit], self.incoming[limit:]
        return data
    def send(self, data):
        part = data[:128]
        self.outgoing += part
        return len(part)
    def close(self):
        self.closed = True


class WifiTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).parent)
        self.addCleanup(self.temporary.cleanup)
        self.config_path = str(pathlib.Path(self.temporary.name) / 'wifi.json')
        self.now = 0
        self.servers = []
        def socket_factory():
            server = Server()
            self.servers.append(server)
            return server
        fake_socket = SimpleNamespace(socket=socket_factory, SOL_SOCKET=1, SO_REUSEADDR=2, SOCK_STREAM=1,
                                      getaddrinfo=lambda *args: [(2, 1, 6, '', ('192.168.4.1', 80))])
        self.addCleanup(patch.stopall)
        patch.object(wifi_manager, 'time', SimpleNamespace(ticks_ms=lambda:self.now, ticks_diff=lambda a,b:a-b)).start()
        patch.object(wifi_manager, 'socket', fake_socket).start()
        self.station, self.ap = Station(), AccessPoint()
        self.manager = wifi_manager.WifiManager(self.station, self.ap, 'TestSetupPassword', config_path=self.config_path)

    def request(self, fields, origin='http://192.168.4.1'):
        body = urlencode(fields).encode()
        return ('POST /save HTTP/1.1\r\nHost: 192.168.4.1\r\nOrigin: '+origin+'\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: '+str(len(body))+'\r\n\r\n').encode()+body

    def test_first_boot_opens_protected_local_setup(self):
        self.manager.poll()
        self.assertTrue(self.ap.enabled)
        self.assertEqual(self.ap.settings['essid'], 'SmartHome-Setup')
        self.assertEqual(self.ap.settings['authmode'], 3)
        self.assertEqual(self.servers[0].address, ('192.168.4.1', 80))
        self.assertEqual(self.station.connections, [])

    def test_form_handles_unicode_ssid_and_does_not_echo_wifi_password(self):
        self.manager.request = self.request({'token':self.manager.csrf, 'ssid':'Nhà Đức', 'password':'private-pass'})
        self.manager.handle_request()
        self.assertTrue(self.manager.response.startswith(b'HTTP/1.1 200'))
        self.assertNotIn(b'private-pass', self.manager.response)
        with open(self.config_path) as handle:
            saved = json.load(handle)
        self.assertEqual(saved, {'ssid':'Nhà Đức','password':'private-pass'})
        self.assertEqual(self.manager.pending, ('Nhà Đức','private-pass'))

    def test_cross_site_or_invalid_token_cannot_change_network(self):
        for token, origin in ((self.manager.csrf,'https://evil.invalid'), ('wrong','http://192.168.4.1')):
            self.manager.request = self.request({'token':token, 'ssid':'Cafe', 'password':'password1'}, origin)
            self.manager.handle_request()
            self.assertTrue(self.manager.response.startswith(b'HTTP/1.1 403'))
        self.assertFalse(pathlib.Path(self.config_path).exists())
        self.assertIsNone(self.manager.pending)

    def test_partial_http_and_partial_writes_finish_before_network_switch(self):
        self.manager.poll()
        client = Client(self.request({'token':self.manager.csrf,'ssid':'Phone hotspot','password':'password1'}))
        self.servers[0].clients.append(client)
        for _ in range(100):
            self.manager.poll()
            if self.station.connections:
                break
            self.now += 60
        self.assertTrue(client.closed)
        self.assertIn(b'HTTP/1.1 200', client.outgoing)
        self.assertEqual(self.station.connections, [('Phone hotspot','password1')])
        header, body = client.outgoing.split(b'\r\n\r\n',1)
        length = int(header.split(b'Content-Length: ')[1].split(b'\r\n')[0])
        self.assertEqual(length, len(body))

    def test_saved_network_reconnects_after_restart_without_reflashing(self):
        self.manager.save('New location','newpassword')
        restarted = wifi_manager.WifiManager(self.station,self.ap,'TestSetupPassword',config_path=self.config_path)
        restarted.poll()
        self.assertEqual(self.station.connections[-1], ('New location','newpassword'))
        self.assertFalse(self.ap.enabled)

    def test_wrong_network_and_internet_loss_reopen_setup(self):
        self.manager.ssid, self.manager.password = 'Unavailable', 'password1'
        self.manager.poll()
        self.assertFalse(self.ap.enabled)
        self.now = 20001; self.manager.poll()
        self.assertTrue(self.ap.enabled)
        self.station.connected = True
        self.manager.cloud_ok()
        self.now = 51000; self.manager.cloud_ok(); self.manager.poll()
        self.assertFalse(self.ap.enabled)
        self.now += 60001; self.manager.poll()
        self.assertTrue(self.ap.enabled)

    def test_slow_client_is_closed_without_blocking_other_work(self):
        self.manager.poll()
        self.manager.client = Client(b'GET / HTTP/1.1')
        self.manager.client_started = 0
        client = self.manager.client
        self.now = 9000; self.manager.serve()
        self.assertTrue(client.closed)
        self.assertIsNone(self.manager.client)

    def test_replacing_saved_credentials_preserves_only_current_wifi(self):
        self.manager.save('First','password1')
        self.manager.save('Second','password2')
        with open(self.config_path) as handle:
            self.assertEqual(json.load(handle), {'ssid':'Second','password':'password2'})
        self.assertFalse(pathlib.Path(self.config_path+'.tmp').exists())

    def test_validation_accepts_open_network_and_rejects_bad_settings(self):
        wifi_manager.validate_credentials('Open cafe','')
        for ssid, password in (('', 'password1'), ('x'*33, 'password1'), ('Cafe','short'), ('Cafe','z'*64)):
            with self.assertRaises(ValueError):
                wifi_manager.validate_credentials(ssid,password)


if __name__ == '__main__':
    unittest.main()
