# Physio Exercise Visualizer Method

This document describes the method used for the Elbow Flexion / Extension preview so the same approach can be reused for future rehab demos.

## Goal

Use a clean clinical SVG instruction diagram instead of a realistic 3D arm. The visual should read like a physical therapy exercise card: simple, accurate, large, and unambiguous.

## Core Principle

Use one source of truth for both the drawing and the displayed angle.

For elbow flexion, define:

```js
const SHOULDER = { x: 210, y: 300 };
const ELBOW = { x: 420, y: 300 };
const FOREARM_LENGTH = 220;
const EXTENDED_ROTATION = 0;
const FLEXED_ROTATION = -90;
```

The moving forearm SVG group rotates around the elbow:

```jsx
<g transform={`rotate(${rotation} ${ELBOW.x} ${ELBOW.y})`}>
  <ForearmShape />
</g>
```

The wrist point is calculated from the exact same rotation:

```js
function pointAtRotation(rotationDegrees, length) {
  const radians = (rotationDegrees * Math.PI) / 180;
  return {
    x: ELBOW.x + length * Math.cos(radians),
    y: ELBOW.y + length * Math.sin(radians)
  };
}
```

The displayed elbow angle is the actual angle between:

- vector from elbow to shoulder
- vector from elbow to wrist

```js
function elbowAngleForRotation(rotationDegrees) {
  const wrist = pointAtRotation(rotationDegrees, FOREARM_LENGTH);
  const upperArmVector = { x: SHOULDER.x - ELBOW.x, y: SHOULDER.y - ELBOW.y };
  const forearmVector = { x: wrist.x - ELBOW.x, y: wrist.y - ELBOW.y };
  return Math.round(angleBetween(upperArmVector, forearmVector));
}
```

This prevents the angle text from drifting away from the visual arm position.

## SVG Coordinate Rules

SVG y-values increase downward. To bend the forearm upward, use a negative rotation.

For a side-view elbow diagram:

- upper arm remains fixed and horizontal
- elbow is the transform origin
- forearm rotates from `0 deg` to about `-90 deg`
- `0 deg` means arm straight
- `-90 deg` means about a right-angle bend

## Animation Timing

Use slow deterministic preview timing:

```text
EXTEND:      1.5 sec at 0 deg
BEND:        6.0 sec from 0 deg to -90 deg
HOLD:        2.5 sec at -90 deg
STRAIGHTEN:  8.0 sec from -90 deg to 0 deg
```

Use an ease-in-out function for bend and straighten so the motion does not snap.

## Diagram Anatomy

Keep the diagram abstract and clinical:

- torso/shoulder anchor: pale slate rounded block
- upper arm: dark rounded rectangle, fixed
- elbow: teal hinge circles
- forearm: dark rounded segment, rotating
- hand: small rounded block, no fingers
- ghosts: dashed extended position and translucent flexed target
- motion arc: teal arc generated from the same rotation endpoints

Avoid:

- skin tones
- red fingertip spheres
- realistic fingers
- 3D tubes
- isolated realistic body-part closeups

## Motion Arc

Generate arc endpoints from the same rotation model:

```js
function arcPath(startRotation, endRotation, radius) {
  const start = pointAtRotation(startRotation, radius);
  const end = pointAtRotation(endRotation, radius);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 0 ${end.x} ${end.y}`;
}
```

This keeps the guide arc consistent with the actual forearm path.

## Frame Safety

Before shipping a new visualizer, check the maximum moving-part bounds at the deepest bend:

```js
const wrist = pointAtRotation(FLEXED_ROTATION, FOREARM_LENGTH + HAND_LENGTH);
```

Ensure all x/y values stay inside the SVG `viewBox` with visible margin. If the arm clips, move the elbow farther from the nearest edge or shorten the forearm.

## Reusing For Another Exercise

For a new exercise:

1. Choose fixed anchor points.
2. Choose the moving joint origin.
3. Define the moving segment length.
4. Define start and target rotations.
5. Compute the displayed joint angle from vectors, not from an unrelated progress value.
6. Draw ghosts using the same moving segment and rotations.
7. Draw the motion arc from the same rotation endpoints.
8. Keep labels outside the moving anatomy.

The important rule: if a value appears on screen, derive it from the same geometry that draws the movement.
