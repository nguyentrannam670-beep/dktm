"""
SMART HOME ESP32 + FIREBASE (MicroPython)
Port tu file gki (1).py: HC-SR04, Servo SG90, DHT22, MQ-2,
LED bao chay, buzzer, den phong, relay quat.
Giao tiep Firebase Realtime Database qua Wi-Fi (REST + Firebase Auth).

Cai secrets.py truoc khi chay. Khong nap main.py nay neu chua chinh
nguong bao chay/chan cam bien phu hop phan cung thuc te.
"""
from machine import Pin, PWM, ADC, time_pulse_us
from door_control import DoorController, DoorRequests
from wifi_manager import WifiManager
import dht
import time
import sys
import uselect
import network
import ujson
import gc
import os
import ubinascii
try:
    import ntptime
except ImportError:
    ntptime = None

try:
    import requests as urequests  # Ban requests.py di kem ho tro timeout.
except ImportError:
    import urequests

from secrets import (
    WIFI_SSID, WIFI_PASSWORD, FIREBASE_API_KEY,
    FIREBASE_DATABASE_URL, DEVICE_EMAIL, DEVICE_PASSWORD,
    SETUP_AP_SSID, SETUP_AP_PASSWORD
)

# ------------------ 1. CHAN PHAN CUNG GOC ------------------
TRIG_PIN = 5
ECHO_PIN = 18
SERVO_PIN = 13
DHT_PIN = 4
MQ2_PIN = 34
BUZZER_PIN = 23
FIRE_LED_PIN = 2
LIGHT_PIN = 25
FAN_RELAY_PIN = 26

trig = Pin(TRIG_PIN, Pin.OUT)
echo = Pin(ECHO_PIN, Pin.IN)
trig.value(0)
servo = PWM(Pin(SERVO_PIN), freq=50)
dht_sensor = dht.DHT22(Pin(DHT_PIN))
mq2 = ADC(Pin(MQ2_PIN))
mq2.atten(ADC.ATTN_11DB)
mq2.width(ADC.WIDTH_12BIT)
buzzer = PWM(Pin(BUZZER_PIN))
buzzer.freq(2000)
buzzer.duty(0)
fire_led = Pin(FIRE_LED_PIN, Pin.OUT, value=0)
room_led = Pin(LIGHT_PIN, Pin.OUT, value=0)

# Theo ma goc set_fan(True) xuat 0, set_fan(False) xuat 1.
# Phai khop muc kich relay thuc te; KHONG set False nhu bien cuoi file goc.
RELAY_ACTIVE_LOW = True
fan_relay = Pin(FAN_RELAY_PIN, Pin.OUT, value=(1 if RELAY_ACTIVE_LOW else 0))

# ------------------ 2. THONG SO DIEU KHIEN GOC ------------------
DISTANCE_LIMIT = 5            # cm: mo cua khi vat nam trong khoang cach 5 cm
DOOR_OPEN_TIME = 5000         # ms: ca vung cam bien phai trong lien tuc
FIRE_THRESHOLD = 2000         # Can do va chinh lai theo thuc te
# Giữ phép so sánh <= từ file gốc. MQ-2 không phải cảm biến báo cháy chuẩn.
FIRE_TRIGGER_WHEN_BELOW = True

# Chu ky trao doi cloud, milliseconds.
SEND_TELEMETRY_MS = 2500
CHECK_COMMAND_MS = 1400
RETRY_AUTH_MS = 15000
REFRESH_AUTH_MS = 50 * 60 * 1000
SYNC_CLOCK_MS = 60 * 60 * 1000
RETRY_CLOCK_MS = 60000
SEND_EVENT_MS = 3000
MAX_QUEUED_EVENTS = 50

