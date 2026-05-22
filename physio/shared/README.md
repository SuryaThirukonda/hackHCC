# Physio Shared Contracts

This folder is the integration contract for the project. Person A, Person B,
Person C, and the combining agent should treat `physio_packet_schema.json` as
the final shared packet shape.

Key contract files:

- `physio_packet_schema.json`: final live dashboard packet.
- `../backend/schemas.py`: Pydantic models that mirror this schema.

Do not add feature-specific fields to the packet unless every consumer can
ignore them safely.
