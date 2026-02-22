import { Component, OnInit, inject, signal,Injector } from '@angular/core';

import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MindmapUiStore } from '../../store/mindmap-ui.service';
import { AfterViewInit, ElementRef, ViewChild, effect } from '@angular/core';
import Konva from 'konva';
import { Id } from '../../model/mindmap-ui.models';
import { WorkspaceStoreService } from '../../../../core/store/workspace-store.service';




@Component({
  standalone: true,
  selector: 'app-mindmap-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './mindmap-page.component.html',
  styleUrls: ['./mindmap-page.component.css'],
})
export class MindmapPageComponent implements OnInit , AfterViewInit {


  @ViewChild('mindmapHost', { static: false }) mindmapHost?: ElementRef<HTMLDivElement>; 

private stage?: Konva.Stage;
private edgeLayer?: Konva.Layer;
private gridLayer?: Konva.Layer; // ✅ NEW
private nodeLayer?: Konva.Layer;
private uiLayer?: Konva.Layer;

private gridSize = 40;
private gridMajorEvery = 5;
private _gridRAF = 0;

// mapping: nodeId -> Konva.Group
private nodeViews = new Map<string, Konva.Group>();
private injector = inject(Injector);


  //.......................
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  public store = inject(MindmapUiStore);
  public workspace = inject(WorkspaceStoreService);

  titleDraft = signal<string>('');
  inspectorCollapsed = signal(false);


private cameraScale = 1;
private cameraMin = 0.2;
private cameraMax = 2.5;

      // throttle helper

trackByKey = (_: number, item: { key: string }) => item.key;
private gridGroup?: Konva.Group;

// grid redraw throttle
private gridRaf = 0;
private gridDirty = false;

