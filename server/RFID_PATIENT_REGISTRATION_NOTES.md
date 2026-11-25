# RFID + Manual Patient Registration

The Patient Digital Medical Records section supports two workflows:

1. **Registered RFID card:** ESP32 telemetry supplies the scanned UID in `patientId`/`rfidUid`. Press **Scan RFID card** in the dashboard. The backend matches that UID against `rfidUid` on a patient record and returns the complete record for auto-fill.
2. **New RFID card:** If the UID is not linked yet, the dashboard shows the UID and keeps it in the registration form. Enter the patient details and save; the UID is stored with the patient record. Future scans load that record.
3. **No RFID card:** Press **Register manually**, leave RFID UID blank, enter the details and save. Manual registration does not require an RFID reader.

RFID UIDs are unique across patient records. The backend no longer assumes a demo patient when no card has been scanned. A scan request without a UID returns `RFID_NOT_SCANNED`.

**Hardware requirement:** The ESP32 firmware must send the scanned card UID to the backend as `patientId` or `rfidUid` in its telemetry payload. The dashboard scan button reads the latest UID received by the backend; it does not physically activate the MFRC522 reader by itself.

This remains a prototype. Use test records only; add authentication, access controls, audit logging and secure persistent storage before real patient data or deployment.
