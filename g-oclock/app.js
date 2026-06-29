const DB_NAME = "g-oclock-db";
const DB_VERSION = 1;
const STORE_NAME = "takes";
const CHART_HOURS = 4;
const MAX_VISIBLE_HISTORY = 200;
const DEFAULT_DOSE_ML = 1.0;
const DOSE_STEP_ML = 0.1;
const MIN_DOSE_ML = 0.1;
const MAX_DOSE_ML = 5.0;
const DOSE_STORAGE_KEY = "g-oclock-selected-dose-ml";

const elements = {
    connectionStatus: document.getElementById("connectionStatus"),
    lastTakenText: document.getElementById("lastTakenText"),
    lastTakenDetail: document.getElementById("lastTakenDetail"),
    takeButton: document.getElementById("takeButton"),
    doseDownButton: document.getElementById("doseDownButton"),
    doseUpButton: document.getElementById("doseUpButton"),
    levelText: document.getElementById("levelText"),
    totalTakesText: document.getElementById("totalTakesText"),
    totalDoseText: document.getElementById("totalDoseText"),
    gauge: document.querySelector(".gauge"),
    gaugeValue: document.getElementById("gaugeValue"),
    peakText: document.getElementById("peakText"),
    chart: document.getElementById("levelChart"),
    historyList: document.getElementById("historyList"),
    historySummary: document.getElementById("historySummary"),
    resetButton: document.getElementById("resetButton"),
    resetDialog: document.getElementById("resetDialog")
};

let takes = [];
let dbPromise;
let selectedDoseMl = loadSelectedDose();

function loadSelectedDose() {
    const saved = Number(localStorage.getItem(DOSE_STORAGE_KEY));
    return normalizeDose(Number.isFinite(saved) ? saved : DEFAULT_DOSE_ML);
}

function normalizeDose(doseMl) {
    const stepped = Math.round(doseMl / DOSE_STEP_ML) * DOSE_STEP_ML;
    return Math.min(MAX_DOSE_ML, Math.max(MIN_DOSE_ML, Number(stepped.toFixed(1))));
}

function formatDose(doseMl) {
    const dose = normalizeDose(doseMl);
    return `${Number.isInteger(dose) ? String(dose) : dose.toFixed(1)} ml`;
}

function takeDose(take) {
    return normalizeDose(Number.isFinite(take.doseMl) ? take.doseMl : DEFAULT_DOSE_ML);
}

function setSelectedDose(doseMl) {
    selectedDoseMl = normalizeDose(doseMl);
    localStorage.setItem(DOSE_STORAGE_KEY, String(selectedDoseMl));
    renderDoseControls();
}

function renderDoseControls() {
    const dose = formatDose(selectedDoseMl);
    elements.takeButton.textContent = `Take ${dose} G`;
    elements.doseDownButton.disabled = selectedDoseMl <= MIN_DOSE_ML;
    elements.doseUpButton.disabled = selectedDoseMl >= MAX_DOSE_ML;
}

function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("takenAt", "takenAt");
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    return dbPromise;
}

async function readTakes() {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result.sort((a, b) => b.takenAt - a.takenAt));
        };
        request.onerror = () => reject(request.error);
    });
}

async function writeTake(take) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(take);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
}

async function clearTakes() {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).clear();
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
}

function relativeLevel(minutes) {
    if (minutes <= 0) return 0;

    const ke = Math.log(2) / 40;
    const ka = 0.0769716504832833;
    const tMax = Math.log(ka / ke) / (ka - ke);
    const concentration = Math.exp(-ke * minutes) - Math.exp(-ka * minutes);
    const peak = Math.exp(-ke * tMax) - Math.exp(-ka * tMax);

    return 100 * concentration / peak;
}

function combinedLevelAt(timestamp) {
    return takes.reduce((sum, take) => {
        const minutes = (timestamp - take.takenAt) / 60000;
        return minutes >= 0 ? sum + relativeLevel(minutes) * takeDose(take) : sum;
    }, 0);
}

function formatTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(timestamp));
}

function formatDateTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short"
    }).format(new Date(timestamp));
}

function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

function updateConnectionStatus() {
    const isOnline = navigator.onLine;
    elements.connectionStatus.textContent = isOnline ? "Online" : "Offline";
    elements.connectionStatus.classList.toggle("offline", !isOnline);
}

