import { inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { WorkspaceState, Notebook, Section, Page, Id } from '../models/workspace.models';
import { WorkspaceIdbService } from './workspace-idb.service';


const LS_KEY = 'mindmap_workspace_v1';

function uid(): string {
  // simple id generator (good for MVP)
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function now(): number {
  return Date.now();
}

function sortByOrder<T extends { order: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.order - b.order);
}

@Injectable({ providedIn: 'root' })
export class WorkspaceStoreService {
private readonly _state$ = new BehaviorSubject<WorkspaceState>(this.makeSeed()); // temporary seed

constructor() {
  this.hydrateFromIdb();
}


  private idb = inject(WorkspaceIdbService);
  
 // private readonly _state$ = new BehaviorSubject<WorkspaceState>(this.loadInitial());
  readonly state$ = this._state$.asObservable();

  // ---------- selectors (sync)
  get snapshot(): WorkspaceState {
    return this._state$.value;
  }
  get activeNotebook(): Notebook | undefined {
    const s = this.snapshot;
    return s.notebooks.find(n => n.id === s.activeNotebookId);
  }
  get activeSection(): Section | undefined {
    const s = this.snapshot;
    return s.sections.find(sec => sec.id === s.activeSectionId);
  }
  get activePage(): Page | undefined {
    const s = this.snapshot;
    return s.pages.find(p => p.id === s.activePageId);
  }

  // ---------- init 
  private loadInitial(): WorkspaceState {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as WorkspaceState;
        (parsed.pages || []).forEach((p: any) => {
       if (p.contentJson && !p.contentJson) p.contentJson = p.contentJson;
       if (p.previewDataUrl1 && !p.previewDataUrl) p.previewDataUrl = p.previewDataUrl1;

       delete p.contentJson;
        delete p.previewDataUrl1;
       });
        // basic sanity
        if (parsed?.notebooks?.length) return parsed;
      } catch {}
    }

    // seed demo workspace
    const nbId = uid();
    const secId = uid();
    const pageId = uid();

    const seed: WorkspaceState = {
      notebooks: [
        { id: nbId, title: 'My Notebook', createdAt: now() },
      ],
      sections: [
        { id: secId, notebookId: nbId, title: 'Quick Notes', order: 1, createdAt: now() },
      ],
      pages: [
        { id: pageId, sectionId: secId, title: 'Untitled page', order: 1, updatedAt: now() },
      ],
      activeNotebookId: nbId,
      activeSectionId: secId,
      activePageId: pageId,
      lastSavedAt: now(),
    };

    localStorage.setItem(LS_KEY, JSON.stringify(seed));
    return seed;
  }