      // world units
private gridOverscan = 2; 


private tr!: Konva.Transformer;






ngOnInit(): void {
  const notebookId = this.route.snapshot.paramMap.get('notebookId') ?? 'demo';
  console.log('[MindmapPage] route notebookId=', notebookId);

  // ✅ init (as-is)
  this.store.init(notebookId);

  // ✅ always refresh after init (as-is)
  this.refreshDraft();

  // ✅ NEW: back/return support -> ?nodeId=...
  this.route.queryParamMap.subscribe((qp) => {
    const nodeId = qp.get('nodeId');
    if (!nodeId) return;

    console.log('[MindmapPage] return nodeId ✅', nodeId);

    // 1) select node in store
    this.store.selectNode(nodeId as any);

    // 2) center after stage ready (ngAfterViewInit sets stage)
    const tryCenter = () => {
      if (this.stage) {
        this.centerOnNode(nodeId as any);
      } else {
        setTimeout(tryCenter, 0);
      }
    };
    tryCenter();

    // 3) optional: clean URL (remove queryParam)
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  });
}

ngAfterViewInit(): void {
  console.log('[Mindmap] ngAfterViewInit ✅');

  const host = this.mindmapHost?.nativeElement;
  if (!host) {
    console.warn('[Mindmap] ❌ host not found');
    return;
  }

  // host size
  const w = host.clientWidth || 800;
  const h = host.clientHeight || 500;
  console.log('[Mindmap] host size ✅', { w, h });

  // ✅ Create stage
  this.stage = new Konva.Stage({
    container: host,
    width: w,
    height: h,
  });

  // ✅ handlers
  this.attachZoomHandlers();
  this.attachPanHandlers();

  // ✅ CREATE layers once
  this.edgeLayer = new Konva.Layer();
  this.gridLayer = new Konva.Layer(); // ✅ grid
  this.nodeLayer = new Konva.Layer();
  this.uiLayer = new Konva.Layer();

  // ✅ ADD once (order matters)
  this.stage.add(this.edgeLayer);
  this.stage.add(this.gridLayer); // grid edges ke upar, nodes ke neeche
  this.stage.add(this.nodeLayer);
  this.stage.add(this.uiLayer);

  console.log('[Mindmap] stage+layers created ✅', { grid: true });

  // ✅ draw grid once now
  this.drawGrid();

  // ✅ TRANSFORMER (resize handles only, NO blue border)
  this.tr = new Konva.Transformer({
    rotateEnabled: false,
    keepRatio: false,
    ignoreStroke: true,

    enabledAnchors: [
      'top-left','top-right','bottom-left','bottom-right',
      'top-center','bottom-center','middle-left','middle-right'
    ],

    // ✅ remove outer selection border line
    borderEnabled: false,

    // handles
    anchorSize: 8,
    anchorCornerRadius: 2,

    boundBoxFunc: (oldBox, newBox) => {
      const minW = 120;
      const minH = 90;
      if (newBox.width < minW) newBox.width = minW;
      if (newBox.height < minH) newBox.height = minH;
      return newBox;
    },
  });

  // ✅ NEW: During resize, disable node dragging to avoid conflict
  this.tr.on('transformstart', () => {
    const g: any = this.tr.nodes()?.[0];
    if (g && typeof g.draggable === 'function') g.draggable(false);
  });

  this.tr.on('transformend', () => {
    const g: any = this.tr.nodes()?.[0];
    if (g && typeof g.draggable === 'function') g.draggable(true);
  });

this.uiLayer.listening(true);
this.tr.listening(true);

// ✅ VERY IMPORTANT: stop stage handlers when clicking anchors/transformer
this.tr.on('mousedown touchstart', (e) => {
  e.cancelBubble = true;
});




  this.uiLayer.add(this.tr);
  this.uiLayer.listening(true);
  //(this.uiLayer as any).hitGraphEnabled?.(true);
  this.tr.listening(true);
  (this.tr as any).hitOnDragEnabled?.(true);
  this.uiLayer.draw();
  console.log('[Mindmap] transformer ready ✅');

  // ✅ click empty -> clear selection
// ✅ click empty -> clear selection
this.stage.on('mousedown', (evt) => {

  if (this.tr && this.tr.nodes().length > 0) {
  const t: any = evt.target;
  const name = typeof t?.name === 'function' ? t.name() : '';
  const layer = (t as any)?.getLayer?.();

  // when click is on uiLayer OR anchor-like names -> ignore
  if (layer === this.uiLayer || name.includes('anchor') || name.includes('transformer') || name.startsWith('_')) {
    return;
  }
}
  // ✅ NEW-1: if click is on UI layer (transformer/anchors), do NOT clear selection
  const layer = (evt.target as any)?.getLayer?.();
  if (layer === this.uiLayer) return;

  // ✅ EXISTING: IF click is on transformer/anchor, do NOT clear selection
  const t: any = evt.target;
  const name = typeof t?.name === 'function' ? t.name() : '';
  const parent = typeof t?.getParent === 'function' ? t.getParent() : null;

  // ✅ NEW-2: Konva anchor names are often like "_anchor" or contain "anchor"
  const isAnchorLike = name.startsWith('_') || name.includes('anchor');

  const isTransformerTarget =
    t === this.tr ||
    parent === this.tr ||
    name.includes('transformer') ||
    isAnchorLike;

  if (isTransformerTarget) return;

  // ✅ same old behavior
  if (evt.target === this.stage) {
    console.log('[Mindmap] empty click -> clear selection');
    this.store.selectNode(null as any); // keep as-is (your store supports this)
    this.refreshDraft();
    this.render();
  }
});

  // ✅ Apply editor crop -> mindmap node snapshot (ONE TIME)
  try {
    const cropNodeId = localStorage.getItem('mm_lastCrop_nodeId');
    const cropDataUrl = localStorage.getItem('mm_lastCrop_dataUrl');

    if (cropNodeId && cropDataUrl) {
      console.log('[Mindmap] applying crop snapshot ✅', { cropNodeId });

      // 🔥 this must exist in MindmapUiStore
      this.store.setSnapshotImage(cropNodeId as any, cropDataUrl);

      // one-time cleanup
      localStorage.removeItem('mm_lastCrop_nodeId');
      localStorage.removeItem('mm_lastCrop_dataUrl');
    }
  } catch (e) {
    console.warn('[Mindmap] crop apply failed', e);
  }

  // ✅ initial render
  this.render();

  // ✅ center on selected if exists
  const sel = this.store.selectedNodeId();
  if (sel) this.centerOnNode(sel);

  // ✅ auto re-render when nodes/selection changes
  effect(
    () => {
      const nodes = this.store.nodesMap();
      const selected = this.store.selectedNodeId();
      console.log(
        '[Mindmap] effect render ✅ nodes=',
        Object.keys(nodes).length,
        'selected=',
        selected
      );

      this.render();
    },
    { injector: this.injector }
  );

  this.applyPendingCropFromEditor();

  // ✅ resize
  window.addEventListener('resize', () => this.resizeStage());
  setTimeout(() => this.resizeStage(), 0);

  window.addEventListener('focus', () => this.applyPendingCropFromEditor());
}

refreshDraft(): void {
  const n = this.store.selectedNode();
  this.titleDraft.set(n?.title ?? '');
  console.log('[MindmapPage] refreshDraft ✅ selected=', n?.id ?? null);
}

toggleInspector(): void {
  this.inspectorCollapsed.update(v => !v);
  console.log('[MindmapUI] toggleInspector ✅', this.inspectorCollapsed());
  // host size change => stage resize (next step)
 setTimeout(() => {
  this.resizeStage();
  const sel = this.store.selectedNodeId();
  if (sel) this.centerOnNode(sel);
}, 0);
}

private resizeStage(): void {
  const host = this.mindmapHost?.nativeElement;
  if (!host || !this.stage) return;

  const w = host.clientWidth || 800;
  const h = host.clientHeight || 500;

  this.stage.width(w);
  this.stage.height(h);

  this.drawGrid();     // ✅ redraw grid for new size
  this.render();       // ✅ nodes + edges

  const sel = this.store.selectedNodeId();
  if (sel) this.centerOnNode(sel);

  console.log('[Mindmap] resizeStage ✅', { w, h });
}
  createChild(): void {
    const n = this.store.selectedNode();
    if (!n) return;
    this.store.createChild(n.id);
    this.refreshDraft();
     this.render(); 
  }

saveTitle(): void {
  const n = this.store.selectedNode();
  if (!n) return;

  // Allow blank title: if user clears input, keep ""
  const t = (this.titleDraft() ?? '').trim();

  this.store.updateTitle(n.id, t);   // t can be ""
  this.refreshDraft();
  this.render();
}

