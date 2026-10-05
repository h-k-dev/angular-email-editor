import {
  inlinePadding,
  isZeroSide,
  normalizeInlineStyles,
  normalizeStyleText,
  parseDeclarations,
} from './inline-style';

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

describe('normalizeStyleText', () => {
  it('leaves an attribute every engine reads alike untouched, to the character', () => {
    expect(normalizeStyleText('color:#444;  padding:10px 25px;font-size:13px')).toBeNull();
    expect(normalizeStyleText('background-color:#fff;margin:0px auto;max-width:600px')).toBeNull();
    expect(normalizeStyleText('border:0;border-top:1px solid red')).toBeNull();
  });

  it('writes a colour-only background as background-color, the rest as authored', () => {
    expect(
      normalizeStyleText(
        'display:inline-block;background:#bd8714;color:#FFFFFF;font-size:13px;padding:10px 25px;',
      ),
    ).toBe(
      'display: inline-block; background-color: #bd8714; color: #FFFFFF; font-size: 13px; padding: 10px 25px;',
    );
    expect(normalizeStyleText('background:white')).toBe('background-color: white;');
    expect(normalizeStyleText('background:rgb(1, 2, 3)')).toBe('background-color: rgb(1, 2, 3);');
  });

  it('writes an image background as its longhands', () => {
    expect(
      normalizeStyleText(
        "background:url('https://a/b.jpg') center top / cover no-repeat;background-position:center top;",
      ),
    ).toBe(
      "background-image: url('https://a/b.jpg'); background-repeat: no-repeat; " +
        'background-position: center top; background-size: cover; background-position: center top;',
    );
    expect(normalizeStyleText('background:#fff url(https://a/b.jpg) repeat-x fixed')).toBe(
      'background-image: url(https://a/b.jpg); background-color: #fff; background-repeat: repeat-x;',
    );
  });

  it('resolves a box written as shorthand and longhands into one shorthand, in place', () => {
    expect(
      normalizeStyleText(
        'direction:ltr;padding:0px;padding-bottom:20px;padding-top:20px;text-align:center;',
      ),
    ).toBe('direction: ltr; padding: 20px 0px 20px 0px; text-align: center;');
    expect(normalizeStyleText('margin:0;margin-top:13px;color:red')).toBe(
      'margin: 13px 0 0 0; color: red;',
    );
  });

  it('keeps !important on what it rewrites', () => {
    expect(normalizeStyleText('background:#fff !important')).toBe(
      'background-color: #fff !important;',
    );
    expect(normalizeStyleText('padding:0;padding-left:5px !important')).toBe(
      'padding: 0 0 0 5px !important;',
    );
  });
});

describe('normalizeInlineStyles', () => {
  it('makes the CSSOM read what the author wrote — the engine the suite runs in included', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<a style="display:inline-block;background:#bd8714;color:#fff;font-size:13px;line-height:120%;padding:10px 25px;"></a>' +
      '<td style="padding:0px;padding-bottom:20px;padding-top:20px;"></td>' +
      '<p style="color: red"></p>';
    normalizeInlineStyles(root);
    const a = root.querySelector('a')!;
    expect(a.style.display).toBe('inline-block');
    expect(a.style.fontSize).toBe('13px');
    expect(a.style.lineHeight).toBe('120%');
    expect(a.style.paddingLeft).toBe('25px');
    expect(a.style.backgroundColor).toBe('rgb(189, 135, 20)');
    expect(root.querySelector('p')!.getAttribute('style')).toBe('color: red');
  });
});
