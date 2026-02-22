import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import Konva from 'konva';
import { WorkspaceStoreService } from '../../../core/store/workspace-store.service';
import { Id } from '../../../core/models/workspace.models';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';


type HistoryAction =
  | { type: 'ADD'; nodeJson: any }
  | { type: 'DELETE'; nodeJson: any }
  | { type: 'TRANSFORM'; nodeId: string; before: any; after: any };


type Tool =
  | 'select'
  | 'text'
  | 'image'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'nodeImage'
  | 'lasso'; // ✅ add this
type ShapeTool = 'rect' | 'circle' | 'diamond' | 'arrow';
type EditingCtx = {
  nodeId: string;
  pageId: string;
  notebookId?: string;
};



@Component({
  selector: 'app-page-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './page-editor.component.html',
  styleUrl: './page-editor.component.css',
})
export class PageEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('stageHost', { static: true })
  stageHost!: ElementRef<HTMLDivElement>;
  // -----------------------------------
  @ViewChild('nodeImageInput', { static: false })
  nodeImageInput!: ElementRef<HTMLInputElement>;


  private workspaceStore = inject(WorkspaceStoreService);
  private router = inject(Router);


@HostListener('window:keydown', ['$event'])
onKeyDown(e: KeyboardEvent): void {
  const key = e.key;

  // ✅ अगर text edit चल रहा है तो undo/delete prevent
  if (this.editingLock) return;

  const isMac = navigator.platform.toLowerCase().includes('mac');
  const mod = isMac ? e.metaKey : e.ctrlKey; // Cmd (mac) or Ctrl (win)

  // =============================
  // ✅ UNDO / REDO
  // =============================
  if (mod && key.toLowerCase() === 'z') {
    e.preventDefault();

    // Ctrl+Shift+Z => Redo (industry standard)
    if (e.shiftKey) {
      this.redo();
    } else {
      this.undo();
    }
    return;
  }

  // Ctrl+Y => Redo (Windows standard)
  if (!isMac && mod && key.toLowerCase() === 'y') {
    e.preventDefault();
    this.redo();
    return;
  }

  // =============================
  // ✅ DELETE selection
  // =============================
  if (key === 'Delete' || key === 'Backspace') {
    e.preventDefault();
    this.deleteSelection(); // ✅ existing method
    return;
  }
}



  @ViewChild('canvasImageInput') canvasImageInput!: ElementRef<HTMLInputElement>;

constructor(
  private route: ActivatedRoute,
  
) {}



public editingCtx: EditingCtx | null = null;

// autosave controls





  // ===== Konva core
  private stage?: Konva.Stage;

  private bgLayer?: Konva.Layer;
  private gridLayer?: Konva.Layer;
  private uiLayer!: Konva.Layer;
  private fgLayer?: Konva.Layer;
  private lastLassoPoints: number[] = [];  // stage coords (x1,y1,x2,y2...)
   private lastLassoBBox: { x: number; y: number; width: number; height: number } | null = null;

   

  

  private nodeLayer?: Konva.Layer; // ✅ items layer (shapes/nodes)
  private tr?: Konva.Transformer;  
     // single (already)
  private multiTr!: Konva.Transformer;   // ✅ multi-select transformer

  // ✅ transformer for resize
  private selectedNode?: Konva.Node;
  private multiSelection: Konva.Node[] = [];

  private bgRect?: Konva.Rect;
  private gridLines: Konva.Line[] = [];
  private gridSize = 40;
  private editingLock = false;
  private selectedNodes: Konva.Node[] = [];
  private lastMultiSelection: Konva.Node[] = [];

  public toolColor = '#111111'; 
  // ===== UI state (already working)
  tool: Tool = 'select';
  thickness = 6;
  fontFamily = 'Inter';
  fontSize = 12;
  shapeTool: ShapeTool | null = null;

  private lassoLine: Konva.Line | null = null;
  private isLassoing = false;
  private isDrawing = false;
private currentLine?: Konva.Line;

  // ===== Zoom / Pan
  private scaleBy = 1.05;
  private isPanning = false;
  private panStart = { x: 0, y: 0 };

  private isErasing = false;
private lastEraseTs = 0;
// ===================================



private undoStack: HistoryAction[] = [];
private redoStack: HistoryAction[] = [];
private isApplyingHistory = false; // ✅


private autoSaveTimer: any = null;
private autoSaveDelayMs = 800;
private hasDirtyChanges = false;



  // ===================================

    isEditingText = false;

  editUi = {
    left: 0,
    top: 0,
    width: 200,
    height: 80,
    value: '',
    fontFamily: 'Inter',
    fontSize: 14,
  };

  private editingTextNode?: Konva.Text;
  private editingGroup?: Konva.Group;
  private editingBox?: Konva.Rect;



  // -----------------------------------
  // Lifecycle
  // -----------------------------------
  private destroy$ = new Subject<void>();
  private destroyRef = inject(DestroyRef);
  private ignoreAutoSave = false;


private pendingLoad = false;
private lastLoadedPageId: string | null = null; // ✅ Id issue fixed

ngOnInit(): void {
  // ✅ 1) route param read (exact key: pageId)
  const routePageId = this.route.snapshot.paramMap.get('pageId') ?? '';

  console.log('[Editor] routePageId ✅', routePageId, {
    url: this.router.url,
    paramKeys: Array.from(this.route.snapshot.paramMap.keys),
  });

  if (!routePageId) {
    console.error('[Editor] ❌ routePageId missing. Route is editor/:pageId');
    return;
  }

  // ✅ 2) set active page in store (must)
  this.workspaceStore.setActivePage(routePageId as any);

  console.log('[Editor] setActivePage(route) ✅', {
    routePageId,
    storeActivePageId: this.workspaceStore.snapshot?.activePageId,
  });

  // ✅ 3) subscribe to state changes safely + load content when page changes
  this.workspaceStore.state$
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((s) => {
      const active = s?.activePageId;
      if (!active) return;

      if (active === this.lastLoadedPageId) return;
      this.lastLoadedPageId = active;

      console.log('[Editor] activePage changed ✅', {
        activePageId: active,
        stageReady: !!this.stage,
        routePageId,
      });

      if (this.stage) this.loadFromActivePage();
      else this.pendingLoad = true; // stage बनते ही load होगा
    });
}

public async ngAfterViewInit(): Promise<void> {
  console.log('[Editor] ngAfterViewInit ✅');

  // 1) stage + layers first
  this.createStage();
  this.createLayers();
  this.drawBackground();
  this.drawGrid();

  // 2) transformer before load (so restore nodes can bind safely)
  this.setupTransformer();

  // 3) bindings
  this.bindTransformerImageFix();
  this.attachSelect();
  this.attachDelete();
  this.attachZoom();
  this.attachPan();
  this.attachPenHandlers();
  this.bindAutoSaveEvents();
  this.bindPasteHandlers();

  // 4) single pending load (ONLY once)
  if (this.pendingLoad) {
    this.pendingLoad = false;
    console.log('[Editor] pendingLoad -> loadFromActivePage ✅');

    try {
      // ✅ if your loadFromActivePage() is async now
      await (this as any).loadFromActivePage();
    } catch (e) {
      console.warn('[Editor] loadFromActivePage failed ⚠️', e);
    }
  } else {
    console.log('[Editor] pendingLoad=false (skip load) ℹ️');
  }
}


  ngOnDestroy(): void {
      this.destroy$.next();
      this.destroy$.complete();
    console.log('[Editor] destroy ✅');
    try {
      this.clearGrid();
      this.stage?.destroy();
      this.stage = undefined;
      console.log('[Editor] stage destroyed ✅');
    } catch (e) {
      console.log('[Editor] destroy error ❌', e);
    }
  }

  //.............................

  private onPanKeyUp?: (e: KeyboardEvent) => void;

  // -----------------------------------
  // UI handlers (logs)
  // -----------------------------------
setTool(t: any): void {
  this.tool = t;

  if (t === 'image') {
    console.log('[IMG] Image tool selected ✅');
    this.canvasImageInput?.nativeElement?.click();
  }
}
// -----------------------------------
onCanvasImagePicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  console.log('[IMG] file picked ✅', file?.name);

  if (!file) return;

  this.addImageToNodeLayer(file);

  // ✅ same file re-select allow
  input.value = '';
}

private addImageToNodeLayer(file: File): void {
  const reader = new FileReader();

  reader.onload = () => {
    const img = new Image();

    img.onload = () => {
      if (!this.stage || !this.nodeLayer) return;

      const startW = Math.max(150, img.width * 0.5);
      const startH = Math.max(150, img.height * 0.5);

      const x = (this.stage.width() - startW) / 2;
      const y = (this.stage.height() - startH) / 2;

      const src = String(reader.result);

      const kImg = new Konva.Image({
        x,
        y,
        image: img,
        width: startW,
        height: startH,
        draggable: true,
        name: 'item image',
        id: this.uid('image'),
      });

      kImg.setAttr('src', src);

      kImg.hitStrokeWidth(10);

      this.nodeLayer.add(kImg);
      this.nodeLayer.draw();


      console.log('[IMG] ✅ Image added to nodeLayer', kImg);
    };

    img.src = reader.result as string;
  };

  reader.readAsDataURL(file);
}


//-----------------------------------
  onThicknessInput(value: string): void {
    this.thickness = Number(value);
    console.log('[UI] thickness ✅', this.thickness);
  }

public onFontFamilyChange(val: string): void {
  this.fontFamily = val;
  console.log('[UI] fontFamily ✅', val);
  this.applyTextStyleToSelection();
}

 public onFontSizeChange(val: string): void {
  const n = Number(val);
  this.fontSize = isNaN(n) ? 12 : n;
  console.log('[UI] fontSize ✅', this.fontSize);
  this.applyTextStyleToSelection();
}

  setShapeTool(s: ShapeTool): void {
    this.shapeTool = s;
    this.tool = 'select';
    console.log('[UI] shape selected ✅', this.shapeTool);
  }

  // -----------------------------------
  // Stage & Layers
  // -----------------------------------
  private createStage(): void {
    const host = this.stageHost.nativeElement;
    const w = host.clientWidth;
    const h = host.clientHeight;

    console.log('[Editor] host size', { w, h });

    this.stage = new Konva.Stage({
      container: host,
      width: w,
      height: h,
    });

    console.log('[Editor] stage created ✅');
  }

private createLayers(): void {
  if (!this.stage) return;

  this.bgLayer = new Konva.Layer({ listening: true });
  this.gridLayer = new Konva.Layer({ listening: false }); // grid not clickable
  this.nodeLayer = new Konva.Layer({ listening: true });  // shapes/images/text (items)
  this.fgLayer = new Konva.Layer({ listening: true });    // ✅ pen/highlighter by default
  this.uiLayer = new Konva.Layer({ listening: true });    // ✅ transformer always on top

  // ✅ ORDER matters: bg -> grid -> node -> fg -> ui
  this.stage.add(this.bgLayer);
  this.stage.add(this.gridLayer);
  this.stage.add(this.nodeLayer);
  this.stage.add(this.fgLayer);
  this.stage.add(this.uiLayer);

  console.log('[LAYERS] added ✅', {
    bg: !!this.bgLayer,
    grid: !!this.gridLayer,
    node: !!this.nodeLayer,
    fg: !!this.fgLayer,
    ui: !!this.uiLayer,
  });
}
// -----------------------------------
  // -----------------------------------  
  // Transformer setup

private setupTransformer(): void {
  if (!this.uiLayer) return;
  if (this.tr) return;

  this.tr = new Konva.Transformer({
    rotateEnabled: false,
    keepRatio: false,
    enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    boundBoxFunc: (oldBox, newBox) => {
      if (newBox.width < 20 || newBox.height < 20) return oldBox;
      return newBox;
    },
  });

  this.uiLayer.add(this.tr);
  this.uiLayer.draw();

  console.log('[TR] ready ✅ (uiLayer)');

  // image resize fix (scale -> width/height) - your existing
  this.bindTransformerImageFix();
  this.bindTransformerTextFix();
}