private persist(next: WorkspaceState): void {
  const withMeta: WorkspaceState = { ...next, lastSavedAt: now() };

  // ✅ UI always updates immediately (fast UX)
  this._state$.next(withMeta);

  const pagesCount = withMeta.pages?.length ?? 0;
  const approxBytes = (() => {
    try { return JSON.stringify(withMeta).length; } catch { return -1; }
  })();

  console.log('[WS] persist() ▶️ start', {
    pages: pagesCount,
    approxBytes,
    activePageId: withMeta.activePageId,
  });

  // 🔥 1) Save to IndexedDB (async, non-blocking)
  // NOTE: persist() is sync, so we use an IIFE async task
  (async () => {
    // ---- A) try IndexedDB first
    try {
      // ✅ if you have an idb service
      await (this.idb as any).setWorkspace(withMeta);
      console.log('[WS] ✅ saved to IndexedDB', { pages: pagesCount, approxBytes });
      return;
    } catch (err) {
      console.warn('[WS] ⚠️ IndexedDB save failed, fallback to localStorage', err);
    }

    // ---- B) localStorage fallback (same as your old behavior)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(withMeta));
      console.log('[WS] ✅ saved to localStorage', { pages: pagesCount, approxBytes });
      return;
    } catch (e) {
      console.warn('[WS] ⚠️ localStorage full (QuotaExceeded). Removing previews and retry.', e);
    }

    // ---- C) drop previewDataUrl and retry localStorage
    const lite: WorkspaceState = {
      ...withMeta,
      pages: (withMeta.pages || []).map(p => ({
        ...p,
        previewDataUrl: undefined, // ✅ drop heavy field
      })),
    };

    const liteBytes = (() => {
      try { return JSON.stringify(lite).length; } catch { return -1; }
    })();

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(lite));
      console.log('[WS] ✅ localStorage saved after dropping previews', {
        pages: pagesCount,
        approxBytes: liteBytes,
      });

      // ✅ ensure UI matches persisted-lite (optional but safe)
      this._state$.next(lite);
      return;
    } catch (e2) {
      console.warn('[WS] ❌ Still full. UI updated but NOT persisted anywhere.', e2);
      return;
    }
  })();
}


  // ---------- Notebook actions
  createNotebook(title = 'New Notebook') {
    const s = this.snapshot;
    const nb: Notebook = { id: uid(), title, createdAt: now() };

    const next: WorkspaceState = {
      ...s,
      notebooks: [...s.notebooks, nb],
      activeNotebookId: nb.id,
      // reset selection; we will create default section/page
      activeSectionId: undefined,
      activePageId: undefined,
    };

    this.persist(next);
    this.createSection(nb.id, 'New Section');
  }

  renameNotebook(id: Id, title: string) {
    const s = this.snapshot;
    const notebooks = s.notebooks.map(n => (n.id === id ? { ...n, title } : n));
    this.persist({ ...s, notebooks });
  }

  deleteNotebook(id: Id) {
    const s = this.snapshot;

    const notebooks = s.notebooks.filter(n => n.id !== id);
    const sectionsToRemove = s.sections.filter(sec => sec.notebookId === id).map(sec => sec.id);
    const sections = s.sections.filter(sec => sec.notebookId !== id);
    const pages = s.pages.filter(p => !sectionsToRemove.includes(p.sectionId));

    const fallbackNotebook = notebooks[0];
    const next: WorkspaceState = {
      ...s,
      notebooks,
      sections,
      pages,
      activeNotebookId: fallbackNotebook?.id,
      activeSectionId: undefined,
      activePageId: undefined,
    };

    this.persist(next);

    if (fallbackNotebook) {
      // pick first section/page
      const firstSection = sortByOrder(sections.filter(x => x.notebookId === fallbackNotebook.id))[0];
      if (firstSection) {
        this.setActiveSection(firstSection.id);
      }
    }
  }

  setActiveNotebook(id: Id) {
    const s = this.snapshot;
    const next: WorkspaceState = {
      ...s,
      activeNotebookId: id,
      activeSectionId: undefined,
      activePageId: undefined,
    };
    this.persist(next);

    const sections = sortByOrder(this.snapshot.sections.filter(sec => sec.notebookId === id));
    if (sections[0]) this.setActiveSection(sections[0].id);
  }

  // ---------- Section actions
  createSection(notebookId: Id, title = 'New Section') {
    const s = this.snapshot;
    const existing = s.sections.filter(x => x.notebookId === notebookId);
    const order = existing.length ? Math.max(...existing.map(x => x.order)) + 1 : 1;

    const sec: Section = {
      id: uid(),
      notebookId,
      title,
      order,
      createdAt: now(),
    };

    const next: WorkspaceState = {
      ...s,
      sections: [...s.sections, sec],
      activeNotebookId: notebookId,
      activeSectionId: sec.id,
      activePageId: undefined,
    };

    this.persist(next);
    this.createPage(sec.id, 'Untitled page');
  }

  renameSection(id: Id, title: string) {
    const s = this.snapshot;
    const sections = s.sections.map(sec => (sec.id === id ? { ...sec, title } : sec));
    this.persist({ ...s, sections });
  }

  deleteSection(id: Id) {
    const s = this.snapshot;
    const section = s.sections.find(x => x.id === id);
    if (!section) return;

    const sections = s.sections.filter(x => x.id !== id);
    const pages = s.pages.filter(p => p.sectionId !== id);

    const next: WorkspaceState = {
      ...s,
      sections,
      pages,
      activeSectionId: undefined,
      activePageId: undefined,
    };
    this.persist(next);

    // choose next best section in same notebook
    const candidates = sortByOrder(sections.filter(x => x.notebookId === section.notebookId));
    if (candidates[0]) this.setActiveSection(candidates[0].id);
  }

  setActiveSection(id: Id) {
    const s = this.snapshot;
    const sec = s.sections.find(x => x.id === id);
    if (!sec) return;

    const next: WorkspaceState = {
      ...s,
      activeNotebookId: sec.notebookId,
      activeSectionId: id,
      activePageId: undefined,
    };
    this.persist(next);

    const pages = sortByOrder(this.snapshot.pages.filter(p => p.sectionId === id));
    if (pages[0]) this.setActivePage(pages[0].id);
  }

  // ---------- Page actions
  createPage(sectionId: Id, title = 'Untitled page') {
    const s = this.snapshot;
    const existing = s.pages.filter(p => p.sectionId === sectionId);
    const order = existing.length ? Math.max(...existing.map(p => p.order)) + 1 : 1;

    const page: Page = { id: uid(), sectionId, title, order, updatedAt: now() };

    const next: WorkspaceState = {
      ...s,
      pages: [...s.pages, page],
      activeSectionId: sectionId,
      activePageId: page.id,
    };
    this.persist(next);
  }

  renamePage(id: Id, title: string) {
    const s = this.snapshot;
    const pages = s.pages.map(p => (p.id === id ? { ...p, title, updatedAt: now() } : p));
    this.persist({ ...s, pages });
  }

  deletePage(id: Id) {
    const s = this.snapshot;
    const page = s.pages.find(p => p.id === id);
    if (!page) return;

    const pages = s.pages.filter(p => p.id !== id);

    const next: WorkspaceState = {
      ...s,
      pages,
      activePageId: undefined,
    };
    this.persist(next);

    const candidates = sortByOrder(pages.filter(p => p.sectionId === page.sectionId));
    if (candidates[0]) this.setActivePage(candidates[0].id);
  }

