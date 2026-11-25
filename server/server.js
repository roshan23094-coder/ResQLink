const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 5000;

// =====================================================
// PATIENT DIGITAL RECORDS (PROTOTYPE JSON STORAGE)
// =====================================================
const patientStorePath = path.join(__dirname, "data", "patient-records.json");
const DEMO_RFID_ASSIGNMENTS = {
  "F1 49 72 66": "P1001",
  "1A 3A 51 32": "P1002",
  "FD 98 B4 E3": "P1003",
  "87 C8 FA 2E": "P1004"
};

// Fictional demonstration records only. Replace with consented test data before any real use.
const seedPatients = [
  {
    id: "P1001", name: "Ramesh Kumar", age: 58, bloodGroup: "B+", phone: "9000001001",
    allergies: ["Penicillin (demo entry)"], medicalHistory: "Previous myocardial infarction (heart attack) recorded in 2022; regular cardiology follow-up; hypertension noted in demo history.",
    emergencyContact: "Demo contact: 9000002001", notes: "DEMO ONLY. Registered follow-up patient. Verify all history with the patient/authorized records.",
    rfidUid: "F1 49 72 66", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    emergencyRecords: [{ emergencyId: "DEMO-HX-1001", occurredAt: "2022-08-14T10:00:00.000Z", emergencyType: "PREVIOUS HEART ATTACK", notes: "Illustrative past event for demonstrating medical-history retrieval; not a real clinical record." }]
  },
  {
    id: "P1002", name: "Lakshmi Devi", age: 46, bloodGroup: "O+", phone: "9000001002",
    allergies: ["None reported (demo)"], medicalHistory: "Regular outpatient visits for diabetes follow-up and routine blood-glucose monitoring (demo history).",
    emergencyContact: "Demo contact: 9000002002", notes: "DEMO ONLY. Routine diagnosis/follow-up patient.",
    rfidUid: "1A 3A 51 32", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), emergencyRecords: []
  },
  {
    id: "P1003", name: "Arjun Shetty", age: 34, bloodGroup: "A+", phone: "9000001003",
    allergies: ["Dust (demo entry)"], medicalHistory: "Regular hospital visits for asthma review and respiratory symptom follow-up (demo history).",
    emergencyContact: "Demo contact: 9000002003", notes: "DEMO ONLY. Routine diagnosis/follow-up patient.",
    rfidUid: "FD 98 B4 E3", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), emergencyRecords: []
  },
  {
    id: "P1004", name: "Priya Nair", age: 63, bloodGroup: "AB+", phone: "9000001004",
    allergies: ["None reported (demo)"], medicalHistory: "Regular follow-up for hypertension and cardiac risk-factor review; no previous heart attack recorded in this illustrative profile.",
    emergencyContact: "Demo contact: 9000002004", notes: "DEMO ONLY. Routine follow-up patient.",
    rfidUid: "87 C8 FA 2E", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), emergencyRecords: []
  }
];

function readPatientRecords() {
  try {
    if (!fs.existsSync(patientStorePath)) return [...seedPatients];
    const parsed = JSON.parse(fs.readFileSync(patientStorePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [...seedPatients];
  } catch (error) {
    console.error("Patient record store read failed:", error.message);
    return [...seedPatients];
  }
}

let patientRecords = readPatientRecords();

function savePatientRecords() {
  fs.mkdirSync(path.dirname(patientStorePath), { recursive: true });
  fs.writeFileSync(patientStorePath, JSON.stringify(patientRecords, null, 2));
}

function normalizePatient(body, existing = {}) {
  const name = String(body.name ?? existing.name ?? "").trim();
  const ageValue = body.age ?? existing.age ?? null;
  const age = ageValue === "" || ageValue === null ? null : Number(ageValue);
  const bloodGroup = String(body.bloodGroup ?? existing.bloodGroup ?? "").trim().toUpperCase();
  const allergiesInput = body.allergies ?? existing.allergies ?? [];
  const allergies = Array.isArray(allergiesInput)
    ? allergiesInput.map(v => String(v).trim()).filter(Boolean)
    : String(allergiesInput).split(",").map(v => v.trim()).filter(Boolean);

  if (!name) throw new Error("Patient name is required.");
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
    throw new Error("Age must be a whole number between 0 and 120.");
  }
  if (bloodGroup && !/^(A|B|AB|O)[+-]$/.test(bloodGroup)) {
    throw new Error("Enter a valid blood group, such as O+ or AB-.");
  }

  return {
    ...existing,
    name,
    age,
    bloodGroup,
    phone: String(body.phone ?? existing.phone ?? "").trim(),
    allergies,
    medicalHistory: String(body.medicalHistory ?? existing.medicalHistory ?? "").trim(),
    emergencyContact: String(body.emergencyContact ?? existing.emergencyContact ?? "").trim(),
    notes: String(body.notes ?? existing.notes ?? "").trim(),
    rfidUid: String(body.rfidUid ?? existing.rfidUid ?? "").trim().toUpperCase(),
    updatedAt: new Date().toISOString()
  };
}



// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());
app.use(express.json());


// =====================================================
// HELPER â€” CALCULATE DISTANCE BETWEEN GPS LOCATIONS
// =====================================================

function calculateDistance(lat1, lon1, lat2, lon2) {

  const R = 6371;

  const dLat =
    (lat2 - lat1) * Math.PI / 180;

  const dLon =
    (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) *
      Math.sin(dLat / 2) +

    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *

    Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}


// =====================================================
// MULTIPLE AMBULANCES
// =====================================================

let ambulances = [

  {
    ambulanceId: "A-01",
    driverName: "Driver A",
    status: "AVAILABLE",
    latitude: 13.0072,
    longitude: 76.0962,
    currentPatient: null,
    assignedRequest: null
  },

  {
    ambulanceId: "A-02",
    driverName: "Driver B",
    status: "AVAILABLE",
    latitude: 13.0155,
    longitude: 76.0825,
    currentPatient: null,
    assignedRequest: null
  },

  {
    ambulanceId: "A-03",
    driverName: "Driver C",
    status: "BUSY",
    latitude: 12.9950,
    longitude: 76.1100,
    currentPatient: "P1025",
    assignedRequest: null
  }

];


// =====================================================
// MAIN SMART AMBULANCE DATA
// =====================================================

let ambulanceData = {

  ambulanceId: "A-01",

  heartRate: 0,
  heartRateValid: false,
  spo2: 0,
  spo2Valid: false,
  fingerDetected: false,
  vitalsLastUpdated: null,

  temperature: 36.8,

  // Latest AD8232 batch received from ESP32
  ecgRaw: 0,
  ecgLeadOff: true,
  ecgSampleRate: 100,
  ecgSamples: [],
  ecgLastUpdated: null,

  latitude: null,

  longitude: null,

  gpsValid: false,
  gpsSatellites: 0,
  gpsHdop: null,
  gpsLastUpdated: null,
  locationSource: "NO_FIX",

  emergency: false,

  rfidStatus: "NOT_SCANNED",
  rfidDetected: false,
  rfidLastUpdated: null,

  patientId: null,

  patientName: null,

  patientAge: null,

  patientBloodGroup: null,

  assistanceRequested: false,

  assistanceStatus: null

};


// =====================================================
// PUBLIC AMBULANCE REQUESTS
// =====================================================

let ambulanceRequests = [];
let rfidScanHistory = [];


// =====================================================
// DEMO PATIENT
// =====================================================

const demoPatient = {

  id: "P1025",

  name: "Demo Patient",

  age: 45,

  bloodGroup: "O+"

};


// =====================================================
// REAL HOSPITAL DISCOVERY (OPENSTREETMAP / OVERPASS)
// No demo hospital names, fabricated bed counts or traffic values.
// =====================================================

let hospitalCache = { at: 0, items: [] };
const HOSPITAL_CACHE_MS = 60_000;

async function discoverNearbyHospitals(latitude, longitude, radius = 15000) {
  if (
    hospitalCache.items.length &&
    Date.now() - hospitalCache.at < HOSPITAL_CACHE_MS
  ) {
    return hospitalCache.items.map(h => ({
      ...h,
      straightLineDistance: Number(
        calculateDistance(latitude, longitude, h.latitude, h.longitude).toFixed(2)
      )
    })).sort((a, b) => a.straightLineDistance - b.straightLineDistance);
  }

  const query = `
    [out:json][timeout:20];
    (
      node["amenity"="hospital"](around:${radius},${latitude},${longitude});
      way["amenity"="hospital"](around:${radius},${latitude},${longitude});
      relation["amenity"="hospital"](around:${radius},${latitude},${longitude});
      node["healthcare"="hospital"](around:${radius},${latitude},${longitude});
      way["healthcare"="hospital"](around:${radius},${latitude},${longitude});
      relation["healthcare"="hospital"](around:${radius},${latitude},${longitude});
    );
    out center tags;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "ResQLink-Educational-Prototype/1.0"
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    throw new Error(`OpenStreetMap hospital lookup failed (${response.status})`);
  }

  const payload = await response.json();
  const unique = new Map();

  for (const element of payload.elements || []) {
    const tags = element.tags || {};
    const lat = Number(element.lat ?? element.center?.lat);
    const lon = Number(element.lon ?? element.center?.lon);
    const name = String(tags.name || tags["name:en"] || "").trim();

    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const key = `${name.toLowerCase()}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (unique.has(key)) continue;

    unique.set(key, {
      id: `${element.type}/${element.id}`,
      name,
      latitude: lat,
      longitude: lon,
      address: [
        tags["addr:street"],
        tags["addr:suburb"],
        tags["addr:city"]
      ].filter(Boolean).join(", "),
      phone: tags.phone || tags["contact:phone"] || null,
      website: tags.website || tags["contact:website"] || null,
      source: "OpenStreetMap"
    });
  }

  const hospitalRecords = [...unique.values()];

  hospitalCache = {
    at: Date.now(),
    items: hospitalRecords
  };

  return hospitalRecords.map(h => ({
    ...h,
    straightLineDistance: Number(
      calculateDistance(latitude, longitude, h.latitude, h.longitude).toFixed(2)
    )
  })).sort((a, b) => a.straightLineDistance - b.straightLineDistance);
}

