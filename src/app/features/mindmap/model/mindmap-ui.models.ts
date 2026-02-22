export type Id = string;

export interface MindmapNodeUI {
  id: Id;
  notebookId: Id;
  pageId: Id;

  title: string;
  snapshotImage?: string;

  x: number;
  y: number;
  width: number;
  height: number;

  parentId?: Id;
  childrenIds: Id[];
   updatedAt?: number;
}
