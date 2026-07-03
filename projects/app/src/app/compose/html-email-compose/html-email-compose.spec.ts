import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HtmlEmailCompose } from './html-email-compose';

describe('HtmlEmailCompose', () => {
  let component: HtmlEmailCompose;
  let fixture: ComponentFixture<HtmlEmailCompose>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HtmlEmailCompose],
    }).compileComponents();

    fixture = TestBed.createComponent(HtmlEmailCompose);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
