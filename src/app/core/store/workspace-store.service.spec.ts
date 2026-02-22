import { TestBed } from '@angular/core/testing';

import { WorkspaceStoreService } from './workspace-store.service';

describe('WorkspaceStoreService', () => {
  let service: WorkspaceStoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WorkspaceStoreService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
