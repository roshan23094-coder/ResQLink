# ResQLink Module 2 — Intelligent Hospital Management

## Hybrid prototype approach
- Hospital names, geographic coordinates, and any available address/contact tags are discovered from OpenStreetMap (Overpass API).
- ICU/general bed counts, emergency department availability, special facilities, and ambulance acceptance are manually entered by the ResQLink prototype administrator.
- These manually entered values are explicitly labelled as prototype-managed data. They are not live hospital-system integrations and must not be treated as verified availability in real emergencies.

## API
- `GET /api/hospitals/management` — saved manual hospitals, plus nearby OpenStreetMap hospitals when a valid ambulance GPS fix exists.
- `GET /api/hospitals/management?latitude=<lat>&longitude=<lon>` — nearby hospital directory around supplied coordinates plus saved manual hospitals.
- `POST /api/hospitals/management` — create/update managed capacity and facility information. Required: `id`, `name`, `latitude`, `longitude`.
- `DELETE /api/hospitals/management/:id` — reset saved management details for a hospital; the OpenStreetMap listing remains discoverable.
- Existing `/api/nearby-hospitals` and `/api/nearest-hospital` responses now include managed hospital metadata when available.

Example POST body:
```json
{
  "id": "way/123456789",
  "name": "Example Hospital",
  "address": "Hassan, Karnataka",
  "latitude": 13.00,
  "longitude": 76.10,
  "emergencyDepartmentAvailable": true,
  "icuBedsAvailable": 4,
  "icuBedsTotal": 8,
  "generalBedsAvailable": 12,
  "generalBedsTotal": 40,
  "specialFacilities": ["Trauma", "ICU", "Cardiology"],
  "ambulanceAcceptance": "ACCEPTING"
}
```

## Prototype storage limitation
Managed data is written to `server/data/hospital-management.json` when the first record is saved. This is suitable for local prototype testing. A typical Render service filesystem is ephemeral across redeploys/restarts unless a persistent disk is configured. Before relying on saved hospital management data after deployment, migrate this store to PostgreSQL or configure persistent storage.

## Security limitation
The management endpoints are currently open for prototype use and do not include administrator authentication. Add role-based authentication/authorization before exposing these endpoints to a public production deployment.
