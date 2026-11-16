(() => {
  "use strict";

  const settingsEnabled = false;
  const storageKey = "impro-toy.catalog.icon-theme";
  const defaultTheme = "classic";
  const allowedThemes = new Set(["classic", "theatrical", "character"]);
  const themeLabels = {
    classic: "классические",
    theatrical: "театральные",
    character: "В характере",
  };

  const root = document.documentElement;
  const grid = document.querySelector(".tool-grid");
  const icons = [...document.querySelectorAll(".tool-card__icon")];
  const dialog = document.querySelector("#catalog-settings");
  const openButton = document.querySelector("[data-settings-open]");
  const closeButton = document.querySelector("[data-settings-close]");
  const status = document.querySelector("[data-settings-status]");
  const themeInputs = [...document.querySelectorAll('input[name="icon-theme"]')];

  if (!grid || !dialog || !openButton || !closeButton || !status || !icons.length) {
    return;
  }

  openButton.hidden = !settingsEnabled;

  const readStoredTheme = () => {
    try {
      const storedTheme = window.localStorage.getItem(storageKey);
      return allowedThemes.has(storedTheme) ? storedTheme : null;
    } catch {
      return null;
    }
  };

  const storeTheme = (theme) => {
    try {
      window.localStorage.setItem(storageKey, theme);
      return true;
    } catch {
      return false;
    }
  };

  const animateIcons = () => {
    grid.classList.remove("is-switching");
    window.requestAnimationFrame(() => {
      grid.classList.add("is-switching");
      window.setTimeout(() => grid.classList.remove("is-switching"), 280);
    });
  };

  const applyTheme = (theme, { animate = false, persist = false } = {}) => {
    const nextTheme = allowedThemes.has(theme) ? theme : defaultTheme;
    const dataKey = {
      classic: "iconClassic",
      theatrical: "iconTheatrical",
      character: "iconCharacter",
    }[nextTheme];

    root.dataset.iconTheme = nextTheme;

    icons.forEach((icon) => {
      const nextSource = icon.dataset[dataKey];
      if (nextSource && icon.getAttribute("src") !== nextSource) {
        icon.setAttribute("src", nextSource);
      }
    });

    themeInputs.forEach((input) => {
      input.checked = input.value === nextTheme;
    });

    if (animate) {
      animateIcons();
    }

    if (persist) {
      const saved = storeTheme(nextTheme);
      status.textContent = saved
        ? `Выбран набор «${themeLabels[nextTheme]}». Настройка сохранена.`
        : `Выбран набор «${themeLabels[nextTheme]}». Хранилище браузера недоступно.`;
    } else {
      status.textContent = `Сейчас выбран набор «${themeLabels[nextTheme]}». Выбор сохранится на этом устройстве.`;
    }
  };

  const closeDialog = () => {
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
      openButton.focus();
    }
  };

  applyTheme(settingsEnabled ? readStoredTheme() ?? defaultTheme : defaultTheme);

  openButton.addEventListener("click", () => {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    dialog.querySelector('input[name="icon-theme"]:checked')?.focus();
  });

  closeButton.addEventListener("click", closeDialog);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
    }
  });

  dialog.addEventListener("close", () => openButton.focus());

  themeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (settingsEnabled && input.checked) {
        applyTheme(input.value, { animate: true, persist: true });
      }
    });
  });
})();
