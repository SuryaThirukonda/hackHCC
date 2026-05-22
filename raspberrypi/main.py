import asyncio
import json
import websockets
from gpiozero import DistanceSensor

sensor = DistanceSensor(echo=23, trigger=24, max_distance=4)

clients = set()

async def websocket_handler(websocket):
    print("Client connected", flush=True)
    clients.add(websocket)

    try:
        await websocket.wait_closed()
    finally:
        clients.remove(websocket)
        print("Client disconnected", flush=True)

async def main():
    server = await websockets.serve(websocket_handler, "0.0.0.0", 8765)
    print("WebSocket server running on ws://0.0.0.0:8765", flush=True)

    while True:
        distance_cm = sensor.distance * 100

        print(f"Distance: {distance_cm:.2f} cm", flush=True)

        data = {
            "distance_cm": round(distance_cm, 2)
        }

        message = json.dumps(data)

        disconnected_clients = []

        for client in clients:
            try:
                await client.send(message)
            except:
                disconnected_clients.append(client)

        for client in disconnected_clients:
            clients.remove(client)

        await asyncio.sleep(0.1)

asyncio.run(main())