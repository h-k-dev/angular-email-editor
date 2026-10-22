import { SubmenuGeometry, placeSubmenu } from './submenu-placement';

/** A 200px menu at (300, 100) on a 1000×800 screen; a 210×300 list whose
    row sits 40px down the menu. */
const at = (patch: Partial<SubmenuGeometry> = {}): SubmenuGeometry => ({
  menu: { left: 300, top: 100, width: 200 },
  rowTop: 40,
  list: { width: 210, height: 300 },
  viewport: { width: 1000, height: 800 },
  overlap: 6,
  margin: 8,
  ...patch,
});

describe('placeSubmenu', () => {
  it('stands to the right, over the edge, level with its row', () => {
    expect(placeSubmenu(at())).toEqual({ side: 'right', left: 194, top: 40 });
  });

  it('goes left when the right has no room', () => {
    expect(placeSubmenu(at({ menu: { left: 700, top: 100, width: 200 } }))).toEqual({
      side: 'left',
      left: -204,
      top: 40,
    });
  });

  it('goes the way the menu went: away from what it is about', () => {
    // The grip is to the right of the menu — the menu flipped left of it.
    const grip = { left: 520, right: 540 };
    expect(placeSubmenu(at({ avoid: grip })).side).toBe('left');
    // ... unless the left has no room either.
    expect(placeSubmenu(at({ menu: { left: 50, top: 100, width: 200 }, avoid: grip })).side).toBe(
      'right',
    );
  });

  it('takes the roomier side and is pushed into the screen when neither fits', () => {
    const narrow = at({
      menu: { left: 100, top: 100, width: 200 },
      viewport: { width: 420, height: 800 },
    });
    const place = placeSubmenu(narrow);
    expect(place.side).toBe('right'); // 118px of room to the right, 98 to the left
    // Its right edge kept the margin off the screen's.
    expect(narrow.menu.left + place.left + narrow.list.width).toBe(420 - 8);
  });

  it('is pushed up as far as it runs past the bottom, never past the top', () => {
    const low = at({ menu: { left: 300, top: 600, width: 200 } });
    const place = placeSubmenu(low);
    expect(low.menu.top + place.top + low.list.height).toBe(800 - 8);
    const tall = at({ list: { width: 210, height: 900 } });
    expect(tall.menu.top + placeSubmenu(tall).top).toBe(8);
  });
});
