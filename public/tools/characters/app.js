(() => {
  "use strict";

  const characters = window.IMPRO_CHARACTERS;
  const name = document.querySelector("#character-name");
  const category = document.querySelector("#character-category");
  const ticket = document.querySelector(".ticket");
  const spark = document.querySelector(".spark");
  const drawButton = document.querySelector("#draw");
  const playedCount = document.querySelector("#played-count");
  const progress = document.querySelector("#progress");
  const progressFill = document.querySelector("#progress-fill");
  const soundButton = document.querySelector("#sound-toggle");
  const listButton = document.querySelector("#list-open");
  const dialog = document.querySelector("#character-list");
  const closeButton = document.querySelector("#list-close");
  const search = document.querySelector("#search");
  const list = document.querySelector("#characters");
  const listCount = document.querySelector("#list-count");
  const emptySearch = document.querySelector("#empty-search");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const played = new Set();
  let deck = [];
  let soundEnabled = true;
  let audioContext;

  const normalize = (value) => value.toLocaleLowerCase("ru").replaceAll("ё", "е");
  const sortedCharacters = [...characters].sort((first, second) => first.name.localeCompare(second.name, "ru"));
  const searchableCharacters = sortedCharacters.map((character) => ({
    character,
    text: normalize(`${character.name} ${character.source} ${character.category}`),
  }));

  // Fisher–Yates makes one shuffled deck. Drawing consumes it without replacement.
  function shuffleDeck() {
    deck = [...characters];
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [deck[index], deck[randomIndex]] = [deck[randomIndex], deck[index]];
    }
  }

  function playSound(kind = "draw") {
    if (!soundEnabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    // Audio is initialized inside a user gesture, including on iOS Safari.
    try {
      audioContext ??= new AudioContext();
      audioContext.resume().catch(() => {});
      const start = audioContext.currentTime;
      const notes = kind === "draw" ? [587.33, 880] : [659.25];
      notes.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const volume = audioContext.createGain();
        const time = start + index * 0.055;
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(frequency, time);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.99, time + 0.16);
        volume.gain.setValueAtTime(0, time);
        volume.gain.linearRampToValueAtTime(0.07, time + 0.006);
        volume.gain.exponentialRampToValueAtTime(0.001, time + 0.19);
        oscillator.connect(volume);
        volume.connect(audioContext.destination);
        oscillator.start(time);
        oscillator.stop(time + 0.2);
        oscillator.onended = () => {
          oscillator.disconnect();
          volume.disconnect();
        };
      });
    } catch {
      // A browser without audio can still run the full character game.
    }
  }

  function animateReveal() {
    ticket.getAnimations().forEach((animation) => animation.cancel());
    spark.getAnimations().forEach((animation) => animation.cancel());
    if (reducedMotion.matches) return;
    ticket.animate([
      { transform: "translateY(12px) rotate(1.5deg) scale(0.97)", opacity: 0.45 },
      { transform: "translateY(-5px) rotate(-1.8deg) scale(1.01)", opacity: 1, offset: 0.65 },
      { transform: "translateY(0) rotate(-1.2deg) scale(1)", opacity: 1 },
    ], { duration: 360, easing: "cubic-bezier(.2,.7,.3,1)" });
    spark.animate([
      { transform: "rotate(-35deg) scale(0.5)" },
      { transform: "rotate(20deg) scale(1.2)", offset: 0.65 },
      { transform: "rotate(5deg) scale(1)" },
    ], { duration: 440, easing: "ease-out" });
  }

  function drawCharacter({ animate = true } = {}) {
    if (deck.length === 0) {
      played.clear();
      shuffleDeck();
    }

    const character = deck.pop();
    played.add(character.name);
    name.textContent = character.name;
    category.textContent = character.category;
    name.dataset.length = character.name.length > 25 ? "long" : character.name.length > 15 ? "medium" : "short";
    playedCount.textContent = played.size;
    playedCount.parentElement.setAttribute("aria-label", `Сыграно ${played.size} из ${characters.length}`);
    progress.setAttribute("aria-valuenow", played.size);
    progressFill.style.width = `${played.size / characters.length * 100}%`;

    const exhausted = deck.length === 0;
    drawButton.textContent = exhausted ? "Начать новую игру" : "Новый персонаж";

    if (animate) {
      animateReveal();
      playSound();
    }
  }

  function renderList() {
    const words = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
    const matches = searchableCharacters.filter(({ text }) => words.every((word) => text.includes(word)));
    const fragment = document.createDocumentFragment();

    matches.forEach(({ character }) => {
      const row = document.createElement("li");
      row.className = "character-row";
      const details = document.createElement("div");
      const label = document.createElement("span");
      label.className = "row-name";
      label.textContent = character.name;
      details.append(label);
      if (normalize(character.source) !== normalize(character.name)) {
        const origin = document.createElement("span");
        origin.className = "row-source";
        origin.textContent = character.source;
        details.append(origin);
      }
      row.append(details);

      if (played.has(character.name)) {
        const status = document.createElement("span");
        status.className = "row-played";
        status.textContent = "✓";
        status.setAttribute("aria-label", "Уже был");
        row.append(status);
      }
      fragment.append(row);
    });

    list.replaceChildren(fragment);
    listCount.textContent = `Найдено ${matches.length} из ${characters.length}`;
    emptySearch.hidden = matches.length > 0;
    document.querySelector(".list-scroll").scrollTop = 0;
  }

  document.querySelectorAll("[data-total]").forEach((element) => { element.textContent = characters.length; });
  progress.setAttribute("aria-valuemax", characters.length);
  shuffleDeck();
  drawCharacter({ animate: false });

  drawButton.addEventListener("click", () => drawCharacter());
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || dialog.open) return;
    if (event.target.closest("button, a, input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    drawCharacter();
  });

  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    const label = soundEnabled ? "Выключить звук" : "Включить звук";
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.setAttribute("aria-label", label);
    soundButton.title = label;
    playSound("ui");
  });

  listButton.addEventListener("click", () => {
    renderList();
    dialog.showModal();
    search.focus();
    playSound("ui");
  });

  function closeList() {
    dialog.close();
    playSound("ui");
  }

  closeButton.addEventListener("click", closeList);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeList();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeList();
  });
  dialog.addEventListener("close", () => listButton.focus());
  search.addEventListener("input", renderList);
})();