public setActivePage(pageId: string): void {
  const s = this.snapshot;

  if (!pageId) return;

  // ✅ if missing, create
  if (!s.pages?.some(p => p.id === pageId)) {
    console.warn('[WS] setActivePage ⚠️ page missing, auto-create', { pageId });
    this.ensurePage(pageId);
  }

  const next = { ...this.snapshot, activePageId: pageId };
  console.log('[WS] setActivePage ✅', { pageId });
  this.persist(next);
}
  // Step-2 hook: save editor content later


updatePageContent(
  pageId: Id,
  payload: { contentJson?: any; previewDataUrl?: string }
) {
  const s = this.snapshot;

  const pages = s.pages.map(p => {
    if (p.id !== pageId) return p;

    // ✅ only meta in state, content stays in IDB
    return {
      ...p,
      updatedAt: now(),
      // optional: keep tiny counters for debug
      contentCount: Array.isArray(payload.contentJson) ? payload.contentJson.length : (p as any).contentCount,
      hasPreview: payload.previewDataUrl ? true : (p as any).hasPreview,
    } as any;
  });

  console.log('[WS] updatePageContent ✅', {
    pageId,
    hasContent: payload.contentJson !== undefined,
    count: Array.isArray(payload.contentJson) ? payload.contentJson.length : undefined,
    hasPreview: !!payload.previewDataUrl,
  });

  this.persist({ ...s, pages });

  // ✅ heavy data -> IDB
  if (payload.contentJson !== undefined) {
    (this.idb as any).setPageContent(pageId, payload.contentJson).catch((e: any) => {
      console.warn('[WS] setPageContent failed ⚠️', { pageId, e });
    });
  }
  if (payload.previewDataUrl !== undefined) {
    (this.idb as any).setPagePreview(pageId, payload.previewDataUrl).catch((e: any) => {
      console.warn('[WS] setPagePreview failed ⚠️', { pageId, e });
    });
  }
}