# ------------------ 3. BIEN TRANG THAI ------------------
door_open = False
door_controller = DoorController(DISTANCE_LIMIT, DOOR_OPEN_TIME)
last_door_update = time.ticks_ms()
fan_on = False
room_light = False
fire_status = False
temperature = None
humidity = None
mq_value = 0
distance = -1
led_state = 0
buzzer_state = 0
last_led_toggle = time.ticks_ms()
last_buzzer_toggle = time.ticks_ms()
last_print = time.ticks_ms()
last_dht = time.ticks_ms()
last_upload = time.ticks_ms()
last_poll = time.ticks_ms()
last_auth_attempt = time.ticks_ms() - RETRY_AUTH_MS
id_token = None
auth_time = time.ticks_ms()
door_requests = DoorRequests()
event_queue = []
event_session = ubinascii.hexlify(os.urandom(8)).decode()
event_counter = 0
outside_was_present = False
clock_synced = False
last_clock_attempt = None
last_event_upload = time.ticks_ms()
epoch_offset = 946684800 if time.gmtime(0)[0] == 2000 else 0

FIREBASE_DATABASE_URL = FIREBASE_DATABASE_URL.rstrip('/')

# ------------------ 4. DIEU KHIEN THIET BI ------------------
def set_fan(state):
    global fan_on
    fan_on = bool(state)
    fan_relay.value(0 if (fan_on == RELAY_ACTIVE_LOW) else 1)
    print('QUAT MINI:', 'BAT' if fan_on else 'TAT')


def light_on():
    global room_light
    room_led.value(1)
    room_light = True
    print('DEN PHONG: BAT')


def light_off():
    global room_light
    room_led.value(0)
    room_light = False
    print('DEN PHONG: TAT')


def servo_angle(angle):
    min_duty = 1638
    max_duty = 8192
    servo.duty_u16(int(min_duty + angle / 180 * (max_duty - min_duty)))


servo_angle(0)
set_fan(False)

# ------------------ 5. DOC CAM BIEN ------------------
def read_distance():
    trig.value(0)
    time.sleep_us(2)
    trig.value(1)
    time.sleep_us(10)
    trig.value(0)
    pulse = time_pulse_us(echo, 1, 30000)
    measured = pulse / 58 if pulse > 0 else -1
    return measured if 2 <= measured <= 400 else -1


def read_dht():
    global temperature, humidity
    try:
        dht_sensor.measure()
        temperature = dht_sensor.temperature()
        humidity = dht_sensor.humidity()
    except Exception as error:
        print('DHT22 read error:', error)


def control_fire():
    global fire_status, led_state, buzzer_state
    global last_led_toggle, last_buzzer_toggle
    now = time.ticks_ms()
    fire_status = (mq_value <= FIRE_THRESHOLD) if FIRE_TRIGGER_WHEN_BELOW else (mq_value >= FIRE_THRESHOLD)
    if fire_status:
        if time.ticks_diff(now, last_led_toggle) >= 300:
            led_state = 1 - led_state
            fire_led.value(led_state)
            last_led_toggle = now
        if time.ticks_diff(now, last_buzzer_toggle) >= 300:
            buzzer_state = 1 - buzzer_state
            buzzer.duty(512 if buzzer_state else 0)
            last_buzzer_toggle = now
    else:
        led_state = 0
        buzzer_state = 0
        fire_led.value(0)
        buzzer.duty(0)


def control_door():
    global door_open, distance, last_door_update, outside_was_present
    distance = read_distance()
    now = time.ticks_ms()
    wanted = door_controller.update(distance, time.ticks_diff(now, last_door_update), fire_status)
    last_door_update = now
    if door_controller.presence is not None:
        if door_controller.presence and not outside_was_present:
            queue_door_event('outside_detected', 'sensor_outside')
        outside_was_present = door_controller.presence
    if wanted != door_open:
        servo_angle(90 if wanted else 0)
        door_open = wanted
        print('CUA:', 'MO' if door_open else 'DONG', door_controller.reason)


# Giu giao thuc lenh qua serial USB tu code goc (khong bat buoc).
try:
    serial_poll = uselect.poll()
    serial_poll.register(sys.stdin, uselect.POLLIN)
except Exception:
    serial_poll = None


def check_serial():
    if serial_poll is None or not serial_poll.poll(0):
        return
    try:
        command = sys.stdin.readline().strip()
        if command == 'LIGHT_ON':
            light_on()
        elif command == 'LIGHT_OFF':
            light_off()
        elif command == 'FAN_ON':
            set_fan(True)
        elif command == 'FAN_OFF':
            set_fan(False)
    except Exception:
        pass


