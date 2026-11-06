import { useEffect, useState } from "react";
import "./App.css";

// Uses the same host that served the Vite page, on backend port 5000.
// Example: http://localhost:5173 -> http://localhost:5000
//         http://192.168.x.x:5173 -> http://192.168.x.x:5000
const API_URL = `${window.location.protocol}//${window.location.hostname}:5000`;

function buildEcgPath(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return "";

  const values = samples.map(Number).filter(Number.isFinite);
  if (values.length < 2) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);

  // Auto gain: small real ADC variations use the available graph height.
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * 1000;
    const y = 8 + ((max - value) / range) * 144;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function App() {

  // =====================================================
  // SYSTEM
  // =====================================================

  const [isMonitoring, setIsMonitoring] = useState(true);
  const [backendOnline, setBackendOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // =====================================================
  // PUBLIC AMBULANCE REQUEST
  // =====================================================

  const [requestingAmbulance, setRequestingAmbulance] =
    useState(false);

  const [ambulanceRequest, setAmbulanceRequest] =
    useState(null);

  const [requestError, setRequestError] =
    useState(null);

  const [acceptingAmbulanceRequest, setAcceptingAmbulanceRequest] =
    useState(false);

  // =====================================================
  // RFID
  // =====================================================

  const [rfidStatus, setRfidStatus] =
    useState("NOT_SCANNED");

  const [patient, setPatient] = useState({
    id: null,
    name: null,
    age: null,
    bloodGroup: null
  });

  // =====================================================
  // VITALS
  // =====================================================

  const [vitals, setVitals] = useState({
    heartRate: 0,
    spo2: 0,
    temperature: null
  });

  // Backend validity flags prevent missing sensor data from appearing as zero.
  const [vitalValidity, setVitalValidity] = useState({
    fingerDetected: false,
    heartRate: false,
    spo2: false,
    temperature: false
  });

  // Latest real AD8232 sample batch received through the backend.
  const [ecgTelemetry, setEcgTelemetry] = useState({
    samples: [],
    raw: 0,
    leadOff: true,
    sampleRate: 100,
    updatedAt: null
  });

  // =====================================================
  // LOCATION
  // =====================================================

  const [location, setLocation] = useState({
    latitude: null,
    longitude: null
  });

  const [gpsStatus, setGpsStatus] = useState({
    valid: false,
    satellites: 0,
    hdop: null,
    updatedAt: null,
    source: "NO_FIX"
  });

  // =====================================================
  // HOSPITAL
  // =====================================================

  const [hospital, setHospital] = useState({
    name: "Waiting for valid ambulance GPS",
    distance: null,
    traffic: null,
    availableBeds: null,
    latitude: null,
    longitude: null,
    address: null
  });

  const [nearbyHospitals, setNearbyHospitals] = useState([]);

  // =====================================================
  // ROUTE
  // =====================================================

  const [bestRoute, setBestRoute] = useState(null);

  // =====================================================
  // ALERT
  // =====================================================

  const [alert, setAlert] = useState(null);

  // =====================================================
  // EMERGENCY
  // =====================================================

  const [emergencyMode, setEmergencyMode] =
    useState(false);

  // =====================================================
  // INTER AMBULANCE
  // =====================================================

  const [assistanceRequested, setAssistanceRequested] =
    useState(false);

  const [assistanceAccepted, setAssistanceAccepted] =
    useState(false);

  const [assistanceDeclined, setAssistanceDeclined] =
    useState(false);

  // =====================================================
  // PATIENT HANDOVER
  // =====================================================

  const [handoverStatus, setHandoverStatus] =
    useState("NOT_REQUIRED");

  const [handoverHistory, setHandoverHistory] =
    useState([]);

  // =====================================================
  // CONDITION TREND
  // =====================================================

  const [vitalHistory, setVitalHistory] =
    useState([]);

  // =====================================================
  // DYNAMIC HOSPITAL
  // =====================================================

  const [hospitalChangeSuggestion, setHospitalChangeSuggestion] =
    useState(null);

  // =====================================================
  // GET AMBULANCE DATA
  // =====================================================

  const fetchAmbulanceData = async () => {

    try {

      const response = await fetch(
        `${API_URL}/api/ambulance`
      );

      if (!response.ok) {
        throw new Error("Ambulance API failed");
      }

      const data = await response.json();

      setGpsStatus({
        valid: data.gpsValid === true,
        satellites: Number(data.gpsSatellites) || 0,
        hdop: data.gpsHdop ?? null,
        updatedAt: data.gpsLastUpdated || null,
        source: data.locationSource || "NO_FIX"
      });

      setVitals({
        heartRate: Number(data.heartRate) || 0,
        spo2: Number(data.spo2) || 0,
        // The current ESP32 firmware does not transmit temperature yet.
        temperature: data.temperatureValid === true && Number.isFinite(Number(data.temperature))
          ? Number(data.temperature)
          : null
      });

      setVitalValidity({
        fingerDetected: data.fingerDetected === true,
        heartRate: data.heartRateValid === true && Number(data.heartRate) > 0,
        spo2: data.spo2Valid === true && Number(data.spo2) > 0,
        temperature: data.temperatureValid === true && Number.isFinite(Number(data.temperature))
      });

      setEcgTelemetry({
        samples: Array.isArray(data.ecgSamples)
          ? data.ecgSamples.map(Number).filter(Number.isFinite)
          : [],
        raw: Number(data.ecgRaw) || 0,
        leadOff: data.ecgLeadOff !== false,
        sampleRate: Number(data.ecgSampleRate) || 100,
        updatedAt: data.ecgLastUpdated || null
      });

      setLocation({
        latitude: data.gpsValid === true ? Number(data.latitude) : null,
        longitude: data.gpsValid === true ? Number(data.longitude) : null
      });

      setEmergencyMode(
        data.emergency === true
      );

      setAssistanceRequested(
        data.assistanceRequested === true
      );

      setRfidStatus(
        data.rfidStatus || "NOT_SCANNED"
      );

      setPatient({
        id: data.patientId || null,
        name: data.patientName || null,
        age: data.patientAge ?? null,
        bloodGroup: data.patientBloodGroup || null
      });

      setBackendOnline(true);
      setLastUpdated(new Date());

    }

    catch (error) {

      console.error(
        "Ambulance data error:",
        error
      );

      setBackendOnline(false);

    }

  };

  // =====================================================
  // REQUEST AMBULANCE
  // =====================================================

  const requestAmbulance = () => {

    if (!navigator.geolocation) {

      setRequestError(
        "GPS is not supported by this browser."
      );

      return;

    }

    setRequestingAmbulance(true);
    setRequestError(null);
    setAmbulanceRequest(null);

    navigator.geolocation.getCurrentPosition(

      async (position) => {

        const latitude =
          position.coords.latitude;

        const longitude =
          position.coords.longitude;

        const accuracy = position.coords.accuracy;

        try {

          // Save the caller's browser location independently.
          // This endpoint never overwrites the ambulance's ESP32 GPS.
          const requesterLocationResponse = await fetch(
            `${API_URL}/api/location/requester`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ latitude, longitude, accuracy })
            }
          );

          if (!requesterLocationResponse.ok) {
            console.warn("Requester location endpoint did not accept the update.");
          }

          const response = await fetch(
            `${API_URL}/api/ambulance/request`,
            {

              method: "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body: JSON.stringify({

                patientName:
                  "Emergency Patient",

                phone:
                  "Not Provided",

                emergencyType:
                  "Emergency",

                description:
                  "One-tap emergency ambulance request",

                latitude,
                longitude

              })

            }
          );

          const data =
            await response.json();

          if (
            !response.ok ||
            !data.success
          ) {

            throw new Error(
              data.message ||
              "Ambulance request failed"
            );

          }

          setAmbulanceRequest({

            requestId:
              data.requestId ||
              `EMG-${Date.now()}`,

            status:
              data.status ||
              "REQUEST_SENT",

            ambulance:
              data.ambulance ||
              "Searching for nearest ambulance",

            latitude,
            longitude

          });

          setEmergencyMode(true);

          setAlert({

            type: "critical",

            message:
              `🚨 Ambulance ${data.ambulance?.ambulanceId || ""} assigned successfully. Request ID: ${data.requestId || ""}`

          });

        }

        catch (error) {

          console.error(
            "Ambulance request error:",
            error
          );

          setRequestError(
            error.message ||
            "Unable to request ambulance."
          );

        }

        finally {

          setRequestingAmbulance(false);

        }

      },

      () => {

        setRequestingAmbulance(false);

        setRequestError(
          "Please allow location access to request an ambulance."
        );

      },

      {

        enableHighAccuracy: true,

        timeout: 10000,

        maximumAge: 0

      }

    );

  };

  // =====================================================
  // NEAREST HOSPITAL
  // =====================================================

  const fetchNearestHospital = async () => {

    try {

      const response = await fetch(
        `${API_URL}/api/nearest-hospital`
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 409) {
          setHospital({
            name: "Waiting for valid ambulance GPS",
            distance: null,
            traffic: null,
            availableBeds: null,
            latitude: null,
            longitude: null,
            address: null
          });
          setBestRoute(null);
          setNearbyHospitals([]);
          return;
        }
        throw new Error(data.message || "Hospital lookup failed");
      }

      const nearest = data.nearestHospital;

      setHospital({
        name: nearest.name,
        distance: nearest.distance,
        traffic: null,
        availableBeds: null,
        latitude: nearest.latitude,
        longitude: nearest.longitude,
        address: nearest.address || "",
        estimatedTime: nearest.estimatedTime,
        distanceType: nearest.distanceType
      });
      setNearbyHospitals(Array.isArray(data.hospitals) ? data.hospitals : []);

    } catch (error) {
      console.error("Hospital error:", error);
      setHospital(previous => ({
        ...previous,
        name: "Hospital lookup unavailable"
      }));
    }

  };

  // =====================================================
  // BEST ROUTE
  // =====================================================

  const viewBestRoute = async () => {

    try {

      console.log("Calculating best route...");

      const response = await fetch(
        `${API_URL}/api/best-route`
      );

      if (!response.ok) {
        throw new Error(
          "Best route API failed"
        );
      }

      const data =
        await response.json();

      console.log(
        "BEST ROUTE RESPONSE:",
        data
      );

      if (!data.success || !data.route) {
        throw new Error(
          "No route information received"
        );
      }

      setBestRoute(data.route);

      setAlert({
        type: "warning",
        message:
          `✓ Best route selected: ${data.route.destination} — ${data.route.distance} km, ETA ${data.route.estimatedTime} min.`
      });

    }

    catch (error) {

      console.error(
        "Route error:",
        error
      );

      setAlert({

        type: "warning",

        message:
          "Unable to calculate the best route."

      });

    }

  };

  // =====================================================
  // RFID
  // =====================================================

  const scanRFID = async () => {

    try {

      const response =
        await fetch(
          `${API_URL}/api/rfid/scan`,
          {

            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            }

          }
        );

      if (!response.ok) {

        throw new Error(
          "RFID scan failed"
        );

      }

      const data =
        await response.json();

      setRfidStatus(
        "IDENTIFIED"
      );

      setPatient(
        data.patient
      );

      setAlert({

        type: "warning",

        message:
          `RFID scanned successfully. Patient ${data.patient.id} identified.`

      });

      await fetchAmbulanceData();

    }

    catch (error) {

      console.error(
        "RFID error:",
        error
      );

      setAlert({

        type: "warning",

        message:
          "RFID scan failed."

      });

    }

  };

  // =====================================================
  // ACCEPT PUBLIC AMBULANCE REQUEST
  // =====================================================

  const acceptAmbulanceRequest = async () => {

    if (!ambulanceRequest?.requestId) {
      return;
    }

    try {

      setAcceptingAmbulanceRequest(true);
      setRequestError(null);

      const response =
        await fetch(
          `${API_URL}/api/ambulance/request/accept`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              requestId:
                ambulanceRequest.requestId
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
          "Unable to accept ambulance request."
        );
      }

      setAmbulanceRequest(previous => ({
        ...previous,
        status:
          data.request?.status ||
          "ACCEPTED",
        ambulance:
          previous.ambulance
      }));

      setAlert({
        type: "critical",
        message:
          "🚑 Ambulance request accepted. The assigned ambulance is now en route."
      });

    }
    catch (error) {

      console.error(
        "Accept ambulance request error:",
        error
      );

      setRequestError(
        error.message ||
        "Unable to accept ambulance request."
      );

    }
    finally {

      setAcceptingAmbulanceRequest(false);

    }

  };


  // =====================================================
  // SIMULATE EMERGENCY
  // =====================================================

  const simulateEmergency = async () => {

    try {

      const response =
        await fetch(
          `${API_URL}/api/ambulance/emergency`,
          {

            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            }

          }
        );

      if (!response.ok) {

        throw new Error(
          "Emergency failed"
        );

      }

      setEmergencyMode(true);

      setAssistanceRequested(true);

      setAssistanceAccepted(false);

      setAssistanceDeclined(false);

      setVitals({

        heartRate: 128,

        spo2: 87,

        temperature: 38.9

      });

      setAlert({

        type: "critical",

        message:
          "🚨 Ambulance emergency detected. Assistance request sent."

      });

      await fetchNearestHospital();

    }

    catch (error) {

      console.error(
        "Emergency error:",
        error
      );

    }

  };

  // =====================================================
  // ACCEPT ASSISTANCE
  // =====================================================

  const acceptAssistance = async () => {

    try {

      const response =
        await fetch(
          `${API_URL}/api/ambulance/assistance/accept`,
          {

            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            }

          }
        );

      if (!response.ok) {

        throw new Error(
          "Accept failed"
        );

      }

      setAssistanceAccepted(true);

      setAssistanceDeclined(false);

      setAlert({

        type: "critical",

        message:
          "Ambulance A-02 accepted the emergency assistance request."

      });

    }

    catch (error) {

      console.error(
        "Accept error:",
        error
      );

    }

  };

  // =====================================================
  // DECLINE ASSISTANCE
  // =====================================================

  const declineAssistance = async () => {

    try {

      const response =
        await fetch(
          `${API_URL}/api/ambulance/assistance/decline`,
          {

            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            }

          }
        );

      if (!response.ok) {

        throw new Error(
          "Decline failed"
        );

      }

      setAssistanceDeclined(true);

      setAssistanceAccepted(false);

      setAlert({

        type: "warning",

        message:
          "Ambulance A-02 declined. Searching for another ambulance."

      });

    }

    catch (error) {

      console.error(
        "Decline error:",
        error
      );

    }

  };

  // =====================================================
  // RESET
  // =====================================================

  const resetEmergency = async () => {

    try {

      const response =
        await fetch(
          `${API_URL}/api/ambulance/reset`,
          {

            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            }

          }
        );

      if (!response.ok) {

        throw new Error(
          "Reset failed"
        );

      }

      setEmergencyMode(false);

      setAssistanceRequested(false);

      setAssistanceAccepted(false);

      setAssistanceDeclined(false);

      setAmbulanceRequest(null);

      setRequestError(null);

      setAcceptingAmbulanceRequest(false);

      setVitals({
        heartRate: 0,
        spo2: 0,
        temperature: 0
      });

      setRfidStatus(
        "NOT_SCANNED"
      );

      setPatient({

        id: null,

        name: null,

        age: null,

        bloodGroup: null

      });

      setAlert(null);

      setBestRoute(null);

      setHandoverStatus(
        "NOT_REQUIRED"
      );

    }

    catch (error) {

      console.error(
        "Reset error:",
        error
      );

    }

  };

  // =====================================================
  // PATIENT STATUS
  // =====================================================

  const getStatus = () => {

    const hasHeartRate = vitalValidity.heartRate;
    const hasSpO2 = vitalValidity.spo2;
    const hasTemperature = vitalValidity.temperature && vitals.temperature !== null;

    if (!hasHeartRate && !hasSpO2 && !hasTemperature) {
      return "NO DATA";
    }

    if (
      (hasSpO2 && vitals.spo2 < 94) ||
      (hasHeartRate && (vitals.heartRate > 110 || vitals.heartRate < 55)) ||
      (hasTemperature && vitals.temperature > 38.5)
    ) {
      return "CRITICAL";
    }

    if (
      (hasSpO2 && vitals.spo2 < 95) ||
      (hasHeartRate && vitals.heartRate > 100) ||
      (hasTemperature && vitals.temperature > 37.5)
    ) {
      return "WARNING";
    }

    return "STABLE";

  };

  const status =
    getStatus();

  const statusClass =
    status === "CRITICAL"
      ? "critical"
      : status === "WARNING"
      ? "warning"
      : status === "NO DATA"
      ? "unknown"
      : "stable";

  // =====================================================
  // VITAL TREND
  // =====================================================

  useEffect(() => {

    setVitalHistory(
      previous => {

        // Do not record missing/invalid sensor values as real patient readings.
        if (!vitalValidity.heartRate && !vitalValidity.spo2) return previous;

        const newEntry = {
          time: new Date().toLocaleTimeString(),
          heartRate: vitalValidity.heartRate ? vitals.heartRate : null,
          spo2: vitalValidity.spo2 ? vitals.spo2 : null,
          temperature: vitalValidity.temperature ? vitals.temperature : null
        };

        return [...previous.slice(-4), newEntry];

      }
    );

  }, [
    vitals.heartRate,
    vitals.spo2,
    vitals.temperature,
    vitalValidity.heartRate,
    vitalValidity.spo2,
    vitalValidity.temperature
  ]);

  // =====================================================
  // MONITORING
  // =====================================================

  useEffect(() => {

    if (!isMonitoring) {
      return;
    }

    fetchAmbulanceData();
    fetchNearestHospital();

    const telemetryInterval = setInterval(() => {
      fetchAmbulanceData();
    }, 1000);

    // Nearby-hospital discovery and road routing refresh less frequently.
    const hospitalInterval = setInterval(() => {
      fetchNearestHospital();
    }, 15000);

    return () => {
      clearInterval(telemetryInterval);
      clearInterval(hospitalInterval);
    };

  }, [isMonitoring]);

  // =====================================================
  // AUTOMATIC ALERT
  // =====================================================

  useEffect(() => {

    if (emergencyMode) {
      return;
    }

    if (status === "CRITICAL") {

      setAlert({

        type: "critical",

        message:
          "Critical patient condition detected."

      });

    }

    else if (status === "WARNING") {

      setAlert({

        type: "warning",

        message:
          "Patient vitals require attention."

      });

    } else if (status === "NO DATA" || status === "STABLE") {
      setAlert(null);
    }

  }, [
    status,
    emergencyMode
  ]);

  // =====================================================
  // ACKNOWLEDGE
  // =====================================================

  const acknowledgeAlert = () => {

    setAlert(null);

  };

  // =====================================================
  // HANDOVER
  // =====================================================

  const startHandover = () => {

    setHandoverStatus(
      "HANDOVER_IN_PROGRESS"
    );

    setAlert({

      type: "warning",

      message:
        "Patient handover initiated. Transferring patient information, vitals, trend and hospital details."

    });

    setTimeout(() => {

      setHandoverStatus(
        "HANDOVER_COMPLETED"
      );

      setHandoverHistory(
        previous => [

          ...previous,

          {

            from:
              "A-01",

            to:
              "A-02",

            time:
              new Date().toLocaleTimeString(),

            patient:
              patient.id ||
              "Emergency Patient"

          }

        ]
      );

      setAlert({

        type: "warning",

        message:
          "✓ Digital patient handover completed. Journey continuity maintained."

      });

    }, 2500);

  };

  // =====================================================
  // DYNAMIC HOSPITAL DECISION
  // =====================================================

  const evaluateHospitalChange = () => {

    const alternative = nearbyHospitals.find(
      item => item.name !== hospital.name
    );

    if (!gpsStatus.valid) {
      setAlert({
        type: "warning",
        message: "Hospital comparison is paused until the ambulance GPS has a valid fix."
      });
      return;
    }

    if (alternative) {
      setHospitalChangeSuggestion({
        current: hospital.name,
        suggested: alternative.name,
        reason: "Alternative real hospital found from OpenStreetMap. Compare the road route before changing destination."
      });

      setAlert({
        type: "warning",
        message: `Alternative hospital found: ${alternative.name}. This is a suggestion, not an automatic hospital change.`
      });
    } else {
      setHospitalChangeSuggestion(null);
      setAlert({
        type: "warning",
        message: "No second named hospital is currently available in the nearby OpenStreetMap results."
      });
    }

  };

  // =====================================================
  // RENDER
  // =====================================================

  const ecgDataFresh =
    ecgTelemetry.updatedAt &&
    (Date.now() - new Date(ecgTelemetry.updatedAt).getTime()) < 5000;

  const ecgSignalReady =
    !ecgTelemetry.leadOff &&
    ecgTelemetry.samples.length > 1 &&
    Boolean(ecgDataFresh);

  return (

    <div className="app">

      {/* =================================================
          HEADER
      ================================================= */}

      <header className="header">

        <div>

          <h1 style={{
            margin: 0,
            fontSize: "clamp(30px, 4vw, 48px)",
            fontWeight: "900",
            letterSpacing: "1px"
          }}>
            🚑 ResQLink
          </h1>

          <p style={{
            marginTop: "8px",
            fontSize: "15px",
            fontWeight: "600",
            letterSpacing: "0.3px"
          }}>
            Intelligent Ambulance System for Real-Time Patient Monitoring & Hospital Coordination
          </p>

        </div>

        <div className="header-right">

          <div className="online">

            <span></span>

            {backendOnline
              ? "SYSTEM ONLINE"
              : "BACKEND OFFLINE"}

          </div>

          <button
            className="monitor-button"
            onClick={() =>
              setIsMonitoring(
                !isMonitoring
              )
            }
          >

            {isMonitoring
              ? "⏸ Stop Monitoring"
              : "▶ Start Monitoring"}

          </button>

          <button
            className="monitor-button"
            onClick={scanRFID}
          >

            📡 Scan RFID

          </button>

          {!emergencyMode ? (

            <button
              className="emergency-button"
              onClick={
                simulateEmergency
              }
            >

              🚨 Simulate Emergency

            </button>

          ) : (

            <button
              className="reset-button"
              onClick={
                resetEmergency
              }
            >

              ↩ Reset Emergency

            </button>

          )}

        </div>

      </header>


      {/* =================================================
          🚨 PUBLIC REQUEST AMBULANCE
          SAME PAGE
      ================================================= */}

      <section
        style={{
          padding: "25px",
          margin: "20px",
          borderRadius: "18px",
          background:
            "linear-gradient(135deg,#7f1d1d,#dc2626)",
          color: "white",
          textAlign: "center",
          boxShadow:
            "0 10px 30px rgba(0,0,0,0.15)"
        }}
      >

        <h2
          style={{
            marginBottom: "8px"
          }}
        >

          🚨 RESQLINK EMERGENCY AMBULANCE REQUEST

        </h2>

        <p
          style={{
            marginBottom: "18px"
          }}
        >

          Accident or emergency?
          No registration is required.

        </p>

        <button

          onClick={
            requestAmbulance
          }

          disabled={
            requestingAmbulance
          }

          style={{

            width: "90%",

            maxWidth: "650px",

            minHeight: "95px",

            border: "3px solid white",

            borderRadius: "18px",

            background:
              requestingAmbulance
                ? "#991b1b"
                : "#ef4444",

            color: "white",

            fontSize: "28px",

            fontWeight: "900",

            cursor:
              requestingAmbulance
                ? "wait"
                : "pointer",

            boxShadow:
              "0 8px 20px rgba(0,0,0,0.25)"

          }}

        >

          {requestingAmbulance

            ? "📍 LOCATING & REQUESTING..."

            : "🚨 REQUEST AMBULANCE NOW"}

        </button>

        <p
          style={{
            marginTop: "12px",
            fontSize: "13px"
          }}
        >

          📍 Your current GPS location
          will be shared with the ambulance system.

        </p>

      </section>


      {/* =================================================
          REQUEST RESULT
      ================================================= */}

      {ambulanceRequest && (

        <section
          style={{
            margin: "20px",
            padding: "24px",
            borderRadius: "18px",
            background:
              "linear-gradient(135deg,#ecfdf5,#f0fdf4)",
            border:
              "2px solid #22c55e",
            boxShadow:
              "0 8px 25px rgba(0,0,0,0.08)"
          }}
        >

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "15px",
              flexWrap: "wrap"
            }}
          >

            <div>

              <h2 style={{ marginBottom: "6px" }}>
                🚑 Ambulance Dispatch
              </h2>

              <p style={{ margin: 0 }}>
                Your emergency request has been received.
              </p>

            </div>

            <strong
              style={{
                padding: "8px 14px",
                borderRadius: "999px",
                background:
                  ambulanceRequest.status === "ACCEPTED"
                    ? "#dcfce7"
                    : "#fef3c7",
                color:
                  ambulanceRequest.status === "ACCEPTED"
                    ? "#166534"
                    : "#92400e"
              }}
            >
              {ambulanceRequest.status}
            </strong>

          </div>


          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(180px,1fr))",
              gap: "15px",
              marginTop: "20px"
            }}
          >

            <div>

              <small>
                Request ID
              </small>

              <strong
                style={{
                  display: "block",
                  marginTop: "5px"
                }}
              >
                {ambulanceRequest.requestId}
              </strong>

            </div>


            <div>

              <small>
                Assigned Ambulance
              </small>

              <strong
                style={{
                  display: "block",
                  marginTop: "5px"
                }}
              >

                {typeof ambulanceRequest.ambulance ===
                "string"
                  ? ambulanceRequest.ambulance
                  : ambulanceRequest.ambulance?.ambulanceId ||
                    "Searching..."}

              </strong>

            </div>


            <div>

              <small>
                Driver
              </small>

              <strong
                style={{
                  display: "block",
                  marginTop: "5px"
                }}
              >

                {typeof ambulanceRequest.ambulance ===
                "object"
                  ? ambulanceRequest.ambulance?.driverName ||
                    "Assigned driver"
                  : "Assigned driver"}

              </strong>

            </div>


            <div>

              <small>
                Pickup Location
              </small>

              <strong
                style={{
                  display: "block",
                  marginTop: "5px"
                }}
              >

                {Number(
                  ambulanceRequest.latitude
                ).toFixed(5)}

                {" , "}

                {Number(
                  ambulanceRequest.longitude
                ).toFixed(5)}

              </strong>

            </div>

          </div>


          <div
            style={{
              marginTop: "20px",
              padding: "15px",
              borderRadius: "12px",
              background: "white"
            }}
          >

            <strong>
              Emergency Dispatch Status
            </strong>


            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
                marginTop: "14px"
              }}
            >

              <span>
                📞 Request Sent
              </span>

              <span>
                →
              </span>

              <span
                style={{
                  fontWeight: "700",
                  color:
                    ambulanceRequest.status ===
                    "ACCEPTED"
                      ? "#16a34a"
                      : "#d97706"
                }}
              >
                {ambulanceRequest.status ===
                "ACCEPTED"
                  ? "✓ Ambulance Accepted"
                  : "⏳ Waiting for Acceptance"}
              </span>

              {ambulanceRequest.status ===
                "ACCEPTED" && (

                <>
                  <span>
                    →
                  </span>

                  <span
                    style={{
                      fontWeight: "700",
                      color: "#2563eb"
                    }}
                  >
                    🚑 EN ROUTE
                  </span>
                </>

              )}

            </div>

          </div>


          {ambulanceRequest.status !==
            "ACCEPTED" && (

            <button
              onClick={
                acceptAmbulanceRequest
              }
              disabled={
                acceptingAmbulanceRequest
              }
              style={{
                width: "100%",
                marginTop: "18px",
                minHeight: "58px",
                border: "none",
                borderRadius: "12px",
                background:
                  acceptingAmbulanceRequest
                    ? "#94a3b8"
                    : "#16a34a",
                color: "white",
                fontSize: "18px",
                fontWeight: "800",
                cursor:
                  acceptingAmbulanceRequest
                    ? "wait"
                    : "pointer"
              }}
            >

              {acceptingAmbulanceRequest
                ? "🚑 ACCEPTING REQUEST..."
                : "🚑 ACCEPT AMBULANCE REQUEST"}

            </button>

          )}


          {ambulanceRequest.status ===
            "ACCEPTED" && (

            <div
              style={{
                marginTop: "18px",
                padding: "14px",
                borderRadius: "10px",
                background: "#dcfce7",
                color: "#166534",
                textAlign: "center",
                fontWeight: "700"
              }}
            >

              ✓ Request accepted successfully.
              Assigned ambulance is en route.

            </div>

          )}

        </section>

      )}


      {/* =================================================
          REQUEST ERROR
      ================================================= */}

      {requestError && (

        <section
          style={{
            margin: "20px",
            padding: "15px",
            borderRadius: "10px",
            background: "#fee2e2",
            color: "#991b1b"
          }}
        >

          🚨 {requestError}

          <br />

          <a
            href="tel:108"
            style={{
              fontWeight: "bold"
            }}
          >

            📞 Call 108

          </a>

        </section>

      )}


      {/* =================================================
          PATIENT INFORMATION
      ================================================= */}

      <section className="patient-section">

        <div className="patient-info">

          <h2>
            Patient Information
          </h2>

          <div className="patient-row">

            <div>

              <label>
                Patient ID
              </label>

              <strong>
                {patient.id || "—"}
              </strong>

            </div>

            <div>

              <label>
                RFID Status
              </label>

              <strong
                className={
                  rfidStatus ===
                  "IDENTIFIED"
                    ? "green-text"
                    : "warning"
                }
              >

                {rfidStatus ===
                "IDENTIFIED"

                  ? "✓ IDENTIFIED"

                  : "NOT SCANNED"}

              </strong>

            </div>

            <div>

              <label>
                Ambulance ID
              </label>

              <strong>
                A-01
              </strong>

            </div>

            <div>

              <label>
                Patient Status
              </label>

              <strong
                className={
                  statusClass
                }
              >

                {status}

              </strong>

            </div>

          </div>

          {patient.id && (

            <div className="patient-extra">

              <div>

                <label>
                  Patient Name
                </label>

                <strong>
                  {patient.name}
                </strong>

              </div>

              <div>

                <label>
                  Age
                </label>

                <strong>
                  {patient.age} years
                </strong>

              </div>

              <div>

                <label>
                  Blood Group
                </label>

                <strong>
                  {patient.bloodGroup}
                </strong>

              </div>

            </div>

          )}

        </div>

      </section>


      {/* =================================================
          VITALS
      ================================================= */}

      <section className="vitals">

        <div className="vital-card">

          <div className="icon">
            ❤️
          </div>

          <h3>
            Heart Rate
          </h3>

          <div className="value">

            {vitalValidity.heartRate ? vitals.heartRate : "—"}

            <span>
              {vitalValidity.heartRate ? "BPM" : "NO READING"}
            </span>

          </div>

          <p>

            {!vitalValidity.fingerDetected
              ? "Place finger on MAX30102"
              : !vitalValidity.heartRate
              ? "Calculating valid reading"
              : vitals.heartRate > 110
              ? "High reading"
              : vitals.heartRate < 55
              ? "Low reading"
              : "Reading received"}

          </p>

        </div>


        <div className="vital-card">

          <div className="icon">
            🫁
          </div>

          <h3>
            SpO₂
          </h3>

          <div className="value">

            {vitalValidity.spo2 ? vitals.spo2 : "—"}

            <span>
              {vitalValidity.spo2 ? "%" : "NO READING"}
            </span>

          </div>

          <p>

            {!vitalValidity.fingerDetected
              ? "Place finger on MAX30102"
              : !vitalValidity.spo2
              ? "Calculating valid reading"
              : vitals.spo2 < 94
              ? "Low reading"
              : "Reading received"}

          </p>

        </div>


        <div className="vital-card">

          <div className="icon">
            🌡️
          </div>

          <h3>
            Temperature
          </h3>

          <div className="value">

            {vitalValidity.temperature ? vitals.temperature.toFixed(1) : "—"}

            <span>
              {vitalValidity.temperature ? "°C" : "NOT CONNECTED"}
            </span>

          </div>

          <p>

            {vitalValidity.temperature
              ? vitals.temperature > 38.5 ? "High reading" : "Reading received"
              : "Temperature sensor not transmitting"}

          </p>

        </div>


        <div
          className={
            `vital-card status-card ${statusClass}`
          }
        >

          <div className="icon">

            {status === "CRITICAL"
              ? "🔴"
              : status === "WARNING"
              ? "🟡"
              : status === "NO DATA"
              ? "⚪"
              : "🟢"}

          </div>

          <h3>
            Overall Status
          </h3>

          <div className="status-value">
            {status}
          </div>

          <p>

            {status === "CRITICAL"
              ? "Abnormal readings — check patient"
              : status === "WARNING"
              ? "Readings require attention"
              : status === "NO DATA"
              ? "Waiting for valid sensor readings"
              : "Readings within configured limits"}

          </p>

        </div>

      </section>


      {/* =================================================
          ECG MONITOR — REAL AD8232 SIGNAL ONLY
      ================================================= */}

      <section className="panel ecg-panel">
        <div className="panel-title">
          <div>
            <h2>💓 ECG Monitor</h2>
            <p className="ecg-subtitle">
              Live AD8232 signal from ESP32
            </p>
          </div>
          <span className="ecg-status">
            <i />
            {ecgTelemetry.leadOff
              ? "ATTACH ELECTRODES"
              : ecgSignalReady
                ? "LIVE SIGNAL"
                : "WAITING FOR ESP32"}
          </span>
        </div>

        <div
          className="ecg-monitor"
          role="img"
          aria-label={ecgSignalReady
            ? "Live ECG samples received from AD8232"
            : "ECG waveform unavailable until electrode contact and fresh ESP32 samples are detected"}
        >
          <div className="ecg-grid" />
          <span className="ecg-label">AD8232 • LIVE ADC</span>
          <span className="ecg-preview-note">
            {ecgSignalReady
              ? `${ecgTelemetry.samples.length} real samples · ${ecgTelemetry.sampleRate} Hz nominal · auto gain`
              : ecgTelemetry.leadOff
                ? "Waveform hidden — electrode leads are disconnected"
                : "Waiting for fresh ECG samples from ESP32"}
          </span>

          {ecgSignalReady ? (
            <>
              <svg className="ecg-wave" viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true">
                <path
                  className="ecg-trace-shadow"
                  d={buildEcgPath(ecgTelemetry.samples)}
                />
                <path
                  className="ecg-trace"
                  d={buildEcgPath(ecgTelemetry.samples)}
                />
              </svg>
              <div className="ecg-sweep" />
            </>
          ) : (
            <div className="ecg-no-signal">
              {ecgTelemetry.leadOff
                ? "NO ELECTRODE CONTACT"
                : "NO FRESH ECG DATA"}
            </div>
          )}
        </div>

        <div className="ecg-footer">
          <div>
            <span className="ecg-metric-label">HEART RATE</span>
            <strong>{vitals.heartRate > 0 ? `${vitals.heartRate} BPM` : "--"}</strong>
          </div>
          <div>
            <span className="ecg-metric-label">ELECTRODE STATUS</span>
            <strong>{ecgTelemetry.leadOff ? "LEAD OFF" : "CONNECTED"}</strong>
          </div>
          <div>
            <span className="ecg-metric-label">LATEST ADC VALUE</span>
            <strong>{ecgSignalReady ? ecgTelemetry.raw : "--"}</strong>
          </div>
        </div>
        <p className="ecg-disclaimer">
          ECG display uses only actual AD8232 samples. Auto gain makes low-amplitude signal changes easier to see;
          it does not create a heartbeat or diagnose heart rate. This is an educational prototype, not a medical device.
        </p>
      </section>

      {/* =================================================
          CONDITION TREND
      ================================================= */}

      <section className="panel">

        <div className="panel-title">

          <h2>
            📈 Patient Condition Trend
          </h2>

          <span className="live">
            LIVE
          </span>

        </div>

        <div
          style={{
            overflowX: "auto"
          }}
        >

          <table
            style={{
              width: "100%",
              borderCollapse:
                "collapse"
            }}
          >

            <thead>

              <tr>

                <th>
                  Time
                </th>

                <th>
                  ❤️ HR
                </th>

                <th>
                  🫁 SpO₂
                </th>

                <th>
                  🌡️ Temp
                </th>

              </tr>

            </thead>

            <tbody>

              {vitalHistory.map(
                (item, index) => (

                  <tr
                    key={index}
                  >

                    <td>
                      {item.time}
                    </td>

                    <td>
                      {item.heartRate}
                    </td>

                    <td>
                      {item.spo2}%
                    </td>

                    <td>
                      {item.temperature}°C
                    </td>

                  </tr>

                )
              )}

            </tbody>

          </table>

        </div>

      </section>


      {/* =================================================
          ALERT
      ================================================= */}

      {alert && (

        <section
          className={
            `alert-banner ${alert.type}`
          }
        >

          <div className="alert-icon">
            🚨
          </div>

          <div>

            <strong>

              {alert.type ===
              "critical"
                ? "CRITICAL ALERT"
                : "WARNING"}

            </strong>

            <p>
              {alert.message}
            </p>

          </div>

          <button
            onClick={
              acknowledgeAlert
            }
          >

            ACKNOWLEDGE

          </button>

        </section>

      )}


      {/* =================================================
          INTER AMBULANCE ASSISTANCE
      ================================================= */}

      {assistanceRequested && (

        <section className="assistance-panel">

          <div className="assistance-header">

            <div>

              <h2>
                🚨 Inter-Ambulance
                Emergency Assistance
              </h2>

              <p>
                Ambulance A-01 requires
                emergency assistance.
              </p>

            </div>

            <span className="assistance-status">

              {assistanceAccepted

                ? "ASSISTANCE ACCEPTED"

                : assistanceDeclined

                ? "REQUEST DECLINED"

                : "REQUEST SENT"}

            </span>

          </div>

          <div className="assistance-details">

            <div className="emergency-location">

              <span className="big-icon">
                📍
              </span>

              <div>

                <small>
                  Emergency Location
                </small>

                <strong>

                  {gpsStatus.valid && Number.isFinite(location.latitude)
              ? location.latitude.toFixed(6)
              : "Waiting for GPS fix"}

                  {" , "}

                  {gpsStatus.valid && Number.isFinite(location.longitude)
              ? location.longitude.toFixed(6)
              : "Waiting for GPS fix"}

                </strong>

              </div>

            </div>

            <div className="patient-emergency">

              <span className="big-icon">
                ❤️
              </span>

              <div>

                <small>
                  Patient Condition
                </small>

                <strong>
                  {status}
                </strong>

              </div>

            </div>

            <div className="assistance-ambulance">

              <span className="big-icon">
                🚑
              </span>

              <div>

                <small>
                  Nearest Available Ambulance
                </small>

                <strong>
                  Ambulance A-02
                </strong>

                <p>
                  Assistance response
                </p>

              </div>

            </div>

            {!assistanceAccepted &&
            !assistanceDeclined ? (

              <div className="assistance-actions">

                <button
                  className="accept-button"
                  onClick={
                    acceptAssistance
                  }
                >

                  🚑 Accept Assistance

                </button>

                <button
                  className="decline-button"
                  onClick={
                    declineAssistance
                  }
                >

                  ❌ Decline

                </button>

              </div>

            ) : assistanceAccepted ? (

              <div className="accepted-message">

                ✓ Ambulance A-02
                is responding

              </div>

            ) : (

              <div className="declined-message">

                ❌ Request declined —
                searching for another ambulance

              </div>

            )}

          </div>

        </section>

      )}


      {/* =================================================
          MAIN GRID
      ================================================= */}

      <section className="main-grid">

        {/* ===============================================
            LOCATION
        =============================================== */}

        <div className="panel">

          <div className="panel-title">

            <h2>
              📍 Ambulance Location
            </h2>

            <span className="live">
              {gpsStatus.valid ? "GPS LIVE" : "GPS WAITING"}
            </span>

          </div>

          <div className="map real-map">
            {gpsStatus.valid &&
             Number.isFinite(location.latitude) &&
             Number.isFinite(location.longitude) ? (
              <iframe
                title="Live ambulance GPS map"
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${location.longitude - 0.025}%2C${location.latitude - 0.018}%2C${location.longitude + 0.025}%2C${location.latitude + 0.018}&layer=mapnik&marker=${location.latitude}%2C${location.longitude}`}
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <div className="map-waiting">
                <span>📡</span>
                <strong>Waiting for live NEO-6M GPS fix</strong>
                <small>Real map will appear when the ESP32 reports valid coordinates.</small>
              </div>
            )}
          </div>

          <div className="coordinates">

            📍 Latitude:
            {" "}
            {gpsStatus.valid && Number.isFinite(location.latitude)
              ? location.latitude.toFixed(6)
              : "Waiting for GPS fix"}

            &nbsp;&nbsp;

            Longitude:
            {" "}
            {gpsStatus.valid && Number.isFinite(location.longitude)
              ? location.longitude.toFixed(6)
              : "Waiting for GPS fix"}

          </div>

          <div className="coordinates" style={{ marginTop: "8px" }}>
            <strong>GPS:</strong> {gpsStatus.valid ? "FIXED" : "NO FIX"}
            &nbsp; | &nbsp; Satellites: {gpsStatus.satellites}
            {gpsStatus.hdop !== null && (
              <> &nbsp; | &nbsp; HDOP: {gpsStatus.hdop}</>
            )}
            <br />
            <small>Source: {gpsStatus.source}</small>
            {hospital.latitude != null && hospital.longitude != null && (
              <>
                <br />
                <a
                  href={`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${location.latitude}%2C${location.longitude}%3B${hospital.latitude}%2C${hospital.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open real hospital route ↗
                </a>
              </>
            )}
          </div>

        </div>


        {/* ===============================================
            HOSPITAL & ROUTE
        =============================================== */}

        <div className="panel">

          <div className="panel-title">

            <h2>
              🏥 Intelligent Hospital
            </h2>

          </div>

          <div className="route-card">

            <div className="location">

              <span className="dot blue"></span>

              <div>

                <small>
                  Ambulance
                </small>

                <strong>
                  A-01
                </strong>

              </div>

            </div>

            <div className="route-line">
              ↓
            </div>

            <div className="location">

              <span className="dot red"></span>

              <div>

                <small>
                  Recommended Hospital
                </small>

                <strong>

                  {bestRoute
                    ? bestRoute.destination
                    : hospital.name}

                </strong>

              </div>

            </div>

          </div>

          {hospital.address && (
            <p className="hospital-address">
              <strong>Address:</strong> {hospital.address}
              <span>Data source: OpenStreetMap</span>
            </p>
          )}

          <div className="route-stats">

            <div>

              <small>
                Distance
              </small>

              <strong>

                {bestRoute?.distance != null
                  ? `${bestRoute.distance} km`
                  : hospital.distance != null
                    ? `${hospital.distance} km`
                    : "—"}

              </strong>

            </div>

            <div>

              <small>
                Traffic
              </small>

              <strong>

                Not provided

              </strong>

            </div>

            <div>

              <small>
                Beds
              </small>

              <strong>

                Not provided

              </strong>

            </div>

          </div>

          {nearbyHospitals.length > 0 && (
            <div className="nearby-hospital-list">
              <h3>Nearby real hospitals</h3>
              {nearbyHospitals.slice(0, 5).map(item => (
                <div className="nearby-hospital-row" key={item.id}>
                  <span>🏥</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.address || "Address not listed"} · {item.straightLineDistance} km straight-line
                    </small>
                  </div>
                </div>
              ))}
              <small className="osm-credit">Hospital listings © OpenStreetMap contributors</small>
            </div>
          )}

          <button
            className="route-button"
            onClick={viewBestRoute}
          >

            🗺️ View Best Route

          </button>


          {/* =====================================================
              BEST ROUTE RESULT
          ===================================================== */}

          {bestRoute && (

            <div
              className="best-route-result"
              style={{
                marginTop: "18px",
                padding: "20px",
                borderRadius: "14px",
                background: "#ecfdf5",
                border: "2px solid #22c55e"
              }}
            >

              <h3
                style={{
                  marginTop: 0,
                  color: "#166534"
                }}
              >
                ✅ BEST ROUTE SELECTED
              </h3>

              <div
                style={{
                  display: "grid",
                  gap: "10px"
                }}
              >

                <p>
                  🏥 <strong>Hospital:</strong>{" "}
                  {bestRoute.destination}
                </p>

                <p>
                  📏 <strong>Distance:</strong>{" "}
                  {bestRoute.distance} km
                </p>

                <p>
                  ⏱️ <strong>Estimated Time:</strong>{" "}
                  {bestRoute.estimatedTime} min
                </p>

                <p>
                  🚦 <strong>Traffic:</strong>{" "}
                  {bestRoute.traffic}
                </p>

                <p>
                  🛏️ <strong>Available Beds:</strong>{" "}
                  {bestRoute.availableBeds}
                </p>

              </div>

              <div
                style={{
                  marginTop: "15px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "white",
                  fontWeight: "700",
                  color: "#166534",
                  textAlign: "center"
                }}
              >
                🚑 Ambulance A-01 → {bestRoute.destination}
              </div>

            </div>

          )}

        </div>


        {/* ===============================================
            DYNAMIC HOSPITAL CHANGE
        =============================================== */}

        <div className="panel">

          <div className="panel-title">

            <h2>
              🔄 Dynamic Hospital Decision
            </h2>

          </div>

          <p>

            System continuously evaluates
            hospital distance, traffic,
            beds and ETA.

          </p>

          <button
            className="route-button"
            onClick={
              evaluateHospitalChange
            }
          >

            🔄 Re-evaluate Hospital

          </button>

          {hospitalChangeSuggestion && (

            <div
              className="best-route-result"
            >

              <strong>
                HOSPITAL DECISION
              </strong>

              <p>

                Current:
                {" "}
                {hospitalChangeSuggestion.current}

              </p>

              <p>

                Suggested:
                {" "}
                {hospitalChangeSuggestion.suggested}

              </p>

              <p>

                Reason:
                {" "}
                {hospitalChangeSuggestion.reason}

              </p>

            </div>

          )}

        </div>


        {/* ===============================================
            PATIENT HANDOVER
        =============================================== */}

        <div className="panel">

          <div className="panel-title">

            <h2>
              🔄 Patient Handover Continuity
            </h2>

          </div>

          <div
            style={{
              padding: "18px",
              textAlign: "center",
              background: "#f8fafc",
              borderRadius: "12px"
            }}
          >

            <div
              style={{
                fontSize: "35px"
              }}
            >
              🚑 A-01
              {" → "}
              🚑 A-02
            </div>

            <h3>

              {handoverStatus ===
              "NOT_REQUIRED"

                ? "Handover Ready"

                : handoverStatus ===
                  "HANDOVER_IN_PROGRESS"

                ? "Handover In Progress"

                : "Handover Completed"}

            </h3>

            <p>

              Patient information, vitals,
              trend, location and hospital
              details remain connected.

            </p>

            <button
              className="route-button"
              onClick={
                startHandover
              }
            >

              🔄 Start Digital Handover

            </button>

          </div>

          {handoverHistory.length >
            0 && (

            <div
              className=
                "best-route-result"
            >

              <strong>
                HANDOVER HISTORY
              </strong>

              {handoverHistory.map(
                (item, index) => (

                  <p key={index}>

                    🚑 {item.from}
                    {" → "}
                    {item.to}
                    {" | "}
                    {item.patient}
                    {" | "}
                    {item.time}

                  </p>

                )
              )}

            </div>

          )}

        </div>


        {/* ===============================================
            ALERTS
        =============================================== */}

        <div className="panel alerts-panel">

          <div className="panel-title">

            <h2>
              🚨 Emergency Alerts
            </h2>

            <span
              className={
                alert
                  ? "alert-count active"
                  : "alert-count"
              }
            >

              {alert
                ? "1 ACTIVE"
                : "0 ACTIVE"}

            </span>

          </div>

          {alert ? (

            <div className="active-alert">

              <div className="big-alert-icon">
                🚨
              </div>

              <h3>

                {alert.type ===
                "critical"
                  ? "CRITICAL ALERT"
                  : "WARNING"}

              </h3>

              <p>
                {alert.message}
              </p>

              <button
                onClick={
                  acknowledgeAlert
                }
              >

                ACKNOWLEDGE

              </button>

            </div>

          ) : (

            <div className="no-alert">

              <div>
                ✓
              </div>

              <h3>
                No Active Emergency
              </h3>

              <p>
                The ambulance is
                operating normally.
              </p>

            </div>

          )}

        </div>


        {/* ===============================================
            NEARBY AMBULANCES
        =============================================== */}

        <div className="panel">

          <div className="panel-title">

            <h2>
              🚑 Nearby Ambulances
            </h2>

          </div>

          <div className="ambulance-list">

            <div
              className={
                `ambulance-item ${
                  assistanceRequested
                    ? "assistance-active"
                    : ""
                }`
              }
            >

              <div className="ambulance-icon">
                🚑
              </div>

              <div>

                <strong>
                  Ambulance A-02
                </strong>

                <p>
                  Nearby ambulance
                </p>

              </div>

              {assistanceAccepted ? (

                <span className="responding">
                  RESPONDING
                </span>

              ) : assistanceDeclined ? (

                <span className="busy">
                  DECLINED
                </span>

              ) : (

                <span className="available">
                  AVAILABLE
                </span>

              )}

            </div>


            <div className="ambulance-item">

              <div className="ambulance-icon">
                🚑
              </div>

              <div>

                <strong>
                  Ambulance A-03
                </strong>

                <p>
                  Backup ambulance
                </p>

              </div>

              <span className="busy">
                BUSY
              </span>

            </div>

          </div>

        </div>

      </section>


      {/* =================================================
          FOOTER
      ================================================= */}

      <footer>

        <span>
          ResQLink • Intelligent Ambulance IoT System
        </span>

        <span>

          Last Updated:
          {" "}
          {lastUpdated.toLocaleTimeString()}

        </span>

      </footer>

    </div>

  );
}

export default App;