/*
updatePageContent1(
  pageId: Id,
  payload: { contentJson?: any; contentsJson?: any; previewDataUrl?: string; previewDataUrl1?: string }
) {
  const s = this.snapshot;

  const pages = s.pages.map(p => {
    if (p.id !== pageId) return p;

    // ✅ support both keys (old/new)
    const items = payload.contentsJson ?? payload.contentJson;

    return {
      ...p,
      contentsJson: items,                 // ✅ always store in contentsJson
      previewDataUrl: payload.previewDataUrl ?? payload.previewDataUrl1 ?? p.previewDataUrl,
      updatedAt: now(),
    };
  });

  this.persist({ ...s, pages });
}

  // Utility: reset workspace (optional button later)
  resetAll() {
    localStorage.removeItem(LS_KEY);
    this._state$.next(this.loadInitial());
  }


*/


private makeSeed(): WorkspaceState {
  const nbId = uid();
  const secId = uid();
  const pageId = uid();

  const seed: WorkspaceState = {
    notebooks: [
      { id: nbId, title: 'My Notebook', createdAt: now() },
    ],
    sections: [
      { id: secId, notebookId: nbId, title: 'Quick Notes', order: 1, createdAt: now() },
    ],
    pages: [
      { id: pageId, sectionId: secId, title: 'Untitled page', order: 1, updatedAt: now() },
    ],
    activeNotebookId: nbId,
    activeSectionId: secId,
    activePageId: pageId,
    lastSavedAt: now(),
  };

  return seed;
}

private async hydrateFromIdb(): Promise<void> {
  const saved = await this.idb.getWorkspace();

  if (saved && saved.notebooks?.length) {
    this._state$.next(saved);
  } else {
    const seed = this.makeSeed();
    await this.idb.setWorkspace(seed);
    this._state$.next(seed);
  }
}
exportBackup(): void {
  const ws = this.snapshot;

  const backup = {
    v: 1,
    exportedAt: Date.now(),
    workspace: ws,
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: 'application/json' }
  );

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mindmap-backup-${Date.now()}.json`;
  a.click();

  console.log('[BACKUP] exported ✅', {
    pages: ws.pages.length,
    size: blob.size,
  });
}
importBackup(file: File): void {
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result as string);

      if (!json?.workspace) {
        console.error('[BACKUP] invalid file ❌');
        return;
      }

      // overwrite localStorage
      localStorage.setItem(
        'mindmap_workspace_v1',
        JSON.stringify(json.workspace)
      );

      // update UI state
      this._state$.next(json.workspace);

      console.log('[BACKUP] restored ✅', {
        pages: json.workspace.pages.length,
      });
    } catch (e) {
      console.error('[BACKUP] restore failed ❌', e);
    }
  };

  reader.readAsText(file);
}

public ensurePage(pageId: string, title = 'Untitled page'): void {
  const s = this.snapshot;

  const exists = s.pages?.some(p => p.id === pageId);
  if (exists) {
    console.log('[WS] ensurePage ✅ exists', { pageId });
    return;
  }

  const sectionId =
    s.activeSectionId ??
    s.sections?.[0]?.id;

  if (!sectionId) {
    console.warn('[WS] ensurePage ❌ no sectionId', { pageId });
    return;
  }

  const order = (s.pages?.filter(p => p.sectionId === sectionId).length ?? 0) + 1;

  const newPage: any = {
    id: pageId,
    sectionId,
    title,
    order,
    updatedAt: Date.now(),
    contentJson: [],
    previewDataUrl: undefined,
  };

  const next = {
    ...s,
    pages: [...(s.pages ?? []), newPage],
  };

  console.log('[WS] ensurePage ✅ created', { pageId, sectionId, order });
  this.persist(next); // ✅ your wrapper (persist)
}

}