  deleteNode(): void {
    const n = this.store.selectedNode();
    if (!n) return;
    this.store.deleteNode(n.id);
    this.refreshDraft();
     this.render(); 
  }

public openEditor(): void {
  console.log('[Mindmap] openEditor() called ✅');

  const n = this.store.selectedNode();
  console.log('[Mindmap] selectedNode =', n);

  if (!n) {
    console.warn('[Mindmap] ❌ No selected node, return');
    return;
  }

  // ✅ editor context save
  localStorage.setItem('mm_editing_nodeId', n.id);
  localStorage.setItem('mm_editing_pageId', n.pageId);
  console.log('[Mindmap] ✅ set editing context', { nodeId: n.id, pageId: n.pageId });

  // ✅ IMPORTANT: workspace में active page set करो
  this.workspace.setActivePage(n.pageId);

  // ✅ navigate
  this.router.navigate(['/editor', n.pageId])
    .then(ok => console.log('[Mindmap] navigate result ✅', ok))
    .catch(err => console.error('[Mindmap] navigate error ❌', err));
}

  pushCropPlaceholder(): void {
    const n = this.store.selectedNode();
    if (!n) return;
    this.store.pushDummyCrop(n.id);
     this.render(); 
  }


private render(): void {
  if (!this.stage || !this.nodeLayer || !this.edgeLayer) return;

  const nodes = this.store.nodesMap();
  const selectedId = this.store.selectedNodeId();

  // 1) Nodes
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    const view = this.getOrCreateNodeView(n.id);
    view.position({ x: n.x, y: n.y });
    this.updateNodeView(view, n, n.id === selectedId);
  }

  // remove deleted
  for (const [id, view] of this.nodeViews.entries()) {
    if (!nodes[id]) {
      view.destroy();
      this.nodeViews.delete(id);
    }
  }

  this.nodeLayer.draw();

