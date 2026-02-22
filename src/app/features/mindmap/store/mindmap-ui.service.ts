import { Injectable, computed, inject, signal } from '@angular/core';
import { Id, MindmapNodeUI } from '../model/mindmap-ui.models';
import { WorkspaceStoreService } from '../../../core/store/workspace-store.service';
import { WorkspaceState } from '../../../core/models/workspace.models';



function uid(prefix: string): Id {
  return `${prefix}-${crypto.randomUUID()}`;
}

@Injectable({ providedIn: 'root' })
export class MindmapUiStore {
  
  private storage = inject(WorkspaceStoreService);
  private _nodes = signal<Record<Id, MindmapNodeUI>>({});
  private _selectedNodeId = signal<Id | null>(null);
  private _notebookId = signal<Id>('demo');
  private _nodesMap = signal<Record<string, any>>({});


  readonly notebookId = computed(() => this._notebookId());
  readonly nodesMap = computed(() => this._nodes());
  readonly selectedNodeId = computed(() => this._selectedNodeId());

  readonly selectedNode = computed(() => {
    const id = this._selectedNodeId();
    if (!id) return null;
    return this._nodes()[id] ?? null;
  });

init(notebookId: Id): void {
  console.log('[MindmapUiStore] init ✅ notebookId=', notebookId);

  const prev = this._notebookId();

  // ✅ If notebook changed -> reset state (old behavior)
  if (prev && prev !== notebookId) {
    console.log('[MindmapUiStore] notebook changed ✅', { prev, notebookId });
    this._nodes.set({});
    this._selectedNodeId.set(null);
  }

  // ✅ set current notebookId (old behavior)
  this._notebookId.set(notebookId);

  // ✅ NEW (SAFE): Try hydrate from saved BEFORE creating root
  // This fixes refresh case where prev is null/empty.
  const nodesNow = this._nodes();
  if (Object.keys(nodesNow).length === 0) {
    const saved = this.loadSavedNodes(notebookId);
    if (saved && Object.keys(saved).length > 0) {
      this._nodes.set(saved);

      const rootId =
        Object.keys(saved).find((id) => !saved[id]?.parentId) ?? Object.keys(saved)[0];

      this._selectedNodeId.set(rootId as any);

      console.log('[MindmapUiStore] hydrated from saved ✅', {
        notebookId,
        nodes: Object.keys(saved).length,
        rootId,
      });
      return; // ✅ do NOT create new root
    }
  }

  // ✅ If nodes already exist -> skip creating again (old behavior)
  const nodes = this._nodes();
  if (Object.keys(nodes).length > 0) {
    console.log('[MindmapUiStore] already has nodes, skipping init');
    return;
  }

  // ✅ Create ROOT always when empty (old behavior)
  const rootId = uid('node');
  const rootPageId = uid('page');

  const root: MindmapNodeUI = {
    id: rootId,
    notebookId,
    pageId: rootPageId,
    title: 'Main Topic',
    snapshotImage: undefined,
    x: 400,
    y: 200,
    width: 220,
    height: 140,
    parentId: undefined,
    childrenIds: [],
  };

  this._nodes.set({ [rootId]: root });
  this._selectedNodeId.set(rootId);

  // ✅ Persist initial root too (safe)
  this.persistNodes(notebookId);

  console.log('[MindmapUiStore] root created ✅', { rootId, rootPageId });
}


  select(nodeId: Id): void {
    console.log('[MindmapUiStore] select ✅', nodeId);
    this._selectedNodeId.set(nodeId);
  }

  createChild(parentId: Id): void {
    const nodes = this._nodes();
    const parent = nodes[parentId];
    if (!parent) return;

    const childId = uid('node');
    const childPageId = uid('page');

    const child: MindmapNodeUI = {
      id: childId,
      notebookId: parent.notebookId,
      pageId: childPageId,
      title: 'New Child',
      snapshotImage: undefined,
      x: parent.x + 260,
      y: parent.y + 180,
      width: 220,
      height: 140,
      parentId: parentId,
      childrenIds: [],
    };

    // add child
    this._nodes.update(n => ({ ...n, [childId]: child }));

    // link to parent
    this._nodes.update(n => ({
      ...n,
      [parentId]: { ...n[parentId], childrenIds: [...n[parentId].childrenIds, childId] },
    }));

    this._selectedNodeId.set(childId);

    console.log('[MindmapUiStore] createChild ✅', { parentId, childId, childPageId });
  }

