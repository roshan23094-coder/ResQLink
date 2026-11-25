import { useEffect, useState } from "react";
import "./App.css";

// Deployed ResQLink backend on Render.
// For local development, set VITE_API_URL in client/.env.local if needed.
const API_URL = import.meta.env.VITE_API_URL || "https://resqlink-backend-18mu.onrender.com";

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

  const [portal, setPortal] = useState("choose");
  const [adminRequests, setAdminRequests] = useState([]);
  const [adminRfidScans, setAdminRfidScans] = useState([]);
  const [requestDecisionBusy, setRequestDecisionBusy] = useState("");
  const [portalRfidMessage, setPortalRfidMessage] = useState("");

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

  // Patient digital medical records
  const emptyPatientForm = {
    id: "",
    name: "",
    age: "",
    bloodGroup: "",
    phone: "",
    allergies: "",
    medicalHistory: "",
    emergencyContact: "",
    notes: ""
  };
  const [patientRecords, setPatientRecords] = useState([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientForm, setPatientForm] = useState(emptyPatientForm);
  const [editingPatientId, setEditingPatientId] = useState(null);
  const [patientSaveMessage, setPatientSaveMessage] = useState("");
  const [patientSaveError, setPatientSaveError] = useState("");
  const [pendingRfidUid, setPendingRfidUid] = useState("");

  // Modules 4â€“7 workflow dashboard
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [hospitalInbox, setHospitalInbox] = useState([]);
  const [handoverRecords, setHandoverRecords] = useState([]);
  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workflowError, setWorkflowError] = useState("");
  const [preArrivalHospital, setPreArrivalHospital] = useState("");
  const [preArrivalEmergencyId, setPreArrivalEmergencyId] = useState("");
  const [handoverEmergencyId, setHandoverEmergencyId] = useState("");
  const [handoverFrom, setHandoverFrom] = useState("A-01");
  const [handoverTo, setHandoverTo] = useState("A-02");
  const [savingPatient, setSavingPatient] = useState(false);

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
  // HOSPITAL MANAGEMENT (MODULE 2)
  // =====================================================

  const emptyHospitalForm = {
    name: "", address: "", latitude: "", longitude: "",
    emergencyDepartmentAvailable: false,
    icuBedsAvailable: "", icuBedsTotal: "",
    generalBedsAvailable: "", generalBedsTotal: "",
    specialFacilities: "", ambulanceAcceptance: "UNKNOWN"
  };
  const [hospitalDirectory, setHospitalDirectory] = useState([]);
  const [selectedManagedHospitalId, setSelectedManagedHospitalId] = useState("");
  const [hospitalForm, setHospitalForm] = useState(emptyHospitalForm);
  const [hospitalManagementLoading, setHospitalManagementLoading] = useState(false);
  const [hospitalManagementSaving, setHospitalManagementSaving] = useState(false);
  const [hospitalManagementMessage, setHospitalManagementMessage] = useState("");
  const [addingManualHospital, setAddingManualHospital] = useState(false);

  const fetchHospitalDirectory = async () => {
    setHospitalManagementLoading(true);
    try {
      const query = gpsStatus.valid && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
        ? `?latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}`
        : "";
      const response = await fetch(`${API_URL}/api/hospitals/management${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Hospital directory unavailable");
      const records = Array.isArray(data.hospitals) ? data.hospitals : [];
      setHospitalDirectory(records);
      setHospitalManagementMessage(data.capacityDisclaimer || "");
      if (selectedManagedHospitalId) {
        const current = records.find(item => item.id === selectedManagedHospitalId);
        if (current) loadHospitalIntoForm(current);
      }
    } catch (error) {
      console.error("Hospital management load failed:", error);
      setHospitalManagementMessage(error.message || "Unable to load hospital directory.");
    } finally {
      setHospitalManagementLoading(false);
    }
  };

  const loadHospitalIntoForm = (item) => {
    setSelectedManagedHospitalId(item.id);
    setAddingManualHospital(false);
    setHospitalForm({
      name: item.name || "", address: item.address || "",
      latitude: item.latitude ?? "", longitude: item.longitude ?? "",
      emergencyDepartmentAvailable: item.emergencyDepartmentAvailable === true,
      icuBedsAvailable: item.icuBedsAvailable ?? "", icuBedsTotal: item.icuBedsTotal ?? "",
      generalBedsAvailable: item.generalBedsAvailable ?? "", generalBedsTotal: item.generalBedsTotal ?? "",
      specialFacilities: Array.isArray(item.specialFacilities) ? item.specialFacilities.join(", ") : "",
      ambulanceAcceptance: item.ambulanceAcceptance || "UNKNOWN"
    });
  };

  const startManualHospital = () => {
    setSelectedManagedHospitalId("");
    setAddingManualHospital(true);
    setHospitalForm(emptyHospitalForm);
    setHospitalManagementMessage("Enter the real hospital name and coordinates. Confirm the location before saving.");
  };

  const saveHospitalManagement = async (event) => {
    event.preventDefault();
    setHospitalManagementSaving(true);
    setHospitalManagementMessage("");
    try {
      const id = selectedManagedHospitalId || `manual-${Date.now()}`;
      const payload = {
        id, name: hospitalForm.name.trim(), address: hospitalForm.address.trim(),
        latitude: Number(hospitalForm.latitude), longitude: Number(hospitalForm.longitude),
        emergencyDepartmentAvailable: hospitalForm.emergencyDepartmentAvailable,
        icuBedsAvailable: hospitalForm.icuBedsAvailable, icuBedsTotal: hospitalForm.icuBedsTotal,
        generalBedsAvailable: hospitalForm.generalBedsAvailable, generalBedsTotal: hospitalForm.generalBedsTotal,
        specialFacilities: hospitalForm.specialFacilities.split(",").map(value => value.trim()).filter(Boolean),
        ambulanceAcceptance: hospitalForm.ambulanceAcceptance, manual: addingManualHospital
      };
      const response = await fetch(`${API_URL}/api/hospitals/management`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Hospital details could not be saved");
      setHospitalManagementMessage("Hospital details saved. Capacity values are prototype-managed and were timestamped.");
      setSelectedManagedHospitalId(data.hospital.id);
      setAddingManualHospital(false);
      await fetchHospitalDirectory();
    } catch (error) {
      setHospitalManagementMessage(error.message || "Hospital save failed.");
    } finally {
      setHospitalManagementSaving(false);
    }
  };

  const resetHospitalManagement = async () => {
    if (!selectedManagedHospitalId) return;
    try {
      const response = await fetch(`${API_URL}/api/hospitals/management/${encodeURIComponent(selectedManagedHospitalId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not reset hospital details");
      setSelectedManagedHospitalId("");
      setHospitalForm(emptyHospitalForm);
      setHospitalManagementMessage("Managed capacity details reset. The real hospital listing remains available.");
      await fetchHospitalDirectory();
    } catch (error) {
      setHospitalManagementMessage(error.message || "Reset failed.");
    }
  };

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

  const fetchAdminPortalData = async () => {
    try {
      const [requestsResponse, scansResponse] = await Promise.all([
        fetch(`${API_URL}/api/ambulance/requests`),
        fetch(`${API_URL}/api/rfid/scans`)
      ]);
      if (requestsResponse.ok) {
        const data = await requestsResponse.json();
        setAdminRequests(Array.isArray(data.requests) ? data.requests : []);
      }
      if (scansResponse.ok) {
        const data = await scansResponse.json();
        setAdminRfidScans(Array.isArray(data.scans) ? data.scans : []);
      }
    } catch (error) { console.error("Admin portal refresh failed:", error); }
  };

  const decideAmbulanceRequest = async (requestId, decision) => {
    setRequestDecisionBusy(requestId);
    try {
      const response = await fetch(`${API_URL}/api/ambulance/request/${decision}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Request update failed.");
      await fetchAdminPortalData();
    } catch (error) { window.alert(error.message || "Request update failed."); }
    finally { setRequestDecisionBusy(""); }
  };

  useEffect(() => {
    if (portal !== "admin") return;
    fetchAdminPortalData();
    const timer = setInterval(fetchAdminPortalData, 3000);
    return () => clearInterval(timer);
  }, [portal]);

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
              "PENDING",

            ambulance:
              data.ambulance ||
              "Searching for nearest ambulance",

            latitude,
            longitude

          });

          setAlert({

            type: "warning",

            message:
              `Ambulance request ${data.requestId || ""} submitted. Waiting for Admin Portal approval.`

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
          `âœ“ Best route selected: ${data.route.destination} â€” ${data.route.distance} km, ETA ${data.route.estimatedTime} min.`
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
      const response = await fetch(`${API_URL}/api/rfid/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      if (!response.ok) {
        setRfidStatus(data.rfid?.status || "UNKNOWN_CARD");
        setPortalRfidMessage(data.message || "RFID card could not be identified. The scan is recorded in the Admin Portal.");
        setPendingRfidUid(data.rfid?.uid || "");
        setPatient({ id: null, name: null, age: null, bloodGroup: null });
        setEditingPatientId(null);
        setPatientForm({ ...emptyPatientForm, rfidUid: data.rfid?.uid || "" });
        setPatientSaveError(data.message || "Unknown RFID card. You can register this patient now.");
        setPatientSaveMessage(data.rfid?.uid ? `New RFID card detected (${data.rfid.uid}). Enter patient details to link this card.` : "No registered patient found. You can continue with manual registration.");
        return;
      }
      setRfidStatus("IDENTIFIED");
      setPortalRfidMessage(`Patient identified: ${data.patient.name} (${data.patient.id}). Details are visible in the Admin Portal.`);
      setPendingRfidUid(data.rfid?.uid || data.patient.rfidUid || "");
      setPatient(data.patient);
      setPatientForm({
        id: data.patient.id || "",
        rfidUid: data.patient.rfidUid || data.rfid?.uid || "",
        name: data.patient.name || "",
        age: data.patient.age ?? "",
        bloodGroup: data.patient.bloodGroup || "",
        phone: data.patient.phone || "",
        allergies: (data.patient.allergies || []).join(", "),
        medicalHistory: data.patient.medicalHistory || "",
        emergencyContact: data.patient.emergencyContact || "",
        notes: data.patient.notes || ""
      });
      setEditingPatientId(data.patient.id);
      setPatientSaveMessage(`Patient ${data.patient.id} identified. Medical record loaded.`);
      setPatientSaveError("");
      await fetchPatientRecords();
      await fetchAmbulanceData();
    } catch (error) {
      console.error("RFID error:", error);
      setPatientSaveError("RFID scan failed. Check the backend connection.");
      setPortalRfidMessage("RFID scan failed. Check the backend connection.");
    }
  };

  const fetchPatientRecords = async () => {
    try {
      const response = await fetch(`${API_URL}/api/patients`);
      if (!response.ok) throw new Error("Unable to load patient records.");
      const data = await response.json();
      setPatientRecords(data.patients || []);
    } catch (error) {
      console.error("Patient records:", error);
    }
  };

  const updatePatientForm = (event) => {
    const { name, value } = event.target;
    setPatientForm(previous => ({ ...previous, [name]: value }));
  };

  const savePatientRecord = async (event) => {
    event.preventDefault();
    setSavingPatient(true);
    setPatientSaveError("");
    setPatientSaveMessage("");
    try {
      const isEditing = Boolean(editingPatientId);
      const url = isEditing
        ? `${API_URL}/api/patients/${encodeURIComponent(editingPatientId)}`
        : `${API_URL}/api/patients`;
      const response = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...patientForm,
          rfidUid: patientForm.rfidUid || pendingRfidUid || "",
          age: patientForm.age === "" ? null : Number(patientForm.age),
          allergies: patientForm.allergies.split(",").map(item => item.trim()).filter(Boolean)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to save patient record.");
      setPatient(data.patient);
      setRfidStatus(data.patient.rfidUid ? "IDENTIFIED" : "NOT_SCANNED");
      setPendingRfidUid(data.patient.rfidUid || "");
      setEditingPatientId(data.patient.id);
      setPatientForm({
        ...data.patient,
        rfidUid: data.patient.rfidUid || "",
        age: data.patient.age ?? "",
        allergies: (data.patient.allergies || []).join(", ")
      });
      setPatientSaveMessage(`Patient record ${isEditing ? "updated" : "created"} successfully.`);
      await fetchPatientRecords();
    } catch (error) {
      setPatientSaveError(error.message);
    } finally {
      setSavingPatient(false);
    }
  };

  const selectPatientRecord = async (record) => {
    try {
      const response = await fetch(`${API_URL}/api/patients/${encodeURIComponent(record.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load patient.");
      const p = data.patient;
      setPatient(p);
      setRfidStatus(p.rfidUid ? "IDENTIFIED" : "NOT_SCANNED");
      setPendingRfidUid(p.rfidUid || "");
      setEditingPatientId(p.id);
      setPatientForm({
        id: p.id || "",
        rfidUid: p.rfidUid || "",
        name: p.name || "",
        age: p.age ?? "",
        bloodGroup: p.bloodGroup || "",
        phone: p.phone || "",
        allergies: (p.allergies || []).join(", "),
        medicalHistory: p.medicalHistory || "",
        emergencyContact: p.emergencyContact || "",
        notes: p.notes || ""
      });
      setPatientSaveMessage(`Loaded ${p.id}.`);
      setPatientSaveError("");
    } catch (error) {
      setPatientSaveError(error.message);
    }
  };

  const startNewPatient = () => {
    setPatientForm({ ...emptyPatientForm, rfidUid: "" });
    setPendingRfidUid("");
    setEditingPatientId(null);
    setPatient({ id: null, name: null, age: null, bloodGroup: null });
    setRfidStatus("NOT_SCANNED");
    setPatientSaveMessage("Enter the details to create a temporary or registered patient record.");
    setPatientSaveError("");
  };

  const saveEmergencySnapshot = async () => {
    if (!patient.id) {
      setPatientSaveError("Select or create a patient record first.");
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/patients/${encodeURIComponent(patient.id)}/emergency-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ambulanceId: "A-01",
          emergencyType: emergencyMode ? "ACTIVE_EMERGENCY" : "PATIENT_MONITORING",
          notes: "Snapshot saved from the ResQLink ambulance dashboard."
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to save emergency snapshot.");
      setPatient(data.patient);
      await fetchPatientRecords();
      setPatientSaveMessage("Emergency snapshot and currently valid sensor readings saved to the patient record.");
    } catch (error) {
      setPatientSaveError(error.message);
    }
  };


  const loadAdvancedModules = async () => {
    const endpoints = [
      ["/api/clinical/risk-assessment", setRiskAssessment, null],
      ["/api/hospital-notifications", setHospitalInbox, "notifications"],
      ["/api/handovers", setHandoverRecords, "handovers"],
      ["/api/analytics/summary", setAnalyticsSummary, null]
    ];
    await Promise.all(endpoints.map(async ([path, setter, field]) => {
      try {
        const response = await fetch(`${API_URL}${path}`);
        if (!response.ok) throw new Error(`${path} failed`);
        const data = await response.json();
        setter(field ? data[field] : data);
      } catch (error) {
        console.warn("Advanced module load:", error.message);
      }
    }));
  };

  const sendHospitalPreArrival = async (event) => {
    event.preventDefault();
    setWorkflowError(""); setWorkflowMessage("");
    try {
      const emergencyId = preArrivalEmergencyId.trim() || ambulanceRequest?.requestId || `DEMO-${Date.now()}`;
      const response = await fetch(`${API_URL}/api/hospital-notifications`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emergencyId, hospitalName: preArrivalHospital,
          ambulanceId: "A-01", patientId: patient.id || null,
          patientName: patient.name || null,
          latitude: gpsStatus.valid ? location.latitude : null,
          longitude: gpsStatus.valid ? location.longitude : null
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create notification.");
      setWorkflowMessage(data.message);
      await loadAdvancedModules();
    } catch (error) { setWorkflowError(error.message); }
  };

  const acknowledgeHospitalNotification = async (id) => {
    try {
      const response = await fetch(`${API_URL}/api/hospital-notifications/${encodeURIComponent(id)}/acknowledge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffName: "Demo receiving staff" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Acknowledgement failed.");
      setWorkflowMessage("Hospital notification acknowledged in the prototype inbox.");
      await loadAdvancedModules();
    } catch (error) { setWorkflowError(error.message); }
  };

  const createPatientHandover = async (event) => {
    event.preventDefault();
    setWorkflowError(""); setWorkflowMessage("");
    try {
      const response = await fetch(`${API_URL}/api/handovers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emergencyId: handoverEmergencyId.trim() || ambulanceRequest?.requestId || `DEMO-${Date.now()}`,
          patientId: patient.id || null, fromAmbulance: handoverFrom, toAmbulance: handoverTo
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create handover.");
      setWorkflowMessage(`Handover ${data.handover.handoverId} created. Awaiting receiving crew acknowledgement.`);
      await loadAdvancedModules();
    } catch (error) { setWorkflowError(error.message); }
  };

  const acknowledgeHandover = async (id) => {
    try {
      const response = await fetch(`${API_URL}/api/handovers/${encodeURIComponent(id)}/acknowledge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receivingStaff: "Demo receiving crew" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Handover acknowledgement failed.");
      setWorkflowMessage("Receiving ambulance acknowledged the patient transfer.");
      await loadAdvancedModules();
    } catch (error) { setWorkflowError(error.message); }
  };

  const printAnalyticsReport = () => {
    if (!analyticsSummary) return;
    const events = (analyticsSummary.eventHistory || []).map(event =>
      `<tr><td>${String(event.type || "").replace(/[&<>"]/g, "")}</td><td>${new Date(event.occurredAt).toLocaleString()}</td><td>${String(JSON.stringify(event.details || {})).replace(/[&<>"]/g, "")}</td></tr>`
    ).join("");
    const html = `<!doctype html><html><head><title>ResQLink Emergency Report</title><style>
      body{font:14px Arial,sans-serif;color:#172033;padding:32px}h1{color:#123b63}
      .grid{display:flex;gap:16px;margin:24px 0}.kpi{border:1px solid #ccd5e0;padding:14px;flex:1}
      table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border:1px solid #ccd5e0;padding:8px;text-align:left}
      small{color:#58677a}.note{margin-top:24px;font-size:11px}
      </style></head><body><h1>ResQLink Emergency Analytics Report</h1>
      <p>Generated: ${new Date().toLocaleString()}</p><div class="grid">
      <div class="kpi"><strong>${analyticsSummary.totalEmergencyEvents}</strong><br/>Emergency-related events</div>
      <div class="kpi"><strong>${analyticsSummary.averageResponseMinutes ?? "Not available"}</strong><br/>Average response minutes</div>
      <div class="kpi"><strong>${analyticsSummary.responseSamples}</strong><br/>Recorded response samples</div></div>
      <h2>Ambulance status</h2><p>${Object.entries(analyticsSummary.ambulanceStatusCounts || {}).map(([k,v]) => `${k}: ${v}`).join(" Â· ") || "No data"}</p>
      <h2>Hospital notifications</h2><p>${Object.entries(analyticsSummary.hospitalNotificationCounts || {}).map(([k,v]) => `${k}: ${v}`).join(" Â· ") || "No data"}</p>
      <h2>Emergency event history</h2><table><thead><tr><th>Event</th><th>Time</th><th>Details</th></tr></thead><tbody>${events || "<tr><td colspan='3'>No recorded events</td></tr>"}</tbody></table>
      <p class="note">Prototype analytics based on records currently stored by ResQLink. This report is not a certified EMS performance report. Missing response-time samples are not treated as zero.</p>
      <script>window.onload=()=>window.print();</script></body></html>`;
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) { setWorkflowError("Allow pop-ups to generate the printable PDF report."); return; }
    reportWindow.document.write(html);
    reportWindow.document.close();
  };

  const downloadAnalyticsCsv = () => {
    if (!analyticsSummary) return;
    const rows = [["Metric","Value"],
      ["Total emergency events", analyticsSummary.totalEmergencyEvents],
      ["Average response minutes", analyticsSummary.averageResponseMinutes ?? "Not enough recorded samples"],
      ["Response samples", analyticsSummary.responseSamples],
      ...Object.entries(analyticsSummary.ambulanceStatusCounts || {}).map(([k,v]) => [`Ambulance ${k}`,v]),
      ...Object.entries(analyticsSummary.hospitalNotificationCounts || {}).map(([k,v]) => [`Hospital ${k}`,v])
    ];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "resqlink-analytics.csv"; link.click();
    URL.revokeObjectURL(url);
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
          "ðŸš‘ Ambulance request accepted. The assigned ambulance is now en route."
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
          "ðŸš¨ Ambulance emergency detected. Assistance request sent."

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
          "âœ“ Digital patient handover completed. Journey continuity maintained."

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

  useEffect(() => {
    fetchHospitalDirectory();
    // The directory is refreshed on demand; capacity values are not polled as live hospital data.
  }, []);

  useEffect(() => {
    if (gpsStatus.valid) fetchHospitalDirectory();
  }, [gpsStatus.valid]);

  const ecgDataFresh =
    ecgTelemetry.updatedAt &&
    (Date.now() - new Date(ecgTelemetry.updatedAt).getTime()) < 5000;

  const ecgSignalReady =
    !ecgTelemetry.leadOff &&
    ecgTelemetry.samples.length > 1 &&
    Boolean(ecgDataFresh);

  if (portal === "choose") return (
    <main className="portal-gateway"><section className="portal-gateway-card">
      <h1>ðŸš‘ ResQLink</h1><p>Intelligent Ambulance System</p><h2>Select your portal</h2>
      <div className="portal-gateway-actions">
        <button onClick={() => setPortal("user")}><span>ðŸ§‘â€ðŸ¦½</span><strong>User Portal</strong><small>Request an ambulance or scan RFID</small></button>
        <button onClick={() => setPortal("admin")}><span>ðŸ›¡ï¸</span><strong>Admin Portal</strong><small>Manage requests and monitor the ambulance system</small></button>
      </div>
    </section></main>
  );

  if (portal === "user") return (
    <main className="portal-gateway"><section className="user-portal-panel">
      <button className="portal-back-button" onClick={() => setPortal("choose")}>â† Back to portal selection</button>
      <h1>ðŸš‘ ResQLink â€“ User Portal</h1><p className="portal-subtitle">Choose one of the two available services.</p>
      <div className="user-service-grid">
        <article className="user-service-card"><div className="service-icon">ðŸš¨</div><h2>Request Ambulance</h2>
          <p>Share your current location and send an emergency ambulance request.</p>
          <button disabled={requestingAmbulance} onClick={requestAmbulance}>{requestingAmbulance ? "Getting your location..." : "REQUEST AMBULANCE"}</button>
          {requestError && <p className="portal-feedback error">{requestError}</p>}
          {ambulanceRequest && <div className="portal-feedback success"><b>Request submitted</b><br/>Request ID: {ambulanceRequest.requestId}<br/>Status: {ambulanceRequest.status || "PENDING"}<br/>Waiting for the Admin Portal to accept or reject your request.</div>}
        </article>
        <article className="user-service-card"><div className="service-icon">ðŸ“¡</div><h2>Scan RFID</h2>
          <p>Scan a registered patient card. The scan and patient details will appear in the Admin Portal.</p>
          <button onClick={async () => { setPortalRfidMessage("Waiting for RFID scan..."); await scanRFID(); }}>SCAN RFID CARD</button>
          {portalRfidMessage && <div className="portal-feedback">{portalRfidMessage}</div>}
          {patient?.id && <div className="portal-feedback success"><b>Patient identified</b><br/>Patient: {patient.name}<br/>Patient ID: {patient.id}<br/>Blood group: {patient.bloodGroup || "Not recorded"}</div>}
        </article>
      </div>
    </section></main>
  );

  return (

    <div className="app">
      <div className="admin-portal-bar">
        <div><strong>ðŸ›¡ï¸ Admin Portal</strong><span>Incoming requests Â· RFID records Â· Live monitoring</span></div>
        <button className="monitor-button" onClick={() => setPortal("choose")}>Exit Admin Portal</button>
      </div>
      <section className="admin-inbox-panel">
        <div className="admin-inbox-heading"><div><h2>ðŸš‘ Ambulance Request Inbox</h2><p>Accept or reject ambulance requests submitted by users.</p></div><button className="monitor-button" onClick={fetchAdminPortalData}>â†» Refresh</button></div>
        {adminRequests.length === 0 ? <p className="admin-empty-state">No ambulance requests received yet.</p> :
          <div className="admin-inbox-list">{adminRequests.slice().reverse().map(item => <article className="admin-inbox-item" key={item.requestId}>
            <div className="admin-request-info"><strong>{item.patientName || "Emergency Patient"}</strong><span>Request ID: {item.requestId}</span><span>Phone: {item.phone || "Not provided"} Â· Emergency: {item.emergencyType || "Emergency"}</span><span>Location: {Number(item.latitude).toFixed(5)}, {Number(item.longitude).toFixed(5)}</span><span>Ambulance: {item.ambulanceId || "Pending assignment"}</span><span>Requested: {item.requestedAt ? new Date(item.requestedAt).toLocaleString() : "â€”"}</span></div>
            <div className="admin-request-actions"><b className={`admin-status ${String(item.status || "PENDING").toLowerCase()}`}>{item.status || "PENDING"}</b>
              {["PENDING","ASSIGNED"].includes(String(item.status).toUpperCase()) && <><button className="admin-accept-button" disabled={requestDecisionBusy===item.requestId} onClick={() => decideAmbulanceRequest(item.requestId,"accept")}>âœ“ Accept</button><button className="admin-reject-button" disabled={requestDecisionBusy===item.requestId} onClick={() => decideAmbulanceRequest(item.requestId,"reject")}>âœ• Reject</button></>}
            </div>
          </article>)}</div>}
      </section>
      <section className="admin-inbox-panel admin-rfid-panel">
        <div className="admin-inbox-heading"><div><h2>ðŸ“¡ User RFID Scan Records</h2><p>Patient details retrieved from RFID scans in the User Portal.</p></div></div>
        {adminRfidScans.length===0 ? <p className="admin-empty-state">No RFID scans recorded yet.</p> :
          <div className="admin-rfid-list">{adminRfidScans.slice().reverse().map((scan,index)=><article className="admin-rfid-item" key={`${scan.scannedAt||index}-${scan.uid||"unknown"}`}>
            <strong>{scan.patient?.name || "Unidentified RFID card"}</strong><span>Patient ID: {scan.patient?.id || "Not identified"}</span><span>RFID UID: {scan.uid || "Not received"}</span><span>Age: {scan.patient?.age ?? "â€”"} Â· Blood group: {scan.patient?.bloodGroup || "â€”"}</span><span>Phone: {scan.patient?.phone || "â€”"}</span><span>Allergies: {Array.isArray(scan.patient?.allergies) ? scan.patient.allergies.join(", ") : scan.patient?.allergies || "â€”"}</span><span>Medical history: {scan.patient?.medicalHistory || "â€”"}</span><span>Status: {scan.status} Â· {scan.scannedAt ? new Date(scan.scannedAt).toLocaleString() : ""}</span>
          </article>)}</div>}
      </section>

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
            ðŸš‘ ResQLink
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
              ? "â¸ Stop Monitoring"
              : "â–¶ Start Monitoring"}

          </button>

          <button
            className="monitor-button"
            onClick={scanRFID}
          >

            ðŸ“¡ Scan RFID

          </button>

          {!emergencyMode ? (

            <button
              className="emergency-button"
              onClick={
                simulateEmergency
              }
            >

              ðŸš¨ Simulate Emergency

            </button>

          ) : (

            <button
              className="reset-button"
              onClick={
                resetEmergency
              }
            >

              â†© Reset Emergency

            </button>

          )}

        </div>

      </header>


      {/* Ambulance requests are submitted only from the separate User Portal. */}

      {/* User request feedback is shown only in the User Portal. */}

      {/* User request errors are displayed in the User Portal. */}

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
                {patient.id || "â€”"}
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

                  ? "âœ“ IDENTIFIED"

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
          PATIENT DIGITAL MEDICAL RECORDS
      ================================================= */}
      <section className="panel patient-records-panel">
        <div className="panel-heading">
          <div>
            <h2>Patient Digital Medical Records</h2>
            <p>RFID-linked patient profiles, medical history and emergency snapshots</p>
          </div>
          <div className="patient-record-actions">
            <button type="button" className="monitor-button" onClick={startNewPatient}>ï¼‹ New Patient</button>
            <button type="button" className="monitor-button" onClick={saveEmergencySnapshot} disabled={!patient.id}>Save Emergency Snapshot</button>
          </div>
        </div>

        {patientSaveMessage && <p className="record-success">{patientSaveMessage}</p>}
        {patientSaveError && <p className="record-error">{patientSaveError}</p>}

        <div className="patient-record-layout">
          <form className="patient-record-form" onSubmit={savePatientRecord}>
            <h3>{editingPatientId ? `Edit Patient Â· ${editingPatientId}` : "Register Patient"}</h3>
            <div className="patient-rfid-tools">
              <div className={`patient-rfid-status ${rfidStatus === "IDENTIFIED" ? "is-linked" : rfidStatus === "UNKNOWN_CARD" ? "is-unknown" : "is-manual"}`}>
                <strong>{rfidStatus === "IDENTIFIED" ? "RFID patient identified" : rfidStatus === "UNKNOWN_CARD" ? "New / unregistered RFID card" : "Manual registration available"}</strong>
                <span>{pendingRfidUid || patientForm.rfidUid ? `Card UID: ${pendingRfidUid || patientForm.rfidUid}` : "Scan a registered card to load a patient, or register without RFID."}</span>
              </div>
              <div className="patient-rfid-buttons">
                <button type="button" className="route-button" onClick={scanRFID}>Scan RFID card</button>
                <button type="button" className="monitor-button" onClick={startNewPatient}>Register manually</button>
              </div>
            </div>
            <div className="record-form-grid">
              <label>Patient ID
                <input name="id" value={patientForm.id} onChange={updatePatientForm} placeholder="Auto-generated if blank" disabled={Boolean(editingPatientId)} />
              </label>
              <label>RFID card UID (optional)
                <input name="rfidUid" value={patientForm.rfidUid || ""} onChange={updatePatientForm} placeholder="Scan card or leave blank for manual patient" />
              </label>
              <label>Full name *
                <input name="name" value={patientForm.name} onChange={updatePatientForm} required placeholder="Patient name" />
              </label>
              <label>Age
                <input name="age" type="number" min="0" max="120" value={patientForm.age} onChange={updatePatientForm} placeholder="Age" />
              </label>
              <label>Blood group
                <select name="bloodGroup" value={patientForm.bloodGroup} onChange={updatePatientForm}>
                  <option value="">Unknown</option>
                  {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(group => <option key={group} value={group}>{group}</option>)}
                </select>
              </label>
              <label>Phone
                <input name="phone" value={patientForm.phone} onChange={updatePatientForm} placeholder="Contact number" />
              </label>
              <label>Emergency contact
                <input name="emergencyContact" value={patientForm.emergencyContact} onChange={updatePatientForm} placeholder="Name / phone" />
              </label>
              <label className="record-field-wide">Known allergies
                <input name="allergies" value={patientForm.allergies} onChange={updatePatientForm} placeholder="Comma-separated, or write Unknown" />
              </label>
              <label className="record-field-wide">Medical history
                <textarea name="medicalHistory" value={patientForm.medicalHistory} onChange={updatePatientForm} rows="3" placeholder="Known conditions, prior procedures, medication information..." />
              </label>
              <label className="record-field-wide">Additional notes
                <textarea name="notes" value={patientForm.notes} onChange={updatePatientForm} rows="2" placeholder="Relevant patient notes" />
              </label>
            </div>
            <div className="patient-record-actions">
              <button className="route-button" type="submit" disabled={savingPatient}>{savingPatient ? "Saving..." : editingPatientId ? "Update Patient Record" : "Create Patient Record"}</button>
              {editingPatientId && <button className="monitor-button" type="button" onClick={startNewPatient}>Clear Form</button>}
            </div>
            <p className="record-disclaimer">Prototype record only. Enter test data or information collected with appropriate consent. Do not use this prototype as a substitute for verified clinical records.</p>
          </form>

          <div className="patient-record-directory">
            <h3>Patient Directory</h3>
            <input value={patientSearch} onChange={event => setPatientSearch(event.target.value)} placeholder="Search by ID, name or blood group..." />
            <div className="patient-record-list">
              {patientRecords.filter(item => [item.id,item.name,item.bloodGroup].some(value => String(value || "").toLowerCase().includes(patientSearch.toLowerCase()))).map(item => (
                <button type="button" className={`patient-record-item ${editingPatientId === item.id ? "selected" : ""}`} key={item.id} onClick={() => selectPatientRecord(item)}>
                  <span><strong>{item.name}</strong><small>{item.id} Â· {item.age ?? "Age unknown"} yrs Â· {item.bloodGroup || "Blood group unknown"}</small></span>
                  <span>View â†’</span>
                </button>
              ))}
              {!patientRecords.length && <p className="record-empty">No patient records yet.</p>}
            </div>
            {patient.id && (
              <div className="patient-emergency-history">
                <h3>Emergency History</h3>
                {(patient.emergencyRecords || []).length
                  ? patient.emergencyRecords.slice().reverse().map(record => (
                    <div className="patient-history-item" key={record.emergencyId}>
                      <strong>{record.emergencyId}</strong>
                      <small>{new Date(record.occurredAt).toLocaleString()} Â· {record.ambulanceId}</small>
                      <small>HR: {record.vitals?.heartRate ?? "â€”"} Â· SpOâ‚‚: {record.vitals?.spo2 ?? "â€”"} Â· Temp: {record.vitals?.temperature ?? "â€”"}</small>
                    </div>
                  ))
                  : <p className="record-empty">No saved emergency snapshots for this patient.</p>}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* =================================================
          VITALS
      ================================================= */}

      <section className="vitals">

        <div className="vital-card">

          <div className="icon">
            â¤ï¸
          </div>

          <h3>
            Heart Rate
          </h3>

          <div className="value">

            {vitalValidity.heartRate ? vitals.heartRate : "â€”"}

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
            ðŸ«
          </div>

          <h3>
            SpOâ‚‚
          </h3>

          <div className="value">

            {vitalValidity.spo2 ? vitals.spo2 : "â€”"}

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
            ðŸŒ¡ï¸
          </div>

          <h3>
            Temperature
          </h3>

          <div className="value">

            {vitalValidity.temperature ? vitals.temperature.toFixed(1) : "â€”"}

            <span>
              {vitalValidity.temperature ? "Â°C" : "NOT CONNECTED"}
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
              ? "ðŸ”´"
              : status === "WARNING"
              ? "ðŸŸ¡"
              : status === "NO DATA"
              ? "âšª"
              : "ðŸŸ¢"}

          </div>

          <h3>
            Overall Status
          </h3>

          <div className="status-value">
            {status}
          </div>

          <p>

            {status === "CRITICAL"
              ? "Abnormal readings â€” check patient"
              : status === "WARNING"
              ? "Readings require attention"
              : status === "NO DATA"
              ? "Waiting for valid sensor readings"
              : "Readings within configured limits"}

          </p>

        </div>

      </section>


      {/* =================================================
          ECG MONITOR â€” REAL AD8232 SIGNAL ONLY
      ================================================= */}

      <section className="panel ecg-panel">
        <div className="panel-title">
          <div>
            <h2>ðŸ’“ ECG Monitor</h2>
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
          <span className="ecg-label">AD8232 â€¢ LIVE ADC</span>
          <span className="ecg-preview-note">
            {ecgSignalReady
              ? `${ecgTelemetry.samples.length} real samples Â· ${ecgTelemetry.sampleRate} Hz nominal Â· auto gain`
              : ecgTelemetry.leadOff
                ? "Waveform hidden â€” electrode leads are disconnected"
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
            ðŸ“ˆ Patient Condition Trend
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
                  â¤ï¸ HR
                </th>

                <th>
                  ðŸ« SpOâ‚‚
                </th>

                <th>
                  ðŸŒ¡ï¸ Temp
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
                      {item.temperature}Â°C
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
            ðŸš¨
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
                ðŸš¨ Inter-Ambulance
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
                ðŸ“
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
                â¤ï¸
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
                ðŸš‘
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

                  ðŸš‘ Accept Assistance

                </button>

                <button
                  className="decline-button"
                  onClick={
                    declineAssistance
                  }
                >

                  âŒ Decline

                </button>

              </div>

            ) : assistanceAccepted ? (

              <div className="accepted-message">

                âœ“ Ambulance A-02
                is responding

              </div>

            ) : (

              <div className="declined-message">

                âŒ Request declined â€”
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
              ðŸ“ Ambulance Location
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
                <span>ðŸ“¡</span>
                <strong>Waiting for live NEO-6M GPS fix</strong>
                <small>Real map will appear when the ESP32 reports valid coordinates.</small>
              </div>
            )}
          </div>

          <div className="coordinates">

            ðŸ“ Latitude:
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
                  Open real hospital route â†—
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
              ðŸ¥ Intelligent Hospital
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
              â†“
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
                    : "â€”"}

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
                  <span>ðŸ¥</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.address || "Address not listed"} Â· {item.straightLineDistance} km straight-line
                    </small>
                  </div>
                </div>
              ))}
              <small className="osm-credit">Hospital listings Â© OpenStreetMap contributors</small>
            </div>
          )}

          <button
            className="route-button"
            onClick={viewBestRoute}
          >

            ðŸ—ºï¸ View Best Route

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
                âœ… BEST ROUTE SELECTED
              </h3>

              <div
                style={{
                  display: "grid",
                  gap: "10px"
                }}
              >

                <p>
                  ðŸ¥ <strong>Hospital:</strong>{" "}
                  {bestRoute.destination}
                </p>

                <p>
                  ðŸ“ <strong>Distance:</strong>{" "}
                  {bestRoute.distance} km
                </p>

                <p>
                  â±ï¸ <strong>Estimated Time:</strong>{" "}
                  {bestRoute.estimatedTime} min
                </p>

                <p>
                  ðŸš¦ <strong>Traffic:</strong>{" "}
                  {bestRoute.traffic}
                </p>

                <p>
                  ðŸ›ï¸ <strong>Available Beds:</strong>{" "}
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
                ðŸš‘ Ambulance A-01 â†’ {bestRoute.destination}
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
              ðŸ”„ Dynamic Hospital Decision
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

            ðŸ”„ Re-evaluate Hospital

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
              ðŸ”„ Patient Handover Continuity
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
              ðŸš‘ A-01
              {" â†’ "}
              ðŸš‘ A-02
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

              ðŸ”„ Start Digital Handover

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

                    ðŸš‘ {item.from}
                    {" â†’ "}
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
              ðŸš¨ Emergency Alerts
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
                ðŸš¨
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
                âœ“
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
              ðŸš‘ Nearby Ambulances
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
                ðŸš‘
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
                ðŸš‘
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
          MODULE 2 â€” HOSPITAL MANAGEMENT
      ================================================= */}
      <section className="hospital-management-panel">
        <div className="hospital-management-heading">
          <div>
            <span className="hospital-module-kicker">MODULE 2 Â· HYBRID HOSPITAL DIRECTORY</span>
            <h2>ðŸ¥ Intelligent Hospital Management</h2>
            <p>Real hospital listings and locations, with capacity details maintained by the ResQLink prototype administrator.</p>
          </div>
          <div className="hospital-management-actions">
            <button type="button" onClick={fetchHospitalDirectory} disabled={hospitalManagementLoading}>
              {hospitalManagementLoading ? "Refreshingâ€¦" : "â†» Refresh hospitals"}
            </button>
            <button type="button" onClick={startManualHospital}>ï¼‹ Add hospital manually</button>
          </div>
        </div>

        <div className="hospital-management-grid">
          <div className="hospital-directory-list">
            <h3>Hospital directory <span>{hospitalDirectory.length}</span></h3>
            {hospitalDirectory.length === 0 ? (
              <p className="hospital-empty-state">{gpsStatus.valid ? "No hospitals returned yet. Refresh to try again." : "Waiting for a valid ambulance GPS fix to discover nearby hospitals. You can still add a hospital manually."}</p>
            ) : hospitalDirectory.map(item => (
              <button type="button" className={`hospital-directory-item ${selectedManagedHospitalId === item.id ? "selected" : ""}`} key={item.id} onClick={() => loadHospitalIntoForm(item)}>
                <span className="hospital-directory-icon">ðŸ¥</span>
                <span className="hospital-directory-copy">
                  <strong>{item.name}</strong>
                  <small>{item.address || "Address not listed"}</small>
                  <small>{item.straightLineDistance != null ? `${item.straightLineDistance} km straight-line` : "Location saved"} Â· {item.source === "OpenStreetMap" ? "OpenStreetMap" : "Manual entry"}</small>
                  <small>ICU: {item.icuBedsAvailable ?? "â€”"}/{item.icuBedsTotal ?? "â€”"} Â· General: {item.generalBedsAvailable ?? "â€”"}/{item.generalBedsTotal ?? "â€”"}</small>
                  <small>{item.capacityUpdatedAt ? `Capacity updated: ${new Date(item.capacityUpdatedAt).toLocaleString()}` : "Capacity details not configured"}</small>
                </span>
                <span className={`hospital-acceptance ${item.ambulanceAcceptance === "ACCEPTING" ? "accepting" : item.ambulanceAcceptance === "NOT_ACCEPTING" ? "not-accepting" : "unknown"}`}>{item.ambulanceAcceptance === "ACCEPTING" ? "Accepting" : item.ambulanceAcceptance === "NOT_ACCEPTING" ? "Not accepting" : "Unconfirmed"}</span>
              </button>
            ))}
            <small className="hospital-source-note">Hospital names and coordinates are discovered from OpenStreetMap. Â© OpenStreetMap contributors.</small>
          </div>

          <form className="hospital-management-form" onSubmit={saveHospitalManagement}>
            <div className="hospital-form-title">
              <div><h3>{addingManualHospital ? "Add hospital" : selectedManagedHospitalId ? "Manage hospital details" : "Select a hospital"}</h3><p>Capacity and facility fields are manually maintained prototype data.</p></div>
              {selectedManagedHospitalId && <button type="button" className="hospital-reset-button" onClick={resetHospitalManagement}>Reset details</button>}
            </div>
            <div className="hospital-form-grid">
              <label>Hospital name<input required maxLength="180" value={hospitalForm.name} onChange={e => setHospitalForm(v => ({ ...v, name: e.target.value }))} placeholder="Hospital name" /></label>
              <label>Address<input value={hospitalForm.address} onChange={e => setHospitalForm(v => ({ ...v, address: e.target.value }))} placeholder="Area, city" /></label>
              <label>Latitude<input required type="number" step="any" value={hospitalForm.latitude} onChange={e => setHospitalForm(v => ({ ...v, latitude: e.target.value }))} placeholder="e.g. 13.00" /></label>
              <label>Longitude<input required type="number" step="any" value={hospitalForm.longitude} onChange={e => setHospitalForm(v => ({ ...v, longitude: e.target.value }))} placeholder="e.g. 76.10" /></label>
              <label>ICU beds available<input type="number" min="0" step="1" value={hospitalForm.icuBedsAvailable} onChange={e => setHospitalForm(v => ({ ...v, icuBedsAvailable: e.target.value }))} placeholder="Not entered" /></label>
              <label>Total ICU beds<input type="number" min="0" step="1" value={hospitalForm.icuBedsTotal} onChange={e => setHospitalForm(v => ({ ...v, icuBedsTotal: e.target.value }))} placeholder="Not entered" /></label>
              <label>General beds available<input type="number" min="0" step="1" value={hospitalForm.generalBedsAvailable} onChange={e => setHospitalForm(v => ({ ...v, generalBedsAvailable: e.target.value }))} placeholder="Not entered" /></label>
              <label>Total general beds<input type="number" min="0" step="1" value={hospitalForm.generalBedsTotal} onChange={e => setHospitalForm(v => ({ ...v, generalBedsTotal: e.target.value }))} placeholder="Not entered" /></label>
              <label className="hospital-form-wide">Special facilities<input value={hospitalForm.specialFacilities} onChange={e => setHospitalForm(v => ({ ...v, specialFacilities: e.target.value }))} placeholder="Trauma, ICU, Cardiology, Surgery (comma separated)" /></label>
              <label>Ambulance acceptance<select value={hospitalForm.ambulanceAcceptance} onChange={e => setHospitalForm(v => ({ ...v, ambulanceAcceptance: e.target.value }))}><option value="UNKNOWN">Unconfirmed</option><option value="ACCEPTING">Accepting</option><option value="NOT_ACCEPTING">Not accepting</option></select></label>
              <label className="hospital-checkbox-label"><input type="checkbox" checked={hospitalForm.emergencyDepartmentAvailable} onChange={e => setHospitalForm(v => ({ ...v, emergencyDepartmentAvailable: e.target.checked }))} /> Emergency department available</label>
            </div>
            <div className="hospital-form-footer">
              <small>{selectedManagedHospitalId ? `Selected record: ${selectedManagedHospitalId}` : addingManualHospital ? "New manual hospital record" : "Choose a hospital from the directory or add one manually."}</small>
              <button type="submit" disabled={hospitalManagementSaving || (!selectedManagedHospitalId && !addingManualHospital)}>{hospitalManagementSaving ? "Savingâ€¦" : "Save hospital details"}</button>
            </div>
            {hospitalManagementMessage && <p className="hospital-management-message">{hospitalManagementMessage}</p>}
          </form>
        </div>
        <div className="hospital-data-warning">â“˜ Capacity, facilities, emergency availability and acceptance are manually entered demonstration values. They are not connected to hospital live systems and must be verified before real-world decisions.</div>
      </section>

      {/* =================================================
          MODULES 4â€“7: ROUTING, PRE-ARRIVAL, RISK, HANDOVER, ANALYTICS
      ================================================= */}
      <section className="panel advanced-workflows-panel">
        <div className="advanced-title">
          <div><h2>ResQLink Emergency Coordination Centre</h2><p>Dynamic routing, hospital communication, patient risk review, handover and analytics</p></div>
          <button type="button" className="monitor-button" onClick={loadAdvancedModules}>â†» Refresh modules</button>
        </div>
        {workflowMessage && <p className="record-success">{workflowMessage}</p>}
        {workflowError && <p className="record-error">{workflowError}</p>}

        <div className="advanced-module-grid">
          <article className="advanced-module-card">
            <h3>04 Â· Hospital Pre-Arrival Notification</h3>
            <p>Prepare a hospital notification with the emergency ID, patient details available in the prototype and valid current vital readings.</p>
            <form onSubmit={sendHospitalPreArrival} className="advanced-form">
              <label>Hospital name<input required value={preArrivalHospital} onChange={e => setPreArrivalHospital(e.target.value)} placeholder="Enter selected hospital" /></label>
              <label>Emergency ID (optional)<input value={preArrivalEmergencyId} onChange={e => setPreArrivalEmergencyId(e.target.value)} placeholder="Uses current request if blank" /></label>
              <button type="submit">Create pre-arrival notification</button>
            </form>
            <small className="prototype-note">Prototype inbox only. This does not send an actual message to a hospital.</small>
            <div className="workflow-record-list">
              {(hospitalInbox || []).slice(0,5).map(item => <div className="workflow-record" key={item.notificationId}>
                <strong>{item.hospitalName}</strong><small>{item.emergencyId} Â· {item.status}</small>
                {item.status !== "ACKNOWLEDGED" && <button type="button" onClick={() => acknowledgeHospitalNotification(item.notificationId)}>Acknowledge (demo)</button>}
              </div>)}
              {!hospitalInbox?.length && <small>No pre-arrival notifications recorded yet.</small>}
            </div>
          </article>

          <article className="advanced-module-card">
            <h3>05 Â· AI-Assisted Patient Risk Assessment</h3>
            <p>Explainable prototype rules review only valid sensor readings and identify missing or unsuitable signals.</p>
            <button type="button" onClick={async () => {
              try { const r = await fetch(`${API_URL}/api/clinical/risk-assessment`); const d = await r.json(); if (!r.ok) throw new Error(d.message); setRiskAssessment(d.assessment); }
              catch (e) { setWorkflowError(e.message); }
            }}>Run risk review</button>
            {riskAssessment && <>
              <div className={`risk-result ${riskAssessment.assessment === "REVIEW_REQUIRED" ? "risk-warning" : "risk-neutral"}`}>{riskAssessment.assessment === "REVIEW_REQUIRED" ? "Review required" : "No configured rule triggered"}</div>
              <ul className="risk-findings">{(riskAssessment.findings || []).map((item,index) => <li key={`${item.metric}-${index}`}><strong>{item.metric}: {item.value ?? "Unavailable"}</strong><span>{item.reason}</span></li>)}</ul>
              <small className="prototype-note">{riskAssessment.disclaimer}</small>
            </>}
          </article>

          <article className="advanced-module-card">
            <h3>06 Â· Patient Handover and Ambulance Transfer</h3>
            <p>Transfer the emergency identity, patient summary, available vital snapshot and recent ECG samples to a receiving ambulance.</p>
            <form onSubmit={createPatientHandover} className="advanced-form">
              <label>Emergency ID<input value={handoverEmergencyId} onChange={e => setHandoverEmergencyId(e.target.value)} placeholder="Uses current request if blank" /></label>
              <div className="advanced-form-row">
                <label>From<select value={handoverFrom} onChange={e => setHandoverFrom(e.target.value)}><option>A-01</option><option>A-02</option><option>A-03</option></select></label>
                <label>To<select value={handoverTo} onChange={e => setHandoverTo(e.target.value)}><option>A-01</option><option>A-02</option><option>A-03</option></select></label>
              </div>
              <button type="submit">Create patient transfer</button>
            </form>
            <div className="workflow-record-list">
              {(handoverRecords || []).slice(0,5).map(item => <div className="workflow-record" key={item.handoverId}>
                <strong>{item.handoverId} Â· {item.fromAmbulance} â†’ {item.toAmbulance}</strong><small>{item.emergencyId} Â· {item.status}</small>
                {item.status !== "ACKNOWLEDGED" && <button type="button" onClick={() => acknowledgeHandover(item.handoverId)}>Receiving crew acknowledge</button>}
              </div>)}
              {!handoverRecords?.length && <small>No patient transfers recorded yet.</small>}
            </div>
          </article>

          <article className="advanced-module-card">
            <h3>07 Â· Analytics and Emergency Reports</h3>
            <p>Summary is calculated from recorded prototype events. Missing response-time samples are shown as unavailable, not zero.</p>
            <button type="button" onClick={loadAdvancedModules}>Refresh analytics</button>
            {analyticsSummary && <>
              <div className="analytics-kpis">
                <div><strong>{analyticsSummary.totalEmergencyEvents}</strong><small>Emergency-related events</small></div>
                <div><strong>{analyticsSummary.averageResponseMinutes ?? "â€”"}</strong><small>Average response (minutes)</small></div>
                <div><strong>{analyticsSummary.responseSamples}</strong><small>Recorded response samples</small></div>
              </div>
              <h4>Ambulance status counts</h4>
              <p>{Object.entries(analyticsSummary.ambulanceStatusCounts || {}).map(([k,v]) => `${k}: ${v}`).join(" Â· ") || "No fleet data"}</p>
              <h4>Hospital notifications</h4>
              <p>{Object.entries(analyticsSummary.hospitalNotificationCounts || {}).map(([k,v]) => `${k}: ${v}`).join(" Â· ") || "No hospital notifications yet"}</p>
              <div className="patient-record-actions">
                <button type="button" onClick={downloadAnalyticsCsv}>Download analytics CSV</button>
                <button type="button" onClick={printAnalyticsReport}>Print / Save PDF report</button>
              </div>
              <h4>Recent emergency event history</h4>
              <div className="workflow-record-list">
                {(analyticsSummary.eventHistory || []).slice(0,6).map(event => <div className="workflow-record" key={event.eventId}><strong>{event.type}</strong><small>{new Date(event.occurredAt).toLocaleString()}</small></div>)}
                {!analyticsSummary.eventHistory?.length && <small>No events recorded yet.</small>}
              </div>
              <small className="prototype-note">{analyticsSummary.note}</small>
            </>}
          </article>

          <article className="advanced-module-card route-module-card">
            <h3>03 Â· Dynamic Route and Traffic Management</h3>
            <p>Use the existing GPS-based road-route service and hospital selection. Alternative routes require live route-provider responses; traffic congestion is not currently available from the existing backend.</p>
            <button type="button" onClick={fetchNearestHospital}>Refresh hospital route recommendation</button>
            <small className="prototype-note">Route distance and ETA depend on a valid GPS fix and the routing service. No live traffic claim is made.</small>
          </article>
        </div>
      </section>

      {/* =================================================
          FOOTER
      ================================================= */}

      <footer>

        <span>
          ResQLink â€¢ Intelligent Ambulance IoT System
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
