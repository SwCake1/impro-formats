export type DetailPresentation = 'catalog' | 'link' | 'expanded';

interface DetailDialogOptions {
  panel: HTMLElement;
  backdrop: HTMLElement;
  titleButton: HTMLButtonElement;
  titleText: HTMLElement;
  closeButton: HTMLButtonElement;
  background: HTMLElement[];
  fallbackFocus: HTMLElement;
  onClose: () => void;
  onCollapse: () => void;
}

export function createDetailDialog({
  panel, backdrop, titleButton, titleText, closeButton, background, fallbackFocus, onClose, onCollapse,
}: DetailDialogOptions) {
  const drawerQuery = window.matchMedia('(max-width: 1220px)');
  let presentation: DetailPresentation | null = null;
  let modal = false;
  let trigger: (() => HTMLElement | null) | undefined;

  function syncMode(): void {
    const wasModal = modal;
    const open = presentation !== null;
    const centered = open && presentation !== 'catalog';
    modal = open && (centered || drawerQuery.matches);
    panel.classList.toggle('is-open', open);
    panel.classList.toggle('is-centered', centered);
    panel.inert = drawerQuery.matches && !open;
    backdrop.hidden = !modal;
    document.body.classList.toggle('detail-open', modal);
    background.forEach(node => { node.inert = modal; });
    const titleClickable = open && !modal;
    if (titleClickable && titleButton.hidden) {
      titleButton.append(titleText);
    } else if (!titleClickable && !titleButton.hidden) {
      titleButton.after(titleText);
    }
    titleButton.hidden = !titleClickable;
    const closeLabel = presentation === 'expanded' && !drawerQuery.matches
      ? 'Свернуть карточку' : 'Закрыть карточку';
    closeButton.setAttribute('aria-label', closeLabel);
    closeButton.title = closeLabel;

    if (modal) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
    }

    if (modal && (!wasModal || !panel.contains(document.activeElement))) {
      panel.focus({ preventScroll: true });
    } else if (wasModal && !open) {
      (trigger?.() ?? fallbackFocus).focus({ preventScroll: true });
    }
  }

  function dismiss(): void {
    if (presentation === 'expanded' && !drawerQuery.matches) onCollapse();
    else if (presentation) onClose();
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && presentation) {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Tab' || !modal) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(node => node.getClientRects().length > 0 && !node.closest('[inert]'));
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;
    if (!first || active === panel || !panel.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last ?? panel : first ?? panel).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });
  drawerQuery.addEventListener('change', syncMode);

  return {
    dismiss,
    sync(nextPresentation: DetailPresentation | null, nextTrigger?: () => HTMLElement | null): void {
      presentation = nextPresentation;
      if (nextTrigger) trigger = nextTrigger;
      syncMode();
    },
  };
}
