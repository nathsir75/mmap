import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkspaceStoreService } from '../../../core/store/workspace-store.service';
import { Notebook, Section, Page } from '../../../core/models/workspace.models';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './workspace-shell.component.html',
  styleUrls: ['./workspace-shell.component.css'],
})
export class WorkspaceShellComponent {
  private store = inject(WorkspaceStoreService);

  // Local UI state
  renamingNotebookId = signal<string | null>(null);
  renamingSectionId = signal<string | null>(null);
  renamingPageId = signal<string | null>(null);

  notebookDraft = signal('');
  sectionDraft = signal('');
  pageDraft = signal('');

  // Reactive state from store
  state = signal(this.store.snapshot);

  constructor() {
    effect(() => {
      const sub = this.store.state$.subscribe(s => this.state.set(s));
      return () => sub.unsubscribe();
    });
  }

  notebooks = computed(() => this.state().notebooks);
  activeNotebookId = computed(() => this.state().activeNotebookId);

  sections = computed(() => {
    const s = this.state();
    const nbId = s.activeNotebookId;
    const list = s.sections
      .filter(x => x.notebookId === nbId)
      .sort((a, b) => a.order - b.order);
    return list;
  });

  activeSectionId = computed(() => this.state().activeSectionId);

  pages = computed(() => {
    const s = this.state();
    const secId = s.activeSectionId;
    const list = s.pages
      .filter(p => p.sectionId === secId)
      .sort((a, b) => a.order - b.order);
    return list;
  });

  activePageId = computed(() => this.state().activePageId);
  activePage = computed(() => {
    const s = this.state();
    return s.pages.find(p => p.id === s.activePageId);
  });

  // ---------- Notebook handlers
  setNotebook(nb: Notebook) {
    this.store.setActiveNotebook(nb.id);
    this.stopAllRenames();
  }

  addNotebook() {
    this.store.createNotebook('New Notebook');
    this.stopAllRenames();
  }

  startRenameNotebook(nb: Notebook) {
    this.renamingNotebookId.set(nb.id);
    this.notebookDraft.set(nb.title);
  }

  commitRenameNotebook(nb: Notebook) {
    const title = this.notebookDraft().trim() || 'My Notebook';
    this.store.renameNotebook(nb.id, title);
    this.renamingNotebookId.set(null);
  }

  deleteNotebook(nb: Notebook) {
    const ok = confirm(`Delete notebook "${nb.title}" ?`);
    if (!ok) return;
    this.store.deleteNotebook(nb.id);
    this.stopAllRenames();
  }

  // ---------- Section handlers
  setSection(sec: Section) {
    this.store.setActiveSection(sec.id);
    this.stopAllRenames();
  }

  addSection() {
    const nbId = this.state().activeNotebookId;
    if (!nbId) return;
    this.store.createSection(nbId, 'New Section');
    this.stopAllRenames();
  }

  startRenameSection(sec: Section) {
    this.renamingSectionId.set(sec.id);
    this.sectionDraft.set(sec.title);
  }

  commitRenameSection(sec: Section) {
    const title = this.sectionDraft().trim() || 'Section';
    this.store.renameSection(sec.id, title);
    this.renamingSectionId.set(null);
  }

  deleteSection(sec: Section) {
    const ok = confirm(`Delete section "${sec.title}" ?`);
    if (!ok) return;
    this.store.deleteSection(sec.id);
    this.stopAllRenames();
  }

  // ---------- Page handlers
  setPage(p: Page) {
    this.store.setActivePage(p.id);
    this.stopAllRenames();
  }

  addPage() {
    const secId = this.state().activeSectionId;
    if (!secId) return;
    this.store.createPage(secId, 'Untitled page');
    this.stopAllRenames();
  }

  startRenamePage(p: Page) {
    this.renamingPageId.set(p.id);
    this.pageDraft.set(p.title);
  }

  commitRenamePage(p: Page) {
    const title = this.pageDraft().trim() || 'Untitled page';
    this.store.renamePage(p.id, title);
    this.renamingPageId.set(null);
  }

  deletePage(p: Page) {
    const ok = confirm(`Delete page "${p.title}" ?`);
    if (!ok) return;
    this.store.deletePage(p.id);
    this.stopAllRenames();
  }

  // ---------- helpers
  stopAllRenames() {
    this.renamingNotebookId.set(null);
    this.renamingSectionId.set(null);
    this.renamingPageId.set(null);
  }


  activeNotebook = computed(() => {
  const id = this.activeNotebookId();
  return this.notebooks().find((n) => n.id === id) ?? null;
});

// Section object of currently selected sectionId
activeSection = computed(() => {
  const id = this.activeSectionId();
  return this.sections().find((s) => s.id === id) ?? null;
});
}
