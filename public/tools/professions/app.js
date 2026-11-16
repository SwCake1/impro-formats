(() => {
  "use strict";

  const professions = window.IMPRO_PROFESSIONS;
  const name = document.querySelector("#profession-name");
  const counter = document.querySelector("#counter");
  const announcement = document.querySelector("#announcement");
  const nextButton = document.querySelector("#next-button");
  const nextLabel = document.querySelector("#next-label");
  const soundButton = document.querySelector("#sound-button");
  const listButton = document.querySelector("#list-button");
  const dialog = document.querySelector("#professions-dialog");
  const search = document.querySelector("#profession-search");
  const list = document.querySelector("#professions-list");
  const listTotal = document.querySelector("#list-total");
  const searchStatus = document.querySelector("#search-status");
  const emptySearch = document.querySelector("#empty-search");
  const sparkleLayer = document.querySelector("#sparkle-layer");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const measureContext = document.createElement("canvas").getContext("2d");
  const AudioContext = window.AudioContext || window.webkitAudioContext;

  let deck = [];
  let shown = 0;
  let current = "";
  let soundEnabled = Boolean(AudioContext);
  let audioContext;
  let activeChime;
  let nameAnimation;
  let counterAnimation;
  const seen = new Set();
  const listItems = new Map();

  function shuffleDeck() {
    deck = [...professions];
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [deck[index], deck[randomIndex]] = [deck[randomIndex], deck[index]];
    }
    // A new round begins with a different profession from the previous one.
    if (deck[0] === current) {
      [deck[0], deck[1]] = [deck[1], deck[0]];
    }
    shown = 0;
    seen.clear();
  }

  function fitName() {
    name.style.fontSize = "";
    if (!measureContext) return;

    const style = window.getComputedStyle(name);
    const baseSize = Number.parseFloat(style.fontSize);
    measureContext.font = `${style.fontWeight} ${baseSize}px ${style.fontFamily}`;
    const widestWord = Math.max(...current.split(/\s+/).map((word) => measureContext.measureText(word).width));
    const scale = Math.min(1, (name.clientWidth - 4) / widestWord);
    name.style.fontSize = `${baseSize * scale}px`;
  }

  function stopChime() {
    if (!activeChime) return;

    const now = audioContext.currentTime;
    activeChime.volume.gain.setTargetAtTime(0, now, 0.012);
    for (const tone of activeChime.tones) tone.stop(now + 0.05);
    activeChime = null;
  }

  async function playSound(action = "next") {
    if (!soundEnabled) return;

    try {
      audioContext ??= new AudioContext();
      if (audioContext.state === "suspended") await audioContext.resume();
      if (!soundEnabled || audioContext.state !== "running") return;

      const now = audioContext.currentTime;
      stopChime();
      const volume = audioContext.createGain();
      volume.gain.value = 0.55;
      volume.connect(audioContext.destination);
      const chime = { volume, tones: new Set() };
      activeChime = chime;
      const notes = action === "next" ? [880, 1108.73, 1318.51] : [1318.51];
      // Inharmonic partials give each note a clear, shimmering bell timbre.
      const partials = [
        { ratio: 1, gain: 0.12, decay: 0.95 },
        { ratio: 2.756, gain: 0.035, decay: 0.5 },
        { ratio: 5.404, gain: 0.008, decay: 0.28 },
      ];

      notes.forEach((frequency, noteIndex) => {
        const start = now + noteIndex * 0.075;
        for (const partial of partials) {
          const tone = audioContext.createOscillator();
          const envelope = audioContext.createGain();
          tone.type = "sine";
          tone.frequency.value = frequency * partial.ratio;
          envelope.gain.setValueAtTime(0.0001, start);
          envelope.gain.linearRampToValueAtTime(partial.gain, start + 0.004);
          envelope.gain.exponentialRampToValueAtTime(0.0001, start + partial.decay);
          tone.connect(envelope).connect(volume);
          chime.tones.add(tone);
          tone.onended = () => {
            tone.disconnect();
            envelope.disconnect();
            chime.tones.delete(tone);
            if (chime.tones.size === 0) {
              volume.disconnect();
              if (activeChime === chime) activeChime = null;
            }
          };
          tone.start(start);
          tone.stop(start + partial.decay + 0.02);
        }
      });
    } catch {
      soundEnabled = false;
      updateSoundButton();
    }
  }

  function updateSoundButton() {
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    const label = soundEnabled ? "Выключить звук" : "Включить звук";
    soundButton.setAttribute("aria-label", label);
    soundButton.title = label;
    if (!AudioContext) {
      soundButton.disabled = true;
      soundButton.setAttribute("aria-label", "Звук недоступен в этом браузере");
      soundButton.title = "Звук недоступен в этом браузере";
    }
  }

  function updateList() {
    for (const [profession, item] of listItems) {
      const wasSeen = seen.has(profession);
      item.classList.toggle("is-seen", wasSeen);
      item.classList.toggle("is-current", profession === current);
      item.setAttribute("aria-label", `${profession}${wasSeen ? ", уже показана" : ""}`);
    }
  }

  function showNext({ animate = true } = {}) {
    if (shown === professions.length) shuffleDeck();
    current = deck[shown];
    shown += 1;
    seen.add(current);

    name.textContent = current;
    counter.replaceChildren(document.createTextNode(`${String(shown).padStart(2, "0")} `));
    const total = document.createElement("span");
    total.textContent = `/ ${professions.length}`;
    counter.append(total);
    counter.setAttribute("aria-label", `Показано ${shown} из ${professions.length}`);
    announcement.textContent = `${current}. ${shown} из ${professions.length}.`;
    const complete = shown === professions.length;
    nextLabel.textContent = complete ? "Новый круг" : "Следующая";
    nextButton.setAttribute("aria-label", complete ? "Перемешать профессии и начать новый круг" : "Следующая профессия");
    fitName();

    if (dialog.open) updateList();
    nameAnimation?.cancel();
    counterAnimation?.cancel();
    if (animate && !reducedMotion.matches) {
      nameAnimation = name.animate([
        { opacity: 0, transform: "translateY(22px) scale(0.97)", filter: "blur(6px)" },
        { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
      ], { duration: 380, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      counterAnimation = counter.animate([
        { transform: "translateY(4px)", opacity: 0.4 },
        { transform: "translateY(0)", opacity: 1 },
      ], { duration: 260, easing: "ease-out" });
    }
  }

  function emitSparkles(event) {
    if (reducedMotion.matches) return;

    const bounds = nextButton.getBoundingClientRect();
    const fromPointer = event && event.detail > 0;
    const x = fromPointer ? event.clientX : bounds.left + bounds.width / 2;
    const y = fromPointer ? event.clientY : bounds.top + bounds.height / 2;
    const burst = document.createElement("span");
    burst.className = "sparkle-burst";
    burst.style.left = `${x}px`;
    burst.style.top = `${y}px`;
    const colors = ["#b2d550", "#d2ac4c", "#a99cdb"];

    for (let index = 0; index < 18; index += 1) {
      const sparkle = document.createElement("span");
      sparkle.className = index % 3 === 0 ? "sparkle sparkle--dot" : "sparkle";
      const angle = (index / 18) * Math.PI * 2 + Math.random() * 0.3;
      const distance = 40 + Math.random() * 80;
      const offsetX = Math.cos(angle) * distance;
      const offsetY = Math.sin(angle) * distance - 25;
      sparkle.style.setProperty("--sparkle-x", `${offsetX}px`);
      sparkle.style.setProperty("--sparkle-y", `${offsetY}px`);
      sparkle.style.setProperty("--sparkle-mid-x", `${offsetX * 0.25}px`);
      sparkle.style.setProperty("--sparkle-mid-y", `${offsetY * 0.25}px`);
      sparkle.style.setProperty("--sparkle-rotation", `${Math.random() * 240 - 120}deg`);
      sparkle.style.setProperty("--sparkle-size", `${6 + Math.random() * 10}px`);
      sparkle.style.setProperty("--sparkle-color", colors[index % colors.length]);
      burst.append(sparkle);
    }

    // Bound the transient effect during rapid repeated taps.
    if (sparkleLayer.childElementCount >= 6) sparkleLayer.firstElementChild.remove();
    burst.addEventListener("animationend", () => burst.remove(), { once: true });
    sparkleLayer.append(burst);
  }

  function advance(event) {
    showNext();
    emitSparkles(event);
    void playSound();
  }

  function filterList() {
    const query = search.value.trim().toLocaleLowerCase("ru").replaceAll("ё", "е");
    let matches = 0;
    for (const [profession, item] of listItems) {
      item.hidden = !profession.toLocaleLowerCase("ru").replaceAll("ё", "е").includes(query);
      if (!item.hidden) matches += 1;
    }
    emptySearch.hidden = matches > 0;
    listTotal.textContent = String(matches);
    searchStatus.textContent = `Найдено ${matches} из ${professions.length}`;
  }

  for (const profession of [...professions].sort((a, b) => a.localeCompare(b, "ru"))) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = profession;
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    mark.setAttribute("viewBox", "0 0 24 24");
    mark.setAttribute("class", "seen-mark");
    mark.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m5 12 4 4 10-10");
    mark.append(path);
    item.append(label, mark);
    list.append(item);
    listItems.set(profession, item);
  }

  nextButton.addEventListener("click", advance);
  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    updateSoundButton();
    if (!soundEnabled) stopChime();
    void playSound("toggle");
  });

  listButton.addEventListener("click", () => {
    search.value = "";
    filterList();
    updateList();
    dialog.showModal();
    dialog.querySelector(".list-scroll").scrollTop = 0;
    void playSound("open");
  });

  document.querySelector("#close-list").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    listButton.focus({ preventScroll: true });
    void playSound("close");
  });
  search.addEventListener("input", filterList);

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || dialog.open) return;
    if (event.target.closest("button, a, input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    advance();
  });

  window.addEventListener("resize", fitName);
  reducedMotion.addEventListener("change", () => {
    nameAnimation?.cancel();
    counterAnimation?.cancel();
    sparkleLayer.replaceChildren();
  });
  updateSoundButton();
  shuffleDeck();
  showNext({ animate: false });
  document.fonts.ready.then(fitName);
})();
