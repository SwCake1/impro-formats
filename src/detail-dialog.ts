interface DetailDialogOptions {
  panel: HTMLElement;
  backdrop: HTMLElement;
  background: HTMLElement[];
  fallbackFocus: HTMLElement;
  onClose: () => void;
}

export function createDetailDialog({
  panel, backdrop, background, fallbackFocus, onClose,
}: DetailDialogOptions): { sync: (open: boolean, trigger?: () => HTMLElement | null) => void } {
  const mobileQuery = window.matchMedia('(max-width: 1220px)');
  let open = false;
  let modal = false;
  let trigger: (() => HTMLElement | null) | undefined;

  function syncMode(): void {
    const wasModal = modal;
    modal = open && mobileQuery.matches;
    panel.classList.toggle('is-open', open);
    panel.inert = mobileQuery.matches && !open;
    backdrop.hidden = !modal;
    document.body.classList.toggle('detail-open', modal);
    background.forEach(node => { node.inert = modal; });

    if (mobileQuery.matches) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-hidden', String(!open));
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-hidden');
      panel.removeAttribute('aria-modal');
    }

    if (modal && !panel.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    } else if (wasModal && !open) {
      (trigger?.() ?? fallbackFocus).focus({ preventScroll: true });
    }
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !modal) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(node => node.getClientRects().length > 0);
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
  mobileQuery.addEventListener('change', syncMode);

  return {
    sync(nextOpen, nextTrigger) {
      open = nextOpen;
      if (nextTrigger) trigger = nextTrigger;
      syncMode();
    },
  };
}
