import { inlinePadding, isZeroSide, parseDeclarations } from './inline-style';

const el = (style: string): HTMLElement => {
  const div = document.createElement('div');
  div.setAttribute('style', style);
  return div;
};

describe('parseDeclarations', () => {
  it('splits on ; outside parentheses and quotes, lifts !important', () => {
    expect(
      parseDeclarations(
        "background-image: url('data:image/png;base64,AA;BB'); Width: 100% !important; ;color:",
      ),
    ).toEqual([
      { name: 'background-image', value: "url('data:image/png;base64,AA;BB')", important: false },
      { name: 'width', value: '100%', important: true },
    ]);
  });
});

describe('inlinePadding', () => {
  it('reads a longhand written after the shorthand — MJML’s section padding', () => {
    // jsdom’s CSSOM reads this as `padding: 0px` alone; the text says more.
    expect(
      inlinePadding(el('direction:ltr;padding:0px;padding-bottom:20px;padding-top:20px;')),
    ).toEqual(['20px', '0px', '20px', '0px']);
  });

  it('lets a later shorthand replace earlier longhands', () => {
    expect(inlinePadding(el('padding-top: 5px; padding: 1px 2px'))).toEqual([
      '1px',
      '2px',
      '1px',
      '2px',
    ]);
  });

  it('expands one, two, three and four values the way CSS does', () => {
    expect(inlinePadding(el('padding: 4px'))).toEqual(['4px', '4px', '4px', '4px']);
    expect(inlinePadding(el('padding: 1px 2px'))).toEqual(['1px', '2px', '1px', '2px']);
    expect(inlinePadding(el('padding: 1px 2px 3px'))).toEqual(['1px', '2px', '3px', '2px']);
    expect(inlinePadding(el('padding: 1px 2px 3px 4px'))).toEqual(['1px', '2px', '3px', '4px']);
  });

  it('a longhand alone sets its side and leaves the others at 0', () => {
    expect(inlinePadding(el('padding-left: 25px'))).toEqual(['0', '0', '0', '25px']);
  });

  it('strips !important and ignores case', () => {
    expect(inlinePadding(el('PADDING-TOP: 8px !important'))).toEqual(['8px', '0', '0', '0']);
  });

  it('is null with no padding declared', () => {
    expect(inlinePadding(el('color: red'))).toBeNull();
    expect(inlinePadding(document.createElement('div'))).toBeNull();
  });

  it('isZeroSide knows a zero in any unit', () => {
    for (const zero of ['0', '0px', '0em', '0%']) expect(isZeroSide(zero)).toBe(true);
    for (const some of ['20px', '0.5px', '1em']) expect(isZeroSide(some)).toBe(false);
  });
});
