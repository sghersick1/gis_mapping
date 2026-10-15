/** Creates an HTML element to use as a MapLibre tree marker. */
export default function createTreeMarker(): HTMLDivElement {
  const marker = document.createElement("div");
  marker.textContent = "⭐️";
  marker.style.fontSize = "24px";
  marker.style.lineHeight = "1";
  return marker;
}