  updateTitle(nodeId: Id, title: string): void {
    const nodes = this._nodes();
    if (!nodes[nodeId]) return;

    this._nodes.update(n => ({
      ...n,
      [nodeId]: { ...n[nodeId], title },
    }));

    console.log('[MindmapUiStore] updateTitle ✅', { nodeId, title });
    this.persistNodes(this._notebookId());
  }

  pushDummyCrop(nodeId: Id): void {
    const nodes = this._nodes();
    if (!nodes[nodeId]) return;

    const dummy =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

    this._nodes.update(n => ({
      ...n,
      [nodeId]: { ...n[nodeId], snapshotImage: dummy },
    }));

    console.log('[MindmapUiStore] pushDummyCrop ✅ nodeId=', nodeId);
  }

  deleteNode(nodeId: Id): void {
    const nodes = this._nodes();
    const target = nodes[nodeId];
    if (!target) return;

    // block deleting root (node with no parent)
    if (!target.parentId) {
      console.warn('[MindmapUiStore] ❌ Root delete blocked');
      return;
    }

    // collect subtree
    const toDelete: Id[] = [];
    const dfs = (id: Id) => {
      const n = nodes[id];
      if (!n) return;
      toDelete.push(id);
      n.childrenIds.forEach(dfs);
    };
    dfs(nodeId);

    console.log('[MindmapUiStore] delete subtree ✅', toDelete);

    // unlink from parent
    const pid = target.parentId;
    this._nodes.update(n => ({
      ...n,
      [pid]: { ...n[pid], childrenIds: n[pid].childrenIds.filter(cid => cid !== nodeId) },
    }));

    // remove nodes
    this._nodes.update(n => {
      const copy = { ...n };
      toDelete.forEach(id => delete copy[id]);
      return copy;
    });

    // select parent after delete
    this._selectedNodeId.set(pid);
  }

  moveNode(nodeId: Id, x: number, y: number): void {
  const nodes = this._nodes();
  if (!nodes[nodeId]) return;

  this._nodes.update(n => ({
    ...n,
    [nodeId]: { ...n[nodeId], x, y },
  }));

  console.log('[MindmapUiStore] moveNode ✅', { nodeId, x, y });
  this.persistNodes(this._notebookId());
}
selectNode(nodeId: Id | null): void {
  console.log('[MindmapUiStore] selectNode ✅', nodeId);
  this._selectedNodeId.set(nodeId);
}



setSnapshotImage(nodeId: Id, dataUrl: string): void {
  const nodes = this._nodes();            // ✅ read current map
  const node = nodes[nodeId];
  if (!node) return;

  const updatedNode: MindmapNodeUI = {
    ...node,
    snapshotImage: dataUrl,
  };

  this._nodes.set({
    ...nodes,
    [nodeId]: updatedNode,
  });

  console.log('[MindmapUiStore] snapshot set ✅', { nodeId });
  this.persistNodes(this._notebookId());
}

resizeNode(nodeId: Id, w: number, h: number): void {
  const nodes = this._nodes();
  const n = nodes?.[nodeId];
  if (!n) return;

  const next = {
    ...nodes,
    [nodeId]: {
      ...n,
      width: Math.round(w),
      height: Math.round(h),
    },
  };

  this._nodes.set(next);

  // ✅ persist (same as your init root persist)
  const nb = this._notebookId();
  if (nb) this.persistNodes(nb);

  console.log('[MindmapUiStore] resizeNode ✅', nodeId, { w, h });
}
private loadSavedNodes(notebookId: Id): Record<string, MindmapNodeUI> | null {
  try {
    const key = `mm_nodes_${notebookId}`; // ✅ storage key
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    // Backward compatible: ensure width/height default
    for (const id of Object.keys(parsed)) {
      const n = parsed[id];
      if (!n) continue;
      n.width = n.width ?? 220;
      n.height = n.height ?? 140;
      n.childrenIds = n.childrenIds ?? [];
    }

    return parsed as Record<string, MindmapNodeUI>;
  } catch (e) {
    console.warn('[MindmapUiStore] loadSavedNodes failed', e);
    return null;
  }
}


private persistNodes(notebookId: Id): void {
  try {
    const key = `mm_nodes_${notebookId}`;
    localStorage.setItem(key, JSON.stringify(this._nodes()));
    // console.log('[MindmapUiStore] persisted ✅', { key });
  } catch (e) {
    console.warn('[MindmapUiStore] persistNodes failed', e);
  }
}


}
