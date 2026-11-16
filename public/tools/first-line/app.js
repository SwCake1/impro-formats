(() => {
  const tones = window.FIRST_LINE_TONES;
  const allLines = window.FIRST_LINES;

  const line = document.querySelector("#line");
  const lineText = document.querySelector("#lineText");
  const lineTone = document.querySelector("#lineTone");
  const toneCheckboxes = document.querySelector("#toneCheckboxes");
  const progress = document.querySelector("#progress");
  const liveResult = document.querySelector("#liveResult");
  const newButton = document.querySelector("#newButton");
  const stage = document.querySelector(".fl-page");
  const settingsToggle = document.querySelector("#settingsToggle");
  const settingsModal = document.querySelector("#settingsModal");

  if (
    !Array.isArray(tones) ||
    tones.length === 0 ||
    !Array.isArray(allLines) ||
    allLines.length === 0 ||
    !line ||
    !lineText ||
    !lineTone ||
    !toneCheckboxes ||
    !progress ||
    !liveResult ||
    !newButton ||
    !stage ||
    !settingsToggle ||
    !settingsModal
  ) {
    if (newButton) {
      newButton.disabled = true;
      const label = newButton.querySelector(".fl-primary__text");
      if (label) {
        label.textContent = "Реплики не загрузились";
      }
    }
    return;
  }

  const LIT_MS = 460;
  const DIM_MS = 150;

  // Подписи тем по id — для показа тега темы и объявления результата.
  const toneLabels = new Map(tones.map((tone) => [tone.id, tone.label]));

  // Оттенок луча под каждый тон: тёплый по умолчанию, свой акцент на группу.
  const toneBeam = {
    byt: "rgba(255, 214, 140, 0.16)",
    conflict: "rgba(255, 120, 120, 0.2)",
    rabota: "rgba(150, 176, 255, 0.18)",
    absurd: "rgba(180, 255, 190, 0.18)",
    romantika: "rgba(255, 150, 190, 0.2)",
    iskusstvo: "rgba(206, 168, 255, 0.18)",
    extreme: "rgba(255, 138, 120, 0.18)",
    emotion: "rgba(255, 206, 140, 0.2)",
  };
  const DEFAULT_BEAM = "rgba(255, 214, 140, 0.16)";

  // Включённые темы — по умолчанию все. Реплики отключённых тем исключаются
  // из колоды, но сами темы остаются видны в настройках как снятые галочки.
  let activeTones = new Set(tones.map((tone) => tone.id));
  // Реплики активной колоды (пересчитываются при изменении activeTones).
  let activeLines = allLines;
  // Перемешанная колода ещё не показанных в текущем цикле реплик.
  let deck = [];
  // Текущая реплика — чтобы новый цикл не начался с немедленного повтора.
  let current = null;
  // Сколько реплик показано в текущем цикле активной колоды.
  let shown = 0;
  let litTimer = 0;
  let dimTimer = 0;

  // --- Звук ----------------------------------------------------------------
  // Мягкий «вздох софита»: тёплый тон с плавным нарастанием и затуханием.
  // Звук — необязательная обратная связь и никогда не мешает кнопкам.

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;

  function getAudioContext() {
    if (!AudioContextClass) {
      return null;
    }
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === "suspended") {
      const resume = audioContext.resume();
      if (resume && typeof resume.catch === "function") {
        resume.catch(() => {});
      }
    }
    return audioContext;
  }

  function playSpotlight() {
    try {
      const context = getAudioContext();
      if (!context) {
        return;
      }
      const now = context.currentTime;

      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      gain.connect(context.destination);

      // Два близких тона дают мягкое тёплое биение — как включение лампы.
      [196, 294].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.linearRampToValueAtTime(frequency * 1.02, now + 0.5);
        const voiceGain = context.createGain();
        voiceGain.gain.setValueAtTime(index === 0 ? 1 : 0.6, now);
        oscillator.connect(voiceGain);
        voiceGain.connect(gain);
        oscillator.start(now);
        oscillator.stop(now + 0.62);
      });
    } catch (error) {
      // Тишина при сбое звука — интерфейс продолжает работать.
    }
  }

  // --- Колода --------------------------------------------------------------

  function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  function refillDeck() {
    deck = shuffle(activeLines);

    // Новый цикл не должен открыться той же репликой, что закрыла предыдущий.
    if (current && activeLines.length > 1 && deck[deck.length - 1] === current) {
      const swapWith = Math.floor(Math.random() * (deck.length - 1));
      const tmp = deck[deck.length - 1];
      deck[deck.length - 1] = deck[swapWith];
      deck[swapWith] = tmp;
    }
  }

  function takeNext() {
    if (deck.length === 0) {
      // Колода исчерпана: новый цикл, прогресс обнуляется.
      refillDeck();
      shown = 0;
    }
    shown += 1;
    return deck.pop();
  }

  // --- Отрисовка -----------------------------------------------------------

  function renderProgress() {
    if (shown === 0) {
      progress.textContent = "";
      return;
    }
    progress.textContent = `Показано ${shown} из ${activeLines.length}`;
  }

  function render(entry) {
    const toneLabel = toneLabels.get(entry.tone) || "";

    line.dataset.state = "result";
    lineText.textContent = entry.text;
    lineTone.textContent = toneLabel;
    lineTone.hidden = false;

    // Оттенок луча под тон текущей реплики.
    stage.style.setProperty("--fl-beam-soft", toneBeam[entry.tone] || DEFAULT_BEAM);

    liveResult.textContent = toneLabel
      ? `${entry.text} Тема: ${toneLabel}.`
      : entry.text;

    renderProgress();

    // На миг приглушаем луч, затем реплика «выходит на свет». Классы снимаются
    // по таймерам, поэтому следующая генерация не ждёт окончания перехода.
    stage.dataset.dimmed = "true";
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => {
      stage.dataset.dimmed = "false";
    }, DIM_MS);

    line.classList.remove("is-lit");
    void line.offsetWidth;
    line.classList.add("is-lit");
    clearTimeout(litTimer);
    litTimer = setTimeout(() => {
      line.classList.remove("is-lit");
    }, LIT_MS);
  }

  function showNext() {
    if (activeLines.length === 0) {
      return;
    }
    const entry = takeNext();
    current = entry;
    playSpotlight();
    render(entry);
  }

  // --- Настройка тем -------------------------------------------------------

  function updateActiveLines() {
    activeLines = allLines.filter((entry) => activeTones.has(entry.tone));

    // Смена набора тем начинает новую колоду заново, прогресс обнуляется.
    current = null;
    deck = [];
    shown = 0;
    renderProgress();

    const noTonesSelected = activeLines.length === 0;
    newButton.disabled = noTonesSelected;
    const label = newButton.querySelector(".fl-primary__text");
    if (label) {
      label.textContent = noTonesSelected ? "Включите хотя бы одну тему" : "Свет софитов";
    }
  }

  function toggleTone(toneId, enabled) {
    if (enabled) {
      activeTones.add(toneId);
    } else {
      activeTones.delete(toneId);
    }
    updateActiveLines();
  }

  function buildToneCheckboxes() {
    tones.forEach((tone) => {
      const row = document.createElement("label");
      row.className = "fl-modal__tone";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = activeTones.has(tone.id);
      checkbox.addEventListener("change", () => {
        toggleTone(tone.id, checkbox.checked);
      });

      const text = document.createElement("span");
      text.textContent = tone.label;

      row.appendChild(checkbox);
      row.appendChild(text);
      toneCheckboxes.appendChild(row);
    });
  }

  // --- Модальное окно настроек -----------------------------------------------

  function openSettings() {
    settingsModal.hidden = false;
    settingsToggle.setAttribute("aria-expanded", "true");
    const firstCheckbox = toneCheckboxes.querySelector("input");
    if (firstCheckbox) {
      firstCheckbox.focus();
    }
  }

  function closeSettings() {
    if (settingsModal.hidden) {
      return;
    }
    settingsModal.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
    settingsToggle.focus();
  }

  // --- Управление ----------------------------------------------------------

  buildToneCheckboxes();
  updateActiveLines();

  newButton.addEventListener("click", showNext);

  settingsToggle.addEventListener("click", openSettings);

  settingsModal.querySelectorAll("[data-close]").forEach((element) => {
    element.addEventListener("click", closeSettings);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsModal.hidden) {
      closeSettings();
      return;
    }

    if (event.code !== "Space" && event.key !== "Enter") {
      return;
    }

    if (!settingsModal.hidden) {
      return;
    }

    // Не перехватываем активацию кнопки/ссылки клавиатурой — иначе двойной запуск.
    const active = document.activeElement;
    if (active && (active.tagName === "BUTTON" || active.tagName === "A")) {
      return;
    }

    event.preventDefault();
    showNext();
  });
})();
