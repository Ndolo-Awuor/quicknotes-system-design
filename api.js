"use strict";

const API_URL = "https://jsonplaceholder.typicode.com/posts";
// Readable display examples for API IDs 1–10, not translations or real records.
// Keep the fetched title/body in notes so the original API text can be inspected.
const ENGLISH_EXAMPLES = [
  { title: "Weekend grocery shopping", body: "Ask Judith Kerubo whether we need milk, bread, eggs and tomatoes for the weekend." },
  { title: "Plan the team meeting", body: "Check with Peter Onyango about a suitable time to discuss this week's tasks." },
  { title: "Check the electricity bill", body: "Review the electricity bill with Mike Ndolo and set aside money before the due date." },
  { title: "Choose a birthday gift", body: "Ask Zipporah Kwamboka for gift ideas and compare prices before buying anything." },
  { title: "Make time for a walk", body: "Invite George Atambo for a 30-minute walk and take a bottle of water." },
  { title: "Revise SQL joins", body: "Practise INNER JOIN and LEFT JOIN with Thomas Mosomi using the school database." },
  { title: "Check the car before travelling", body: "Ask David Onchere to help check tyre pressure, oil and coolant before the trip." },
  { title: "Try a new dinner recipe", body: "Share a pilau recipe with George Moochi and make a list of the ingredients." },
  { title: "Find a book to read", body: "Ask Chebet Vanessa to recommend a book and check whether the library has a copy." },
  { title: "Prepare the Day 8 presentation", body: "Review the QuickNotes demo with Atogo Michael and practise explaining the architecture diagram." },
];
const loadButton = document.querySelector("#load-btn");
const statusMessage = document.querySelector("#status");
const form = document.querySelector("#note-form");
const titleInput = document.querySelector("#title-input");
const bodyInput = document.querySelector("#body-input");
const submitButton = document.querySelector("#submit-btn");
const list = document.querySelector("#notes-list");
const noteCount = document.querySelector("#note-count");
const titleCount = document.querySelector("#title-count");
const originalTextToggle = document.querySelector("#show-original");

let notes = [];
let busy = false;
let nextKey = 1;

function setStatus(message, kind = "info") {
  statusMessage.textContent = message;
  statusMessage.className = `status ${kind}`;
}

function setBusy(value) {
  busy = value;
  loadButton.disabled = value;
  // Creating notes is added in the next task.
  submitButton.disabled = true;
  titleInput.disabled = value;
  bodyInput.disabled = value;
  originalTextToggle.disabled = value;
  list.setAttribute("aria-busy", String(value));
  document.querySelectorAll(".delete-btn").forEach((button) => {
    button.disabled = value;
  });
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`The server returned status ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    // A real DELETE endpoint may return 204 with no response body.
    const text = await response.text();
    return { data: text ? JSON.parse(text) : null, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function friendlyError(action, error) {
  if (error.name === "AbortError") {
    return `Could not ${action}: the request timed out. Please try again.`;
  }
  if (error.status) {
    return `Could not ${action}: the server returned status ${error.status}. Please try again.`;
  }
  return `Could not ${action}. Check your connection and try again.`;
}

function isNote(value) {
  return value && Number.isInteger(value.id) && value.id > 0 &&
    typeof value.title === "string" && typeof value.body === "string";
}

function renderNotes(emptyMessage = "No notes yet. Create a note to get started.") {
  list.replaceChildren();
  noteCount.textContent = notes.length === 1
    ? "1 note displayed."
    : `${notes.length} notes displayed.`;
  if (notes.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    list.appendChild(empty);
    return;
  }
  notes.forEach((note) => {
    const example = !note.simulated && !originalTextToggle.checked
      ? ENGLISH_EXAMPLES[note.id - 1]
      : null;
    const displayedTitle = example ? example.title : note.title;
    const displayedBody = example ? example.body : note.body;
    const card = document.createElement("li");
    card.className = "note-card";
    card.dataset.key = note.key;
    const title = document.createElement("h3");
    title.textContent = displayedTitle;
    const body = document.createElement("p");
    body.className = "note-body";
    body.textContent = displayedBody || "No additional text.";
    const meta = document.createElement("div");
    meta.className = "note-meta";
    const label = document.createElement("small");
    label.textContent = `Server ID ${note.id}${note.simulated ? " · practice note" : example ? " · English demo example" : ""}`;
    meta.appendChild(label);
    card.append(title, body, meta);
    list.appendChild(card);
  });
}

async function loadNotes() {
  if (busy) return;
  setBusy(true);
  setStatus("Loading notes...", "loading");
  loadButton.textContent = "Loading...";
  try {
    const { data } = await request(`${API_URL}?_limit=10`);
    if (!Array.isArray(data) || !data.every(isNote)) {
      throw new Error("Unexpected response format.");
    }
    notes = data.slice(0, 10).map((note) => ({
      ...note, key: `note-${nextKey++}`, simulated: false,
    }));
    renderNotes("No notes were returned by the server. You can create one above.");
    setStatus(`Loaded ${notes.length} ${notes.length === 1 ? "note" : "notes"} from the server.`, "success");
  } catch (error) {
    setStatus(friendlyError("load notes", error), "error");
    if (notes.length === 0) renderNotes("No notes to show. Try loading again.");
  } finally {
    loadButton.textContent = "Load notes";
    setBusy(false);
  }
}

loadButton.addEventListener("click", loadNotes);
originalTextToggle.addEventListener("change", () => {
  if (notes.length > 0) renderNotes();
});
form.addEventListener("submit", (event) => event.preventDefault());
