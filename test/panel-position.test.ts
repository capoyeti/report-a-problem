import { describe, it, expect } from 'vitest';
import { clampPanelPosition } from '../src/lib/panel-position';

const viewport = { width: 1280, height: 800 };
const panel = { width: 400, height: 300 };

describe('clampPanelPosition', () => {
  it('keeps a position that is already fully on-screen unchanged', () => {
    expect(clampPanelPosition({ x: 100, y: 100 }, panel, viewport)).toEqual({ x: 100, y: 100 });
  });

  it('allows dragging past the left/top edge as long as a 40px sliver stays grabbable', () => {
    expect(clampPanelPosition({ x: -50, y: -50 }, panel, viewport)).toEqual({ x: -50, y: -50 });
  });

  it('stops the left/top drag once only the 40px sliver would remain visible', () => {
    const result = clampPanelPosition({ x: -100000, y: -100000 }, panel, viewport);
    expect(result).toEqual({ x: 40 - panel.width, y: 40 - panel.height });
  });

  it('pulls a position back on-screen when dragged past the right/bottom edge', () => {
    const result = clampPanelPosition({ x: 5000, y: 5000 }, panel, viewport);
    expect(result.x).toBeLessThan(5000);
    expect(result.y).toBeLessThan(5000);
  });

  it('always leaves at least a 40px sliver of the panel visible on each axis', () => {
    const MIN_VISIBLE = 40;
    const result = clampPanelPosition({ x: 100000, y: 100000 }, panel, viewport);
    expect(result.x).toBeLessThanOrEqual(viewport.width - MIN_VISIBLE);
    expect(result.y).toBeLessThanOrEqual(viewport.height - MIN_VISIBLE);
  });
});
