# Firmware integration reference

This directory currently contains a **host-side UART reference codec** (`uart_reference.py`) and unit tests. It defines a bounded framed transport and validates fields. It is not an Arduino Nano flight controller, ESP32 sensor gateway, ESP32 network uploader, or firmware that has been flashed to hardware.

The Nano/ESP32 implementation should follow [UART v1](../docs/uart-protocol.md), with an explicit version, CRC, strict ranges, nonblocking read, telemetry freshness, and local failsafe independence. Do not port the Python reference blindly into a flight loop. Measure worst-case execution, memory, serial handling and servo timing on the chosen hardware. Keep 5 V Nano TX away from 3.3 V ESP32 RX without level shifting.

Run the transport reference tests from the repository root:

```bash
python3 -m unittest discover -s firmware -p 'test_*.py'
```

Before real telemetry is enabled, the ESP32 also needs MPU9250 calibration/fusion, BMP180 filtering/reference pressure, NEO-7 parser and fix validation, calibrated voltage divider, device authentication and a TLS-verified upload path. See [cloud integration](../docs/cloud-integration.md) and [safety](../docs/safety.md).

The dashboard now defines a staged mission package and acknowledgement interface, but this directory does not yet contain the NodeMCU downloader, mission UART transfer, Nano persistent storage, navigator or stabilization loops. Implement those only against the bounded [mission transfer contract](../docs/mission-planner.md), with propeller-free fault injection and manual/failsafe priority.
