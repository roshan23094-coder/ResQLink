ResQLink portal separation – minimal changes

What changed:
1. Opening the website now shows User Portal and Admin Portal.
2. User Portal contains only Request Ambulance and Scan RFID.
3. User ambulance requests are created with PENDING status. The user is not shown Accept/Reject controls and the ambulance is not marked en-route until an admin accepts.
4. Admin Portal retains the existing full monitoring dashboard and adds an auto-refreshing Ambulance Request Inbox with Accept and Reject actions.
5. RFID scans made from the User Portal are logged by the backend. Admin Portal shows scan time, UID, status and the linked patient details when identified.
6. Existing ECG, vitals, GPS, maps, hospital, patient records, alerts, handover and analytics dashboard code is retained.

Run:
- Start backend in Smart-Ambulance/server using the existing package scripts.
- Start frontend in Smart-Ambulance/client using npm run dev.
- The client uses the existing API_URL setting in App.jsx.
- Restart the backend after replacing the project files so the new request and RFID endpoints load.

Note:
Request and RFID scan history is currently held in backend memory, matching the existing in-memory request/patient data approach. It will reset if the backend process restarts. This change does not add database persistence or alter the existing hardware firmware.
