type ResizablePanel = 'filters' | 'detail';

export function initializePanelResize(
  catalog: HTMLElement, handles: Record<ResizablePanel, HTMLElement>,
): void {
  const resizablePanelsQuery = window.matchMedia('(min-width: 901px)');
  const threePanelsQuery = window.matchMedia('(min-width: 1221px)');
  const PANEL_WIDTHS: Record<ResizablePanel, { cssProperty: string; defaultValue: number; storageKey: string }> = {
    filters: {
      cssProperty: '--filter-width',
      defaultValue: 280,
      storageKey: 'impro-formats:filters-width',
    },
    detail: {
      cssProperty: '--detail-width',
      defaultValue: 500,
      storageKey: 'impro-formats:detail-width',
    },
  };

  function currentPanelWidth(panel: ResizablePanel): number {
    const value = Number.parseFloat(getComputedStyle(catalog).getPropertyValue(PANEL_WIDTHS[panel].cssProperty));
    return Number.isFinite(value) ? value : PANEL_WIDTHS[panel].defaultValue;
  }

  function panelWidthLimits(panel: ResizablePanel): { min: number; max: number } {
    const catalogWidth = catalog.getBoundingClientRect().width;
    if (panel === 'filters') {
      const detailWidth = threePanelsQuery.matches ? currentPanelWidth('detail') : 0;
      const gaps = threePanelsQuery.matches ? 36 : 18;
      return {
        min: 220,
        max: Math.max(220, Math.min(480, catalogWidth - detailWidth - gaps - 380)),
      };
    }

    return {
      min: 360,
      max: Math.max(360, Math.min(720, catalogWidth - (currentPanelWidth('filters') + 36) - 380)),
    };
  }

  function setPanelWidth(panel: ResizablePanel, value: number, persist = false): void {
    const limits = panelWidthLimits(panel);
    const width = Math.round(Math.min(limits.max, Math.max(limits.min, value)));
    const handle = handles[panel];
    catalog.style.setProperty(PANEL_WIDTHS[panel].cssProperty, `${width}px`);
    handle.setAttribute('aria-valuemin', String(Math.round(limits.min)));
    handle.setAttribute('aria-valuemax', String(Math.round(limits.max)));
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} пикселей`);
    if (!persist) return;
    try {
      localStorage.setItem(PANEL_WIDTHS[panel].storageKey, String(width));
    } catch {
      // The layout still works when storage is unavailable.
    }
  }

  function storedPanelWidth(panel: ResizablePanel): number {
    try {
      const value = Number.parseFloat(localStorage.getItem(PANEL_WIDTHS[panel].storageKey) ?? '');
      if (Number.isFinite(value)) return value;
    } catch {
      // Fall back to the default width.
    }
    return PANEL_WIDTHS[panel].defaultValue;
  }

  function syncPanelWidths(): void {
    if (!resizablePanelsQuery.matches) return;
    if (threePanelsQuery.matches) setPanelWidth('detail', currentPanelWidth('detail'));
    setPanelWidth('filters', currentPanelWidth('filters'));
  }

  function enablePanelResize(panel: ResizablePanel): void {
    const handle = handles[panel];
    let dragStartX = 0;
    let dragStartWidth = 0;
    let activePointer: number | null = null;

    handle.addEventListener('pointerdown', (event) => {
      if (!resizablePanelsQuery.matches || (panel === 'detail' && !threePanelsQuery.matches)) return;
      event.preventDefault();
      dragStartX = event.clientX;
      dragStartWidth = currentPanelWidth(panel);
      activePointer = event.pointerId;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing-panels');
    });

    handle.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activePointer) return;
      const direction = panel === 'filters' ? 1 : -1;
      setPanelWidth(panel, dragStartWidth + ((event.clientX - dragStartX) * direction));
    });

    const finishResize = (event: PointerEvent): void => {
      if (event.pointerId !== activePointer) return;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      activePointer = null;
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-panels');
      setPanelWidth(panel, currentPanelWidth(panel), true);
    };

    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
    handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const separatorDelta = event.key === 'ArrowRight' ? 16 : -16;
      const panelDelta = panel === 'filters' ? separatorDelta : -separatorDelta;
      setPanelWidth(panel, currentPanelWidth(panel) + panelDelta, true);
    });
  }

  if (resizablePanelsQuery.matches) {
    if (threePanelsQuery.matches) setPanelWidth('detail', storedPanelWidth('detail'));
    setPanelWidth('filters', storedPanelWidth('filters'));
  }
  enablePanelResize('filters');
  enablePanelResize('detail');
  window.addEventListener('resize', syncPanelWidths);
  resizablePanelsQuery.addEventListener('change', ({ matches }) => {
    if (!matches) return;
    setPanelWidth('filters', storedPanelWidth('filters'));
    syncPanelWidths();
  });
  threePanelsQuery.addEventListener('change', ({ matches }) => {
    if (!matches) return;
    setPanelWidth('detail', storedPanelWidth('detail'));
    syncPanelWidths();
  });
}
