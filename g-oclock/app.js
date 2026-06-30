const DB_NAME = "g-oclock-db";
const DB_VERSION = 1;
const STORE_NAME = "takes";
const CHART_FUTURE_HOURS = 2;
const MAX_VISIBLE_HISTORY = 200;
const DEFAULT_DOSE_ML = 1.0;
const MIN_DOSE_ML = 0.1;
const MAX_DOSE_ML = 5.0;
const DOSE_STEP_CENTS = 10;
const DOSE_QUARTER_CENTS = 25;
const MIN_DOSE_CENTS = Math.round(MIN_DOSE_ML * 100);
const MAX_DOSE_CENTS = Math.round(MAX_DOSE_ML * 100);
const DEFAULT_MAX_ALLOWED_LEVEL = 150;
const MAX_ALLOWED_STEP = 10;
const MIN_MAX_ALLOWED_LEVEL = 50;
const MAX_MAX_ALLOWED_LEVEL = 500;
const MAX_ALLOWED_STORAGE_KEY = "g-oclock-max-allowed-level-v3";
const RECOMMENDATION_HORIZON_HOURS = 8;

const elements = {
    connectionStatus: document.getElementById("connectionStatus"),
    lastTakenText: document.getElementById("lastTakenText"),
    lastTakenDetail: document.getElementById("lastTakenDetail"),
    takeButton: document.getElementById("takeButton"),
    doseDownButton: document.getElementById("doseDownButton"),
    doseUpButton: document.getElementById("doseUpButton"),
    maxAllowedDownButton: document.getElementById("maxAllowedDownButton"),
    maxAllowedUpButton: document.getElementById("maxAllowedUpButton"),
    maxAllowedText: document.getElementById("maxAllowedText"),
    maxRecommendedText: document.getElementById("maxRecommendedText"),
    maxRecommendedDetail: document.getElementById("maxRecommendedDetail"),
    totalTakesText: document.getElementById("totalTakesText"),
    totalDoseText: document.getElementById("totalDoseText"),
    levelValue: document.getElementById("levelValue"),
    levelBarFill: document.getElementById("levelBarFill"),
    peakText: document.getElementById("peakText"),
    chart: document.getElementById("levelChart"),
    historyList: document.getElementById("historyList"),
    historySummary: document.getElementById("historySummary"),
    resetButton: document.getElementById("resetButton"),
    resetDialog: document.getElementById("resetDialog"),
    updateBanner: document.getElementById("updateBanner"),
    updateButton: document.getElementById("updateButton")
};

let takes = [];
let dbPromise;
let selectedDoseMl = DEFAULT_DOSE_ML;
let maxAllowedLevel = loadMaxAllowedLevel();
let pendingServiceWorker = null;
let updateReloadRequested = false;
let updateReloadTimer = null;

function reloadWithCacheBust() {
    const url = new URL(window.location.href);
    url.searchParams.set("app-refresh", String(Date.now()));
    window.location.replace(url.toString());
}

function loadMaxAllowedLevel() {
    const saved = localStorage.getItem(MAX_ALLOWED_STORAGE_KEY);
    if (saved === null) return DEFAULT_MAX_ALLOWED_LEVEL;

    const savedLevel = Number(saved);
    return normalizeMaxAllowedLevel(Number.isFinite(savedLevel) ? savedLevel : DEFAULT_MAX_ALLOWED_LEVEL);
}

function normalizeDose(doseMl) {
    const cents = Math.round(doseMl * 100);
    return centsToMl(nearestAllowedDoseCents(cents));
}

function centsToMl(cents) {
    return Number((cents / 100).toFixed(2));
}

function isAllowedDoseCents(cents) {
    return cents % DOSE_STEP_CENTS === 0 || cents % DOSE_QUARTER_CENTS === 0;
}

function nearestAllowedDoseCents(cents) {
    const clamped = Math.min(MAX_DOSE_CENTS, Math.max(MIN_DOSE_CENTS, cents));

    for (let offset = 0; offset <= DOSE_QUARTER_CENTS; offset += 1) {
        const down = clamped - offset;
        if (down >= MIN_DOSE_CENTS && isAllowedDoseCents(down)) return down;

        const up = clamped + offset;
        if (up <= MAX_DOSE_CENTS && isAllowedDoseCents(up)) return up;
    }

    return clamped;
}

function adjacentDose(doseMl, direction) {
    const current = Math.round(normalizeDose(doseMl) * 100);
    for (
        let cents = current + direction;
        cents >= MIN_DOSE_CENTS && cents <= MAX_DOSE_CENTS;
        cents += direction
    ) {
        if (isAllowedDoseCents(cents)) return centsToMl(cents);
    }

    return centsToMl(current);
}

function previousDose(doseMl) {
    return adjacentDose(doseMl, -1);
}

function nextDose(doseMl) {
    return adjacentDose(doseMl, 1);
}