def print_data():
    global last_print
    now = time.ticks_ms()
    if time.ticks_diff(now, last_print) >= 1000:
        last_print = now
        print('DATA,TEMP={},HUM={},MQ={},DIST={},DOOR={},FIRE={},LIGHT={},FAN={}'.format(
            temperature if temperature is not None else '--',
            humidity if humidity is not None else '--',
            mq_value,
            round(distance, 1) if distance >= 0 else -1,
            int(door_open), int(fire_status), int(room_light), int(fan_on)
        ))


# ------------------ 6. WIFI + FIREBASE AUTH ------------------
def unix_ms():
    return int((time.time() + epoch_offset) * 1000)


def sync_clock():
    global clock_synced, last_clock_attempt
    now = time.ticks_ms()
    if ntptime is None:
        return
    interval = SYNC_CLOCK_MS if clock_synced else RETRY_CLOCK_MS
    if last_clock_attempt is not None and time.ticks_diff(now, last_clock_attempt) < interval:
        return
    last_clock_attempt = now
    try:
        ntptime.settime()
        clock_synced = True
        print('NTP: UTC clock synchronized')
    except Exception:
        print('NTP unavailable; events will use server receive time until synchronized')


def queue_door_event(event_type, source):
    global event_counter
    event_counter += 1
    event_id = '{}-{}'.format(event_session, event_counter)
    event = {'type': event_type, 'source': source, 'createdAt': {'.sv': 'timestamp'},
             'timeSource': 'device_ntp' if clock_synced else 'server_received'}
    if clock_synced:
        event['occurredAt'] = unix_ms()
    if len(event_queue) >= MAX_QUEUED_EVENTS:
        event_queue.pop(0)
        print('Door event queue full: dropped oldest unsent event')
    event_queue.append((event_id, event, time.ticks_ms()))


def upload_door_event():
    if not event_queue or not id_token:
        return
    event_id, event, recorded_ticks = event_queue[0]
    if clock_synced and 'occurredAt' not in event:
        event['occurredAt'] = unix_ms() - max(0, time.ticks_diff(time.ticks_ms(), recorded_ticks))
        event['timeSource'] = 'device_ntp'
    try:
        # A response lost after a successful write is resolved by checking the
        # same event ID, rather than creating a duplicate history entry.
        existing = firebase_request('GET', 'events/' + event_id)
        if isinstance(existing, dict) and existing.get('type') == event['type']:
            event_queue.pop(0)
            return
        if not id_token:
            return
        url = FIREBASE_DATABASE_URL + '/smartHome/events/' + event_id + '.json?auth=' + id_token
        http_json('PUT', url, event)
        event_queue.pop(0)
    except Exception as error:
        print('Door event upload:', error)


wlan = network.WLAN(network.STA_IF)
setup_ap = network.WLAN(network.AP_IF)
wifi = WifiManager(wlan, setup_ap, SETUP_AP_PASSWORD, SETUP_AP_SSID,
                   fallback_ssid=WIFI_SSID, fallback_password=WIFI_PASSWORD)


def connect_wifi():
    return wifi.isconnected()


def http_json(method, url, body=None):
    """Tra ve Python object cho GET/POST; dong HTTP socket trong moi truong hop."""
    response = None
    try:
        headers = {'Content-Type': 'application/json'}
        data = ujson.dumps(body) if body is not None else None
        response = urequests.request(method, url, data=data, headers=headers, timeout=5)
        status = response.status_code
        if status < 200 or status >= 300:
            # Khong in token co trong URL.
            raise OSError('HTTP {}'.format(status))
        if method == 'GET' or method == 'POST':
            return response.json()
        return None
    finally:
        if response is not None:
            response.close()
        gc.collect()


