(() => {
  const locations = window.LOCATIONS;
  const board = document.querySelector("#board");
  const counter = document.querySelector("#counter");
  const liveLocation = document.querySelector("#liveLocation");
  const nextButton = document.querySelector("#nextButton");

  if (
    !Array.isArray(locations) ||
    locations.length === 0 ||
    !board ||
    !counter ||
    !liveLocation ||
    !nextButton
  ) {
    if (nextButton) {
      nextButton.disabled = true;
      nextButton.querySelector(".board-button__text").textContent =
        "Локации не загрузились";
    }
    return;
  }

  // Фиксированный порядок символов имитирует настоящую кассету split-flap:
  // каждая карточка перелистывается вперёд по одному и тому же «барабану».
  const FLIP_ALPHABET = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ -".split("");
  const FLIP_STEPS = 7;
  const CARD_FLIP_MS = 84;
  const STEP_MS = 96;
  const COLUMN_DELAY_MS = 22;

  const reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;

  function getAudioContext() {
    var resume;

    if (!AudioContextClass) {
      return null;
    }

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
      resume = audioContext.resume();
      if (resume && typeof resume.catch === "function") {
        resume.catch(function () {});
      }
    }

    return audioContext;
  }

  // Короткий сухой щелчок одной перекидной карточки: всплеск шума через
  // полосовой фильтр даёт «пластиковый» тик настоящего split-flap табло.
  function playFlipClick(context, now) {
    var size, buffer, data, i, source, filter, gain;

    size = Math.floor(context.sampleRate * 0.02);
    buffer = context.createBuffer(1, size, context.sampleRate);
    data = buffer.getChannelData(0);
    for (i = 0; i < size; i = i + 1) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (size * 0.25));
    }

    source = context.createBufferSource();
    source.buffer = buffer;

    filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.8;

    gain = context.createGain();
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(now);
  }

  function flipSound() {
    try {
      const context = getAudioContext();
      if (!context) {
        return;
      }
      playFlipClick(context, context.currentTime);
    } catch (error) {
      // Звук — дополнительная обратная связь и не должен мешать листанию.
    }
  }

  let order = [];
  let index = -1;
  let currentLocation = "";

  function shuffle() {
    order = locations.slice();
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
  }

  function getNextLocation() {
    index += 1;
    if (index >= order.length) {
      shuffle();
      index = 0;
    }
    return order[index];
  }

  function createPanel(modifier, char) {
    const panel = document.createElement("span");
    panel.className = `board__panel board__panel--${modifier}`;

    const glyph = document.createElement("span");
    glyph.className = "board__glyph";
    glyph.textContent = char;
    panel.appendChild(glyph);

    return { panel, glyph };
  }

  function settleCell(cell, char) {
    cell.element.classList.remove("is-flipping");
    cell.top.glyph.textContent = char;
    cell.bottom.glyph.textContent = char;
    cell.flapTop.glyph.textContent = char;
    cell.flapBottom.glyph.textContent = char;
    cell.current = char;
  }

  // Строим табло заново под длину следующей фразы, но стартовые символы
  // берём из предыдущей — так новая локация не успевает мелькнуть до анимации.
  function buildBoard(text, previousText) {
    board.replaceChildren();
    const cells = [];
    const words = text.split(" ");
    const previousGlyphs = [...previousText.replace(/\s/g, "")];
    let glyphIndex = 0;

    words.forEach((word) => {
      const wordEl = document.createElement("span");
      wordEl.className = "board__word";

      for (const char of word) {
        const cell = document.createElement("span");
        cell.className = "board__cell";
        cell.style.setProperty("--card-flip-half-duration", `${CARD_FLIP_MS / 2}ms`);

        const initial = previousGlyphs[glyphIndex] || " ";
        const top = createPanel("top", initial);
        const bottom = createPanel("bottom", initial);
        const flapTop = createPanel("flap-top", initial);
        const flapBottom = createPanel("flap-bottom", initial);

        cell.append(top.panel, bottom.panel, flapTop.panel, flapBottom.panel);
        wordEl.appendChild(cell);
        cells.push({
          element: cell,
          top,
          bottom,
          flapTop,
          flapBottom,
          current: initial,
          target: char,
        });
        glyphIndex += 1;
      }

      // Пробелы между словами задаёт flex-gap контейнера, поэтому отдельные
      // ячейки-пробелы не рисуем — иначе они «повисают» в конце строки при переносе.
      board.appendChild(wordEl);
    });

    return cells;
  }

  const timers = [];

  function clearTimers() {
    while (timers.length) {
      clearTimeout(timers.pop());
    }
  }

  function alphabetIndex(char) {
    const found = FLIP_ALPHABET.indexOf(char.toUpperCase());
    return found === -1 ? FLIP_ALPHABET.indexOf(" ") : found;
  }

  function buildSequence(from, target) {
    const sequence = [];
    const start = alphabetIndex(from);

    for (let step = 1; step < FLIP_STEPS; step += 1) {
      sequence.push(FLIP_ALPHABET[(start + step) % FLIP_ALPHABET.length]);
    }

    sequence.push(target);
    return sequence;
  }

  function flipCell(cell, nextGlyph) {
    const previousGlyph = cell.current;

    // Под падающей верхней створкой уже лежит верх новой карточки,
    // а нижняя половина новой карточки раскрывается во второй фазе.
    cell.top.glyph.textContent = nextGlyph;
    cell.bottom.glyph.textContent = previousGlyph;
    cell.flapTop.glyph.textContent = previousGlyph;
    cell.flapBottom.glyph.textContent = nextGlyph;
    cell.current = nextGlyph;

    cell.element.classList.remove("is-flipping");
    void cell.element.offsetWidth;
    cell.element.classList.add("is-flipping");

    flipSound();

    timers.push(
      setTimeout(() => {
        settleCell(cell, nextGlyph);
      }, CARD_FLIP_MS)
    );
  }

  function animateCell(cell, columnIndex) {
    const startDelay = columnIndex * COLUMN_DELAY_MS;
    const sequence = buildSequence(cell.current, cell.target);

    sequence.forEach((glyph, step) => {
      timers.push(
        setTimeout(() => {
          flipCell(cell, glyph);
        }, startDelay + step * STEP_MS)
      );
    });
  }

  function render(location) {
    clearTimers();
    const cells = buildBoard(location, currentLocation);

    if (reduceMotion.matches) {
      cells.forEach((cell) => {
        settleCell(cell, cell.target);
      });
    } else {
      cells.forEach((cell, columnIndex) => animateCell(cell, columnIndex));
    }

    currentLocation = location;
  }

  function showNext() {
    const location = getNextLocation();
    render(location);
    counter.textContent = `${index + 1} из ${order.length}`;
    liveLocation.textContent = location;
  }

  nextButton.addEventListener("click", showNext);

  document.addEventListener("keydown", (event) => {
    if (
      event.code === "Space" ||
      event.code === "Enter" ||
      event.code === "ArrowRight" ||
      event.key === "Enter"
    ) {
      // Не перехватываем активацию кнопки/ссылки клавиатурой — иначе двойная генерация.
      const active = document.activeElement;
      if (
        (event.code === "Space" || event.key === "Enter") &&
        active &&
        (active.tagName === "BUTTON" || active.tagName === "A")
      ) {
        return;
      }
      event.preventDefault();
      showNext();
    }
  });

  showNext();
})();
