from gpiozero import DistanceSensor
from time import sleep

# BCM GPIO numbers, not physical pin numbers
sensor = DistanceSensor(echo=23, trigger=24, max_distance=4)

while True:
    distance_cm = sensor.distance * 100
    print(f"Distance: {distance_cm:.2f} cm")
    sleep(0.1)