  // 2) Edges – professional split left/right junction (generic mindmap feel)
  this.edgeLayer.destroyChildren();

  const midY = (n: any) => n.y + (n.height ?? 140) / 2;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  // ✅ premium look helper: double-stroke path
const addPremiumPath = (d: string, mainW: number) => {
  const edgeLayer = this.edgeLayer;
  if (!edgeLayer) return;

  // subtle shadow base (professional depth)
  edgeLayer.add(
    new Konva.Path({
      data: d,
      stroke: '#000',
      strokeWidth: mainW,
      opacity: 0.08,
      shadowColor: '#000',
      shadowBlur: 10,
      shadowOffset: { x: 0, y: 2 },
      shadowOpacity: 0.25,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false,
    })
  );

    edgeLayer.add(
    new Konva.Path({
      data: d,
      stroke: '#e6e6e6',
      strokeWidth: mainW + 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false,
    })
  );
  // main stroke (clean)
  edgeLayer.add(
    new Konva.Path({
      data: d,
      stroke: '#4b5563', // slate gray (pro look)
      strokeWidth: mainW,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false,
    })
  );
};
  for (const parentId of Object.keys(nodes)) {
    const parent = nodes[parentId];
    if (!parent) continue;

    const childrenIds: string[] = (parent.childrenIds ?? []).filter((cid) => !!nodes[cid]);
    if (!childrenIds.length) continue;

    const pw = parent.width ?? 220;
    const ph = parent.height ?? 140;

    // parent anchors
    const parentCx = parent.x + pw / 2;

    const pRightX = parent.x + pw;
    const pRightY = parent.y + ph / 2;

    const pLeftX = parent.x;
    const pLeftY = parent.y + ph / 2;

    // split children by side (based on centerX)
    const leftKids: string[] = [];
    const rightKids: string[] = [];

    for (const cid of childrenIds) {
      const c = nodes[cid];
      const cw = c.width ?? 220;
      const childCx = c.x + cw / 2;
      if (childCx < parentCx) leftKids.push(cid);
      else rightKids.push(cid);
    }

    // helper to draw one side with junction + branches
const drawSide = (side: 'left' | 'right', kids: string[], sx: number, sy: number) => {
  if (!kids.length) return;

  const farDx = kids.reduce((mx, cid) => {
    const c = nodes[cid];
    const cw = c.width ?? 220;
    const ex = side === 'right' ? c.x : c.x + cw;
    return Math.max(mx, Math.abs(ex - sx));
  }, 0);

  const STEM = clamp(80 + farDx * 0.16, 140, 260);
  const jx = side === 'right' ? sx + STEM : sx - STEM;

  // junction y = average of child centers
  const jy = kids.reduce((sum, cid) => sum + midY(nodes[cid]), 0) / kids.length;

  // ✅ 1) STEM (thicker)
  {
    const dir = side === 'right' ? 1 : -1;

    // control points: smooth S curve
    const c1x = sx + dir * STEM * 0.35;
    const c1y = sy + clamp((jy - sy) * 0.15, -40, 40);

    const c2x = jx - dir * STEM * 0.25;
    const c2y = jy - clamp((jy - sy) * 0.15, -40, 40);

    const dStem = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${jx} ${jy}`;
    addPremiumPath(dStem, 5);
  }

  // ✅ 2) Junction dot (hides joins, looks premium)
  {
    const edgeLayer = this.edgeLayer!;
    edgeLayer.add(
      new Konva.Circle({
        x: jx,
        y: jy,
        radius: 6,
        fill: '#ffffff',
        stroke: '#4b5563',
        strokeWidth: 3,
        shadowColor: '#000',
        shadowBlur: 8,
        shadowOffset: { x: 0, y: 2 },
        shadowOpacity: 0.18,
        listening: false,
      })
    );
  }

  // ✅ 3) Branches (slightly thinner)
  for (const cid of kids) {
    const child = nodes[cid];
    const cw = child.width ?? 220;
    const ch = child.height ?? 140;

    const ex = side === 'right' ? child.x : child.x + cw;
    const ey = child.y + ch / 2;

    const dx = ex - jx;
    const dy = ey - jy;

    const dir = side === 'right' ? 1 : -1;

    // stronger curve near junction, softer near child
    const curveX = clamp(Math.abs(dx) * 0.6, 160, 520);
    const curveY = clamp(dy * 0.22, -90, 90);

    const c1x = jx + dir * curveX * 0.35;
    const c1y = jy + curveY;

    const c2x = ex - dir * curveX * 0.25;
    const c2y = ey - curveY;

    const d = `M ${jx} ${jy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
    addPremiumPath(d, 3.5);
  }
};

    // draw both sides
    drawSide('right', rightKids, pRightX, pRightY);
    drawSide('left', leftKids, pLeftX, pLeftY);
  }

  // ✅ use batchDraw for smoother rendering
  this.edgeLayer.batchDraw();
}

private getOrCreateNodeView(nodeId: string): Konva.Group {
  const ex = this.nodeViews.get(nodeId);
  if (ex) return ex;

  console.log('[Mindmap] create node view ✅', nodeId);

  const group = new Konva.Group({
    x: 0,
    y: 0,
    draggable: true,
    name: 'mindmap-node',
    width: 220,
    height: 140,
     listening: true, // ✅
  });

  const rect = new Konva.Rect({
    name: 'card', // keep class for findOne('.card')
    width: 220,
    height: 140,
    cornerRadius: 12,
    fill: '#fff',

    // ✅ NO boundary
    strokeEnabled: false,
    strokeWidth: 0,
  });

  const title = new Konva.Text({
    name: 'title', // keep class for findOne('.title')
    x: 12,
    y: 10,
    text: '',
    fontSize: 16,
    fontStyle: 'bold',
    fill: '#111',
    width: 220 - 24,
    ellipsis: true,
  });

  const thumbBg = new Konva.Rect({
    name: 'thumbBg', // keep class for findOne('.thumbBg')
    x: 12,
    y: 40,
    width: 220 - 24,
    height: 140 - 52,
    cornerRadius: 10,

    // ✅ NO dotted line
    strokeEnabled: false,
    strokeWidth: 0,
    dashEnabled: false,
    fillEnabled: false,
  });

  group.add(rect, title, thumbBg);

group.on('mousedown', (evt) => {
  // ✅ if user is dragging transformer anchor, do not interfere
  const targetName = evt.target?.name?.() ?? '';
  if (targetName.includes('anchor') || targetName.includes('transformer')) return;

  evt.cancelBubble = true;
  console.log('[Mindmap] select node ✅', nodeId);
  this.store.select(nodeId as any);
  this.refreshDraft();
  this.render();
});

  group.on('dragend', () => {
    const pos = group.position();
    console.log('[Mindmap] dragend ✅', nodeId, pos);
    this.store.moveNode(nodeId as any, pos.x, pos.y);
  });

  // ✅ Resizable support (Transformer will scale group; we persist width/height)

  group.on('transform', () => {
  const scaleX = group.scaleX();
  const scaleY = group.scaleY();

  const minW = 120;
  const minH = 90;

  const previewW = Math.max(minW, group.width() * scaleX);
  const previewH = Math.max(minH, group.height() * scaleY);

  // ✅ live layout (do NOT persist here)
  this.layoutNodeGroup(group, previewW, previewH);

  this.nodeLayer?.batchDraw();
  this.uiLayer?.batchDraw();
});
 group.on('transformend', () => {
  const scaleX = group.scaleX();
  const scaleY = group.scaleY();

  // ✅ if no scale change, don't persist (prevents false resize)
  if (Math.abs(scaleX - 1) < 0.0001 && Math.abs(scaleY - 1) < 0.0001) {
    return;
  }

  group.scaleX(1);
  group.scaleY(1);

  const minW = 120;
  const minH = 90;

  const newW = Math.max(minW, group.width() * scaleX);
  const newH = Math.max(minH, group.height() * scaleY);

  group.width(newW);
  group.height(newH);

  // ✅ final layout
  this.layoutNodeGroup(group, newW, newH);

  // ✅ persist
  if (typeof (this.store as any).resizeNode === 'function') {
    (this.store as any).resizeNode(nodeId as any, newW, newH);
  } else {
    console.warn('[Mindmap] store.resizeNode missing. Please add resizeNode(id,w,h) to persist size.');
  }

  this.nodeLayer?.batchDraw();
  this.uiLayer?.batchDraw();
});

  this.nodeLayer!.add(group);
  this.nodeViews.set(nodeId, group);
  return group;
}

private updateNodeView(group: Konva.Group, n: any, selected: boolean): void {
  const rect = group.findOne<Konva.Rect>('.card');
  const title = group.findOne<Konva.Text>('.title');

  const w = n.width ?? 220;
  const h = n.height ?? 140;

  // group dimensions important for transformer correctness
  group.width(w);
  group.height(h);

  if (rect) {
    rect.width(w);
    rect.height(h);

    // ✅ no outer border (even on selected)
    rect.strokeEnabled(false);
    rect.strokeWidth(0);
  }

  if (title) {
    const t = (n.title ?? '').trim();
    title.text(t);
    title.visible(t.length > 0); // blank => hide
    title.width(Math.max(0, w - 24));
  }

  // ✅ 1) layout first (sets thumbBg box based on title/size)
  this.layoutNodeGroup(group, w, h);

  // ✅ 2) then apply snapshot (will reuse existing image + just resize)
  this.applySnapshotImage(group, n.snapshotImage, w, h);

  // ✅ selection via transformer (but WITHOUT border line)
  if (this.tr) {
    if (selected) {
      this.tr.nodes([group]);
      this.tr.moveToTop();
    } else {
      const nodes = this.tr.nodes();
      if (nodes.length && nodes[0] === group) this.tr.nodes([]);
    }
    this.uiLayer?.batchDraw();
  }
}

private applySnapshotImage(
  group: Konva.Group,
  snapshot: string | undefined,
  w: number,
  h: number
): void {
  // ✅ Remove duplicates: keep only ONE thumbImg
  const allImgs = group.find<Konva.Image>('.thumbImg') as any;
  let imgNode: Konva.Image | null = null;

  if (allImgs && allImgs.length) {
    imgNode = allImgs[0] as Konva.Image;
    for (let i = 1; i < allImgs.length; i++) {
      (allImgs[i] as Konva.Image).destroy();
    }
  }

  // ✅ if no snapshot -> remove existing
  if (!snapshot) {
    if (imgNode) imgNode.destroy();
    return;
  }

  // box from thumbBg (dynamic)
  const thumbBg = group.findOne<Konva.Rect>('.thumbBg');
  const boxX = thumbBg?.x() ?? 12;
  const boxY = thumbBg?.y() ?? 40;
  const boxW = thumbBg?.width() ?? (w - 24);
  const boxH = thumbBg?.height() ?? (h - 52);

  // ✅ If image exists -> just position/resize it
  if (imgNode) {
    imgNode.x(boxX);
    imgNode.y(boxY);
    imgNode.width(boxW);
    imgNode.height(boxH);

    const currentSrc = (imgNode.getAttr('dataSrc') as string) ?? '';
    if (currentSrc === snapshot) {
      this.nodeLayer?.batchDraw();
      return;
    }

    // src changed -> update image content
    const img = new window.Image();
    img.onload = () => {
      imgNode!.image(img);
      imgNode!.setAttr('dataSrc', snapshot);
      this.nodeLayer?.batchDraw();
    };
    img.src = snapshot;
    return;
  }

  // ✅ create ONCE
  const img = new window.Image();
  img.onload = () => {
    const kImage = new Konva.Image({
      name: 'thumbImg',
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      image: img,
    });

    kImage.setAttr('dataSrc', snapshot);
    group.add(kImage);

    // keep card at bottom
    const card = group.findOne<Konva.Rect>('.card');
    if (card) card.moveToBottom();

    this.nodeLayer?.batchDraw();
  };
  img.src = snapshot;
}

public centerOnNode(nodeId: string): void {
  if (!this.stage) return;
  const n = this.store.nodesMap()[nodeId];
  if (!n) return;

  const sw = this.stage.width();
  const sh = this.stage.height();

const CARD_W = 220;
const CARD_H = 120;

const nx = n.x + CARD_W / 2;
const ny = n.y + CARD_H / 2;

  // stage position so that node center comes to screen center
  const newX = sw / 2 - nx;
  const newY = sh / 2 - ny;

  this.stage.position({ x: newX, y: newY });
  this.stage.batchDraw();

  console.log('[Mindmap] centerOnNode ✅', { nodeId, newX, newY, sw, sh, nx, ny });
}

private attachZoomHandlers(): void {
  if (!this.stage) return;

  this.stage.off('wheel.mmzoom');

  this.stage.on('wheel.mmzoom', (e) => {
    e.evt.preventDefault();

    const stage = this.stage!;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.05;
    const direction = e.evt.deltaY > 0 ? -1 : 1; // wheel up => zoom in
    let newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

    newScale = Math.max(this.cameraMin, Math.min(this.cameraMax, newScale));

    // mouse point stays fixed
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    stage.scale({ x: newScale, y: newScale });

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    stage.position(newPos);
    stage.batchDraw();

    console.log('[Mindmap] zoom ✅', { oldScale, newScale, pointer, newPos });
  });

  this.scheduleGridRedraw(); 
}
private attachPanHandlers(): void {
  if (!this.stage) return;

  const stage = this.stage;

  stage.off('mousedown.mmpan touchstart.mmpan');
  stage.off('mousemove.mmpan touchmove.mmpan');
  stage.off('mouseup.mmpan touchend.mmpan');

  let isPanning = false;
  let lastPos: { x: number; y: number } | null = null;

  stage.on('mousedown.mmpan touchstart.mmpan', (e) => {
    // ✅ SAFETY: if transformer/anchors are clicked (resize/transform), do not pan
    const t: any = e.target;
    const name = typeof t?.name === 'function' ? t.name() : '';
    const parent = typeof t?.getParent === 'function' ? t.getParent() : null;
    const isTransformerTarget =
      t === this.tr ||
      parent === this.tr ||
      name.includes('anchor') ||
      name.includes('transformer');

    if (isTransformerTarget) return;

    // ✅ pan only when clicking empty stage (background)
    if (e.target !== stage) return;

    isPanning = true;
    lastPos = stage.getPointerPosition();
    console.log('[Mindmap] pan start ✅', lastPos);
  });

  stage.on('mousemove.mmpan touchmove.mmpan', () => {
    if (!isPanning || !lastPos) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const dx = pos.x - lastPos.x;
    const dy = pos.y - lastPos.y;

    stage.position({
      x: stage.x() + dx,
      y: stage.y() + dy,
    });

    lastPos = pos;
    stage.batchDraw();
  });

  stage.on('mouseup.mmpan touchend.mmpan', () => {
    if (!isPanning) return;
    isPanning = false;
    lastPos = null;
    console.log('[Mindmap] pan end ✅');
    this.scheduleGridRedraw(); // ✅
  });
}

fitAll(): void {
  if (!this.stage) return;

  const nodes = Object.values(this.store.nodesMap());
  if (!nodes.length) return;

  const CARD_W = 220;
  const CARD_H = 120;
  const pad = 80;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + CARD_W);
    maxY = Math.max(maxY, n.y + CARD_H);
  }

  const boundsW = (maxX - minX) + pad * 2;
  const boundsH = (maxY - minY) + pad * 2;

  const sw = this.stage.width();
  const sh = this.stage.height();

  const scale = Math.min(sw / boundsW, sh / boundsH);
  const clamped = Math.max(this.cameraMin, Math.min(this.cameraMax, scale));

  this.stage.scale({ x: clamped, y: clamped });

  const x = (sw / 2) - ((minX + maxX) / 2) * clamped;
  const y = (sh / 2) - ((minY + maxY) / 2) * clamped;

  this.stage.position({ x, y });
  this.stage.batchDraw();

  console.log('[Mindmap] fitAll ✅', { scale: clamped, boundsW, boundsH, sw, sh, x, y });
}

