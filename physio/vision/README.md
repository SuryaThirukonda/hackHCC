# Vision Tracker

Person B owns this folder. The dashboard now supports browser webcam tracking
directly in the Real tab. This folder remains the optional Python OpenCV/
MediaPipe path for the right-arm raise demo.

Install dependencies:

```powershell
cd physio
python -m pip install -r backend\requirements.txt
```

Run the tracker:

```powershell
python vision\pose_tracker.py
```

The OpenCV window draws:

- shoulder, elbow, wrist, and hip landmarks from MediaPipe Pose
- 21 hand landmark points from MediaPipe Hands
- skeleton lines for the tracked arm
- current shoulder raise angle and elbow angle
- rep phase/count, pace, jitter, PhysioScore, and coach state
- a target zone around the configured target angle

The script also POSTs the drawn overlay frame to the backend so the React Real
tab displays the same tracking view in the large left panel.

Useful options:

```powershell
python vision\pose_tracker.py --side right --target-angle 90
python vision\pose_tracker.py --camera 1
python vision\pose_tracker.py --no-post
python vision\pose_tracker.py --no-sensor
python vision\pose_tracker.py --process-every 2
python vision\pose_tracker.py --self-test
python vision\angle_utils.py
```

Backend posting:

- Default backend URL: `http://localhost:8000`
- Override with: `--backend-url http://localhost:8000`
- Disable with: `--no-post`
- Packet endpoint: `POST /api/packets`
- Overlay frame endpoint: `POST /api/vision/frame`

Use the dashboard Real mode after this script is running. Mock mode stays
hardcoded/generated so the team can compare fake data against camera data.