private bindTransformerTextFix(): void {
  if (!this.tr) return;

  // avoid duplicate binding
  this.tr.off('transformend.textfix');

  this.tr.on('transformend.textfix', () => {
    const nodes = this.tr?.nodes() || [];
    if (!nodes.length) return;

    for (const n of nodes) {
      // ✅ Case 1: Group text item (rect + label)
      if (n instanceof Konva.Group && (n.name() || '').includes('item group')) {
        this.applyGroupTextResize(n);
        continue;
      }

      // ✅ Case 2: standalone Konva.Text
      if (n instanceof Konva.Text && (n.name() || '').includes('item')) {
        this.applyStandaloneTextResize(n);
        continue;
      }
    }

    this.nodeLayer?.batchDraw();
    this.fgLayer?.batchDraw();
    this.uiLayer?.batchDraw();

    this.markDirtyAndScheduleSave('text-resize');
  });
}
private applyGroupTextResize(g: Konva.Group): void {
  const box = g.findOne('.box') as Konva.Rect | undefined;
  const label = g.findOne('.label') as Konva.Text | undefined;
  if (!box || !label) return;

  const newW = Math.max(60, box.width() * g.scaleX());
  const newH = Math.max(40, box.height() * g.scaleY());

  // ✅ reset group scale
  g.scaleX(1);
  g.scaleY(1);

  // ✅ update box real size
  box.width(newW);
  box.height(newH);

  // ✅ update label wrap area
  const pad = 10;
  label.x(pad);
  label.y(pad);
  label.width(Math.max(20, newW - pad * 2));
  label.height(Math.max(20, newH - pad * 2));
  label.wrap('word');
  label.ellipsis(false);
}
private applyStandaloneTextResize(t: Konva.Text): void {
  const newW = Math.max(60, t.width() * t.scaleX());
  const newH = Math.max(30, t.height() * t.scaleY());

  t.scaleX(1);
  t.scaleY(1);

  t.width(newW);
  t.height(newH);
  t.wrap('word');
  t.ellipsis(false);
}


private startDraw(pos: { x: number; y: number }): void {
  if (!this.stage || !this.nodeLayer) return;

  const isHighlighter = this.tool === 'highlighter';

  // ✅ common stroke settings
const strokeColor = this.toolColor || '#000000';

  // ✅ thickness: highlighter thicker
  const strokeW = isHighlighter ? Math.max(12, this.thickness || 12) : (this.thickness || 6);

  // ✅ opacity: highlighter semi transparent
  const op = isHighlighter ? 0.30 : 1;

  // ✅ create new line
  this.currentLine = new Konva.Line({
    points: [pos.x, pos.y],
    stroke: strokeColor,
    strokeWidth: strokeW,
    lineCap: 'round',
    lineJoin: 'round',
    tension: 0.3,

    // ✅ important
    opacity: op,

    // ✅ marker-like blending (optional but looks great)
    // if you don't like it, comment next line
    globalCompositeOperation: isHighlighter ? 'multiply' : 'source-over',

    draggable: true,
    name: 'item ink',     // ✅ keep same selector logic
  });

  // ✅ tag for restore/logic
  this.currentLine.setAttr('isHighlighter', isHighlighter);

  this.nodeLayer.add(this.currentLine);
  this.nodeLayer.batchDraw();

  console.log(isHighlighter ? '[HL] start ✅' : '[PEN] start ✅', { strokeW, op });
}




