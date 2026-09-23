"""Wire-format vectors and negative cases; no aircraft hardware is exercised."""

import unittest

from uart_reference import (
    ModeAck, ModeRequest, ProtocolError, State, crc16_ccitt_false, decode, encode,
)


class ProtocolTests(unittest.TestCase):
    def test_standard_crc_vector(self):
        self.assertEqual(crc16_ccitt_false(b"123456789"), 0x29B1)

    def test_state_round_trip_and_wrap_ranges(self):
        state = State(65535, 4294967295, 630, -1000, 0, 1000, "CRUISE", True, False)
        self.assertEqual(decode(encode(state)), state)

    def test_mode_request_and_ack(self):
        request = ModeRequest("0123456789ABCDEF", "CRUISE")
        applied = ModeAck(request.command_id, "APPLIED", "CRUISE", "OK")
        rejected = ModeAck(request.command_id, "REJECTED", "MANUAL", "UNSAFE_STATE")
        for packet in (request, applied, rejected):
            self.assertEqual(decode(encode(packet)), packet)

    def test_crlf(self):
        frame = encode(State(0, 0, 0, 0, 0, 0, "MANUAL", False, True))
        self.assertEqual(decode(frame[:-1] + b"\r\n"), decode(frame))

    def test_tampering_and_oversize(self):
        frame = encode(State(1, 100, 500, 0, 0, 0, "MANUAL", True, False))
        with self.assertRaises(ProtocolError):
            decode(frame.replace(b",500,", b",900,"))
        with self.assertRaises(ProtocolError):
            decode(b"$" + b"X" * 125 + b"*FFFF\n")

    def test_bad_ranges_even_with_valid_crc(self):
        with self.assertRaises(ProtocolError):
            encode(State(0, 0, 1001, 0, 0, 0, "MANUAL", True, False))
        payload = b"FD1,T,1,100,1001,0,0,0,MANUAL,1,0"
        valid_crc_bad_range = b"$" + payload + b"*" + f"{crc16_ccitt_false(payload):04X}".encode() + b"\n"
        with self.assertRaises(ProtocolError):
            decode(valid_crc_bad_range)
        with self.assertRaises(ProtocolError):
            encode(ModeRequest("0123456789ABCDEF", "FAILSAFE"))
        with self.assertRaises(ProtocolError):
            encode(ModeAck("0123456789ABCDEF", "APPLIED", "CRUISE", "UNSAFE_STATE"))

    def test_rejects_unknown_version_and_noncanonical_integer(self):
        for payload in (b"FD2,T,1,100,500,0,0,0,MANUAL,1,0",
                        b"FD1,T,01,100,500,0,0,0,MANUAL,1,0"):
            frame = b"$" + payload + b"*" + f"{crc16_ccitt_false(payload):04X}".encode() + b"\n"
            with self.assertRaises(ProtocolError):
                decode(frame)


if __name__ == "__main__":
    unittest.main()
