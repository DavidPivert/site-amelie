const form = document.querySelector("#qrForm");
const generateButton = document.querySelector("#generateButton");
const formStatus = document.querySelector("#formStatus");
const entryCount = document.querySelector("#entryCount");
const historyList = document.querySelector("#historyList");
const previewShell = document.querySelector("#previewShell");
const previewMeta = document.querySelector("#previewMeta");
const previewTitle = document.querySelector("#previewTitle");
const previewUrl = document.querySelector("#previewUrl");
const previewDate = document.querySelector("#previewDate");
const downloadLinks = document.querySelector("#downloadLinks");
const downloadPng = document.querySelector("#downloadPng");
const downloadSvg = document.querySelector("#downloadSvg");

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

let entries = [];

function setStatus(message, type = "") {
  formStatus.textContent = message;
  formStatus.className = type ? `status ${type}` : "status";
}

function updateCounter() {
  const count = entries.length;
  entryCount.textContent = count > 1 ? `${count} QR enregistrés` : `${count} QR enregistré`;
}

function getEntryLabel(entry) {
  return entry.name?.trim() || entry.slug || "QR YouTube";
}

function renderPreview(entry) {
  if (!entry) {
    previewShell.className = "preview-shell empty";
    previewShell.innerHTML = `
      <div>
        <strong>Aucun QR généré pour l’instant.</strong>
        <p>Le premier aperçu apparaîtra ici.</p>
      </div>
    `;
    previewMeta.hidden = true;
    downloadLinks.hidden = true;
    return;
  }

  previewShell.className = "preview-shell";
  previewShell.innerHTML = `
    <div>
      <div class="preview-visual">
        <img src="${entry.files.svg}" alt="Aperçu du QR code ${getEntryLabel(entry)}">
      </div>
    </div>
  `;

  previewMeta.hidden = false;
  previewTitle.textContent = getEntryLabel(entry);
  previewUrl.href = entry.url;
  previewUrl.textContent = entry.url;
  previewDate.textContent = `Créé le ${dateFormatter.format(new Date(entry.createdAt))}`;

  downloadLinks.hidden = false;
  downloadPng.href = entry.files.png;
  downloadPng.download = `${entry.slug}.png`;
  downloadSvg.href = entry.files.svg;
  downloadSvg.download = `${entry.slug}.svg`;
}

function createHistoryItem(entry) {
  const article = document.createElement("article");
  article.className = "history-item";

  const header = document.createElement("div");
  header.className = "history-item-header";

  const titleBlock = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = getEntryLabel(entry);
  const date = document.createElement("p");
  date.className = "history-date";
  date.textContent = dateFormatter.format(new Date(entry.createdAt));
  titleBlock.append(title, date);

  const preview = document.createElement("div");
  preview.className = "history-preview";
  const previewImage = document.createElement("img");
  previewImage.src = entry.files.svg;
  previewImage.alt = `QR code ${getEntryLabel(entry)}`;
  preview.appendChild(previewImage);

  header.append(titleBlock, preview);

  const url = document.createElement("p");
  url.className = "history-url";
  url.textContent = entry.url;

  const links = document.createElement("div");
  links.className = "history-links";

  const previewLink = document.createElement("a");
  previewLink.className = "micro-link";
  previewLink.href = "#";
  previewLink.textContent = "Voir l’aperçu";
  previewLink.addEventListener("click", (event) => {
    event.preventDefault();
    renderPreview(entry);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const pngLink = document.createElement("a");
  pngLink.className = "micro-link";
  pngLink.href = entry.files.png;
  pngLink.download = `${entry.slug}.png`;
  pngLink.textContent = "PNG";

  const svgLink = document.createElement("a");
  svgLink.className = "micro-link";
  svgLink.href = entry.files.svg;
  svgLink.download = `${entry.slug}.svg`;
  svgLink.textContent = "SVG";

  const youtubeLink = document.createElement("a");
  youtubeLink.className = "micro-link";
  youtubeLink.href = entry.url;
  youtubeLink.target = "_blank";
  youtubeLink.rel = "noreferrer";
  youtubeLink.textContent = "YouTube";

  links.append(previewLink, pngLink, svgLink, youtubeLink);
  article.append(header, url, links);

  return article;
}

function renderHistory() {
  historyList.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.innerHTML = `
      <strong>Aucun QR enregistré.</strong>
      <p>Générez votre premier QR pour voir l’historique apparaître ici.</p>
    `;
    historyList.appendChild(empty);
    renderPreview(null);
    updateCounter();
    return;
  }

  entries.forEach((entry) => {
    historyList.appendChild(createHistoryItem(entry));
  });

  renderPreview(entries[0]);
  updateCounter();
}

async function loadEntries() {
  const response = await fetch("/api/qrcodes", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Impossible de charger les QR existants.");
  }

  const data = await response.json();
  entries = Array.isArray(data.entries) ? data.entries : [];
  renderHistory();
}

async function handleSubmit(event) {
  event.preventDefault();

  const formData = new FormData(form);
  const url = `${formData.get("url") || ""}`.trim();
  const name = `${formData.get("name") || ""}`.trim();

  generateButton.disabled = true;
  setStatus("Génération du QR code en cours…");

  try {
    const response = await fetch("/api/qrcodes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, name }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "La génération a échoué.");
    }

    form.reset();
    setStatus("Le QR code a bien été généré et enregistré localement.", "success");
    await loadEntries();
    renderPreview(payload.entry);
  } catch (error) {
    setStatus(error.message || "Une erreur est survenue.", "error");
  } finally {
    generateButton.disabled = false;
  }
}

form.addEventListener("submit", handleSubmit);

loadEntries().catch((error) => {
  console.error(error);
  setStatus("Impossible de charger l’historique local.", "error");
});
