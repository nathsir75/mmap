import { Injectable } from '@angular/core';
import { get, set, del } from 'idb-keyval';
import { WorkspaceState, Id } from '../models/workspace.models';

const IDB_WS_KEY = 'mindmap_workspace_v1';         // workspace meta
const IDB_PAGE_PREFIX = 'page:';                  // page content
const IDB_PREVIEW_PREFIX = 'preview:';            // preview blob/base64


export type WorkspaceBackup = {
  v: 1;
  exportedAt: number;
  workspace: WorkspaceState;
  pages: Record<string, { contentJson?: any; previewDataUrl?: string }>;
};





@Injectable({ providedIn: 'root' })
export class WorkspaceIdbService {

  // ✅ workspace (small)
  getWorkspace(): Promise<WorkspaceState | undefined> {
    return get(IDB_WS_KEY);
  }

  setWorkspace(state: WorkspaceState): Promise<void> {
    return set(IDB_WS_KEY, state);
  }

  // ✅ page content (big)
  getPageContent(pageId: Id): Promise<any | undefined> {
    return get(IDB_PAGE_PREFIX + pageId);
  }

  setPageContent(pageId: Id, contentJson: any): Promise<void> {
    return set(IDB_PAGE_PREFIX + pageId, contentJson);
  }

  // ✅ preview (can be big)
  getPagePreview(pageId: Id): Promise<string | undefined> {
    return get(IDB_PREVIEW_PREFIX + pageId);
  }

  setPagePreview(pageId: Id, dataUrl: string | undefined): Promise<void> {
    if (!dataUrl) return del(IDB_PREVIEW_PREFIX + pageId);
    return set(IDB_PREVIEW_PREFIX + pageId, dataUrl);
  }

  // ✅ clear all (optional later)
  async clearAll(): Promise<void> {
    await del(IDB_WS_KEY);
    // (advanced) अगर चाहो तो keys iterate करके pages/previews भी delete कर सकते हैं
  }
}
