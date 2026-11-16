(() => {
  const relationships = window.RELATIONSHIPS;
  const card = document.querySelector("#card");
  const bondLabel = document.querySelector("#bondLabel");
  const deckCounter = document.querySelector("#deckCounter");
  const liveResult = document.querySelector("#liveResult");
  const newButton = document.querySelector("#newButton");
  const backButton = document.querySelector("#backButton");

  if (
    !Array.isArray(relationships) ||
    relationships.length === 0 ||
    !card ||
    !bondLabel ||
    !deckCounter ||
    !liveResult ||
    !newButton ||
    !backButton
  ) {
    if (newButton) {
      newButton.disabled = true;
      newButton.querySelector(".rel-primary__text").textContent =
        "Отношения не загрузились";
    }
    return;
  }

  const REBUILD_MS = 440;

  // Колода ещё не показанных в текущем цикле отношений.
  let deck = [];
  // Текущий результат — нужен, чтобы новый цикл не начался с повтора.
  let current = null;
  // Стек истории: каждый шаг хранит показанное отношение и колоду того момента.
  // Возврат снимает шаги по одному, поэтому можно пройти всю цепочку назад,
  // и показанные записи не возвращаются в текущий цикл.
  let history = [];
  let rebuildTimer = 0;

  // --- Звук нажатия --------------------------------------------------------
  // Мягкий пластиковый «тук» под материал интерфейса. Звук — необязательная
  // обратная связь и никогда не должен мешать работе кнопок.

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

  // Короткий мягкий тон с быстрым затуханием: разная высота отличает
  // «новые отношения» от «возврата», не привлекая лишнего внимания.
  function playTone(frequency) {
    try {
      const context = getAudioContext();
      if (!context) {
        return;
      }
      const now = context.currentTime;

      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.82, now + 0.12);

      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.18);
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
    deck = shuffle(relationships);

    // Новый цикл не должен открыться тем же отношением, что закрыло предыдущий.
    if (current && relationships.length > 1 && deck[deck.length - 1] === current) {
      const swapWith = Math.floor(Math.random() * (deck.length - 1));
      const tmp = deck[deck.length - 1];
      deck[deck.length - 1] = deck[swapWith];
      deck[swapWith] = tmp;
    }
  }

  function takeNext() {
    if (deck.length === 0) {
      refillDeck();
    }
    return deck.pop();
  }

  function render(relationship) {
    card.dataset.state = "result";
    bondLabel.textContent = relationship.label;

    // Позиция в текущем цикле: показанная карта уже вынута из колоды, поэтому
    // «показано» = всего − осталось. Новый цикл перемешивает колоду, и счётчик
    // сам возвращается к 1 из total.
    const total = relationships.length;
    const shown = total - deck.length;
    deckCounter.textContent = `${shown} / ${total}`;

    // На экране остаётся только формулировка связи; роли по-прежнему
    // проговариваются вспомогательным технологиям.
    if (relationship.both) {
      liveResult.textContent = `${relationship.label}. Оба игрока — ${relationship.both}.`;
    } else {
      liveResult.textContent =
        `${relationship.label}. Игрок 1 — ${relationship.a}, игрок 2 — ${relationship.b}.`;
    }

    // Перезапуск анимации проявления карточки: класс снимается по таймеру,
    // поэтому следующая генерация не ждёт окончания перехода.
    card.classList.remove("is-swapping");
    void card.offsetWidth;
    card.classList.add("is-swapping");

    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      card.classList.remove("is-swapping");
    }, REBUILD_MS);
  }

  function showNext() {
    const relationship = takeNext();

    // Складываем текущий результат в историю вместе с колодой того момента,
    // чтобы возврат восстанавливал состояние без повторов в цикле.
    if (current) {
      history.push({ relationship: current, deck: deck.slice() });
    }
    current = relationship;

    playTone(392);
    render(relationship);
    backButton.disabled = history.length === 0;
  }

  function showPrevious() {
    if (history.length === 0) {
      return;
    }

    const step = history.pop();
    current = step.relationship;
    deck = step.deck;

    playTone(294);
    render(current);
    backButton.disabled = history.length === 0;
  }

  newButton.addEventListener("click", showNext);
  backButton.addEventListener("click", showPrevious);

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" && event.key !== "Enter") {
      return;
    }

    // Не перехватываем активацию кнопки/ссылки клавиатурой — иначе двойная генерация.
    const active = document.activeElement;
    if (active && (active.tagName === "BUTTON" || active.tagName === "A")) {
      return;
    }

    event.preventDefault();
    showNext();
  });
})();