def sign_in_device():
    global id_token, auth_time, last_auth_attempt
    last_auth_attempt = time.ticks_ms()
    url = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE_API_KEY
    try:
        result = http_json('POST', url, {
            'email': DEVICE_EMAIL,
            'password': DEVICE_PASSWORD,
            'returnSecureToken': True
        })
        id_token = result['idToken']
        auth_time = time.ticks_ms()
        print('Firebase Auth: device signed in')
        return True
    except Exception as error:
        id_token = None
        print('Firebase Auth error:', error)
        return False


def firebase_request(method, path, body=None):
    global id_token
    if not id_token:
        return None
    url = FIREBASE_DATABASE_URL + '/smartHome/' + path + '.json?auth=' + id_token
    try:
        result = http_json(method, url, body)
        wifi.cloud_ok()
        # An empty desired node is a successful read, distinct from an error.
        return {} if method == 'GET' and path == 'desired' and result is None else result
    except Exception as error:
        print('Firebase {} {}: {}'.format(method, path, error))
        if 'HTTP 401' in str(error):
            id_token = None
        return None


def upload_telemetry():
    data = {
        'TEMP': temperature,
        'HUM': humidity,
        'MQ': mq_value,
        'DIST': round(distance, 1) if distance >= 0 else -1,
        'DOOR': int(door_open),
        'DOOR_PRESENCE': None if door_controller.presence is None else int(door_controller.presence),
        'DOOR_REASON': door_controller.reason,
        'DOOR_LIMIT_CM': DISTANCE_LIMIT,
        'DOOR_HOLD_MS': DOOR_OPEN_TIME,
        'DOOR_WAIT_MS': door_controller.remaining_ms(),
        'DOOR_MANUAL_READY': door_requests.ready,
        'DOOR_REQUEST_ID': door_requests.ack,
        'FIRE': int(fire_status),
        'LIGHT': int(room_light),
        'FAN': int(fan_on),
        # Server timestamp la thoi gian cua Firebase, khong phu thuoc RTC cua ESP32.
        'updatedAt': {'.sv': 'timestamp'}
    }
    firebase_request('PUT', 'telemetry', data)


def poll_commands():
    global door_open
    commands = firebase_request('GET', 'desired')
    if not isinstance(commands, dict):
        return
    if door_requests.accept(commands.get('DOOR_OPEN_REQUEST')):
        door_controller.request_open()
        if not door_open:
            servo_angle(90)
            door_open = True
        print('MO CUA TU WEB')
        queue_door_event('exit_requested', 'web')
    if commands.get('LIGHT') in (0, 1):
        wanted = (commands['LIGHT'] == 1)
        if room_light != wanted:
            light_on() if wanted else light_off()
    if commands.get('FAN') in (0, 1):
        wanted = (commands['FAN'] == 1)
        if fan_on != wanted:
            set_fan(wanted)


# ------------------ 7. VONG LAP CHINH ------------------
print('SMART HOME ESP32 + FIREBASE START')
print('MQ2 threshold:', FIRE_THRESHOLD, '; trigger below threshold:', FIRE_TRIGGER_WHEN_BELOW)
while True:
    wifi.poll()
    mq_value = mq2.read()
    now = time.ticks_ms()
    if time.ticks_diff(now, last_dht) >= 2000:
        read_dht()
        last_dht = now

    # Bao chay duoc xu ly cuc bo ngay ca khi Wi-Fi/Firebase mat ket noi.
    control_fire()
    control_door()
    check_serial()
    print_data()

    if connect_wifi():
        sync_clock()
        now = time.ticks_ms()
        if (id_token is None and time.ticks_diff(now, last_auth_attempt) >= RETRY_AUTH_MS) or (
                id_token is not None and time.ticks_diff(now, auth_time) >= REFRESH_AUTH_MS):
            sign_in_device()
        if id_token:
            if time.ticks_diff(now, last_poll) >= CHECK_COMMAND_MS:
                last_poll = now
                poll_commands()
            if time.ticks_diff(now, last_upload) >= SEND_TELEMETRY_MS:
                last_upload = now
                upload_telemetry()
            if time.ticks_diff(now, last_event_upload) >= SEND_EVENT_MS and event_queue:
                last_event_upload = now
                upload_door_event()
    else:
        id_token = None
    if id_token is None:
        door_requests.disconnect()

    time.sleep_ms(60)