/** ✅ helper: transformer config based on selection */
private syncTransformerForSelection(nodes: Konva.Node[]) {
  if (!this.tr) return;

  // default
  this.tr.keepRatio(false);
  this.tr.enabledAnchors(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

  // if single image => keep ratio true
  if (nodes.length === 1 && nodes[0].getClassName?.() === 'Image') {
    this.tr.keepRatio(true);
  }

  this.tr.nodes(nodes);
  this.tr.getLayer()?.batchDraw();
}




  
//
private setupTransformer1(): void {
  if (!this.uiLayer) return;

  // ✅ अगर पहले से transformer बना है तो दुबारा मत बनाओ
  if (this.tr) return;

  this.tr = new Konva.Transformer({
    rotateEnabled: false,
    keepRatio: false, // default (Text/Rect के लिए). Image select होने पर हम true कर देंगे
    enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    boundBoxFunc: (oldBox, newBox) => {
      if (newBox.width < 20 || newBox.height < 20) return oldBox;
      return newBox;
    },
  });

  // ✅ add to ui layer
  this.uiLayer.add(this.tr);
  this.uiLayer.draw();

  console.log('[TR] ready ✅ (uiLayer)');

  // ✅ IMPORTANT: transformend fix for Image (scale → width/height)
  this.bindTransformerImageFix();
}
// -----------------------------------

  private drawBackground(): void {
    if (!this.stage || !this.bgLayer) return;

    const w = this.stage.width();
    const h = this.stage.height();

    this.bgRect?.destroy();

    this.bgRect = new Konva.Rect({
      x: 0,
      y: 0,
      width: w,
      height: h,
      fill: '#ffffff',
      listening: false,
    });

    this.bgLayer.add(this.bgRect);
    this.bgLayer.draw();

    console.log('[Editor] background drawn ✅');
  }

  // -----------------------------------
  // Grid
  // -----------------------------------
  private clearGrid(): void {
    this.gridLines.forEach((l) => l.destroy());
    this.gridLines = [];
  }

private drawGrid(): void {
  if (!this.stage || !this.gridLayer) return;

  const width = this.stage.width();
  const height = this.stage.height();
  const size = this.gridSize || 40;

  // ✅ clear old grid safely
  this.gridLayer.destroyChildren();
  this.gridLines = [];

  // ===== Vertical lines =====
  for (let x = 0; x <= width; x += size) {
    const v = new Konva.Line({
      points: [x, 0, x, height],
      stroke: '#e5e7eb',
      strokeWidth: 1,
      listening: false,
    });

    this.gridLayer.add(v);
    this.gridLines.push(v);
  }

  // ===== Horizontal lines =====
  for (let y = 0; y <= height; y += size) {
    const h = new Konva.Line({
      points: [0, y, width, y],
      stroke: '#e5e7eb',
      strokeWidth: 1,
      listening: false,
    });

    this.gridLayer.add(h);
    this.gridLines.push(h);
  }

  this.gridLayer.batchDraw();

  console.log('[GRID] drawn ✅', {
    width,
    height,
    size,
    lines: this.gridLines.length,
  });
}


  // -----------------------------------
  // ✅ Step-7.1: Add shapes (Rect node has Text)
  // -----------------------------------
  addShape(type: ShapeTool): void {
    if (!this.stage || !this.nodeLayer) {
      console.log('[ADD] blocked ❌ stage/nodeLayer missing');
      return;
    }

    const center =
      (this.stage as any).getRelativePointerPosition?.() ??
      this.stage.getPointerPosition() ??
      { x: this.stage.width() / 2, y: this.stage.height() / 2 };

    console.log('[ADD] shape request ✅', { type, center });

    // ---- Rect = group with text (editable container)
    if (type === 'rect') {
      const group = new Konva.Group({
        x: center.x - 120,
        y: center.y - 70,
        draggable: true,
        name: 'item',
      });

      const box = new Konva.Rect({
        x: 0,
        y: 0,
        width: 240,
        height: 140,
        fill: '#eef2ff',
        stroke: '#2563eb',
        strokeWidth: 2,
        cornerRadius: 12,
      });

      const text = new Konva.Text({
        x: 14,
        y: 14,
        width: 240 - 28,
        height: 140 - 28,
        text: 'Double click to edit',
        fontFamily: this.fontFamily,
        fontSize: this.fontSize,
        fill: this.toolColor,
        wrap: 'word',
        align: 'left',
      });

      // ✅ selection marker
      text.name('item text label');  // important ✅

// ✅ unique id for undo/redo
      text.id(this.uid('text'));  // important ✅
      box.name('box');
      text.name('label');

      group.add(box);
      group.add(text);

      group.on('dragstart', () => console.log('[DRAG] start rect-group'));
      group.on('dragend', () =>
        console.log('[DRAG] end rect-group', { x: group.x(), y: group.y() })
      );

      // ✅ resize normalize
      group.on('transformend', () => {
        const scaleX = group.scaleX();
        const scaleY = group.scaleY();

        const newW = Math.max(80, box.width() * scaleX);
        const newH = Math.max(50, box.height() * scaleY);

        group.scale({ x: 1, y: 1 });
        box.size({ width: newW, height: newH });
        text.size({ width: newW - 28, height: newH - 28 });

        const img = group.findOne('.nodeImage') as Konva.Image | undefined;
        if (img) {
          img.size({ width: newW, height: newH });
        console.log('[IMG] resized with node ✅', { newW, newH });
     }

        console.log('[RESIZE] rect-group ✅', { newW, newH });
        this.nodeLayer?.batchDraw();
      });

      group.on('dblclick dbltap', () => {
      console.log('[EDIT] dblclick rect-group ✅');
      this.startEditText(group);
      });

      this.nodeLayer.add(group);
      this.nodeLayer.draw();

      console.log('[ADD] rect-group added ✅');
      this.selectNode(group);
      return;
    }

    // ---- Other shapes simple (for now)
    let shape!: Konva.Shape;

    if (type === 'circle') {
      shape = new Konva.Circle({
        x: center.x,
        y: center.y,
        radius: 60,
        fill: '#ecfeff',
        stroke: '#0891b2',
        strokeWidth: 2,
        draggable: true,
        name: 'item',
      });
    } else if (type === 'diamond') {
      shape = new Konva.RegularPolygon({
        x: center.x,
        y: center.y,
        sides: 4,
        radius: 70,
        rotation: 45,
        fill: '#fef9c3',
        stroke: '#ca8a04',
        strokeWidth: 2,
        draggable: true,
        name: 'item',
      });
    } else {
      shape = new Konva.Arrow({
        points: [center.x - 80, center.y, center.x + 80, center.y],
        stroke: '#111827',
        strokeWidth: 6,
        pointerLength: 14,
        pointerWidth: 14,
        draggable: true,
        name: 'item',
      });
    }

    shape.on('dragstart', () => console.log('[DRAG] start', type));
    shape.on('dragend', () =>
      console.log('[DRAG] end', type, { x: shape.x(), y: shape.y() })
    );
    shape.on('transformend', () =>
      console.log('[RESIZE] end', type, shape.getClientRect())
    );

    this.nodeLayer.add(shape);
    this.nodeLayer.draw();

    console.log('[ADD] shape added ✅', type);
    this.selectNode(shape);
  }

  // -----------------------------------
  // Selection + Transformer
  // -----------------------------------
private selectNode(node: Konva.Node | null): void {
  if (!this.tr) return;

  // ✅ node null ho to clear selection
  if (!node) {
    this.tr.nodes([]);
    this.tr.getLayer()?.batchDraw();
    console.log('[SELECT] cleared ✅');
    return;
  }
if (node.getClassName() === 'Text') {
  this.syncTextToolbarFromSelection(node);
}
  // ✅ node present ho tabhi sync
  this.syncTextToolbarFromSelection(node);

  this.tr.nodes([node]);
  this.tr.getLayer()?.batchDraw();
  console.log('[SELECT] node selected ✅', node.getClassName(), node.name());
}
private getSelectedTextNode(): Konva.Text | null {
  const node = this.selectedNode;
  if (!node) return null;

  if (node instanceof Konva.Text) return node;

  if (node instanceof Konva.Group) {
    const t = node.findOne('.label');
    return (t instanceof Konva.Text) ? t : null;
  }

  return null;
}

// -----------------------------------

private attachSelect(): void {
  if (!this.stage) {
    console.log('[SELECT] ❌ stage not ready');
    return;
  }

  const stage = this.stage;

  // ✅ remove old handlers (avoid duplicates)
  stage.off('mousedown.select touchstart.select');
  stage.off('mousemove.select touchmove.select');
  stage.off('mouseup.select touchend.select');

  // -----------------------------
  // helper: item root finder
  // -----------------------------
const getItemRoot = (target: Konva.Node): Konva.Node | null => {
  if (!target) return null;

  // ✅ If clicked inside a group, select the group
  const g = target.findAncestors((n: Konva.Node) =>
    n.getClassName?.() === 'Group' && (n.name?.() || '').includes('item group')
  , true)?.[0] as Konva.Node | undefined;

  if (g) return g;

  // ✅ else normal single item selection
  const nm = target.name?.() || '';
  if (nm.includes('item')) return target;

  const anc = target.findAncestors((n: Konva.Node) => {
    const nName = n.name?.();
    return !!nName && nName.includes('item');
  }, true)?.[0] as Konva.Node | undefined;

  return anc ?? null;
};


  // -----------------------------
  // ✅ START: mousedown/touchstart
  // -----------------------------
  stage.on('mousedown.select touchstart.select', (evt) => {
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const target = evt.target as Konva.Node;

    console.log('[STAGE] down ✅', {
      tool: this.tool,
      targetClass: target?.getClassName?.(),
      targetName: target?.name?.(),
      pos,
    });

    // ✅ ignore transformer handles/anchors
    const isTransformer = target?.getClassName?.() === 'Transformer';
    const isTransformerChild =
      target?.getParent?.()?.getClassName?.() === 'Transformer';

    if (isTransformer || isTransformerChild) {
      console.log('[SELECT] ignore transformer handle ✅');
      return;
    }

    // ✅ LASSO start
    if (this.tool === 'lasso') {
      this.isLassoing = true;

      this.lassoLine?.destroy();
      this.lassoLine = new Konva.Line({
        points: [pos.x, pos.y],
        stroke: '#2563eb',
        strokeWidth: 1,
        dash: [6, 4],
        closed: false,
        listening: false,
      });

      this.uiLayer?.add(this.lassoLine);
      this.uiLayer?.batchDraw();

      console.log('[LASSO] start ✅', pos);
      return;
    }

    // ✅ ERASER start (drag erase)
    if (this.tool === 'eraser') {
      this.isErasing = true;
      this.eraseAtPointer();
      return;
    }

    // ✅ TEXT tool: empty click => add new text
    if (this.tool === 'text') {
      const item = getItemRoot(target);
      if (item) {
        console.log('[TEXT] click on item -> no new text ✅');
        this.setSelection(item);
        return;
      }

      console.log('[TEXT] add request ✅', pos);
      this.addTextAt(pos);
      return;
    }

    // ✅ SELECT tool: normal selection
    if (this.tool === 'select') {
      if (target === stage) {
        this.setSelection(null);
        console.log('[SELECT] clicked stage => clear ✅');
        return;
      }

      const item = getItemRoot(target);
      if (item) {
        this.setSelection(item);
        console.log('[SELECT] node selected ✅', item.getClassName(), item.name());
        return;
      }

      this.setSelection(null);
      console.log('[SELECT] non-item clicked => clear ✅');
      return;
    }

    // ✅ other tools: empty click clears selection (optional UX)
    if (target === stage) {
      this.setSelection(null);
      console.log('[TOOL] clicked stage => clear selection ✅');
    }
  });

  // -----------------------------
  // ✅ MOVE: mousemove/touchmove
  // -----------------------------
  stage.on('mousemove.select touchmove.select', () => {
    // ✅ LASSO draw
    if (this.tool === 'lasso' && this.isLassoing && this.lassoLine) {
      const pos = stage.getPointerPosition();
      if (!pos) return;

      const pts = this.lassoLine.points();
      this.lassoLine.points([...pts, pos.x, pos.y]);
      this.uiLayer?.batchDraw();
      return;
    }

    // ✅ drag eraser
    if (this.tool === 'eraser' && this.isErasing) {
      this.eraseAtPointer();
    }
  });

  // -----------------------------
  // ✅ END: mouseup/touchend
  // -----------------------------
stage.on('mouseup.select touchend.select', () => {
  if (this.tool === 'lasso' && this.isLassoing && this.lassoLine) {
    this.isLassoing = false;

    const poly = this.lassoLine.points();

    this.lassoLine.destroy();
    this.lassoLine = null;

    if (poly.length >= 6) {
      this.selectNodesInsidePolygon(poly);
    }

    this.uiLayer.batchDraw();
    this.markDirtyAndScheduleSave('lasso-end');
    console.log('[LASSO] end ✅');
    return;
  }

  if (this.tool === 'eraser') {
    this.isErasing = false;
     this.markDirtyAndScheduleSave('eraser-end');
  }


});
}


//
  // -----------------------------------
private getBBoxFromPoints(points: number[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // little padding so edges don’t cut
  const pad = 4;
  return { x: minX - pad, y: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 };
}

// -----------------------------------
private makeCroppedGroupFromSelection(): Konva.Group | null {
  if (!this.stage || !this.nodeLayer) return null;
  if (!this.selectedNodes || this.selectedNodes.length === 0) {
    console.log('[CROP] ❌ nothing selected');
    return null;
  }

  const bbox = this.lastLassoBBox;
  if (!bbox) {
    console.log('[CROP] ❌ bbox missing (lasso end pe store karo)');
    return null;
  }

  // ✅ new group at bbox origin
  const g = new Konva.Group({
    x: bbox.x,
    y: bbox.y,
    draggable: true,
    name: 'item cropGroup',
    id: this.uid('crop'),
  });

  // ✅ clip to bbox rectangle (phase-2 baseline)
  g.clipFunc((ctx) => {
    ctx.beginPath();
    ctx.rect(0, 0, bbox.width, bbox.height);
    ctx.closePath();
  });

  // ✅ move nodes into group and rebase coords
  const nodes = [...this.selectedNodes];

  nodes.forEach((n) => {
    // stage coords -> group local coords
    const abs = n.getAbsolutePosition(this.stage);
    n.moveTo(g);
    n.position({ x: abs.x - bbox.x, y: abs.y - bbox.y });
  });

  // add group to correct layer
  this.nodeLayer.add(g);
  this.nodeLayer.batchDraw();
  this.fgLayer?.batchDraw();

  // after grouping: select group only
  this.setSelection(g);
  console.log('[CROP] ✅ group created', { nodes: nodes.length, bbox });

  return g;
}





  //


private attachSelect1(): void {
  if (!this.stage) {
    console.log('[SELECT] ❌ stage not ready');
    return;
  }

  const stage = this.stage;

  // ✅ remove old handler first (avoid duplicate listeners)
  stage.off('mousedown.select touchstart.select');

  stage.on('mousedown.select touchstart.select', (evt) => {
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const target = evt.target as Konva.Node;

    console.log('[STAGE] down ✅', {
      tool: this.tool,
      targetClass: target?.getClassName?.(),
      targetName: target?.name?.(),
      pos,
    });

    // ✅ 1) Ignore transformer handles/anchors
    const isTransformer = target?.getClassName?.() === 'Transformer';
    const isTransformerChild =
      target?.getParent?.()?.getClassName?.() === 'Transformer';

    if (isTransformer || isTransformerChild) {
      console.log('[SELECT] ignore transformer handle ✅');
      return;
    }

    // ✅ helper: item root finder
    // 'item' should be in name: e.g. "item text", "item image", "item shape"
    const getItemRoot = (): Konva.Node | null => {
      // 1) if clicked node itself is item
      if (target?.name?.() && target.name().includes('item')) return target;

      // 2) otherwise find ancestor with name containing item
      const anc = target.findAncestors((n: Konva.Node) => {
        const nm = n.name?.();
        return !!nm && nm.includes('item');
      }, true)?.[0];

      return (anc as Konva.Node) || null;
    };

    const item = getItemRoot();
    const isEmpty = target === stage;

    // =========================
    // ✅ 2) TEXT tool behavior
    // =========================
    if (this.tool === 'text') {
      // item clicked => no new text, सिर्फ select
      if (item) {
        console.log('[TEXT] click on item -> no new text ✅');
        this.setSelection(item);
        return;
      }

      //for eraser tool
      

      // empty click => create new text
      console.log('[TEXT] add request ✅', pos);
      this.addTextAt(pos); // ✅ your existing function
      return;
    }
   // for eraser tool
 // ✅ ERASER tool: click item => delete
// ✅ ERASER tool: click item => delete (ROBUST)
if (this.tool === 'eraser') {
const pos2 = stage.getPointerPosition();
if (!pos2) return;

// ✅ get all intersections under pointer
const hits = stage.getAllIntersections(pos2) as Konva.Node[];

console.log(
  '[ERASER] hits ✅',
  hits.map(h => `${h.getClassName?.()} ${h.name?.()}`)
);

if (!hits || hits.length === 0) return;

// ✅ pick first meaningful item (skip grid/bg/transformer)
const hit = hits.find((h) => {
  const cls = h.getClassName?.();
  if (cls === 'Transformer') return false;
  const pCls = h.getParent?.()?.getClassName?.();
  if (pCls === 'Transformer') return false;

  const nm = h.name?.() || '';
  return nm.includes('item');
}) || null;

if (!hit) {
  console.log('[ERASER] ❌ no item hit');
  return;
}

// ✅ delete
hit.destroy();
this.setSelection(null);

this.nodeLayer?.batchDraw();
this.fgLayer?.batchDraw();
this.uiLayer?.batchDraw();

console.log('[ERASER] deleted ✅', hit.getClassName(), hit.name());
return;



}

    // =========================
    // ✅ 3) SELECT tool behavior
    // =========================
    if (this.tool === 'select') {
      if (isEmpty) {
        this.setSelection(null);
        console.log('[SELECT] clicked stage => clear ✅');
        return;
      }

      if (item) {
        this.setSelection(item);
        console.log('[SELECT] node selected ✅', item.getClassName(), item.name());
        return;
      }

      this.setSelection(null);
      console.log('[SELECT] non-item clicked => clear ✅');
      return;
    }

    // =========================
    // ✅ 4) IMAGE tool behavior
    // =========================
    if (this.tool === 'image') {
      // image tool में click selection allow (resize transformer दिखेगा)
      if (isEmpty) {
        this.setSelection(null);
        console.log('[IMG] clicked stage => clear ✅');
        return;
      }

      if (item) {
        this.setSelection(item);
        console.log('[IMG] item selected ✅', item.getClassName(), item.name());
        return;
      }

      // clicked non-item => clear
      this.setSelection(null);
      console.log('[IMG] non-item clicked => clear ✅');
      return;
    }

    // =========================
    // ✅ 5) Other tools (pen/highlighter/eraser etc.)
    // =========================
    // आम तौर पर draw tools में selection change नहीं करते,
    // लेकिन empty click पे selection clear करना अच्छा UX है
    if (isEmpty) {
      this.setSelection(null);
      console.log('[TOOL] clicked stage => clear selection ✅');
    }
  });

  console.log('[Editor] unified stage handler ready ✅');
}




 private attachDelete(): void {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;

    if (!this.selectedNode) {
      console.log('[DELETE] ❌ nothing selected');
      return;
    }

    // safety: don't delete stage or layers
    if (this.selectedNode === this.stage) return;

    console.log('[DELETE] deleting ✅', {
      class: this.selectedNode.getClassName(),
      name: this.selectedNode.name(),
      id: this.selectedNode.id(),
    });

    this.selectedNode.destroy();
    this.selectNode(null);

    this.nodeLayer?.batchDraw();
    this.uiLayer?.batchDraw();
  });

  console.log('[Editor] delete key handler ready ✅');
}

