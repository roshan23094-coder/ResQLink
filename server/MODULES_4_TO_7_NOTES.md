# ResQLink Modules 4–7 — Integrated Prototype Additions

## Module 3 enhancement: Patient records
Patient directory and CRUD endpoints are provided by Module 3. Emergency snapshots preserve valid HR/SpO2 readings, temperature when present, recent raw ECG samples, ECG lead state, ambulance ID and timestamp. RFID lookup now searches the patient registry; an unknown UID returns UNKNOWN_CARD for manual temporary-record creation.

## Module 4: Dynamic route and traffic management
- Existing `GET /api/best-route` uses a valid ambulance GPS fix and OSRM road routing to recommend a real route to a nearby hospital.
- Existing nearest/nearby hospital endpoints remain in place.
- Live traffic congestion provider data is not integrated. Do not label road ETA as traffic-aware. Traffic-based alternatives can be added after selecting a supported provider/API and obtaining credentials.

## Module 5: Hospital pre-arrival notification
- `POST /api/hospital-notifications` creates a timestamped notification record with emergency/hospital IDs, ambulance, patient details when available, valid GPS coordinates and currently available vital readings.
- `GET /api/hospital-notifications` lists the prototype inbox.
- `POST /api/hospital-notifications/:id/acknowledge` records receiving staff acknowledgement.
- This is an internal ResQLink demo inbox, not a real hospital messaging integration.

## Module 6: AI-assisted patient risk assessment
- `GET /api/clinical/risk-assessment` evaluates valid HR and SpO2 readings, available temperature, and ECG lead/sample quality.
- Uses transparent demonstration thresholds and returns findings/reasons plus a disclaimer.
- This is not a diagnosis, clinically validated triage score, or ML model. A qualified clinical team must validate thresholds before real use.

## Module 7: Patient handover and ambulance transfer
- `POST /api/handovers` records emergency ID, patient ID, from/to ambulance, patient summary, current valid vital snapshot and recent ECG samples.
- `GET /api/handovers` lists transfers.
- `POST /api/handovers/:id/acknowledge` records receiving crew acknowledgement and adds a timeline event.
- The handover is a prototype workflow record; it does not automatically change the actual dispatch/fleet assignment state.

## Module 8: Analytics and emergency reports
- `GET /api/analytics/summary` returns recorded emergency-related events, ambulance status counts, hospital notification counts, event history, and average response time only when response-time samples exist.
- `POST /api/analytics/response-time` records a response-time sample.
- Frontend offers CSV download and browser print-to-PDF for the summary/event report.
- Average response time is not invented; it remains unavailable until response-time samples are recorded.

## Prototype data and security limitations
- New workflow stores use JSON files under `server/data/`. Render ephemeral filesystems can lose these records on restart/redeploy. Use PostgreSQL/persistent storage before relying on data.
- Patient and workflow endpoints are not authenticated/role-protected in this prototype. Do not expose real patient records or use this for real emergency dispatch until authentication, authorization, audit logging, secure storage, consent, retention and operational integrations are implemented.
- Hospital capacity remains manually maintained prototype data; OSM provides location discovery, not verified live bed counts.
