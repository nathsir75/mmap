import { Routes } from '@angular/router';
import { WorkspaceShellComponent } from './features/workspace/workspace-shell/workspace-shell.component';
import { WorkspaceHomeComponent } from './features/workspace/workspace-home/workspace-home.component';
import { PageEditorComponent } from './features/editor/page-editor/page-editor.component';
import { MindmapPageComponent } from './features/mindmap/page/mindmap-page/mindmap-page.component';

export const routes: Routes = [
  // ✅ Fullscreen pages (outside shell)
  { path: 'editor/:pageId', component: PageEditorComponent },

  // ✅ make mindmap fullscreen too (temporary safe)
  { path: 'mindmap/:notebookId', component: MindmapPageComponent },

  // ✅ Workspace shell
  {
    path: '',
    component: WorkspaceShellComponent,
    children: [{ path: '', component: WorkspaceHomeComponent }],
  },

  { path: '**', redirectTo: '' },
];
