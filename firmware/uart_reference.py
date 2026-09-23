"""Host-side reference for the proposed FD1 UART wire format.

Not an aircraft firmware implementation. No GPIO, actuators, sensors or network.
See docs/uart-protocol.md before implementing on an embedded target.
"""

from dataclasses import dataclass
import re
from typing import Union


MAX_FRAME_BYTES = 128
MODES = frozenset({"MANUAL", "STABILIZED", "TAKEOFF", "CRUISE", "LANDING", "FAILSAFE"})
TARGET_MODES = MODES - {"FAILSAFE"}
REJECTION_REASONS = frozenset({"INVALID_MODE", "UNSAFE_STATE", "FAILSAFE_ACTIVE", "NOT_IMPLEMENTED"})
HEX_ID = re.compile(r"[0-9A-F]{16}\Z", re.ASCII)
UNSIGNED = re.compile(r"(?:0|[1-9][0-9]*)\Z", re.ASCII)
SIGNED = re.compile(r"(?:0|[1-9][0-9]*|-[1-9][0-9]*)\Z", re.ASCII)


class ProtocolError(ValueError):
    """A malformed or unsupported frame. Discard it; never apply a request."""


@dataclass(frozen=True)
class State:
    seq: int
    uptime_ms: int
    throttle: int
    aileron: int
    elevator: int
    rudder: int
    mode: str
    rc_link: bool
    failsafe: bool


@dataclass(frozen=True)
class ModeRequest:
    command_id: str
    target_mode: str


@dataclass(frozen=True)
class ModeAck:
    command_id: str
    result: str
    actual_mode: str
    reason: str


Packet = Union[State, ModeRequest, ModeAck]


def crc16_ccitt_false(data: bytes) -> int:
    crc = 0xFFFF
    for octet in data:
        crc ^= octet << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def _integer(value: str, minimum: int, maximum: int, signed: bool = False) -> int:
    if not (SIGNED if signed else UNSIGNED).fullmatch(value):
        raise ProtocolError("invalid decimal integer")
    parsed = int(value)
    if parsed < minimum or parsed > maximum:
        raise ProtocolError("integer out of range")
    return parsed


def _mode(value: str, *, target: bool = False) -> str:
    if value not in (TARGET_MODES if target else MODES):
        raise ProtocolError("unknown or unsupported mode")
    return value


def _command_id(value: str) -> str:
    if not HEX_ID.fullmatch(value):
        raise ProtocolError("invalid command ID")
    return value


def _payload(packet: Packet) -> str:
    if isinstance(packet, State):
        seq = _integer(str(packet.seq), 0, 65535)
        uptime = _integer(str(packet.uptime_ms), 0, 4294967295)
        throttle = _integer(str(packet.throttle), 0, 1000)
        axes = [_integer(str(value), -1000, 1000, signed=True)
                for value in (packet.aileron, packet.elevator, packet.rudder)]
        if type(packet.rc_link) is not bool or type(packet.failsafe) is not bool:
            raise ProtocolError("link and failsafe must be boolean")
        return ",".join(map(str, ("FD1", "T", seq, uptime, throttle, *axes,
                                  _mode(packet.mode), int(packet.rc_link), int(packet.failsafe))))
    if isinstance(packet, ModeRequest):
        return f"FD1,C,{_command_id(packet.command_id)},SET_MODE,{_mode(packet.target_mode, target=True)}"
    if isinstance(packet, ModeAck):
        _command_id(packet.command_id)
        _mode(packet.actual_mode)
        if packet.result == "APPLIED" and packet.reason == "OK":
            pass
        elif packet.result == "REJECTED" and packet.reason in REJECTION_REASONS:
            pass
        else:
            raise ProtocolError("invalid result/reason combination")
        return f"FD1,A,{packet.command_id},{packet.result},{packet.actual_mode},{packet.reason}"
    raise ProtocolError("unknown packet type")


def encode(packet: Packet) -> bytes:
    payload = _payload(packet).encode("ascii")
    frame = b"$" + payload + b"*" + f"{crc16_ccitt_false(payload):04X}".encode("ascii") + b"\n"
    if len(frame) > MAX_FRAME_BYTES:
        raise ProtocolError("frame too long")
    return frame


def decode(frame: bytes) -> Packet:
    if not isinstance(frame, bytes) or not frame.endswith(b"\n") or len(frame) > MAX_FRAME_BYTES:
        raise ProtocolError("invalid frame length or terminator")
    line = frame[:-1]
    if line.endswith(b"\r"):
        line = line[:-1]
    if not line.startswith(b"$") or line.count(b"$") != 1 or line.count(b"*") != 1:
        raise ProtocolError("invalid delimiters")
    payload, checksum = line[1:].split(b"*", 1)
    if len(checksum) != 4 or not re.fullmatch(rb"[0-9A-F]{4}", checksum):
        raise ProtocolError("invalid CRC field")
    if len(payload) == 0 or any(octet < 0x21 or octet > 0x7E for octet in payload):
        raise ProtocolError("nonprintable payload")
    if crc16_ccitt_false(payload) != int(checksum, 16):
        raise ProtocolError("CRC mismatch")
    fields = payload.decode("ascii").split(",")
    if len(fields) < 2 or fields[0] != "FD1" or any(field == "" for field in fields):
        raise ProtocolError("wrong version or empty field")
    if fields[1] == "T" and len(fields) == 11:
        seq = _integer(fields[2], 0, 65535)
        uptime_ms = _integer(fields[3], 0, 4294967295)
        throttle = _integer(fields[4], 0, 1000)
        axes = [_integer(value, -1000, 1000, signed=True) for value in fields[5:8]]
        flags = [_integer(value, 0, 1) for value in fields[9:11]]
        return State(seq, uptime_ms, throttle, *axes, _mode(fields[8]), *map(bool, flags))
    if fields[1] == "C" and len(fields) == 5 and fields[3] == "SET_MODE":
        return ModeRequest(_command_id(fields[2]), _mode(fields[4], target=True))
    if fields[1] == "A" and len(fields) == 6:
        return _validated_ack(fields[2], fields[3], fields[4], fields[5])
    raise ProtocolError("unknown type or field count")


def _validated_ack(command_id: str, result: str, actual_mode: str, reason: str) -> ModeAck:
    packet = ModeAck(_command_id(command_id), result, _mode(actual_mode), reason)
    _payload(packet)  # Applies the strict status/reason pair validation.
    return packet
