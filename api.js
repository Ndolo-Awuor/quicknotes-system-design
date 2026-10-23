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
  submitButton.disabled = value;
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

function updateTitleCount() {
  const length = Array.from(titleInput.value).length;
  titleCount.textContent = `${length} / 100 characters`;
  titleCount.classList.toggle("warning", length > 90);
  titleCount.classList.toggle("over", length > 100);
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
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-btn";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete note: ${displayedTitle}`);
    remove.disabled = busy;
    remove.addEventListener("click", () => deleteNote(note.key));
    meta.append(label, remove);
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

async function createNote(event) {
  event.preventDefault();
  if (busy) return;
  const title = titleInput.value.trim();
  if (title === "" || Array.from(title).length > 100) {
    titleInput.setAttribute("aria-invalid", "true");
    setStatus(title === "" ? "Please enter a title." : "Titles must be 100 characters or fewer.", "error");
    titleInput.focus();
    return;
  }
  titleInput.removeAttribute("aria-invalid");
  setBusy(true);
  setStatus("Creating note...", "loading");
  submitButton.textContent = "Creating...";
  try {
    const { data, status } = await request(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ title, body: bodyInput.value.trim(), userId: 1 }),
    });
    if (!isNote(data)) throw new Error("Unexpected response format.");
    // JSONPlaceholder may return id 101 for every POST. A separate local key
    // keeps each displayed note distinct, while retaining the returned API id.
    notes.unshift({ ...data, key: `note-${nextKey++}`, simulated: true });
    renderNotes();
    setStatus(`Note created (status ${status}, id ${data.id}).`, "success");
    form.reset();
    updateTitleCount();
  } catch (error) {
    setStatus(friendlyError("create the note", error), "error");
  } finally {
    submitButton.textContent = "Create note";
    setBusy(false);
    titleInput.focus();
  }
}

async function deleteNote(key) {
  if (busy) return;
  const note = notes.find((item) => item.key === key);
  if (!note) return;
  setBusy(true);
  setStatus("Deleting note...", "loading");
  try {
    const { status } = await request(`${API_URL}/${note.id}`, { method: "DELETE" });
    notes = notes.filter((item) => item.key !== key);
    renderNotes();
    setStatus(`Note deleted (status ${status}, id ${note.id}).`, "success");
  } catch (error) {
    // The practice API never persists a POST, so its returned id may not exist
    // for DELETE. Only a 404 for a note created in this session is treated as
    // already absent; network errors, 500s and failures for loaded notes remain
    // errors, and those notes stay visible. Reloading restores server fixtures.
    if (note.simulated && error.status === 404) {
      notes = notes.filter((item) => item.key !== key);
      renderNotes();
      setStatus("Practice note removed locally; the server did not persist it (status 404).", "success");
    } else {
      setStatus(friendlyError("delete the note", error), "error");
    }
  } finally {
    setBusy(false);
    loadButton.focus();
  }
}

loadButton.addEventListener("click", loadNotes);
originalTextToggle.addEventListener("change", () => {
  if (notes.length > 0) renderNotes();
});
form.addEventListener("submit", createNote);
titleInput.addEventListener("input", () => {
  titleInput.removeAttribute("aria-invalid");
  updateTitleCount();
});
updateTitleCount();