private setSelection(node: Konva.Node | null): void {
  // ✅ single selection
  this.selectedNode = node ?? undefined;

  // ✅ keep array in sync (optional, for future multi-select)
  this.selectedNodes = node ? [node] : [];

  // ✅ transformer must exist
  if (!this.tr) return;

  // ✅ clear selection
  if (!node) {
    this.tr.nodes([]);
    this.uiLayer?.batchDraw();
    console.log('[SELECT] cleared ✅');
    return;
  }

  // ✅ केवल Text के लिए toolbar sync (image/shape select पे नहीं)
  if (node.getClassName() === 'Text') {
    this.syncTextToolbarFromSelection(node);
  }

  // ✅ Image के लिए aspect ratio ON, बाकी के लिए OFF
  if (node.getClassName() === 'Image') {
    this.tr.keepRatio(true);
  } else {
    this.tr.keepRatio(false);
  }

  // ✅ attach transformer
  this.tr.nodes([node]);
  this.uiLayer?.batchDraw();

  console.log(
    '[SELECT] node selected ✅',
    node.getClassName(),
    node.name(),
    'keepRatio=',
    this.tr.keepRatio()
  );
}


  // -----------------------------------
  // Zoom
  // -----------------------------------
  private attachZoom(): void {
    if (this.editingLock) return;
    if (!this.stage) return;

    this.stage.on('wheel', (e) => {
      e.evt.preventDefault();

      const oldScale = this.stage!.scaleX();
      const pointer = this.stage!.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - this.stage!.x()) / oldScale,
        y: (pointer.y - this.stage!.y()) / oldScale,
      };

      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const newScale =
        direction > 0 ? oldScale * this.scaleBy : oldScale / this.scaleBy;

      this.stage!.scale({ x: newScale, y: newScale });

      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };

      this.stage!.position(newPos);
      this.stage!.batchDraw();

      console.log('[Editor] zoom ✅', newScale.toFixed(2));
    });
  }

  // -----------------------------------
  // Pan (Space + Drag)
  // -----------------------------------
 // -----------------------------------
private attachPan(): void {
  if (!this.stage) return;

  const stage = this.stage;

  // ✅ avoid duplicate stage listeners
  stage.off('mousedown.pan touchstart.pan');
  stage.off('mousemove.pan touchmove.pan');
  stage.off('mouseup.pan touchend.pan');

  // ✅ avoid duplicate window listeners (if attachPan called again)
  // NOTE: we store refs so remove works
  if ((this as any)._panKeyDown) window.removeEventListener('keydown', (this as any)._panKeyDown);
  if ((this as any)._panKeyUp) window.removeEventListener('keyup', (this as any)._panKeyUp);

  const shouldIgnoreSpace = (e: KeyboardEvent) => {
    // ✅ while editing text / typing inside any input/textarea, don't pan
    const el = document.activeElement as HTMLElement | null;
    const tag = el?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    if ((el as any)?.isContentEditable) return true;
    if (this.isEditingText) return true; // your existing flag
    return false;
  };

  // ✅ keydown handler
  (this as any)._panKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    if (this.editingLock) return;
    if (shouldIgnoreSpace(e)) return;

    // ✅ prevent page scroll on space
    e.preventDefault();

    this.isPanning = true;
    stage.container().style.cursor = 'grab';
    console.log('[Editor] pan mode ON ✅');
  };

  // ✅ keyup handler
  (this as any)._panKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;

    this.isPanning = false;
    stage.container().style.cursor = 'default';
    console.log('[Editor] pan mode OFF ✅');
  };

  window.addEventListener('keydown', (this as any)._panKeyDown);
  window.addEventListener('keyup', (this as any)._panKeyUp);

  // ✅ START pan
  stage.on('mousedown.pan touchstart.pan', () => {
    if (this.editingLock) return;
    if (!this.isPanning) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    this.panStart = pos;
    console.log('[PAN] start ✅', this.panStart);
  });

  // ✅ MOVE pan
  stage.on('mousemove.pan touchmove.pan', () => {
    if (this.editingLock) return;
    if (!this.isPanning) return;
    if (!this.panStart) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const dx = pos.x - this.panStart.x;
    const dy = pos.y - this.panStart.y;

    stage.x(stage.x() + dx);
    stage.y(stage.y() + dy);

    this.panStart = pos;
    stage.batchDraw();
  });

  // ✅ END pan (mouse release)
  stage.on('mouseup.pan touchend.pan', () => {
    if (!this.isPanning) return;
    this.panStart = undefined as any;
    stage.container().style.cursor = 'default';
    // NOTE: we don't turn isPanning false here because Space still pressed
    console.log('[PAN] end ✅');
  });
}


  // -----------------------------------
  // Resize
  // -----------------------------------
  @HostListener('window:resize')
  onResize(): void {
    if (!this.stage) return;

    const host = this.stageHost.nativeElement;
    const w = host.clientWidth;
    const h = host.clientHeight;

    this.stage.size({ width: w, height: h });
    this.drawBackground();
    this.drawGrid();

    console.log('[Editor] resized ✅', { w, h });
  }

  // -----------------------------------
// -----------------------------------
// -----------------------------------
// ✅ Text editing (Group label OR standalone Text)
public startEditText(target: Konva.Group | Konva.Text): void {
  if (!this.stage) return;

  this.editingLock = true;
  console.log('[EDIT] lock ON ✅');

  // साफ़ previous refs
  this.editingGroup = undefined;
  this.editingTextNode = undefined;
  this.editingBox = undefined;

  let textNode: Konva.Text | undefined;
  let boxNode: Konva.Rect | undefined;

  // CASE 1: group (rect-group etc.)
  if (target instanceof Konva.Group) {
    const g = target;
    textNode = g.findOne('.label') as Konva.Text | undefined;
    boxNode  = g.findOne('.box') as Konva.Rect | undefined;

    if (!textNode || !boxNode) {
      console.log('[EDIT] text/box not found ❌ (group)');
      this.editingLock = false;
      return;
    }

    this.editingGroup = g;
    this.editingTextNode = textNode;
    this.editingBox = boxNode;

    console.log('[EDIT] target ✅ group label');
  }

  // CASE 2: standalone text
  if (target instanceof Konva.Text) {
    textNode = target;

    this.editingTextNode = textNode;

    console.log('[EDIT] target ✅ text node');
  }

  if (!this.editingTextNode) {
    console.log('[EDIT] no editable text found ❌');
    this.editingLock = false;
    return;
  }

  // ✅ DOM overlay position calculation (stage scale + container rect)
  const hostRect = this.stageHost.nativeElement.getBoundingClientRect();
  const scale = this.stage.scaleX();

  // group => use absolute position, text => use absolute too
  const abs = this.editingTextNode.getAbsolutePosition();

  // width/height: group box (if exists) else text rect
  const rect = this.editingBox
    ? this.editingBox.getClientRect({ relativeTo: this.editingGroup! })
    : this.editingTextNode.getClientRect();

  const padding = 10;

  this.editUi.left   = hostRect.left + (abs.x * scale) + padding;
  this.editUi.top    = hostRect.top  + (abs.y * scale) + padding;
  this.editUi.width  = Math.max(60, (rect.width * scale) - padding * 2);
  this.editUi.height = Math.max(30, (rect.height * scale) - padding * 2);

  this.editUi.value = this.editingTextNode.text();
  this.editUi.fontFamily = this.editingTextNode.fontFamily();
  this.editUi.fontSize = this.editingTextNode.fontSize();

  this.isEditingText = true;

  // ✅ transformer hide (editing time)
  this.tr?.nodes([]);
  this.tr?.getLayer()?.batchDraw();
  console.log('[EDIT] transformer hidden ✅');

  // ✅ hide actual konva text while editing
  this.editingTextNode.visible(false);
  this.editingTextNode.getLayer()?.batchDraw(); // ✅ IMPORTANT
  console.log('[EDIT] text hidden ✅');

  console.log('[EDIT] started ✅', {
    left: this.editUi.left,
    top: this.editUi.top,
    w: this.editUi.width,
    h: this.editUi.height,
    text: this.editUi.value,
  });

  // focus textarea
  setTimeout(() => {
    const el = document.querySelector('textarea.text-editor') as HTMLTextAreaElement | null;
    el?.focus();
    el?.select();
    console.log('[EDIT] textarea focused ✅');
  }, 0);
}


public commitEdit(): void {
  if (!this.editingTextNode) {
    this.isEditingText = false;
    this.editingLock = false;
    return;
  }

  const newText = (this.editUi.value ?? '').trimEnd();

  // ✅ text change apply
  if (this.editingTextNode.text() !== newText) {
    this.editingTextNode.text(newText);

    // ✅ अब save schedule करो (यहीं सही जगह है)
    this.markDirtyAndScheduleSave('text-commit');
  }

  // show konva text again
  this.editingTextNode.visible(true);
  this.editingTextNode.getLayer()?.batchDraw();

  // close overlay
  this.isEditingText = false;
  this.editingLock = false;

  // transformer restore (अगर आपकी selection logic है)
  this.uiLayer?.batchDraw?.();
}


 public cancelEdit(): void {
  if (!this.isEditingText) return;

  console.log('[EDIT] canceled ✅');

  if (this.editingTextNode) {
    this.editingTextNode.visible(true);
    this.editingTextNode.getLayer()?.batchDraw(); // ✅ IMPORTANT
  }

  this.isEditingText = false;
  this.editingTextNode = undefined;
  this.editingGroup = undefined;
  this.editingBox = undefined;
  this.editingLock = false;

  console.log('[EDIT] lock OFF ✅');
}


public  onEditKeydown(e: KeyboardEvent): void {
  // ✅ Enter => commit (single line behavior)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    console.log('[EDIT] Enter pressed ✅ -> commit');
    this.commitEdit();
    return;
  }

  // ✅ Esc => cancel
  if (e.key === 'Escape') {
    e.preventDefault();
    console.log('[EDIT] Esc pressed ✅ -> cancel');
    this.cancelEdit();
    return;
  }
}

// -----------------------------------

openNodeImagePicker(): void {
  console.log('[IMG] open picker clicked ✅');

  if (!this.selectedNode) {
    console.log('[IMG] ❌ no selection. Select a Rect node first');
    return;
  }

  if (this.selectedNode.getClassName() !== 'Group') {
    console.log('[IMG] ❌ selected is not Group. Select Rect node (Group)');
    return;
  }

  this.nodeImageInput?.nativeElement?.click();
}
onNodeImagePicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  console.log('[IMG] file picked ✅', file?.name);

  if (!file) {
    console.log('[IMG] ❌ no file selected');
    return;
  }

  this.setImageInSelectedNode(file);

  this.markDirtyAndScheduleSave('image-set');

  // ✅ same file re-select allow
  input.value = '';
}
setImageInSelectedNode(file: File): void {
  if (!this.selectedNode || this.selectedNode.getClassName() !== 'Group') {
    console.log('[IMG] ❌ Please select a Rect node (Group) first');
    return;
  }

  const group = this.selectedNode as Konva.Group;

  const box = group.findOne('.box') as Konva.Rect | null;
  const label = group.findOne('.label') as Konva.Text | null;

  if (!box) {
    console.log('[IMG] ❌ box not found in selected group');
    return;
  }

  console.log('[IMG] inserting into node ✅', {
    groupId: group._id,
    boxW: box.width(),
    boxH: box.height(),
  });

  const reader = new FileReader();

  reader.onload = () => {
    const url = reader.result as string;
    console.log('[IMG] file read as DataURL ✅');

    const imageObj = new Image();

    imageObj.onload = () => {
      console.log('[IMG] image loaded ✅', {
        w: imageObj.width,
        h: imageObj.height,
      });

      // ✅ remove old image if exists
      const old = group.findOne('.nodeImage') as Konva.Image | undefined;
      if (old) {
        old.destroy();
        console.log('[IMG] old image removed ✅');
      }
// ✅ create Konva.Image
const box = group.findOne('.box') as Konva.Rect | null;
if (!box) {
  console.log('[IMG] ❌ box not found');
  return;
}

const bx = box.x();
const by = box.y();

const kImage = new Konva.Image({
  image: imageObj,
  x: bx,
  y: by,
  width: box.width(),
  height: box.height(),
  name: 'nodeImage',
  listening: false,
});

group.clipFunc((ctx) => {
  ctx.rect(bx, by, box.width(), box.height());
});
console.log('[IMG] clip rect ✅', { bx, by, w: box.width(), h: box.height() });

box.fill('rgba(0,0,0,0)');
console.log('[IMG] box fill transparent ✅');

// enforce order: box -> image -> label
const boxNode = group.findOne('.box') as Konva.Rect | null;
const labelNode = group.findOne('.label') as Konva.Text | null;

boxNode?.remove();
labelNode?.remove();

if (boxNode) group.add(boxNode);
group.add(kImage);
if (labelNode) group.add(labelNode);

this.nodeLayer?.batchDraw();

console.log('[IMG] children ✅', group.getChildren().map(n => `${n.name()}:${n.getClassName()}`));
console.log('[IMG] inserted into node ✅');



    


// ✅ ensure order: box (bottom) -> image (middle) -> label (top)
//const boxNode = group.findOne('.box') as Konva.Rect | undefined;
if (boxNode) boxNode.moveToBottom();

kImage.moveUp(); // image should be above box
kImage.moveToTop(); // temporarily top
if (label) label.moveToTop(); // label stays top
kImage.moveDown(); // image below label

this.nodeLayer?.batchDraw();
console.log('[IMG] z-order fixed ✅');

      this.nodeLayer?.batchDraw();
      console.log('[IMG] inserted into node ✅');
    };

    imageObj.onerror = () => {
      console.log('[IMG] ❌ image load error');
    };

    imageObj.src = url;
  };

  reader.onerror = () => {
    console.log('[IMG] ❌ file read error');
  };

  reader.readAsDataURL(file);
}


