type VideoItem = { caption: string; url: URL | null };

function parseUrl(raw: string): URL | null {
  // Strip sentence punctuation and closing brackets outside the URL.
  let value = raw.replace(/[.,;:!?]+$/, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (value.endsWith(close) && value.split(close).length > value.split(open).length) {
      value = value.slice(0, -1).replace(/[.,;:!?]+$/, '');
    }
  }
  try {
    return new URL(/^www\./i.test(value) ? `https://${value}` : value);
  } catch {
    return null;
  }
}

function readVideoItems(text: string): VideoItem[] {
  const items: VideoItem[] = [];
  for (const line of text.split('\n')) {
    let offset = 0;
    for (const match of line.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
      const url = parseUrl(match[0]);
      if (!url) continue;
      const caption = line.slice(offset, match.index).trimEnd()
        .replace(/[(\[{]$/, '').trimEnd().replace(/:$/, '').trim();
      items.push({ caption: caption || url.href.replace(/^https?:\/\//, ''), url });
      offset = match.index + match[0].length;
    }

    const note = line.slice(offset);
    if (offset > 0 && !note.trim()) continue;
    const previous = items.at(-1);
    if (previous?.url === null) {
      previous.caption += '\n' + note;
    } else {
      items.push({ caption: note, url: null });
    }
  }
  return items.filter(item => item.caption.trim());
}

function thumbnailUrl(url: URL): string | undefined {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'rutube.ru') {
    const id = url.pathname.match(/^\/video\/([a-f0-9]{32})\/?$/i)?.[1];
    if (id) return `https://rutube.ru/api/video/${id}/thumbnail/?redirect=1`;
  }

  let youtubeId: string | null | undefined;
  if (host === 'youtu.be') {
    youtubeId = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    youtubeId = url.pathname === '/watch' ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];
  }
  if (youtubeId && /^[\w-]{11}$/.test(youtubeId)) {
    return `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`;
  }
}

function createVideoItem(item: VideoItem, template: HTMLTemplateElement): HTMLLIElement {
  if (!item.url) {
    const note = document.createElement('li');
    note.className = 'detail-video__note';
    note.textContent = item.caption;
    return note;
  }

  const row = template.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  row.querySelector('a')!.href = item.url.href;
  row.querySelector('.detail-video__caption')!.textContent = item.caption;
  const source = thumbnailUrl(item.url);
  if (source) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = source;
    row.querySelector('.detail-video__cover')!.prepend(image);
  }
  return row;
}

export function createVideoSection(section: HTMLElement, template: HTMLTemplateElement) {
  const count = section.querySelector<HTMLElement>('.detail-video__count')!;
  const [first, rest] = section.querySelectorAll<HTMLUListElement>('.detail-video__list');
  const extra = section.querySelector<HTMLElement>('#detailVideoExtra')!;
  const toggle = section.querySelector<HTMLButtonElement>('.detail-video__toggle')!;
  const toggleLabel = toggle.firstElementChild!;
  const panel = section.closest<HTMLElement>('#detailPanel')!;
  let previousId: string | undefined;
  let previousText = '';
  let showMoreLabel = '';
  let scrollFrame = 0;

  function setExpanded(expanded: boolean): void {
    extra.inert = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggleLabel.textContent = expanded ? 'Свернуть' : showMoreLabel;
  }

  toggle.addEventListener('click', () => {
    cancelAnimationFrame(scrollFrame);
    const buttonTop = toggle.getBoundingClientRect().top;
    extra.classList.add('detail-video__extra--animated');
    setExpanded(extra.inert);
    const animations = extra.getAnimations();

    function alignButton(): void {
      panel.scrollTop += toggle.getBoundingClientRect().top - buttonTop;
    }

    function followAnimation(): void {
      alignButton();
      const running = animations.some(animation => animation.playState === 'running');
      scrollFrame = requestAnimationFrame(running ? followAnimation : alignButton);
    }

    if (animations.length) followAnimation();
    else alignButton();
  });

  return (id?: string, text = ''): void => {
    if (previousId === id && previousText === text) return;
    cancelAnimationFrame(scrollFrame);
    const keepExpanded = previousId === id && !extra.inert;
    previousId = id;
    previousText = text;

    const items = readVideoItems(text);
    const videoCount = items.filter(item => item.url).length;
    const visibleCount = videoCount > 3 ? 2 : videoCount;
    const hiddenCount = videoCount - visibleCount;
    const visible: HTMLLIElement[] = [];
    const remaining: HTMLLIElement[] = [];
    let seen = 0;
    for (const item of items) {
      if (item.url) seen++;
      (seen <= visibleCount ? visible : remaining).push(createVideoItem(item, template));
    }

    section.hidden = items.length === 0;
    count.hidden = videoCount === 0;
    count.textContent = String(videoCount);
    showMoreLabel = `Ещё ${hiddenCount} видео`;
    toggle.hidden = hiddenCount === 0;
    extra.classList.remove('detail-video__extra--animated');
    setExpanded(hiddenCount > 0 && keepExpanded);
    first.replaceChildren(...visible);
    rest.replaceChildren(...remaining);
  };
}