async function getRoadRoute(fromLat, fromLon, toLat, toLon) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLon},${fromLat};${toLon},${toLat}?overview=false`;

  const response = await fetch(url, {
    headers: { "User-Agent": "ResQLink-Educational-Prototype/1.0" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) throw new Error(`Routing service failed (${response.status})`);

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) throw new Error("No drivable route found.");

  return {
    distance: Number((route.distance / 1000).toFixed(2)),
    estimatedTime: Math.max(1, Math.round(route.duration / 60)),
    source: "OSRM road routing"
  };
}

function getValidAmbulanceLocation() {
  const lat = Number(ambulanceData.latitude);
  const lon = Number(ambulanceData.longitude);

  if (
    ambulanceData.gpsValid !== true ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    (lat === 0 && lon === 0)
  ) {
    return null;
  }

  return { latitude: lat, longitude: lon };
}


// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {

  res.json({

    message:
      "ðŸš‘ Smart Ambulance Server is running",

    status:
      "ONLINE",

    hospitalManagement:
      "Real OpenStreetMap hospital listings with manually maintained prototype capacity data",

    port:
      PORT

  });

});


// =====================================================
// GET MAIN AMBULANCE DATA
// =====================================================

app.get(
  "/api/ambulance",
  (req, res) => {

    res.json(
      ambulanceData
    );

  }
);


// =====================================================
// REQUESTER LOCATION (BROWSER GPS) â€” SEPARATE FROM AMBULANCE GPS
// =====================================================

let requesterLocation = null;

app.post("/api/location/requester", (req, res) => {

  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = Number(req.body.accuracy);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid requester location."
    });
  }

  requesterLocation = {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    source: "BROWSER_GEOLOCATION",
    updatedAt: new Date().toISOString()
  };

  return res.json({
    success: true,
    message: "Requester location received.",
    location: requesterLocation
  });

});

app.get("/api/location/requester", (req, res) => {
  res.json({ success: true, location: requesterLocation });
});


// =====================================================
// GET ALL AMBULANCES
// =====================================================

app.get(
  "/api/ambulances",
  (req, res) => {

    res.json({

      success: true,

      ambulances

    });

  }
);


// =====================================================
// PUBLIC REQUEST AMBULANCE
// =====================================================

app.post(
  "/api/ambulance/request",
  (req, res) => {

    console.log();

    console.log(
      "=========================================="
    );

    console.log(
      "ðŸš¨ NEW PUBLIC AMBULANCE REQUEST"
    );

    console.log(
      "=========================================="
    );


    const {

      patientName,

      phone,

      age,

      emergencyType,

      description,

      latitude,

      longitude

    } = req.body;


    // -------------------------------------------------
    // VALIDATION
    // -------------------------------------------------

    if (

      !patientName ||

      !phone ||

      latitude === undefined ||

      longitude === undefined

    ) {

      return res.status(400).json({

        success: false,

        message:
          "Patient name, phone number and location are required."

      });

    }


    const patientLatitude =
      Number(latitude);

    const patientLongitude =
      Number(longitude);


    if (

      Number.isNaN(
        patientLatitude
      ) ||

      Number.isNaN(
        patientLongitude
      )

    ) {

      return res.status(400).json({

        success: false,

        message:
          "Invalid GPS coordinates."

      });

    }


    // -------------------------------------------------
    // FIND AVAILABLE AMBULANCES
    // -------------------------------------------------

    const availableAmbulances =
      ambulances.filter(
        (ambulance) =>
          ambulance.status ===
          "AVAILABLE"
      );


    if (
      availableAmbulances.length === 0
    ) {

      console.log(
        "âŒ No available ambulance"
      );

      return res.status(503).json({

        success: false,

        message:
          "No ambulance is currently available. Please call 108 for immediate emergency assistance.",

        status:
          "NO_AMBULANCE_AVAILABLE"

      });

    }


    // -------------------------------------------------
    // CALCULATE DISTANCE
    // -------------------------------------------------

    const ambulancesWithDistance =
      availableAmbulances.map(
        (ambulance) => {

          const distance =
            calculateDistance(

              patientLatitude,

              patientLongitude,

              ambulance.latitude,

              ambulance.longitude

            );

          return {

            ...ambulance,

            distance:
              Number(
                distance.toFixed(2)
              )

          };

        }
      );


    // -------------------------------------------------
    // SORT BY DISTANCE
    // -------------------------------------------------

    ambulancesWithDistance.sort(
      (a, b) =>
        a.distance -
        b.distance
    );


    // -------------------------------------------------
    // SELECT NEAREST AMBULANCE
    // -------------------------------------------------

    const selectedAmbulance =
      ambulancesWithDistance[0];


    // -------------------------------------------------
    // CREATE REQUEST ID
    // -------------------------------------------------

    const requestId =
      `REQ-${Date.now()
        .toString()
        .slice(-6)}`;


    // -------------------------------------------------
    // CREATE REQUEST
    // -------------------------------------------------

    const request = {

      requestId,

      patientName,

      phone,

      age:
        age || null,

      emergencyType:
        emergencyType ||
        "Medical Emergency",

      description:
        description || "",

      latitude:
        patientLatitude,

      longitude:
        patientLongitude,

      status:
        "PENDING",

      ambulanceId:
        selectedAmbulance.ambulanceId,

      ambulanceDistance:
        selectedAmbulance.distance,

      requestedAt:
        new Date().toISOString()

    };


    // -------------------------------------------------
    // STORE REQUEST
    // -------------------------------------------------

    ambulanceRequests.push(
      request
    );

    addEmergencyEvent("AMBULANCE_REQUEST_CREATED", {
      emergencyId: requestId,
      ambulanceId: selectedAmbulance.ambulanceId,
      emergencyType,
      requestedAt: request.requestedAt
    });


    // -------------------------------------------------
    // UPDATE SELECTED AMBULANCE
    // -------------------------------------------------

    const selectedIndex =
      ambulances.findIndex(
        (ambulance) =>
          ambulance.ambulanceId ===
          selectedAmbulance.ambulanceId
      );


    if (
      selectedIndex !== -1
    ) {

      ambulances[
        selectedIndex
      ].status =
        "RESERVED";

      ambulances[
        selectedIndex
      ].assignedRequest =
        requestId;

      ambulances[
        selectedIndex
      ].currentPatient =
        patientName;

    }


    // -------------------------------------------------
    // UPDATE MAIN AMBULANCE DATA
    // -------------------------------------------------

    ambulanceData.ambulanceId =
      selectedAmbulance.ambulanceId;

    ambulanceData.emergency =
      false;

    ambulanceData.patientId =
      `EMG-${Date.now()
        .toString()
        .slice(-6)}`;

    ambulanceData.patientName =
      patientName;

    ambulanceData.patientAge =
      age || null;

    ambulanceData.rfidStatus =
      "NOT_REGISTERED";

    ambulanceData.assistanceRequested =
      false;

    ambulanceData.assistanceStatus =
      "AMBULANCE_REQUEST_PENDING_ADMIN_APPROVAL";


    // -------------------------------------------------
    // SERVER LOG
    // -------------------------------------------------

    console.log(
      "Patient:",
      patientName
    );

    console.log(
      "Phone:",
      phone
    );

    console.log(
      "Emergency:",
      emergencyType
    );

    console.log(
      "Patient Location:",
      patientLatitude,
      patientLongitude
    );

    console.log(
      "Available Ambulances:",
      availableAmbulances.length
    );

    console.log(
      "ðŸš‘ SELECTED:",
      selectedAmbulance.ambulanceId
    );

    console.log(
      "ðŸ“ Distance:",
      selectedAmbulance.distance,
      "km"
    );

    console.log(
      "Status:",
      "PENDING"
    );

    console.log(
      "=========================================="
    );


    // -------------------------------------------------
    // RESPONSE
    // -------------------------------------------------

    res.json({

      success: true,

      message:
        "Ambulance request received and is waiting for admin approval.",

      requestId:

        requestId,

      status:
        "PENDING",

      ambulance: {

        ambulanceId:
          selectedAmbulance.ambulanceId,

        driverName:
          selectedAmbulance.driverName,

        distance:
          selectedAmbulance.distance,

        status:
          "PENDING"

      },

      request

    });

  }
);


// =====================================================
// GET ALL REQUESTS
// =====================================================

app.get(
  "/api/ambulance/requests",
  (req, res) => {

    res.json({

      success: true,

      count:
        ambulanceRequests.length,

      requests:
        ambulanceRequests

    });

  }
);


// =====================================================
// GET SINGLE REQUEST
// =====================================================

app.get(
  "/api/ambulance/request/:requestId",
  (req, res) => {

    const request =
      ambulanceRequests.find(
        (item) =>
          item.requestId ===
          req.params.requestId
      );


    if (!request) {

      return res.status(404).json({

        success: false,

        message:
          "Request not found."

      });

    }


    res.json({

      success: true,

      request

    });

  }
);


// =====================================================
// ACCEPT AMBULANCE REQUEST
// =====================================================

app.post(
  "/api/ambulance/request/accept",
  (req, res) => {

    const {
      requestId
    } = req.body;


    if (!requestId) {

      return res.status(400).json({

        success: false,

        message:
          "Request ID is required."

      });

    }


    const request =
      ambulanceRequests.find(
        (item) =>
          item.requestId ===
          requestId
      );


    if (!request) {

      return res.status(404).json({

        success: false,

        message:
          "Request not found."

      });

    }


    if (
      request.status ===
      "ACCEPTED"
    ) {

      return res.json({

        success: true,

        message:
          "Request is already accepted.",

        request

      });

    }


    request.status =
      "ACCEPTED";


    const ambulance =
      ambulances.find(
        (item) =>
          item.ambulanceId ===
          request.ambulanceId
      );


    if (ambulance) {

      ambulance.status =
        "EN_ROUTE";

    }


    ambulanceData.assistanceStatus =
      "EN_ROUTE";

    ambulanceData.emergency =
      true;


    console.log();

    console.log(
      "=========================================="
    );

    console.log(
      "âœ… AMBULANCE REQUEST ACCEPTED"
    );

    console.log(
      "Request:",
      requestId
    );

    console.log(
      "Ambulance:",
      request.ambulanceId
    );

    console.log(
      "Status: EN_ROUTE"
    );

    console.log(
      "=========================================="
    );


    res.json({

      success: true,

      message:
        "Ambulance accepted the request and is now en route.",

      request,

      ambulance

    });

  }
);


// =====================================================
// UPDATE AMBULANCE STATUS
// =====================================================

app.post(
  "/api/ambulance/status",
  (req, res) => {

    const {

      ambulanceId,

      status

    } = req.body;


    const validStatuses = [

      "AVAILABLE",

      "BUSY",

      "ASSIGNED",

      "EN_ROUTE",

      "OFFLINE"

    ];


    if (
      !validStatuses.includes(
        status
      )
    ) {

      return res.status(400).json({

        success: false,

        message:
          "Invalid ambulance status."

      });

    }


    const ambulance =
      ambulances.find(
        (item) =>
          item.ambulanceId ===
          ambulanceId
      );


    if (!ambulance) {

      return res.status(404).json({

        success: false,

        message:
          "Ambulance not found."

      });

    }


    ambulance.status =
      status;


    console.log(
      `ðŸš‘ ${ambulanceId} STATUS â†’ ${status}`
    );


    res.json({

      success: true,

      ambulance

    });

  }
);


// =====================================================
// UPDATE AMBULANCE GPS
// =====================================================

app.post(
  "/api/ambulance/location",
  (req, res) => {

    const {

      ambulanceId,

      latitude,

      longitude

    } = req.body;


    const ambulance =
      ambulances.find(
        (item) =>
          item.ambulanceId ===
          ambulanceId
      );


    if (!ambulance) {

      return res.status(404).json({

        success: false,

        message:
          "Ambulance not found."

      });

    }


    const newLatitude =
      Number(latitude);

    const newLongitude =
      Number(longitude);


    if (

      Number.isNaN(
        newLatitude
      ) ||

      Number.isNaN(
        newLongitude
      )

    ) {

      return res.status(400).json({

        success: false,

        message:
          "Invalid GPS coordinates."

      });

    }


    ambulance.latitude =
      newLatitude;

    ambulance.longitude =
      newLongitude;


    if (
      ambulanceId ===
      ambulanceData.ambulanceId
    ) {

      ambulanceData.latitude =
        newLatitude;

      ambulanceData.longitude =
        newLongitude;

    }


    res.json({

      success: true,

      message:
        "Ambulance location updated.",

      ambulance

    });

  }
);


// =====================================================
// ESP32 â†’ NODE.JS
// RECEIVE SENSOR DATA
// =====================================================

app.post(
  "/api/ambulance/update",
  (req, res) => {

    console.log();

    console.log(
      "=========================================="
    );

    console.log(
      "ðŸ“¡ DATA RECEIVED FROM ESP32"
    );

    console.log(
      "=========================================="
    );


    const data =
      req.body;


    // -------------------------------------------------
    // AMBULANCE ID
    // -------------------------------------------------

    if (
      data.ambulanceId
    ) {

      ambulanceData.ambulanceId =
        data.ambulanceId;

    }


    // -------------------------------------------------
    // HEART RATE
    // -------------------------------------------------

    // Accept only explicitly valid, plausible sensor results. A zero or
    // malformed value must never be presented as a measured vital sign.
    const fingerPresent = data.fingerDetected === true;
    ambulanceData.fingerDetected = fingerPresent;

    const incomingHR = Number(data.heartRate);
    const hrFlag = data.heartRateValid === true ||
      (data.heartRateValid === undefined && Number.isFinite(incomingHR));
    if (fingerPresent && hrFlag && Number.isFinite(incomingHR) &&
        incomingHR >= 40 && incomingHR <= 180) {
      ambulanceData.heartRate = Math.round(incomingHR);
      ambulanceData.heartRateValid = true;
      ambulanceData.vitalsLastUpdated = new Date().toISOString();
    } else {
      ambulanceData.heartRate = 0;
      ambulanceData.heartRateValid = false;
    }

    // -------------------------------------------------
    // SPO2
    // -------------------------------------------------
    const incomingSpO2 = Number(data.spo2);
    const spo2Flag = data.spo2Valid === true ||
      (data.spo2Valid === undefined && Number.isFinite(incomingSpO2));
    if (fingerPresent && spo2Flag && Number.isFinite(incomingSpO2) &&
        incomingSpO2 >= 85 && incomingSpO2 <= 100) {
      ambulanceData.spo2 = Math.round(incomingSpO2);
      ambulanceData.spo2Valid = true;
      ambulanceData.vitalsLastUpdated = new Date().toISOString();
    } else {
      ambulanceData.spo2 = 0;
      ambulanceData.spo2Valid = false;
    }


    // -------------------------------------------------
    // TEMPERATURE
    // -------------------------------------------------

    if (
      data.temperature !== undefined
    ) {

      ambulanceData.temperature =
        Number(
          data.temperature
        );

    }


    // -------------------------------------------------
    // AD8232 ECG TELEMETRY
    // -------------------------------------------------

    if (data.ecgRaw !== undefined) {
      const raw = Number(data.ecgRaw);
      if (Number.isFinite(raw)) {
        ambulanceData.ecgRaw = Math.max(0, Math.min(4095, Math.round(raw)));
      }
    }

    if (typeof data.ecgLeadOff === "boolean") {
      ambulanceData.ecgLeadOff = data.ecgLeadOff;
    }

    if (data.ecgSampleRate !== undefined) {
      const rate = Number(data.ecgSampleRate);
      if (Number.isFinite(rate) && rate > 0 && rate <= 1000) {
        ambulanceData.ecgSampleRate = rate;
      }
    }

    if (Array.isArray(data.ecgSamples)) {
      // Keep only a recent, bounded batch of valid ESP32 ADC samples.
      ambulanceData.ecgSamples = data.ecgSamples
        .slice(-250)
        .map(Number)
        .filter(value => Number.isFinite(value))
        .map(value => Math.max(0, Math.min(4095, Math.round(value))));
      ambulanceData.ecgLastUpdated = new Date().toISOString();
    }


    // -------------------------------------------------
    // GPS STATUS AND VALIDATED AMBULANCE COORDINATES
    // -------------------------------------------------

    if (typeof data.gpsValid === "boolean") {
      ambulanceData.gpsValid = data.gpsValid;
      ambulanceData.locationSource = data.gpsValid
        ? "ESP32_GPS"
        : "NO_FIX";
    }

    if (data.gpsSatellites !== undefined) {
      ambulanceData.gpsSatellites =
        Math.max(0, Number(data.gpsSatellites) || 0);
    }

    if (data.gpsHdop !== undefined) {
      const hdop = Number(data.gpsHdop);
      ambulanceData.gpsHdop = Number.isFinite(hdop) ? hdop : null;
    }

    // Backward compatibility: older firmware that sends coordinates
    // without gpsValid is treated as having a coordinate fix.
    const hasCoordinates =
      data.latitude !== undefined && data.longitude !== undefined;
    const reportedFix = data.gpsValid === true ||
      (data.gpsValid === undefined && hasCoordinates);

    if (reportedFix && hasCoordinates) {
      const lat = Number(data.latitude);
      const lon = Number(data.longitude);
      const validCoordinates =
        Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180 &&
        !(lat === 0 && lon === 0);

      if (validCoordinates) {
        ambulanceData.latitude = lat;
        ambulanceData.longitude = lon;
        ambulanceData.gpsValid = true;
        ambulanceData.locationSource = "ESP32_GPS";
        ambulanceData.gpsLastUpdated = new Date().toISOString();

        const activeAmbulance = ambulances.find(
          item => item.ambulanceId === ambulanceData.ambulanceId
        );
        if (activeAmbulance) {
          activeAmbulance.latitude = lat;
          activeAmbulance.longitude = lon;
        }
      } else {
        ambulanceData.gpsValid = false;
        ambulanceData.locationSource = "INVALID_FIX";
      }
    }


    // -------------------------------------------------
    // EMERGENCY
    // -------------------------------------------------

    if (
      data.emergency !== undefined
    ) {

      ambulanceData.emergency =
        Boolean(
          data.emergency
        );


      if (
        ambulanceData.emergency
      ) {

        ambulanceData.assistanceRequested =
          true;

        ambulanceData.assistanceStatus =
          "REQUESTED";


        console.log(
          "ðŸš¨ EMERGENCY RECEIVED"
        );

        console.log(
          "ðŸš‘ Inter-ambulance assistance requested"
        );

      }

    }


    // -------------------------------------------------
    // RFID / PATIENT IDENTIFICATION FROM ESP32
    // -------------------------------------------------

    const incomingRFID =
      (typeof data.patientId === "string" && data.patientId.trim()) ||
      (typeof data.rfidUid === "string" && data.rfidUid.trim()) ||
      null;

    // Accept the UID whenever it is present; this also supports older firmware
    // that may not send rfidDetected as a separate boolean.
    if (incomingRFID) {
      ambulanceData.patientId = incomingRFID.trim().toUpperCase();
      ambulanceData.rfidStatus = "IDENTIFIED";
      ambulanceData.rfidDetected = true;
      ambulanceData.rfidLastUpdated = new Date().toISOString();
      console.log("RFID UID ACCEPTED FROM ESP32:", ambulanceData.patientId);
    } else if (
      data.rfidStatus === "NOT_SCANNED" ||
      data.rfidDetected === false
    ) {
      ambulanceData.rfidStatus = "NOT_SCANNED";
      ambulanceData.rfidDetected = false;
      ambulanceData.patientId = null;
      ambulanceData.patientName = null;
      ambulanceData.patientAge = null;
      ambulanceData.patientBloodGroup = null;
    }

    // -------------------------------------------------
    // PATIENT NAME
    // -------------------------------------------------

    if (
      data.patientName
    ) {

      ambulanceData.patientName =
        data.patientName;

    }


    // -------------------------------------------------
    // PATIENT AGE
    // -------------------------------------------------

    if (
      data.patientAge !== undefined
    ) {

      ambulanceData.patientAge =
        data.patientAge;

    }


    // -------------------------------------------------
    // PATIENT BLOOD GROUP
    // -------------------------------------------------

    if (
      data.patientBloodGroup
    ) {

      ambulanceData.patientBloodGroup =
        data.patientBloodGroup;

    }


    // -------------------------------------------------
    // SYNCHRONIZE AMBULANCE LOCATION
    // -------------------------------------------------

    const currentAmbulance =
      ambulances.find(
        (item) =>
          item.ambulanceId ===
          ambulanceData.ambulanceId
      );


    if (currentAmbulance) {

      currentAmbulance.latitude =
        ambulanceData.latitude;

      currentAmbulance.longitude =
        ambulanceData.longitude;

    }


    // -------------------------------------------------
    // LOG SENSOR DATA
    // -------------------------------------------------

    console.log(
      "Ambulance:",
      ambulanceData.ambulanceId
    );

    console.log(
      "Heart Rate:",
      ambulanceData.heartRate,
      "BPM"
    );

    console.log(
      "SpO2:",
      ambulanceData.spo2,
      "%"
    );

    console.log(
      "ECG:",
      ambulanceData.ecgSamples.length,
      "samples | Leads:",
      ambulanceData.ecgLeadOff ? "OFF" : "CONNECTED"
    );

    console.log(
      "Temperature:",
      ambulanceData.temperature,
      "Â°C"
    );

    console.log(
      "Location:",
      ambulanceData.latitude,
      ambulanceData.longitude
    );

    console.log(
      "Emergency:",
      ambulanceData.emergency
    );

    console.log(
      "RFID Status:",
      ambulanceData.rfidStatus
    );

    console.log(
      "Patient RFID UID:",
      ambulanceData.patientId || "NOT SCANNED"
    );

    console.log(
      "=========================================="
    );


    res.json({

      success: true,

      message:
        "ESP32 data received successfully",

      rfid: {
        status: ambulanceData.rfidStatus,
        uid: ambulanceData.patientId
      },

      ambulance:
        ambulanceData

    });

  }
);


// =====================================================
// =====================================================
// REJECT AMBULANCE REQUEST (ADMIN PORTAL)
// =====================================================
app.post("/api/ambulance/request/reject", (req, res) => {
  const requestId = String(req.body?.requestId || "");
  if (!requestId) return res.status(400).json({ success: false, message: "Request ID is required." });
  const request = ambulanceRequests.find(item => item.requestId === requestId);
  if (!request) return res.status(404).json({ success: false, message: "Request not found." });
  if (request.status === "ACCEPTED") return res.status(409).json({ success: false, message: "Accepted requests cannot be rejected." });
  request.status = "REJECTED";
  request.rejectedAt = new Date().toISOString();
  const assignedAmbulance = ambulances.find(item => item.ambulanceId === request.ambulanceId);
  if (assignedAmbulance && assignedAmbulance.status === "RESERVED") {
    assignedAmbulance.status = "AVAILABLE";
    assignedAmbulance.assignedRequest = null;
    assignedAmbulance.currentPatient = null;
  }
  addEmergencyEvent("AMBULANCE_REQUEST_REJECTED", { emergencyId: requestId, ambulanceId: request.ambulanceId });
  return res.json({ success: true, message: "Ambulance request rejected.", request });
});

// RFID SCAN
// =====================================================

app.get("/api/rfid/scans", (req, res) => {
  res.json({ success: true, count: rfidScanHistory.length, scans: rfidScanHistory });
});

app.post(
  "/api/rfid/scan",
  (req, res) => {
    const requestedUid = String(
      req.body?.uid || req.body?.rfidUid ||
      (ambulanceData.rfidDetected ? ambulanceData.patientId : "") || ""
    ).trim().toUpperCase();

    if (!requestedUid) {
      rfidScanHistory.push({ uid: null, status: "NOT_SCANNED", patient: null, scannedAt: new Date().toISOString() });
      rfidScanHistory = rfidScanHistory.slice(-100);
      return res.status(409).json({
        success: false,
        code: "RFID_NOT_SCANNED",
        message: "No RFID UID received yet. Scan a card or choose manual registration.",
        rfid: { status: "NOT_SCANNED", uid: null }
      });
    }

    const record = patientRecords.find(p =>
      String(p.rfidUid || "").toUpperCase() === requestedUid ||
      String(p.id || "").toUpperCase() === requestedUid
    );

    if (!record) {
      rfidScanHistory.push({ uid: requestedUid, status: "UNKNOWN_CARD", patient: null, scannedAt: new Date().toISOString() });
      rfidScanHistory = rfidScanHistory.slice(-100);
      ambulanceData.rfidStatus = "UNKNOWN_CARD";
      ambulanceData.rfidDetected = true;
      ambulanceData.patientId = requestedUid;
      return res.status(404).json({
        success: false,
        message: "Unrecognized RFID card. ResQLink uses only the four pre-assigned registered-patient cards. For patients without a registered card, use Manual Registration; no new RFID card will be issued.",
        rfid: { status: "UNKNOWN_CARD", uid: requestedUid }
      });
    }

    rfidScanHistory.push({
      uid: requestedUid,
      status: "IDENTIFIED",
      patient: {
        id: record.id, name: record.name, age: record.age,
        bloodGroup: record.bloodGroup, phone: record.phone,
        allergies: record.allergies, medicalHistory: record.medicalHistory,
        emergencyContact: record.emergencyContact
      },
      scannedAt: new Date().toISOString()
    });
    rfidScanHistory = rfidScanHistory.slice(-100);
    ambulanceData.rfidStatus = "IDENTIFIED";
    ambulanceData.rfidDetected = true;
    ambulanceData.rfidLastUpdated = new Date().toISOString();
    ambulanceData.patientId = record.id;
    ambulanceData.patientName = record.name;
    ambulanceData.patientAge = record.age;
    ambulanceData.patientBloodGroup = record.bloodGroup;

    res.json({ success: true, patient: record, rfid: { status: "IDENTIFIED", uid: requestedUid }, message: "Patient record retrieved." });
  }
);


// =====================================================
// NEAREST REAL HOSPITAL â€” REQUIRES VALID ESP32 GPS FIX
// =====================================================

app.get("/api/nearby-hospitals", async (req, res) => {
  try {
    const location = getValidAmbulanceLocation();
    if (!location) {
      return res.status(409).json({
        success: false,
        code: "AMBULANCE_GPS_NO_FIX",
        message: "Waiting for a valid NEO-6M GPS fix from the ambulance."
      });
    }

    const hospitals = await discoverNearbyHospitals(
      location.latitude,
      location.longitude
    );

    return res.json({
      success: true,
      source: "OpenStreetMap",
      count: hospitals.length,
      hospitals: hospitals.map(mergeHospitalManagement)
    });
  } catch (error) {
    console.error("Nearby hospital lookup failed:", error.message);
    return res.status(502).json({
      success: false,
      message: "Unable to retrieve real hospital data right now."
    });
  }
});

app.get("/api/nearest-hospital", async (req, res) => {
  try {
    const location = getValidAmbulanceLocation();
    if (!location) {
      return res.status(409).json({
        success: false,
        code: "AMBULANCE_GPS_NO_FIX",
        message: "No valid ambulance GPS fix. Hospital search is paused."
      });
    }

    const hospitals = await discoverNearbyHospitals(
      location.latitude,
      location.longitude
    );

    if (!hospitals.length) {
      return res.status(404).json({
        success: false,
        code: "NO_HOSPITALS_FOUND",
        message: "No named hospitals were found in the 15 km search area."
      });
    }

    const nearest = hospitals[0];
    let roadRoute = null;

    try {
      roadRoute = await getRoadRoute(
        location.latitude,
        location.longitude,
        nearest.latitude,
        nearest.longitude
      );
    } catch (routeError) {
      console.warn("Road route unavailable:", routeError.message);
    }

    const nearestHospital = {
      ...mergeHospitalManagement(nearest),
      distance: roadRoute?.distance ?? nearest.straightLineDistance,
      distanceType: roadRoute ? "ROAD_DISTANCE" : "STRAIGHT_LINE_ESTIMATE",
      estimatedTime: roadRoute?.estimatedTime ?? null,
      traffic: null,
      availableBeds: null,
      routeSource: roadRoute?.source ?? null
    };

    return res.json({
      success: true,
      source: "OpenStreetMap",
      ambulanceLocation: location,
      nearestHospital,
      hospitals: hospitals.map(mergeHospitalManagement)
    });
  } catch (error) {
    console.error("Nearest hospital lookup failed:", error.message);
    return res.status(502).json({
      success: false,
      message: "Unable to retrieve real hospital data right now."
    });
  }
});


// =====================================================
// BEST ROUTE â€” REAL ROAD ROUTE TO NEAREST OSM HOSPITAL
// =====================================================

app.get("/api/best-route", async (req, res) => {
  try {
    const location = getValidAmbulanceLocation();
    if (!location) {
      return res.status(409).json({
        success: false,
        code: "AMBULANCE_GPS_NO_FIX",
        message: "A valid ESP32 GPS fix is required before routing."
      });
    }

    const hospitals = await discoverNearbyHospitals(
      location.latitude,
      location.longitude
    );

    if (!hospitals.length) {
      return res.status(404).json({
        success: false,
        message: "No real hospitals found nearby."
      });
    }

    const candidates = await Promise.all(
      hospitals.slice(0, 8).map(async hospital => {
        try {
          const route = await getRoadRoute(
            location.latitude,
            location.longitude,
            hospital.latitude,
            hospital.longitude
          );
          return { ...hospital, ...route };
        } catch {
          return null;
        }
      })
    );

    const reachable = candidates
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);

    if (!reachable.length) {
      return res.status(502).json({
        success: false,
        message: "Real hospital data was found, but road routing is unavailable."
      });
    }

    const best = reachable[0];

    return res.json({
      success: true,
      route: {
        destination: best.name,
        latitude: best.latitude,
        longitude: best.longitude,
        address: best.address,
        distance: best.distance,
        estimatedTime: best.estimatedTime,
        distanceType: "ROAD_DISTANCE",
        routeSource: best.source,
        hospitalSource: best.source === "OpenStreetMap" ? "OpenStreetMap" : "OpenStreetMap",
        traffic: null,
        availableBeds: null,
        mapUrl: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${location.latitude}%2C${location.longitude}%3B${best.latitude}%2C${best.longitude}`
      }
    });
  } catch (error) {
    console.error("Best route calculation failed:", error.message);
    return res.status(502).json({
      success: false,
      message: "Unable to calculate a real road route right now."
    });
  }
});