function floorAllowedDose(doseMl) {
    const clamped = Math.min(MAX_DOSE_CENTS, Math.max(0, Math.floor(doseMl * 100)));

    for (let cents = clamped; cents >= 0; cents -= 1) {
        if (cents === 0 || isAllowedDoseCents(cents)) return centsToMl(cents);
    }

    return 0;
}

function normalizeMaxAllowedLevel(level) {
    const stepped = Math.round(level / MAX_ALLOWED_STEP) * MAX_ALLOWED_STEP;
    return Math.min(MAX_MAX_ALLOWED_LEVEL, Math.max(MIN_MAX_ALLOWED_LEVEL, stepped));
}

function formatMl(doseMl) {
    const rounded = Math.round(Math.max(0, doseMl) * 100) / 100;
    return `${Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0$/, "")} ml`;
}

function formatDose(doseMl) {
    return formatMl(normalizeDose(doseMl));
}

function takeDose(take) {
    return normalizeDose(Number.isFinite(take.doseMl) ? take.doseMl : DEFAULT_DOSE_ML);
}

function setSelectedDose(doseMl) {
    selectedDoseMl = normalizeDose(doseMl);
    render();
}

function setMaxAllowedLevel(level) {
    maxAllowedLevel = normalizeMaxAllowedLevel(level);
    localStorage.setItem(MAX_ALLOWED_STORAGE_KEY, String(maxAllowedLevel));
    render();
}

function renderDoseControls() {
    const dose = formatDose(selectedDoseMl);
    elements.takeButton.textContent = `Take ${dose} G`;
    elements.doseDownButton.disabled = selectedDoseMl <= MIN_DOSE_ML;
    elements.doseUpButton.disabled = selectedDoseMl >= MAX_DOSE_ML;
    elements.maxAllowedText.textContent = `${maxAllowedLevel}%`;
    elements.maxAllowedDownButton.disabled = maxAllowedLevel <= MIN_MAX_ALLOWED_LEVEL;
    elements.maxAllowedUpButton.disabled = maxAllowedLevel >= MAX_MAX_ALLOWED_LEVEL;
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

function projectedMaxLevelWithDose(now, doseMl) {
    const endTime = now + RECOMMENDATION_HORIZON_HOURS * 60 * 60 * 1000;
    const sampleEveryMs = 60 * 1000;
    let maxLevel = 0;

    for (let timestamp = now; timestamp <= endTime; timestamp += sampleEveryMs) {
        const minutesAfterNewTake = (timestamp - now) / 60000;
        const projectedLevel = combinedLevelAt(timestamp) + relativeLevel(minutesAfterNewTake) * doseMl;
        maxLevel = Math.max(maxLevel, projectedLevel);
    }

    return maxLevel;
}

function maxRecommendedDose(now) {
    if (projectedMaxLevelWithDose(now, 0) > maxAllowedLevel) {
        return 0;
    }

    for (let cents = MAX_DOSE_CENTS; cents >= 0; cents -= 1) {
        if (!isAllowedDoseCents(cents)) continue;

        const doseMl = centsToMl(cents);
        if (projectedMaxLevelWithDose(now, doseMl) <= maxAllowedLevel) {
            return doseMl;
        }
    }

    return 0;
}

function formatTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(timestamp));
}

