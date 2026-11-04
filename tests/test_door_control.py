import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'esp32'))
from door_control import DoorController, DoorRequests


class DoorControlTests(unittest.TestCase):
    def setUp(self):
        self.door = DoorController()

    def clear_for(self, milliseconds):
        for _ in range(milliseconds // 100):
            self.door.update(120, 100)

    def test_person_keeps_door_open_beyond_hold_time(self):
        for _ in range(100):
            self.assertTrue(self.door.update(3, 100))
        self.assertEqual(self.door.reason, 'presence')

    def test_closes_only_after_full_clear_hold(self):
        self.door.update(3, 100)
        self.door.update(120, 100)
        self.clear_for(4900)
        self.assertTrue(self.door.is_open)
        self.door.update(120, 100)
        self.assertFalse(self.door.is_open)

    def test_returning_person_restarts_hold(self):
        self.door.request_open()
        self.door.update(120, 100)
        self.clear_for(4000)
        self.door.update(3, 100)
        self.door.update(120, 100)
        self.clear_for(4900)
        self.assertTrue(self.door.is_open)
        self.door.update(120, 100)
        self.assertFalse(self.door.is_open)

    def test_manual_open_and_repeat_restart_full_hold(self):
        self.door.request_open()
        self.assertTrue(self.door.is_open)
        self.door.update(120, 100)
        self.clear_for(4000)
        self.door.request_open()
        self.door.update(120, 100)
        self.clear_for(4900)
        self.assertTrue(self.door.is_open)
        self.door.update(120, 100)
        self.assertFalse(self.door.is_open)

    def test_bad_sensor_does_not_close_and_recovery_restarts_hold(self):
        self.door.request_open()
        for invalid in (-1, 0, 1, 401, None):
            self.assertTrue(self.door.update(invalid, 10000))
            self.assertIsNone(self.door.presence)
            self.assertEqual(self.door.reason, 'sensor_fault')
        self.door.update(120, 100)
        self.clear_for(4900)
        self.assertTrue(self.door.is_open)

    def test_fire_overrides_sensor_and_recovery_gets_full_hold(self):
        self.assertTrue(self.door.update(-1, 100, fire=True))
        self.assertEqual(self.door.reason, 'fire')
        self.door.update(120, 10000, fire=True)
        self.door.update(120, 10000)
        self.assertEqual(self.door.remaining_ms(), 5000)
        self.clear_for(5000)
        self.assertFalse(self.door.is_open)

    def test_threshold_includes_5_cm(self):
        self.assertTrue(self.door.update(5, 100))
        self.door.update(5.1, 100)
        self.assertFalse(self.door.presence)


class DoorRequestTests(unittest.TestCase):
    def test_startup_ignores_old_request_and_consumes_new_one_once(self):
        requests = DoorRequests()
        self.assertFalse(requests.accept('old-request'))
        self.assertTrue(requests.ready)
        self.assertIsNone(requests.ack)
        self.assertTrue(requests.accept('new-request'))
        self.assertEqual(requests.ack, 'new-request')
        for _ in range(10):
            self.assertFalse(requests.accept('new-request'))

    def test_reconnection_discards_pending_old_request(self):
        requests = DoorRequests()
        requests.accept(None)
        requests.accept('first')
        requests.disconnect()
        self.assertFalse(requests.ready)
        self.assertFalse(requests.accept('sent-while-offline'))
        self.assertTrue(requests.accept('after-reconnection'))

    def test_empty_database_and_invalid_commands(self):
        requests = DoorRequests()
        self.assertFalse(requests.accept(None))
        for invalid in (None, '', 1, {}, 'a' * 65):
            self.assertFalse(requests.accept(invalid))
        self.assertTrue(requests.accept('valid'))


if __name__ == '__main__':
    unittest.main()