public onClickMoveToBg(): void {
  console.log('[UI] BG clicked ✅');
  this.moveSelectedTo('bg');
}

public onClickMoveToFg(): void {
  console.log('[UI] FG clicked ✅');
  this.moveSelectedTo('fg');
}

public onClickGroup(): void {
  console.log('[UI] Group clicked ✅', {
    selectedCount: this.selectedNodes?.length ?? 0,
  });
  this.groupSelected();
}

public onClickUngroup(): void {
  console.log('[UI] Ungroup clicked ✅', {
    selectedCount: this.selectedNodes?.length ?? 0,
    first: this.selectedNodes?.[0]?.getClassName?.() ?? null,
  });
  this.ungroupSelection();
}


private moveSelectedTo(target: 'bg' | 'fg'): void {
  console.log('[LAYER] moveSelectedTo called ✅', target);
}

private groupSelected(): void {
  if (!this.stage || !this.nodeLayer || !this.tr) return;

  const nodes: Konva.Node[] =
    (this.tr.nodes()?.length ? (this.tr.nodes() as Konva.Node[]) : this.lastMultiSelection) || [];

  const items: Konva.Node[] = nodes.filter((n: Konva.Node) =>
    ((n.name?.() || '')).includes('item')
  );

  console.log('[GROUP] groupSelected called ✅', { selectedCount: items.length });

  if (items.length < 2) {
    console.log('[GROUP] need 2+ nodes ❌');
    return;
  }

  const group = new Konva.Group({
    id: this.uid('group'),
    name: 'item group',
    draggable: true,
  });

  this.nodeLayer.add(group);

  items.forEach((n: Konva.Node) => {
    // ✅ IMPORTANT: child draggable off (so drag always moves group)
    n.draggable(false);

    const abs = n.getAbsolutePosition();
    n.moveTo(group);
    n.setAbsolutePosition(abs);
  });

  this.nodeLayer.batchDraw();

  // ✅ select the group
  this.tr.nodes([group]);
  this.uiLayer?.batchDraw();
this.markDirtyAndScheduleSave('group-change');

  console.log('[GROUP] created ✅', { groupId: group.id(), count: items.length });
}


private ungroupSelection(): void {
  if (!this.tr) return;

  const nodes = (this.tr.nodes?.() as Konva.Node[]) || [];
  if (nodes.length !== 1) {
    console.log('[UNGROUP] select 1 group only ❌');
    return;
  }

  const sel = nodes[0];
  const isGroup = sel.getClassName?.() === 'Group';
  const isItemGroup = (sel.name?.() || '').includes('item group');

  if (!isGroup || !isItemGroup) {
    console.log('[UNGROUP] selected is not item group ❌');
    return;
  }

  const group = sel as Konva.Group;
  const parentLayer = group.getLayer() as Konva.Layer | null;
  if (!parentLayer) return;

  // ✅ IMPORTANT: make a snapshot array before moving (else collection changes)
  const children: Konva.Node[] = [...group.getChildren()]; // <-- plain array ✅
  const released: Konva.Node[] = [];

  children.forEach((child: Konva.Node) => {
    const abs = child.getAbsolutePosition();

    child.moveTo(parentLayer);
    child.setAbsolutePosition(abs);

    // ✅ restore individual dragging after ungroup
    child.draggable(true);

    released.push(child);
  });

  // destroy group after releasing children
  group.destroy();

  parentLayer.batchDraw();

  // ✅ select released nodes (optional)
  this.tr.nodes(released);
  this.uiLayer?.batchDraw();
this.markDirtyAndScheduleSave('group-change');

  console.log('[UNGROUP] done ✅', { count: released.length });
}


//text handlers attach segments
// -----------------------------------


private addTextAt(pos: { x: number; y: number }): void {
  if (!this.nodeLayer) return;

  const t = new Konva.Text({
    x: pos.x,
    y: pos.y,
    text: 'Double click to edit',
    fontSize: this.fontSize ?? 16,
    fontFamily: this.fontFamily ?? 'Inter',
    fill: this.toolColor,
    draggable: true,
    name: 'item text',
  });

t.wrap('word');
t.ellipsis(false);



  t.id(this.uid('text'));

  // give min width so transformer feels good
  t.width(220);

  this.nodeLayer.add(t);
  this.nodeLayer.draw();

  console.log('[TEXT] added ✅', {
    x: t.x(), y: t.y(), w: t.width(), h: t.height()
  });

  // select it + transformer
  this.selectNode(t);

  // dblclick => edit overlay
  t.on('dblclick dbltap', () => {
    console.log('[TEXT] dblclick edit ✅');
    this.startEditText(t);
  });

  // logs for debug
  t.on('dragstart', () => console.log('[DRAG] start text'));
  t.on('dragend', () => console.log('[DRAG] end text', { x: t.x(), y: t.y() }));
  t.on('transformend', () => console.log('[RESIZE] end text', t.getClientRect()));
}

private applyTextStyleToSelection(): void {
  if (!this.selectedNode) {
    console.log('[TEXT] ❌ no selection');
    return;
  }

  // ✅ Case 1: standalone Konva.Text selected
  if (this.selectedNode instanceof Konva.Text) {
    this.selectedNode.fontFamily(this.fontFamily);
    this.selectedNode.fontSize(this.fontSize);
    this.selectedNode.getLayer()?.batchDraw();

    console.log('[TEXT] applied to Text ✅', {
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      text: this.selectedNode.text(),
    });
    return;
  }

  // ✅ Case 2: group selected → find ".label"
  if (this.selectedNode instanceof Konva.Group) {
    const label = this.selectedNode.findOne('.label') as Konva.Text | undefined;
    if (!label) {
      console.log('[TEXT] ❌ group has no .label');
      return;
    }

    label.fontFamily(this.fontFamily);
    label.fontSize(this.fontSize);
    label.getLayer()?.batchDraw();

    console.log('[TEXT] applied to Group label ✅', {
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      text: label.text(),
    });
    return;
  }

  console.log('[TEXT] ❌ selected is not Text/Group', this.selectedNode.getClassName());
}

private syncTextToolbarFromSelection(node: Konva.Node): void {
  let txt: Konva.Text | undefined;

  if (node instanceof Konva.Text) txt = node;
  if (node instanceof Konva.Group) {
    txt = node.findOne('.label') as Konva.Text | undefined;
  }

  if (!txt) return;

  this.fontFamily = txt.fontFamily();
  this.fontSize = txt.fontSize();

  console.log('[TEXT] toolbar synced ✅', {
    fontFamily: this.fontFamily,
    fontSize: this.fontSize,
  });
}
public onToolColorChange(color: string): void {
  this.toolColor = color;
  console.log('[UI] Color changed ✅', color);

  // ✅ अगर select किया हुआ node Text है तो तुरंत apply कर दो
  this.applyTextColorToSelection();
}
private applyTextColorToSelection(): void {
  const n = this.selectedNode; // तुम्हारे code में already है

  if (!n) {
    console.log('[TEXT] no selection -> skip');
    return;
  }

  // ✅ अगर selected node खुद Text है
  if (n instanceof Konva.Text) {
    n.fill(this.toolColor);
    n.getLayer()?.batchDraw();
    console.log('[TEXT] applied to Text ✅', { fill: this.toolColor, text: n.text() });
    return;
  }

  // ✅ अगर selected node Group है और उसके अंदर label text है
  if (n instanceof Konva.Group) {
    const label = n.findOne('.label') as Konva.Text | undefined;
    if (!label) {
      console.log('[TEXT] Group has no .label -> skip');
      return;
    }

    label.fill(this.toolColor);
    label.getLayer()?.batchDraw();
    console.log('[TEXT] applied to Group label ✅', { fill: this.toolColor, text: label.text() });
    return;
  }

  console.log('[TEXT] selected is not Text/Group -> skip', n.getClassName());
}

private attachPenHandlers(): void {
  if (!this.stage) return;

  // ✅ remove old pen listeners (duplicate avoid)
  this.stage.off('mousedown.pen touchstart.pen');
  this.stage.off('mousemove.pen touchmove.pen');
  this.stage.off('mouseup.pen touchend.pen');

  // ✅ START
  this.stage.on('mousedown.pen touchstart.pen', (evt) => {
    if (this.tool !== 'pen' && this.tool !== 'highlighter') return;

    const stage = this.stage; // ✅ local ref (TS fix)
    if (!stage) return;

    if (!this.fgLayer) {
      console.log('[DRAW] ❌ fgLayer missing (createLayers order check)');
      return;
    }

    const pos = stage.getPointerPosition();
    if (!pos) return;

    // ✅ transformer pe click hua to draw nahi
    const t = evt.target as Konva.Node;
    const p = t.getParent();
    const isTransformer = t.getClassName?.() === 'Transformer';
    const isTransformerChild = p?.getClassName?.() === 'Transformer';
    if (isTransformer || isTransformerChild) return;

    // ✅ अगर edit चल रहा है तो draw मत करो
    if (this.editingLock) return;

    this.isDrawing = true;

    const isHL = this.tool === 'highlighter';

    this.currentLine = new Konva.Line({
      points: [pos.x, pos.y],
      stroke: this.toolColor,
      strokeWidth: isHL ? this.thickness * 3 : this.thickness, // ✅ highlight thicker
      lineCap: 'round',
      lineJoin: 'round',
      tension: 0.5,
      draggable: true,
      name: isHL ? 'item highlighter' : 'item ink', // ✅ separate names
      opacity: isHL ? 0.25 : 1, // ✅ highlight transparent
      globalCompositeOperation: isHL ? 'multiply' : 'source-over', // ✅ better blend
    });

    // ✅ easier select/erase
    this.currentLine.hitStrokeWidth(isHL ? 50 : 30);

    // ✅ always FG
    this.fgLayer.add(this.currentLine);
    this.fgLayer.batchDraw();

    console.log(isHL ? '[HIGHLIGHTER] added ✅' : '[PEN] added ✅', {
      layer: 'FG',
      color: this.toolColor,
      thickness: this.thickness,
    });
  });

  // ✅ MOVE
  this.stage.on('mousemove.pen touchmove.pen', () => {
    if (this.tool !== 'pen' && this.tool !== 'highlighter') return;
    if (!this.isDrawing || !this.currentLine) return;

    const stage = this.stage; // ✅ local ref (safe)
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const points = this.currentLine.points();
    points.push(pos.x, pos.y);
    this.currentLine.points(points);

    this.fgLayer?.batchDraw();
  });

  // ✅ END
  this.stage.on('mouseup.pen touchend.pen', () => {
    if (this.tool !== 'pen' && this.tool !== 'highlighter') return;
    if (!this.isDrawing) return;

    this.isDrawing = false;

    const isHL = this.tool === 'highlighter';

    console.log(isHL ? '[HIGHLIGHTER] end ✅' : '[PEN] end ✅', {
      points: this.currentLine?.points()?.length,
    });

    this.currentLine = undefined;

    // ✅ autosave on end (FIX: moved inside mouseup)
    this.markDirtyAndScheduleSave(isHL ? 'highlighter-end' : 'pen-end');
  });

  console.log('[Editor] pen/highlighter handlers ready ✅');
}