function startOfDay(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function formatHistoryTime(timestamp, now = Date.now()) {
    const time = formatTime(timestamp);
    const dayDiff = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86400000);

    if (dayDiff === 0) return time;
    if (dayDiff === 1) return `Yesterday, ${time}`;

    const date = new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short"
    }).format(new Date(timestamp));
    return `${date}, ${time}`;
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
        label.textContent = formatHistoryTime(take.takenAt);
        detail.textContent = `${formatDose(takeDose(take))} - ${formatDuration(Date.now() - take.takenAt)} ago`;

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
    const futureMs = CHART_FUTURE_HOURS * 60 * 60 * 1000;
    const firstTake = takes.length > 0 ? takes[takes.length - 1].takenAt : now;
    const startTime = Math.min(firstTake, now);
    const endTime = now + futureMs;
    const duration = Math.max(1, endTime - startTime);
    const samples = Math.max(96, Math.min(240, Math.ceil(duration / 120000)));
    const points = [];

    for (let index = 0; index <= samples; index += 1) {
        const timestamp = startTime + (index / samples) * duration;
        points.push(combinedLevelAt(timestamp));
    }

    const maxLevel = Math.max(100, maxAllowedLevel, ...points);
    const currentLevel = combinedLevelAt(now);
    const nowX = pad + ((now - startTime) / duration) * plotWidth;
    const nowY = pad + plotHeight - (Math.min(currentLevel, maxLevel) / maxLevel) * plotHeight;
    const allowedMaxY = pad + plotHeight - (maxAllowedLevel / maxLevel) * plotHeight;

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

    context.strokeStyle = "#c84630";
    context.lineWidth = 2;
    context.setLineDash([8, 8]);
    context.beginPath();
    context.moveTo(pad, allowedMaxY);
    context.lineTo(width - pad, allowedMaxY);
    context.stroke();
    context.setLineDash([]);

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

    context.strokeStyle = "#14213d";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(nowX, pad);
    context.lineTo(nowX, pad + plotHeight);
    context.stroke();

    context.fillStyle = "#14213d";
    context.beginPath();
    context.arc(nowX, nowY, 7, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(nowX, nowY, 3, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#647084";
    context.font = "24px system-ui, sans-serif";
    context.fillText(takes.length > 0 ? "first" : "now", pad, height - 8);
    context.textAlign = "center";
    context.fillText("now", nowX, height - 8);
    context.textAlign = "right";
    context.fillText(`+${CHART_FUTURE_HOURS}h`, width - pad, height - 8);
    context.textAlign = "left";
    context.fillText(`${Math.round(maxLevel)}%`, pad, 24);
    context.fillStyle = "#c84630";
    context.fillText("max", pad, Math.max(22, allowedMaxY - 8));
}

function render() {
    const now = Date.now();
    const latest = takes[0];
    const level = combinedLevelAt(now);
    const totalDose = takes.reduce((sum, take) => sum + takeDose(take), 0);
    const recommendedDose = maxRecommendedDose(now);
    const selectedProjectedMax = projectedMaxLevelWithDose(now, selectedDoseMl);
    const barLevel = Math.min(100, Math.max(0, (level / maxAllowedLevel) * 100));

    if (latest) {
        const elapsed = now - latest.takenAt;
        elements.lastTakenText.textContent = `${formatDuration(elapsed)} ago`;
        elements.lastTakenDetail.textContent = `${formatDose(takeDose(latest))} at ${formatTime(latest.takenAt)}`;
    } else {
        elements.lastTakenText.textContent = "No takes yet";
        elements.lastTakenDetail.textContent = "Tap the button when you take G.";
    }

    elements.levelValue.textContent = `${Math.round(level)}%`;
    elements.levelBarFill.style.width = `${barLevel}%`;
    elements.totalTakesText.textContent = String(takes.length);
    elements.totalDoseText.textContent = formatMl(totalDose);
    elements.peakText.textContent = level > 100 ? "Dose-adjusted active level" : "1 ml peak: 100%";
    elements.maxRecommendedText.textContent = formatMl(recommendedDose);
    elements.maxRecommendedDetail.textContent = selectedProjectedMax > maxAllowedLevel
        ? `Selected dose may peak blood level at ${Math.round(selectedProjectedMax)}%.`
        : `Selected dose stays under ${maxAllowedLevel}% blood level.`;
    elements.takeButton.classList.toggle("safe-dose", selectedProjectedMax <= maxAllowedLevel);
    elements.takeButton.classList.toggle("unsafe-dose", selectedProjectedMax > maxAllowedLevel);
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

function showUpdateBanner(worker) {
    pendingServiceWorker = worker;
    elements.updateBanner.hidden = false;
}

async function setupServiceWorkerUpdates() {
    if (!("serviceWorker" in navigator)) return;

    const registration = await navigator.serviceWorker.register("sw.js");
    registration.update();

    if (registration.waiting) {
        showUpdateBanner(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                showUpdateBanner(newWorker);
            }
        });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!updateReloadRequested) return;
        if (updateReloadTimer) {
            window.clearTimeout(updateReloadTimer);
        }
        reloadWithCacheBust();
    });
}

async function init() {
    updateConnectionStatus();
    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);

    elements.takeButton.addEventListener("click", handleTake);
    elements.doseDownButton.addEventListener("click", () => setSelectedDose(previousDose(selectedDoseMl)));
    elements.doseUpButton.addEventListener("click", () => setSelectedDose(nextDose(selectedDoseMl)));
    elements.maxAllowedDownButton.addEventListener("click", () => setMaxAllowedLevel(maxAllowedLevel - MAX_ALLOWED_STEP));
    elements.maxAllowedUpButton.addEventListener("click", () => setMaxAllowedLevel(maxAllowedLevel + MAX_ALLOWED_STEP));
    elements.resetButton.addEventListener("click", () => elements.resetDialog.showModal());
    elements.updateButton.addEventListener("click", () => {
        if (!pendingServiceWorker) {
            reloadWithCacheBust();
            return;
        }

        updateReloadRequested = true;
        elements.updateButton.disabled = true;
        elements.updateButton.textContent = "Reloading";
        pendingServiceWorker.postMessage({ type: "SKIP_WAITING" });
        updateReloadTimer = window.setTimeout(reloadWithCacheBust, 800);
    });
    elements.resetDialog.addEventListener("close", () => {
        if (elements.resetDialog.returnValue === "confirm") {
            handleReset();
        }
    });

    setupServiceWorkerUpdates();

    takes = await readTakes();
    render();
    setInterval(render, 15000);
}

init().catch(error => {
    console.error(error);
    elements.lastTakenDetail.textContent = "Could not load local storage.";
});
