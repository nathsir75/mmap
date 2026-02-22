export type Id = string;

export interface Notebook {
  id: Id;
  title: string;
  createdAt: number;
}

export interface Section {
  id: Id;
  notebookId: Id;
  title: string;
  order: number;
  createdAt: number;
}

export interface Page {
  id: Id;
  sectionId: Id;
  title: string;
  order: number;
  updatedAt: number;

  // ✅ Editor Save/Load
  contentJson?: any;        // ✅ NEW (use this everywhere)
  previewDataUrl?: string;  // PNG thumbnail (optional)

  // ✅ OLD support (optional, backward compatibility)
  // contentsJson?: any;
  // previewDataUrl1?: string;
}

export interface WorkspaceState {
  notebooks: Notebook[];
  sections: Section[];
  pages: Page[];

  activeNotebookId?: Id;
  activeSectionId?: Id;
  activePageId?: Id;

  lastSavedAt?: number;
}
