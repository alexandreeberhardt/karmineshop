const CATEGORIES = {
  all: "Tout",
  maillot: "Maillots",
  decal: "Decals RL",
  bracelet: "Bracelets",
  accessoire: "Accessoires",
  visuel: "Visuels",
};

const state = {
  creations: [],
  category: "all",
  sort: "likes",
  randomOrder: new Map(),
};

const grid = document.getElementById("grid");
const statusLine = document.getElementById("status");
const filters = document.getElementById("filters");
const sortSelect = document.getElementById("sort");
const template = document.getElementById("card-template");
const viewer = document.getElementById("viewer");

const dateFormat = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

async function loadCreations() {
  try {
    const response = await fetch("/api/creations", { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    state.creations = await response.json();
    state.creations.forEach((creation) => state.randomOrder.set(creation.id, Math.random()));
    renderFilters();
    render();
  } catch {
    statusLine.textContent = "Impossible de charger les créations. Réessaie dans un instant.";
  }
}

function renderFilters() {
  const counts = { all: state.creations.length };
  for (const creation of state.creations) {
    counts[creation.category] = (counts[creation.category] || 0) + 1;
  }

  filters.replaceChildren();
  for (const [key, label] of Object.entries(CATEGORIES)) {
    if (!counts[key]) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.category = key;
    button.setAttribute("aria-pressed", String(key === state.category));
    button.innerHTML = `${label} <span>${counts[key]}</span>`;
    button.addEventListener("click", () => {
      state.category = key;
      filters.querySelectorAll(".chip").forEach((chip) => {
        chip.setAttribute("aria-pressed", String(chip.dataset.category === key));
      });
      render();
    });
    filters.append(button);
  }
}

function sortedCreations() {
  const visible = state.creations.filter(
    (creation) => state.category === "all" || creation.category === state.category,
  );
  const byDate = (a, b) => b.date.localeCompare(a.date);
  if (state.sort === "recent") return visible.sort(byDate);
  if (state.sort === "random") {
    return visible.sort((a, b) => state.randomOrder.get(a.id) - state.randomOrder.get(b.id));
  }
  return visible.sort((a, b) => b.likes - a.likes || (b.xLikes || 0) - (a.xLikes || 0) || byDate(a, b));
}

function render() {
  const list = sortedCreations();
  statusLine.textContent = list.length ? "" : "Aucune création dans cette catégorie pour l'instant.";
  statusLine.hidden = list.length > 0;
  grid.replaceChildren(...list.map(createCard));
}

function createCard(creation) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.id = creation.id;

  const image = card.querySelector("img");
  image.src = creation.images[0];
  image.alt = creation.title;

  const count = card.querySelector(".card-count");
  if (creation.video) {
    count.hidden = false;
    count.textContent = "▶ Vidéo";
  } else if (creation.images.length > 1) {
    count.hidden = false;
    count.textContent = `${creation.images.length} images`;
  }

  card.querySelector(".card-media").setAttribute("aria-label", `Voir ${creation.title} en grand`);
  card.querySelector(".card-media").addEventListener("click", () => openViewer(creation));
  card.querySelector(".card-category").textContent = CATEGORIES[creation.category] || creation.category;
  card.querySelector(".card-title").textContent = creation.title;

  const author = card.querySelector(".card-author");
  author.href = creation.url;
  author.textContent = `par ${creation.author.handle}`;

  updateLikeButton(card.querySelector(".like"), creation);
  card.querySelector(".like").addEventListener("click", () => toggleLike(creation));
  return card;
}

function updateLikeButton(button, creation) {
  button.setAttribute("aria-pressed", String(creation.liked));
  button.setAttribute(
    "aria-label",
    `${creation.liked ? "Retirer mon like de" : "Liker"} ${creation.title}, ${creation.likes} like${creation.likes > 1 ? "s" : ""}`,
  );
  button.querySelector(".like-count").textContent = creation.likes;
}

function refreshLikeButtons(creation) {
  document.querySelectorAll(`[data-id="${creation.id}"] .like`).forEach((button) => {
    updateLikeButton(button, creation);
  });
}

async function toggleLike(creation) {
  const previous = { liked: creation.liked, likes: creation.likes };
  creation.liked = !previous.liked;
  creation.likes = previous.likes + (creation.liked ? 1 : -1);
  refreshLikeButtons(creation);

  try {
    const response = await fetch(`/api/creations/${creation.id}/like`, {
      method: creation.liked ? "POST" : "DELETE",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    creation.liked = body.liked;
    creation.likes = body.likes;
  } catch (error) {
    creation.liked = previous.liked;
    creation.likes = previous.likes;
    showToast(error.message || "Le like n'a pas pu être enregistré.");
  }
  refreshLikeButtons(creation);
}

function showToast(message) {
  const toast = document.createElement("p");
  toast.className = "toast";
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 3500);
}

function openViewer(creation) {
  viewer.dataset.id = creation.id;
  document.getElementById("viewer-title").textContent = creation.title;
  document.getElementById("viewer-author").textContent =
    `${creation.author.name} · ${creation.author.handle} · ${dateFormat.format(new Date(creation.date))}`;
  document.getElementById("viewer-text").textContent = creation.description || "";

  const media = document.getElementById("viewer-media");
  media.replaceChildren(
    ...creation.images.map((src, index) => {
      const image = document.createElement("img");
      image.src = src;
      image.alt = `${creation.title}, image ${index + 1} sur ${creation.images.length}`;
      image.referrerPolicy = "no-referrer";
      return image;
    }),
  );

  const actions = document.getElementById("viewer-actions");
  const like = template.content.querySelector(".like").cloneNode(true);
  like.addEventListener("click", () => toggleLike(creation));
  updateLikeButton(like, creation);

  const source = document.createElement("a");
  source.className = "source";
  source.href = creation.url;
  source.target = "_blank";
  source.rel = "noopener";
  source.textContent = "Voir le post original sur X →";
  actions.replaceChildren(like, source);

  viewer.showModal();
  media.scrollTop = 0;
}

viewer.addEventListener("click", (event) => {
  if (event.target === viewer || event.target.closest("[data-close]")) viewer.close();
});

sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  render();
});

loadCreations();