private scheduleGridRedraw(): void {
  if (!this.stage || !this.gridLayer || !this.gridGroup) return;

  // avoid multiple redraw per frame
  this.gridDirty = true;

  if (this.gridRaf) return;
  this.gridRaf = requestAnimationFrame(() => {
    this.gridRaf = 0;
    if (!this.gridDirty) return;
    this.gridDirty = false;
    this.drawGrid();
  });
}




private drawGrid(): void {
  if (!this.stage || !this.gridLayer) return;

  const w = this.stage.width();
  const h = this.stage.height();
  const size = this.gridSize;

  this.gridLayer.destroyChildren();

  // performance
  this.gridLayer.listening(false);

  // vertical lines
  for (let x = 0; x <= w; x += size) {
    this.gridLayer.add(
      new Konva.Line({
        points: [x, 0, x, h],
        stroke: '#e5e7eb',
        strokeWidth: 1,
      })
    );
  }

  // horizontal lines
  for (let y = 0; y <= h; y += size) {
    this.gridLayer.add(
      new Konva.Line({
        points: [0, y, w, y],
        stroke: '#e5e7eb',
        strokeWidth: 1,
      })
    );
  }

  this.gridLayer.draw();
  console.log('[Mindmap] grid drawn ✅', { w, h, size });
}