// =====================================================
// HOSPITAL MANAGEMENT â€” HYBRID PROTOTYPE DATA
// Real hospital identity/location comes from OpenStreetMap.
// Bed counts, facilities and acceptance are manually managed
// prototype values and are NOT verified live hospital capacity.
// =====================================================

const hospitalDataDirectory = path.join(__dirname, "data");
const hospitalDataFile = path.join(hospitalDataDirectory, "hospital-management.json");

function readManagedHospitalData() {
  try {
    if (!fs.existsSync(hospitalDataFile)) return {};
    const parsed = JSON.parse(fs.readFileSync(hospitalDataFile, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error("Could not read hospital management data:", error.message);
    return {};
  }
}

let managedHospitalData = readManagedHospitalData();

function saveManagedHospitalData() {
  fs.mkdirSync(hospitalDataDirectory, { recursive: true });
  fs.writeFileSync(hospitalDataFile, JSON.stringify(managedHospitalData, null, 2));
}

function mergeHospitalManagement(hospital) {
  const managed = managedHospitalData[hospital.id] || {};
  return {
    ...hospital,
    emergencyDepartmentAvailable: managed.emergencyDepartmentAvailable ?? null,
    icuBedsAvailable: managed.icuBedsAvailable ?? null,
    icuBedsTotal: managed.icuBedsTotal ?? null,
    generalBedsAvailable: managed.generalBedsAvailable ?? null,
    generalBedsTotal: managed.generalBedsTotal ?? null,
    specialFacilities: Array.isArray(managed.specialFacilities) ? managed.specialFacilities : [],
    ambulanceAcceptance: managed.ambulanceAcceptance || "UNKNOWN",
    capacityUpdatedAt: managed.capacityUpdatedAt || null,
    capacityDataSource: managed.capacityDataSource || "NOT_CONFIGURED"
  };
}

function validOptionalCount(value) {
  return value === null || value === undefined || value === "" ||
    (Number.isInteger(Number(value)) && Number(value) >= 0);
}

app.get("/api/hospitals/management", async (req, res) => {
  try {
    let discovered = [];
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const hasQueryLocation = Number.isFinite(latitude) && Number.isFinite(longitude) &&
      latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
    const ambulanceLocation = getValidAmbulanceLocation();
    const searchLocation = hasQueryLocation
      ? { latitude, longitude }
      : ambulanceLocation;

    if (searchLocation) {
      try {
        discovered = await discoverNearbyHospitals(searchLocation.latitude, searchLocation.longitude);
      } catch (lookupError) {
        console.warn("Hospital directory discovery unavailable:", lookupError.message);
      }
    }

    const discoveredIds = new Set(discovered.map(item => item.id));
    const savedManual = Object.entries(managedHospitalData)
      .filter(([id, item]) => item.manual === true && !discoveredIds.has(id))
      .map(([id, item]) => ({
        id, name: item.name, latitude: item.latitude, longitude: item.longitude,
        address: item.address || "", source: "MANUALLY_ADDED"
      }));

    const hospitals = [...discovered, ...savedManual]
      .map(mergeHospitalManagement)
      .map(item => ({
        ...item,
        straightLineDistance: searchLocation && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))
          ? Number(calculateDistance(searchLocation.latitude, searchLocation.longitude, Number(item.latitude), Number(item.longitude)).toFixed(2))
          : null
      }))
      .sort((a, b) => (a.straightLineDistance ?? Infinity) - (b.straightLineDistance ?? Infinity));

    return res.json({
      success: true,
      hospitals,
      source: "OpenStreetMap + ResQLink prototype-managed capacity data",
      capacityDisclaimer: "Bed counts, facilities and acceptance are manually entered prototype data, not verified live hospital availability."
    });
  } catch (error) {
    console.error("Hospital management list failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to load hospital management data." });
  }
});

