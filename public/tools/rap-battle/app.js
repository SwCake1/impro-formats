(() => {
  const topics = window.RAP_BATTLE_TOPICS;
  const leftSide = document.querySelector("#leftSide");
  const rightSide = document.querySelector("#rightSide");
  const liveTopic = document.querySelector("#liveTopic");
  const topicButton = document.querySelector("#topicButton");
  const matchup = document.querySelector(".matchup");
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;

  let previousIndex = -1;

  function getAudioContext() {
    var resume;

    if (!AudioContext) {
      return null;
    }

    if (!audioContext) {
      audioContext = new AudioContext();
    }

    if (audioContext.state === "suspended") {
      resume = audioContext.resume();
      if (resume && typeof resume.catch === "function") {
        resume.catch(function () {});
      }
    }

    return audioContext;
  }

  function playNoiseHit(context, destination, now, volume, duration, highpassFreq) {
    var size, buffer, data, i, source, filter, gain;

    size = Math.floor(context.sampleRate * duration);
    buffer = context.createBuffer(1, size, context.sampleRate);
    data = buffer.getChannelData(0);
    for (i = 0; i < size; i = i + 1) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (size * 0.15));
    }

    source = context.createBufferSource();
    source.buffer = buffer;
    filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = highpassFreq;
    gain = context.createGain();
    gain.gain.value = volume;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(now);
  }

  function playBattleSound() {
    var context, now, master, partials, i, partial, oscillator, gain;

    try {
      context = getAudioContext();
      if (!context) {
        return;
      }

      now = context.currentTime;

      master = context.createGain();
      master.gain.setValueAtTime(0.5, now);
      master.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      master.connect(context.destination);

      partials = [[540, 0.6, 0.4, "square"], [800, 0.4, 0.3, "square"], [1080, 0.2, 0.25, "square"]];

      for (i = 0; i < partials.length; i = i + 1) {
        partial = partials[i];
        oscillator = context.createOscillator();
        gain = context.createGain();
        oscillator.type = partial[3];
        oscillator.frequency.value = partial[0];
        gain.gain.setValueAtTime(partial[1], now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + partial[2]);
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(now);
        oscillator.stop(now + partial[2]);
      }

      playNoiseHit(context, master, now, 0.5, 0.05, 300);
    } catch (error) {
      // Звук является дополнительной обратной связью и не должен мешать генератору тем.
    }
  }

  function getNextIndex() {
    if (previousIndex === -1) {
      return Math.floor(Math.random() * topics.length);
    }

    if (topics.length === 1) {
      return 0;
    }

    const candidate = Math.floor(Math.random() * (topics.length - 1));
    return candidate >= previousIndex ? candidate + 1 : candidate;
  }

  function showNextTopic() {
    const nextIndex = getNextIndex();
    const topic = topics[nextIndex];

    previousIndex = nextIndex;
    leftSide.textContent = topic.left;
    rightSide.textContent = topic.right;
    liveTopic.textContent = `${topic.left} против ${topic.right}`;
    matchup.dataset.topicIndex = String(nextIndex);

    matchup.classList.remove("is-changing");
    void matchup.offsetWidth;
    matchup.classList.add("is-changing");
    playBattleSound();
  }

  if (
    !Array.isArray(topics) ||
    topics.length === 0 ||
    !leftSide ||
    !rightSide ||
    !liveTopic ||
    !topicButton ||
    !matchup
  ) {
    if (topicButton) {
      topicButton.disabled = true;
      topicButton.textContent = "ТЕМЫ НЕ ЗАГРУЗИЛИСЬ";
    }
    return;
  }

  topicButton.addEventListener("click", showNextTopic);
})();