private normalizeLine(line: Konva.Line): void {
  const sx = line.scaleX();
  const sy = line.scaleY();
  if (sx === 1 && sy === 1) return;

  const pts = line.points();
  const newPts: number[] = [];

  for (let i = 0; i < pts.length; i += 2) {
    newPts.push(pts[i] * sx, pts[i + 1] * sy);
  }

  line.points(newPts);
  line.scaleX(1);
  line.scaleY(1);
}

private bindTransformerImageFix(): void {
  if (!this.tr) return;

  this.tr.on('transformend', () => {
    const node = this.tr!.nodes()[0];
    if (!node) return;

    if (node.getClassName() === 'Image') {
      const img = node as Konva.Image;

      const newW = Math.max(20, img.width() * img.scaleX());
      const newH = Math.max(20, img.height() * img.scaleY());

      img.width(newW);
      img.height(newH);
      img.scaleX(1);
      img.scaleY(1);

      img.getLayer()?.batchDraw();
      this.tr?.getLayer()?.batchDraw();

      console.log('[IMG] resize fixed ✅', newW, newH);
    }
  });
}
// -----------------------------------


private getSelectedItem(): Konva.Node | null {
  const node = this.selectedNode;
  if (!node) return null;

  // अगर selectedNode खुद item है
  if (node.name?.() && node.name().includes('item')) return node;

  // अगर child select हुआ है (future में)
  const anc = node.findAncestors((n: Konva.Node) => {
    const nm = n.name?.();
    return !!nm && nm.includes('item');
  }, true)?.[0] as Konva.Node | undefined;

  return anc ?? node;
}
  // -----------------------------------
sendSelectionToFG(): void {
  const item = this.getSelectedItem();
  if (!item) {
    console.log('[LAYER] ❌ nothing selected');
    return;
  }
  if (!this.fgLayer || !this.nodeLayer) {
    console.log('[LAYER] ❌ layers not ready');
    return;
  }

  const oldLayer = item.getLayer();

  // ✅ move to fg layer
  item.moveTo(this.fgLayer);

  // ✅ keep order in FG too
  item.moveToTop();

  // ✅ redraw both layers (old + new)
  oldLayer?.batchDraw();
  this.fgLayer.batchDraw();
  this.uiLayer?.batchDraw();

  // ✅ selection keep
  this.setSelection(item);

  console.log('[LAYER] ✅ moved to FG', item.getClassName(), item.name());
}


sendSelectionToBG(): void {
  const item = this.getSelectedItem();
  if (!item) {
    console.log('[LAYER] ❌ nothing selected');
    return;
  }
  if (!this.nodeLayer || !this.fgLayer) {
    console.log('[LAYER] ❌ layers not ready');
    return;
  }

  const oldLayer = item.getLayer();

  // ✅ move back to node layer (BG)
  item.moveTo(this.nodeLayer);

  // ✅ send behind other items (but above grid/bg layers)
  item.moveToBottom();

  // ✅ redraw both layers (old + new)
  oldLayer?.batchDraw();
  this.nodeLayer.batchDraw();
  this.uiLayer?.batchDraw();

  // ✅ selection keep
  this.setSelection(item);

  console.log('[LAYER] ✅ moved to BG (nodeLayer bottom)', item.getClassName(), item.name());
}


  // -----------------------------------

  bringForward(): void {
  const item = this.getSelectedItem();
  if (!item) return;

  item.moveUp(); // ✅ one step up in same layer
  item.getLayer()?.batchDraw();
  this.uiLayer?.batchDraw();

  this.setSelection(item);
  console.log('[Z] bringForward ✅', item.name());
}

sendBackward(): void {
  const item = this.getSelectedItem();
  if (!item) return;

  item.moveDown(); // ✅ one step down in same layer
  item.getLayer()?.batchDraw();
  this.uiLayer?.batchDraw();

  this.setSelection(item);
  console.log('[Z] sendBackward ✅', item.name());
}

// -----------------------------------
private deleteSelection(): void {
  const node = this.selectedNode;
  if (!node) return;

  // ✅ only items are deletable
  const nm = node.name?.() || '';
  if (!nm.includes('item')) {
    console.log('[DEL] ignore non-item ✅', node.getClassName(), nm);
    return;
  }

  // ✅ history: save delete before destroy (undo के लिए)
  this.pushDelete(node);

  node.destroy();
  this.setSelection(null);

  this.nodeLayer?.batchDraw();
  this.fgLayer?.batchDraw();
  this.uiLayer?.batchDraw();

  console.log('[DEL] deleted ✅', node.getClassName(), nm);
}


private eraseAtPointer(): void {
  if (!this.stage) return;
const now = Date.now();
if (now - this.lastEraseTs < 35) return; // 25-60ms ok
this.lastEraseTs = now;

  const pos = this.stage.getPointerPosition();
  if (!pos) return;

  const hits = this.stage.getAllIntersections(pos) as Konva.Node[];
  if (!hits || hits.length === 0) {
    // console.log('[ERASER] hits ✅ []');
    return;
  }

  const hit =
    hits.find((h) => {
      const cls = h.getClassName?.();
      if (cls === 'Transformer') return false;

      const pCls = h.getParent?.()?.getClassName?.();
      if (pCls === 'Transformer') return false;

      const nm = h.name?.() || '';

      // ✅ eraser ONLY for pen/highlighter strokes
      return (
        cls === 'Line' &&
        nm.includes('item') &&
        (nm.includes('ink') || nm.includes('hl'))
      );
    }) || null;

  if (!hit) return;

  // ✅ Partial erase: split stroke near pointer
  this.partialEraseLine(hit as Konva.Line);
}



// ✅ helper: total length of polyline (for tiny-dot removal)

private partialEraseLine(line: Konva.Line): void {
  if (!this.stage) return;

  const pos = this.stage.getPointerPosition();
  if (!pos) return;

  const pts = line.points();
  if (!pts || pts.length < 6) return; // too small to split

  // ✅ eraser brush radius (bigger = easier cut)
  const radius = 18;

  // ✅ find cut index near pointer
  const cutIndex = this.findCutIndexOnLine(pts, pos.x, pos.y, radius);
  if (cutIndex === -1) return;

  // ✅ create a small gap around cut point (erase जैसा feel)
  const gapPoints = 2; // 1-3 recommended

  const leftEnd = Math.max(0, cutIndex - gapPoints);
  const rightStart = Math.min((pts.length / 2) - 1, cutIndex + gapPoints);

  // build left points [0..leftEnd]
  const left: number[] = [];
  for (let i = 0; i <= leftEnd; i++) {
    left.push(pts[i * 2], pts[i * 2 + 1]);
  }

  // build right points [rightStart..end]
  const right: number[] = [];
  for (let i = rightStart; i < pts.length / 2; i++) {
    right.push(pts[i * 2], pts[i * 2 + 1]);
  }

  // ✅ compute actual length (to remove tiny dots)
  const strokeW = (line.strokeWidth?.() as number) || 6;
  const minLen = Math.max(30, strokeW * 6);

  const leftLen = this.polylineLength(left);
  const rightLen = this.polylineLength(right);

  const hasLeft = left.length >= 6 && leftLen >= minLen;   // at least 3 points + length
  const hasRight = right.length >= 6 && rightLen >= minLen;

  if (!hasLeft && !hasRight) return;

  // ✅ clone style attrs from original line
  const attrs = line.getAttrs();

  const common: Konva.LineConfig = {
    stroke: attrs.stroke,
    strokeWidth: attrs.strokeWidth,
    lineCap: attrs.lineCap,
    lineJoin: attrs.lineJoin,
    tension: attrs.tension,
    opacity: attrs.opacity,
    globalCompositeOperation: attrs.globalCompositeOperation,
    draggable: true,
    name: attrs.name || 'item ink',
    listening: true,
  };

  const layer = line.getLayer();

  // remove original
  line.destroy();

  // add new split parts
  if (hasLeft) {
    const l1 = new Konva.Line({ ...common, points: left });
    l1.hitStrokeWidth(30);
    layer?.add(l1);
  }

  if (hasRight) {
    const l2 = new Konva.Line({ ...common, points: right });
    l2.hitStrokeWidth(30);
    layer?.add(l2);
  }
  this.cleanupTinyInkSegments(layer as Konva.Layer, minLen);

  layer?.batchDraw();
  this.uiLayer?.batchDraw();

  console.log('[ERASER] split ✅', { cutIndex, hasLeft, hasRight, leftLen, rightLen, minLen });
}



private findCutIndexOnLine(points: number[], px: number, py: number, radius: number): number {
  let bestIndex = -1;
  let bestDist = Infinity;

  const n = points.length / 2;

  for (let i = 0; i < n - 1; i++) {
    const x1 = points[i * 2];
    const y1 = points[i * 2 + 1];
    const x2 = points[(i + 1) * 2];
    const y2 = points[(i + 1) * 2 + 1];

    const d = this.distPointToSegment(px, py, x1, y1, x2, y2);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i; // cut around this vertex index
    }
  }

  // must be within radius
  if (bestDist <= radius) return bestIndex;
  return -1;
}

private distPointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - x1, py - y1);

  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - x2, py - y2);

  const b = c1 / c2;
  const bx = x1 + b * vx;
  const by = y1 + b * vy;
  return Math.hypot(px - bx, py - by);
}
private polylineLength(points: number[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 2; i += 2) {
    const x1 = points[i], y1 = points[i + 1];
    const x2 = points[i + 2], y2 = points[i + 3];
    len += Math.hypot(x2 - x1, y2 - y1);
  }
  return len;
}

private cleanupTinyInkSegments(layer: Konva.Layer | null, minLen: number): void {
  if (!layer) return;

  const lines = layer.find('Line') as any as Konva.Line[];

  lines.forEach((l) => {
    const nm = l.name?.() || '';
    if (!nm.includes('item')) return;
    if (!(nm.includes('ink') || nm.includes('hl'))) return;

    const pts = l.points();
    if (!pts || pts.length < 6) {
      l.destroy();
      return;
    }

    const len = this.polylineLength(pts);
    if (len < minLen) {
      l.destroy();
    }
  });
}

