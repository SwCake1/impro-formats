import { THEMES, type ColorTheme } from './themes';

const STORAGE_KEY = 'impro-formats:color-theme';

const CSS_VARIABLES: Record<keyof ColorTheme['colors'], string> = {
  canvas: '--canvas',
  surface: '--surface',
  surfaceMuted: '--surface-muted',
  ink: '--ink',
  muted: '--muted',
  accent: '--accent',
  accentStrong: '--accent-strong',
  accentPale: '--accent-pale',
  line: '--line',
  lineStrong: '--line-strong',
  secondary: '--warm',
  noteSurface: '--note-surface',
};

function storedTheme(): ColorTheme {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
  } catch {
    return THEMES[0];
  }
}

function saveTheme(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The preview still works when storage is unavailable.
  }
}

function applyTheme(theme: ColorTheme, persist = true): void {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(CSS_VARIABLES[key as keyof ColorTheme['colors']], value);
  });
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme.colors.canvas);
  document.querySelector<HTMLElement>('#themePickerCurrent')!.textContent = theme.name;
  document.querySelectorAll<HTMLButtonElement>('.theme-option').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeId === theme.id));
  });
  if (persist) saveTheme(theme.id);
}

function createThemeOption(theme: ColorTheme): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'theme-option';
  button.type = 'button';
  button.dataset.themeId = theme.id;
  button.setAttribute('aria-label', `Примерить тему «${theme.name}»`);
  button.style.setProperty('--theme-canvas', theme.colors.canvas);
  button.style.setProperty('--theme-primary', theme.colors.accentStrong);
  button.style.setProperty('--theme-secondary', theme.colors.secondary);

  const swatches = document.createElement('span');
  swatches.className = 'theme-option__swatches';
  swatches.setAttribute('aria-hidden', 'true');
  ['canvas', 'primary', 'secondary'].forEach((name) => {
    const swatch = document.createElement('span');
    swatch.className = `theme-option__swatch theme-option__swatch--${name}`;
    swatches.append(swatch);
  });

  const copy = document.createElement('span');
  copy.className = 'theme-option__copy';
  const name = document.createElement('span');
  name.className = 'theme-option__name';
  name.textContent = theme.name;
  const kind = document.createElement('span');
  kind.className = 'theme-option__kind';
  kind.textContent = theme.kind;
  copy.append(name, kind);
  button.append(swatches, copy);
  button.addEventListener('click', () => applyTheme(theme));
  return button;
}

export function initializeThemePicker(): void {
  const picker = document.querySelector<HTMLElement>('#themePicker');
  const toggle = document.querySelector<HTMLButtonElement>('#themePickerToggle');
  const panel = document.querySelector<HTMLElement>('#themePickerPanel');
  const close = document.querySelector<HTMLButtonElement>('#themePickerClose');
  const options = document.querySelector<HTMLElement>('#themeOptions');
  if (!picker || !toggle || !panel || !close || !options) return;

  options.replaceChildren(...THEMES.map(createThemeOption));

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => {
    setOpen(false);
    toggle.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && event.target instanceof Node && !picker.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    setOpen(false);
    toggle.focus();
  });

  applyTheme(storedTheme(), false);
}
