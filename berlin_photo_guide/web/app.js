const map = L.map("map", { zoomControl: false }).setView([52.52, 13.405], 12);
L.control
  .zoom({ position: "bottomright" })
  .addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

const userLocation = {
  marker: null,
  circle: null,
};

const renderUserLocation = (latlng, accuracy) => {
  if (userLocation.marker) {
    userLocation.marker.setLatLng(latlng);
  } else {
    userLocation.marker = L.circleMarker(latlng, {
      radius: 6,
      color: "#1f6f8b",
      fillColor: "#1f6f8b",
      fillOpacity: 1,
      weight: 2,
    }).addTo(map);
  }

  if (accuracy) {
    if (userLocation.circle) {
      userLocation.circle.setLatLng(latlng).setRadius(accuracy);
    } else {
      userLocation.circle = L.circle(latlng, {
        radius: accuracy,
        color: "#1f6f8b",
        fillColor: "#1f6f8b",
        fillOpacity: 0.08,
        weight: 1,
      }).addTo(map);
    }
  }
};

map.locate({ setView: false, enableHighAccuracy: true, maximumAge: 30000 });
map.on("locationfound", (event) => {
  renderUserLocation(event.latlng, event.accuracy);
});

map.on("locationerror", (event) => {
  console.warn("Location access denied or unavailable:", event.message);
});

const panelTitle = document.getElementById("panel-title");
const panelLocation = document.getElementById("panel-location");
const panelMeta = document.getElementById("panel-meta");
const panelSections = document.getElementById("panel-sections");
const panelHero = document.getElementById("panel-hero");

const accessibilityClass = (value) => {
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (normalized.includes("easy")) return "accessibility-easy";
  if (normalized.includes("medium")) return "accessibility-medium";
  if (normalized.includes("hard")) return "accessibility-hard";
  return "";
};

const createTag = (label, className = "") => {
  const span = document.createElement("span");
  span.className = `tag ${className}`.trim();
  span.textContent = label;
  return span;
};

const renderSection = (title, items) => {
  if (!items || !items.length) return null;
  const cleaned = items.map((item) => item.trim()).filter((item) => item);
  if (!cleaned.length) return null;
  const section = document.createElement("div");
  section.className = "section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("ul");
  cleaned.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
  section.appendChild(heading);
  section.appendChild(list);
  return section;
};

const renderPanel = (place) => {
  panelTitle.textContent = place.title || "Untitled";
  panelLocation.innerHTML = "";
  if (place.location) {
    const locationText = document.createElement("span");
    locationText.textContent = place.location;
    panelLocation.appendChild(locationText);
  }
  if (place.coordinates) {
    const mapsLink = document.createElement("a");
    mapsLink.href = `https://maps.google.com/?q=${place.coordinates.lat},${place.coordinates.lng}`;
    mapsLink.target = "_blank";
    mapsLink.rel = "noopener noreferrer";
    mapsLink.textContent = "Open in Google Maps";
    mapsLink.className = "maps-link";
    panelLocation.appendChild(mapsLink);
  }

  panelMeta.innerHTML = "";
  if (place.accessibility) {
    panelMeta.appendChild(
      createTag(
        `Accessibility: ${place.accessibility}`,
        accessibilityClass(place.accessibility)
      )
    );
  }
  if (place.coordinates) {
    panelMeta.appendChild(
      createTag(`${place.coordinates.lat.toFixed(5)}, ${place.coordinates.lng.toFixed(5)}`)
    );
  }

  panelSections.innerHTML = "";
  const sections = [
    ["Hours", place.hours],
    ["Best time", place.best_time_to_visit],
    ["Entry fee", place.entry_fee],
    ["Gear", place.gear],
    ["Settings", place.settings],
    ["Tripod", place.tripod],
    ["Tips", place.tips],
  ];

  sections.forEach(([title, items]) => {
    const section = renderSection(title, items);
    if (section) panelSections.appendChild(section);
  });

  panelHero.innerHTML = "";
  if (place.image) {
    const img = document.createElement("img");
    img.src = place.image;
    img.alt = place.title || "";
    panelHero.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "panel-hero-placeholder";
    placeholder.textContent = "No image available";
    panelHero.appendChild(placeholder);
  }
};

const markerColors = {
  easy: "#4caf50",
  medium: "#f4b542",
  hard: "#e74c3c",
  default: "#1f6f8b",
};

const markerFor = (place) => {
  const key = (place.accessibility || "").toLowerCase();
  const color = markerColors[key] || markerColors.default;
  return L.circleMarker([place.coordinates.lat, place.coordinates.lng], {
    radius: 7,
    color,
    fillColor: color,
    fillOpacity: 0.9,
    weight: 2,
  });
};

fetch("data/places.json")
  .then((resp) => resp.json())
  .then((places) => {
    const markers = [];
    places.forEach((place) => {
      if (!place.coordinates) return;
      const marker = markerFor(place).addTo(map);
      marker.on("click", () => renderPanel(place));
      marker.bindTooltip(place.title || "Untitled", {
        direction: "top",
        opacity: 0.85,
      });
      markers.push(marker);
    });

    if (markers.length) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  })
  .catch((err) => {
    panelTitle.textContent = "Failed to load places";
    panelLocation.textContent = "Check the console for details.";
    console.error(err);
  });
