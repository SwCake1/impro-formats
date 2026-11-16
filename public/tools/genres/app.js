(() => {
  "use strict";

  const name = document.querySelector("#genre-name");
  const premise = document.querySelector(".premise");
  const backdrop = document.querySelector(".backdrop");
  const caption = document.querySelector(".caption");
  const lightLeak = document.querySelector(".light-leak");
  const progress = document.querySelector("#round-progress");
  const picker = document.querySelector("#genre-picker");
  const list = document.querySelector("#genre-options");
  const search = document.querySelector("#genre-search");
  const emptyList = document.querySelector("#empty-list");
  const draw = document.querySelector("#draw");
  const hint = document.querySelector("#hint-toggle");
  const direction = document.querySelector("#direction");
  const directionTitle = document.querySelector("#direction-title");
  const directionTraits = document.querySelector("#direction-traits");
  const directionText = document.querySelector("#direction-text");
  const sound = document.querySelector(".sound");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const clickSound = new Audio("./click.wav");
  clickSound.preload = "auto";
  clickSound.volume = 0.65;

  const alphabeticalGenres = [...genres].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const seen = new Set();
  let current;

  // Decode the recording before the first press. Local files can still play
  // through the media element when the browser disallows file:// fetches.
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let clickContext;
  let clickBuffer;
  let clickOutput;
  let activeClick;
  async function prepareClick() {
    if (!AudioContextClass || location.protocol === "file:") return;
    try {
      clickContext = new AudioContextClass({ latencyHint: "interactive" });
      const response = await fetch(clickSound.src);
      if (!response.ok) return;
      clickOutput = clickContext.createGain();
      clickOutput.gain.value = clickSound.volume;
      clickOutput.connect(clickContext.destination);
      clickBuffer = await clickContext.decodeAudioData(await response.arrayBuffer());
    } catch { /* Use the preloaded media element if Web Audio is unavailable. */ }
  }

  function resumeClickAudio() {
    if (sound.getAttribute("aria-pressed") === "true" && clickContext && clickContext.state !== "running") {
      clickContext.resume().catch(() => {});
    }
  }

  function stopClick() {
    activeClick?.stop();
    activeClick = null;
    clickSound.pause();
  }

  function playClick() {
    if (sound.getAttribute("aria-pressed") !== "true") return false;
    if (!clickBuffer) {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {});
      return !clickSound.paused;
    }
    // Match the media element’s playback behavior on iPhones in silent mode.
    if (navigator.audioSession && navigator.audioSession.type !== "playback") {
      try { navigator.audioSession.type = "playback"; } catch { /* Optional browser API. */ }
    }
    resumeClickAudio();
    activeClick?.stop();
    const source = clickContext.createBufferSource();
    source.buffer = clickBuffer;
    source.connect(clickOutput);
    source.onended = () => {
      source.disconnect();
      if (activeClick === source) activeClick = null;
    };
    activeClick = source;
    source.start();
    return true;
  }

  prepareClick();
  // On a fresh iOS page the first touch release can grant audio permission.
  document.addEventListener("touchend", resumeClickAudio, { passive: true });
  function animate(element, frames, duration) {
    if (reducedMotion.matches || !element.animate) return;
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate(frames, { duration, easing: "cubic-bezier(.2,.72,.18,1)" });
  }

  function cutToScene() {
    animate(backdrop, [
      { transform: "scale(1.045)", filter: "brightness(.65)" },
      { transform: "scale(1)", filter: "brightness(1)" },
    ], 520);
    animate(lightLeak, [
      { opacity: 0, transform: "translateX(-55%)" },
      { opacity: .7, offset: .3 },
      { opacity: 0, transform: "translateX(65%)" },
    ], 430);
    animate(caption, [
      { opacity: .3, transform: "translateY(9px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], 330);
  }

  function showGenre(genre) {
    const firstRender = !current;
    current = genre;
    name.textContent = genre.name;
    name.classList.toggle("long-title", genre.name.length > 16 || /[а-яё]{11}/i.test(genre.name));
    premise.textContent = genre.premise;
    backdrop.src = "./stills/" + genre.still + ".webp";
    progress.textContent = seen.size + " из " + genres.length;
    directionTitle.textContent = "Как играть · " + genre.name;
    directionTraits.textContent = genre.traits;
    directionText.textContent = genre.direction;
    if (!firstRender) cutToScene();
  }

  function selectGenre(genre) {
    if (genre === current) return;
    if (seen.size === genres.length) seen.clear();
    seen.add(genre.name);
    showGenre(genre);
  }

  function drawGenre() {
    const roundComplete = seen.size === genres.length;
    const options = genres.filter((genre) =>
      genre !== current && (roundComplete || !seen.has(genre.name))
    );
    selectGenre(options[Math.floor(Math.random() * options.length)]);
  }

  function renderList() {
    const normalize = (text) => text.toLowerCase().replaceAll("ё", "е").trim();
    const query = normalize(search.value);
    const matches = alphabeticalGenres.filter((genre) => normalize(genre.name).includes(query));
    list.replaceChildren(...matches.map((genre) => {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = genre.name;
      if (genre === current) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => {
        if (genre !== current) playClick();
        selectGenre(genre);
        picker.close();
      });
      row.append(button);
      return row;
    }));
    list.scrollTop = 0;
    emptyList.hidden = matches.length > 0;
  }

  document.querySelector("#open-list").addEventListener("click", () => {
    search.value = "";
    renderList();
    picker.showModal();
    animate(picker, [
      { opacity: .3, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], 160);
  });
  search.addEventListener("input", renderList);
  document.querySelector("#close-list").addEventListener("click", () => picker.close());
  picker.addEventListener("click", (event) => {
    if (event.target === picker) picker.close();
  });

  hint.addEventListener("click", () => {
    direction.hidden = !direction.hidden;
    hint.setAttribute("aria-expanded", String(!direction.hidden));
    if (!direction.hidden) {
      animate(direction, [
        { opacity: .2, transform: "translateY(-5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], 220);
    }
  });

  sound.addEventListener("click", () => {
    const enabled = sound.getAttribute("aria-pressed") !== "true";
    sound.setAttribute("aria-pressed", String(enabled));
    sound.title = enabled ? "Выключить звук" : "Включить звук";
    sound.querySelector("use").setAttribute("href", enabled ? "#volume-on" : "#volume-off");
    if (enabled) playClick();
    else stopClick();
  });

  let playedOnPress = false;
  draw.addEventListener("pointerdown", (event) => {
    if (event.isPrimary && event.button === 0) playedOnPress = playClick();
  });
  draw.addEventListener("pointercancel", () => {
    playedOnPress = false;
    stopClick();
  });
  draw.addEventListener("click", (event) => {
    if (!playedOnPress || event.detail === 0) playClick();
    else resumeClickAudio();
    playedOnPress = false;
    drawGenre();
  });

  // Older iOS versions may smart-zoom a non-interactive poster despite
  // touch-action: manipulation. Leave button taps and scrolling to Safari.
  const poster = document.querySelector(".screen");
  let posterTouch;
  poster.addEventListener("touchstart", (event) => {
    posterTouch = event.touches.length === 1 && !event.target.closest("button, a")
      ? event.touches[0] : null;
  }, { passive: true });
  poster.addEventListener("touchend", (event) => {
    const end = event.changedTouches[0];
    if (posterTouch && !event.touches.length && posterTouch.identifier === end.identifier &&
        Math.hypot(end.clientX - posterTouch.clientX, end.clientY - posterTouch.clientY) < 12 &&
        event.cancelable) {
      event.preventDefault();
    }
    posterTouch = null;
  }, { passive: false });

  document.addEventListener("keydown", (event) => {
    if (picker.open || event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey ||
        event.shiftKey || event.target.closest("a, button, input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    if (!event.repeat) {
      playClick();
      drawGenre();
    }
  });

  drawGenre();
})();
