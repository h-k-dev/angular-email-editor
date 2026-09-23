import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HtmlEmailCompose } from './html-email-compose';

describe('HtmlEmailCompose', () => {
  let component: HtmlEmailCompose;
  let fixture: ComponentFixture<HtmlEmailCompose>;

  const lines = () => fixture.nativeElement.querySelectorAll('.aee-code-line').length;

  /** Incoming html is paced (a shown source throttles, a hidden lint
      debounces): wait out the longest window, then settle. */
  const paced = async () => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await fixture.whenStable();
  };

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
    await paced();
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
      await paced();
      expect(component.diagnostics().length).toBeGreaterThan(0);

      component.html.set('<p>fine</p>');
      await paced();
      expect(component.diagnostics()).toEqual([]);
    });

    it('lints once typing rests — not once per keystroke', async () => {
      const lints: unknown[] = [];
      const subscription = component.diagnostics.subscribe((d) => lints.push(d));
      for (const html of ['<p>a</p>', '<p>ab</p>', '<p>abc</p>', '<p><img src="a.png"></p>']) {
        component.html.set(html);
        await fixture.whenStable();
      }
      expect(lints).toEqual([]);
      await paced();
      expect(lints.length).toBe(1);
      expect(component.diagnostics().length).toBeGreaterThan(0);
      subscription.unsubscribe();
    });

    it('catches up, and lints itself, once shown again', async () => {
      component.html.set('<p><img src="a.png"></p>');
      await paced();
      const hidden = component.diagnostics();

      fixture.componentRef.setInput('active', true);
      await fixture.whenStable();
      expect(component.editor()!.getText()).toContain('<p><img src="a.png"></p>');
      expect(component.diagnostics()).toEqual(hidden);
    });
  });
});