function renderHistory() {
    elements.historyList.textContent = "";

    if (takes.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "No takes recorded yet.";
        elements.historyList.append(empty);
        elements.historySummary.textContent = "Stored on this device for offline use.";
        return;
    }

    const totalDose = takes.reduce((sum, take) => sum + takeDose(take), 0);
    elements.historySummary.textContent = `${takes.length} take${takes.length === 1 ? "" : "s"}, ${formatDose(totalDose)} stored on this device.`;

    takes.slice(0, MAX_VISIBLE_HISTORY).forEach((take, index) => {
        const item = document.createElement("li");
        const label = document.createElement("time");
        const detail = document.createElement("span");

        label.dateTime = new Date(take.takenAt).toISOString();
        label.textContent = formatDateTime(take.takenAt);
        detail.textContent = index === 0
            ? `${formatDose(takeDose(take))} latest`
            : `${formatDose(takeDose(take))} - ${formatDuration(Date.now() - take.takenAt)} ago`;

        item.append(label, detail);
        elements.historyList.append(item);
    });
}

function drawChart(now) {
    const canvas = elements.chart;
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const pad = 34;
    const plotWidth = width - pad * 2;
    const plotHeight = height - pad * 2;
    const samples = 96;
    const points = [];

    for (let index = 0; index <= samples; index += 1) {
        const timestamp = now + (index / samples) * CHART_HOURS * 60 * 60 * 1000;
        points.push(combinedLevelAt(timestamp));
    }

    const maxLevel = Math.max(100, ...points);

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "#dfe4ea";
    context.lineWidth = 1;
    context.beginPath();
    for (let i = 0; i <= 4; i += 1) {
        const y = pad + (plotHeight / 4) * i;
        context.moveTo(pad, y);
        context.lineTo(width - pad, y);
    }
    context.stroke();

    context.strokeStyle = "#1f8a70";
    context.lineWidth = 5;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();

    points.forEach((level, index) => {
        const x = pad + (index / samples) * plotWidth;
        const y = pad + plotHeight - (Math.min(level, maxLevel) / maxLevel) * plotHeight;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    });
    context.stroke();

    context.fillStyle = "#647084";
    context.font = "24px system-ui, sans-serif";
    context.fillText("now", pad, height - 8);
    context.textAlign = "right";
    context.fillText(`+${CHART_HOURS}h`, width - pad, height - 8);
    context.textAlign = "left";
    context.fillText(`${Math.round(maxLevel)}%`, pad, 24);
}

function render() {
    const now = Date.now();
    const latest = takes[0];
    const level = combinedLevelAt(now);
    const totalDose = takes.reduce((sum, take) => sum + takeDose(take), 0);
    const gaugeLevel = Math.min(level, 160);
    const gaugeDegrees = Math.min(360, (gaugeLevel / 160) * 360);

    if (latest) {
        const elapsed = now - latest.takenAt;
        elements.lastTakenText.textContent = `${formatDuration(elapsed)} ago`;
        elements.lastTakenDetail.textContent = `${formatDose(takeDose(latest))} at ${formatTime(latest.takenAt)}`;
    } else {
        elements.lastTakenText.textContent = "No takes yet";
        elements.lastTakenDetail.textContent = "Tap the button when you take G.";
    }

    elements.levelText.textContent = `${Math.round(level)}%`;
    elements.gaugeValue.textContent = `${Math.round(level)}%`;
    elements.gauge.style.background = `conic-gradient(var(--gold) ${gaugeDegrees}deg, #edf0f4 ${gaugeDegrees}deg)`;
    elements.totalTakesText.textContent = String(takes.length);
    elements.totalDoseText.textContent = formatDose(totalDose);
    elements.peakText.textContent = level > 100 ? "Dose-adjusted active level" : "1.0 ml peak: 100%";
    renderDoseControls();

    renderHistory();
    drawChart(now);
}

async function handleTake() {
    const take = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        takenAt: Date.now(),
        doseMl: selectedDoseMl
    };

    await writeTake(take);
    takes = await readTakes();
    render();
}

async function handleReset() {
    await clearTakes();
    takes = [];
    render();
}

async function init() {
    updateConnectionStatus();
    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);

    elements.takeButton.addEventListener("click", handleTake);
    elements.doseDownButton.addEventListener("click", () => setSelectedDose(selectedDoseMl - DOSE_STEP_ML));
    elements.doseUpButton.addEventListener("click", () => setSelectedDose(selectedDoseMl + DOSE_STEP_ML));
    elements.resetButton.addEventListener("click", () => elements.resetDialog.showModal());
    elements.resetDialog.addEventListener("close", () => {
        if (elements.resetDialog.returnValue === "confirm") {
            handleReset();
        }
    });

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js");
    }

    takes = await readTakes();
    render();
    setInterval(render, 15000);
}

init().catch(error => {
    console.error(error);
    elements.lastTakenDetail.textContent = "Could not load local storage.";
});
