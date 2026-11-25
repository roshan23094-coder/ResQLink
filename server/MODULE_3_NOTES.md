# ResQLink Module 3 — Patient Digital Medical Records

## Implemented prototype features
- Patient directory with search by patient ID, name, or blood group.
- Create and update patient records.
- Patient identity fields: ID, name, age, blood group, phone, emergency contact.
- Medical context: known allergies, medical history, notes.
- RFID lookup against the registered patient directory. The default demo RFID scan looks up P1025.
- Unknown RFID UID returns `UNKNOWN_CARD`; crew can create a temporary patient record manually.
- Save an emergency snapshot to a patient's record, including currently valid heart rate and SpO2 values, available temperature, recent ECG samples, ECG lead status, ambulance ID and timestamp.
- Emergency history appears when a patient is selected.

## API endpoints
- `GET /api/patients?q=<search>` — list/search patient records.
- `GET /api/patients/:id` — retrieve one record.
- `POST /api/patients` — create a record. `id` is optional and generated if omitted.
- `PUT /api/patients/:id` — update a record.
- `POST /api/patients/:id/emergency-records` — save a timestamped emergency snapshot.
- `POST /api/rfid/scan` — look up the supplied `uid`/`patientId`, or the seeded demo P1025 when no UID is supplied.

## Prototype limitations and safety
- Records are stored in `server/data/patient-records.json`. This is local prototype storage; on Render, a normal ephemeral filesystem may lose changes after restart/redeploy. Move this to PostgreSQL or configure persistent storage before relying on it.
- The API currently has no authentication or role-based authorization. Do not expose real patient information publicly. Add authentication, access controls, audit logs, encryption, consent and retention controls before any real-world use.
- This is a student prototype, not a certified electronic health record. Only use fictional/test data unless appropriate consent and institutional safeguards are in place.
- Sensor values are saved only when backend validity flags indicate valid HR/SpO2. ECG is raw sample data, not a clinical interpretation. Temperature is included if available; its source/validity should be confirmed before clinical use.
