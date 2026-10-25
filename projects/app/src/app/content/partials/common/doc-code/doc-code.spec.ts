import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CodeLanguage } from '../../../../core/docs/code-highlighter';
import { DocCode } from './doc-code';

@Component({
  imports: [DocCode],
  template: `<doc-code [code]="code()" [lang]="lang()" [label]="label()" />`,
})
class Host {
  readonly code = signal('const editor = createEditor({ parent });\n\neditor.focus();');
  readonly lang = signal<CodeLanguage>('ts');
  readonly label = signal<string | null>(null);
}

describe('DocCode', () => {
  const start = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture;
  };
  const text = (root: HTMLElement) =>
    [...root.querySelectorAll('.doc-code__line')].map((line) => line.textContent);

  it('shows the code as lines coloured GitHub’s way, light and dark', async () => {
    const fixture = await start();
    const root = fixture.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(text(root)).toEqual([
        'const editor = createEditor({ parent });',
        '',
        'editor.focus();',
      ]);
    });
    // The keyword `const`, in GitHub's red for either scheme.
    const keyword = root.querySelector<HTMLElement>('.doc-code__line span')!;
    expect(keyword.textContent).toBe('const');
    expect(keyword.getAttribute('style')).toContain('light-dark(');
  });

  it('names the block by its label, or its language', async () => {
    const fixture = await start();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.doc-code__label')?.textContent?.trim()).toBe('TypeScript');
    fixture.componentInstance.label.set('Example');
    await fixture.whenStable();
    expect(root.querySelector('.doc-code__label')?.textContent?.trim()).toBe('Example');
  });

  it('copies the code exactly, and says so', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = await start();
    const root = fixture.nativeElement as HTMLElement;
    const copy = root.querySelector<HTMLButtonElement>('.doc-code__copy')!;
    expect(copy.getAttribute('aria-label')).toBe('Copy code');

    copy.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith(fixture.componentInstance.code());
    expect(copy.getAttribute('aria-label')).toBe('Copied');
  });
});
