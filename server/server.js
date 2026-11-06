const express = require("express");
const cors = require("cors");

const app = express();

const PORT = 5000;


// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());
app.use(express.json());


// =====================================================
// HELPER — CALCULATE DISTANCE BETWEEN GPS LOCATIONS
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
      "🚑 Smart Ambulance Server is running",

    status:
      "ONLINE",

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
// REQUESTER LOCATION (BROWSER GPS) — SEPARATE FROM AMBULANCE GPS
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
      "🚨 NEW PUBLIC AMBULANCE REQUEST"
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
        "❌ No available ambulance"
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
        "ASSIGNED",

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
        "ASSIGNED";

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
      true;

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
      "AMBULANCE_REQUEST_ASSIGNED";


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
      "🚑 SELECTED:",
      selectedAmbulance.ambulanceId
    );

    console.log(
      "📏 Distance:",
      selectedAmbulance.distance,
      "km"
    );

    console.log(
      "Status:",
      "ASSIGNED"
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
        "Nearest available ambulance assigned successfully.",

      requestId:

        requestId,

      status:
        "ASSIGNED",

      ambulance: {

        ambulanceId:
          selectedAmbulance.ambulanceId,

        driverName:
          selectedAmbulance.driverName,

        distance:
          selectedAmbulance.distance,

        status:
          "ASSIGNED"

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
      "✅ AMBULANCE REQUEST ACCEPTED"
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
      `🚑 ${ambulanceId} STATUS → ${status}`
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
// ESP32 → NODE.JS
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
      "📡 DATA RECEIVED FROM ESP32"
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
          "🚨 EMERGENCY RECEIVED"
        );

        console.log(
          "🚑 Inter-ambulance assistance requested"
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
      "°C"
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
// RFID SCAN
// =====================================================

app.post(
  "/api/rfid/scan",
  (req, res) => {

    console.log();

    console.log(
      "📡 RFID CARD DETECTED"
    );


    ambulanceData.rfidStatus =
      "IDENTIFIED";


    ambulanceData.patientId =
      demoPatient.id;

    ambulanceData.patientName =
      demoPatient.name;

    ambulanceData.patientAge =
      demoPatient.age;

    ambulanceData.patientBloodGroup =
      demoPatient.bloodGroup;


    console.log(
      "Patient:",
      demoPatient
    );


    res.json({

      success: true,

      patient:
        demoPatient

    });

  }
);


// =====================================================
// NEAREST REAL HOSPITAL — REQUIRES VALID ESP32 GPS FIX
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
      hospitals
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
      ...nearest,
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
      hospitals
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
// BEST ROUTE — REAL ROAD ROUTE TO NEAREST OSM HOSPITAL
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
      "🚨🚨 EMERGENCY ACTIVATED 🚨🚨"
    );

    console.log(
      "🚑 Ambulance A-01 requires assistance"
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
      "🚑 Ambulance A-02 ACCEPTED assistance request"
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
      "❌ Ambulance A-02 DECLINED assistance request"
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
      "↩ EMERGENCY SYSTEM RESET"
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
      "🚑 SMART AMBULANCE SERVER"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Server running on http://0.0.0.0:${PORT}`
    );

    console.log();

    console.log(
      "🚑 Ambulances:"
    );


    ambulances.forEach(
      (ambulance) => {

        console.log(

          `${ambulance.ambulanceId} → ${ambulance.status} → ${ambulance.latitude}, ${ambulance.longitude}`

        );

      }
    );


    console.log();

    console.log(
      "📡 ESP32 endpoint:"
    );

    console.log(
      `POST http://localhost:${PORT}/api/ambulance/update`
    );


    console.log();

    console.log(
      "🚨 Public ambulance request:"
    );

    console.log(
      `POST http://localhost:${PORT}/api/ambulance/request`
    );


    console.log();

    console.log(
      "🚑 All ambulances:"
    );

    console.log(
      `GET http://localhost:${PORT}/api/ambulances`
    );


    console.log();

    console.log(
      "🏥 Best route:"
    );

    console.log(
      `GET http://localhost:${PORT}/api/best-route`
    );


    console.log(
      "=========================================="
    );

  }
);