private applyPendingCropFromEditor(): void {
  const dataUrl = localStorage.getItem('mm_lastCrop_dataUrl');
  const nodeId  = localStorage.getItem('mm_lastCrop_nodeId');

  if (!dataUrl || !nodeId) return;

  // ✅ THIS is the line you asked
  this.store.setSnapshotImage(nodeId as any, dataUrl);

  console.log('[Mindmap] ✅ applied pending crop to node', { nodeId });

  // optional: re-render so image shows immediately
  this.refreshDraft?.();
  this.render?.();

  // ✅ clear once applied
  localStorage.removeItem('mm_lastCrop_dataUrl');
  localStorage.removeItem('mm_lastCrop_nodeId');
}


private layoutNodeGroup(group: Konva.Group, w: number, h: number): void {
  const rect = group.findOne<Konva.Rect>('.card');
  const title = group.findOne<Konva.Text>('.title');
  const thumbBg = group.findOne<Konva.Rect>('.thumbBg');
  const img = group.findOne<Konva.Image>('.thumbImg');

  const pad = 12;

  const t = (title?.text() ?? '').trim();
  const hasTitle = t.length > 0;

  // Keep group dimensions consistent (important for transformer)
  group.width(w);
  group.height(h);

  // Card: NO border
  if (rect) {
    rect.width(w);
    rect.height(h);
    rect.strokeEnabled(false);
    rect.strokeWidth(0);
  }

  // Title positioning (only if visible)
  if (title) {
    title.x(pad);
    title.y(10);
    title.width(Math.max(0, w - pad * 2));
    title.visible(hasTitle);
  }

  // Thumb box: NO dotted border, only used for layout
  const y = hasTitle ? 40 : pad; // if no title, image area goes up
  const boxW = Math.max(0, w - pad * 2);
  const boxH = Math.max(0, h - y - pad);

  if (thumbBg) {
    thumbBg.x(pad);
    thumbBg.y(y);
    thumbBg.width(boxW);
    thumbBg.height(boxH);

    thumbBg.strokeEnabled(false);
    thumbBg.strokeWidth(0);
    thumbBg.dashEnabled(false);
    thumbBg.fillEnabled(false);
  }

  // ✅ If image exists, keep it aligned with thumb box too (resize support)
  if (img) {
    img.x(pad);
    img.y(y);
    img.width(boxW);
    img.height(boxH);
  }
}
private loadSavedForNotebook(notebookId: string): Record<string, any> | null {
  try {
    const key = `mindmap_backup_${notebookId}`; // ⚠️ key adjust to your actual save key
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const data = JSON.parse(raw);
    const nodes = data?.nodesMap ?? data?.nodes ?? null;

    // nodesMap object expected
    if (nodes && typeof nodes === 'object' && Object.keys(nodes).length > 0) {
      console.log('[MindmapUiStore] saved mindmap found ✅', { notebookId, nodes: Object.keys(nodes).length });
      return nodes;
    }
    return null;
  } catch (e) {
    console.warn('[MindmapUiStore] loadSaved failed', e);
    return null;
  }
}


}