app.post("/api/hospitals/management", (req, res) => {
  const body = req.body || {};
  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const facilities = Array.isArray(body.specialFacilities)
    ? body.specialFacilities.map(value => String(value).trim()).filter(Boolean).slice(0, 30)
    : [];

  if (!id || !name || name.length > 180) {
    return res.status(400).json({ success: false, message: "A valid hospital ID and name are required." });
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ success: false, message: "Valid hospital latitude and longitude are required." });
  }
  for (const field of ["icuBedsAvailable", "icuBedsTotal", "generalBedsAvailable", "generalBedsTotal"]) {
    if (!validOptionalCount(body[field])) {
      return res.status(400).json({ success: false, message: `${field} must be a non-negative whole number or left blank.` });
    }
    if (body[field] !== null && body[field] !== undefined && body[field] !== "" && Number(body[field]) > 100000) {
      return res.status(400).json({ success: false, message: `${field} is outside the allowed prototype range.` });
    }
  }
  const count = field => body[field] === null || body[field] === undefined || body[field] === "" ? null : Number(body[field]);
  const icuAvailable = count("icuBedsAvailable");
  const icuTotal = count("icuBedsTotal");
  const generalAvailable = count("generalBedsAvailable");
  const generalTotal = count("generalBedsTotal");
  if ((icuAvailable !== null && icuTotal !== null && icuAvailable > icuTotal) ||
      (generalAvailable !== null && generalTotal !== null && generalAvailable > generalTotal)) {
    return res.status(400).json({ success: false, message: "Available beds cannot exceed total beds." });
  }
  const existing = managedHospitalData[id] || {};
  managedHospitalData[id] = {
    ...existing, id, name, latitude, longitude, address: String(body.address || "").trim().slice(0, 300),
    emergencyDepartmentAvailable: body.emergencyDepartmentAvailable === true,
    icuBedsAvailable: icuAvailable, icuBedsTotal: icuTotal,
    generalBedsAvailable: generalAvailable, generalBedsTotal: generalTotal,
    specialFacilities: facilities,
    ambulanceAcceptance: ["ACCEPTING", "NOT_ACCEPTING", "UNKNOWN"].includes(body.ambulanceAcceptance) ? body.ambulanceAcceptance : "UNKNOWN",
    capacityUpdatedAt: new Date().toISOString(),
    capacityDataSource: "MANUALLY_UPDATED_PROTOTYPE_DATA",
    manual: body.manual === true || existing.manual === true
  };

  try {
    saveManagedHospitalData();
    return res.json({ success: true, hospital: mergeHospitalManagement({
      id, name, latitude, longitude, address: managedHospitalData[id].address, source: managedHospitalData[id].manual ? "MANUALLY_ADDED" : "OpenStreetMap"
    }), message: "Hospital information saved." });
  } catch (error) {
    console.error("Hospital management save failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not save hospital information on this server." });
  }
});