private uid(prefix = 'n'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

private pushAdd(node: Konva.Node): void {
  if (this.isApplyingHistory) return;

  const json = node.toObject(); // ✅ lightweight snapshot
  this.undoStack.push({ type: 'ADD', nodeJson: json });
  this.redoStack = []; // ✅ new action => redo cleared
  // console.log('[HISTORY] ADD ✅', node.getClassName(), node.name(), node.id());
}

private pushDelete(node: Konva.Node): void {
  if (this.isApplyingHistory) return;

  const json = node.toObject();
  this.undoStack.push({ type: 'DELETE', nodeJson: json });
  this.redoStack = [];
  // console.log('[HISTORY] DELETE ✅', node.getClassName(), node.name(), node.id());
}
private restoreNodeFromJson(nodeJson: any): Konva.Node | null {
  try {
    // ✅ Konva.Node.create returns Konva.Node at runtime
    const node = Konva.Node.create(nodeJson) as unknown as Konva.Node;
    if (!node) return null;

    // ✅ Ensure draggable stays true for all "item" nodes (group/shape/text/image/line)
    const nm = node.name?.() || '';
    if (nm.includes('item')) node.draggable(true);

    // ✅ IMPORTANT: Images reload after restore (undo/redo fix)
    this.reviveImages(node);

    // ✅ Decide correct target layer
    const targetLayer =
      nm.includes('ink') || nm.includes('hl') ? this.fgLayer : this.nodeLayer;

    if (targetLayer) {
      // ✅ TS-safe add (Konva typings sometimes restrict Layer.add types)
      (targetLayer as any).add(node as any);
      targetLayer.batchDraw();
    }

    // ✅ UI redraw (transformer layer etc.)
    this.uiLayer?.batchDraw();

    return node;
  } catch (e) {
    console.log('[HISTORY] restore failed ❌', e);
    return null;
  }
}


undo(): void {
  const action = this.undoStack.pop();
  if (!action) return;

  this.isApplyingHistory = true;

  try {
    if (action.type === 'ADD') {
      // undo add => remove that node
      const id = action.nodeJson?.attrs?.id;
      const node = this.stage?.findOne(`#${id}`) as Konva.Node | null;
      if (node) node.destroy();

      this.redoStack.push(action);
    }

    if (action.type === 'DELETE') {
      // undo delete => restore node
      this.restoreNodeFromJson(action.nodeJson);
      this.redoStack.push(action);
    }

    // TRANSFORM later (next step)
    this.setSelection(null);

    this.nodeLayer?.batchDraw();
    this.fgLayer?.batchDraw();
    this.uiLayer?.batchDraw();
  } finally {
    this.isApplyingHistory = false;
  }

  console.log('[UNDO] ✅');
}

redo(): void {
  const action = this.redoStack.pop();
  if (!action) return;

  this.isApplyingHistory = true;

  try {
    if (action.type === 'ADD') {
      // redo add => restore node
      this.restoreNodeFromJson(action.nodeJson);
      this.undoStack.push(action);
    }

    if (action.type === 'DELETE') {
      // redo delete => remove node again
      const id = action.nodeJson?.attrs?.id;
      const node = this.stage?.findOne(`#${id}`) as Konva.Node | null;
      if (node) node.destroy();

      this.undoStack.push(action);
    }

    this.setSelection(null);

    this.nodeLayer?.batchDraw();
    this.fgLayer?.batchDraw();
    this.uiLayer?.batchDraw();
  } finally {
    this.isApplyingHistory = false;
  }

  console.log('[REDO] ✅');
}
private reviveImages(node: Konva.Node): void {
  // ✅ node खुद Image हो सकता है या Group के अंदर Images हो सकती हैं
  // ✅ TS fix: Konva.Node typings में find() sometimes missing, so cast to any
  const root: any = node as any;

  const found: Konva.Node[] =
    typeof root.find === 'function' ? (root.find('Image') as Konva.Node[]) : [];

  const all: Konva.Node[] = [node, ...found];

  all.forEach((n) => {
    if (n.getClassName?.() !== 'Image') return;

    const kImg = n as Konva.Image;
    const src = kImg.getAttr('src'); // ✅ base64/dataURL
    if (!src) return;

    const htmlImg = new Image();
    htmlImg.onload = () => {
      kImg.image(htmlImg);

      // ✅ layer redraw (safe)
      const layer = kImg.getLayer();
      layer?.batchDraw();
    };
    htmlImg.src = src;
  });
}
private pointInPolygon(p: { x: number; y: number }, poly: number[]) {
  let inside = false;

  for (let i = 0, j = poly.length - 2; i < poly.length; i += 2) {
    const xi = poly[i], yi = poly[i + 1];
    const xj = poly[j], yj = poly[j + 1];

    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

// LASSO selection implementation

private selectNodesInsidePolygon(points: number[]): void {
  if (!this.stage || !this.tr) return;

  const selected: Konva.Node[] = [];
  const layers = [this.nodeLayer, this.fgLayer].filter(Boolean) as Konva.Layer[];

  for (const layer of layers) {
    layer.getChildren().forEach((node) => {
      const nm = node.name?.() || '';
      if (!nm.includes('item')) return;     // ✅ only items
      if (!node.isVisible()) return;

      const rect = node.getClientRect({ relativeTo: this.stage });
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

      if (this.pointInPolygon(center, points)) {
        selected.push(node);
      }
    });
  }

  this.tr.nodes(selected);
  this.tr.getLayer()?.batchDraw();

  console.log('[LASSO] selected ✅', selected.map(n => `${n.getClassName()} ${n.name?.()}`));
}





//...........................





private selectMultipleNodes(nodes: Konva.Node[]): void {
  if (!this.tr) return;

  // ✅ keep your selection state synced
  this.selectedNodes = nodes;
  this.selectedNode = nodes[0] ?? undefined;

  this.tr.nodes(nodes);
  this.uiLayer?.batchDraw();

  console.log(
    '[MULTI] selected ✅',
    nodes.map(n => `${n.getClassName()} ${n.name?.()}`)
  );
}
// -----------------------------------
//............................
private exportItemsJson(): string[] {
  const out: string[] = [];

  const grabTopLevel = (layer: Konva.Layer | null | undefined) => {
    if (!layer) return;

    // ✅ Works for both: Konva.Collection and Array typings
    const raw = layer.getChildren() as any;
    const children: Konva.Node[] =
      typeof raw?.toArray === 'function'
        ? raw.toArray()
        : Array.isArray(raw)
          ? raw
          : [];

    for (const n of children) {
      // ✅ ONLY top-level items
      if (!n?.hasName?.('item')) continue;
      if (n.getParent() !== layer) continue;

      out.push(n.toJSON());
    }
  };

  grabTopLevel(this.nodeLayer);
  grabTopLevel(this.fgLayer);

  return out;
}




// -----------------------------------
private exportPreviewDataUrl(): string | null {
  if (!this.stage) return null;
  return this.stage.toDataURL({ pixelRatio: 2 });
}
// -----------------------------------
onClickSave(): void {
  this.saveContentToStore(false);
}


onClickSavePreview(): void {
  this.saveContentToStore(true);
}











async onClickSavePreview1(): Promise<void> {
  const pageId = this.workspaceStore.snapshot.activePageId;
  if (!pageId || !this.stage) return;

  const contentJson = this.exportItemsJson();

  // full image
  const fullPreview = this.stage.toDataURL({ pixelRatio: 1 });

  // ✅ resize thumbnail
  const previewDataUrl = await this.resizeDataUrl(fullPreview, 420);

  this.workspaceStore.updatePageContent(pageId, {
    contentJson,
    previewDataUrl,
  });

  console.log('[SAVE_PREVIEW ✅]', {
    pageId,
    count: contentJson.length,
    previewKB: Math.round(previewDataUrl.length / 1024),
  });
}

private async loadFromActivePage(): Promise<void> {
  const pageId = this.workspaceStore.snapshot.activePageId;
  if (!pageId) {
    console.log('[LOAD] skip (no activePageId)');
    return;
  }

  // ✅ ALWAYS load heavy content from IndexedDB
  let items: any[] = [];
  try {
    items = (await (this.workspaceStore as any).idb?.getPageContent?.(pageId)) ?? [];
  } catch (e) {
    console.warn('[LOAD] idb getPageContent failed ⚠️', { pageId, e });
    items = [];
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.log('[LOAD] empty (idb) ⚠️', { pageId, count: Array.isArray(items) ? items.length : 'NA' });
    // still clear canvas so user sees blank but not stale
    this.destroyTopLevelItems(this.nodeLayer);
    this.destroyTopLevelItems(this.fgLayer);
    this.tr?.nodes([]);
    this.clearAllItems();
    return;
  }

  // ✅ IMPORTANT: destroy existing Konva nodes FIRST, then clear arrays
  this.destroyTopLevelItems(this.nodeLayer);
  this.destroyTopLevelItems(this.fgLayer);
  this.tr?.nodes([]);
  this.clearAllItems();

  // ✅ restore
  items.forEach((j: any) => this.restoreNodeFromJson(j));

  this.nodeLayer?.batchDraw();
  this.fgLayer?.batchDraw();
  this.uiLayer?.batchDraw();

  console.log('[LOAD ✅]', { pageId, count: items.length });
}


private destroyBySelector(layer: Konva.Layer | null | undefined, selector: string) {
  if (!layer) return;

  const found = layer.find(selector) as any;
  this.forEachNode(found, (n) => n.destroy());
}


// ✅ helper: Konva collection -> real array (TS-safe-ish + runtime safe)
private asNodeArray(list: unknown): Konva.Node[] {
  const anyList = list as any;

  if (!anyList) return [];

  // case-1: already array
  if (Array.isArray(anyList)) return anyList as Konva.Node[];

  // case-2: konva collection has toArray()
  if (typeof anyList.toArray === 'function') {
    return anyList.toArray() as Konva.Node[];
  }

  // case-3: has length + index access
  if (typeof anyList.length === 'number') {
    const out: Konva.Node[] = [];
    for (let i = 0; i < anyList.length; i++) {
      const n = anyList[i];
      if (n) out.push(n as Konva.Node);
    }
    return out;
  }

  return [];
}

// ✅ helper: find selector nodes as array
private findNodes(layer: Konva.Layer | null | undefined, selector: string): Konva.Node[] {
  if (!layer) return [];
  const found = layer.find(selector);           // Collection in runtime
  return this.asNodeArray(found);
}


private forEachNode(collection: any, fn: (n: Konva.Node) => void) {
  if (!collection) return;

  // array
  if (Array.isArray(collection)) {
    collection.forEach(fn);
    return;
  }

  // konva collection: each()
  if (typeof collection.each === 'function') {
    collection.each((n: any) => fn(n as Konva.Node));
    return;
  }

  // konva collection: toArray()
  if (typeof collection.toArray === 'function') {
    collection.toArray().forEach((n: any) => fn(n as Konva.Node));
    return;
  }

  // fallback: iterable/array-like
  if (typeof collection.length === 'number') {
    Array.from(collection as any).forEach((n: any) => fn(n as Konva.Node));
  }
}

private exportPreviewDataUrlSmall(maxW = 420): string | undefined {
  if (!this.stage) return undefined;

  // ✅ current stage size
  const w = this.stage.width();
  const h = this.stage.height();
  if (!w || !h) return undefined;

  // ✅ scale factor for thumbnail
  const scale = Math.min(1, maxW / w);

  // ✅ export smaller image
  return this.stage.toDataURL({
    pixelRatio: scale,   // NOTE: pixelRatio < 1 works in Konva
    mimeType: 'image/png',
    quality: 0.7,        // png में ignore हो सकता है, no harm
  });
}


private resizeDataUrl(
  src: string,
  maxW = 420,
  quality = 0.7
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');

      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = src;
  });
}

private clearAllItems(): void {
  if (this.nodeLayer) {
    this.nodeLayer.destroyChildren();
    this.nodeLayer.batchDraw();
  }

  if (this.fgLayer) {
    this.fgLayer.destroyChildren();
    this.fgLayer.batchDraw();
  }

  // transformer reset
  this.tr?.nodes([]);
}


private markDirtyAndScheduleSave(reason: string): void {
  if (this.ignoreAutoSave) return;
  if (!this.stage) return;

  this.hasDirtyChanges = true;

  if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);

  this.autoSaveTimer = setTimeout(() => {
    this.autoSaveTimer = null;

    if (this.ignoreAutoSave) return;
    if (!this.stage) return;
    if (!this.hasDirtyChanges) return;

    this.hasDirtyChanges = false;
    this.saveContentToStore(false, { reason, allowEmpty: false });
    console.log('[AUTO_SAVE ✅]', reason);
  }, this.autoSaveDelayMs);
}
private saveContentToStore(
  includePreview: boolean,
  opts?: { allowEmpty?: boolean; reason?: string }
): void {
  const pageId = this.workspaceStore.snapshot.activePageId;
  if (!pageId) return;

  // ✅ avoid late autosave after back/destroy
  if (this.ignoreAutoSave) {
    console.log('[SAVE] skip (ignoreAutoSave) ✅', { pageId, reason: opts?.reason });
    return;
  }

  const contentJson = this.exportItemsJson() ?? [];

  // ✅ prevent overwriting existing content with empty []
  const existing = this.workspaceStore.snapshot.pages?.find(p => p.id === pageId) as any;
  const existingCount = Array.isArray(existing?.contentJson) ? existing.contentJson.length : 0;

  if (!opts?.allowEmpty && contentJson.length === 0 && existingCount > 0) {
    console.warn('[SAVE] blocked empty overwrite ⚠️', {
      pageId,
      existingCount,
      reason: opts?.reason
    });
    return;
  }

  const previewDataUrl = includePreview ? this.exportPreviewDataUrl() : undefined;

  this.workspaceStore.updatePageContent(pageId, {
    contentJson, // ✅ same key
    previewDataUrl: previewDataUrl ?? undefined,
  });

  console.log('[SAVE ✅]', {
    pageId,
    count: contentJson.length,
    preview: includePreview,
    reason: opts?.reason,
    existingCount
  });
}

