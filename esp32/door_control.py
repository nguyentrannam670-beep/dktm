"""Door logic for the existing HC-SR04; no hardware or network dependencies."""


class DoorController:
    def __init__(self, distance_limit=5, hold_ms=5000):
        self.distance_limit = distance_limit
        self.hold_ms = hold_ms
        self.is_open = False
        self.presence = None
        self.reason = 'sensor_fault'
        self.clear_ms = 0

    def request_open(self):
        self.is_open = True
        self.reason = 'manual'
        self.clear_ms = 0

    def update(self, distance, elapsed_ms, fire=False):
        # A timeout/out-of-range reading does not confirm an empty doorway.
        valid = distance is not None and 2 <= distance <= 400
        self.presence = (distance <= self.distance_limit) if valid else None
        previous_reason = self.reason
        if fire:
            self.is_open = True
            self.reason = 'fire'
            self.clear_ms = 0
        elif self.presence is True:
            self.is_open = True
            self.reason = 'presence'
            self.clear_ms = 0
        elif self.presence is None:
            self.reason = 'sensor_fault'
            self.clear_ms = 0
        elif self.is_open:
            # Each update uses a new range measurement before allowing closure.
            # Restart the full hold after presence, a fault, or a fire alarm.
            if previous_reason != 'waiting' or elapsed_ms < 0:
                self.clear_ms = 0
            else:
                self.clear_ms += elapsed_ms
            self.reason = 'waiting'
            if self.clear_ms >= self.hold_ms:
                self.is_open = False
                self.reason = 'idle'
                self.clear_ms = 0
        else:
            self.reason = 'idle'
            self.clear_ms = 0
        return self.is_open

    def remaining_ms(self):
        if self.is_open and self.reason == 'waiting':
            return max(0, self.hold_ms - self.clear_ms)
        return None


class DoorRequests:
    """Consume each web request once; discard old requests on synchronization."""

    def __init__(self):
        self.ready = False
        self.last_id = None
        self.ack = None

    def disconnect(self):
        self.ready = False

    def accept(self, request_id):
        if not self.ready:
            self.last_id = request_id
            self.ready = True
            return False
        if not isinstance(request_id, str) or not 0 < len(request_id) <= 64 or request_id == self.last_id:
            return False
        self.last_id = request_id
        self.ack = request_id
        return True
