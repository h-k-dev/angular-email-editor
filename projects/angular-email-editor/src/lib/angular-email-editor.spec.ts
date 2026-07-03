import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularEmailEditor } from './angular-email-editor';

describe('AngularEmailEditor', () => {
  let component: AngularEmailEditor;
  let fixture: ComponentFixture<AngularEmailEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AngularEmailEditor],
    }).compileComponents();

    fixture = TestBed.createComponent(AngularEmailEditor);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