private bindAutoSaveEvents(): void {
  if (!this.stage) return;

  // 1) ✅ drag / drop
  this.stage.on('dragend.autosave', (e) => {
    const n = e.target as Konva.Node;
    if ((n.name() || '').includes('item')) this.markDirtyAndScheduleSave('dragend');
  });

  // 2) ✅ resize/rotate/transform
  this.stage.on('transformend.autosave', (e) => {
    const n = e.target as Konva.Node;
    if ((n.name() || '').includes('item')) this.markDirtyAndScheduleSave('transformend');
  });

  // 3) ✅ text edit (जब text change करते हो)
  // जहाँ भी आप textNode.text(...) set कर रहे हो, वहाँ call करो:
  // this.markDirtyAndScheduleSave('text-change');

  // 4) ✅ pen/highlighter draw finish
  // आपके pen handler में mouseup/touchend पर call करो:
  // this.markDirtyAndScheduleSave('pen-end');

  console.log('[AUTO_SAVE] events bound ✅');
}

private cancelAutoSave1(): void {
  this.ignoreAutoSave = true;

  if (this.autoSaveTimer) {
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
  }

  // stage listeners remove (important)
  try {
    this.stage?.off('.autosave');
  } catch {}
}

public onTextEditorInput(): void {
  // ✅ सिर्फ dirty mark (heavy save नहीं)
  this.markDirtyAndScheduleSave('text-typing');
}


private getSelectionBBoxOnStage(): { x: number; y: number; width: number; height: number } | null {
  if (!this.stage || !this.tr) return null;

  const nodes = this.tr.nodes();
  if (!nodes || nodes.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  nodes.forEach((n) => {
    // ✅ stage-relative rect
    const r = n.getClientRect({ relativeTo: this.stage });
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  });

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return { x: minX, y: minY, width, height };
}


private exportSelectionDataUrl(pixelRatio = 2): string | null {
  if (!this.stage) return null;

  const bbox = this.getSelectionBBoxOnStage();
  if (!bbox) return null;

  // ✅ temporarily hide transformer layer
  const trLayer = this.tr?.getLayer();
  const wasVisible = trLayer?.visible() ?? true;
  trLayer?.visible(false);
  trLayer?.batchDraw();

  const dataUrl = this.stage.toDataURL({
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
    pixelRatio,
  });

  // ✅ restore
  trLayer?.visible(wasVisible);
  trLayer?.batchDraw();

  return dataUrl;
}

private addCroppedPreviewImage(dataUrl: string): void {
  if (!this.stage || !this.nodeLayer) return;

  const layer = this.nodeLayer; // ✅ capture (TS-safe)
  const bbox = this.getSelectionBBoxOnStage();
  if (!bbox) return;

  const img = new Image();
  img.onload = () => {
    const kImg = new Konva.Image({
      x: bbox.x,
      y: bbox.y,
      image: img,
      width: bbox.width,
      height: bbox.height,
      draggable: true,
      name: 'item image',
    });

    kImg.setAttr('src', dataUrl);
    kImg.setAttr('isCropPreview', true);

    layer.add(kImg);       // ✅ TS-safe
    layer.batchDraw();     // ✅ TS-safe

    this.setSelection(kImg);
    this.markDirtyAndScheduleSave('crop');

    console.log('[CROP ✅] preview image added', { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height });
  };

  img.src = dataUrl;
}




private async exportSelectionCropDataUrl(): Promise<string | null> {
  if (!this.stage) return null;

  const bbox = this.getSelectionBBoxOnStage(); // ✅ आपका existing function
  if (!bbox || bbox.width <= 2 || bbox.height <= 2) {
    console.log('[CROP] ❌ invalid bbox', bbox);
    return null;
  }

  // ✅ stage scale consider
  const scaleX = this.stage.scaleX() || 1;
  const scaleY = this.stage.scaleY() || 1;

  // ✅ Konva stage cropping via toDataURL
  const dataUrl = this.stage.toDataURL({
    x: bbox.x * scaleX,
    y: bbox.y * scaleY,
    width: bbox.width * scaleX,
    height: bbox.height * scaleY,
    pixelRatio: 2, // ✅ quality
  });

  console.log('[CROP] ✅ dataUrl ready', { w: bbox.width, h: bbox.height });
  return dataUrl;
}


private destroyTopLevelItems(layer: Konva.Layer | null | undefined): void {
  if (!layer) return;

  const children = layer.getChildren(); // Collection<Node>
  for (let i = children.length - 1; i >= 0; i--) {
    const n = children[i] as Konva.Node;
    if (n.hasName('item')) n.destroy();
  }
}

private setPagePreview(dataUrl: string): void {
  const pageId = this.workspaceStore.snapshot.activePageId;
  if (!pageId) return;

  const contentsJson = this.exportItemsJson();

  this.workspaceStore.updatePageContent(pageId, {
    contentJson: contentsJson,     // ✅ सही key
    previewDataUrl: dataUrl,       // ✅ thumbnail
  });

  console.log('[PREVIEW] ✅ saved in page', { pageId, size: dataUrl.length });
}
public async onClickCropSelection(): Promise<void> {
  if (!this.stage) return;

  console.log('[CROP] button clicked ✅');

  // 1) selection का crop image (dataUrl) निकालो
  const dataUrl = await this.exportSelectionCropDataUrl();
  if (!dataUrl) {
    console.log('[CROP] ❌ no dataUrl (selection missing)');
    return;
  }

  // 2) crop preview image को canvas पे add करो
  this.addCroppedPreviewImage(dataUrl);
// ✅ ADD THIS
this.saveCropForMindmap(dataUrl);

  // 3) (optional) page preview save करना है तो यहाँ करो
  // this.setPagePreview(dataUrl);
}

private bindPasteHandlers(): void {
  // avoid duplicate binding
  window.removeEventListener('paste', this.onPaste as any);
  window.addEventListener('paste', this.onPaste as any);

  console.log('[PASTE] ✅ handler bound');
}

// keep as arrow fn so "this" is correct
private onPaste = async (e: ClipboardEvent) => {
  if (!this.stage || !this.nodeLayer) return;

  // 🔒 If you are editing textarea, don't hijack paste
  if (this.isEditingText) return;

  const cd = e.clipboardData;
  if (!cd) return;

  // 1) IMAGE paste (screenshots)
  const imgItem = Array.from(cd.items).find(i => i.type.startsWith('image/'));
  if (imgItem) {
    const file = imgItem.getAsFile();
    if (!file) return;

    e.preventDefault(); // stop browser default paste

    const dataUrl = await this.fileToDataURL(file);
    const name = this.makeAutoName('Screenshot');

    this.addClipboardImageAsItem(dataUrl, name);
    return;
  }

  // 2) TEXT paste
  const text = cd.getData('text/plain');
  if (text && text.trim().length > 0) {
    // allow normal paste in inputs
    const el = document.activeElement?.tagName?.toLowerCase();
    if (el === 'input' || el === 'textarea') return;

    e.preventDefault();
    const name = this.makeAutoName('TextPaste');

    this.addClipboardTextAsItem(text.trim(), name);
    return;
  }
};

private fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

private makeAutoName(prefix: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
private addClipboardImageAsItem(dataUrl: string, autoName: string): void {
  if (!this.stage || !this.nodeLayer) return;

  const img = new Image();
  img.onload = () => {
    const pos = this.getDropPosition(); // center or pointer

    // ✅ scale down if too big
    const maxW = 420;
    const maxH = 320;
    let w = img.width;
    let h = img.height;

    const s = Math.min(maxW / w, maxH / h, 1);
    w = Math.round(w * s);
    h = Math.round(h * s);

    const kImg = new Konva.Image({
      x: pos.x,
      y: pos.y,
      image: img,
      width: w,
      height: h,
      draggable: true,
      name: 'item image',
    });

    // IMPORTANT for restore/export
    kImg.setAttr('src', dataUrl);
    kImg.setAttr('title', autoName);
    kImg.setAttr('pasted', true);

    this.nodeLayer!.add(kImg);
    this.nodeLayer!.batchDraw();

    this.setSelection(kImg);
    this.markDirtyAndScheduleSave('paste-image');

    console.log('[PASTE] ✅ image added', { autoName, w, h });
  };

  img.src = dataUrl;
}

private getDropPosition(): { x: number; y: number } {
  if (!this.stage) return { x: 100, y: 100 };

  const p = this.stage.getPointerPosition();
  if (p) return { x: p.x, y: p.y };

  // fallback center
  return {
    x: this.stage.width() / 2 - 150,
    y: this.stage.height() / 2 - 120,
  };
}

private addClipboardTextAsItem(text: string, autoName: string): void {
  if (!this.stage || !this.nodeLayer) return;

  const pos = this.getDropPosition();

  const maxW = 320;
  const pad = 12;

  const t = new Konva.Text({
    x: pos.x,
    y: pos.y,
    text,
    fontSize: 22,
    fontFamily: 'Inter',
    fill: '#111',
    width: maxW,
    padding: pad,
    draggable: true,
    name: 'item text',
  });

  // ✅ nice wrapping
  t.wrap('word');
  t.ellipsis(false);

  // save meta
  t.setAttr('title', autoName);
  t.setAttr('pasted', true);

  this.nodeLayer.add(t);
  this.nodeLayer.batchDraw();

  this.setSelection(t);
  this.markDirtyAndScheduleSave('paste-text');

  console.log('[PASTE] ✅ text added', { autoName, len: text.length });
}
private saveCropForMindmap(dataUrl: string): void {
  const nodeId = localStorage.getItem('mm_editing_nodeId');
  if (!nodeId) return;

  localStorage.setItem('mm_lastCrop_dataUrl', dataUrl);
  localStorage.setItem('mm_lastCrop_nodeId', nodeId);

  console.log('[CROP->MM] saved for mindmap ✅', { nodeId, bytes: dataUrl.length });
}

onBack1(): void {
  const nodeId = localStorage.getItem('mm_editing_nodeId');
  const notebookId = localStorage.getItem('mm_editing_notebookId') || 'demo';

  console.log('[Editor] back clicked ✅', { nodeId, notebookId });

  // ✅ 1) पहले save कर दो ताकि content miss न हो
  this.saveContentToStore(false);

  // ✅ 2) Mindmap पर वापस
  // NOTE: आपका mindmap route जैसा है वैसा ही use करना
  // example: /mindmap/:notebookId
  this.router.navigate(['/mindmap', notebookId], { queryParams: nodeId ? { nodeId } : {} })
    .then(ok => console.log('[Editor] back navigate ✅', ok))
    .catch(err => console.error('[Editor] back navigate ❌', err));
}

public onBack(): void {
  console.log('[Editor] back clicked ✅', this.editingCtx);

  // 1) STOP any late autosave FIRST
  this.cancelAutoSave();

  // 2) SAVE while stage is still alive (avoid empty overwrite)
  try {
    if (this.stage) {
      this.saveContentToStore(false, { reason: 'back', allowEmpty: false });
      console.log('[Editor] back flush-save ✅');
    }
  } catch (e) {
    console.warn('[Editor] back flush-save failed ⚠️', e);
  }

  // 3) navigate back to mindmap
  const notebookId = this.editingCtx?.notebookId ?? 'demo';
  this.router.navigate(['/mindmap', notebookId]);
}
private cancelAutoSave(): void {
  this.ignoreAutoSave = true;

  if (this.autoSaveTimer) {
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
  }

  // remove autosave events (if you used ".autosave" namespace)
  try {
    this.stage?.off('.autosave');
  } catch {}
}

} 
