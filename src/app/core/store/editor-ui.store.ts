import { Injectable, computed, signal } from '@angular/core';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export interface EditorUiState {
  isTitleEditing: boolean;
  titleDraft: string;

  saveStatus: SaveStatus;
  lastSavedAt: number | null;
}

@Injectable({ providedIn: 'root' })
export class EditorUiStore {
  private readonly _state = signal<EditorUiState>({
    isTitleEditing: false,
    titleDraft: '',
    saveStatus: 'saved',
    lastSavedAt: null,
  });

  readonly state = computed(() => this._state());

  readonly isTitleEditing = computed(() => this._state().isTitleEditing);
  readonly titleDraft = computed(() => this._state().titleDraft);

  readonly saveStatus = computed(() => this._state().saveStatus);
  readonly lastSavedAt = computed(() => this._state().lastSavedAt);

  // Title edit
  startTitleEdit(currentTitle: string) {
    this._state.update(s => ({
      ...s,
      isTitleEditing: true,
      titleDraft: currentTitle ?? '',
    }));
  }

  setTitleDraft(v: string) {
    this._state.update(s => ({ ...s, titleDraft: v }));
  }

  cancelTitleEdit() {
    this._state.update(s => ({ ...s, isTitleEditing: false }));
  }

  finishTitleEdit() {
    this._state.update(s => ({ ...s, isTitleEditing: false }));
  }

  // Save status
  markUnsaved() {
    this._state.update(s => ({ ...s, saveStatus: 'unsaved' }));
  }

  markSaving() {
    this._state.update(s => ({ ...s, saveStatus: 'saving' }));
  }

  markSaved() {
    this._state.update(s => ({
      ...s,
      saveStatus: 'saved',
      lastSavedAt: Date.now(),
    }));
  }

  markError() {
    this._state.update(s => ({ ...s, saveStatus: 'error' }));
  }
}
