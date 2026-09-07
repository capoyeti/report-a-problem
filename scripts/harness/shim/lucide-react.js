// Minimal stand-ins for the icons the panel imports. Real lucide-react is a peer
// dependency of the package; the harness only needs shapes that lay out the same.
const React = window.React;
const icon = (path) => (props) =>
  React.createElement(
    'svg',
    { ...props, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    React.createElement('path', { d: path })
  );

export const X = icon('M18 6 6 18M6 6l12 12');
export const Send = icon('m22 2-7 20-4-9-9-4Z');
export const CheckCircle2 = icon('M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3');
export const Loader2 = icon('M21 12a9 9 0 1 1-6.22-8.56');
export const Bug = icon('M8 2v4M16 2v4M5 10h14v6a7 7 0 0 1-14 0Z');
export const ImagePlus = icon('M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7M16 5h6M19 2v6M4 17l4-4 4 4');
export const Trash2 = icon('M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14');
export const GripHorizontal = icon('M5 9h.01M12 9h.01M19 9h.01M5 15h.01M12 15h.01M19 15h.01');
export const FileText = icon('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h6');
export const ClipboardPaste = icon('M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M16 4h2a2 2 0 0 1 2 2v2M14 12h8v8h-8Z');
