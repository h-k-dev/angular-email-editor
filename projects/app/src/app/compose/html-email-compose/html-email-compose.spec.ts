import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HtmlEmailCompose } from './html-email-compose';

describe('HtmlEmailCompose', () => {
  let component: HtmlEmailCompose;
  let fixture: ComponentFixture<HtmlEmailCompose>;

  const lines = () => fixture.nativeElement.querySelectorAll('.aee-code-line').length;

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

  it('applies incoming html to its editor while active', async () => {
    component.html.set('<p>One</p><p>Two</p>');
    await fixture.whenStable();
    expect(component.editor()!.getText()).toContain('<p>Two</p>');
  });

  describe('while hidden', () => {
    beforeEach(async () => {
      fixture.componentRef.setInput('active', false);
      await fixture.whenStable();
    });

    it('leaves the editor’s DOM alone', async () => {
      const before = lines();
      const text = component.editor()!.getText();

      component.html.set('<p>One</p><p>Two</p><p>Three</p>');
      await fixture.whenStable();
      expect(component.editor()!.getText()).toBe(text);
      expect(lines()).toBe(before);
    });

    it('still lints the text, so the problems strip stays live', async () => {
      component.html.set('<p><img src="a.png"></p>');
      await fixture.whenStable();
      expect(component.diagnostics().length).toBeGreaterThan(0);

      component.html.set('<p>fine</p>');
      await fixture.whenStable();
      expect(component.diagnostics()).toEqual([]);
    });

    it('catches up, and lints itself, once shown again', async () => {
      component.html.set('<p><img src="a.png"></p>');
      await fixture.whenStable();
      const hidden = component.diagnostics();

      fixture.componentRef.setInput('active', true);
      await fixture.whenStable();
      expect(component.editor()!.getText()).toContain('<p><img src="a.png"></p>');
      expect(component.diagnostics()).toEqual(hidden);
    });
  });
});