app.delete("/api/hospitals/management/:id", (req, res) => {
  const id = req.params.id;
  if (!managedHospitalData[id]) return res.status(404).json({ success: false, message: "Managed hospital record not found." });
  delete managedHospitalData[id];
  try {
    saveManagedHospitalData();
    return res.json({ success: true, message: "Managed hospital details reset. The real directory listing remains available." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not update hospital data." });
  }
});


// =====================================================
// SIMULATE EMERGENCY
// =====================================================

app.post(
  "/api/ambulance/emergency",
  (req, res) => {

    ambulanceData.heartRate =
      128;

    ambulanceData.spo2 =
      87;

    ambulanceData.temperature =
      38.9;

    ambulanceData.emergency =
      true;

    ambulanceData.assistanceRequested =
      true;

    ambulanceData.assistanceStatus =
      "REQUESTED";


    console.log();

    console.log(
      "=========================================="
    );

    console.log(
      "ðŸš¨ðŸš¨ EMERGENCY ACTIVATED ðŸš¨ðŸš¨"
    );

    console.log(
      "ðŸš‘ Ambulance A-01 requires assistance"
    );

    console.log(
      "=========================================="
    );


    res.json({

      success: true,

      emergency: true,

      message:
        "Emergency assistance request sent",

      ambulance:
        ambulanceData

    });

  }
);


// =====================================================
// ACCEPT INTER-AMBULANCE ASSISTANCE
// =====================================================

app.post(
  "/api/ambulance/assistance/accept",
  (req, res) => {

    ambulanceData.assistanceStatus =
      "ACCEPTED";


    console.log(
      "ðŸš‘ Ambulance A-02 ACCEPTED assistance request"
    );


    res.json({

      success: true,

      status:
        "ACCEPTED",

      message:
        "Ambulance A-02 is responding"

    });

  }
);


// =====================================================
// DECLINE INTER-AMBULANCE ASSISTANCE
// =====================================================

app.post(
  "/api/ambulance/assistance/decline",
  (req, res) => {

    ambulanceData.assistanceStatus =
      "DECLINED";


    console.log(
      "âŒ Ambulance A-02 DECLINED assistance request"
    );


    res.json({

      success: true,

      status:
        "DECLINED",

      message:
        "Assistance request declined"

    });

  }
);


// =====================================================
// RESET EMERGENCY
// =====================================================

app.post(
  "/api/ambulance/reset",
  (req, res) => {

    // Reset to "no current sensor reading"; do not display demo vitals as real.
    ambulanceData.heartRate = 0;
    ambulanceData.heartRateValid = false;
    ambulanceData.spo2 = 0;
    ambulanceData.spo2Valid = false;
    ambulanceData.fingerDetected = false;
    ambulanceData.vitalsLastUpdated = null;
    ambulanceData.temperature = 0;

    ambulanceData.latitude = null;
    ambulanceData.longitude = null;
    ambulanceData.gpsValid = false;
    ambulanceData.gpsSatellites = 0;
    ambulanceData.gpsHdop = null;
    ambulanceData.gpsLastUpdated = null;
    ambulanceData.locationSource = "NO_FIX";

    ambulanceData.emergency =
      false;

    ambulanceData.assistanceRequested =
      false;

    ambulanceData.assistanceStatus =
      null;

    ambulanceData.rfidStatus =
      "NOT_SCANNED";

    ambulanceData.patientId =
      null;

    ambulanceData.patientName =
      null;

    ambulanceData.patientAge =
      null;

    ambulanceData.patientBloodGroup =
      null;


    // -------------------------------------------------
    // RESET AMBULANCES
    // -------------------------------------------------

    ambulances.forEach(
      (ambulance) => {

        if (
          ambulance.ambulanceId ===
          "A-01"
        ) {

          ambulance.status =
            "AVAILABLE";

          ambulance.latitude =
            13.0072;

          ambulance.longitude =
            76.0962;

        }

        else if (
          ambulance.ambulanceId ===
          "A-02"
        ) {

          ambulance.status =
            "AVAILABLE";

          ambulance.currentPatient =
            null;

          ambulance.assignedRequest =
            null;

        }

      }
    );


    // -------------------------------------------------
    // COMPLETE ACTIVE REQUESTS
    // -------------------------------------------------

    ambulanceRequests.forEach(
      (request) => {

        if (

          request.status ===
          "ASSIGNED" ||

          request.status ===
          "ACCEPTED"

        ) {

          request.status =
            "COMPLETED";

        }

      }
    );


    console.log();

    console.log(
      "â†© EMERGENCY SYSTEM RESET"
    );


    res.json({

      success: true,

      message:
        "Emergency reset successfully",

      ambulance:
        ambulanceData,

      ambulances

    });

  }
);


// =====================================================
// PATIENT DIGITAL MEDICAL RECORD API
// =====================================================
app.get("/api/patients", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const results = patientRecords.filter(p =>
    !q || [p.id, p.name, p.bloodGroup, p.rfidUid].some(v => String(v || "").toLowerCase().includes(q))
  );
  res.json({ success: true, count: results.length, patients: results });
});

app.get("/api/patients/:id", (req, res) => {
  const patient = patientRecords.find(p => p.id.toLowerCase() === req.params.id.toLowerCase());
  if (!patient) return res.status(404).json({ success: false, message: "Patient not found." });
  res.json({ success: true, patient });
});

app.post("/api/patients", (req, res) => {
  try {
    const id = String(req.body.id || `P${Date.now().toString().slice(-7)}`).trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,24}$/.test(id)) {
      return res.status(400).json({ success: false, message: "Patient ID must be 3â€“24 letters, numbers or hyphens." });
    }
    if (patientRecords.some(p => p.id.toUpperCase() === id)) {
      return res.status(409).json({ success: false, message: "Patient ID already exists." });
    }
    const normalized = normalizePatient(req.body);
    if (normalized.rfidUid && (!Object.prototype.hasOwnProperty.call(DEMO_RFID_ASSIGNMENTS, normalized.rfidUid) || DEMO_RFID_ASSIGNMENTS[normalized.rfidUid] !== id)) {
      return res.status(400).json({ success: false, message: "Only the four pre-assigned RFID cards can be linked, and each is reserved for its matching demo patient. Use manual registration without an RFID UID for unregistered patients." });
    }
    if (normalized.rfidUid && patientRecords.some(p => String(p.rfidUid || "").toUpperCase() === normalized.rfidUid)) {
      return res.status(409).json({ success: false, message: "This RFID card is already linked to another patient." });
    }
    const patient = { id, ...normalized, createdAt: new Date().toISOString(), emergencyRecords: [] };
    patientRecords.push(patient);
    savePatientRecords();
    res.status(201).json({ success: true, patient });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.put("/api/patients/:id", (req, res) => {
  try {
    const index = patientRecords.findIndex(p => p.id.toLowerCase() === req.params.id.toLowerCase());
    if (index < 0) return res.status(404).json({ success: false, message: "Patient not found." });
    const normalized = normalizePatient(req.body, patientRecords[index]);
    if (normalized.rfidUid && (!Object.prototype.hasOwnProperty.call(DEMO_RFID_ASSIGNMENTS, normalized.rfidUid) || DEMO_RFID_ASSIGNMENTS[normalized.rfidUid] !== patientRecords[index].id)) {
      return res.status(400).json({ success: false, message: "This patient can only retain their pre-assigned RFID card. Use manual registration for patients without RFID." });
    }
    if (normalized.rfidUid && patientRecords.some((p, i) => i !== index && String(p.rfidUid || "").toUpperCase() === normalized.rfidUid)) {
      return res.status(409).json({ success: false, message: "This RFID card is already linked to another patient." });
    }
    patientRecords[index] = normalized;
    savePatientRecords();
    res.json({ success: true, patient: patientRecords[index] });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post("/api/patients/:id/emergency-records", (req, res) => {
  const patient = patientRecords.find(p => p.id.toLowerCase() === req.params.id.toLowerCase());
  if (!patient) return res.status(404).json({ success: false, message: "Patient not found." });
  const record = {
    emergencyId: String(req.body.emergencyId || `EMG-${Date.now()}`),
    ambulanceId: String(req.body.ambulanceId || ambulanceData.ambulanceId || "A-01"),
    occurredAt: new Date().toISOString(),
    emergencyType: String(req.body.emergencyType || "UNSPECIFIED"),
    notes: String(req.body.notes || "").trim(),
    vitals: {
      heartRate: ambulanceData.heartRateValid ? ambulanceData.heartRate : null,
      spo2: ambulanceData.spo2Valid ? ambulanceData.spo2 : null,
      temperature: ambulanceData.temperature ?? null,
      ecgSamples: Array.isArray(ambulanceData.ecgSamples) ? ambulanceData.ecgSamples.slice(-100) : [],
      ecgLeadOff: Boolean(ambulanceData.ecgLeadOff),
      capturedAt: ambulanceData.vitalsLastUpdated || ambulanceData.ecgLastUpdated || null
    }
  };
  patient.emergencyRecords = [...(patient.emergencyRecords || []), record];
  patient.updatedAt = new Date().toISOString();
  savePatientRecords();
  res.status(201).json({ success: true, record, patient });
});


// =====================================================
// MODULES 4-7: PRE-ARRIVAL, RISK, HANDOVER, ANALYTICS
// Prototype event stores. Migrate to PostgreSQL before production.
// =====================================================
const workflowDir = path.join(__dirname, "data");
const workflowFiles = {
  notifications: path.join(workflowDir, "hospital-notifications.json"),
  handovers: path.join(workflowDir, "patient-handovers.json"),
  events: path.join(workflowDir, "emergency-events.json")
};
function readWorkflow(key) {
  try { return fs.existsSync(workflowFiles[key]) ? JSON.parse(fs.readFileSync(workflowFiles[key], "utf8")) : []; }
  catch (e) { console.error(`Could not read ${key}:`, e.message); return []; }
}
const hospitalNotifications = readWorkflow("notifications");
const patientHandovers = readWorkflow("handovers");
const emergencyEvents = readWorkflow("events");
function saveWorkflow(key, value) {
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(workflowFiles[key], JSON.stringify(value, null, 2));
}
function addEmergencyEvent(type, details = {}) {
  emergencyEvents.push({ eventId: `EV-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, type, details, occurredAt: new Date().toISOString() });
  if (emergencyEvents.length > 10000) emergencyEvents.splice(0, emergencyEvents.length - 10000);
  saveWorkflow("events", emergencyEvents);
}

// Explainable rule-based screening only. Not a diagnosis or validated clinical score.
app.get("/api/clinical/risk-assessment", (req, res) => {
  const findings = [];
  if (ambulanceData.heartRateValid) {
    if (ambulanceData.heartRate < 50 || ambulanceData.heartRate > 120) findings.push({ metric: "Heart rate", value: ambulanceData.heartRate, reason: "Outside the prototype review range (50â€“120 bpm)." });
  } else findings.push({ metric: "Heart rate", value: null, reason: "No valid heart-rate reading available." });
  if (ambulanceData.spo2Valid) {
    if (ambulanceData.spo2 < 92) findings.push({ metric: "SpOâ‚‚", value: ambulanceData.spo2, reason: "Below the prototype review threshold of 92%." });
  } else findings.push({ metric: "SpOâ‚‚", value: null, reason: "No valid SpOâ‚‚ reading available." });
  const temp = Number(ambulanceData.temperature);
  if (Number.isFinite(temp) && temp > 0) {
    if (temp >= 38.5) findings.push({ metric: "Temperature", value: temp, reason: "At or above the prototype review threshold of 38.5Â°C." });
  } else findings.push({ metric: "Temperature", value: null, reason: "No temperature reading available." });
  if (ambulanceData.ecgLeadOff || !ambulanceData.ecgSamples?.length) findings.push({ metric: "ECG", value: null, reason: "ECG leads/samples are not currently suitable for review." });
  const concerning = findings.some(f => f.value !== null && ((f.metric === "SpOâ‚‚" && f.value < 92) || (f.metric === "Heart rate" && (f.value < 50 || f.value > 120)) || (f.metric === "Temperature" && f.value >= 38.5)));
  res.json({
    success: true,
    assessment: concerning ? "REVIEW_REQUIRED" : "NO_RULE_TRIGGERED",
    findings,
    generatedAt: new Date().toISOString(),
    disclaimer: "Rule-based prototype alert only. Not a diagnosis, validated triage score, or substitute for a qualified clinician. Missing/poor-quality data must not be interpreted as normal."
  });
});

// Hospital pre-arrival notification record and acknowledgement workflow.
app.post("/api/hospital-notifications", (req, res) => {
  const { emergencyId, hospitalId, hospitalName } = req.body || {};
  if (!emergencyId || !hospitalName) return res.status(400).json({ success: false, message: "Emergency ID and hospital name are required." });
  const notification = {
    notificationId: `HN-${Date.now()}`, emergencyId: String(emergencyId), hospitalId: hospitalId || null,
    hospitalName: String(hospitalName), ambulanceId: String(req.body.ambulanceId || ambulanceData.ambulanceId),
    patientId: req.body.patientId || ambulanceData.patientId || null,
    patientName: req.body.patientName || ambulanceData.patientName || null,
    latitude: Number.isFinite(Number(req.body.latitude)) ? Number(req.body.latitude) : null,
    longitude: Number.isFinite(Number(req.body.longitude)) ? Number(req.body.longitude) : null,
    etaMinutes: Number.isFinite(Number(req.body.etaMinutes)) ? Number(req.body.etaMinutes) : null,
    vitals: { heartRate: ambulanceData.heartRateValid ? ambulanceData.heartRate : null, spo2: ambulanceData.spo2Valid ? ambulanceData.spo2 : null, temperature: ambulanceData.temperature ?? null },
    status: "SENT_TO_DEMO_INBOX", acknowledgement: null, createdAt: new Date().toISOString()
  };
  hospitalNotifications.unshift(notification); saveWorkflow("notifications", hospitalNotifications);
  addEmergencyEvent("HOSPITAL_PRE_ARRIVAL_SENT", { notificationId: notification.notificationId, emergencyId: notification.emergencyId, hospitalName: notification.hospitalName });
  res.status(201).json({ success: true, notification, message: "Saved to ResQLink prototype hospital inbox; this does not send a real hospital message." });
});
app.get("/api/hospital-notifications", (req, res) => res.json({ success: true, notifications: hospitalNotifications }));
app.post("/api/hospital-notifications/:id/acknowledge", (req, res) => {
  const item = hospitalNotifications.find(n => n.notificationId === req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Notification not found." });
  item.status = "ACKNOWLEDGED"; item.acknowledgement = { staffName: String(req.body.staffName || "Demo receiving staff"), note: String(req.body.note || ""), acknowledgedAt: new Date().toISOString() };
  saveWorkflow("notifications", hospitalNotifications);
  addEmergencyEvent("HOSPITAL_PRE_ARRIVAL_ACKNOWLEDGED", { notificationId: item.notificationId, emergencyId: item.emergencyId });
  res.json({ success: true, notification: item });
});

// Patient transfer/handover with acknowledgement.
app.post("/api/handovers", (req, res) => {
  const { emergencyId, patientId, fromAmbulance, toAmbulance } = req.body || {};
  if (!emergencyId || !fromAmbulance || !toAmbulance || fromAmbulance === toAmbulance) return res.status(400).json({ success: false, message: "Emergency ID and two different ambulance IDs are required." });
  const handover = {
    handoverId: `HO-${Date.now()}`, emergencyId: String(emergencyId), patientId: patientId || ambulanceData.patientId || null,
    fromAmbulance: String(fromAmbulance), toAmbulance: String(toAmbulance),
    patientSnapshot: { name: ambulanceData.patientName || null, age: ambulanceData.patientAge ?? null, bloodGroup: ambulanceData.patientBloodGroup || null },
    vitalSnapshot: { heartRate: ambulanceData.heartRateValid ? ambulanceData.heartRate : null, spo2: ambulanceData.spo2Valid ? ambulanceData.spo2 : null, temperature: ambulanceData.temperature ?? null, ecgSamples: (ambulanceData.ecgSamples || []).slice(-100), ecgLeadOff: Boolean(ambulanceData.ecgLeadOff) },
    timeline: [{ event: "TRANSFER_INITIATED", at: new Date().toISOString() }],
    status: "AWAITING_RECEIVER_ACKNOWLEDGEMENT", acknowledgement: null, createdAt: new Date().toISOString()
  };
  patientHandovers.unshift(handover); saveWorkflow("handovers", patientHandovers);
  addEmergencyEvent("AMBULANCE_TRANSFER_INITIATED", { handoverId: handover.handoverId, emergencyId: handover.emergencyId, fromAmbulance, toAmbulance });
  res.status(201).json({ success: true, handover });
});
app.get("/api/handovers", (req, res) => res.json({ success: true, handovers: patientHandovers }));
app.post("/api/handovers/:id/acknowledge", (req, res) => {
  const item = patientHandovers.find(h => h.handoverId === req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Handover not found." });
  item.status = "ACKNOWLEDGED";
  item.acknowledgement = { receivingStaff: String(req.body.receivingStaff || "Demo receiving crew"), note: String(req.body.note || ""), acknowledgedAt: new Date().toISOString() };
  item.timeline.push({ event: "RECEIVER_ACKNOWLEDGED", at: item.acknowledgement.acknowledgedAt });
  saveWorkflow("handovers", patientHandovers);
  addEmergencyEvent("AMBULANCE_TRANSFER_ACKNOWLEDGED", { handoverId: item.handoverId, emergencyId: item.emergencyId });
  res.json({ success: true, handover: item });
});

// Analytics are calculated from saved prototype events, not fabricated dashboard counters.
app.get("/api/analytics/summary", (req, res) => {
  const completed = emergencyEvents.filter(e => e.type === "AMBULANCE_RESPONSE_RECORDED" && Number.isFinite(e.details?.responseMinutes));
  const avgResponseMinutes = completed.length ? Number((completed.reduce((sum, e) => sum + e.details.responseMinutes, 0) / completed.length).toFixed(1)) : null;
  const statusCounts = ambulances.reduce((acc, a) => { const key = String(a.status || "UNKNOWN").toUpperCase(); acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const hospitalCounts = {};
  hospitalNotifications.forEach(n => { hospitalCounts[n.hospitalName] = (hospitalCounts[n.hospitalName] || 0) + 1; });
  res.json({
    success: true,
    totalEmergencyEvents: emergencyEvents.filter(e => /EMERGENCY|AMBULANCE_REQUEST|TRANSFER/.test(e.type)).length,
    averageResponseMinutes: avgResponseMinutes,
    responseSamples: completed.length,
    ambulanceStatusCounts: statusCounts,
    hospitalNotificationCounts: hospitalCounts,
    eventHistory: emergencyEvents.slice(-100).reverse(),
    generatedAt: new Date().toISOString(),
    note: "Metrics reflect events recorded by this prototype. No response-time average is shown until response timestamps are recorded."
  });
});
app.post("/api/analytics/response-time", (req, res) => {
  const minutes = Number(req.body?.responseMinutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return res.status(400).json({ success: false, message: "Response time must be between 0 and 1440 minutes." });
  addEmergencyEvent("AMBULANCE_RESPONSE_RECORDED", { emergencyId: req.body.emergencyId || null, ambulanceId: req.body.ambulanceId || null, responseMinutes: minutes });
  res.status(201).json({ success: true, responseMinutes: minutes });
});

// =====================================================
// 404 HANDLER
// =====================================================

app.use(
  (req, res) => {

    res.status(404).json({

      success: false,

      message:
        "API endpoint not found.",

      path:
        req.originalUrl

    });

  }
);


// =====================================================
// ERROR HANDLER
// =====================================================

app.use(
  (err, req, res, next) => {

    console.error(
      "SERVER ERROR:",
      err
    );

    res.status(500).json({

      success: false,

      message:
        "Internal server error."

    });

  }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log();

    console.log(
      "=========================================="
    );

    console.log(
      "ðŸš‘ SMART AMBULANCE SERVER"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Server running on http://0.0.0.0:${PORT}`
    );

    console.log();

    console.log(
      "ðŸš‘ Ambulances:"
    );


    ambulances.forEach(
      (ambulance) => {

        console.log(

          `${ambulance.ambulanceId} â†’ ${ambulance.status} â†’ ${ambulance.latitude}, ${ambulance.longitude}`

        );

      }
    );


    console.log();

    console.log(
      "ðŸ“¡ ESP32 endpoint:"
    );

    console.log(
      `POST http://localhost:${PORT}/api/ambulance/update`
    );


    console.log();

    console.log(
      "ðŸš¨ Public ambulance request:"
    );

    console.log(
      `POST http://localhost:${PORT}/api/ambulance/request`
    );


    console.log();

    console.log(
      "ðŸš‘ All ambulances:"
    );

    console.log(
      `GET http://localhost:${PORT}/api/ambulances`
    );


    console.log();

    console.log(
      "ðŸ¥ Best route:"
    );

    console.log(
      `GET http://localhost:${PORT}/api/best-route`
    );


    console.log(
      "=========================================="
    );

  }
);
