# Hardware Skeleton

Person A owns this folder.

Run the fake sensor server:

```powershell
cd physio\hardware
python fake_sensor_server.py
```

It serves:

```text
GET http://localhost:8010/sensor/latest
```

The real Raspberry Pi or microcontroller server should match the same JSON
contract. The backend and vision modules can continue working if this endpoint
is offline by treating sensor status as `offline`.
