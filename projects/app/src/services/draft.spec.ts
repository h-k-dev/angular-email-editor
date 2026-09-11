import { TestBed } from '@angular/core/testing';
import { Draft } from './draft';

describe('Draft', () => {
  let service: Draft;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Draft);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
